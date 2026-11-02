// Entry point: hook the client, open the Analyzer tab (not focused), start live capture and mount the UI.
import { startHook, onMessage, getUserName, getMyTeams, getBattleLog, getHookStatus } from './host/hook.js';
import { openTab, onReady, getRoot, getTabMode, getTabDiagnostic, resetTabUrl } from './host/tab.js';
import { openRepo } from './store/repo.js';
import { startCapture } from './capture/index.js';
import { mountApp } from './ui/app.js';

const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

let repoPromise = null;
let capture = null;
let app = null;
let mountedRoot = null;

function getDex() {
	const w = typeof window !== 'undefined' ? window : null;
	return w && w.Dex ? w.Dex : null;
}

function mount() {
	const root = getRoot();
	if (!root || !repoPromise || !capture) return;
	if (app && mountedRoot === root) return; // already mounted in this root
	if (app) app.destroy();
	mountedRoot = root;
	repoPromise.then(repo => {
		if (mountedRoot !== root) return;
		app = mountApp(root, {
			repo,
			captureStatus: capture.captureStatus,
			onChange: capture.onChange,
			version: VERSION,
		});
	}).catch(err => {
		const diag = getHookStatus().error || getTabDiagnostic() || '';
		root.textContent = 'Showdown Analyzer could not start: ' + (err && err.message || err) + (diag ? ' (' + diag + ')' : '');
		console.error('[Showdown Analyzer] UI failed to mount', err);
	});
}

function main() {
	// the classic client busts frames; only ever run in the top document
	if (window.top !== window.self) return;
	if (window.__showdownAnalyzerLoaded) return;
	window.__showdownAnalyzerLoaded = true;

	resetTabUrl(); // runs at document-start, before the client reads the URL
	repoPromise = openRepo();
	capture = startCapture({
		repo: repoPromise,
		host: { onMessage, getUserName, getMyTeams, getBattleLog },
		getDex,
	});
	window.__showdownAnalyzer = { repo: repoPromise, capture, version: VERSION };

	onReady(mount);
	startHook({});
	openTab({ focus: false });
	console.log('[Showdown Analyzer] loaded' + (getTabMode() ? ' (' + getTabMode() + ')' : ''));
}

try {
	main();
} catch (err) {
	console.error('[Showdown Analyzer] startup failed', err);
}
