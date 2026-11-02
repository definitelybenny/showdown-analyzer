// Recover the full log of a game the session joined late: the client's own stepQueue first, then the public replay JSON.
const REPLAY_BASE = 'https://replay.pokemonshowdown.com/';
const FETCH_TIMEOUT_MS = 10000;

/** `battle-<format>-<n>[-<password>]`: private rooms carry a password segment and have no public replay. */
export function isPrivateRoom(roomid) {
	return /^battle-[a-z0-9]+-\d+-[a-z0-9]+$/.test(String(roomid));
}

/** Replay id for a battle room id, or null for private rooms / non-battle ids. */
export function replayIdFor(roomid) {
	const m = /^battle-([a-z0-9]+-\d+)$/.exec(String(roomid));
	return m ? m[1] : null;
}

/** A log is usable as a full log when it contains the start of the game. */
export function looksComplete(lines) {
	return lines.some(l => l.indexOf('|start') === 0 || l.indexOf('|clearpoke') === 0);
}

function toLines(text) {
	return String(text).split('\n').map(l => l.replace(/\r$/, '')).filter(Boolean);
}

/**
 * Try to obtain the full protocol log of `roomid`.
 * @param {{roomid: string, getBattleLog?: Function, fetchFn?: Function, log?: Function}} opts
 * @returns {Promise<null | {lines: string[], source: 'stepQueue' | 'replay'}>} never rejects
 */
export async function backfillLog(opts) {
	const { roomid, getBattleLog, fetchFn, log } = opts;
	const warn = typeof log === 'function' ? log : () => {};
	try {
		const queue = typeof getBattleLog === 'function' ? getBattleLog(roomid) : null;
		if (Array.isArray(queue)) {
			const lines = toLines(queue.join('\n'));
			if (looksComplete(lines)) return { lines, source: 'stepQueue' };
		}
	} catch (err) {
		warn(`stepQueue backfill failed for ${roomid}: ${err && err.message}`);
	}
	const id = replayIdFor(roomid);
	if (!id) {
		if (isPrivateRoom(roomid)) warn(`no replay backfill for private room ${roomid}`);
		return null;
	}
	if (typeof fetchFn !== 'function') return null;
	let timer = null;
	try {
		const ctl = typeof AbortController === 'function' ? new AbortController() : null;
		if (ctl) timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
		const res = await fetchFn(`${REPLAY_BASE}${id}.json`, ctl ? { signal: ctl.signal } : undefined);
		if (!res || !res.ok) {
			warn(`replay backfill for ${roomid}: HTTP ${res ? res.status : 'no response'}`);
			return null;
		}
		const data = await res.json();
		const lines = data && typeof data.log === 'string' ? toLines(data.log) : [];
		if (!looksComplete(lines)) {
			warn(`replay backfill for ${roomid}: log is missing the game start`);
			return null;
		}
		return { lines, source: 'replay' };
	} catch (err) {
		warn(`replay backfill failed for ${roomid}: ${err && err.message}`);
		return null;
	} finally {
		if (timer) clearTimeout(timer);
	}
}
