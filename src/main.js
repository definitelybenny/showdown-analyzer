// Entry point: hook the client, open the Analyzer tab (not focused) and render a proof-of-life view.
import { startHook, onMessage, getUserName, getMyTeams, getBattleLog, getBattleRooms, getHookStatus } from './host/hook.js';
import { openTab, onReady, getRoot, getTabMode, getTabDiagnostic, resetTabUrl } from './host/tab.js';
import { ROOT_ID } from './host/detect.js';
import { openRepo } from './store/repo.js';
import { startCapture } from './capture/index.js';

const STYLE_ID = 'sa-style';
const CSS = `
#${ROOT_ID}{padding:8px 12px;font:12px/1.5 Verdana,sans-serif;color:inherit}
#${ROOT_ID} h2{margin:0 0 6px;font-size:14px}
#${ROOT_ID} .sa-row{margin:2px 0}
#${ROOT_ID} .sa-row b{display:inline-block;min-width:96px;font-weight:bold}
#${ROOT_ID} .sa-diag{margin-top:8px;color:#a05000;font-size:11px}
#${ROOT_ID} .sa-muted{opacity:.7}
`;

const seen = { rooms: new Set(), in: 0, out: 0 };
let capture = null;
let renderTimer = null;

function row(doc, label, value) {
	const div = doc.createElement('div');
	div.className = 'sa-row';
	const b = doc.createElement('b');
	b.textContent = label;
	const span = doc.createElement('span');
	span.textContent = value;
	div.appendChild(b);
	div.appendChild(span);
	return div;
}

function render() {
	renderTimer = null;
	const root = getRoot();
	if (!root) return;
	const doc = root.ownerDocument;
	if (!doc.getElementById(STYLE_ID)) {
		const style = doc.createElement('style');
		style.id = STYLE_ID;
		style.textContent = CSS;
		(doc.head || doc.documentElement).appendChild(style);
	}
	const hook = getHookStatus();
	const battles = getBattleRooms();
	const nodes = [];
	const title = doc.createElement('h2');
	title.textContent = 'Showdown Analyzer';
	nodes.push(title);
	nodes.push(row(doc, 'User', getUserName() || 'not logged in'));
	nodes.push(row(doc, 'Client', hook.client || 'waiting'));
	nodes.push(row(doc, 'Messages', `${seen.in} in, ${seen.out} out`));
	nodes.push(row(doc, 'Rooms seen', String(seen.rooms.size)));
	nodes.push(row(doc, 'Battle rooms', battles.length ? battles.join(', ') : 'none'));
	if (capture) {
		const st = capture.captureStatus();
		nodes.push(row(doc, 'Recording', st.live.length ? st.live.map(l => l.roomid + (l.partial ? ' (partial)' : '')).join(', ') : 'idle'));
		nodes.push(row(doc, 'Saved games', String(st.savedCount) + (st.lastSaved ? ` (last: ${st.lastSaved.result || '?'} vs ${st.lastSaved.opp || '?'})` : '')));
		if (st.hint) nodes.push(row(doc, 'Hint', st.hint));
		const err = st.errors[st.errors.length - 1];
		if (err) nodes.push(row(doc, 'Last error', err.message));
	}
	const problem = hook.error || (hook.hooked ? '' : getTabDiagnostic());
	if (problem) {
		const diag = doc.createElement('div');
		diag.className = 'sa-diag';
		diag.textContent = 'Diagnostics: ' + problem;
		nodes.push(diag);
	}
	root.replaceChildren(...nodes);
}

function scheduleRender() {
	if (renderTimer) return;
	renderTimer = setTimeout(render, 250);
}

function main() {
	resetTabUrl(); // runs at document-start, before the client reads the URL
	onMessage(ev => {
		seen[ev.type]++;
		if (ev.roomid) seen.rooms.add(ev.roomid);
		scheduleRender();
	});
	onReady(render);
	startHook({ onHooked: scheduleRender });
	openTab({ focus: false });
	// the diagnostics line needs a refresh if the hook gives up (startHook polls for up to 60 s)
	setTimeout(scheduleRender, 61000);
	console.log('[Showdown Analyzer] loaded' + (getTabMode() ? ' (' + getTabMode() + ')' : ''));
}

try {
	main();
} catch (err) {
	console.error('[Showdown Analyzer] startup failed', err);
}
