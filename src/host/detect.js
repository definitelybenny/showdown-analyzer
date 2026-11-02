// Client detection. Pure functions over a window-like object; nothing here touches the DOM.

export const ROOT_ID = 'sa-root';
export const TAB_TITLE = 'Analyzer';
export const TAB_ICON = 'fa-bar-chart';
export const CLASSIC_TAB_ID = 'view-showdownanalyzer';
export const PREACT_TAB_ID = 'showdownanalyzer';

const isFn = v => typeof v === 'function';

/** 'classic' (window.app), 'preact' (window.PS) or null while neither client can carry traffic yet. */
export function detectClient(win = globalThis) {
	const app = win.app;
	if (app && isFn(app.receive) && isFn(app.send)) return 'classic';
	const PS = win.PS;
	if (PS && isFn(PS.receive) && isFn(PS.send)) return 'preact';
	return null;
}

/** The classic client has the room/topbar machinery the tab needs. */
export function classicTabReady(win = globalThis) {
	const app = win.app;
	return !!(app && isFn(app._addRoom) && app.rooms && app.topbar && Array.isArray(app.roomList) && Array.isArray(app.sideRoomList));
}

/** The new client's panel classes load after PS itself. */
export function preactTabReady(win = globalThis) {
	const PS = win.PS;
	return !!(PS && isFn(PS.addRoomType) && isFn(PS.join) &&
		isFn(win.PSRoom) && isFn(win.PSRoomPanel) && isFn(win.PSPanelWrapper) &&
		win.preact && isFn(win.preact.h));
}

/** Human readable list of what is missing, for the diagnostics line. */
export function describeMissing(win = globalThis) {
	const client = detectClient(win);
	const need = (obj, names, prefix) => names.filter(n => !(obj && isFn(obj[n]))).map(n => prefix + '.' + n);
	if (client === 'classic') {
		const m = need(win.app, ['_addRoom'], 'app');
		for (const k of ['rooms', 'topbar', 'roomList', 'sideRoomList']) if (!win.app[k]) m.push('app.' + k);
		return m.length ? 'missing ' + m.join(', ') : '';
	}
	if (client === 'preact') {
		const m = need(win.PS, ['addRoomType', 'join'], 'PS');
		for (const k of ['PSRoom', 'PSRoomPanel', 'PSPanelWrapper']) if (!isFn(win[k])) m.push('window.' + k);
		if (!(win.preact && isFn(win.preact.h))) m.push('preact.h');
		return m.length ? 'missing ' + m.join(', ') : '';
	}
	return `no usable client (window.app=${typeof win.app}, window.PS=${typeof win.PS})`;
}
