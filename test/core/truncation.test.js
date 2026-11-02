import test from 'node:test';
import assert from 'node:assert/strict';
import { LogParser, parseLog } from '../../src/core/parser.js';
import { fixtureIds, loadFixture, Dex } from '../helpers.js';

// Deterministic PRNG so failures reproduce.
function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

function checkShape(g) {
	assert.equal(typeof g, 'object');
	for (const side of ['p1', 'p2']) {
		assert.ok(Array.isArray(g.picks[side]) && Array.isArray(g.leads[side]) && Array.isArray(g.roster[side]));
		assert.ok(g.leads[side].length <= 2);
		for (const lead of g.leads[side]) assert.ok(g.picks[side].includes(lead), 'leads are a subset of picks');
	}
	assert.ok(['win', 'forfeit', 'inactivity', 'tie', 'incomplete'].includes(g.end));
}

for (const id of fixtureIds()) {
	test(`truncated ${id}: never throws, stays consistent`, () => {
		const log = loadFixture(id).log;
		const lines = log.split('\n');
		const cuts = [0, 1, 5, 20, Math.floor(lines.length / 3), Math.floor(lines.length / 2), lines.length - 5, lines.length - 1, lines.length];
		for (const n of cuts) {
			const g = parseLog(lines.slice(0, Math.max(0, n)), { dex: Dex, me: 'x' });
			checkShape(g);
			if (n < lines.length - 8) assert.equal(g.complete, false, `cut at ${n} must be incomplete`);
		}
		// cut mid-line (a partial protocol line at the end)
		for (const frac of [0.1, 0.37, 0.5, 0.83, 0.99]) {
			const g = parseLog(log.slice(0, Math.floor(log.length * frac)), { dex: Dex });
			checkShape(g);
		}
	});

	test(`streaming ${id}: finalize after every chunk never throws and is monotone`, () => {
		const lines = loadFixture(id).log.split('\n');
		const p = new LogParser({ dex: Dex });
		let prevTurns = 0;
		let prevPicks = [0, 0];
		lines.forEach((l, i) => {
			p.feed(l);
			if (i % 40 === 0 || i === lines.length - 1) {
				const g = p.finalize();
				checkShape(g);
				assert.ok(g.turns >= prevTurns);
				assert.ok(g.picks.p1.length >= prevPicks[0] && g.picks.p2.length >= prevPicks[1]);
				prevTurns = g.turns;
				prevPicks = [g.picks.p1.length, g.picks.p2.length];
			}
		});
	});
}

test('fuzz: shuffled, dropped and corrupted lines never throw', () => {
	const rand = rng(12345);
	for (const id of fixtureIds()) {
		const lines = loadFixture(id).log.split('\n');
		for (let round = 0; round < 6; round++) {
			const mutated = [];
			for (const l of lines) {
				const r = rand();
				if (r < 0.1) continue;
				if (r < 0.2) mutated.push(l.slice(0, Math.floor(rand() * l.length)));
				else if (r < 0.28) mutated.push(l.split('|').reverse().join('|'));
				else if (r < 0.34) mutated.push(l.replace(/[a-z]/g, c => (rand() < 0.3 ? '|' : c)));
				else mutated.push(l);
				if (rand() < 0.05) mutated.push(mutated[mutated.length - 1]);
			}
			if (round % 2) mutated.sort(() => rand() - 0.5);
			assert.doesNotThrow(() => checkShape(parseLog(mutated, { dex: Dex, me: 'a' })), `${id} round ${round}`);
			assert.doesNotThrow(() => checkShape(parseLog(mutated, {})));
		}
	}
});

test('garbage bytes and huge lines do not throw', () => {
	const rand = rng(99);
	const junk = [];
	for (let i = 0; i < 300; i++) {
		let s = '|' + ['switch', 'move', 'poke', 'showteam', 'player', 'win', 'raw', 'uhtml', 'replace', 'swap'][Math.floor(rand() * 10)];
		for (let j = 0; j < Math.floor(rand() * 6); j++) s += '|' + String.fromCharCode(32 + Math.floor(rand() * 90)).repeat(Math.floor(rand() * 8));
		junk.push(s);
	}
	junk.push('|showteam|p1|' + ']'.repeat(10000));
	junk.push('|raw|' + 'a'.repeat(200000));
	assert.doesNotThrow(() => parseLog(junk, { dex: Dex }));
});
