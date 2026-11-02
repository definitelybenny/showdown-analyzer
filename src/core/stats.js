// Pure statistics over stored game records (parsed game + perspective fields side/opp/result, ts, setId, gameNumber).
// No DOM, no globals. Species are keyed with the analytics key (Mega/battle formes collapsed); display formes are
// kept separately where the UI needs them.
//
// Definitions (the UI and the tests share these):
//  - decided game: result is 'win' or 'loss' and the game is not flagged `partial`. Win rates and every
//    usage/lead/matchup count use decided games only. Ties/unfinished games are ignored (counted in `summary.other`).
//  - my usage:   on = Pokemon on my 6, brought = in my picks, lead = in my leads, mega/tera = in my mega/tera lists.
//                `broughtPct` = brought / on, `leadPct` = lead / brought, `megaPct` = mega / brought.
//                Win% columns are wins / games for that subset.
//  - opposing:   on = in the opponent roster, brought = in the opponent picks, attendance = brought / on,
//                against = decided games where it was on their roster, win% = my wins in those games.
//  - win rate intervals use the Wilson score interval (z = 1.96).
import { makeNamer, toID } from './names.js';

const defaultNamer = makeNamer();
export const keyOf = sp => defaultNamer.analyticsKey(sp);

export const DEFAULT_MIN_SAMPLE = 5;
export const DEFAULT_MIN_MATCHUP = 3;

/** Wilson score interval for w successes in n trials. Returns {p, lo, hi} (all 0 when n = 0). */
export function wilson(w, n, z = 1.96) {
	if (!n) return { p: 0, lo: 0, hi: 0 };
	const p = w / n;
	const z2 = z * z;
	const denom = 1 + z2 / n;
	const centre = (p + z2 / (2 * n)) / denom;
	const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
	return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export const isDecided = g => !!g && (g.result === 'win' || g.result === 'loss') && !g.partial;

/** {w, l, n, rate, lo, hi} for a list of games (only decided games count). */
export function record(games) {
	let w = 0;
	let l = 0;
	for (const g of games || []) {
		if (!isDecided(g)) continue;
		if (g.result === 'win') w++;
		else l++;
	}
	return rec(w, l);
}

function rec(w, l) {
	const n = w + l;
	const iv = wilson(w, n);
	return { w, l, n, rate: n ? w / n : null, lo: iv.lo, hi: iv.hi };
}

const side = g => g.side || 'p1';
const oppSide = g => g.opp || (side(g) === 'p1' ? 'p2' : 'p1');
const keys = list => [...new Set((list || []).map(x => keyOf(typeof x === 'string' ? x : x.species)))];

/** Key of my team in a game: sorted analytics keys of my roster. */
export function teamKey(g) {
	return keys((g.roster && g.roster[side(g)]) || []).sort().join('/');
}

/** Distinct "my teams" seen: [{key, species[], games, w, l, lastTs}] newest first. */
export function listTeams(games) {
	const m = new Map();
	for (const g of games || []) {
		const k = teamKey(g);
		if (!k) continue;
		let t = m.get(k);
		if (!t) m.set(k, (t = { key: k, species: k.split('/'), games: 0, w: 0, l: 0, lastTs: 0 }));
		t.games++;
		if (g.result === 'win') t.w++;
		else if (g.result === 'loss') t.l++;
		t.lastTs = Math.max(t.lastTs, g.ts || 0);
	}
	return [...m.values()].sort((a, b) => b.lastTs - a.lastTs);
}

/**
 * Pure filter. f: {result: 'win'|'loss'|'tie', format, from, to (ms), team (teamKey), opp (species or species[]),
 * bo3Only, reviewed, setId}. Bo3 means the game carries a bo3 header (never the format id).
 */
export function filterGames(games, f) {
	const q = f || {};
	const opps = q.opp ? (Array.isArray(q.opp) ? q.opp : [q.opp]).map(keyOf) : [];
	return (games || []).filter(g => {
		if (q.result && g.result !== q.result) return false;
		if (q.format && g.format !== q.format) return false;
		if (q.from && !(g.ts >= q.from)) return false;
		if (q.to && !(g.ts <= q.to)) return false;
		if (q.bo3Only && !g.bo3) return false;
		if (q.reviewed !== undefined && q.reviewed !== null && q.reviewed !== '' && !!g.reviewed !== !!q.reviewed) return false;
		if (q.setId && g.setId !== q.setId) return false;
		if (q.team && teamKey(g) !== q.team) return false;
		if (opps.length) {
			const theirs = keys(g.roster && g.roster[oppSide(g)]);
			if (!opps.every(o => theirs.includes(o))) return false;
		}
		return true;
	});
}

/** Headline numbers: total games, decided record, other (tie/unknown). */
export function summary(games) {
	const r = record(games);
	return { total: (games || []).length, ...r, other: (games || []).length - r.n };
}

/** Distinct formats in the data, most played first: [{format, games}]. */
export function listFormats(games) {
	const m = new Map();
	for (const g of games || []) if (g.format) m.set(g.format, (m.get(g.format) || 0) + 1);
	return [...m].map(([format, n]) => ({ format, games: n })).sort((a, b) => b.games - a.games);
}

function bump(map, k, init) {
	let v = map.get(k);
	if (!v) map.set(k, (v = init()));
	return v;
}

/** Display forme for a species key: first display name seen. */
function nameBook() {
	const m = new Map();
	return { note: (k, name) => { if (!m.has(k)) m.set(k, name); }, get: k => m.get(k) || k };
}

/** Per-Pokemon usage on my side. Rows sorted by brought count, then name. */
export function usage(games) {
	const rows = new Map();
	const names = nameBook();
	const dec = (games || []).filter(isDecided);
	const mk = () => ({
		on: 0, brought: 0, lead: 0, mega: 0, tera: 0,
		onW: 0, broughtW: 0, leadW: 0, megaW: 0, teraW: 0, megaForme: null, teraTypes: {},
	});
	for (const g of dec) {
		const s = side(g);
		const win = g.result === 'win' ? 1 : 0;
		for (const r of g.roster[s] || []) names.note(keyOf(r.species), r.species);
		for (const k of keys(g.roster[s])) {
			const r = bump(rows, k, mk);
			r.on++;
			r.onW += win;
		}
		const sets = { brought: keys(g.picks[s]), lead: keys(g.leads[s]), mega: keys(g.mega[s]), tera: keys(g.tera[s]) };
		for (const [field, list] of Object.entries(sets)) {
			for (const k of list) {
				const r = bump(rows, k, mk);
				r[field]++;
				r[field + 'W'] += win;
			}
		}
		for (const m of g.mega[s] || []) bump(rows, keyOf(m.species), mk).megaForme = m.forme;
		for (const t of g.tera[s] || []) {
			const r = bump(rows, keyOf(t.species), mk);
			r.teraTypes[t.type] = (r.teraTypes[t.type] || 0) + 1;
		}
	}
	const out = [...rows].map(([k, r]) => ({
		key: k,
		species: names.get(k),
		on: r.on,
		brought: r.brought,
		broughtPct: r.on ? r.brought / r.on : null,
		win: rec(r.broughtW, r.brought - r.broughtW),
		lead: r.lead,
		leadPct: r.brought ? r.lead / r.brought : null,
		leadWin: rec(r.leadW, r.lead - r.leadW),
		mega: r.mega,
		megaPct: r.brought ? r.mega / r.brought : null,
		megaWin: rec(r.megaW, r.mega - r.megaW),
		megaForme: r.megaForme,
		tera: r.tera,
		teraPct: r.brought ? r.tera / r.brought : null,
		teraWin: rec(r.teraW, r.tera - r.teraW),
		teraTypes: r.teraTypes,
	}));
	out.sort((a, b) => b.brought - a.brought || b.on - a.on || a.species.localeCompare(b.species));
	return { games: dec.length, rows: out };
}

/** Unordered lead pairs: [{key, pair:[a,b], n, w, l, ...rate}] */
export function leadPairs(games) {
	const m = new Map();
	for (const g of (games || []).filter(isDecided)) {
		const lead = [...new Set((g.leads[side(g)] || []).map(keyOf))];
		if (lead.length < 2) continue;
		const pair = lead.slice(0, 2).sort();
		const r = bump(m, pair.join('/'), () => ({ pair, w: 0, l: 0 }));
		if (g.result === 'win') r.w++;
		else r.l++;
	}
	return [...m].map(([key, r]) => ({ key, pair: r.pair, ...rec(r.w, r.l) }));
}

export const mostCommonLeads = (games, limit = 6) =>
	leadPairs(games).sort((a, b) => b.n - a.n || b.w - a.w).slice(0, limit);

export function bestLeads(games, { minN = 2, limit = 6 } = {}) {
	return leadPairs(games).filter(r => r.n >= minN).sort((a, b) => b.lo - a.lo || b.n - a.n).slice(0, limit);
}

/** Per opposing Pokemon. Rows sorted by games against, then name. */
export function opposing(games) {
	const rows = new Map();
	const names = nameBook();
	const dec = (games || []).filter(isDecided);
	for (const g of dec) {
		const o = oppSide(g);
		const win = g.result === 'win';
		for (const r of g.roster[o] || []) names.note(keyOf(r.species), r.species);
		const brought = new Set(keys(g.picks[o]));
		for (const k of keys(g.roster[o])) {
			const r = bump(rows, k, () => ({ on: 0, brought: 0, w: 0, l: 0, bw: 0, bl: 0 }));
			r.on++;
			if (win) r.w++;
			else r.l++;
			if (brought.has(k)) {
				r.brought++;
				if (win) r.bw++;
				else r.bl++;
			}
		}
	}
	const out = [...rows].map(([k, r]) => ({
		key: k,
		species: names.get(k),
		on: r.on,
		brought: r.brought,
		attendance: r.on ? r.brought / r.on : null,
		against: r.on,
		...rec(r.w, r.l),
		broughtWin: rec(r.bw, r.bl),
	}));
	out.sort((a, b) => b.against - a.against || a.species.localeCompare(b.species));
	return { games: dec.length, rows: out };
}

/**
 * Best / worst matchups among rows with at least minN encounters. Best = highest Wilson lower bound,
 * worst = lowest Wilson upper bound (so a 0-1 record never outranks a 0-6 one).
 */
export function bestWorst(rows, { minN = DEFAULT_MIN_MATCHUP, limit = 5 } = {}) {
	const ok = (rows || []).filter(r => r.n >= minN);
	const best = [...ok].sort((a, b) => b.lo - a.lo || b.n - a.n).slice(0, limit);
	const worst = [...ok].sort((a, b) => a.hi - b.hi || b.n - a.n).slice(0, limit);
	return { best, worst };
}

/** Highest / lowest attendance (brought / on team) among rows with at least minN games on the opposing team. */
export function attendanceRanks(rows, { minN = DEFAULT_MIN_MATCHUP, limit = 5 } = {}) {
	const ok = (rows || []).filter(r => r.on >= minN);
	return {
		high: [...ok].sort((a, b) => b.attendance - a.attendance || b.on - a.on).slice(0, limit),
		low: [...ok].sort((a, b) => a.attendance - b.attendance || b.on - a.on).slice(0, limit),
	};
}

/**
 * Custom query: 1-6 opposing Pokemon. Returns a per-slot record plus `all` (games where the opponent had every
 * selected Pokemon on their team) and `mean` (plain mean of the slot win rates that have data).
 */
export function customQuery(games, speciesList) {
	const list = [...new Set((speciesList || []).map(keyOf))];
	const dec = (games || []).filter(isDecided);
	const slots = list.map(k => {
		const hit = dec.filter(g => keys(g.roster[oppSide(g)]).includes(k));
		return { key: k, ...record(hit) };
	});
	const hitAll = list.length ? dec.filter(g => { const t = keys(g.roster[oppSide(g)]); return list.every(k => t.includes(k)); }) : [];
	const withData = slots.filter(s => s.n);
	return {
		slots,
		all: list.length ? record(hitAll) : null,
		mean: withData.length ? withData.reduce((a, s) => a + s.rate, 0) / withData.length : null,
	};
}

/**
 * Move usage per Pokemon. who: 'me' | 'opp'. For each species: games seen, per move {move, count, games, inSet}
 * where inSet is true/false when an open team sheet was available for that species, otherwise null.
 */
export function moveUsage(games, who = 'me') {
	const rows = new Map();
	const names = nameBook();
	for (const g of (games || []).filter(g => g.result === 'win' || g.result === 'loss')) {
		const s = who === 'opp' ? oppSide(g) : side(g);
		const sheet = new Map();
		for (const t of (g.teams && g.teams[s]) || []) sheet.set(keyOf(t.species), new Set((t.moves || []).map(toID)));
		for (const [sp, mv] of Object.entries((g.moves && g.moves[s]) || {})) {
			const k = keyOf(sp);
			names.note(k, sp);
			const r = bump(rows, k, () => ({ games: 0, sheetGames: 0, moves: new Map(), setMoves: new Set() }));
			r.games++;
			const set = sheet.get(k);
			if (set) {
				r.sheetGames++;
				set.forEach(x => r.setMoves.add(x));
			}
			for (const [move, n] of Object.entries(mv)) {
				const m = bump(r.moves, move, () => ({ move, count: 0, games: 0 }));
				m.count += n;
				m.games++;
			}
		}
	}
	const out = [...rows].map(([k, r]) => {
		const moves = [...r.moves.values()].map(m => ({
			...m,
			inSet: r.sheetGames ? r.setMoves.has(toID(m.move)) : null,
		}));
		moves.sort((a, b) => b.count - a.count || a.move.localeCompare(b.move));
		const total = moves.reduce((a, m) => a + m.count, 0);
		return { key: k, species: names.get(k), games: r.games, sheetGames: r.sheetGames, total, moves: moves.map(m => ({ ...m, pct: total ? m.count / total : 0 })) };
	});
	out.sort((a, b) => b.games - a.games || a.species.localeCompare(b.species));
	return out;
}

/**
 * Group stored games into sets by `setId`. Each set: {id, format, ts, games (by gameNumber), wins, losses,
 * result ('win'|'loss'|null), complete, bestOf, missing[], ratingBefore/After/Delta (from my rating lines)}.
 * Result comes from the per-game results (the perspective can differ between games).
 */
export function buildSets(games) {
	const m = new Map();
	for (const g of games || []) {
		if (!g.setId) continue;
		bump(m, g.setId, () => []).push(g);
	}
	const out = [];
	for (const [id, list] of m) {
		list.sort((a, b) => (a.gameNumber || 0) - (b.gameNumber || 0));
		const bestOf = (list[0].bo3 && list[0].bo3.bestOf) || 3;
		const need = Math.floor(bestOf / 2) + 1;
		const wins = list.filter(g => g.result === 'win').length;
		const losses = list.filter(g => g.result === 'loss').length;
		const nums = list.map(g => g.gameNumber || 0);
		const missing = [];
		for (let n = 1; n <= Math.max(...nums); n++) if (!nums.includes(n)) missing.push(n);
		let rating = null;
		for (let i = list.length - 1; i >= 0 && !rating; i--) {
			const g = list[i];
			const r = g.ratings && g.ratings[side(g)];
			if (r && typeof r.before === 'number' && typeof r.after === 'number') rating = r;
		}
		out.push({
			id,
			format: list[0].format,
			ts: Math.max(...list.map(g => g.ts || 0)),
			opp: (list[0].players && list[0].players[oppSide(list[0])] && list[0].players[oppSide(list[0])].name) || '',
			games: list,
			bestOf,
			wins,
			losses,
			result: wins >= need ? 'win' : losses >= need ? 'loss' : null,
			complete: wins >= need || losses >= need,
			missing,
			ratingBefore: rating ? rating.before : null,
			ratingAfter: rating ? rating.after : null,
			ratingDelta: rating ? rating.after - rating.before : null,
		});
	}
	return out.sort((a, b) => b.ts - a.ts);
}
