// Live capture controller: subscribes to host messages, runs one Session per tracked battle room and persists
// games, sets and teams through the repo. Exposes captureStatus() and onChange() for the UI.
import { Session } from './session.js';
import { assembleSet } from './record.js';

export const DEFAULT_TRACKED_FORMATS = ['^gen9(champions)?vgc\\d{4}'];
export const DEFAULT_SETTLE_MS = 1500;
export const DEFAULT_LINGER_MS = 10 * 60 * 1000;
const MAX_ERRORS = 20;
const BATTLE_ROOM = /^battle-([a-z0-9]+)-\d+/;
const LEAVE_CMD = /^(\/noreply )?\/(leave|part)\b *(.*)$/;
const NO_USER_HINT = 'Not logged in: games are not saved. Log in to a Showdown account to record games.';

function compilePatterns(list) {
	const out = [];
	for (const src of Array.isArray(list) ? list : [list]) {
		try {
			if (typeof src === 'string' && src) out.push(new RegExp(src, 'i'));
		} catch (err) {
			// an invalid user-entered pattern is ignored
		}
	}
	return out;
}

/** Name from an `|updateuser|` line: '' for guests / unnamed, null when the line is something else. */
function userFromLine(line) {
	const a = line.split('|');
	if (a[1] !== 'updateuser') return null;
	const name = String(a[2] || '').trim();
	const named = a[3] === '1';
	return named && name && !/^Guest \d+$/.test(name) ? name : '';
}

/**
 * Start capturing.
 * @param {object} o
 * @param {object|Promise<object>} o.repo store repo (openRepo result), may still be opening
 * @param {{onMessage: Function, getUserName?: Function, getMyTeams?: Function, getBattleLog?: Function}} o.host
 * @param {object} [o.dex] species dex (client Dex)
 * @param {Function} [o.getDex] lazy alternative to `dex`
 * @param {Function} [o.fetchFn] fetch implementation for replay backfill
 * @param {number} [o.settleMs] wait after |win| for rating lines
 * @param {number} [o.lingerMs] a session with no messages for this long is dropped
 * @param {Function} [o.now]
 */
export function startCapture(o) {
	const host = o.host;
	const now = o.now || Date.now;
	const repoP = Promise.resolve(o.repo);
	const sessions = new Map();
	const idleTimers = new Map();
	const lingerMs = o.lingerMs === undefined ? DEFAULT_LINGER_MS : o.lingerMs;
	const listeners = new Set();
	const errors = [];
	let lastSaved = null;
	let savedCount = 0;
	let patterns = compilePatterns(DEFAULT_TRACKED_FORMATS);
	let eventUser = null; // name from |updateuser| (null = not seen yet)
	let writeQueue = Promise.resolve();
	let stopped = false;

	function changed() {
		for (const fn of Array.from(listeners)) {
			try {
				fn(status());
			} catch (err) {
				console.error('[Showdown Analyzer] capture listener failed', err);
			}
		}
	}

	function log(message, err) {
		if (err) console.warn('[Showdown Analyzer]', message, err);
		else console.warn('[Showdown Analyzer]', message);
		errors.push({ ts: now(), message });
		if (errors.length > MAX_ERRORS) errors.shift();
		changed();
	}

	function currentUser() {
		if (eventUser !== null) return eventUser;
		try {
			return (host.getUserName && host.getUserName()) || '';
		} catch (err) {
			return '';
		}
	}

	async function refreshSettings() {
		try {
			const repo = await repoP;
			patterns = compilePatterns(await repo.getSetting('trackedFormats', DEFAULT_TRACKED_FORMATS));
		} catch (err) {
			log('could not read trackedFormats setting: ' + (err && err.message), err);
		}
	}

	function commit(session, built) {
		const run = async () => {
			const repo = await repoP;
			const { record, teams } = built;
			const existing = await repo.getGame(record.roomid);
			if (existing && !existing.partial && record.partial) return;
			if (existing && existing.ts) record.ts = existing.ts;
			await repo.putGame(record);
			for (const t of teams) await repo.upsertTeam(t);
			if (record.setId) {
				const games = await repo.listGames({ setId: record.setId });
				const set = assembleSet(games, record.me);
				if (set) await repo.putSet(set);
			}
			savedCount++;
			const opp = record.players[record.opp];
			lastSaved = { roomid: record.roomid, setId: record.setId, result: record.result, opp: opp ? opp.name : '', ts: now(), partial: record.partial };
		};
		const p = writeQueue.then(run);
		writeQueue = p.catch(() => {});
		return p;
	}

	const ctx = {
		// the client's Dex may not exist yet at document-start, so resolve it lazily
		get dex() {
			return o.dex || (o.getDex && o.getDex()) || null;
		},
		now,
		settleMs: o.settleMs === undefined ? DEFAULT_SETTLE_MS : o.settleMs,
		getMe: () => currentUser(),
		getMyTeams: () => (host.getMyTeams ? host.getMyTeams() : []),
		getBattleLog: id => (host.getBattleLog ? host.getBattleLog(id) : null),
		fetchFn: o.fetchFn || (typeof fetch === 'function' ? (...a) => fetch(...a) : null),
		commit,
		closed: session => {
			// a closed room is done unless a finished game still waits for a user name
			if (!session.complete || session.state === 'saved' || session.state === 'skipped') session.idle().then(() => dropSession(session.roomid));
		},
		changed,
		log,
	};

	function sessionFor(roomid) {
		let s = sessions.get(roomid);
		if (s) return s;
		const m = BATTLE_ROOM.exec(roomid);
		if (!m || !patterns.some(re => re.test(m[1]))) return null;
		s = new Session(roomid, ctx);
		sessions.set(roomid, s);
		return s;
	}

	function touch(roomid) {
		clearTimeout(idleTimers.get(roomid));
		const t = setTimeout(() => dropSession(roomid), lingerMs);
		if (typeof t.unref === 'function') t.unref();
		idleTimers.set(roomid, t);
	}

	function dropSession(roomid) {
		clearTimeout(idleTimers.get(roomid));
		idleTimers.delete(roomid);
		const s = sessions.get(roomid);
		if (!s) return;
		if (s.complete && s.state !== 'saved' && s.state !== 'skipped') s.flush();
		s.dispose();
		sessions.delete(roomid);
		changed();
	}

	function handle(ev) {
		if (stopped || !ev || !Array.isArray(ev.lines)) return;
		try {
			if (ev.type === 'out') {
				for (const line of ev.lines) {
					const m = LEAVE_CMD.exec(line);
					const s = m && sessions.get(ev.roomid || m[3].trim());
					if (s) s.close();
				}
				return;
			}
			if (!ev.roomid) {
				for (const line of ev.lines) {
					const name = userFromLine(line);
					if (name === null) continue;
					eventUser = name;
					if (name) for (const s of sessions.values()) if (s.state === 'unsaved') s.flush();
					changed();
				}
				return;
			}
			if (!BATTLE_ROOM.test(ev.roomid)) return;
			const isNew = !sessions.has(ev.roomid);
			const s = sessionFor(ev.roomid);
			if (isNew) refreshSettings();
			if (s) {
				touch(ev.roomid);
				s.feed(ev.lines);
			}
		} catch (err) {
			log('capture handler failed: ' + (err && err.message), err);
		}
	}

	const unsubscribe = host.onMessage(handle);
	refreshSettings();
	let unsubscribeRepo = () => {};
	repoP.then(repo => {
		if (stopped || typeof repo.onChange !== 'function') return;
		unsubscribeRepo = repo.onChange(msg => {
			if (msg && msg.store === 'settings') refreshSettings();
		});
	}).catch(() => {});

	function status() {
		const user = currentUser();
		const live = [];
		for (const s of sessions.values()) if (s.state !== 'saved' && s.state !== 'skipped') live.push(s.info());
		return {
			userName: user,
			hint: !user && sessions.size ? NO_USER_HINT : '',
			live,
			lastSaved,
			savedCount,
			errors: errors.slice(),
		};
	}

	return {
		/** Snapshot for the UI: {userName, hint, live[], lastSaved, savedCount, errors[]}. */
		captureStatus: status,
		/** Subscribe to status changes (listener receives the status). Returns an unsubscribe function. */
		onChange(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		/** Wait for every pending write (tests, shutdown). */
		async flush() {
			await Promise.all([...sessions.values()].map(s => s.flush().then(() => s.idle())));
			await writeQueue;
		},
		refreshSettings,
		stop() {
			stopped = true;
			unsubscribe();
			unsubscribeRepo();
			for (const s of sessions.values()) s.dispose();
			for (const t of idleTimers.values()) clearTimeout(t);
			idleTimers.clear();
			sessions.clear();
			listeners.clear();
		},
	};
}
