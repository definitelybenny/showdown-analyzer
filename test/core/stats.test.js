import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLog } from '../../src/core/parser.js';
import { gameRecordFromParsed } from '../../src/store/repo.js';
import {
	wilson, record, filterGames, summary, usage, leadPairs, mostCommonLeads, bestLeads, opposing, bestWorst,
	attendanceRanks, customQuery, moveUsage, buildSets, listTeams, listFormats, teamKey, isDecided,
} from '../../src/core/stats.js';
import { fixtureIds, loadFixture, Dex } from '../helpers.js';

// Set A: ReanSchwarzer_VGC went W, L, W. Set B: Unskilled99 went W, L, L (game 2 ended by forfeit).
const A = ['2708057022', '2708057976', '2708058877'];
const B = ['2708081183', '2708082078', '2708082934'];
const load = (n, who, ts) => {
	const id = fixtureIds().find(i => i.endsWith(n));
	const f = loadFixture(id);
	return { ...gameRecordFromParsed(parseLog(f.log, { me: who, dex: Dex }), { roomid: 'battle-' + id, ts }), };
};
const gamesA = A.map((n, i) => load(n, 'ReanSchwarzer_VGC', 1000 + i));
const gamesB = B.map((n, i) => load(n, 'Unskilled99', 2000 + i));
const all = [...gamesA, ...gamesB];
const row = (rows, k) => rows.find(r => r.key === k);

test('wilson interval', () => {
	assert.deepEqual(wilson(0, 0), { p: 0, lo: 0, hi: 0 });
	const w = wilson(8, 10);
	assert.ok(Math.abs(w.lo - 0.4902) < 0.001 && Math.abs(w.hi - 0.9433) < 0.001, JSON.stringify(w));
	assert.equal(wilson(5, 5).hi, 1);
	assert.ok(wilson(5, 5).lo < 0.6);
});

test('record and summary count decided games only', () => {
	assert.deepEqual([record(gamesA).w, record(gamesA).l, record(gamesA).n], [2, 1, 3]);
	assert.equal(record(all).rate, 0.5);
	const tie = { ...gamesA[0], result: 'tie' };
	const partial = { ...gamesA[0], partial: true };
	assert.equal(isDecided(tie), false);
	const s = summary([...gamesA, tie, partial]);
	assert.deepEqual([s.total, s.n, s.other], [5, 3, 2]);
});

test('usage for set A matches hand counts', () => {
	const u = usage(gamesA);
	assert.equal(u.games, 3);
	const st = row(u.rows, 'Staraptor');
	assert.deepEqual([st.on, st.brought, st.lead, st.mega], [3, 3, 3, 3]);
	assert.deepEqual([st.win.w, st.win.l, st.leadWin.w, st.leadWin.l, st.megaWin.w], [2, 1, 2, 1, 2]);
	assert.equal(st.megaForme, 'Staraptor-Mega');
	const sin = row(u.rows, 'Sinistcha');
	assert.deepEqual([sin.brought, sin.win.w, sin.win.l, sin.lead], [2, 1, 1, 0]);
	assert.equal(sin.brought / sin.on, sin.broughtPct);
	assert.equal(u.rows[0].brought, 3); // sorted by brought
});

test('lead pairs', () => {
	const pairs = leadPairs(gamesA);
	assert.equal(pairs.length, 1);
	assert.deepEqual([pairs[0].pair, pairs[0].n, pairs[0].w, pairs[0].l], [['Gholdengo', 'Staraptor'], 3, 2, 1]);
	// set B: Sneasler+Rillaboom led all 3 games, record 1-2
	const b = mostCommonLeads(gamesB);
	assert.deepEqual([b[0].pair, b[0].n, b[0].w], [['Rillaboom', 'Sneasler'], 3, 1]);
	assert.equal(bestLeads(gamesB, { minN: 4 }).length, 0);
});

test('opposing stats against set B', () => {
	const o = opposing(gamesB);
	assert.equal(o.games, 3);
	const g = row(o.rows, 'Garchomp');
	assert.deepEqual([g.on, g.against, g.w, g.l], [3, 3, 1, 2]);
	assert.ok(g.brought >= 0 && g.brought <= 3);
	assert.equal(g.attendance, g.brought / 3);
	assert.equal(o.rows.length, 6);
});

test('best/worst respect the minimum sample and Wilson ordering', () => {
	const rows = [
		{ key: 'a', n: 10, w: 8, lo: wilson(8, 10).lo, hi: wilson(8, 10).hi },
		{ key: 'b', n: 2, w: 2, lo: wilson(2, 2).lo, hi: wilson(2, 2).hi },
		{ key: 'c', n: 10, w: 1, lo: wilson(1, 10).lo, hi: wilson(1, 10).hi },
		{ key: 'd', n: 3, w: 0, lo: wilson(0, 3).lo, hi: wilson(0, 3).hi },
	];
	const { best, worst } = bestWorst(rows, { minN: 3 });
	assert.deepEqual(best.map(r => r.key), ['a', 'c', 'd']);
	assert.deepEqual(worst.map(r => r.key), ['c', 'd', 'a']);
	assert.equal(attendanceRanks(opposing(all).rows, { minN: 100 }).high.length, 0);
});

test('custom query combines slots', () => {
	const q = customQuery(gamesB, ['Garchomp', 'Rillaboom']);
	assert.deepEqual(q.slots.map(s => [s.key, s.n, s.w]), [['Garchomp', 3, 1], ['Rillaboom', 3, 1]]);
	assert.deepEqual([q.all.n, q.all.w], [3, 1]);
	assert.ok(Math.abs(q.mean - 1 / 3) < 1e-9);
	const none = customQuery(gamesB, ['Garchomp', 'Pikachu']);
	assert.equal(none.all.n, 0);
	assert.equal(customQuery(gamesB, []).all, null);
});

test('filters', () => {
	assert.equal(filterGames(all, { result: 'win' }).length, 3);
	assert.equal(filterGames(all, { opp: 'Rillaboom' }).length, 3);
	assert.equal(filterGames(all, { opp: ['Garchomp', 'Rillaboom'] }).length, 3);
	assert.equal(filterGames(all, { opp: ['Garchomp', 'Golisopod'] }).length, 0);
	assert.equal(filterGames(all, { from: 2000 }).length, 3);
	assert.equal(filterGames(all, { to: 1002 }).length, 3);
	assert.equal(filterGames(all, { bo3Only: true }).length, 6);
	assert.equal(filterGames([{ ...gamesA[0], bo3: null }], { bo3Only: true }).length, 0);
	assert.equal(filterGames(all, { team: teamKey(gamesA[0]) }).length, 3);
	assert.equal(filterGames(all, { format: 'nope' }).length, 0);
	assert.equal(filterGames(all, {}).length, 6);
	assert.equal(filterGames(all, { reviewed: false }).length, 6);
	const teams = listTeams(all);
	assert.equal(teams.length, 2);
	assert.deepEqual([teams[0].games, teams[0].w, teams[0].l], [3, 1, 2]); // newest first = set B
	assert.equal(listFormats(all).reduce((a, f) => a + f.games, 0), 6);
});

test('buildSets: results, missing games, rating delta', () => {
	const sets = buildSets(all);
	assert.equal(sets.length, 2);
	const b = sets[0];
	assert.deepEqual([b.wins, b.losses, b.result, b.complete, b.games.length, b.missing], [1, 2, 'loss', true, 3, []]);
	assert.deepEqual([b.ratingBefore, b.ratingAfter, b.ratingDelta], [1318, 1289, -29]);
	const a = sets[1];
	assert.deepEqual([a.result, a.ratingDelta, a.opp], ['win', 27, 'malucodetilambuco']);
	const partial = buildSets([gamesA[1], gamesA[2]])[0];
	assert.deepEqual([partial.missing, partial.complete, partial.result], [[1], false, null]);
});

test('moveUsage compares against the open team sheet', () => {
	const mk = (moves, withSheet) => ({
		result: 'win', side: 'p1', opp: 'p2',
		moves: { p1: { Garchomp: moves }, p2: {} },
		teams: { p1: withSheet ? [{ species: 'Garchomp', moves: ['Earthquake', 'Protect'] }] : [], p2: [] },
	});
	const r = moveUsage([mk({ Earthquake: 3, 'Rock Slide': 1 }, true), mk({ Earthquake: 1 }, true)]);
	assert.equal(r.length, 1);
	assert.deepEqual([r[0].games, r[0].sheetGames, r[0].total], [2, 2, 5]);
	assert.deepEqual(r[0].moves.map(m => [m.move, m.count, m.games, m.inSet]), [['Earthquake', 4, 2, true], ['Rock Slide', 1, 1, false]]);
	assert.equal(r[0].moves[0].pct, 0.8);
	assert.equal(moveUsage([mk({ Earthquake: 1 }, false)])[0].moves[0].inSet, null);
	// real fixtures: totals equal the parser's per-game counts
	const total = moveUsage(gamesA).reduce((a, s) => a + s.total, 0);
	const direct = gamesA.reduce((a, g) => a + Object.values(g.moves.p1).reduce((b, m) => b + Object.values(m).reduce((c, n) => c + n, 0), 0), 0);
	assert.equal(total, direct);
});
