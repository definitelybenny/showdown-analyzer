// JSON export/import of the whole store. Pure logic: no DOM (see download.js for the browser helper).
import { SCHEMA_VERSION } from './idb.js';
import { USER_FIELDS, mergeRecords } from './repo.js';
import { bytesToBase64, base64ToBytes } from './compress.js';

export class ImportError extends Error {
	constructor(message) {
		super(message);
		this.name = 'ImportError';
	}
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Snapshot of everything in the repo. Raw logs become base64 gzip (`rawEnc: 'gzip-base64'`) or plain text (`'plain'`). */
export async function exportAll(repo) {
	const games = (await repo.listGames()).map(g => {
		const out = { ...g };
		if (g.rawLog !== undefined) {
			if (g.rawEnc === 'gzip') {
				out.rawLog = bytesToBase64(g.rawLog instanceof Uint8Array ? g.rawLog : new Uint8Array(g.rawLog));
				out.rawEnc = 'gzip-base64';
			} else {
				out.rawEnc = 'plain';
			}
		}
		return out;
	});
	return {
		schemaVersion: SCHEMA_VERSION,
		exportedAt: Date.now(),
		games,
		sets: await repo.listSets(),
		teams: await repo.listTeams(),
		settings: await repo.listSettings(),
	};
}

function checkList(data, key, idField) {
	if (!Array.isArray(data[key])) throw new ImportError(`Invalid import: "${key}" must be an array`);
	data[key].forEach((r, i) => {
		if (!isObj(r) || typeof r[idField] !== 'string' || !r[idField]) {
			throw new ImportError(`Invalid import: ${key}[${i}] is missing a string "${idField}"`);
		}
	});
}

/** Parse and validate; returns records ready to store (rawLog decoded back to bytes). Throws ImportError. */
export function validateImport(input) {
	let data = input;
	if (typeof input === 'string') {
		try {
			data = JSON.parse(input);
		} catch (e) {
			throw new ImportError(`Invalid import: not valid JSON (${e.message})`);
		}
	}
	if (!isObj(data)) throw new ImportError('Invalid import: expected a JSON object');
	if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) {
		throw new ImportError('Invalid import: missing or invalid "schemaVersion"');
	}
	if (data.schemaVersion > SCHEMA_VERSION) {
		throw new ImportError(`Invalid import: schemaVersion ${data.schemaVersion} is newer than this script supports (${SCHEMA_VERSION}); update the script`);
	}
	checkList(data, 'games', 'roomid');
	checkList(data, 'sets', 'id');
	checkList(data, 'teams', 'id');
	checkList(data, 'settings', 'name');
	const games = data.games.map(g => {
		if (g.rawLog === undefined) return { ...g };
		if (typeof g.rawLog !== 'string') throw new ImportError(`Invalid import: games "${g.roomid}" has a non-string rawLog`);
		if (g.rawEnc === 'gzip-base64') {
			let bytes;
			try {
				bytes = base64ToBytes(g.rawLog);
			} catch (e) {
				throw new ImportError(`Invalid import: games "${g.roomid}" rawLog is not valid base64`);
			}
			if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
				throw new ImportError(`Invalid import: games "${g.roomid}" rawLog is not gzip data`);
			}
			return { ...g, rawLog: bytes, rawEnc: 'gzip' };
		}
		if (g.rawEnc !== 'plain') throw new ImportError(`Invalid import: games "${g.roomid}" has unknown rawEnc "${g.rawEnc}"`);
		return { ...g };
	});
	return { games, sets: data.sets, teams: data.teams, settings: data.settings };
}

function mergeTeam(existing, incoming) {
	const out = mergeRecords(existing, incoming, USER_FIELDS.teams);
	if (existing) {
		out.firstSeen = Math.min(existing.firstSeen ?? Infinity, incoming.firstSeen ?? Infinity);
		out.lastSeen = Math.max(existing.lastSeen ?? 0, incoming.lastSeen ?? 0);
		if (out.firstSeen === Infinity) delete out.firstSeen;
	}
	return out;
}

/**
 * Import an export. mode 'replace' clears the store first; 'merge' (default) merges by key: newer `updatedAt` wins
 * (ties keep what is stored) and user fields are never overwritten by empty values. Nothing is written if validation fails.
 * @returns {Promise<{mode: string, games: number, sets: number, teams: number, settings: number}>}
 */
export async function importData(repo, input, opts) {
	const mode = (opts && opts.mode) || 'merge';
	if (mode !== 'merge' && mode !== 'replace') throw new ImportError(`Unknown import mode "${mode}"`);
	const data = validateImport(input);
	if (mode === 'replace') {
		await repo.clearAll();
		for (const store of ['games', 'sets', 'teams', 'settings']) if (data[store].length) await repo.bulkPut(store, data[store]);
	} else {
		const existing = {
			games: new Map((await repo.listGames()).map(r => [r.roomid, r])),
			sets: new Map((await repo.listSets()).map(r => [r.id, r])),
			teams: new Map((await repo.listTeams()).map(r => [r.id, r])),
			settings: new Map((await repo.listSettings()).map(r => [r.name, r])),
		};
		const keyOf = { games: 'roomid', sets: 'id', teams: 'id', settings: 'name' };
		for (const store of Object.keys(keyOf)) {
			const merged = data[store].map(r => {
				const old = existing[store].get(r[keyOf[store]]);
				if (!old) return r;
				return store === 'teams' ? mergeTeam(old, r) : mergeRecords(old, r, USER_FIELDS[store]);
			});
			if (merged.length) await repo.bulkPut(store, merged);
		}
	}
	return { mode, games: data.games.length, sets: data.sets.length, teams: data.teams.length, settings: data.settings.length };
}
