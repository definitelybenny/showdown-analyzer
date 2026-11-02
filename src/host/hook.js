// Wraps app.receive/app.send (classic) or PS.receive/PS.send (Preact) and emits normalized events:
//   { type: 'in' | 'out', roomid: string ('' = global), lines: string[], synthetic?: true }
// Wrapping is idempotent, never throws into the host and preserves `this` and return values.
// Also exposes read-only accessors for the user name, saved teams and a room's battle log.

import { detectClient, describeMissing } from './detect.js';

const MARK = '__saHooked';
const GUEST = /^Guest \d+$/;

// ---- emitter ---------------------------------------------------------------

const listeners = new Set();

/** Subscribe to normalized events. Returns an unsubscribe function. */
export function onMessage(fn) {
	if (typeof fn !== 'function') return () => {};
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function emit(event) {
	for (const fn of Array.from(listeners)) {
		try {
			fn(event);
		} catch (err) {
			console.error('[Showdown Analyzer] subscriber failed', err);
		}
	}
}

// ---- normalization -----------------------------------------------------------

/** Split a raw server message (">roomid\n|a\n|b", possibly without prefix) into per-room line blocks. */
export function splitMessage(msg) {
	const blocks = [];
	let cur = null;
	for (const raw of String(msg).split('\n')) {
		if (raw.charAt(0) === '>') {
			cur = { roomid: raw.slice(1).trim(), lines: [] };
			blocks.push(cur);
			continue;
		}
		const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
		if (!line) continue;
		if (!cur) {
			cur = { roomid: '', lines: [] };
			blocks.push(cur);
		}
		cur.lines.push(line);
	}
	return blocks.filter(b => b.lines.length);
}

function incomingEvents(args) {
	const msg = args[0];
	if (typeof msg !== 'string') return [];
	return splitMessage(msg).map(b => ({ type: 'in', roomid: b.roomid, lines: b.lines }));
}

function outgoingEvents(args) {
	const msg = args[0];
	if (typeof msg !== 'string' || !msg) return [];
	const roomid = typeof args[1] === 'string' ? args[1] : '';
	return [{ type: 'out', roomid, lines: [msg] }];
}

// ---- wrapping ------------------------------------------------------------------

/** Wrap owner[name]; returns true if it is (now or already) wrapped. */
function wrap(owner, name, toEvents) {
	const original = owner[name];
	if (typeof original !== 'function') return false;
	if (original[MARK]) return true;
	const wrapper = function () {
		try {
			for (const ev of toEvents(arguments)) emit(ev);
		} catch (err) {
			console.error('[Showdown Analyzer] hook failed', err);
		}
		return original.apply(this, arguments);
	};
	wrapper[MARK] = true;
	try {
		owner[name] = wrapper;
	} catch (err) {
		return false;
	}
	return owner[name] === wrapper;
}

function hookClient(win, client) {
	const owner = client === 'classic' ? win.app : win.PS;
	const a = wrap(owner, 'receive', incomingEvents);
	const b = wrap(owner, 'send', outgoingEvents);
	return a && b;
}

// ---- host state readers ----------------------------------------------------------

function clientOwner(win) {
	const client = detectClient(win);
	return client === 'classic' ? win.app : client === 'preact' ? win.PS : null;
}

/** Name of the logged-in user, or '' for guests / not yet known. */
export function getUserName(win = globalThis) {
	try {
		const client = detectClient(win);
		let name = '';
		let named = true;
		if (client === 'classic') {
			const user = win.app.user;
			if (!user || typeof user.get !== 'function') return '';
			name = user.get('name');
			if (user.get('named') === false) named = false;
		} else if (client === 'preact') {
			const user = win.PS.user;
			if (!user) return '';
			name = user.name;
			if (user.named === false) named = false;
		}
		name = typeof name === 'string' ? name.trim() : '';
		return named && name && !GUEST.test(name) ? name : '';
	} catch (err) {
		return '';
	}
}

/** The user's saved teambuilder teams as [{ name, format, packed }]. */
export function getMyTeams(win = globalThis) {
	try {
		const client = detectClient(win);
		let list = null;
		if (client === 'classic') list = win.Storage && win.Storage.teams;
		else if (client === 'preact') list = win.PS.teams && win.PS.teams.list;
		if (!Array.isArray(list)) return [];
		return list
			.map(t => ({
				name: String((t && t.name) || ''),
				format: String((t && t.format) || ''),
				packed: String(t && (t.team != null ? t.team : t.packedTeam) || ''),
			}))
			.filter(t => t.packed);
	} catch (err) {
		return [];
	}
}

function roomMap(win) {
	const client = detectClient(win);
	return client === 'classic' ? win.app.rooms : client === 'preact' ? win.PS.rooms : null;
}

/** Protocol lines the client has stored for a battle room (copy), or null when unavailable. */
export function getBattleLog(roomid, win = globalThis) {
	try {
		const room = (roomMap(win) || {})[roomid];
		const queue = room && room.battle && room.battle.stepQueue;
		return Array.isArray(queue) ? queue.slice() : null;
	} catch (err) {
		return null;
	}
}

/** Ids of the battle rooms the client currently has open. */
export function getBattleRooms(win = globalThis) {
	try {
		return Object.keys(roomMap(win) || {}).filter(id => id.startsWith('battle-'));
	} catch (err) {
		return [];
	}
}

// ---- startup -----------------------------------------------------------------------

const status = { client: null, hooked: false, error: '' };
let timer = null;

export function getHookStatus() {
	return { ...status };
}

function syntheticUpdateUser(win) {
	const name = getUserName(win);
	if (!name) return;
	const owner = clientOwner(win);
	const avatar = (owner && owner.user && (owner.user.avatar || (typeof owner.user.get === 'function' && owner.user.get('avatar')))) || '';
	emit({ type: 'in', roomid: '', lines: [`|updateuser| ${name}|1|${avatar}|{}`], synthetic: true });
}

function attempt(win, onHooked) {
	const client = detectClient(win);
	if (!client) return false;
	status.client = client;
	if (!hookClient(win, client)) {
		status.error = 'could not wrap ' + (client === 'classic' ? 'app' : 'PS') + '.receive/send';
		return false;
	}
	status.hooked = true;
	status.error = '';
	syntheticUpdateUser(win);
	if (onHooked) {
		try {
			onHooked(client);
		} catch (err) {
			console.error('[Showdown Analyzer] onHooked failed', err);
		}
	}
	return true;
}

/**
 * Hook now if a client is ready, else poll (interval ms, up to timeout ms). Safe to call repeatedly.
 * Returns { stop }. After giving up, getHookStatus().error says which API was missing.
 */
export function startHook({ win = globalThis, interval = 50, timeout = 60000, onHooked } = {}) {
	if (status.hooked || timer) return { stop: stopHook };
	if (attempt(win, onHooked)) return { stop: stopHook };
	let elapsed = 0;
	timer = setInterval(() => {
		elapsed += interval;
		if (attempt(win, onHooked)) {
			stopHook(true);
		} else if (elapsed >= timeout) {
			status.error = describeMissing(win);
			stopHook(true);
		}
	}, interval);
	return { stop: stopHook };
}

/** Stop polling. Pass keepStatus to retain the result; otherwise state is reset (used by tests). */
export function stopHook(keepStatus) {
	if (timer) clearInterval(timer);
	timer = null;
	if (keepStatus !== true) {
		status.client = null;
		status.hooked = false;
		status.error = '';
	}
}
