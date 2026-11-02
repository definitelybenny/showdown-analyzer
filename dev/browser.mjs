// Minimal headless-Chrome driver over the DevTools protocol (no dependencies). Used by dev/shot.mjs and dev/smoke.mjs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
	process.env.CHROME_PATH,
	'C:/Program Files/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
	'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
].filter(Boolean);

export function findChrome() {
	const c = CANDIDATES.find(p => fs.existsSync(p));
	if (!c) throw new Error('Chrome not found; set CHROME_PATH');
	return c;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-chrome-'));
	const proc = spawn(findChrome(), ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
	const portFile = path.join(dir, 'DevToolsActivePort');
	for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
	if (!fs.existsSync(portFile)) throw new Error('Chrome did not start');
	const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
	return {
		port,
		async close() {
			proc.kill();
			await sleep(300);
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch (e) {
				// chrome may still hold files; temp dir is harmless
			}
		},
		async page(url, { width = 400, height = 900 } = {}) {
			const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
			const target = await res.json();
			const ws = new WebSocket(target.webSocketDebuggerUrl);
			await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
			let id = 0;
			const pending = new Map();
			const logs = [];
			ws.onmessage = ev => {
				const m = JSON.parse(ev.data);
				if (m.id && pending.has(m.id)) {
					const { ok, bad } = pending.get(m.id);
					pending.delete(m.id);
					m.error ? bad(new Error(m.error.message)) : ok(m.result);
				} else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
					logs.push(`console.${m.params.type}: ${m.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`);
				} else if (m.method === 'Runtime.exceptionThrown') {
					logs.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
				} else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
					logs.push(`log: ${m.params.entry.text} ${m.params.entry.url || ''}`);
				}
			};
			const send = (method, params = {}) => new Promise((ok, bad) => {
				const i = ++id;
				pending.set(i, { ok, bad });
				ws.send(JSON.stringify({ id: i, method, params }));
			});
			await send('Runtime.enable');
			await send('Log.enable');
			await send('Page.enable');
			await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
			const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
			return {
				logs,
				evaluate,
				async waitReady(timeout = 15000) {
					const t0 = Date.now();
					while (Date.now() - t0 < timeout) {
						if (await evaluate("document.body.getAttribute('data-ready') === '1'")) return true;
						await sleep(100);
					}
					throw new Error('harness not ready; page errors: ' + (await evaluate("document.getElementById('errors').textContent")));
				},
				async screenshot(file) {
					await sleep(600); // let icon images settle
					const h = await evaluate('Math.ceil(document.documentElement.scrollHeight)');
					await send('Emulation.setDeviceMetricsOverride', { width, height: Math.min(h, Number(process.env.SHOT_H) || 6000), deviceScaleFactor: 1, mobile: false });
					const { data } = await send('Page.captureScreenshot', { format: 'png' });
					fs.writeFileSync(file, Buffer.from(data, 'base64'));
				},
				async close() {
					ws.close();
					await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
				},
			};
		},
	};
}
