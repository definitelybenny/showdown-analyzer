// Packed team helpers (format: sim/teams.ts). Ported from the author's mock-regional-helper Core section.
import { toID, makeNamer } from './names.js';

const STAT_ORDER = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_NAMES = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

/** Readable guess for a packed name, e.g. "SafetyGoggles" -> "Safety Goggles". `table` is a dex table or undefined. */
function unpackName(name, table) {
	if (!name) return '';
	if (table && typeof table.get === 'function') {
		try {
			const obj = table.get(name);
			if (obj && obj.exists !== false && obj.name) return obj.name;
		} catch (e) { /* fall through */ }
	}
	if (/[ \-':.]/.test(name)) return name;
	return name.replace(/([0-9]+)/g, ' $1 ').replace(/([A-Z])/g, ' $1').replace(/\s+/g, ' ').trim();
}

/** Packed team -> array of sets. `dex` is optional. Never throws. */
export function unpackTeam(buf, dex) {
	if (!buf || typeof buf !== 'string') return [];
	const team = [];
	for (const setBuf of buf.split(']')) {
		const f = setBuf.split('|');
		if (f.length < 2) continue;
		const set = {};
		set.name = f[0] || '';
		set.species = unpackName(f[1] || set.name, dex && dex.species);
		if (!set.species) continue;
		set.item = unpackName(f[2] || '', dex && dex.items);
		const ability = f[3] || '';
		if (['', '0', '1', 'H', 'S'].includes(ability)) {
			let abil = '';
			try {
				const sp = dex && dex.species && dex.species.get(set.species);
				if (sp && sp.abilities) abil = sp.abilities[ability || '0'] || '';
			} catch (e) { /* no dex */ }
			set.ability = abil;
		} else {
			set.ability = unpackName(ability, dex && dex.abilities);
		}
		set.moves = (f[4] || '').split(',').filter(Boolean).map(m => unpackName(m, dex && dex.moves));
		set.nature = f[5] ? f[5].charAt(0).toUpperCase() + f[5].slice(1) : '';
		if (f[6]) {
			const evs = f[6].split(',');
			set.evs = {};
			STAT_ORDER.forEach((s, i) => { set.evs[s] = Number(evs[i]) || 0; });
		}
		set.gender = f[7] || '';
		if (f[8]) {
			const ivs = f[8].split(',');
			set.ivs = {};
			STAT_ORDER.forEach((s, i) => { set.ivs[s] = ivs[i] === '' || ivs[i] === undefined ? 31 : Number(ivs[i]) || 0; });
		}
		set.shiny = !!f[9];
		set.level = f[10] ? parseInt(f[10], 10) || 100 : 100;
		const misc = (f[11] || '').split(',');
		set.teraType = misc[5] || '';
		team.push(set);
	}
	return team;
}

/** Sets -> Showdown export text. */
export function exportTeam(sets) {
	return sets.map(set => {
		let out = (set.name && set.name !== set.species) ? `${set.name} (${set.species})` : set.species;
		if (set.gender === 'M' || set.gender === 'F') out += ` (${set.gender})`;
		if (set.item) out += ` @ ${set.item}`;
		out += '\n';
		if (set.ability) out += `Ability: ${set.ability}\n`;
		if (set.level && set.level !== 100) out += `Level: ${set.level}\n`;
		if (set.shiny) out += 'Shiny: Yes\n';
		if (set.teraType) out += `Tera Type: ${set.teraType}\n`;
		if (set.evs) {
			const evs = STAT_ORDER.filter(s => set.evs[s]).map(s => `${set.evs[s]} ${STAT_NAMES[s]}`);
			if (evs.length) out += `EVs: ${evs.join(' / ')}\n`;
		}
		if (set.nature) out += `${set.nature} Nature\n`;
		if (set.ivs) {
			const ivs = STAT_ORDER.filter(s => set.ivs[s] !== 31).map(s => `${set.ivs[s]} ${STAT_NAMES[s]}`);
			if (ivs.length) out += `IVs: ${ivs.join(' / ')}\n`;
		}
		for (const move of set.moves) out += `- ${move}\n`;
		return out;
	}).join('\n');
}

/** Species list from a packed team. */
export function packedSpecies(buf) {
	return unpackTeam(buf).map(s => s.species);
}

/** Stable, order-independent hash of a roster (species analytics key, plus item when entries carry one). cyrb53 -> hex. */
export function rosterHash(entries, dex) {
	const namer = makeNamer(dex);
	const keys = (entries || []).map(e => {
		const species = typeof e === 'string' ? e : e.species;
		const item = typeof e === 'string' ? '' : e.item;
		return toID(namer.analyticsKey(species)) + (item ? '@' + toID(item) : '');
	}).sort();
	const str = keys.join(',');
	let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
