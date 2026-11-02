// Species name helpers. `dex` is optional: anything with `species.get(name)` returning
// `{exists, num, name, baseSpecies}` (client `Dex`, `@pkmn/dex`). Everything degrades to string rules without it.

export function toID(text) {
	return String(text == null ? '' : text).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Species names whose hyphen is part of the base name. */
const HYPHEN_BASES = ['Ho-Oh', 'Porygon-Z', 'Jangmo-o', 'Hakamo-o', 'Kommo-o', 'Type: Null', 'Wo-Chien', 'Chien-Pao', 'Ting-Lu', 'Chi-Yu'];
const HYPHEN_BASE_IDS = new Map(HYPHEN_BASES.map(n => [toID(n), n]));

/** Mid-battle formes that collapse into one analytics key (battle-only or cosmetic formes). */
const COLLAPSE = [
	[/^(Zacian|Zamazenta)-Crowned$/, '$1'],
	[/^(Ogerpon(?:-(?:Wellspring|Hearthflame|Cornerstone))?)-Tera$/, '$1'],
	[/^Terapagos-(?:Terastal|Stellar)$/, 'Terapagos'],
	[/^Palafin-Hero$/, 'Palafin'],
	[/^Morpeko-Hangry$/, 'Morpeko'],
	[/^Eiscue-Noice$/, 'Eiscue'],
	[/^Mimikyu-Busted$/, 'Mimikyu'],
	[/^Aegislash-Blade$/, 'Aegislash'],
	[/^Wishiwashi-School$/, 'Wishiwashi'],
	[/^Cramorant-(?:Gulping|Gorging)$/, 'Cramorant'],
	[/^Darmanitan-Zen$/, 'Darmanitan'],
	[/^Darmanitan-Galar-Zen$/, 'Darmanitan-Galar'],
	[/^(Sinistcha|Poltchageist)-(?:Masterpiece|Artisan)$/, '$1'],
];

export const MEGA_RE = /-(?:Mega(?:-[A-Z])?|Primal)$/;

export function isMegaForme(species) {
	return MEGA_RE.test(String(species || ''));
}

/** `Charizard-Mega-Y` -> `Charizard`. */
export function stripMega(species) {
	return String(species || '').replace(MEGA_RE, '');
}

export function isWildcard(species) {
	return /-\*$/.test(String(species || ''));
}

/** Base species by string rules only (first hyphen segment, minus known hyphenated names). */
function baseByString(name) {
	const id = toID(name);
	for (const [bid, bname] of HYPHEN_BASE_IDS) if (id.indexOf(bid) === 0) return bname;
	return String(name).split('-')[0];
}

export function makeNamer(dex) {
	function lookup(name) {
		if (!dex || !dex.species || isWildcard(name)) return null;
		try {
			const sp = dex.species.get(name);
			return sp && sp.exists !== false && sp.num > 0 ? sp : null;
		} catch (e) {
			return null;
		}
	}

	/** Base species (`Charizard-Mega-Y` -> `Charizard`, `Urshifu-*` -> `Urshifu`). */
	function baseSpecies(name) {
		name = String(name || '').trim();
		if (isWildcard(name)) return baseByString(name.slice(0, -2));
		const sp = lookup(name);
		return sp ? sp.baseSpecies || sp.name : baseByString(name);
	}

	/** Dex number or 0 when unknown / no dex. */
	function dexNum(name) {
		const sp = lookup(name);
		return sp ? sp.num : 0;
	}

	/** Analytics key: Mega/Primal and battle-only formes collapsed, competitive formes kept. */
	function analyticsKey(name) {
		const s = stripMega(String(name || '').trim());
		for (const [re, rep] of COLLAPSE) {
			if (re.test(s)) return s.replace(re, rep);
		}
		return s;
	}

	return { baseSpecies, dexNum, analyticsKey };
}
