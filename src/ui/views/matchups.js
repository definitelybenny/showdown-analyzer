// Matchups: opposing Pokemon, best/worst, attendance, custom 1-6 Pokemon query.
import { h, btn, chip, pokeIcon, iconRow, stat, winRate, emptyState, pct } from '../components.js';
import { opposing, bestWorst, attendanceRanks, customQuery, summary, keyOf } from '../../core/stats.js';

const SORTS = [['against', 'Most faced'], ['worst', 'Worst win rate'], ['best', 'Best win rate'], ['att', 'Attendance'], ['name', 'Name']];

function sortRows(rows, how) {
	const l = [...rows];
	if (how === 'worst') l.sort((a, b) => a.hi - b.hi || b.n - a.n);
	else if (how === 'best') l.sort((a, b) => b.lo - a.lo || b.n - a.n);
	else if (how === 'att') l.sort((a, b) => (b.attendance || 0) - (a.attendance || 0) || b.on - a.on);
	else if (how === 'name') l.sort((a, b) => a.species.localeCompare(b.species));
	return l;
}

function cell(label, ...value) {
	return h('div', {}, h('div', { class: 'sa-cell-label', text: label }), h('div', { class: 'sa-cell-val' }, value));
}

function miniList(title, rows, right, minN) {
	return h(
		'div',
		{ class: 'sa-card' },
		h('b', { text: title }),
		rows.length
			? rows.map(r => h('div', { class: 'sa-mini' }, pokeIcon(r.species), h('span', { class: 'sa-grow' }, h('div', { text: r.species }), h('div', { class: 'sa-sub', text: `${r.on} game${r.on === 1 ? '' : 's'}` })), right(r, minN)))
			: h('div', { class: 'sa-sub', text: 'Not enough games yet.' }),
	);
}

function rowCard(r, minN) {
	return h(
		'li',
		{ class: 'sa-card' },
		h('div', { class: 'sa-row' }, pokeIcon(r.species), h('div', { class: 'sa-grow' }, h('div', { class: 'sa-title', text: r.species }), h('div', { class: 'sa-sub', text: `faced in ${r.against} game${r.against === 1 ? '' : 's'}` })), winRate(r, minN)),
		h(
			'div',
			{ class: 'sa-statgrid' },
			cell('On their team', String(r.on)),
			cell('Brought', `${r.brought} `, h('span', { class: 'sa-muted', text: `(${pct(r.attendance)})` })),
			cell('Win when brought', winRate(r.broughtWin, minN)),
		),
	);
}

function customPanel(c, rows) {
	const picked = c.state.ui.query || [];
	const known = rows.map(r => r.species);
	const input = h('input', { type: 'text', list: 'sa-q-list', placeholder: picked.length >= 6 ? 'Max 6' : 'Add opposing Pokemon', 'aria-label': 'Add Pokemon to query', disabled: picked.length >= 6 });
	const add = () => {
		const v = input.value.trim();
		if (!v) return;
		const hit = known.find(s => keyOf(s).toLowerCase() === keyOf(v).toLowerCase()) || v;
		if (!picked.some(p => keyOf(p) === keyOf(hit)) && picked.length < 6) {
			c.state.ui.query = [...picked, hit];
			c.actions.render();
		} else input.value = '';
	};
	input.addEventListener('keydown', e => e.key === 'Enter' && (e.preventDefault(), add()));
	input.addEventListener('change', add);
	const q = picked.length ? customQuery(c.games, picked) : null;
	const mm = c.minMatchup;
	return h(
		'div',
		{ class: 'sa-card' },
		h('div', { class: 'sa-sub', text: 'Pick 1-6 Pokemon to see how you do against opponents who had them on their team.' }),
		h('div', { class: 'sa-row', style: 'margin:6px 0' }, input, h('datalist', { id: 'sa-q-list' }, known.map(s => h('option', { value: s }))), picked.length ? btn('Clear', () => { c.state.ui.query = []; c.actions.render(); }, { class: 'sa-small' }) : null),
		picked.length ? h('div', { class: 'sa-chips' }, picked.map(s => chip([s, h('button', { type: 'button', 'aria-label': 'Remove ' + s, text: '×', onclick: () => { c.state.ui.query = picked.filter(x => x !== s); c.actions.render(); } })]))) : null,
		q
			? h(
				'div',
				{ style: 'margin-top:8px' },
				q.slots.map((sl, i) => h('div', { class: 'sa-mini' }, pokeIcon(picked[i]), h('span', { class: 'sa-grow' }, h('div', { text: picked[i] }), h('div', { class: 'sa-sub', text: `${sl.n} game${sl.n === 1 ? '' : 's'}, ${sl.w}-${sl.l}` })), winRate(sl, mm, { compact: true }))),
				picked.length > 1 ? h('div', { class: 'sa-mini' }, iconRow(picked), h('span', { class: 'sa-grow' }, h('div', { text: 'All together' }), h('div', { class: 'sa-sub', text: `${q.all.n} game${q.all.n === 1 ? '' : 's'} with all on their team` })), winRate(q.all, mm, { compact: true })) : null,
				q.mean !== null && picked.length > 1 ? h('div', { class: 'sa-note', text: `Simple average of the slots: ${pct(q.mean)} (ignores overlap between games)` }) : null,
			)
			: null,
	);
}

export function renderMatchups(c) {
	if (!c.all.length) return emptyState('No matchup data yet', 'Every opposing team you face is recorded. Play a few games and this page will show what beats you.');
	const o = opposing(c.games);
	if (!o.games) return emptyState('No decided games match', 'Matchups count wins and losses only. Loosen or clear the filters.', btn('Clear filters', c.actions.clearFilters));
	const s = summary(c.games);
	const mm = c.minMatchup;
	const { best, worst } = bestWorst(o.rows, { minN: mm });
	const att = attendanceRanks(o.rows, { minN: mm });
	const sort = h('select', { 'aria-label': 'Sort opposing Pokemon', onchange: e => { c.state.ui.mSort = e.target.value; c.actions.render(); } }, SORTS.map(([v, l]) => h('option', { value: v, text: l })));
	sort.value = c.state.ui.mSort || 'against';
	const cap = c.state.ui.mCap || 30;
	const sorted = sortRows(o.rows, sort.value);
	const wr = r => winRate(r, mm, { compact: true });
	const attR = r => h('span', { class: 'sa-wr' }, h('span', { class: 'sa-wr-pct', text: pct(r.attendance) }), h('span', { class: 'sa-wr-n', text: `${r.brought}/${r.on}` }));
	return h(
		'div',
		{},
		h('div', { class: 'sa-tiles' }, stat('Games', String(o.games), 'decided'), stat('Record', `${s.w}-${s.l}`), stat('Opp. Pokemon', String(o.rows.length), 'seen')),
		h('h3', { class: 'sa-h3' }, 'Best and worst', h('span', { class: 'sa-h3-sub', text: `min ${mm} games, ranked by Wilson interval` })),
		h('div', { class: 'sa-cols' }, miniList('Best matchups', best, wr), miniList('Worst matchups', worst, wr), miniList('Most often brought', att.high, attR), miniList('Least often brought', att.low, attR)),
		h('h3', { class: 'sa-h3', text: 'Custom team query' }),
		customPanel(c, o.rows),
		h('h3', { class: 'sa-h3' }, 'All opposing Pokemon', h('span', { class: 'sa-h3-sub', text: `faded = under ${mm} games` })),
		h('div', { class: 'sa-row', style: 'margin-bottom:6px' }, sort),
		h('ul', { class: 'sa-list' }, sorted.slice(0, cap).map(r => rowCard(r, mm))),
		sorted.length > cap ? h('div', { style: 'margin-top:8px;text-align:center' }, btn(`Show ${Math.min(30, sorted.length - cap)} more`, () => { c.state.ui.mCap = cap + 30; c.actions.render(); })) : null,
	);
}
