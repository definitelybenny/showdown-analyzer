import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { detectClient, classicTabReady, preactTabReady, describeMissing } from '../../src/host/detect.js';
import {
	onMessage, splitMessage, startHook, stopHook, getHookStatus, getUserName, getMyTeams, getBattleLog, getBattleRooms,
} from '../../src/host/hook.js';
import { mockClassicWin, mockPreactWin, spy } from './mocks.js';

function collect() {
	const events = [];
	const off = onMessage(e => events.push(e));
	return { events, off };
}

test.afterEach(() => {
	stopHook();
	mock.timers.reset();
});

test('detectClient picks the client that can carry traffic', () => {
	assert.equal(detectClient({}), null);
	assert.equal(detectClient(mockClassicWin()), 'classic');
	assert.equal(detectClient(mockPreactWin()), 'preact');
	assert.equal(detectClient({ app: {} }), null);
	assert.equal(detectClient({ PS: { receive() {}, send() {} } }), 'preact');
});

test('tab readiness checks and diagnostics name the missing API', () => {
	const classic = mockClassicWin();
	assert.ok(classicTabReady(classic));
	delete classic.app._addRoom;
	assert.ok(!classicTabReady(classic));
	assert.match(describeMissing(classic), /app\._addRoom/);

	const preact = mockPreactWin();
	assert.ok(preactTabReady(preact));
	delete preact.PSPanelWrapper;
	assert.ok(!preactTabReady(preact));
	assert.match(describeMissing(preact), /PSPanelWrapper/);
	assert.match(describeMissing({}), /no usable client/);
});

test('splitMessage handles room blocks, multiple lines and global lines', () => {
	assert.deepEqual(splitMessage('>battle-x-1\n|init|battle\n|player|p1|A|1|\n'), [
		{ roomid: 'battle-x-1', lines: ['|init|battle', '|player|p1|A|1|'] },
	]);
	assert.deepEqual(splitMessage('|updateuser| Bob|1|2|{}'), [{ roomid: '', lines: ['|updateuser| Bob|1|2|{}'] }]);
	assert.deepEqual(splitMessage('>a\n|x\n>b\n|y\n|z'), [
		{ roomid: 'a', lines: ['|x'] },
		{ roomid: 'b', lines: ['|y', '|z'] },
	]);
	assert.deepEqual(splitMessage('>lobby\r\n|c|x|hi\r\n'), [{ roomid: 'lobby', lines: ['|c|x|hi'] }]);
	assert.deepEqual(splitMessage('>empty\n'), []);
});

for (const [name, make, owner] of [
	['classic', mockClassicWin, w => w.app],
	['preact', mockPreactWin, w => w.PS],
]) {
	test(`${name}: wrapping emits normalized in/out events and preserves this and results`, () => {
		const win = make();
		const o = owner(win);
		const origReceive = o.receive;
		const origSend = o.send;
		const { events, off } = collect();
		startHook({ win });
		assert.equal(getHookStatus().hooked, true);
		assert.equal(getHookStatus().client, name);

		assert.equal(o.receive.call(o, '>battle-x-1\n|turn|1\n|move|a|b'), 'rx');
		assert.equal(o.send.call(o, '/savereplay', 'battle-x-1'), 'tx');
		assert.equal(o.send('/cmd userdetails bob'), 'tx');
		assert.equal(origReceive.calls[0].self, o);
		assert.equal(origSend.calls.length, 2);
		assert.deepEqual(origSend.calls[0].args, ['/savereplay', 'battle-x-1']);

		const real = events.filter(e => !e.synthetic);
		assert.deepEqual(real, [
			{ type: 'in', roomid: 'battle-x-1', lines: ['|turn|1', '|move|a|b'] },
			{ type: 'out', roomid: 'battle-x-1', lines: ['/savereplay'] },
			{ type: 'out', roomid: '', lines: ['/cmd userdetails bob'] },
		]);
		off();
	});

	test(`${name}: hooking twice wraps once`, () => {
		const win = make();
		const o = owner(win);
		const { events, off } = collect();
		startHook({ win });
		const wrapped = o.receive;
		stopHook();
		startHook({ win });
		assert.equal(o.receive, wrapped);
		o.receive('>r\n|a');
		assert.equal(events.filter(e => !e.synthetic && e.type === 'in').length, 1);
		off();
	});

	test(`${name}: late injection emits a synthetic updateuser, guests do not`, () => {
		const { events, off } = collect();
		startHook({ win: make({ name: 'Alice' }) });
		assert.deepEqual(events.map(e => [e.roomid, e.lines[0].startsWith('|updateuser| Alice|1|'), e.synthetic]), [['', true, true]]);
		off();
		stopHook();

		const guest = collect();
		startHook({ win: make({ name: 'Guest 1234567', named: false }) });
		assert.equal(guest.events.length, 0);
		guest.off();
	});

	test(`${name}: subscriber errors do not reach the host or other subscribers`, () => {
		const win = make();
		const o = owner(win);
		const errors = mock.method(console, 'error', () => {});
		const off1 = onMessage(() => { throw new Error('boom'); });
		const { events, off } = collect();
		startHook({ win });
		assert.equal(o.receive('>r\n|a'), 'rx');
		assert.equal(events.filter(e => !e.synthetic).length, 1);
		assert.ok(errors.mock.callCount() >= 1);
		errors.mock.restore();
		off1();
		off();
	});

	test(`${name}: non-string input is ignored and original errors propagate unchanged`, () => {
		const win = make();
		const o = owner(win);
		const failure = new Error('client broke');
		o.receive = spy(() => { throw failure; });
		const { events, off } = collect();
		startHook({ win });
		assert.equal(o.send(undefined), 'tx');
		assert.throws(() => o.receive('>r\n|a'), failure);
		assert.equal(events.filter(e => !e.synthetic).length, 1);
			off();
	});
}

test('startHook polls until the client shows up (50 ms)', () => {
	mock.timers.enable({ apis: ['setInterval'] });
	const win = {};
	const { events, off } = collect();
	let hookedWith = null;
	startHook({ win, onHooked: c => { hookedWith = c; } });
	mock.timers.tick(150);
	assert.equal(getHookStatus().hooked, false);
	const real = mockClassicWin();
	win.app = real.app;
	mock.timers.tick(50);
	assert.equal(getHookStatus().hooked, true);
	assert.equal(hookedWith, 'classic');
	assert.equal(events.length, 1);
	mock.timers.tick(5000);
	assert.equal(events.length, 1);
	off();
});

test('startHook gives up after the timeout with a diagnostic', () => {
	mock.timers.enable({ apis: ['setInterval'] });
	startHook({ win: { app: { receive() {} } }, timeout: 1000 });
	mock.timers.tick(1100);
	const status = getHookStatus();
	assert.equal(status.hooked, false);
	assert.match(status.error, /missing|no usable/);
});

test('getUserName: classic and preact, guests count as not logged in', () => {
	assert.equal(getUserName(mockClassicWin({ name: 'Alice' })), 'Alice');
	assert.equal(getUserName(mockClassicWin({ name: 'Alice', named: false })), '');
	assert.equal(getUserName(mockClassicWin({ name: 'Guest 8675309' })), '');
	assert.equal(getUserName(mockPreactWin({ name: 'Bob' })), 'Bob');
	assert.equal(getUserName(mockPreactWin({ name: 'Bob', named: false })), '');
	assert.equal(getUserName(mockPreactWin({ name: 'Guest 12' })), '');
	assert.equal(getUserName({}), '');
});

test('getMyTeams normalizes both clients', () => {
	const classic = mockClassicWin();
	classic.Storage = { teams: [{ name: 'A', format: 'gen9vgc2024regf', team: 'packedA', folder: 'f' }, { name: 'empty', team: '' }] };
	assert.deepEqual(getMyTeams(classic), [{ name: 'A', format: 'gen9vgc2024regf', packed: 'packedA' }]);

	const preact = mockPreactWin();
	preact.PS.teams.list = [{ name: 'B', format: 'gen9championsvgc2026regmc', packedTeam: 'packedB', folder: '' }, { name: 'C' }];
	assert.deepEqual(getMyTeams(preact), [{ name: 'B', format: 'gen9championsvgc2026regmc', packed: 'packedB' }]);

	assert.deepEqual(getMyTeams(mockClassicWin()), []);
	assert.deepEqual(getMyTeams({}), []);
});

test('getBattleLog and getBattleRooms read stepQueue from either client', () => {
	const classic = mockClassicWin();
	classic.app.rooms['battle-x-1'] = { battle: { stepQueue: ['|player|p1|A', '|turn|1'] } };
	classic.app.rooms['lobby'] = {};
	assert.deepEqual(getBattleLog('battle-x-1', classic), ['|player|p1|A', '|turn|1']);
	assert.notEqual(getBattleLog('battle-x-1', classic), classic.app.rooms['battle-x-1'].battle.stepQueue);
	assert.equal(getBattleLog('lobby', classic), null);
	assert.equal(getBattleLog('nope', classic), null);
	assert.deepEqual(getBattleRooms(classic), ['battle-x-1']);

	const preact = mockPreactWin();
	preact.PS.rooms['battle-y-2'] = { battle: { stepQueue: ['|turn|2'] } };
	assert.deepEqual(getBattleLog('battle-y-2', preact), ['|turn|2']);
	assert.deepEqual(getBattleRooms(preact), ['battle-y-2']);
	assert.deepEqual(getBattleRooms({}), []);
});
