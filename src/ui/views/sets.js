// Sets: Bo3 cards with per-game rows, record, rating delta, tags and notes.
import { h, btn, chip, iconRow, resultBadge, emptyState, fmtDate, shortFormat, stat, winRate } from '../components.js';
import { keyOf, wilson } from '../../core/stats.js';

function picksIcons(g, s) {
	const picks = (g.picks[s] || []).map(sp => {
		const m = (g.mega[s] || []).find(x => keyOf(x.species) === keyOf(sp));
		return { species: sp, mega: !!m, lead: (g.leads[s] || []).some(l => keyOf(l) === keyOf(sp)) };
	});
	return iconRow(picks);
}

function setCard(set, c) {
	const rec = c.setRecords.get(set.id) || {};
	const tags = rec.tags || [];
	const status = set.result === 'win' ? ['Won', 'sa-pill-good'] : set.result === 'loss' ? ['Lost', 'sa-pill-bad'] : ['Incomplete', 'sa-pill-mid'];
	const save = patch => c.actions.updateSet(set, patch);
	const notes = h('textarea', { 'aria-label': 'Set notes', placeholder: 'Notes about this set...', value: rec.notes || '' });
	notes.addEventListener('blur', () => notes.value !== (rec.notes || '') && save({ notes: notes.value }));
	const tagInput = h('input', { type: 'text', placeholder: 'Add tag, Enter', 'aria-label': 'Add tag', style: 'width:110px' });
	tagInput.addEventListener('keydown', e => {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		const t = tagInput.value.trim();
		if (t && !tags.includes(t)) save({ tags: [...tags, t] });
	});
	const maxN = Math.max(set.bestOf, ...set.games.map(g => g.gameNumber || 0));
	const rows = [];
	for (let n = 1; n <= maxN; n++) {
		const g = set.games.find(x => x.gameNumber === n);
		if (!g) {
			rows.push(h('div', { class: 'sa-setgame sa-notplayed' }, h('span', { class: 'sa-pill', text: 'G' + n }), h('span', { text: set.missing.includes(n) ? 'Not recorded' : 'Not played' })));
			continue;
		}
		const open = () => c.actions.openGame(g.roomid);
		rows.push(
			h(
				'div',
				{ class: 'sa-setgame', tabindex: '0', role: 'button', 'aria-label': `Game ${n}: ${g.result}. Open details`, onclick: open, onkeydown: e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open()) },
				h('div', { class: 'sa-row', style: 'width:100%' }, h('span', { class: 'sa-pill', text: 'G' + n }), resultBadge(g.result), g.end === 'forfeit' ? h('span', { class: 'sa-pill', text: 'forfeit' }) : null),
				h('div', { class: 'sa-teamline', style: 'width:100%' }, h('span', { class: 'sa-lbl', text: 'Me' }), picksIcons(g, g.side || 'p1')),
				h('div', { class: 'sa-teamline', style: 'width:100%' }, h('span', { class: 'sa-lbl', text: 'Opp' }), picksIcons(g, g.opp || 'p2')),
			),
		);
	}
	return h(
		'li',
		{ class: 'sa-card' },
		h(
			'div',
			{ class: 'sa-row' },
			h('div', { class: 'sa-grow' }, h('div', { class: 'sa-title', text: 'vs ' + (set.opp || 'Unknown') }), h('div', { class: 'sa-sub', text: `${fmtDate(set.ts)} · ${shortFormat(set.format)}` })),
			h('span', { class: 'sa-pill ' + status[1], text: `${status[0]} ${set.wins}-${set.losses}` }),
			set.ratingDelta !== null ? h('span', { class: 'sa-pill ' + (set.ratingDelta >= 0 ? 'sa-pill-good' : 'sa-pill-bad'), title: `${set.ratingBefore} to ${set.ratingAfter}`, text: (set.ratingDelta >= 0 ? '+' : '') + set.ratingDelta }) : null,
		),
		h('div', { style: 'margin-top:6px' }, rows),
		h('div', { class: 'sa-tags', style: 'margin-top:6px' }, tags.map(t => chip([t, h('button', { type: 'button', 'aria-label': 'Remove tag ' + t, text: '×', onclick: () => save({ tags: tags.filter(x => x !== t) }) })])), tagInput),
		notes,
	);
}

export function renderSets(c) {
	if (!c.allSets.length) {
		return emptyState('No best-of-3 sets yet', 'Sets appear here when you play a Bo3 ladder or tournament match. Single games show up under Games.');
	}
	const sets = c.sets;
	if (!sets.length) return emptyState('No sets match these filters', 'Loosen or clear the filters.', btn('Clear filters', c.actions.clearFilters));
	const done = sets.filter(s => s.complete);
	const w = done.filter(s => s.result === 'win').length;
	const r = { w, l: done.length - w, n: done.length, rate: done.length ? w / done.length : null };
	const iv = wilson(w, done.length);
	r.lo = iv.lo;
	r.hi = iv.hi;
	return h(
		'div',
		{},
		h('div', { class: 'sa-tiles' }, stat('Sets', String(sets.length), `${done.length} complete`), stat('Record', `${w}-${done.length - w}`), stat('Set win rate', winRate(r, c.minN, { compact: true }), `N = ${done.length} sets`)),
		h('ul', { class: 'sa-list' }, sets.map(s => setCard(s, c))),
	);
}
