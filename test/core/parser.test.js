import test from 'node:test';
import assert from 'node:assert/strict';
import { LogParser, parseLog, parseDetails, parseIdent, resolveSide } from '../../src/core/parser.js';
import { PARSER_VERSION } from '../../src/core/schema.js';
import { fixtureIds, loadFixture, loadExpected, keyFields, Dex } from '../helpers.js';

const ids = fixtureIds();

function summarize(g) {
	return {
		players: [g.players.p1.name, g.players.p2.name],
		ratingAtStart: [g.players.p1.rating, g.players.p2.rating],
		winner: g.winner && g.winner.name,
		end: g.end,
		forfeiter: g.forfeiter,
		turns: g.turns,
		bo3: g.bo3 && { wrapperId: g.bo3.wrapperId, gameNumber: g.bo3.gameNumber, score: g.bo3.score },
		roster: { p1: g.roster.p1.map(r => r.species), p2: g.roster.p2.map(r => r.species) },
		showteamSpecies: { p1: g.teams.p1.map(t => t.species), p2: g.teams.p2.map(t => t.species) },
		picks: g.picks,
		leads: g.leads,
		mega: { p1: g.mega.p1.map(m => m.forme), p2: g.mega.p2.map(m => m.forme) },
		tera: g.tera,
		ratings: g.ratings,
	};
}

test('fixtures exist', () => {
	assert.ok(ids.length >= 12, `expected 12+ fixtures, got ${ids.length}`);
});

for (const id of ids) {
	test(`fixture ${id} matches hand-verified expectations`, () => {
		const d = loadFixture(id);
		const exp = loadExpected(id);
		const withDex = parseLog(d.log, { dex: Dex });
		const without = parseLog(d.log, {});
		const { id: _id, format, ...want } = exp;
		assert.equal(withDex.format, format);
		assert.deepEqual({ ...summarize(withDex) }, { ...want });
		assert.deepEqual(keyFields(without), keyFields(withDex), 'dex-less parse must agree on key fields');
		assert.equal(withDex.parserVersion, PARSER_VERSION);
		assert.equal(withDex.complete, true);
		assert.deepEqual(withDex.warnings, []);
	});

	test(`fixture ${id} is idempotent and streaming-equivalent`, () => {
		const d = loadFixture(id);
		const lines = d.log.split('\n');
		const a = parseLog(lines, { dex: Dex });
		assert.deepEqual(parseLog(lines, { dex: Dex }), a);
		const p = new LogParser({ dex: Dex });
		for (const l of lines) p.feed(l);
		assert.deepEqual(p.finalize(), a);
		assert.deepEqual(p.finalize(), a, 'finalize twice');
	});
}

test('picks/leads/moves use species, never nicknames', () => {
	const g = parseLog(loadFixture('gen9championsvgc2026regmcbo3-2708109115').log, { dex: Dex });
	const nicks = ['Salamence', 'Whimsicott', 'Golisopod'];
	assert.deepEqual(Object.keys(g.moves.p1).sort(), g.picks.p1.filter(sp => g.moves.p1[sp]).sort());
	for (const n of nicks) assert.ok(g.picks.p1.includes(n) || g.picks.p2.includes(n));
	// a nicknamed game: every move owner must be a roster species
	const nick = parseLog(loadFixture('gen9vgc2025regi-2707575566').log, { dex: Dex });
	for (const side of ['p1', 'p2']) {
		const species = new Set(nick.roster[side].map(r => r.species));
		for (const sp of Object.keys(nick.moves[side])) assert.ok(species.has(sp), `${sp} is not a roster species`);
	}
});

test('Mega: base species stays the pick key, forme and stone recorded (Z-Mega)', () => {
	const g = parseLog(loadFixture('gen9championsvgc2026regmcbo3-2708082934').log, { dex: Dex });
	assert.deepEqual(g.mega.p1, [{ species: 'Garchomp', forme: 'Garchomp-Mega-Z', stone: 'Garchompite Z' }]);
	assert.deepEqual(g.mega.p2, [{ species: 'Charizard', forme: 'Charizard-Mega-Y', stone: 'Charizardite Y' }]);
	assert.ok(g.picks.p1.includes('Garchomp') && !g.picks.p1.some(s => /Mega/.test(s)));
	assert.ok(g.moves.p2.Charizard, 'mega moves are credited to the base species');
});

test('open team sheets: sets for both sides (item, ability, moves, nature)', () => {
	const g = parseLog(loadFixture('gen9championsvgc2026regmcbo3-2708082934').log, { dex: Dex });
	assert.deepEqual(g.teams.p1[0], {
		species: 'Kingambit', item: 'Life Orb', ability: 'Defiant',
		moves: ['Kowtow Cleave', 'Sucker Punch', 'Swords Dance', 'Protect'], nature: 'Adamant', gender: 'F', level: 50,
	});
	assert.equal(g.teams.p2[0].species, 'Ninetales-Alola');
	assert.equal(g.teams.p2[0].item, 'Choice Scarf');
	assert.equal(g.teams.p1.length, 6);
	assert.equal(g.teams.p2.length, 6);
	const plain = parseLog(loadFixture('gen9championsvgc2026regmcbo3-2708082934').log, {});
	assert.equal(plain.teams.p1[0].item, 'Life Orb', 'dex-less unpack still splits CamelCase');
});

test('Illusion: |replace| corrects the disguised pick and lead', () => {
	const g = parseLog(loadFixture('gen9championsvgc2026regmc-2708121117').log, { dex: Dex });
	assert.deepEqual(g.leads.p2, ['Zoroark-Hisui', 'Absol']);
	assert.deepEqual(g.picks.p2, ['Zoroark-Hisui', 'Absol', 'Torkoal', 'Sneasler']);
});

test('Illusion mid-game keeps the real brought Pokemon', () => {
	const g = parseLog(loadFixture('gen9vgc2025regi-2707575566').log, { dex: Dex });
	assert.deepEqual(g.picks.p1, ['Sinistcha-Masterpiece', 'Arcanine-Hisui', 'Zoroark-Hisui', 'Toucannon']);
});

test('hidden formes: Urshifu-* resolves from a switch-in, stays uncertain when never revealed', () => {
	const g = parseLog(loadFixture('gen9vgc2024regf-2130600385').log, { dex: Dex });
	assert.ok(g.roster.p1.some(r => r.species === 'Urshifu-Rapid-Strike' && !r.uncertain));
	assert.ok(!g.roster.p1.some(r => /\*/.test(r.species)));
	const hidden = parseLog(loadFixture('gen9vgc2025regg-2354752741').log, { dex: Dex });
	const wild = hidden.roster.p2.find(r => r.species === 'Urshifu-*');
	assert.ok(wild && wild.uncertain);
	assert.ok(!hidden.picks.p2.some(s => /Urshifu/.test(s)));
});

test('hidden formes: open team sheet reveals the forme', () => {
	const g = parseLog(loadFixture('gen9vgc2024regf-2131085055').log, { dex: Dex });
	assert.ok(!g.roster.p1.concat(g.roster.p2).some(r => /\*/.test(r.species)));
	// the sheet names Single Strike plain 'Urshifu'
	assert.ok(g.roster.p2.some(r => r.species === 'Urshifu' && !r.uncertain));
	assert.equal(g.teams.p2[1].species, 'Urshifu');
});

test('Zacian/Zamazenta without a forme in preview become -Crowned on reveal', () => {
	const log = [
		'|player|p1|A|1|1000', '|player|p2|B|1|1000',
		'|poke|p1|Zacian, L50|', '|poke|p1|Incineroar, L50, M|', '|poke|p2|Rillaboom, L50|', '|poke|p2|Zamazenta, L50|',
		'|start',
		'|switch|p1a: Zacian|Zacian-Crowned, L50|100/100', '|switch|p1b: Incineroar|Incineroar, L50, M|100/100',
		'|switch|p2a: Rillaboom|Rillaboom, L50|100/100', '|switch|p2b: Zam|Zamazenta-Crowned, L50|100/100',
		'|move|p2b: Zam|Protect|p2b: Zam', '|turn|1', '|win|A',
	];
	for (const dex of [Dex, null]) {
		const g = parseLog(log, { dex });
		assert.deepEqual(g.picks.p1, ['Zacian-Crowned', 'Incineroar']);
		assert.deepEqual(g.picks.p2, ['Rillaboom', 'Zamazenta-Crowned']);
		assert.deepEqual(g.moves.p2, { 'Zamazenta-Crowned': { Protect: 1 } });
	}
});

test('Tera: type recorded per side, species key unchanged', () => {
	const g = parseLog(loadFixture('gen9vgc2025regg-2354650138').log, { dex: Dex });
	assert.deepEqual(g.tera.p1, [{ species: 'Dragapult', type: 'Ghost' }]);
	assert.deepEqual(g.tera.p2, [{ species: 'Chi-Yu', type: 'Ghost' }]);
	assert.deepEqual(g.mega, { p1: [], p2: [] });
});

test('Ditto / Transform does not rewrite the roster', () => {
	const g = parseLog(loadFixture('gen9championsvgc2026regma-2673627565').log, { dex: Dex });
	const all = g.roster.p1.concat(g.roster.p2).map(r => r.species);
	assert.ok(all.includes('Ditto'));
	assert.ok(!g.roster.p1.concat(g.roster.p2).some(r => r.inferred));
});

test('Ally Switch: moves follow the nickname after |swap|', () => {
	const g = parseLog(loadFixture('gen9championsvgc2026regma-2674137619').log, { dex: Dex });
	assert.ok(g.moves.p2.Kingambit && g.moves.p2.Kingambit['Kowtow Cleave'] >= 1);
	assert.ok(g.moves.p2.Kingambit['Ally Switch'] === undefined);
});

test('end reasons: forfeit, inactivity, normal', () => {
	const f = parseLog(loadFixture('gen9championsvgc2026regmcbo3-2708082078').log, {});
	assert.equal(f.end, 'forfeit');
	assert.equal(f.forfeiter, 'p1');
	assert.equal(f.winner.side, 'p2');
	const i = parseLog(loadFixture('gen9championsvgc2026regmc-2708107409').log, {});
	assert.equal(i.end, 'inactivity');
	assert.equal(i.forfeiter, 'p2');
	const n = parseLog(loadFixture('gen9championsvgc2026regmcbo3-2708057022').log, {});
	assert.equal(n.end, 'win');
	assert.equal(n.forfeiter, null);
});

test('tie (synthetic: no public tie replay found)', () => {
	const g = parseLog(['|player|p1|A|1|1000', '|player|p2|B|1|1000', '|turn|3', '|tie'], { me: 'a' });
	assert.equal(g.end, 'tie');
	assert.equal(g.tie, true);
	assert.equal(g.complete, true);
	assert.equal(g.winner, null);
	assert.equal(g.result, 'tie');
});

test('reconnect |player| lines do not clobber names or ratings', () => {
	const g = parseLog(['|player|p1|Alice|2|1500', '|player|p1|', '|player|p1|Alice|2|', '|player|p2|Bob|3|1400'], {});
	assert.deepEqual(g.players.p1, { name: 'Alice', id: 'alice', avatar: '2', rating: 1500 });
});

test('rating lines map to sides by name (case/space insensitive)', () => {
	const g = parseLog([
		'|player|p1|Some Name|1|1000', '|player|p2|Other|1|1000', '|win|Other',
		"|raw|Some Name's rating: 1000 &rarr; <strong>980</strong><br />(-20 for losing)",
		"|raw|Other's rating: 1000 &rarr; <strong>1020</strong><br />(+20 for winning)",
	], {});
	assert.deepEqual(g.ratings.p1, { name: 'Some Name', before: 1000, after: 980 });
	assert.deepEqual(g.ratings.p2, { name: 'Other', before: 1000, after: 1020 });
});

test('Bo3 header: wrapper id, game number, series score', () => {
	const g = parseLog(loadFixture('gen9championsvgc2026regmcbo3-2708082934').log, {});
	assert.deepEqual(g.bo3, {
		bestOf: 3, wrapperId: 'game-bestof3-gen9championsvgc2026regmcbo3-2708081182', gameNumber: 3, score: { p1: 1, p2: 1 },
	});
	assert.equal(parseLog(loadFixture('gen9vgc2025regg-2354650138').log, {}).bo3, null);
});

test('my side: username (case-insensitive), p2 perspective, result', () => {
	const log = loadFixture('gen9championsvgc2026regmcbo3-2708082934').log;
	const p2 = parseLog(log, { me: 'meermika' });
	assert.equal(p2.side, 'p2');
	assert.equal(p2.opp, 'p1');
	assert.equal(p2.result, 'win');
	assert.equal(p2.sideVia, 'name');
	assert.equal(parseLog(log, { me: 'UNSKILLED99' }).result, 'loss');
});

test('my side cascade: name+team, team only, default', () => {
	const g = parseLog(loadFixture('gen9championsvgc2026regmcbo3-2708082934').log, { dex: Dex });
	const p2Team = g.teams.p2.map(t => t.species);
	assert.deepEqual(resolveSide(g, { me: 'meermika', myRoster: p2Team, dex: Dex }), { side: 'p2', via: 'name+team' });
	assert.deepEqual(resolveSide(g, { myRoster: p2Team, dex: Dex }), { side: 'p2', via: 'team' });
	assert.deepEqual(resolveSide(g, { me: 'nobody' }), { side: 'p1', via: 'default' });
	assert.deepEqual(resolveSide(g, {}), { side: 'p1', via: 'default' });
	// same name on both sides (self-play): the roster decides
	const mirror = { ...g, players: { p1: { ...g.players.p1, id: 'me' }, p2: { ...g.players.p2, id: 'me' } } };
	assert.deepEqual(resolveSide(mirror, { me: 'me', myRoster: p2Team, dex: Dex }), { side: 'p2', via: 'team' });
	// name matches one side but the roster fits the other: name wins
	assert.deepEqual(resolveSide(g, { me: 'unskilled99', myRoster: p2Team, dex: Dex }), { side: 'p1', via: 'name' });
});

test('helpers: parseIdent / parseDetails', () => {
	assert.deepEqual(parseIdent('p1a: Nick: Name'), { side: 'p1', slot: 'a', nick: 'Nick: Name' });
	assert.deepEqual(parseIdent('p2: Bench'), { side: 'p2', slot: '', nick: 'Bench' });
	assert.equal(parseIdent('p3a: X'), null);
	assert.deepEqual(parseDetails('Ogerpon-Wellspring, L50, F, shiny, tera:Water'), { species: 'Ogerpon-Wellspring', level: 50, gender: 'F', shiny: true, tera: 'Water' });
	assert.equal(parseDetails('Kingambit').level, 100);
});

test('malformed input never throws', () => {
	const junk = [null, undefined, 42, {}, '', '\n\n', '|', '||||', '|switch|', '|switch|p1a|', '|switch|p1a: X|', '|move|', '|move|zzz|Tackle',
		'|poke|p9|X', '|showteam|p1|]]]|||', '|showteam|p1|', '|win|', '|raw|', '|raw|x\'s rating: a &rarr; b', '|uhtml|bestof|', '|uhtml|bestof|Game x',
		'|detailschange|', '|-mega|', '|swap|', '|swap|p1a: X|9', '|replace|p1a: X|', '|turn|abc', '\r', 'plain text'];
	for (const j of junk) {
		assert.doesNotThrow(() => parseLog(j, { dex: Dex, me: 'x' }));
		assert.doesNotThrow(() => parseLog([j, j], {}));
	}
	const g = parseLog(junk.filter(j => !/^|win/.test(j)), { me: 'x' });
	assert.equal(g.complete, false);
	assert.equal(g.end, 'incomplete');
});
