// Usage: my-team Pokemon (brought, win%, lead, mega/tera) and lead pairs.
import { h, btn, iconRow, pokeIcon, stat, winRate, emptyState, pct } from '../components.js';
import { usage, mostCommonLeads, bestLeads, summary, listTeams } from '../../core/stats.js';

const SORTS = [['used', 'Most brought'], ['win', 'Win rate (Wilson low bound)'], ['lead', 'Most led'], ['name', 'Name']];

function sortRows(rows, how) {
	const l = [...rows];
	if (how === 'win') l.sort((a, b) => b.win.lo - a.win.lo || b.brought - a.brought);
	else if (how === 'lead') l.sort((a, b) => b.lead - a.lead || b.brought - a.brought);
	else if (how === 'name') l.sort((a, b) => a.species.localeCompare(b.species));
	return l;
}

function cell(label, ...value) {
	return h('div', {}, h('div', { class: 'sa-cell-label', text: label }), h('div', { class: 'sa-cell-val' }, value));
}

function monCard(r, c, flags) {
	const minN = c.minN;
	return h(
		'li',
		{ class: 'sa-card' },
		h(
			'div',
			{ class: 'sa-row' },
			pokeIcon(r.species),
			h('div', { class: 'sa-grow' }, h('div', { class: 'sa-title', text: r.species }), h('div', { class: 'sa-sub', text: `on team ${r.on} game${r.on === 1 ? '' : 's'}` })),
			winRate(r.win, minN),
		),
		h('div', { class: 'sa-bar', title: `Brought ${pct(r.broughtPct)}` }, h('i', { style: { width: pct(r.broughtPct) } })),
		h(
			'div',
			{ class: 'sa-statgrid' },
			cell('Brought', `${r.brought}/${r.on} `, h('span', { class: 'sa-muted', text: `(${pct(r.broughtPct)})` })),
			cell('Lead', `${r.lead} `, h('span', { class: 'sa-muted', text: r.brought ? `(${pct(r.leadPct)})` : '' })),
			cell('Lead win', winRate(r.leadWin, minN)),
			(flags.mega && r.mega) ? cell('Mega', `${r.mega} `, h('span', { class: 'sa-muted', text: r.mega ? `(${pct(r.megaPct)})` : '' })) : null,
			(flags.mega && r.mega) ? cell('Mega win', winRate(r.megaWin, minN)) : null,
			(flags.tera && r.tera) ? cell('Tera', `${r.tera} `, h('span', { class: 'sa-muted', text: r.tera ? `(${pct(r.teraPct)})` : '' })) : null,
			(flags.tera && r.tera) ? cell('Tera win', winRate(r.teraWin, minN)) : null,
		),
	);
}

function leadCard(title, rows, minN) {
	return h(
		'div',
		{ class: 'sa-card' },
		h('b', { text: title }),
		rows.length
			? rows.map(r => h('div', { class: 'sa-mini' }, iconRow(r.pair), h('span', { class: 'sa-grow sa-sub', text: `${r.n} game${r.n === 1 ? '' : 's'}, ${r.w}-${r.l}` }), winRate(r, minN, { compact: true })))
			: h('div', { class: 'sa-sub', text: 'Not enough games yet.' }),
	);
}

export function renderUsage(c) {
	if (!c.all.length) return emptyState('No usage data yet', 'Play a few VGC games and your Pokemon usage, lead and Mega stats will build up here.');
	const u = usage(c.games);
	if (!u.games) return emptyState('No decided games match', 'Usage counts wins and losses only. Loosen or clear the filters.', btn('Clear filters', c.actions.clearFilters));
	const s = summary(c.games);
	const flags = { mega: u.rows.some(r => r.mega), tera: u.rows.some(r => r.tera) };
	const teams = listTeams(c.games);
	const sort = h('select', { 'aria-label': 'Sort Pokemon', onchange: e => { c.state.ui.usageSort = e.target.value; c.actions.render(); } }, SORTS.map(([v, l]) => h('option', { value: v, text: l })));
	sort.value = c.state.ui.usageSort || 'used';
	return h(
		'div',
		{},
		h('div', { class: 'sa-tiles' }, stat('Games', String(u.games), 'decided'), stat('Record', `${s.w}-${s.l}`), stat('Win rate', winRate(s, c.minN, { compact: true }), `N = ${s.n} games`)),
		teams.length > 1 ? h('div', { class: 'sa-banner', text: `Stats combine ${teams.length} different teams. Use the My team filter to look at one.` }) : null,
		h('h3', { class: 'sa-h3', text: 'Leads' }),
		h('div', { class: 'sa-cols' }, leadCard('Most common leads', mostCommonLeads(c.games), c.minN), leadCard('Best leads (min 2 games)', bestLeads(c.games), c.minN)),
		h('h3', { class: 'sa-h3' }, 'Pokemon', h('span', { class: 'sa-h3-sub', text: `based on ${u.games} games; faded = under ${c.minN} games` })),
		h('div', { class: 'sa-row', style: 'margin-bottom:6px' }, sort),
		h('ul', { class: 'sa-list' }, sortRows(u.rows, sort.value).map(r => monCard(r, c, flags))),
	);
}
