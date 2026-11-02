// Streaming battle-log parser. Pure: no DOM, no globals. Never throws on malformed or truncated input.
import { PARSER_VERSION, SIDES, newParsedGame } from './schema.js';
import { toID, makeNamer, isMegaForme, stripMega, isWildcard } from './names.js';
import { unpackTeam } from './teams.js';

const RATING_RE = /^(.+?)'s rating: (\d+) &rarr; <strong>(\d+)<\/strong>/;
const SLOT_LETTERS = 'abcd';

function unescapeHtml(text) {
	return String(text)
		.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
		.replace(/&#0?39;|&apos;/g, "'").replace(/&#x2f;/gi, '/').replace(/&amp;/g, '&');
}

/** `p1a: Nick` / `p1: Nick` -> {side, slot, nick}; null for sides we do not track (p3/p4). */
export function parseIdent(ident) {
	const m = /^(p[1-4])([a-d])?: ?(.*)$/.exec(String(ident || ''));
	if (!m || (m[1] !== 'p1' && m[1] !== 'p2')) return null;
	return { side: m[1], slot: m[2] || '', nick: m[3] };
}

/** `Species, L50, M, shiny, tera:Fire` -> fields. */
export function parseDetails(details) {
	const parts = String(details || '').split(',').map(s => s.trim());
	const out = { species: parts[0] || '', level: 100, gender: '', shiny: false, tera: '' };
	for (const p of parts.slice(1)) {
		let m;
		if ((m = /^L(\d+)$/.exec(p))) out.level = Number(m[1]);
		else if (p === 'M' || p === 'F') out.gender = p;
		else if (p === 'shiny') out.shiny = true;
		else if ((m = /^tera:(.+)$/.exec(p))) out.tera = m[1];
	}
	return out;
}

export class LogParser {
	/** @param {{dex?: object}} [opts] dex: anything with `species.get(name)` (client Dex, @pkmn/dex). */
	constructor(opts) {
		this.dex = (opts && opts.dex) || null;
		this.namer = makeNamer(this.dex);
		this.g = newParsedGame();
		this.started = false;
		this.pendingEnd = null;
		this.scoreHtml = null;
		this.resetSides();
	}

	/** Per-side battle state (slot/nickname maps, appearances); rebuilt when the preview restarts. */
	resetSides() {
		this.st = {};
		for (const s of SIDES) {
			this.st[s] = {
				slots: {},          // slot letter -> roster index currently on the field
				nickMap: new Map(), // nickname -> roster index (latest switch-in)
				nickOf: [],         // roster index -> nickname
				appear: [],         // [{idx, slot, lead}] in switch-in order (illusion-corrected)
				mega: new Map(),    // roster index -> {forme, stone}
				tera: new Map(),    // roster index -> type
			};
		}
	}

	/** Feed one protocol line (or a block of lines). */
	feed(line) {
		if (typeof line !== 'string') return;
		if (line.indexOf('\n') >= 0) {
			for (const l of line.split('\n')) this.feed(l);
			return;
		}
		if (line.charAt(0) !== '|') return;
		try {
			this.handle(line.replace(/\r$/, '').slice(1).split('|'));
		} catch (e) {
			this.g.warnings.push(`line failed: ${line.slice(0, 80)} (${e && e.message})`);
		}
	}

	sideOfName(name) {
		const id = toID(name);
		if (!id) return null;
		for (const s of SIDES) if (this.g.players[s] && this.g.players[s].id === id) return s;
		return null;
	}

	// ---- roster resolution ---------------------------------------------------

	/** Find the roster entry for `species`: exact, wildcard, dex number, base species. */
	match(side, species, claimed) {
		const roster = this.g.roster[side];
		const free = i => !claimed || !claimed.has(i);
		const id = toID(species);
		const n = this.namer;
		for (let i = 0; i < roster.length; i++) if (free(i) && toID(roster[i].species) === id) return i;
		const base = toID(n.baseSpecies(species));
		for (let i = 0; i < roster.length; i++) {
			if (free(i) && isWildcard(roster[i].species) && toID(n.baseSpecies(roster[i].species)) === base) return i;
		}
		const num = n.dexNum(species);
		if (num) {
			for (let i = 0; i < roster.length; i++) {
				if (free(i) && !isWildcard(roster[i].species) && n.dexNum(roster[i].species) === num) return i;
			}
		}
		const key = toID(n.analyticsKey(species));
		for (let i = 0; i < roster.length; i++) {
			if (!free(i) || isWildcard(roster[i].species)) continue;
			if (toID(n.analyticsKey(roster[i].species)) === key || toID(n.baseSpecies(roster[i].species)) === base) return i;
		}
		return -1;
	}

	/** Roster index for a species seen in battle, adding an inferred entry when it is not in the preview. */
	entryFor(side, species, details) {
		const name = stripMega(species);
		let idx = this.match(side, name);
		const roster = this.g.roster[side];
		if (idx < 0) {
			const d = details || {};
			roster.push({ species: name, level: d.level || 100, gender: d.gender || '', shiny: !!d.shiny, uncertain: false, inferred: true });
			return roster.length - 1;
		}
		const e = roster[idx];
		const crowned = /-Crowned$/.test(name) && /^(zacian|zamazenta)$/.test(toID(e.species));
		if (isWildcard(e.species) || crowned) {
			e.species = name;
			e.uncertain = false;
		}
		return idx;
	}

	identIdx(ident) {
		const p = parseIdent(ident);
		if (!p) return null;
		const s = this.st[p.side];
		const si = p.slot ? s.slots[p.slot] : undefined;
		let idx = -1;
		if (si != null && s.nickOf[si] === p.nick) idx = si;
		else if (s.nickMap.has(p.nick)) idx = s.nickMap.get(p.nick);
		else if (si != null) idx = si;
		return idx < 0 ? null : { side: p.side, idx };
	}

	speciesOf(side, idx) {
		return this.g.roster[side][idx].species;
	}

	// ---- line handlers -------------------------------------------------------

	handle(a) {
		const g = this.g;
		switch (a[0]) {
			case 'player': {
				const side = a[1];
				if (side !== 'p1' && side !== 'p2') return;
				if (a[2]) {
					const prev = g.players[side];
					g.players[side] = { name: a[2], id: toID(a[2]), avatar: a[3] || (prev && prev.avatar) || '', rating: prev ? prev.rating : null };
				}
				if (g.players[side] && /^\d+$/.test(a[4] || '') && g.players[side].rating == null) g.players[side].rating = Number(a[4]);
				return;
			}
			case 'teamsize':
				if (a[1] === 'p1' || a[1] === 'p2') g.teamSize[a[1]] = Number(a[2]) || 0;
				return;
			case 'gametype': g.gametype = a[1] || ''; return;
			case 'gen': g.gen = Number(a[1]) || 0; return;
			case 'tier': g.format = a.slice(1).join('|'); return;
			case 'rated': g.rated = true; return;
			case 'clearpoke':
				if (!this.started) {
					for (const s of SIDES) g.roster[s] = [];
					this.resetSides();
				}
				return;
			case 'poke': {
				if (a[1] !== 'p1' && a[1] !== 'p2') return;
				const d = parseDetails(a[2]);
				if (!d.species) return;
				g.roster[a[1]].push({ species: d.species, level: d.level, gender: d.gender, shiny: d.shiny, uncertain: isWildcard(d.species), inferred: false });
				return;
			}
			case 'showteam': return this.showteam(a[1], a.slice(2).join('|'));
			case 'start': this.started = true; return;
			case 'switch':
			case 'drag':
			case 'replace': return this.switchIn(a[0], a[1], a[2]);
			case 'detailschange': return this.detailsChange(a[1], a[2]);
			case '-mega': return this.noteMega(a[1], null, a[3]);
			case '-terastallize': {
				const r = this.identIdx(a[1]);
				if (r) this.st[r.side].tera.set(r.idx, a[2] || '');
				return;
			}
			case 'swap': return this.swap(a[1], Number(a[2]));
			case 'move': return this.move(a[1], a[2], a.slice(4));
			case 'turn': g.turns = Math.max(g.turns, Number(a[1]) || 0); return;
			case '-message': return this.message(a.slice(1).join('|'));
			case 'win': {
				g.complete = true;
				const side = this.sideOfName(a[1]);
				g.winner = { side, name: a.slice(1).join('|') };
				g.end = this.pendingEnd || 'win';
				return;
			}
			case 'tie':
				g.complete = true;
				g.tie = true;
				g.end = 'tie';
				return;
			case 'raw': return this.raw(a.slice(1).join('|'));
			case 'html':
				if (a[1] && a[1].indexOf('<table width="100%">') === 0) this.scoreHtml = a.slice(1).join('|');
				return;
			case 'uhtml':
				if (a[1] === 'bestof') this.bestOf(a.slice(2).join('|'));
				return;
			default:
		}
	}

	showteam(side, packed) {
		if (side !== 'p1' && side !== 'p2') return;
		const sets = unpackTeam(packed, this.dex);
		if (!sets.length) return;
		const roster = this.g.roster[side];
		const hadRoster = roster.length > 0;
		const claimed = new Set();
		this.g.teams[side] = sets.map(set => {
			let idx = this.match(side, set.species, claimed);
			if (idx < 0) {
				roster.push({ species: set.species, level: set.level, gender: set.gender, shiny: set.shiny, uncertain: false, inferred: hadRoster });
				idx = roster.length - 1;
			} else {
				roster[idx].species = set.species;
				roster[idx].uncertain = false;
			}
			claimed.add(idx);
			const out = { species: set.species, item: set.item, ability: set.ability, moves: set.moves, nature: set.nature, gender: set.gender, level: set.level };
			if (set.evs) out.evs = set.evs;
			if (set.ivs) out.ivs = set.ivs;
			if (set.teraType) out.teraType = set.teraType;
			return out;
		});
	}

	switchIn(kind, ident, details) {
		const p = parseIdent(ident);
		if (!p) return;
		const d = parseDetails(details);
		if (!d.species) return;
		const s = this.st[p.side];
		const idx = this.entryFor(p.side, d.species, d);
		if (p.slot) s.slots[p.slot] = idx;
		s.nickMap.set(p.nick, idx);
		s.nickOf[idx] = p.nick;
		if (isMegaForme(d.species)) this.setMega(p.side, idx, d.species, null);
		if (kind === 'replace') {
			// Illusion reveal: the disguise's appearance was really this Pokemon.
			for (let i = s.appear.length - 1; i >= 0; i--) {
				if (s.appear[i].slot === p.slot && p.slot) {
					s.appear[i].idx = idx;
					return;
				}
			}
			s.appear.push({ idx, slot: p.slot, lead: false });
			return;
		}
		s.appear.push({ idx, slot: p.slot, lead: kind === 'switch' });
	}

	detailsChange(ident, details) {
		const r = this.identIdx(ident);
		const d = parseDetails(details);
		if (!r || !d.species) return;
		if (isMegaForme(d.species)) this.setMega(r.side, r.idx, d.species, null);
		else if (isWildcard(this.speciesOf(r.side, r.idx))) this.entryFor(r.side, d.species, d);
	}

	setMega(side, idx, forme, stone) {
		const m = this.st[side].mega;
		const cur = m.get(idx) || { forme: null, stone: null };
		if (forme) cur.forme = forme;
		if (stone) cur.stone = stone;
		m.set(idx, cur);
	}

	noteMega(ident, forme, stone) {
		const r = this.identIdx(ident);
		if (r) this.setMega(r.side, r.idx, forme, stone);
	}

	swap(ident, pos) {
		const r = this.identIdx(ident);
		const p = parseIdent(ident);
		if (!r || !p || !p.slot || !(pos >= 0 && pos < 4)) return;
		const slots = this.st[r.side].slots;
		const to = SLOT_LETTERS.charAt(pos);
		const other = slots[to];
		slots[to] = r.idx;
		if (other != null) slots[p.slot] = other;
		else delete slots[p.slot];
	}

	move(ident, move, rest) {
		if (!move || rest.some(x => x.indexOf('[from]') === 0)) return;
		const r = this.identIdx(ident);
		if (!r) return;
		const bySpecies = this.g.moves[r.side];
		const species = this.speciesOf(r.side, r.idx);
		const m = bySpecies[species] || (bySpecies[species] = {});
		m[move] = (m[move] || 0) + 1;
	}

	message(text) {
		let m;
		if ((m = /^(.+) forfeited\.$/.exec(text))) {
			this.pendingEnd = 'forfeit';
			this.g.forfeiter = this.sideOfName(m[1]);
		} else if ((m = /^(.+) lost due to inactivity\.$/.exec(text))) {
			if (!this.pendingEnd) {
				this.pendingEnd = 'inactivity';
				this.g.forfeiter = this.sideOfName(m[1]);
			}
		}
	}

	raw(html) {
		const m = RATING_RE.exec(html);
		if (!m) return;
		const name = unescapeHtml(m[1]);
		const side = this.sideOfName(name);
		if (side) this.g.ratings[side] = { name, before: Number(m[2]), after: Number(m[3]) };
	}

	bestOf(html) {
		const game = /Game (\d+)/.exec(html);
		const href = /href="\/(game-bestof(\d+)-[^"]+)"/.exec(html);
		if (!game || !href) return;
		this.g.bo3 = { bestOf: Number(href[2]), wrapperId: href[1], gameNumber: Number(game[1]), score: null };
	}

	// ---- output --------------------------------------------------------------

	/** Build the parsed game. Safe to call repeatedly (and to keep feeding afterwards). */
	finalize() {
		const g = this.g;
		const out = JSON.parse(JSON.stringify(g));
		out.parserVersion = PARSER_VERSION;
		out.end = g.complete ? g.end : 'incomplete';
		for (const side of SIDES) {
			const s = this.st[side];
			const roster = g.roster[side];
			const seen = new Set();
			const picks = [];
			const leads = [];
			const leadIdx = new Set();
			for (const ap of s.appear) {
				if (!seen.has(ap.idx)) {
					seen.add(ap.idx);
					picks.push(roster[ap.idx].species);
				}
				if (ap.lead && leads.length < 2 && !leadIdx.has(ap.idx)) {
					leadIdx.add(ap.idx);
					leads.push(roster[ap.idx].species);
				}
			}
			out.picks[side] = picks;
			out.leads[side] = leads;
			out.mega[side] = [...s.mega].map(([idx, m]) => ({ species: roster[idx].species, forme: m.forme, stone: m.stone }));
			out.tera[side] = [...s.tera].map(([idx, type]) => ({ species: roster[idx].species, type }));
			out.roster[side] = roster.filter((e, i) => !e.inferred || seen.has(i)).map(e => ({ ...e }));
			out.moves[side] = JSON.parse(JSON.stringify(g.moves[side]));
		}
		if (g.bo3 && this.scoreHtml) out.bo3.score = this.score();
		return out;
	}

	/** Series score before this game from the `|html|` circle table (null if unreadable). */
	score() {
		const m = /<td align="left">(.*?)<\/td><td align="right">(.*?)<\/tr><tr><td align="left">(.*?)<\/td><td align="right">(.*?)<\/tr>/.exec(this.scoreHtml);
		if (!m) return null;
		const wins = html => (html.match(/fa fa-circle"/g) || []).length;
		const score = { p1: null, p2: null };
		const left = this.sideOfName(m[1]);
		const right = this.sideOfName(m[2]);
		if (!left || !right || left === right) return null;
		score[left] = wins(m[3]);
		score[right] = wins(m[4]);
		return score;
	}
}

function rosterKeys(game, side) {
	const list = game.teams[side].length ? game.teams[side] : game.roster[side];
	return list.map(e => e.species);
}

/** Does a revealed roster (species strings) fit inside `myRoster` (species strings)? Wildcards match by base. */
function rosterFits(revealed, myRoster, namer) {
	if (!revealed.length || revealed.length > myRoster.length) return false;
	const used = new Set();
	return revealed.every(sp => {
		const i = myRoster.findIndex((mine, j) => {
			if (used.has(j)) return false;
			if (isWildcard(sp)) return toID(namer.baseSpecies(sp)) === toID(namer.baseSpecies(mine));
			return toID(namer.analyticsKey(sp)) === toID(namer.analyticsKey(mine));
		});
		if (i < 0) return false;
		used.add(i);
		return true;
	});
}

/**
 * Which side is "mine"? Cascade (RESEARCH 7.6): one username match AND roster match; one username match;
 * one roster match; default p1. `myRoster` is an optional array of species strings.
 * @returns {{side: 'p1'|'p2', via: string}}
 */
export function resolveSide(game, opts) {
	const { me, myRoster, dex } = opts || {};
	const namer = makeNamer(dex);
	const meId = toID(me);
	const nameSides = meId ? SIDES.filter(s => game.players[s] && game.players[s].id === meId) : [];
	const teamSides = myRoster && myRoster.length ? SIDES.filter(s => rosterFits(rosterKeys(game, s), myRoster, namer)) : [];
	if (nameSides.length === 1 && teamSides.indexOf(nameSides[0]) >= 0) return { side: nameSides[0], via: 'name+team' };
	if (nameSides.length === 1) return { side: nameSides[0], via: 'name' };
	if (teamSides.length === 1) return { side: teamSides[0], via: 'team' };
	return { side: 'p1', via: 'default' };
}

/**
 * Parse a whole log. `lines` is an array of protocol lines or one newline-separated string.
 * opts: {me, myRoster, dex, meta}. With `me` or `myRoster` the result carries the perspective fields.
 */
export function parseLog(lines, opts) {
	const o = opts || {};
	const p = new LogParser({ dex: o.dex });
	p.feed(Array.isArray(lines) ? lines.join('\n') : lines);
	const game = p.finalize();
	if (o.meta) game.meta = o.meta;
	if (o.me || (o.myRoster && o.myRoster.length)) {
		const { side, via } = resolveSide(game, o);
		const opp = side === 'p1' ? 'p2' : 'p1';
		game.me = o.me || (game.players[side] && game.players[side].name) || '';
		game.side = side;
		game.opp = opp;
		game.sideVia = via;
		game.result = game.tie ? 'tie' : game.winner && game.winner.side ? (game.winner.side === side ? 'win' : 'loss') : null;
	}
	return game;
}
