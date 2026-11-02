// Dev helper: scan public replay search results and print per-replay features to choose fixtures from.
// Usage: node scripts/discover.mjs <formatid> [pages=5] [cacheDir]
import fs from 'node:fs';
import path from 'node:path';

const [format, pagesArg, cacheArg] = process.argv.slice(2);
const pages = Number(pagesArg) || 5;
const cache = cacheArg || path.join(process.cwd(), '.replay-cache');
fs.mkdirSync(cache, { recursive: true });

async function getJson(url) {
	for (let i = 0; i < 3; i++) {
		try {
			const r = await fetch(url);
			if (r.ok) return await r.json();
		} catch (e) { /* retry */ }
		await new Promise(r => setTimeout(r, 500));
	}
	return null;
}

export function features(d) {
	const log = d.log || '';
	const f = [];
	const bo = /<strong>Game (\d+)<\/strong> of <a href="\/(game-bestof3-[^"]+)"/.exec(log);
	if (bo) f.push(`G${bo[1]}:${bo[2].split('-').pop()}`);
	if (/\|-mega\|/.test(log)) f.push('mega');
	if (/Mega-Z/.test(log)) f.push('megaZ');
	if (/\|-terastallize\|/.test(log)) f.push('tera');
	if (/\|poke\|p\d\|[^|]*-\*/.test(log)) f.push('hidden');
	if (/\|-message\|[^|]* forfeited\./.test(log)) f.push('forfeit');
	if (/lost due to inactivity/.test(log)) f.push('inactive');
	if (/^\|tie$/m.test(log)) f.push('tie');
	if (!/^\|(win\||tie$)/m.test(log)) f.push('nowin');
	if (/\|showteam\|/.test(log)) f.push('ots');
	if (/\|replace\|/.test(log)) f.push('replace');
	if (/\|-transform\|/.test(log)) f.push('transform');
	if (/\|raw\|.*rating:/.test(log)) f.push('rating');
	const nick = /\|switch\|p\da: ([^|]+)\|([^,|]+)/g;
	let m;
	while ((m = nick.exec(log))) if (m[1].toLowerCase().replace(/[^a-z]/g, '') !== m[2].split('-')[0].toLowerCase().replace(/[^a-z]/g, '')) { f.push('nick'); break; }
	return f;
}

const out = [];
for (let p = 1; p <= pages; p++) {
	const list = await getJson(`https://replay.pokemonshowdown.com/search.json?format=${format}&page=${p}`);
	if (!list || !list.length) break;
	for (const r of list) {
		const file = path.join(cache, r.id + '.json');
		let d;
		if (fs.existsSync(file)) d = JSON.parse(fs.readFileSync(file, 'utf8'));
		else {
			d = await getJson(`https://replay.pokemonshowdown.com/${r.id}.json`);
			if (d) fs.writeFileSync(file, JSON.stringify(d));
		}
		if (!d) continue;
		out.push(`${r.id}\t${(d.players || []).join(' vs ')}\t${features(d).join(',')}`);
	}
}
console.log(out.join('\n'));
