import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLog } from '../../src/core/parser.js';
import { groupSets, setRatings, gameWinnerId } from '../../src/core/bo3.js';
import { loadFixture, Dex } from '../helpers.js';

const P = 'gen9championsvgc2026regmcbo3-';
const SETS = {
	A: { wrapper: 'game-bestof3-' + P + '2708057021', games: ['2708057022', '2708057976', '2708058877'] },
	B: { wrapper: 'game-bestof3-' + P + '2708081182', games: ['2708081183', '2708082078', '2708082934'] },
	C: { wrapper: 'game-bestof3-' + P + '2708109113', games: ['2708109115', '2708110929', '2708112191'] },
	D: { wrapper: 'game-bestof3-' + P + '2708106167', games: ['2708106168', '2708107431'] },
};

function load(num) {
	const id = P + num;
	return parseLog(loadFixture(id).log, { dex: Dex, meta: { id } });
}

const all = Object.values(SETS).flatMap(s => s.games).map(load);

test('groups 4 real sets by wrapper id regardless of input order', () => {
	const shuffled = [...all].reverse();
	const { sets, singles } = groupSets(shuffled);
	assert.equal(singles.length, 0);
	assert.equal(sets.length, 4);
	for (const s of Object.values(SETS)) {
		const set = sets.find(x => x.id === s.wrapper);
		assert.ok(set, s.wrapper);
		assert.deepEqual(set.games.map(g => g.bo3.gameNumber), s.games.map((_, i) => i + 1));
		assert.deepEqual(set.games.map(g => g.meta.id), s.games.map(n => P + n));
		assert.equal(set.bestOf, 3);
	}
});

test('set results (hand-verified from the logs)', () => {
	const { sets } = groupSets(all);
	const by = w => sets.find(s => s.id === SETS[w].wrapper);
	assert.deepEqual(by('A').wins, { reanschwarzervgc: 2, malucodetilambuco: 1 });
	assert.equal(by('A').winnerId, 'reanschwarzervgc');
	assert.deepEqual(by('B').wins, { unskilled99: 1, meermika: 2 });
	assert.equal(by('B').winnerId, 'meermika');
	assert.equal(by('C').winnerId, 'paibrazvgcoficial');
	assert.equal(by('D').winnerId, 'mattiepowney');
	assert.deepEqual(by('D').wins, { volttank: 0, mattiepowney: 2 });
	for (const w of ['A', 'B', 'C', 'D']) {
		assert.equal(by(w).complete, true);
		assert.deepEqual(by(w).missing, []);
	}
});

test('set rating delta comes from the last game with rating lines', () => {
	const { sets } = groupSets(all);
	const by = w => sets.find(s => s.id === SETS[w].wrapper);
	assert.deepEqual(by('A').ratings.reanschwarzervgc, { name: 'ReanSchwarzer_VGC', before: 1296, after: 1323, delta: 27 });
	assert.equal(by('A').ratings.malucodetilambuco.delta, -22);
	assert.equal(by('B').ratings.unskilled99.delta, -29);
	assert.equal(by('B').ratings.meermika.delta, 36);
	assert.equal(by('C').ratings.naiohernandez.delta, -24);
	assert.equal(by('C').ratings.paibrazvgcoficial.delta, 24);
	assert.equal(by('D').ratings.mattiepowney.before, 1000);
	assert.equal(by('D').ratings.volttank.delta, -33);
	// rating lines exist only on the final game of each set
	for (const set of sets) {
		const withRatings = set.games.filter(g => g.ratings.p1 || g.ratings.p2);
		assert.deepEqual(withRatings.map(g => g.bo3.gameNumber), [set.games[set.games.length - 1].bo3.gameNumber]);
	}
});

test('result from a player perspective', () => {
	assert.equal(groupSets(all, { me: 'MeerMika' }).sets.find(s => s.id === SETS.B.wrapper).result, 'win');
	assert.equal(groupSets(all, { me: 'Unskilled99' }).sets.find(s => s.id === SETS.B.wrapper).result, 'loss');
	assert.equal(groupSets(all).sets[0].result, null);
});

test('incomplete set: missing games and no winner', () => {
	const partial = [load('2708081183'), load('2708082934')];
	const { sets } = groupSets(partial);
	assert.equal(sets.length, 1);
	assert.deepEqual(sets[0].missing, [2]);
	assert.equal(sets[0].complete, false);
	assert.equal(sets[0].winnerId, null);
	const first = groupSets([load('2708081183')]).sets[0];
	assert.equal(first.complete, false);
	assert.equal(first.ratings, null);
});

test('dedupes repeated games and keeps non-Bo3 games as singles', () => {
	const bo1 = parseLog(loadFixture('gen9vgc2025regg-2354650138').log, { meta: { id: 'x' } });
	const { sets, singles } = groupSets([...all, ...all, bo1]);
	assert.equal(sets.length, 4);
	assert.equal(sets.reduce((n, s) => n + s.games.length, 0), 11);
	assert.deepEqual(singles, [bo1]);
	assert.deepEqual(groupSets(null), { sets: [], singles: [] });
});

test('gameWinnerId / setRatings edge cases', () => {
	assert.equal(gameWinnerId({ winner: null, players: {} }), null);
	assert.equal(gameWinnerId({ winner: { side: 'p1' }, players: { p1: null } }), null);
	assert.equal(setRatings([]), null);
});

test('a non-"bo3" format id can still be a best-of-3 (header decides, not the tier)', () => {
	const g = id => parseLog(loadFixture('gen9championsvgc2026regmc-' + id).log, { dex: Dex, meta: { id } });
	const { sets } = groupSets([g('2708104058'), g('2708102734')]);
	assert.equal(sets.length, 1);
	assert.equal(sets[0].id, 'game-bestof3-gen9championsvgc2026regmc-2708102731');
	assert.equal(sets[0].winnerId, 'yogev8');
	assert.deepEqual(sets[0].wins, { yogev8: 2, dustless: 0 });
	assert.equal(sets[0].ratings, null);
	assert.equal(sets[0].format, '[Gen 9 Champions] VGC 2026 Reg M-C');
});
