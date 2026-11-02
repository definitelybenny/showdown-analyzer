// Group parsed games into best-of sets by the wrapper room id found in each game's `bestof` header.
import { toID } from './names.js';
import { SIDES } from './schema.js';

/** Winner id of a single game (null for tie / incomplete / unknown). */
export function gameWinnerId(game) {
	if (!game.winner || !game.winner.side) return null;
	const p = game.players[game.winner.side];
	return p ? p.id : null;
}

/**
 * Set rating change from the last game that carries rating lines (they arrive after the set ends).
 * @returns {null | {[playerId]: {name, before, after, delta}}}
 */
export function setRatings(games) {
	for (let i = games.length - 1; i >= 0; i--) {
		const g = games[i];
		const out = {};
		let any = false;
		for (const side of SIDES) {
			const r = g.ratings[side];
			if (!r) continue;
			any = true;
			out[toID(r.name)] = { name: r.name, before: r.before, after: r.after, delta: r.after - r.before };
		}
		if (any) return out;
	}
	return null;
}

/**
 * Group parsed games by wrapper id. Games without a `bo3` header are returned in `singles`.
 * Duplicate games (same `meta.id`, or same wrapper + game number) are dropped.
 * @param {object[]} games parsed games (parseLog output; `meta.id` is used for dedupe when present)
 * @param {{me?: string}} [opts] with `me`, each set carries `result` ('win'|'loss'|null) from that player's view
 * @returns {{sets: object[], singles: object[]}}
 */
export function groupSets(games, opts) {
	const meId = toID(opts && opts.me);
	const byWrapper = new Map();
	const singles = [];
	const seen = new Set();
	for (const game of games || []) {
		if (!game || !game.bo3) {
			if (game) singles.push(game);
			continue;
		}
		const key = (game.meta && game.meta.id) || `${game.bo3.wrapperId}#${game.bo3.gameNumber}`;
		if (seen.has(key)) continue;
		seen.add(key);
		if (!byWrapper.has(game.bo3.wrapperId)) byWrapper.set(game.bo3.wrapperId, []);
		byWrapper.get(game.bo3.wrapperId).push(game);
	}

	const sets = [];
	for (const [id, list] of byWrapper) {
		list.sort((a, b) => a.bo3.gameNumber - b.bo3.gameNumber);
		const bestOf = list[0].bo3.bestOf;
		const need = Math.floor(bestOf / 2) + 1;
		const players = {};
		const wins = {};
		for (const g of list) {
			for (const s of SIDES) {
				const p = g.players[s];
				if (p) {
					players[p.id] = p.name;
					if (!(p.id in wins)) wins[p.id] = 0;
				}
			}
			const w = gameWinnerId(g);
			if (w) wins[w]++;
		}
		const winnerId = Object.keys(wins).find(pid => wins[pid] >= need) || null;
		const numbers = list.map(g => g.bo3.gameNumber);
		const missing = [];
		for (let n = 1; n <= Math.max(...numbers); n++) if (!numbers.includes(n)) missing.push(n);
		sets.push({
			id,
			bestOf,
			format: list[0].format,
			players,
			games: list,
			wins,
			winnerId,
			complete: !!winnerId,
			missing,
			ratings: setRatings(list),
			result: meId && winnerId ? (winnerId === meId ? 'win' : 'loss') : null,
		});
	}
	return { sets, singles };
}
