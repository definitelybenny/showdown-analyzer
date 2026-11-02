import test from 'node:test';
import assert from 'node:assert/strict';
import { toID, makeNamer, isMegaForme, stripMega, isWildcard } from '../../src/core/names.js';
import { unpackTeam, exportTeam, packedSpecies, rosterHash } from '../../src/core/teams.js';
import { Dex } from '../helpers.js';

test('toID', () => {
	assert.equal(toID('Mr. Mime-Galar'), 'mrmimegalar');
	assert.equal(toID(null), '');
});

test('mega helpers', () => {
	assert.equal(stripMega('Charizard-Mega-Y'), 'Charizard');
	assert.equal(stripMega('Garchomp-Mega-Z'), 'Garchomp');
	assert.equal(stripMega('Groudon-Primal'), 'Groudon');
	assert.equal(stripMega('Meganium'), 'Meganium');
	assert.equal(isMegaForme('Absol-Mega-Z'), true);
	assert.equal(isMegaForme('Ogerpon-Hearthflame-Tera'), false);
	assert.equal(isWildcard('Urshifu-*'), true);
});

for (const [label, dex] of [['with dex', Dex], ['without dex', null]]) {
	test(`namer ${label}`, () => {
		const n = makeNamer(dex);
		assert.equal(n.baseSpecies('Urshifu-*'), 'Urshifu');
		assert.equal(n.baseSpecies('Urshifu-Rapid-Strike'), 'Urshifu');
		assert.equal(n.baseSpecies('Ho-Oh'), 'Ho-Oh');
		assert.equal(n.baseSpecies('Chi-Yu'), 'Chi-Yu');
		assert.equal(n.baseSpecies('Walking Wake'), 'Walking Wake');
		assert.equal(n.analyticsKey('Zamazenta-Crowned'), 'Zamazenta');
		assert.equal(n.analyticsKey('Charizard-Mega-Y'), 'Charizard');
		assert.equal(n.analyticsKey('Ogerpon-Hearthflame-Tera'), 'Ogerpon-Hearthflame');
		assert.equal(n.analyticsKey('Calyrex-Shadow'), 'Calyrex-Shadow');
		assert.equal(n.analyticsKey('Urshifu-Rapid-Strike'), 'Urshifu-Rapid-Strike');
		assert.equal(n.analyticsKey('Ninetales-Alola'), 'Ninetales-Alola');
		assert.equal(n.analyticsKey('Terapagos-Stellar'), 'Terapagos');
	});
}

test('namer dex numbers (dex only)', () => {
	assert.equal(makeNamer(Dex).dexNum('Zamazenta-Crowned'), makeNamer(Dex).dexNum('Zamazenta'));
	assert.equal(makeNamer(null).dexNum('Zamazenta'), 0);
	assert.equal(makeNamer(Dex).dexNum('Urshifu-*'), 0);
});

const PACKED = 'Froslass||Froslassite|CursedBody|Blizzard,ShadowBall,AuroraVeil,Protect|Timid||F|||50|]Dragonite||Dragoninite|Multiscale|ExtremeSpeed,Protect,Haze,HeatWave|Adamant|252,0,4,0,0,252|M|||50|';

test('unpackTeam: open team sheet and full spread', () => {
	const t = unpackTeam(PACKED, Dex);
	assert.equal(t.length, 2);
	assert.equal(t[0].species, 'Froslass');
	assert.equal(t[0].item, 'Froslassite');
	assert.equal(t[0].ability, 'Cursed Body');
	assert.deepEqual(t[0].moves, ['Blizzard', 'Shadow Ball', 'Aurora Veil', 'Protect']);
	assert.equal(t[0].nature, 'Timid');
	assert.equal(t[0].gender, 'F');
	assert.equal(t[0].level, 50);
	assert.deepEqual(t[1].evs, { hp: 252, atk: 0, def: 4, spa: 0, spd: 0, spe: 252 });
	const plain = unpackTeam(PACKED);
	assert.equal(plain[0].ability, 'Cursed Body');
	assert.deepEqual(plain[0].moves, ['Blizzard', 'Shadow Ball', 'Aurora Veil', 'Protect']);
});

test('unpackTeam: nicknames, species with spaces, junk input', () => {
	const t = unpackTeam('Bob|Walking Wake|SafetyGoggles|0|Protect||||||');
	assert.equal(t[0].name, 'Bob');
	assert.equal(t[0].species, 'Walking Wake');
	assert.equal(t[0].item, 'Safety Goggles');
	assert.deepEqual(unpackTeam(null), []);
	assert.deepEqual(unpackTeam(''), []);
	assert.deepEqual(unpackTeam(']]]]|'), []);
	assert.deepEqual(unpackTeam(42), []);
});

test('exportTeam / packedSpecies', () => {
	const out = exportTeam(unpackTeam(PACKED, Dex));
	assert.match(out, /^Froslass \(F\) @ Froslassite\nAbility: Cursed Body\nLevel: 50\nTimid Nature\n- Blizzard\n/);
	assert.match(out, /EVs: 252 HP \/ 4 Def \/ 252 Spe\n/);
	assert.deepEqual(packedSpecies(PACKED), ['Froslass', 'Dragonite']);
});

test('rosterHash is order independent, forme-collapsing and item sensitive', () => {
	assert.equal(rosterHash(['Kingambit', 'Gengar'], Dex), rosterHash(['Gengar', 'Kingambit'], Dex));
	assert.equal(rosterHash(['Zamazenta', 'Gengar']), rosterHash(['Gengar', 'Zamazenta-Crowned']));
	assert.notEqual(rosterHash(['Kingambit', 'Gengar']), rosterHash(['Kingambit', 'Garchomp']));
	assert.notEqual(rosterHash([{ species: 'Gengar', item: 'Gengarite' }]), rosterHash([{ species: 'Gengar', item: 'Focus Sash' }]));
	assert.match(rosterHash(['Gengar']), /^[0-9a-f]{14}$/);
});
