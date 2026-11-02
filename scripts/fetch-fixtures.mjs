// Downloads the public replays listed below into test/fixtures/<id>.json.
// Usage: node scripts/fetch-fixtures.mjs   (use scripts/discover.mjs to find new candidates)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');

// id -> why it is here
export const FIXTURES = {
	// Bo3 sets (Reg M-C), grouped by wrapper id
	'gen9championsvgc2026regmcbo3-2708057022': 'set A game 1 (2-1 set, no forfeits)',
	'gen9championsvgc2026regmcbo3-2708057976': 'set A game 2',
	'gen9championsvgc2026regmcbo3-2708058877': 'set A game 3 (set rating lines)',
	'gen9championsvgc2026regmcbo3-2708081183': 'set B game 1',
	'gen9championsvgc2026regmcbo3-2708082078': 'set B game 2 (forfeit)',
	'gen9championsvgc2026regmcbo3-2708082934': 'set B game 3 (rating lines, nicknames, Z-Mega)',
	'gen9championsvgc2026regmcbo3-2708109115': 'set C game 1 (forfeit, nicknames)',
	'gen9championsvgc2026regmcbo3-2708110929': 'set C game 2',
	'gen9championsvgc2026regmcbo3-2708112191': 'set C game 3 (forfeit, rating lines)',
	'gen9championsvgc2026regmcbo3-2708106168': 'set D game 1 (2-0 set)',
	'gen9championsvgc2026regmcbo3-2708107431': 'set D game 2 (rating lines)',
	// Reg M-C (OTS default format)
	'gen9championsvgc2026regmc-2708121117': 'Bo1, Mega Z, Illusion/replace, nicknames',
	'gen9championsvgc2026regmc-2708107409': 'Bo1, inactivity loss, 17 turns',
	'gen9championsvgc2026regmc-2708102734': 'Reg M-C (not -bo3 id) played as a best-of-3: game 1',
	'gen9championsvgc2026regmc-2708104058': 'Reg M-C best-of-3: game 2',
	'gen9championsvgc2026regmc-2708113349': 'Bo1 with open team sheets, Mega Z',
	// Tera era
	'gen9vgc2025regg-2354752741': 'Tera, hidden formes, nicknames, inactivity loss',
	'gen9vgc2025regg-2354650138': 'Tera, Transform, inactivity loss',
	'gen9vgc2025regi-2707575566': 'Tera, Illusion (replace), nicknames',
	'gen9vgc2024regf-2130600385': 'Urshifu-* in preview resolved by a switch-in',
	'gen9vgc2024regf-2131085055': 'Urshifu-* in preview with open team sheets',
	'gen9championsvgc2026regma-2673627565': 'Reg M-A Ditto / Transform',
	'gen9championsvgc2026regma-2674137619': 'Reg M-A with |swap| (Ally Switch)',
};

async function getJson(url) {
	for (let i = 0; i < 3; i++) {
		const r = await fetch(url);
		if (r.ok) return r.json();
		await new Promise(res => setTimeout(res, 500 * (i + 1)));
	}
	throw new Error('fetch failed: ' + url);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	fs.mkdirSync(dir, { recursive: true });
	for (const id of Object.keys(FIXTURES)) {
		const file = path.join(dir, id + '.json');
		if (fs.existsSync(file)) continue;
		const d = await getJson(`https://replay.pokemonshowdown.com/${id}.json`);
		fs.writeFileSync(file, JSON.stringify(d, null, '\t') + '\n');
		console.log('saved', id);
	}
}
