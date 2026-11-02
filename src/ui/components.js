// Small DOM helpers and shared widgets. No framework; data is only ever inserted with textContent / attributes.
import { toID } from '../core/names.js';
import { wilson, keyOf } from '../core/stats.js';

let DOC = typeof document !== 'undefined' ? document : null;
export function setDoc(doc) {
	DOC = doc;
}
const getWin = () => (DOC && DOC.defaultView) || (typeof window !== 'undefined' ? window : null);

/**
 * h('div', {class: 'x', onclick: fn, style: {color: 'red'}, dataset: {a: 1}}, child, [children], 'text')
 * `text` and `value` are set as properties; on* as listeners; false/null/undefined props are skipped.
 */
export function h(tag, props, ...children) {
	const el = DOC.createElement(tag);
	for (const [k, v] of Object.entries(props || {})) {
		if (v === false || v === null || v === undefined) continue;
		if (k === 'class') el.className = v;
		else if (k === 'text') el.textContent = v;
		else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
		else if (k === 'style') {
			if (typeof v === 'string') el.style.cssText = v;
			else Object.assign(el.style, v);
		} else if (k === 'dataset') Object.assign(el.dataset, v);
		else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
		else el.setAttribute(k, v === true ? '' : String(v));
	}
	const add = c => {
		if (Array.isArray(c)) c.forEach(add);
		else if (c === null || c === undefined || c === false) return;
		else el.appendChild(typeof c === 'object' ? c : DOC.createTextNode(String(c)));
	};
	children.forEach(add);
	return el;
}

export const clear = el => {
	while (el.firstChild) el.removeChild(el.firstChild);
	return el;
};

// ---------- formatting ----------

export const pct = (x, digits = 0) => (x === null || x === undefined || Number.isNaN(x) ? '-' : (x * 100).toFixed(digits) + '%');

export function fmtDate(ts) {
	if (!ts) return '';
	const d = new Date(ts);
	const pad = n => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function fmtDateTime(ts) {
	if (!ts) return '';
	const d = new Date(ts);
	return `${fmtDate(ts)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** `[Gen 9 Champions] VGC 2026 Reg M-C` -> `VGC 2026 Reg M-C` (short label for narrow layouts). */
export function shortFormat(f) {
	return String(f || '').replace(/^\[[^\]]*\]\s*/, '') || String(f || '');
}

export function replayUrl(g) {
	if (g.replayUrl) return g.replayUrl;
	return g.roomid ? 'https://replay.pokemonshowdown.com/' + String(g.roomid).replace(/^battle-/, '') : '';
}

// ---------- Pokemon visuals ----------

const HYPHEN_BASES = ['Ho-Oh', 'Porygon-Z', 'Jangmo-o', 'Hakamo-o', 'Kommo-o', 'Type: Null', 'Wo-Chien', 'Chien-Pao', 'Ting-Lu', 'Chi-Yu'];

/** Candidate sprite ids for a species display name, most specific first (`urshifu-rapidstrike`, then `urshifu`). */
export function spriteIds(species) {
	const s = String(species || '');
	const lower = s.toLowerCase();
	const hb = HYPHEN_BASES.find(b => lower === b.toLowerCase() || lower.indexOf(b.toLowerCase() + '-') === 0);
	const baseName = hb || s.split('-')[0];
	const rest = s.slice(baseName.length + 1);
	const base = toID(baseName);
	return rest ? [`${base}-${toID(rest)}`, base] : [base];
}

/**
 * Icon for a species. Uses the client icon sheet when `Dex.getPokemonIcon` exists, otherwise the Showdown sprite,
 * otherwise the species name. opts: {brought: bool|undefined (dims when false), mega, lead, title}
 */
export function pokeIcon(species, opts) {
	const o = opts || {};
	const win = getWin();
	const dex = win && win.Dex;
	const name = String(species || '?');
	const cls = 'sa-icon' + (o.brought === false ? ' sa-dim' : '') + (o.lead ? ' sa-lead' : '');
	const wrap = h('span', { class: 'sa-iconwrap', title: o.title || name }, [], o.mega ? h('span', { class: 'sa-badge-m', text: 'M' }) : null);
	let icon;
	const textFallback = () => h('span', { class: cls + ' sa-icon-text', text: name.slice(0, 7) });
	if (dex && typeof dex.getPokemonIcon === 'function') {
		icon = h('span', { class: cls, role: 'img', 'aria-label': name });
		try {
			icon.style.cssText = dex.getPokemonIcon(name);
		} catch (e) {
			icon = textFallback();
		}
	} else if (species) {
		const ids = spriteIds(name);
		let i = 0;
		icon = h('img', { class: cls + ' sa-icon-img', alt: name, loading: 'lazy', src: `https://play.pokemonshowdown.com/sprites/dex/${ids[0]}.png` });
		icon.addEventListener('error', () => {
			i++;
			if (i < ids.length) icon.src = `https://play.pokemonshowdown.com/sprites/dex/${ids[i]}.png`;
			else if (icon.parentNode) icon.parentNode.replaceChild(textFallback(), icon);
		});
	} else icon = textFallback();
	wrap.insertBefore(icon, wrap.firstChild);
	return wrap;
}

/** Row of icons. items: [species | {species, brought, mega, lead}] */
export function iconRow(items, cls) {
	return h('span', { class: 'sa-icons ' + (cls || '') }, (items || []).map(i => (typeof i === 'string' ? pokeIcon(i) : pokeIcon(i.species, i))));
}

// ---------- stats widgets ----------

/** Win-rate cell: percent coloured by rate, W-L and N, muted when n < minN. */
export function winRate(r, minN, opts) {
	const o = opts || {};
	if (!r || !r.n) return h('span', { class: 'sa-wr sa-wr-none', title: 'No games' }, h('span', { class: 'sa-wr-pct', text: '-' }), o.compact ? null : h('span', { class: 'sa-wr-n', text: '0 games' }));
	const iv = r.lo !== undefined ? r : { ...r, ...wilson(r.w, r.n) };
	const low = r.n < (minN || 0);
	const tone = r.rate >= 0.6 ? 'good' : r.rate >= 0.4 ? 'mid' : 'bad';
	return h(
		'span',
		{
			class: `sa-wr sa-tone-${tone}${low ? ' sa-lowN' : ''}`,
			title: `${r.w}-${r.l} (${r.n} games). 95% interval ${pct(iv.lo)} to ${pct(iv.hi)}${low ? `. Small sample (under ${minN})` : ''}`,
		},
		h('span', { class: 'sa-wr-pct', text: pct(r.rate) }),
		o.compact ? null : h('span', { class: 'sa-wr-n', text: `${r.w}-${r.l}${low ? ' low N' : ''}` }),
	);
}

export function resultBadge(result) {
	const t = result === 'win' ? 'W' : result === 'loss' ? 'L' : result === 'tie' ? 'T' : '?';
	return h('span', { class: `sa-result sa-result-${result || 'unknown'}`, title: result || 'unknown', text: t });
}

export function stat(label, value, sub) {
	return h('div', { class: 'sa-stat' }, h('div', { class: 'sa-stat-label', text: label }), h('div', { class: 'sa-stat-value' }, value), sub ? h('div', { class: 'sa-stat-sub' }, sub) : null);
}

export function chip(text, props) {
	return h('span', { class: 'sa-chip', ...(props || {}) }, text);
}

export function btn(label, onclick, props) {
	const p = props || {};
	return h('button', { type: 'button', class: 'sa-btn' + (p.primary ? ' sa-primary' : '') + (p.danger ? ' sa-danger' : '') + (p.class ? ' ' + p.class : ''), onclick, disabled: p.disabled, title: p.title, 'aria-pressed': p.pressed === undefined ? false : String(p.pressed) }, label);
}

export function emptyState(title, body, action) {
	return h('div', { class: 'sa-empty' }, h('div', { class: 'sa-empty-title', text: title }), h('p', { text: body }), action || null);
}

export function sectionTitle(text, sub) {
	return h('h3', { class: 'sa-h3' }, text, sub ? h('span', { class: 'sa-h3-sub', text: sub }) : null);
}

/** Species key helper re-exported for views. */
export { keyOf };
