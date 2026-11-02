// Shared test helpers: fixture loading and the test-time dex.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dex } from '@pkmn/dex';

export { Dex };

export const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function fixtureIds() {
	return fs.readdirSync(FIXTURE_DIR)
		.filter(f => f.endsWith('.expected.json'))
		.map(f => f.replace(/\.expected\.json$/, ''))
		.sort();
}

export function loadFixture(id) {
	return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, id + '.json'), 'utf8'));
}

export function loadExpected(id) {
	return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, id + '.expected.json'), 'utf8'));
}

/** Parser fields that must not depend on whether a dex was injected (team names are cosmetic). */
export function keyFields(g) {
	return {
		players: g.players, bo3: g.bo3, roster: g.roster, picks: g.picks, leads: g.leads, mega: g.mega,
		tera: g.tera, moves: g.moves, turns: g.turns, winner: g.winner, end: g.end, ratings: g.ratings,
	};
}
