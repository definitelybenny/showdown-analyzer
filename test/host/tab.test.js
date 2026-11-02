import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { openTab, onReady, getRoot, getTabMode, getTabDiagnostic, resetTab } from '../../src/host/tab.js';
import { openClassicTab } from '../../src/host/tab-classic.js';
import { openPreactTab, resetTabUrl } from '../../src/host/tab-preact.js';
import { mockClassicWin, mockPreactWin, mockDoc } from './mocks.js';

// mock timers do not run timers scheduled during a tick, so advance in poll-sized steps
function advance(ms, step = 500) {
	for (let t = 0; t < ms; t += step) mock.timers.tick(step);
}

test.afterEach(() => {
	resetTab();
	mock.timers.reset();
});

test('classic: _addRoom args, room moved to sideRoomList, leave is a no-op, root created', () => {
	const win = mockClassicWin();
	const { app } = win;
	const { room, root } = openClassicTab(win, { focus: true });
	assert.deepEqual(app._addRoom.calls[0].args, ['view-showdownanalyzer', 'html', true, 'Analyzer']);
	assert.equal(app.roomList.includes(room), false);
	assert.equal(app.sideRoomList.includes(room), true);
	assert.equal(room.isSideRoom, true);
	assert.equal(room.leave(), undefined);
	assert.equal(root.id, 'sa-root');
	assert.equal(room.el.children[0], root);
	assert.deepEqual(app.focusRoomRight.calls[0].args, ['view-showdownanalyzer']);
	assert.equal(app.topbar.updateTabbar.calls.length, 1);
});

test('classic: not focused by default, reopening reuses the room and root', () => {
	const win = mockClassicWin();
	const first = openClassicTab(win);
	const second = openClassicTab(win);
	assert.equal(win.app.focusRoomRight.calls.length, 0);
	assert.equal(win.app._addRoom.calls.length, 1);
	assert.equal(second.room, first.room);
	assert.equal(second.root, first.root);
	assert.equal(win.app.sideRoomList.length, 1);
});

test('classic: repairs a room the client created itself', () => {
	const win = mockClassicWin();
	win.app._addRoom('view-showdownanalyzer', 'html', false, 'x');
	openClassicTab(win);
	assert.equal(win.app.roomList.length, 0);
	assert.equal(win.app.sideRoomList.length, 1);
});

test('classic: icon patched once, destroy hook reports close and calls the original', () => {
	const win = mockClassicWin();
	let closed = 0;
	const { room } = openClassicTab(win, { onClosed: () => closed++ });
	openClassicTab(win);
	const html = win.app.topbar.renderRoomTab({ id: 'view-showdownanalyzer' }, 'view-showdownanalyzer');
	assert.match(html, /fa-bar-chart/);
	assert.doesNotMatch(html, /fa-file-text-o/);
	assert.match(win.app.topbar.renderRoomTab({ id: 'lobby' }, 'lobby'), /fa-file-text-o/);
	assert.equal(room.destroy(), 'destroyed');
	assert.equal(closed, 1);
});

test('classic: throws when the client returns no room', () => {
	const win = mockClassicWin();
	win.app._addRoom = () => null;
	assert.throws(() => openClassicTab(win), /no room/);
});

test('preact: registers the room type once and joins it', () => {
	const win = mockPreactWin();
	let ready = 0;
	let closed = 0;
	openPreactTab(win, { focus: true, onReady: () => ready++, onClosed: () => closed++ });
	openPreactTab(win, {});
	assert.equal(win.PS.addRoomType.calls.length, 1);
	const Panel = win.PS.roomTypes[0];
	assert.equal(Panel.id, 'showdownanalyzer');
	assert.deepEqual(Panel.routes, ['showdownanalyzer']);
	assert.equal(Panel.location, 'right');
	assert.equal(Panel.title, 'Analyzer');
	assert.equal(Panel.noURL, true);
	assert.equal(Panel.icon.props.class, 'fa fa-bar-chart');
	assert.deepEqual(win.PS.join.calls[0].args, ['showdownanalyzer', { noURL: true, autofocus: true, autoclosePopups: false }]);
	assert.equal(win.PS.join.calls[1].args[1].autofocus, false);

	const room = new Panel.Model({ id: 'showdownanalyzer' });
	assert.equal(room.location, 'right');
	assert.equal(room.noURL, true);
	assert.equal(room.type, 'showdownanalyzer');
	assert.equal(room.destroy(), 'super-destroyed');
	assert.equal(closed, 1);

	const panel = new Panel({ room });
	panel.componentDidMount();
	assert.equal(ready, 1);
	const tree = panel.render();
	assert.equal(tree.type, win.PSPanelWrapper);
	assert.equal(tree.children[0].props.id, 'sa-root');
});

test('resetTabUrl rewrites our paths back to /', () => {
	const win = mockPreactWin();
	win.location.pathname = '/showdownanalyzer';
	resetTabUrl(win);
	assert.deepEqual(win.history.replaceState.calls[0].args, [null, '', '/']);
	win.location.pathname = '/view-showdownanalyzer';
	resetTabUrl(win);
	assert.equal(win.history.replaceState.calls.length, 2);
	win.location.pathname = '/battle-x-1';
	resetTabUrl(win);
	assert.equal(win.history.replaceState.calls.length, 2);
});

test('openTab: classic opens immediately, onReady gets the root now and later', () => {
	const win = mockClassicWin();
	openTab({ win });
	assert.equal(getTabMode(), 'classic');
	assert.equal(win.app.focusRoomRight.calls.length, 0);
	const seen = [];
	onReady(el => seen.push(el));
	assert.equal(seen.length, 1);
	assert.equal(seen[0], getRoot(win));
	assert.equal(seen[0].id, 'sa-root');
});

test('openTab: waits for the client, then opens it (fake timers)', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	const win = { document: mockDoc(), location: { pathname: '/' }, history: {} };
	openTab({ win });
	assert.equal(getTabMode(), null);
	advance(1500);
	assert.equal(getTabMode(), null);
	Object.assign(win, mockClassicWin());
	mock.timers.tick(500);
	assert.equal(getTabMode(), 'classic');
});

test('openTab: preact mode, root appears when the panel mounts', () => {
	const win = mockPreactWin();
	openTab({ win });
	assert.equal(getTabMode(), 'preact');
	const seen = [];
	onReady(el => seen.push(el));
	assert.equal(seen.length, 0);
	const root = win.document.createElement('div');
	root.id = 'sa-root';
	win.document.body.appendChild(root);
	new win.PS.roomTypes[0]({ room: {} }).componentDidMount();
	assert.deepEqual(seen, [root]);
});

test('openTab: falls back to the floating panel after 30 s without a client', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	const warn = mock.method(console, 'warn', () => {});
	const win = { document: mockDoc(), location: { pathname: '/' }, history: {} };
	const seen = [];
	onReady(el => seen.push(el));
	openTab({ win });
	advance(29500);
	assert.equal(getTabMode(), null);
	mock.timers.tick(500);
	assert.equal(getTabMode(), 'floating');
	assert.match(getTabDiagnostic(), /no usable client/);
	const panel = win.document.getElementById('sa-floating');
	assert.ok(panel);
	assert.match(panel.find(c => c.className === 'sa-diag').textContent, /Tab unavailable: no usable client/);
	assert.equal(seen.length, 1);
	assert.equal(seen[0].id, 'sa-root');
	warn.mock.restore();
});

test('openTab: client present but panel API missing falls back with the missing name', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	const warn = mock.method(console, 'warn', () => {});
	const win = mockPreactWin();
	delete win.PSPanelWrapper;
	openTab({ win, waitMs: 1000 });
	advance(1000);
	assert.equal(getTabMode(), 'floating');
	assert.match(getTabDiagnostic(), /PSPanelWrapper/);
	warn.mock.restore();
});

test('openTab: tab creation throwing falls back instead of breaking the host', () => {
	const err = mock.method(console, 'error', () => {});
	const warn = mock.method(console, 'warn', () => {});
	const win = mockClassicWin();
	win.app._addRoom = () => { throw new Error('nope'); };
	openTab({ win });
	assert.equal(getTabMode(), 'floating');
	assert.equal(getTabDiagnostic(), 'nope');
	err.mock.restore();
	warn.mock.restore();
});

test('floating panel waits for <body> at document-start', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	const warn = mock.method(console, 'warn', () => {});
	const doc = mockDoc({ withBody: false });
	const win = { document: doc, location: { pathname: '/' }, history: {} };
	openTab({ win, waitMs: 500 });
	mock.timers.tick(500);
	assert.equal(getTabMode(), 'floating');
	assert.equal(doc.getElementById('sa-floating'), null);
	doc.makeBody();
	doc.listeners.DOMContentLoaded.forEach(fn => fn());
	assert.ok(doc.getElementById('sa-floating'));
	warn.mock.restore();
});
