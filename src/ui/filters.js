// Shared filter bar (Games / Usage / Matchups / Moves). The filter object is persisted in settings by app.js.
import { h, btn, chip, shortFormat } from './components.js';
import { keyOf } from '../core/stats.js';

export const DEFAULT_FILTERS = { result: '', format: '', from: '', to: '', team: '', opp: [], bo3Only: false, reviewed: '' };

/** UI filter state -> stats.filterGames query (dates become local-day bounds in ms). */
export function toQuery(f) {
	const q = { ...f };
	q.from = f.from ? new Date(f.from + 'T00:00:00').getTime() : undefined;
	q.to = f.to ? new Date(f.to + 'T23:59:59.999').getTime() : undefined;
	q.reviewed = f.reviewed === 'yes' ? true : f.reviewed === 'no' ? false : undefined;
	q.opp = f.opp && f.opp.length ? f.opp : undefined;
	return q;
}

export function sanitizeFilters(raw) {
	const f = { ...DEFAULT_FILTERS, ...(raw && typeof raw === 'object' ? raw : {}) };
	f.opp = Array.isArray(f.opp) ? f.opp.filter(x => typeof x === 'string') : [];
	f.bo3Only = !!f.bo3Only;
	for (const k of ['result', 'format', 'from', 'to', 'team', 'reviewed']) if (typeof f[k] !== 'string') f[k] = '';
	return f;
}

export function activeCount(f) {
	return ['result', 'format', 'from', 'to', 'team', 'reviewed'].filter(k => f[k]).length + (f.opp.length ? 1 : 0) + (f.bo3Only ? 1 : 0);
}

function field(label, control, cls) {
	return h('label', { class: 'sa-field ' + (cls || '') }, h('span', { text: label }), control);
}

function select(value, options, onchange) {
	const s = h('select', { onchange: e => onchange(e.target.value) }, options.map(([v, label]) => h('option', { value: v, text: label })));
	s.value = value;
	return s;
}

/**
 * ctx: {filters, open, formats:[{format,games}], teams:[{key,species,games}], oppSpecies:[string], showReviewed,
 *       set(patch), toggle(), clear()}
 */
export function renderFilterBar(ctx) {
	const f = ctx.filters;
	const n = activeCount(f);
	const head = h(
		'div',
		{ class: 'sa-filterhead' },
		h('button', { type: 'button', class: 'sa-btn', 'aria-expanded': String(!!ctx.open), onclick: ctx.toggle }, `Filters${n ? ` (${n})` : ''} ${ctx.open ? '▴' : '▾'}`),
		n ? btn('Clear', ctx.clear, { class: 'sa-small' }) : null,
		!ctx.open && n ? h('span', { class: 'sa-chips' }, activeChips(f, ctx)) : null,
	);
	if (!ctx.open) return h('div', { class: 'sa-filterbar' }, head);

	const listId = 'sa-opp-list';
	const oppInput = h('input', { type: 'text', list: listId, placeholder: 'Add Pokemon (opp team has...)', 'aria-label': 'Opposing Pokemon' });
	const addOpp = () => {
		const raw = oppInput.value.trim();
		if (!raw) return;
		const hit = ctx.oppSpecies.find(s => keyOf(s).toLowerCase() === keyOf(raw).toLowerCase()) || raw;
		oppInput.value = '';
		if (!f.opp.some(x => keyOf(x) === keyOf(hit))) ctx.set({ opp: [...f.opp, hit] });
	};
	oppInput.addEventListener('keydown', e => {
		if (e.key === 'Enter') {
			e.preventDefault();
			addOpp();
		}
	});
	oppInput.addEventListener('change', addOpp);

	const panel = h(
		'div',
		{ class: 'sa-filterpanel' },
		field('Result', select(f.result, [['', 'All'], ['win', 'Wins'], ['loss', 'Losses'], ['tie', 'Ties']], v => ctx.set({ result: v }))),
		field('Format', select(f.format, [['', 'All formats'], ...ctx.formats.map(x => [x.format, `${shortFormat(x.format)} (${x.games})`])], v => ctx.set({ format: v }))),
		field('My team', select(f.team, [['', 'All teams'], ...ctx.teams.map(t => [t.key, `${t.species.slice(0, 3).join(', ')}... (${t.games})`])], v => ctx.set({ team: v }))),
		field('From', h('input', { type: 'date', value: f.from, onchange: e => ctx.set({ from: e.target.value }) })),
		field('To', h('input', { type: 'date', value: f.to, onchange: e => ctx.set({ to: e.target.value }) })),
		ctx.showReviewed ? field('Reviewed', select(f.reviewed, [['', 'Any'], ['yes', 'Reviewed'], ['no', 'Not reviewed']], v => ctx.set({ reviewed: v }))) : null,
		h('label', { class: 'sa-field sa-check' }, h('input', { type: 'checkbox', checked: f.bo3Only, onchange: e => ctx.set({ bo3Only: e.target.checked }) }), h('span', { text: 'Best-of-3 only' })),
		h(
			'div',
			{ class: 'sa-field sa-field-wide' },
			h('span', { text: 'Opposing Pokemon' }),
			oppInput,
			h('datalist', { id: listId }, ctx.oppSpecies.map(s => h('option', { value: s }))),
			f.opp.length ? h('div', { class: 'sa-chips', style: 'margin-top:4px' }, f.opp.map(s => chip([s, h('button', { type: 'button', 'aria-label': 'Remove ' + s, text: '×', onclick: () => ctx.set({ opp: f.opp.filter(x => x !== s) }) })]))) : null,
		),
	);
	return h('div', { class: 'sa-filterbar' }, head, panel);
}

function activeChips(f, ctx) {
	const out = [];
	if (f.result) out.push(chip(f.result));
	if (f.format) out.push(chip(shortFormat(f.format)));
	if (f.team) out.push(chip('team'));
	if (f.from || f.to) out.push(chip(`${f.from || '...'} to ${f.to || '...'}`));
	if (f.reviewed) out.push(chip(f.reviewed === 'yes' ? 'reviewed' : 'not reviewed'));
	if (f.bo3Only) out.push(chip('Bo3'));
	for (const s of f.opp) out.push(chip('vs ' + s));
	return out;
}
