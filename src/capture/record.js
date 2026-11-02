// Pure builders: game record from a captured log, team records, and set assembly. No I/O, no globals.
import { parseLog, parseDetails } from '../core/parser.js';
import { groupSets } from '../core/bo3.js';
import { rosterHash, unpackTeam } from '../core/teams.js';
import { stripMega, toID } from '../core/names.js';

/** Own side/picks info from a `|request|` JSON: {side, preview, maxChosen, chosen} (null on junk). */
export function readRequest(json) {
	let req;
	try {
		req = typeof json === 'string' ? JSON.parse(json) : json;
	} catch (err) {
		return null;
	}
	if (!req || typeof req !== 'object') return null;
	const side = req.side && (req.side.id === 'p1' || req.side.id === 'p2') ? req.side.id : null;
	const pokemon = req.side && Array.isArray(req.side.pokemon)
		? req.side.pokemon.map(p => ({
			species: stripMega(parseDetails(p && p.details).species),
			item: p && typeof p.item === 'string' ? p.item : '',
			active: !!(p && p.active),
		})).filter(p => p.species)
		: [];
	return { side, teamPreview: !!req.teamPreview, wait: !!req.wait, maxChosen: Number(req.maxChosenTeamSize) || 0, pokemon };
}

/** Fold a request into the running state {side, preview, maxChosen, chosen}. */
export function applyRequest(state, info) {
	if (!info) return;
	if (info.side) state.side = info.side;
	if (info.teamPreview) {
		state.preview = info.pokemon;
		state.maxChosen = info.maxChosen || state.maxChosen || 4;
		state.chosen = null;
	} else if (state.preview && !state.chosen && !info.wait && info.pokemon.length) {
		state.chosen = info.pokemon;
	}
}

function perspective(game, side) {
	const opp = side === 'p1' ? 'p2' : 'p1';
	game.side = side;
	game.opp = opp;
	game.result = game.tie ? 'tie' : game.winner && game.winner.side ? (game.winner.side === side ? 'win' : 'loss') : null;
}

function teamMembers(game, side, req) {
	if (game.teams[side].length) return game.teams[side].map(t => ({ species: t.species, item: t.item || '' }));
	if (game.side === side && req && req.preview && req.preview.length) return req.preview.map(p => ({ species: p.species, item: p.item || '' }));
	return game.roster[side].map(e => ({ species: e.species, item: '' }));
}

/** Name of the user's teambuilder team matching the members (roster+items first, then roster only). */
export function matchTeamName(members, myTeams, formatId, dex) {
	if (!members.length || !Array.isArray(myTeams)) return '';
	const hasItems = members.some(m => m.item);
	const withItems = rosterHash(members, dex);
	const plain = rosterHash(members.map(m => m.species), dex);
	const exact = [];
	const loose = [];
	for (const t of myTeams) {
		const sets = unpackTeam(t.packed, dex);
		if (!sets.length) continue;
		if (hasItems && rosterHash(sets.map(s => ({ species: s.species, item: s.item })), dex) === withItems) exact.push(t);
		else if (rosterHash(sets.map(s => s.species), dex) === plain) loose.push(t);
	}
	const pool = exact.length ? exact : loose;
	const best = pool.find(t => toID(t.format) === formatId) || pool[0];
	return best ? best.name : '';
}

function teamRecord(members, ts, extra) {
	return {
		id: rosterHash(members, extra.dex),
		roster: members.map(m => m.species),
		members,
		format: extra.formatId,
		firstSeen: ts,
		lastSeen: ts,
		...(extra.name ? { name: extra.name } : {}),
		...(extra.mine ? { mine: true } : {}),
	};
}

/**
 * Build the stored game record. Returns {skip: reason} when the game is not the user's (spectating).
 * @param {{roomid, lines: string[], me: string, dex?, req?, myTeams?, ts: number, partial: boolean, backfill?: string}} o
 * @returns {{skip: string} | {record: object, teams: object[]}}
 */
export function buildGame(o) {
	const game = parseLog(o.lines, { me: o.me, dex: o.dex });
	const req = o.req || {};
	if (game.sideVia === 'name' || game.sideVia === 'name+team') {
		if (req.side && req.side !== game.side) perspective(game, req.side);
	} else if (req.side) {
		perspective(game, req.side);
		game.sideVia = 'request';
	} else {
		return { skip: 'spectating' };
	}
	const side = game.side;
	if (game.result === null && game.winner && game.winner.name) {
		// players were never seen (late join): the |win| name still tells the outcome
		game.result = toID(game.winner.name) === toID(o.me) ? 'win' : 'loss';
		game.winner.side = game.result === 'win' ? side : game.opp;
	}
	const record = { ...game };
	const switched = { picks: game.picks[side].slice(), leads: game.leads[side].slice() };
	let request = null;
	if (req.chosen && req.chosen.length) {
		const n = req.maxChosen || 4;
		const picks = req.chosen.slice(0, n).map(p => p.species);
		const leadMons = req.chosen.filter(p => p.active);
		const leads = (leadMons.length ? leadMons : req.chosen).slice(0, game.gametype === 'singles' ? 1 : 2).map(p => p.species);
		request = { picks, leads };
		record.picks = { ...game.picks, [side]: picks };
		record.leads = { ...game.leads, [side]: leads };
	}
	record.picksSource = request ? 'request' : 'switch';
	record.picksRequest = request;
	record.picksSwitch = switched;
	record.partial = !!o.partial;
	if (o.backfill) record.backfill = o.backfill;
	record.roomid = o.roomid;
	record.ts = o.ts;
	record.setId = game.bo3 ? game.bo3.wrapperId : null;
	record.gameNumber = game.bo3 ? game.bo3.gameNumber : null;

	const formatId = (/^battle-([a-z0-9]+)-/.exec(o.roomid) || [])[1] || '';
	const mine = teamMembers(game, side, req);
	const theirs = teamMembers(game, game.opp, req);
	const name = matchTeamName(mine, o.myTeams, formatId, o.dex);
	const mineRec = teamRecord(mine, o.ts, { dex: o.dex, formatId, name, mine: true });
	const theirRec = teamRecord(theirs, o.ts, { dex: o.dex, formatId });
	record.myTeamId = mineRec.id;
	record.myTeamName = name;
	record.oppTeamId = theirRec.id;
	record.rawLog = o.lines.join('\n');
	const teams = [mineRec];
	if (theirRec.members.length && theirRec.id !== mineRec.id) teams.push(theirRec);
	return { record, teams: teams.filter(t => t.members.length) };
}

/**
 * Assemble the set record for a wrapper id from its stored games (user's perspective `me`).
 * A forfeit ends the series, so an unfinished set whose latest game ended by forfeit is decided by that game.
 */
export function assembleSet(games, me) {
	const { sets } = groupSets(games, { me });
	const set = sets[0];
	if (!set) return null;
	const last = set.games[set.games.length - 1];
	let winnerId = set.winnerId;
	let forfeit = false;
	if (!winnerId && last && (last.end === 'forfeit' || last.end === 'inactivity')) {
		const w = last.winner && last.winner.side && last.players[last.winner.side];
		if (w) {
			winnerId = w.id;
			forfeit = true;
		}
	}
	const meId = toID(me);
	const rating = set.ratings && set.ratings[meId];
	const oppEntry = Object.keys(set.players).find(id => id !== meId);
	return {
		id: set.id,
		format: set.format,
		bestOf: set.bestOf,
		games: set.games.map(g => g.roomid),
		me,
		opp: oppEntry ? set.players[oppEntry] : '',
		wins: set.wins,
		score: { me: set.wins[meId] || 0, opp: oppEntry ? set.wins[oppEntry] || 0 : 0 },
		complete: !!winnerId,
		forfeit,
		missing: set.missing,
		result: winnerId ? (winnerId === meId ? 'win' : 'loss') : null,
		ratingBefore: rating ? rating.before : null,
		ratingAfter: rating ? rating.after : null,
		ratingDelta: rating ? rating.delta : null,
		ts: Math.min(...set.games.map(g => g.ts).filter(Number.isFinite)),
	};
}
