// Browser smoke test (not part of `npm test`). Usage: node dev/harness.mjs && node dev/serve.mjs & node dev/smoke.mjs
// Loads every view at narrow and wide widths and asserts: renders, no console errors, no horizontal overflow.
import { launch } from './browser.mjs';

const base = process.argv[2] || 'http://127.0.0.1:5179/harness.html';
const views = ['games', 'sets', 'usage', 'matchups', 'moves', 'settings'];
const failures = [];
const check = (ok, msg) => {
	if (!ok) failures.push(msg);
	console.log((ok ? 'ok   ' : 'FAIL ') + msg);
};
const realErrors = logs => logs.filter(l => !/favicon\.ico/.test(l));

const b = await launch();
try {
	for (const width of [360, 760]) {
		for (const theme of ['', 'dark']) {
			for (const view of views) {
				const p = await b.page(`${base}?view=${view}&w=${width}${theme ? '&theme=dark' : ''}`, { width });
				await p.waitReady();
				const info = JSON.parse(await p.evaluate(`JSON.stringify({text: document.getElementById('sa-root').innerText.length, over: document.documentElement.scrollWidth - document.documentElement.clientWidth, cards: document.querySelectorAll('#sa-root .sa-card').length})`));
				const tag = `${view} ${width}px ${theme || 'light'}`;
				check(info.text > 50, `${tag}: renders content`);
				check(info.over <= 1, `${tag}: no horizontal overflow (${info.over})`);
				check(realErrors(p.logs).length === 0, `${tag}: no console errors ${realErrors(p.logs).join(' | ')}`);
				await p.close();
			}
		}
	}
	// interactions
	let p = await b.page(`${base}?view=games`, { width: 400 });
	await p.waitReady();
	await p.evaluate(`document.querySelector('#sa-root .sa-card.sa-click').click()`);
	check(await p.evaluate(`document.getElementById('sa-root').innerText.includes('Notes')`), 'clicking a game opens the detail pane');
	await p.evaluate(`[...document.querySelectorAll('#sa-root button')].find(b => b.textContent.includes('Back')).click()`);
	check(await p.evaluate(`document.querySelectorAll('#sa-root .sa-card.sa-click').length > 5`), 'back returns to the list');
	await p.close();
	p = await b.page(`${base}?view=games&f=${encodeURIComponent('{"result":"win"}')}`, { width: 400 });
	await p.waitReady();
	check(await p.evaluate(`document.querySelectorAll('#sa-root .sa-result-loss').length === 0`), 'persisted result filter hides losses');
	await p.close();
	p = await b.page(`${base}?view=games&empty=1`, { width: 400 });
	await p.waitReady();
	check(await p.evaluate(`document.getElementById('sa-root').innerText.includes('No games recorded yet')`), 'empty state explains what to do');
	check(realErrors(p.logs).length === 0, 'empty state: no console errors');
	await p.close();
} finally {
	await b.close();
}
if (failures.length) {
	console.log(`\n${failures.length} failure(s)`);
	process.exit(1);
}
console.log('\nsmoke ok');
