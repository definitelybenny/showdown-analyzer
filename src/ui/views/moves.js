// Moves: per-Pokemon move usage, compared against the open team sheet when one was seen.
import { h, btn, pokeIcon, emptyState, pct } from '../components.js';
import { moveUsage } from '../../core/stats.js';

function monCard(r) {
	const hasSheet = r.sheetGames > 0;
	return h(
		'li',
		{ class: 'sa-card' },
		h('div', { class: 'sa-row' }, pokeIcon(r.species), h('div', { class: 'sa-grow' }, h('div', { class: 'sa-title', text: r.species }), h('div', { class: 'sa-sub', text: `seen in ${r.games} game${r.games === 1 ? '' : 's'}${hasSheet ? `, team sheet in ${r.sheetGames}` : ', no team sheet'}` }))),
		h(
			'div',
			{ style: 'margin-top:4px' },
			r.moves.map(m =>
				h(
					'div',
					{ class: 'sa-moverow ' + (m.inSet === true ? 'sa-move-in' : m.inSet === false ? 'sa-move-out' : 'sa-move-unk'), title: m.inSet === false ? 'Not on the open team sheet (set change, called move or a transformed Pokemon)' : '' },
					h('span', { class: 'sa-moveName', text: m.move }),
					h('div', { class: 'sa-bar' }, h('i', { style: { width: pct(m.pct) } })),
					h('span', { class: 'sa-sub', text: `${m.count} (${pct(m.pct)})` }),
				),
			),
		),
	);
}

export function renderMoves(c) {
	if (!c.all.length) return emptyState('No move data yet', 'Moves are counted from every game you record. Play a game and your move usage will show here.');
	const who = c.state.ui.movesWho || 'me';
	const rows = moveUsage(c.games, who);
	const pick = w => () => {
		c.state.ui.movesWho = w;
		c.state.ui.movesCap = 0;
		c.actions.render();
	};
	const toggle = h(
		'div',
		{ class: 'sa-row', style: 'margin-bottom:6px' },
		h('button', { type: 'button', class: 'sa-btn' + (who === 'me' ? ' sa-primary' : ''), 'aria-pressed': String(who === 'me'), onclick: pick('me'), text: 'My Pokemon' }),
		h('button', { type: 'button', class: 'sa-btn' + (who === 'opp' ? ' sa-primary' : ''), 'aria-pressed': String(who === 'opp'), onclick: pick('opp'), text: 'Opponents' }),
	);
	if (!rows.length) return h('div', {}, toggle, emptyState('No games match', 'Loosen or clear the filters.', btn('Clear filters', c.actions.clearFilters)));
	const cap = c.state.ui.movesCap || 20;
	return h(
		'div',
		{},
		toggle,
		h('div', { class: 'sa-note', text: 'Green = on the open team sheet, red = used but not on the sheet, blue = no sheet seen. Moves triggered by another effect (Dancer, Instruct, called moves) are not counted.' }),
		h('ul', { class: 'sa-list' }, rows.slice(0, cap).map(monCard)),
		rows.length > cap ? h('div', { style: 'margin-top:8px;text-align:center' }, btn(`Show ${Math.min(20, rows.length - cap)} more`, () => { c.state.ui.movesCap = cap + 20; c.actions.render(); })) : null,
	);
}
