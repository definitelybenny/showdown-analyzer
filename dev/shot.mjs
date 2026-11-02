// Screenshot a harness state. Usage: node dev/shot.mjs "view=usage&theme=dark" <out.png> [width] [baseUrl]
// Needs `node dev/harness.mjs` to have run and `node dev/serve.mjs` to be serving dev/out (default http://127.0.0.1:5179).
import { launch } from './browser.mjs';

const [query = '', outFile = 'dev/out/shot.png', width = '400', base = 'http://127.0.0.1:5179/harness.html'] = process.argv.slice(2);
const b = await launch();
try {
	const p = await b.page(`${base}?${query}&w=${Math.min(Number(width), 760)}`, { width: Number(width) });
	await p.waitReady();
	await p.screenshot(outFile);
	console.log('wrote', outFile, p.logs.length ? '\nERRORS:\n' + p.logs.join('\n') : '(no console errors)');
	await p.close();
} finally {
	await b.close();
}
