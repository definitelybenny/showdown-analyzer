// Side-room tab in the classic client: app._addRoom(id, 'html', nojoin), moved from roomList to
// sideRoomList (the same approach Showdex uses for its own tab).

import { CLASSIC_TAB_ID, ROOT_ID, TAB_TITLE, TAB_ICON } from './detect.js';

const ICON_PATCHED = '__saIconPatched';

function patchTabIcon(app) {
	const topbar = app.topbar;
	if (typeof topbar.renderRoomTab !== 'function' || topbar[ICON_PATCHED]) return;
	topbar[ICON_PATCHED] = true;
	const original = topbar.renderRoomTab.bind(topbar);
	topbar.renderRoomTab = function (room, roomid) {
		const buf = original(room, roomid);
		const id = (room && room.id) || roomid;
		return id === CLASSIC_TAB_ID && typeof buf === 'string' ? buf.replace('fa-file-text-o', TAB_ICON) : buf;
	};
}

/**
 * Create (or repair) and optionally focus the tab. Throws if the client refuses to create the room.
 * Returns { room, root }. onClosed fires when the client really destroys the room.
 */
export function openClassicTab(win, { focus = false, onClosed } = {}) {
	const app = win.app;
	const doc = win.document;
	let room = app.rooms[CLASSIC_TAB_ID];
	if (!room) {
		room = app._addRoom(CLASSIC_TAB_ID, 'html', true, TAB_TITLE);
		if (!room || !room.el) throw new Error('app._addRoom returned no room');
	}
	// also repairs a room the client created itself (e.g. from a /view-showdownanalyzer URL)
	const at = app.roomList.indexOf(room);
	if (at >= 0) {
		app.roomList.splice(at, 1);
		if (app.sideRoomList.indexOf(room) < 0) app.sideRoomList.push(room);
	}
	room.isSideRoom = true;
	room.minWidth = 360;
	room.maxWidth = 760;
	// Not a server room: never send /leave. destroy() only runs when the room is really removed
	// (requestLeave() is also called on beforeunload, so it is no close signal).
	room.leave = function () {};
	if (!room.saDestroyHooked) {
		room.saDestroyHooked = true;
		const destroy = room.destroy;
		room.destroy = function () {
			try {
				if (onClosed) onClosed();
			} catch (err) {
				console.error('[Showdown Analyzer] onClosed failed', err);
			}
			return typeof destroy === 'function' ? destroy.apply(this, arguments) : undefined;
		};
	}
	let root = room.el.querySelector('#' + ROOT_ID);
	if (!root) {
		if (room.$el && typeof room.$el.html === 'function') room.$el.html('');
		root = doc.createElement('div');
		root.id = ROOT_ID;
		room.el.appendChild(root);
	}
	patchTabIcon(app);
	if (focus && typeof app.focusRoomRight === 'function') app.focusRoomRight(CLASSIC_TAB_ID);
	if (typeof app.topbar.updateTabbar === 'function') app.topbar.updateTabbar();
	return { room, root };
}
