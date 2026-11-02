import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { Dex, fixtureIds, loadFixture } from '../helpers.js';
import { parseLog } from '../../src/core/parser.js';
import { openRepo, gameRecordFromParsed } from '../../src/store/repo.js';
import { openDb, MIGRATIONS } from '../../src/store/idb.js';
import { compressText, decompressText, canCompress } from '../../src/store/compress.js';
import { exportAll, importData, ImportError } from '../../src/store/export.js';

const parseFn = (raw, old) => parseLog(raw, { me: old.me, dex: Dex });

function makeRecord(id, ts) {
	const fx = loadFixture(id);
	const parsed = parseLog(fx.log, { me: fx.players[0], dex: Dex });
	return { ...gameRecordFromParsed(parsed, { roomid: 'battle-' + id, ts }), rawLog: fx.log };
}

const ids = fixtureIds();
let repo;

beforeEach(async () => {
	repo = await openRepo({ indexedDB: new IDBFactory() });
});
afterEach(() => repo.close());

const strip = d => ({ ...d, exportedAt: 0 });

test('compress round trip, gzip and plain', async () => {
	assert.equal(canCompress(), true);
	const text = loadFixture(ids[0]).log;
	const z = await compressText(text);
	assert.equal(z.enc, 'gzip');
	assert.ok(z.data.length < text.length);
	assert.equal(await decompressText(z.data, z.enc), text);
	assert.equal(await decompressText('plain text', 'plain'), 'plain text');
});

test('putGame/getGame store a compressed raw log and defaults', async () => {
	const rec = makeRecord(ids[0], 1000);
	await repo.putGame(rec);
	const got = await repo.getGame(rec.roomid);
	assert.equal(got.rawEnc, 'gzip');
	assert.ok(got.rawLog instanceof Uint8Array);
	assert.equal(got.parserVersion, rec.parserVersion);
	assert.deepEqual([got.notes, got.reviewed, got.tags], ['', false, []]);
	assert.equal(await repo.getRawLog(rec.roomid), loadFixture(ids[0]).log);
	assert.deepEqual(got.picks, rec.picks);
	assert.equal(await repo.getGame('nope'), null);
});

test('plain fallback when CompressionStream is missing', async () => {
	const saved = globalThis.CompressionStream;
	globalThis.CompressionStream = undefined;
	try {
		const rec = makeRecord(ids[1], 5);
		await repo.putGame(rec);
		const got = await repo.getGame(rec.roomid);
		assert.equal(got.rawEnc, 'plain');
		assert.equal(typeof got.rawLog, 'string');
		assert.equal(await repo.getRawLog(rec.roomid), rec.rawLog);
	} finally {
		globalThis.CompressionStream = saved;
	}
});

test('list/filter/count/delete games', async () => {
	const recs = ids.slice(0, 6).map((id, i) => makeRecord(id, 1000 + i));
	for (const r of recs) await repo.putGame(r);
	assert.equal(await repo.countGames(), 6);
	const all = await repo.listGames();
	assert.deepEqual(all.map(g => g.ts), [1005, 1004, 1003, 1002, 1001, 1000]);
	assert.equal((await repo.listGames({ limit: 2 })).length, 2);
	assert.equal((await repo.listGames({ from: 1002, to: 1003 })).length, 2);
	const fmt = recs[0].format;
	assert.equal((await repo.listGames({ format: fmt })).length, recs.filter(r => r.format === fmt).length);
	const wins = recs.filter(r => r.result === 'win').length;
	assert.equal(await repo.countGames({ result: 'win' }), wins);
	const withSet = recs.filter(r => r.setId);
	if (withSet.length) assert.ok((await repo.listGames({ setId: withSet[0].setId })).length >= 1);
	await repo.putGame({ ...recs[0], reviewed: true, tags: ['scout'] });
	assert.equal((await repo.listGames({ reviewed: true })).length, 1);
	assert.equal((await repo.listGames({ tag: 'scout' })).length, 1);
	await repo.deleteGame(recs[0].roomid);
	assert.equal(await repo.countGames(), 5);
});

test('putGame keeps stored user fields when the caller omits them', async () => {
	const rec = makeRecord(ids[0], 1);
	await repo.putGame({ ...rec, notes: 'bad lead', reviewed: true, tags: ['x'] });
	await repo.putGame(rec);
	const got = await repo.getGame(rec.roomid);
	assert.deepEqual([got.notes, got.reviewed, got.tags], ['bad lead', true, ['x']]);
});

test('sets, teams, settings', async () => {
	await repo.putSet({ id: 'game-bestof3-x-1', format: 'f', games: ['a'], ts: 2, tags: ['t'] });
	await repo.putSet({ id: 'game-bestof3-x-1', format: 'f', games: ['a', 'b'], ts: 2 });
	const s = await repo.getSet('game-bestof3-x-1');
	assert.deepEqual(s.games, ['a', 'b']);
	assert.deepEqual(s.tags, ['t']);
	assert.equal((await repo.listSets({ format: 'g' })).length, 0);
	assert.equal((await repo.listSets()).length, 1);

	await repo.upsertTeam({ id: 'h1', roster: ['A'], name: 'Rain', firstSeen: 10, lastSeen: 20 });
	await repo.upsertTeam({ id: 'h1', roster: ['A'], firstSeen: 5, lastSeen: 15 });
	const [t] = await repo.listTeams();
	assert.deepEqual([t.name, t.firstSeen, t.lastSeen], ['Rain', 5, 20]);

	assert.equal(await repo.getSetting('formats', 'dflt'), 'dflt');
	await repo.setSetting('formats', ['a']);
	assert.deepEqual(await repo.getSetting('formats'), ['a']);
});

test('bulkPut, clearAll, unknown store', async () => {
	await repo.bulkPut('games', ids.slice(0, 3).map((id, i) => makeRecord(id, i)));
	assert.equal(await repo.countGames(), 3);
	await assert.rejects(() => repo.bulkPut('meta', []), /unknown store/);
	await repo.clearAll();
	assert.equal(await repo.countGames(), 0);
	assert.equal(await repo.getSchemaVersion(), 1);
});

test('migration: v1 baseline and no-op v1 -> v2 keep data', async () => {
	const factory = new IDBFactory();
	const r1 = await openRepo({ indexedDB: factory, name: 'mig', broadcast: false });
	assert.equal(await r1.getSchemaVersion(), 1);
	await r1.putGame(makeRecord(ids[0], 1));
	r1.close();

	let ran = 0;
	const v2 = [...MIGRATIONS, { version: 2, up() { ran++; } }];
	const r2 = await openRepo({ indexedDB: factory, name: 'mig', migrations: v2, broadcast: false });
	assert.equal(ran, 1);
	assert.equal(r2.db.version, 2);
	assert.equal(await r2.getSchemaVersion(), 2);
	assert.equal(await r2.countGames(), 1);
	r2.close();

	const r3 = await openRepo({ indexedDB: factory, name: 'mig', migrations: v2, broadcast: false });
	assert.equal(ran, 1);
	r3.close();
});

test('failing migration rejects', async () => {
	const bad = [...MIGRATIONS, { version: 2, up() { throw new Error('boom'); } }];
	await assert.rejects(openDb({ indexedDB: new IDBFactory(), migrations: bad }), /boom/);
});

test('reparseAll rebuilds parsed fields and preserves user fields', async () => {
	const recs = ids.slice(0, 3).map((id, i) => makeRecord(id, 100 + i));
	for (const r of recs) await repo.putGame({ ...r, notes: 'n-' + r.roomid, reviewed: true, tags: ['k'] });
	// corrupt parsed fields as if an old parser produced them
	for (const r of recs) {
		const g = await repo.getGame(r.roomid);
		await repo.bulkPut('games', [{ ...g, picks: { p1: [], p2: [] }, turns: -1, parserVersion: 0 }]);
	}
	const res = await repo.reparseAll(parseFn);
	assert.deepEqual(res, { updated: 3, failed: [] });
	for (const r of recs) {
		const g = await repo.getGame(r.roomid);
		assert.deepEqual(g.picks, r.picks);
		assert.equal(g.turns, r.turns);
		assert.equal(g.parserVersion, r.parserVersion);
		assert.equal(g.me, r.me);
		assert.equal(g.ts, r.ts);
		assert.deepEqual([g.notes, g.reviewed, g.tags], ['n-' + r.roomid, true, ['k']]);
		assert.equal(await repo.getRawLog(r.roomid), r.rawLog);
	}
});

test('reparseAll reports failures per game and keeps the old record', async () => {
	const rec = makeRecord(ids[0], 1);
	await repo.putGame(rec);
	const nolog = { ...makeRecord(ids[1], 2) };
	delete nolog.rawLog;
	await repo.putGame(nolog);
	const res = await repo.reparseAll(() => { throw new Error('nope'); });
	assert.equal(res.updated, 0);
	assert.equal(res.failed.length, 2);
	assert.equal((await repo.getGame(rec.roomid)).turns, rec.turns);
});

test('export -> clear -> import round trip equality', async () => {
	const recs = ids.map((id, i) => makeRecord(id, 500 + i));
	for (const r of recs) await repo.putGame({ ...r, notes: 'note ' + r.roomid, tags: ['a', 'b'] });
	await repo.putSet({ id: 'game-bestof3-x-1', format: 'f', games: [recs[0].roomid], ts: 1, notes: 'set note' });
	await repo.upsertTeam({ id: 'h1', roster: ['A', 'B'], name: 'Team', firstSeen: 1, lastSeen: 2 });
	await repo.setSetting('formats', ['gen9']);
	const before = await exportAll(repo);
	const json = JSON.stringify(before);
	assert.equal(before.games.length, ids.length);
	assert.equal(before.games[0].rawEnc, 'gzip-base64');
	assert.equal(typeof before.games[0].rawLog, 'string');

	await repo.clearAll();
	assert.equal(await repo.countGames(), 0);
	const res = await importData(repo, json, { mode: 'replace' });
	assert.equal(res.games, ids.length);
	assert.deepEqual(strip(await exportAll(repo)), strip(JSON.parse(json)));
	assert.equal(await repo.getRawLog(recs[0].roomid), recs[0].rawLog);
});

test('round trip of plain-encoded raw logs', async () => {
	const saved = globalThis.CompressionStream;
	globalThis.CompressionStream = undefined;
	try {
		await repo.putGame(makeRecord(ids[0], 1));
	} finally {
		globalThis.CompressionStream = saved;
	}
	const before = await exportAll(repo);
	assert.equal(before.games[0].rawEnc, 'plain');
	await importData(repo, before, { mode: 'replace' });
	assert.deepEqual(strip(await exportAll(repo)), strip(before));
});

test('merge: newer wins, user fields not clobbered by empty values, new keys added', async () => {
	const a = makeRecord(ids[0], 1);
	const b = makeRecord(ids[1], 2);
	const c = makeRecord(ids[2], 3);
	await repo.putGame({ ...a, notes: 'mine', reviewed: true, tags: ['t'], updatedAt: 100, turns: 1 });
	await repo.putGame({ ...b, notes: 'keep', updatedAt: 500, turns: 2 });
	await repo.putSet({ id: 's1', notes: 'set mine', tags: [], updatedAt: 10 });
	await repo.upsertTeam({ id: 'h1', name: 'Rain', firstSeen: 10, lastSeen: 20, updatedAt: 1 });
	await repo.setSetting('k', 'old');

	const incoming = {
		schemaVersion: 1,
		exportedAt: 0,
		games: [
			{ ...a, notes: '', reviewed: false, tags: [], updatedAt: 200, turns: 99, rawEnc: 'plain', rawLog: 'x' },
			{ ...b, notes: 'older', updatedAt: 400, turns: 98, rawEnc: 'plain', rawLog: 'x' },
			{ ...c, updatedAt: 1, rawEnc: 'plain', rawLog: 'z' },
		],
		sets: [{ id: 's1', notes: '', tags: ['x'], updatedAt: 20 }],
		teams: [{ id: 'h1', name: '', firstSeen: 5, lastSeen: 15, updatedAt: 2 }],
		settings: [{ name: 'k', value: 'new', updatedAt: Date.now() + 1000 }],
	};
	await importData(repo, incoming, { mode: 'merge' });

	const ga = await repo.getGame(a.roomid);
	assert.equal(ga.turns, 99);
	assert.deepEqual([ga.notes, ga.reviewed, ga.tags], ['mine', true, ['t']]);
	const gb = await repo.getGame(b.roomid);
	assert.deepEqual([gb.turns, gb.notes], [2, 'keep']);
	assert.equal((await repo.getGame(c.roomid)).rawLog, 'z');
	assert.equal(await repo.countGames(), 3);
	const s = await repo.getSet('s1');
	assert.deepEqual([s.notes, s.tags], ['set mine', ['x']]);
	const [t] = await repo.listTeams();
	assert.deepEqual([t.name, t.firstSeen, t.lastSeen], ['Rain', 5, 20]);
	assert.equal(await repo.getSetting('k'), 'new');
});

test('merge of an export into the same store is idempotent', async () => {
	for (let i = 0; i < 3; i++) await repo.putGame(makeRecord(ids[i], i));
	const before = await exportAll(repo);
	await importData(repo, before, { mode: 'merge' });
	assert.deepEqual(strip(await exportAll(repo)), strip(before));
});

test('corrupt or invalid imports are rejected without touching data', async () => {
	await repo.putGame(makeRecord(ids[0], 1));
	const good = await exportAll(repo);
	const bad = [
		['not json', 'not json', /not valid JSON/],
		['array', [], /expected a JSON object/],
		['no version', { ...good, schemaVersion: undefined }, /schemaVersion/],
		['future version', { ...good, schemaVersion: 99 }, /newer/],
		['games not array', { ...good, games: {} }, /"games" must be an array/],
		['game without roomid', { ...good, games: [{ notes: '' }] }, /games\[0\]/],
		['bad base64', { ...good, games: [{ ...good.games[0], rawLog: '!!!not base64!!!' }] }, /base64/],
		['not gzip', { ...good, games: [{ ...good.games[0], rawLog: btoa('hello world') }] }, /not gzip/],
		['unknown rawEnc', { ...good, games: [{ ...good.games[0], rawEnc: 'zip' }] }, /unknown rawEnc/],
		['truncated json', JSON.stringify(good).slice(0, 200), /not valid JSON/],
	];
	for (const [name, input, re] of bad) {
		await assert.rejects(() => importData(repo, input, { mode: 'replace' }), err => err instanceof ImportError && re.test(err.message), name);
	}
	await assert.rejects(() => importData(repo, good, { mode: 'bogus' }), /Unknown import mode/);
	assert.equal(await repo.countGames(), 1);
});

test('BroadcastChannel notifies other repo instances; absence is tolerated', async () => {
	const factory = new IDBFactory();
	const a = await openRepo({ indexedDB: factory, name: 'bc' });
	const b = await openRepo({ indexedDB: factory, name: 'bc' });
	const got = new Promise(resolve => b.onChange(resolve));
	await a.putGame(makeRecord(ids[0], 1));
	const msg = await got;
	assert.deepEqual(msg, { type: 'change', store: 'games', keys: ['battle-' + ids[0]] });
	a.close();
	b.close();

	const saved = globalThis.BroadcastChannel;
	globalThis.BroadcastChannel = undefined;
	try {
		const c = await openRepo({ indexedDB: factory, name: 'bc' });
		await c.setSetting('x', 1);
		c.close();
	} finally {
		globalThis.BroadcastChannel = saved;
	}
});

test('requestPersistence never throws', async () => {
	assert.equal(typeof (await repo.requestPersistence()), 'boolean');
});
