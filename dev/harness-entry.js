// Browser entry of the dev harness. URL parameters:
//   view=games|sets|usage|matchups|moves|settings   theme=dark   w=400 (panel width px)   empty=1 (no data)
//   drawer=<roomid>   filters=1 (open the filter panel)   dex=1 (load the real client Dex for icons)
//   f=<json> (UI filters, e.g. {"result":"win"})
import { openRepo } from '../src/store/repo.js';
import { mountApp } from '../src/ui/app.js';

const q = new URLSearchParams(location.search);
const errBox = document.getElementById('errors');
function report(msg) {
	errBox.hidden = false;
	errBox.textContent += msg + '\n';
}
window.addEventListener('error', e => report('error: ' + e.message));
window.addEventListener('unhandledrejection', e => report('rejection: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)));
const origError = console.error;
console.error = (...a) => {
	report('console.error: ' + a.map(x => (x && x.message) || String(x)).join(' '));
	origError.apply(console, a);
};

if (q.get('theme') === 'dark') document.documentElement.className = 'dark';
const frame = document.getElementById('frame');
if (q.get('w')) frame.style.width = q.get('w') + 'px';

async function main() {
	console.log('harness: start');
	const repo = await openRepo({ name: 'showdown-analyzer-dev-' + (q.get('empty') ? 'empty' : 'seeded'), broadcast: false });
	await repo.clearAll();
	if (!q.get('empty')) {
		const seed = window.__SEED;
		for (const g of seed.games) await repo.putGame(g);
		for (const s of seed.sets) await repo.putSet(s);
	}
	if (q.get('view')) await repo.setSetting('ui.view', q.get('view'));
	if (q.get('f')) await repo.setSetting('ui.filters', JSON.parse(q.get('f')));
	const root = document.getElementById('sa-root');
	const app = mountApp(root, {
		repo,
		version: 'dev',
		captureStatus: () => ({ userName: 'DemoUser', live: [], savedCount: 0, errors: [] }),
		saveReplay: g => report('saveReplay hook called for ' + g.roomid),
	});
	await app.ready;
	if (q.get('filters')) root.querySelector('.sa-filterhead button') && root.querySelector('.sa-filterhead button').click();
	if (q.get('drawer')) app.openGame(q.get('drawer'));
	window.__app = app;
	document.body.setAttribute('data-ready', '1');
}
main().catch(e => report('fatal: ' + (e && e.stack ? e.stack : e)));
