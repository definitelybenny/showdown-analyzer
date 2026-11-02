import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { Dex, fixtureIds, loadFixture } from '../helpers.js';
import { parseLog } from '../../src/core/parser.js';
import { splitMessage } from '../../src/host/hook.js';
import { openRepo } from '../../src/store/repo.js';
import { startCapture } from '../../src/capture/index.js';
import { assembleSet, readRequest, applyRequest } from '../../src/capture/record.js';
import { replayIdFor, isPrivateRoom } from '../../src/capture/backfill.js';

const P = 'gen9championsvgc2026regmcbo3-';
const SET_A = { wrapper: 'game-bestof3-' + P + '2708057021', games: ['2708057022', '2708057976', '2708058877'], me: 'ReanSchwarzer_VGC' };
const SET_D = { wrapper: 'game-bestof3-' + P + '2708106167', games: ['2708106168', '2708107431'], me: 'mattiepowney' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- fake host ---------------------------------------------------------------------

function makeHost(user) {
	const listeners = new Set();
	const host = {
		user,
		teams: [],
		queues: {},
		onMessage(fn) {
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		getUserName: () => host.user,
		getMyTeams: () => host.teams,
		getBattleLog: id => host.queues[id] || null,
		/** Deliver a raw server message (">room\n|line...") the way the hook normalizes it. */
		receive(msg) {
			for (const b of splitMessage(msg)) for (const fn of listeners) fn({ type: 'in', roomid: b.roomid, lines: b.lines });
		},
		send(roomid, text) {
			for (const fn of listeners) fn({ type: 'out', roomid, lines: [text] });
		},
	};
	return host;
}

const msg = (roomid, lines) => `>${roomid}\n${lines.join('\n')}`;

function showteamPacked(lines, side) {
	return lines.find(l => l.indexOf(`|showteam|${side}|`) === 0).slice(`|showteam|${side}|`.length);
}

/** Preview + chosen requests for `side`, derived from the log; the chosen order is the REVERSED switch order. */
function requestsFor(lines, side) {
	const g = parseLog(lines, { dex: Dex });
	const pokemon = g.teams[side].map(t => ({ details: `${t.species}, L50`, item: t.item, active: false }));
	const picks = g.picks[side].slice().reverse();
	for (const t of g.teams[side]) if (picks.length < 4 && !picks.includes(t.species)) picks.push(t.species); // unrevealed backs
	const chosen = picks.map((sp, i) => ({ details: `${sp}, L50`, item: '', active: i < 2 }));
	const id = side;
	return {
		preview: '|request|' + JSON.stringify({ teamPreview: true, maxChosenTeamSize: 4, side: { id, pokemon } }),
		chosen: '|request|' + JSON.stringify({ active: [{}], side: { id, pokemon: chosen } }),
		picks,
	};
}

/** Feed one game to the host as server messages: init block, then chunks; requests around team preview. */
function feedGame(host, id, opts = {}) {
	const roomid = 'battle-' + id;
	const lines = loadFixture(id).log.split('\n');
	const me = opts.me;
	const side = me ? (parseLog(lines).players.p1.name === me ? 'p1' : 'p2') : null;
	const req = me && opts.requests !== false ? requestsFor(lines, side) : null;
	const from = opts.from || 0;
	const until = opts.until === undefined ? lines.length : opts.until;
	const body = lines.slice(from, until);
	const startAt = body.findIndex(l => l === '|start');
	host.receive(msg(roomid, ['|init|battle', '|title|A vs. B']));
	if (req && opts.sendChosen) host.receive(msg(roomid, [req.chosen]));
	const step = 17;
	for (let i = 0; i < body.length; i += step) {
		const chunk = body.slice(i, i + step);
		if (req && startAt >= i && startAt < i + step) {
			host.receive(msg(roomid, [req.preview]));
			host.receive(msg(roomid, chunk));
			host.receive(msg(roomid, [req.chosen]));
		} else {
			host.receive(msg(roomid, chunk));
		}
	}
	return { roomid, req, lines };
}

// ---- harness -----------------------------------------------------------------------

let repo;
let host;
let capture;
let fetchLog;

async function setup(user, extra = {}) {
	repo = await openRepo({ indexedDB: new IDBFactory(), broadcast: false });
	host = makeHost(user);
	fetchLog = [];
	capture = startCapture({ repo, host, dex: Dex, settleMs: extra.settleMs ?? 10, fetchFn: extra.fetchFn || (async url => { fetchLog.push(url); return { ok: false, status: 404 }; }) });
	await capture.refreshSettings();
}

const origWarn = console.warn;
beforeEach(() => {
	console.warn = () => {};
});
afterEach(() => {
	console.warn = origWarn;
	if (capture) capture.stop();
	if (repo) repo.close();
	capture = null;
	repo = null;
});

// ---- tests -------------------------------------------------------------------------

test('a full Bo3 set is captured: games, set, teams, request picks', async () => {
	await setup(SET_A.me);
	host.teams = [{ name: 'Sand Mega', format: 'gen9championsvgc2026regmc', packed: '' }];
	const first = loadFixture(P + SET_A.games[0]).log.split('\n');
	host.teams[0].packed = showteamPacked(first, 'p1');
	for (const n of SET_A.games) feedGame(host, P + n, { me: SET_A.me });
	await capture.flush();

	const games = await repo.listGames();
	assert.equal(games.length, 3);
	const g1 = await repo.getGame('battle-' + P + SET_A.games[0]);
	assert.equal(g1.me, SET_A.me);
	assert.equal(g1.setId, SET_A.wrapper);
	assert.equal(g1.gameNumber, 1);
	assert.equal(g1.partial, false);
	assert.equal(g1.picksSource, 'request');
	assert.deepEqual(g1.picks[g1.side], requestsFor(first, g1.side).picks);
	assert.deepEqual(g1.picksSwitch.picks, parseLog(first, { dex: Dex }).picks[g1.side]);
	assert.equal(g1.picks[g1.side].length, 4);
	assert.equal(g1.leads[g1.side].length, 2);
	assert.ok(!(await repo.getRawLog(g1.roomid)).includes('|request|'));
	assert.equal(g1.myTeamName, 'Sand Mega');

	const set = await repo.getSet(SET_A.wrapper);
	assert.equal(set.complete, true);
	assert.equal(set.result, 'win');
	assert.deepEqual(set.score, { me: 2, opp: 1 });
	assert.deepEqual(set.games, SET_A.games.map(n => 'battle-' + P + n));
	assert.equal(set.ratingBefore, 1296);
	assert.equal(set.ratingDelta, set.ratingAfter - set.ratingBefore);

	const teams = await repo.listTeams();
	const mine = teams.filter(t => t.mine);
	assert.equal(mine.length, 1);
	assert.equal(mine[0].name, 'Sand Mega');
	assert.equal(mine[0].roster.length, 6);
	assert.ok(teams.length >= 2);
	const st = capture.captureStatus();
	assert.equal(st.savedCount, 3);
	assert.equal(st.hint, '');
	assert.equal(st.lastSaved.setId, SET_A.wrapper);
});

test('re-feeding the same games is idempotent', async () => {
	await setup(SET_A.me);
	for (const n of SET_A.games) feedGame(host, P + n, { me: SET_A.me });
	await capture.flush();
	const before = { games: await repo.listGames(), sets: await repo.listSets(), teams: await repo.listTeams() };
	for (const n of SET_A.games) feedGame(host, P + n, { me: SET_A.me });
	await capture.flush();
	const after = { games: await repo.listGames(), sets: await repo.listSets(), teams: await repo.listTeams() };
	assert.equal(after.games.length, 3);
	assert.equal(after.sets.length, 1);
	assert.equal(after.teams.length, before.teams.length);
	const strip = g => ({ ...g, updatedAt: 0 });
	assert.deepEqual(after.games.map(strip), before.games.map(strip));
	const unrelated = { ...after.sets[0], updatedAt: 0 };
	assert.deepEqual(unrelated, { ...before.sets[0], updatedAt: 0 });
});

test('rating lines that arrive after |win| update the saved game and set', async () => {
	await setup(SET_A.me, { settleMs: 15 });
	const id = P + SET_A.games[2];
	const lines = loadFixture(id).log.split('\n');
	const winAt = lines.findIndex(l => l.indexOf('|win|') === 0);
	const raws = lines.filter(l => /^\|raw\|.*rating:/.test(l));
	assert.equal(raws.length, 2);
	feedGame(host, id, { me: SET_A.me, until: winAt + 1 });
	await sleep(80);
	let g = await repo.getGame('battle-' + id);
	assert.ok(g, 'saved after the settle delay');
	assert.equal(g.ratings.p1, null);
	assert.equal((await repo.getSet(SET_A.wrapper)).ratingDelta, null);

	host.receive(msg('battle-' + id, raws));
	await capture.flush();
	g = await repo.getGame('battle-' + id);
	assert.equal(g.ratings.p1.before, 1296);
	const set = await repo.getSet(SET_A.wrapper);
	assert.equal(typeof set.ratingDelta, 'number');
	assert.equal(set.ratingBefore, 1296);
	assert.equal((await repo.listGames()).length, 1);
});

test('the write waits for the settle delay or room close, not longer', async () => {
	await setup(SET_A.me, { settleMs: 60000 });
	const id = P + SET_A.games[0];
	const { roomid } = feedGame(host, id, { me: SET_A.me });
	await sleep(30);
	assert.equal(await repo.getGame(roomid), null);
	host.send(roomid, '/noreply /leave');
	await capture.flush();
	assert.ok(await repo.getGame(roomid));
});

test('a game that ended but whose room closes via |deinit| is saved', async () => {
	await setup(SET_A.me, { settleMs: 60000 });
	const { roomid } = feedGame(host, P + SET_A.games[1], { me: SET_A.me });
	host.receive(msg(roomid, ['|deinit|']));
	await capture.flush();
	assert.ok(await repo.getGame(roomid));
});

test('a game left before it ended is not saved', async () => {
	await setup(SET_A.me);
	const id = P + SET_A.games[0];
	const lines = loadFixture(id).log.split('\n');
	const { roomid } = feedGame(host, id, { me: SET_A.me, until: lines.findIndex(l => l.indexOf('|turn|3') === 0) });
	host.send(roomid, '/leave');
	await capture.flush();
	assert.equal((await repo.listGames()).length, 0);
	assert.equal(capture.captureStatus().live.length, 1);
});

test('late user name: nothing saved as a guest, saved once |updateuser| names the user', async () => {
	await setup('');
	host.receive('|updateuser| Guest 4821|0|1|{}');
	const { roomid } = feedGame(host, P + SET_A.games[0], { me: SET_A.me });
	await capture.flush();
	assert.equal((await repo.listGames()).length, 0);
	assert.match(capture.captureStatus().hint, /Log in/);
	assert.equal(capture.captureStatus().live[0].roomid, roomid);

	host.receive(`|updateuser| ${SET_A.me}|1|cheren-gen5bw2|{}`);
	await capture.flush();
	const g = await repo.getGame(roomid);
	assert.equal(g.me, SET_A.me);
	assert.equal(capture.captureStatus().hint, '');
	assert.equal(capture.captureStatus().live.length, 0);
});

test('a guest who never logs in saves nothing and sees the hint', async () => {
	await setup('');
	host.receive('|updateuser| Guest 77|0|1|{}');
	feedGame(host, P + SET_D.games[0], { me: SET_D.me });
	feedGame(host, P + SET_D.games[1], { me: SET_D.me });
	await capture.flush();
	assert.deepEqual([await repo.countGames(), (await repo.listSets()).length, (await repo.listTeams()).length], [0, 0, 0]);
	assert.ok(capture.captureStatus().hint);
});

test('spectating (user is neither player) and untracked formats are not saved', async () => {
	await setup('SomeoneElse');
	feedGame(host, P + SET_A.games[0]);
	host.receive(msg('battle-gen9ou-123', ['|init|battle', '|player|p1|a|1|', '|player|p2|b|1|', '|win|a']));
	host.receive(msg(SET_A.wrapper, ['|html|<h2>Game 1</h2>']));
	await capture.flush();
	assert.equal(await repo.countGames(), 0);
});

test('tracked formats come from the setting and are user-editable', async () => {
	await setup(SET_A.me);
	await repo.setSetting('trackedFormats', ['^gen9nothing']);
	await capture.refreshSettings();
	feedGame(host, P + SET_A.games[0], { me: SET_A.me });
	await capture.flush();
	assert.equal(await repo.countGames(), 0);
	await repo.setSetting('trackedFormats', ['vgc']);
	await capture.refreshSettings();
	feedGame(host, P + SET_A.games[0], { me: SET_A.me });
	await capture.flush();
	assert.equal(await repo.countGames(), 1);
});

test('without requests the switch order is used for picks and leads', async () => {
	await setup(SET_A.me);
	const { roomid, lines } = feedGame(host, P + SET_A.games[0], { me: SET_A.me, requests: false });
	await capture.flush();
	const g = await repo.getGame(roomid);
	const parsed = parseLog(lines, { me: SET_A.me, dex: Dex });
	assert.equal(g.picksSource, 'switch');
	assert.equal(g.picksRequest, null);
	assert.deepEqual(g.picks[g.side], parsed.picks[g.side]);
});

test('forfeited game: result, end reason and forfeiter are recorded', async () => {
	await setup(SET_A.me);
	let found = null;
	for (const n of fixtureIds().filter(x => x.indexOf(P) === 0).map(x => x.slice(P.length))) {
		const p = parseLog(loadFixture(P + n).log, { dex: Dex });
		if (p.end === 'forfeit') {
			found = { n, p };
			break;
		}
	}
	assert.ok(found, 'a forfeit fixture exists');
	const me = found.p.players.p1.name;
	feedGame(host, P + found.n, { me });
	await capture.flush();
	const g = await repo.getGame('battle-' + P + found.n);
	assert.equal(g.end, 'forfeit');
	assert.equal(g.forfeiter, found.p.forfeiter);
	assert.equal(g.result, found.p.winner.side === 'p1' ? 'win' : 'loss');
});

test('assembleSet: a forfeit decides an unfinished set', () => {
	const mk = (n, winner, end) => {
		const g = parseLog(loadFixture(P + SET_D.games[0]).log, { me: SET_D.me, dex: Dex });
		return { ...g, roomid: 'battle-x' + n, ts: n, bo3: { ...g.bo3, gameNumber: n }, winner: { side: winner, name: '' }, end, ratings: { p1: null, p2: null } };
	};
	const p1 = parseLog(loadFixture(P + SET_D.games[0]).log, { dex: Dex }).players.p1.name;
	const set = assembleSet([mk(1, 'p1', 'win'), mk(2, 'p2', 'forfeit')], p1);
	assert.equal(set.complete, true);
	assert.equal(set.forfeit, true);
	assert.equal(set.result, 'loss');
	assert.equal(assembleSet([mk(1, 'p1', 'win')], p1).result, null);
});

test('mid-game join: partial record, then backfilled from the replay JSON', async () => {
	const id = P + SET_A.games[0];
	const full = loadFixture(id);
	const fetched = [];
	await setup(SET_A.me, {
		fetchFn: async url => {
			fetched.push(url);
			return { ok: true, status: 200, json: async () => ({ id, log: full.log }) };
		},
	});
	const lines = full.log.split('\n');
	const startAt = lines.findIndex(l => l === '|start');
	const { roomid } = feedGame(host, id, { me: SET_A.me, from: startAt + 1, sendChosen: true });
	await capture.flush();
	assert.deepEqual(fetched, [`https://replay.pokemonshowdown.com/${id}.json`]);
	const g = await repo.getGame(roomid);
	assert.equal(g.partial, false);
	assert.equal(g.backfill, 'replay');
	assert.equal(g.roster[g.side].length, 6);
	assert.deepEqual(g.picks[g.side], parseLog(lines, { me: SET_A.me, dex: Dex }).picks[g.side]);
	assert.equal((await repo.listGames()).length, 1);
});

test('mid-game join: the partial record is saved even when backfill fails (non-fatal)', async () => {
	await setup(SET_A.me);
	const id = P + SET_A.games[0];
	const lines = loadFixture(id).log.split('\n');
	const { roomid } = feedGame(host, id, { me: SET_A.me, from: lines.findIndex(l => l === '|start') + 1, sendChosen: true });
	await capture.flush();
	const g = await repo.getGame(roomid);
	assert.equal(g.partial, true);
	assert.ok(['win', 'loss'].includes(g.result), 'outcome known from the |win| name and request side');
	assert.equal(g.backfill, undefined);
	assert.equal(fetchLog.length, 1);
	assert.ok(capture.captureStatus().errors.some(e => /backfill/.test(e.message)));
});

test('mid-game join: stepQueue from the host is preferred over the network', async () => {
	await setup(SET_A.me);
	const id = P + SET_A.games[0];
	const lines = loadFixture(id).log.split('\n');
	host.queues['battle-' + id] = lines;
	const { roomid } = feedGame(host, id, { me: SET_A.me, from: lines.findIndex(l => l === '|start') + 1, sendChosen: true });
	await capture.flush();
	const g = await repo.getGame(roomid);
	assert.equal(g.partial, false);
	assert.equal(g.backfill, 'stepQueue');
	assert.equal(fetchLog.length, 0);
});

test('a worse partial rewrite never replaces a complete stored game', async () => {
	await setup(SET_A.me);
	const id = P + SET_A.games[0];
	feedGame(host, id, { me: SET_A.me });
	await capture.flush();
	const lines = loadFixture(id).log.split('\n');
	feedGame(host, id, { me: SET_A.me, from: lines.findIndex(l => l === '|start') + 1, sendChosen: true });
	await capture.flush();
	assert.equal((await repo.getGame('battle-' + id)).partial, false);
});

test('status events notify subscribers', async () => {
	await setup(SET_A.me);
	let calls = 0;
	const off = capture.onChange(() => calls++);
	feedGame(host, P + SET_A.games[0], { me: SET_A.me });
	await capture.flush();
	off();
	assert.ok(calls > 0);
	assert.ok(['win', 'loss'].includes(capture.captureStatus().lastSaved.result));
});

test('request helpers and replay ids', () => {
	const st = { side: null, preview: null, maxChosen: 0, chosen: null };
	applyRequest(st, readRequest('not json'));
	applyRequest(st, readRequest({ teamPreview: true, maxChosenTeamSize: 4, side: { id: 'p2', pokemon: [{ details: 'Garchomp, L50, M', item: 'garchompite' }] } }));
	applyRequest(st, readRequest({ side: { id: 'p2', pokemon: [{ details: 'Garchomp-Mega-Z, L50', active: true }] } }));
	applyRequest(st, readRequest({ side: { id: 'p2', pokemon: [{ details: 'Other, L50' }] } }));
	assert.equal(st.side, 'p2');
	assert.deepEqual(st.preview.map(p => p.species), ['Garchomp']);
	assert.deepEqual(st.chosen.map(p => p.species), ['Garchomp']);
	assert.equal(replayIdFor('battle-gen9vgc2025regg-123'), 'gen9vgc2025regg-123');
	assert.equal(replayIdFor('battle-gen9vgc2025regg-123-abcdef'), null);
	assert.equal(isPrivateRoom('battle-gen9vgc2025regg-123-abcdef'), true);
});
