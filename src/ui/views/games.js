// Games: filtered list + detail pane (open team sheets, picks, leads, mega, rating, notes, replay).
import { h, btn, iconRow, pokeIcon, resultBadge, stat, winRate, emptyState, fmtDate, fmtDateTime, shortFormat, replayUrl, pct } from '../components.js';
import { summary, keyOf } from '../../core/stats.js';

const SORTS = [['new', 'Newest first'], ['old', 'Oldest first'], ['result', 'Result'], ['opp', 'Opponent']];

function oppName(g) {
	const p = g.players && g.players[g.opp || 'p2'];
	return (p && p.name) || 'Unknown';
}

function ratingText(g) {
	const r = g.ratings && g.ratings[g.side || 'p1'];
	if (!r || typeof r.before !== 'number' || typeof r.after !== 'number') return null;
	return { before: r.before, after: r.after, delta: r.after - r.before };
}

/** Icons for a full roster with picks dimmed/highlighted, leads outlined and the mega marked. */
function teamIcons(g, s) {
	const picks = new Set((g.picks[s] || []).map(keyOf));
	const leads = new Set((g.leads[s] || []).map(keyOf));
	const megas = new Set((g.mega[s] || []).map(m => keyOf(m.species)));
	const hasPicks = picks.size > 0;
	const items = (g.roster[s] || []).map(r => {
		const k = keyOf(r.species);
		const mega = (g.mega[s] || []).find(m => keyOf(m.species) === k);
		return { species: r.species, brought: hasPicks ? picks.has(k) : undefined, lead: leads.has(k), mega: megas.has(k), title: mega ? mega.forme : r.species };
	});
	return iconRow(items);
}

function sortGames(list, how) {
	const l = [...list];
	if (how === 'old') l.sort((a, b) => (a.ts || 0) - (b.ts || 0));
	else if (how === 'result') l.sort((a, b) => String(a.result).localeCompare(String(b.result)) || (b.ts || 0) - (a.ts || 0));
	else if (how === 'opp') l.sort((a, b) => oppName(a).localeCompare(oppName(b)) || (b.ts || 0) - (a.ts || 0));
	else l.sort((a, b) => (b.ts || 0) - (a.ts || 0));
	return l;
}

function gameCard(g, c) {
	const rt = ratingText(g);
	const open = () => c.actions.openGame(g.roomid);
	const subBits = [fmtDate(g.ts), shortFormat(g.format), g.turns ? `${g.turns} turns` : null, g.end && g.end !== 'win' ? g.end : null].filter(Boolean);
	return h(
		'li',
		{ class: 'sa-card sa-click', tabindex: '0', role: 'button', 'aria-label': `Game vs ${oppName(g)}, ${g.result || 'unknown'}. Open details`, onclick: open, onkeydown: e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open()) },
		h(
			'div',
			{ class: 'sa-row' },
			resultBadge(g.result),
			h('div', { class: 'sa-grow' }, h('div', { class: 'sa-title', text: 'vs ' + oppName(g) }), h('div', { class: 'sa-sub', text: subBits.join(' · ') })),
			g.bo3 ? h('span', { class: 'sa-pill', text: `Bo3 G${g.bo3.gameNumber}` }) : null,
			rt ? h('span', { class: 'sa-pill ' + (rt.delta >= 0 ? 'sa-pill-good' : 'sa-pill-bad'), text: (rt.delta >= 0 ? '+' : '') + rt.delta }) : null,
			g.reviewed ? h('span', { class: 'sa-pill', text: 'reviewed' }) : null,
			g.partial ? h('span', { class: 'sa-pill sa-pill-mid', title: 'Joined mid-game: excluded from stats', text: 'partial' }) : null,
		),
		h('div', { class: 'sa-teamline' }, h('span', { class: 'sa-lbl', text: 'Me' }), teamIcons(g, g.side || 'p1')),
		h('div', { class: 'sa-teamline' }, h('span', { class: 'sa-lbl', text: 'Opp' }), teamIcons(g, g.opp || 'p2')),
		g.notes ? h('div', { class: 'sa-sub', style: 'margin-top:4px', text: g.notes.length > 140 ? g.notes.slice(0, 140) + '...' : g.notes }) : null,
	);
}

export function renderGames(c) {
	if (c.state.detail) return renderGameDetail(c);
	if (!c.all.length) {
		return emptyState('No games recorded yet', 'Play a rated or casual VGC game on Showdown (or spectate one) and it will appear here automatically. Recording starts once you are logged in.');
	}
	const s = summary(c.games);
	const reviewed = c.games.filter(g => g.reviewed).length;
	const tiles = h(
		'div',
		{ class: 'sa-tiles' },
		stat('Games', String(s.total), s.other ? `${s.n} decided` : null),
		stat('Record', `${s.w}-${s.l}`),
		stat('Win rate', winRate(s, c.minN, { compact: true }), `N = ${s.n} games`),
		stat('Reviewed', `${reviewed}/${s.total}`),
	);
	if (!c.games.length) return h('div', {}, tiles, emptyState('No games match these filters', 'Loosen or clear the filters above.', btn('Clear filters', c.actions.clearFilters)));
	const sort = h('select', { 'aria-label': 'Sort games', onchange: e => { c.state.ui.sort = e.target.value; c.actions.render(); } }, SORTS.map(([v, l]) => h('option', { value: v, text: l })));
	sort.value = c.state.ui.sort || 'new';
	const shown = sortGames(c.games, sort.value);
	const cap = c.state.ui.gamesCap || 50;
	return h(
		'div',
		{},
		tiles,
		h('div', { class: 'sa-row', style: 'margin-bottom:6px' }, sort, h('span', { class: 'sa-sub', text: `${c.games.length} games` })),
		h('ul', { class: 'sa-list' }, shown.slice(0, cap).map(g => gameCard(g, c))),
		shown.length > cap ? h('div', { style: 'margin-top:8px;text-align:center' }, btn(`Show ${Math.min(50, shown.length - cap)} more`, () => { c.state.ui.gamesCap = cap + 50; c.actions.render(); })) : null,
	);
}

// ---------- detail ----------

function sheetFor(g, s) {
	const sheet = (g.teams && g.teams[s]) || [];
	if (sheet.length) return sheet.map(t => ({ ...t, hasSheet: true }));
	return (g.roster[s] || []).map(r => ({ species: r.species, hasSheet: false }));
}

function teamSheet(g, s, label) {
	const picks = new Set((g.picks[s] || []).map(keyOf));
	const leads = new Set((g.leads[s] || []).map(keyOf));
	const megaBy = new Map((g.mega[s] || []).map(m => [keyOf(m.species), m]));
	const teraBy = new Map((g.tera[s] || []).map(t => [keyOf(t.species), t]));
	const usedBy = new Map(Object.entries((g.moves && g.moves[s]) || {}).map(([sp, m]) => [keyOf(sp), m]));
	const p = g.players && g.players[s];
	const entries = sheetFor(g, s);
	return h(
		'div',
		{ class: 'sa-card' },
		h('div', { class: 'sa-row' }, h('b', { text: label }), h('span', { class: 'sa-sub sa-grow', text: p && p.name ? p.name : '' }), p && typeof p.rating === 'number' ? h('span', { class: 'sa-pill', text: String(p.rating) }) : null),
		entries.length ? entries.map(t => {
			const k = keyOf(t.species);
			const mega = megaBy.get(k);
			const tera = teraBy.get(k);
			const used = usedBy.get(k) || {};
			const sheetMoves = (t.moves || []).map(m => m);
			const norm = x => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
			const extra = Object.keys(used).filter(m => !sheetMoves.some(sm => norm(sm) === norm(m)));
			const usedCount = m => {
				const key = Object.keys(used).find(u => norm(u) === norm(m));
				return key ? used[key] : 0;
			};
			return h(
				'div',
				{ class: 'sa-mon' },
				pokeIcon(mega ? mega.species : t.species, { brought: picks.size ? picks.has(k) : undefined, lead: leads.has(k), mega: !!mega }),
				h(
					'div',
					{ class: 'sa-mon-body' },
					h('div', { class: 'sa-row' }, h('b', { text: mega ? mega.forme : t.species }), picks.has(k) ? h('span', { class: 'sa-pill' + (leads.has(k) ? ' sa-pill-good' : ''), text: leads.has(k) ? 'lead' : 'back' }) : picks.size ? h('span', { class: 'sa-pill', text: 'not brought' }) : null, tera ? h('span', { class: 'sa-pill sa-pill-mid', text: 'Tera ' + tera.type }) : null),
					t.hasSheet ? h('div', { class: 'sa-mon-moves', text: [t.item || null, t.ability || null, t.nature || null].filter(Boolean).join(' · ') }) : null,
					sheetMoves.length || extra.length
						? h('div', { class: 'sa-mon-moves' }, [
							...sheetMoves.map((m, i) => [i ? ', ' : '', usedCount(m) ? h('b', { text: `${m} x${usedCount(m)}` }) : m]),
							...extra.map(m => [', ', h('span', { class: 'sa-delta-down', title: 'Used but not on the open team sheet', text: `${m} x${used[m]}` })]),
						])
						: null,
				),
			);
		}) : h('div', { class: 'sa-sub', text: 'No team data stored.' }),
	);
}

export function renderGameDetail(c) {
	const g = c.all.find(x => x.roomid === c.state.detail);
	if (!g) {
		return h('div', {}, btn('← Back', c.actions.closeGame), emptyState('Game not found', 'It may have been deleted.'));
	}
	const me = g.side || 'p1';
	const opp = g.opp || 'p2';
	const rt = ratingText(g);
	const url = replayUrl(g);
	const reviewed = h('input', { type: 'checkbox', checked: !!g.reviewed, onchange: e => c.actions.updateGame(g.roomid, { reviewed: e.target.checked }) });
	const notes = h('textarea', { 'aria-label': 'Game notes', placeholder: 'Notes about this game...', value: g.notes || '' });
	notes.addEventListener('blur', () => notes.value !== (g.notes || '') && c.actions.updateGame(g.roomid, { notes: notes.value }));
	const endText = { win: 'Played out', forfeit: g.forfeiter ? (g.forfeiter === me ? 'You forfeited' : 'Opponent forfeited') : 'Forfeit', inactivity: 'Inactivity', tie: 'Tie', incomplete: 'Incomplete' }[g.end] || g.end;
	return h(
		'div',
		{},
		h('div', { class: 'sa-row', style: 'margin-bottom:8px' }, btn('← Back', c.actions.closeGame), h('span', { class: 'sa-grow' })),
		h(
			'div',
			{ class: 'sa-card' },
			h('div', { class: 'sa-row' }, resultBadge(g.result), h('div', { class: 'sa-grow' }, h('div', { class: 'sa-title', text: 'vs ' + oppName(g) }), h('div', { class: 'sa-sub', text: `${fmtDateTime(g.ts)} · ${shortFormat(g.format)}` }))),
			h(
				'div',
				{ class: 'sa-tiles', style: 'margin-top:8px' },
				stat('Turns', String(g.turns || '-'), endText),
				rt ? stat('Rating', `${rt.before} → ${rt.after}`, h('span', { class: rt.delta >= 0 ? 'sa-delta-up' : 'sa-delta-down', text: (rt.delta >= 0 ? '+' : '') + rt.delta })) : stat('Rating', '-', g.rated ? 'not seen' : 'unrated'),
				g.bo3 ? stat('Best of 3', `Game ${g.bo3.gameNumber}`, g.bo3.score ? `score ${g.bo3.score[me]}-${g.bo3.score[opp]} before` : null) : null,
			),
			g.partial ? h('div', { class: 'sa-banner', text: 'Joined mid-game: lead/pick data may be incomplete and this game is excluded from stats.' }) : null,
			h('div', { class: 'sa-row', style: 'margin-top:6px' }, url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Open replay' }) : null, c.actions.saveReplay ? btn('Save replay', () => c.actions.saveReplay(g), { class: 'sa-small', title: 'Runs /savereplay in the battle room if it is still open' }) : null),
		),
		h('div', { class: 'sa-sheets', style: 'margin-top:8px' }, teamSheet(g, me, 'Me'), teamSheet(g, opp, 'Opponent')),
		h('h3', { class: 'sa-h3', text: 'Notes' }),
		notes,
		h('label', { class: 'sa-field sa-check', style: 'margin-top:6px' }, reviewed, h('span', { text: 'Reviewed' })),
	);
}

export { pct };
