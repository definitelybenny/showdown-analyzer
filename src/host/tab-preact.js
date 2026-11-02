// Right-side room in the Preact client: a custom room type registered with PS.addRoomType and
// opened with PS.join (the same approach Showdex uses for its own tab).

import { PREACT_TAB_ID, ROOT_ID, TAB_TITLE, TAB_ICON } from './detect.js';

const registered = new WeakSet();

/**
 * Focusing the room puts /showdownanalyzer in the URL; after a reload the client would then try to
 * /join it as a server room. Rewrite the URL back to / (both client flavours).
 */
export function resetTabUrl(win = globalThis) {
	try {
		const path = win.location && win.location.pathname;
		if (!path || !win.history) return;
		if (path.indexOf('/' + PREACT_TAB_ID) === 0 || path.indexOf('/view-' + PREACT_TAB_ID) === 0) {
			const state = win.PS && win.PS.router ? win.PS.router.panelState : win.history.state;
			win.history.replaceState(state, '', '/');
		}
	} catch (err) {
		console.error('[Showdown Analyzer] URL reset failed', err);
	}
}

function registerType(win, { onReady, onClosed }) {
	const { PS, PSRoom, PSRoomPanel, PSPanelWrapper, preact } = win;
	if (registered.has(PS)) return;

	class AnalyzerRoom extends PSRoom {
		constructor(options) {
			super(options);
			this.title = TAB_TITLE;
			this.type = PREACT_TAB_ID;
			this.classType = PREACT_TAB_ID;
			this.location = 'right';
			this.noURL = true;
		}
		// not a server room, so nothing to /leave; destroy() only runs when the room is really closed
		destroy() {
			try {
				if (onClosed) onClosed();
			} catch (err) {
				console.error('[Showdown Analyzer] onClosed failed', err);
			}
			return super.destroy();
		}
	}
	class AnalyzerPanel extends PSRoomPanel {
		componentDidMount() {
			if (super.componentDidMount) super.componentDidMount();
			try {
				if (onReady) onReady();
			} catch (err) {
				console.error('[Showdown Analyzer] onReady failed', err);
			}
		}
		focus() {
			if (super.focus) super.focus();
			resetTabUrl(win);
		}
		render() {
			// we render into this div; preact leaves children it did not create alone
			return preact.h(PSPanelWrapper, { room: this.props.room }, preact.h('div', { id: ROOT_ID }));
		}
	}
	Object.assign(AnalyzerPanel, {
		id: PREACT_TAB_ID,
		routes: [PREACT_TAB_ID],
		Model: AnalyzerRoom,
		location: 'right',
		title: TAB_TITLE,
		noURL: true,
		icon: preact.h('i', { class: 'fa ' + TAB_ICON, 'aria-hidden': true }),
	});
	PS.addRoomType(AnalyzerPanel);
	registered.add(PS);
}

/** Register the room type (once) and join it. Throws on client API errors. */
export function openPreactTab(win, { focus = false, onReady, onClosed } = {}) {
	registerType(win, { onReady, onClosed });
	win.PS.join(PREACT_TAB_ID, { noURL: true, autofocus: focus, autoclosePopups: false });
	if (typeof win.PS.update === 'function') win.PS.update();
	resetTabUrl(win);
}
