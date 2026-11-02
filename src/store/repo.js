// Repository over IndexedDB: games, sets, teams, settings. Raw logs are stored gzip-compressed.
import { openDb, req, withTx, requestPersistence, SCHEMA_VERSION, STORES } from './idb.js';
import { compressText, decompressText } from './compress.js';

export const CHANNEL_NAME = 'showdown-analyzer';
export const USER_FIELDS = { games: ['notes', 'reviewed', 'tags'], sets: ['notes', 'tags'], teams: ['name'] };
export const DATA_STORES = ['games', 'sets', 'teams', 'settings'];

export function isEmpty(v) {
	return v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0);
}

/** Merge two records with the same key: newer `updatedAt` wins; user fields fall back to the other side when empty. */
export function mergeRecords(existing, incoming, userFields) {
	if (!existing) return incoming;
	const incomingWins = (incoming.updatedAt || 0) > (existing.updatedAt || 0);
	const winner = incomingWins ? incoming : existing;
	const loser = incomingWins ? existing : incoming;
	const out = { ...winner };
	for (const f of userFields || []) if (isEmpty(out[f]) && !isEmpty(loser[f])) out[f] = loser[f];
	return out;
}

/** Build a stored game record from a parsed game (parseLog output) plus capture context {roomid, ts}. */
export function gameRecordFromParsed(parsed, ctx) {
	const c = ctx || {};
	const bo3 = parsed.bo3;
	return {
		...parsed,
		roomid: c.roomid,
		ts: c.ts,
		setId: bo3 ? bo3.wrapperId : null,
		gameNumber: bo3 ? bo3.gameNumber : null,
	};
}

function matchesFilter(g, f) {
	if (f.format && g.format !== f.format) return false;
	if (f.result && g.result !== f.result) return false;
	if (f.setId && g.setId !== f.setId) return false;
	if (f.reviewed !== undefined && !!g.reviewed !== !!f.reviewed) return false;
	if (f.tag && !(g.tags || []).includes(f.tag)) return false;
	if (f.from !== undefined && !(g.ts >= f.from)) return false;
	if (f.to !== undefined && !(g.ts <= f.to)) return false;
	if (f.predicate && !f.predicate(g)) return false;
	return true;
}

/**
 * Open the repository.
 * @param {{name?: string, indexedDB?: IDBFactory, migrations?: object[], broadcast?: boolean}} [opts]
 */
export async function openRepo(opts) {
	const o = opts || {};
	const db = await openDb(o);
	const listeners = new Set();
	let channel = null;
	if (o.broadcast !== false && typeof BroadcastChannel === 'function') {
		try {
			channel = new BroadcastChannel(CHANNEL_NAME);
			channel.onmessage = ev => listeners.forEach(cb => cb(ev.data));
		} catch (e) {
			channel = null;
		}
	}

	function notify(store, keys) {
		if (!channel) return;
		try {
			channel.postMessage({ type: 'change', store, keys });
		} catch (e) {
			// channel already closed
		}
	}

	async function prepareGame(rec, existing) {
		const out = { ...rec };
		if (typeof out.rawLog === 'string') {
			const { data, enc } = await compressText(out.rawLog);
			out.rawLog = data;
			out.rawEnc = enc;
		} else if (out.rawLog !== undefined && !out.rawEnc) {
			out.rawEnc = 'gzip';
		}
		if (existing) for (const f of USER_FIELDS.games) if (out[f] === undefined) out[f] = existing[f];
		if (out.notes === undefined) out.notes = '';
		if (out.reviewed === undefined) out.reviewed = false;
		if (out.tags === undefined) out.tags = [];
		if (out.updatedAt === undefined) out.updatedAt = Date.now();
		return out;
	}

	const repo = {
		db,
		schemaVersion: SCHEMA_VERSION,
		requestPersistence,

		/** Subscribe to change notifications from other tabs. Returns an unsubscribe function. */
		onChange(cb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		close() {
			if (channel) channel.close();
			channel = null;
			db.close();
		},

		async getSchemaVersion() {
			const m = await withTx(db, 'meta', 'readonly', s => req(s.meta.get('schemaVersion')));
			return m ? m.value : 0;
		},

		/** Store a game. A string `rawLog` is compressed; user fields omitted by the caller keep their stored values. */
		async putGame(rec) {
			if (!rec || !rec.roomid) throw new Error('putGame: record needs a roomid');
			const existing = await withTx(db, 'games', 'readonly', s => req(s.games.get(rec.roomid)));
			const out = await prepareGame(rec, existing);
			await withTx(db, 'games', 'readwrite', s => req(s.games.put(out)));
			notify('games', [rec.roomid]);
			return out;
		},
		async getGame(roomid) {
			return (await withTx(db, 'games', 'readonly', s => req(s.games.get(roomid)))) || null;
		},
		/** Decompressed raw log of a stored game, or null. */
		async getRawLog(roomid) {
			const g = await repo.getGame(roomid);
			if (!g || g.rawLog === undefined) return null;
			return decompressText(g.rawLog, g.rawEnc);
		},
		/** Games newest first. filter: {format, result, setId, reviewed, tag, from, to, predicate, limit} */
		async listGames(filter) {
			const f = filter || {};
			const all = await withTx(db, 'games', 'readonly', s => req(s.games.getAll()));
			const out = all.filter(g => matchesFilter(g, f)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
			return f.limit ? out.slice(0, f.limit) : out;
		},
		async deleteGame(roomid) {
			await withTx(db, 'games', 'readwrite', s => req(s.games.delete(roomid)));
			notify('games', [roomid]);
		},
		async countGames(filter) {
			if (!filter) return withTx(db, 'games', 'readonly', s => req(s.games.count()));
			return (await repo.listGames({ ...filter, limit: 0 })).length;
		},

		async putSet(rec) {
			if (!rec || !rec.id) throw new Error('putSet: record needs an id');
			const existing = await repo.getSet(rec.id);
			const out = { ...rec };
			if (existing) for (const f of USER_FIELDS.sets) if (out[f] === undefined) out[f] = existing[f];
			if (out.notes === undefined) out.notes = '';
			if (out.tags === undefined) out.tags = [];
			if (out.updatedAt === undefined) out.updatedAt = Date.now();
			await withTx(db, 'sets', 'readwrite', s => req(s.sets.put(out)));
			notify('sets', [rec.id]);
			return out;
		},
		async getSet(id) {
			return (await withTx(db, 'sets', 'readonly', s => req(s.sets.get(id)))) || null;
		},
		async listSets(filter) {
			const f = filter || {};
			const all = await withTx(db, 'sets', 'readonly', s => req(s.sets.getAll()));
			return all
				.filter(x => (!f.format || x.format === f.format) && (!f.tag || (x.tags || []).includes(f.tag)))
				.sort((a, b) => (b.ts || 0) - (a.ts || 0));
		},

		/** Insert a team or extend firstSeen/lastSeen; a stored name is never replaced by an empty one. */
		async upsertTeam(team) {
			if (!team || !team.id) throw new Error('upsertTeam: team needs an id (roster hash)');
			const now = Date.now();
			const existing = await withTx(db, 'teams', 'readonly', s => req(s.teams.get(team.id)));
			const out = { ...(existing || {}), ...team };
			if (existing && isEmpty(team.name)) out.name = existing.name;
			out.firstSeen = Math.min(existing ? existing.firstSeen : Infinity, team.firstSeen === undefined ? now : team.firstSeen);
			out.lastSeen = Math.max(existing ? existing.lastSeen : 0, team.lastSeen === undefined ? now : team.lastSeen);
			if (out.updatedAt === undefined) out.updatedAt = now;
			await withTx(db, 'teams', 'readwrite', s => req(s.teams.put(out)));
			notify('teams', [team.id]);
			return out;
		},
		async listTeams() {
			const all = await withTx(db, 'teams', 'readonly', s => req(s.teams.getAll()));
			return all.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
		},

		async getSetting(name, fallback) {
			const r = await withTx(db, 'settings', 'readonly', s => req(s.settings.get(name)));
			return r ? r.value : fallback;
		},
		async setSetting(name, value) {
			await withTx(db, 'settings', 'readwrite', s => req(s.settings.put({ name, value, updatedAt: Date.now() })));
			notify('settings', [name]);
		},
		async listSettings() {
			return withTx(db, 'settings', 'readonly', s => req(s.settings.getAll()));
		},

		/** Put many records into one store in a single transaction (records are stored exactly as given). */
		async bulkPut(store, records) {
			if (!DATA_STORES.includes(store)) throw new Error(`bulkPut: unknown store "${store}"`);
			await withTx(db, store, 'readwrite', s => {
				for (const r of records) s[store].put(r);
			});
			notify(store, records.map(r => r[STORES[store]]));
		},

		async clearAll() {
			await withTx(db, DATA_STORES, 'readwrite', s => {
				for (const n of DATA_STORES) s[n].clear();
			});
			notify('*', []);
		},

		/**
		 * Rebuild parsed fields of every game from its stored raw log. User fields, identity (roomid, ts) and the raw
		 * log are preserved. parseFn(rawText, oldRecord) returns a parsed game (parseLog output).
		 * @returns {Promise<{updated: number, failed: {roomid: string, error: string}[]}>}
		 */
		async reparseAll(parseFn) {
			const games = await withTx(db, 'games', 'readonly', s => req(s.games.getAll()));
			const failed = [];
			const next = [];
			for (const old of games) {
				try {
					if (old.rawLog === undefined) throw new Error('no raw log stored');
					const parsed = await parseFn(await decompressText(old.rawLog, old.rawEnc), old);
					const rec = gameRecordFromParsed(parsed, { roomid: old.roomid, ts: old.ts });
					for (const k of ['me', 'side', 'opp', 'result']) if (rec[k] === undefined && old[k] !== undefined) rec[k] = old[k];
					rec.rawLog = old.rawLog;
					rec.rawEnc = old.rawEnc;
					for (const f of USER_FIELDS.games) rec[f] = old[f];
					rec.updatedAt = old.updatedAt;
					next.push(rec);
				} catch (e) {
					failed.push({ roomid: old.roomid, error: e && e.message ? e.message : String(e) });
				}
			}
			if (next.length) await repo.bulkPut('games', next);
			return { updated: next.length, failed };
		},
	};
	return repo;
}
