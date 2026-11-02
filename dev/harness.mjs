// Dev harness builder. Usage: node dev/harness.mjs
// Parses every test fixture with the core parser (me = first player of each replay), writes dev/out/seed.js, bundles
// dev/harness-entry.js (IIFE, so it also works from file://) and copies dev/harness.html to dev/out/.
// Open dev/out/harness.html?view=usage&theme=dark&w=400 (see harness-entry.js for all parameters).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Dex } from '@pkmn/dex';
import { parseLog } from '../src/core/parser.js';
import { gameRecordFromParsed } from '../src/store/repo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(here, 'out');
const fx = path.join(root, 'test', 'fixtures');
fs.mkdirSync(out, { recursive: true });

const games = [];
for (const f of fs.readdirSync(fx).filter(f => f.endsWith('.json') && !f.endsWith('.expected.json')).sort()) {
	const d = JSON.parse(fs.readFileSync(path.join(fx, f), 'utf8'));
	const parsed = parseLog(d.log, { me: d.players[0], dex: Dex });
	const rec = gameRecordFromParsed(parsed, { roomid: 'battle-' + d.id, ts: (d.uploadtime || 0) * 1000 });
	rec.rawLog = d.log;
	games.push(rec);
}
// a little variety in user fields so the non-empty states render
games.forEach((g, i) => {
	if (i % 3 === 0) g.reviewed = true;
	if (i % 5 === 1) g.notes = 'Lost the speed tie on turn 2; consider bringing a Fake Out user into this lead.';
});
const bySet = new Map();
for (const g of games) if (g.setId) (bySet.get(g.setId) || bySet.set(g.setId, []).get(g.setId)).push(g);
const sets = [...bySet].map(([id, list], i) => ({
	id, format: list[0].format, ts: Math.max(...list.map(g => g.ts)), games: list.map(g => g.roomid),
	tags: i === 0 ? ['scrim', 'rain'] : i === 1 ? ['tour'] : [], notes: i === 0 ? 'Opponent hides the Mega until turn 2.' : '',
}));

fs.writeFileSync(path.join(out, 'seed.js'), 'window.__SEED = ' + JSON.stringify({ games, sets }) + ';\n');
await build({ entryPoints: [path.join(here, 'harness-entry.js')], outfile: path.join(out, 'harness.js'), bundle: true, format: 'iife', target: 'es2020', logLevel: 'warning' });
fs.copyFileSync(path.join(here, 'harness.html'), path.join(out, 'harness.html'));
console.log(`harness ready: ${games.length} games, ${sets.length} sets -> ${path.relative(root, path.join(out, 'harness.html'))}`);
