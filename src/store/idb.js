// Thin promise wrapper over IndexedDB plus the schema migration runner. No globals beyond an optional default factory.

export const DB_NAME = 'showdown-analyzer';
export const STORES = { games: 'roomid', sets: 'id', teams: 'id', settings: 'name', meta: 'key' };

/**
 * Ordered migrations. `version` is the IndexedDB version after `up` ran; `up(db, tx)` runs inside the
 * versionchange transaction. v1 is the baseline schema.
 */
export const MIGRATIONS = [
	{
		version: 1,
		up(db, tx) {
			for (const [name, keyPath] of Object.entries(STORES)) {
				if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
			}
			tx.objectStore('meta').put({ key: 'schemaVersion', value: 1 });
		},
	},
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Promise for an IDBRequest. */
export function req(r) {
	return new Promise((resolve, reject) => {
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});
}

/** Promise that settles when a transaction completes or fails. */
export function txDone(tx) {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
	});
}

/**
 * Open (and migrate) the database.
 * @param {{name?: string, indexedDB?: IDBFactory, migrations?: object[]}} [opts]
 */
export function openDb(opts) {
	const o = opts || {};
	const factory = o.indexedDB || (typeof indexedDB !== 'undefined' ? indexedDB : null);
	if (!factory) return Promise.reject(new Error('IndexedDB is not available'));
	const migrations = (o.migrations || MIGRATIONS).slice().sort((a, b) => a.version - b.version);
	const target = migrations[migrations.length - 1].version;
	return new Promise((resolve, reject) => {
		const r = factory.open(o.name || DB_NAME, target);
		r.onupgradeneeded = ev => {
			const db = r.result;
			const tx = r.transaction;
			try {
				for (const m of migrations) {
					if (m.version > ev.oldVersion) {
						m.up(db, tx);
						tx.objectStore('meta').put({ key: 'schemaVersion', value: m.version });
					}
				}
			} catch (e) {
				tx.abort();
				reject(e);
			}
		};
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
		r.onblocked = () => reject(new Error('Database upgrade blocked by another open tab'));
	});
}

/** Run `fn(stores)` in one transaction over `names`; resolves with fn's result after commit. */
export async function withTx(db, names, mode, fn) {
	const tx = db.transaction(names, mode);
	const done = txDone(tx);
	const stores = {};
	for (const n of [].concat(names)) stores[n] = tx.objectStore(n);
	let result;
	try {
		result = await fn(stores);
	} catch (e) {
		try { tx.abort(); } catch (_) { /* already finished */ }
		done.catch(() => {});
		throw e;
	}
	await done;
	return result;
}

/** Ask the browser for persistent storage. Best effort: resolves false when unsupported or denied. */
export async function requestPersistence() {
	try {
		if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.persist) return false;
		if (navigator.storage.persisted && await navigator.storage.persisted()) return true;
		return !!(await navigator.storage.persist());
	} catch (e) {
		return false;
	}
}
