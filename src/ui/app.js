// Analyzer UI entry point.
//
//   const app = mountApp(rootEl, { repo, captureStatus, onChange, saveReplay, version });
//
//   repo           required. The store from openRepo().
//   captureStatus  optional. () => {userName, hint, live[], lastSaved, savedCount, errors[]}  (or such an object)
//   onChange       optional. SUBSCRIBE function: onChange(cb) -> unsubscribe. cb is called (with anything) when
//                  capture wrote something in this tab. repo.onChange() only reports OTHER tabs, so this is needed.
//   saveReplay     optional. (game) => void. Defaults to sending /savereplay to the battle room if the client still has it.
//   version        optional. Shown in Settings.
//
// Returns {ready: Promise, refresh(): Promise, openGame(roomid), setView(id), setCaptureStatus(s), destroy()}.
// Persisted settings keys (all via repo.setSetting): see SETTING_KEYS.
import { ROOT_ID } from '../host/detect.js';
import { h, clear, setDoc } from './components.js';
import { injectStyle } from './style.css.js';
import { renderFilterBar, sanitizeFilters, toQuery, DEFAULT_FILTERS, CURRENT_TEAM } from './filters.js';
import { filterGames, buildSets, listFormats, listTeams, opposing, DEFAULT_MIN_SAMPLE, DEFAULT_MIN_MATCHUP } from '../core/stats.js';
import { renderGames, renderGameDetail } from './views/games.js';
import { renderSets } from './views/sets.js';
import { renderUsage } from './views/usage.js';
import { renderMatchups } from './views/matchups.js';
import { renderMoves } from './views/moves.js';
import { renderSettings, DEFAULT_TRACKED_FORMATS } from './views/settings.js';

export const SETTING_KEYS = {
	filters: 'ui.filters',
	view: 'ui.view',
	minSample: 'ui.minSample',
	minMatchup: 'ui.minMatchup',
	trackedFormats: 'trackedFormats',
};

export const VIEWS = [
	{ id: 'games', label: 'Games', render: renderGames, filters: true, reviewed: true },
	{ id: 'sets', label: 'Sets', render: renderSets, filters: true, reviewed: false },
	{ id: 'usage', label: 'Usage', render: renderUsage, filters: true, reviewed: false },
	{ id: 'matchups', label: 'Matchups', render: renderMatchups, filters: true, reviewed: false },
	{ id: 'moves', label: 'Moves', render: renderMoves, filters: true, reviewed: false },
	{ id: 'settings', label: 'Settings', render: renderSettings, filters: false },
];

const stripRaw = g => {
	const { rawLog, rawEnc, ...rest } = g;
	return rest;
};

export function mountApp(rootEl, opts) {
	const o = opts || {};
	const repo = o.repo;
	if (!rootEl || !repo) throw new Error('mountApp needs a root element and a repo');
	const doc = rootEl.ownerDocument;
	const win = doc.defaultView;
	setDoc(doc);
	if (!rootEl.id) rootEl.id = ROOT_ID;
	injectStyle(doc);

	const state = {
		view: 'games',
		detail: null,
		filtersOpen: false,
		filters: { ...DEFAULT_FILTERS },
		ui: {},
	};
	const data = { all: [], setRecords: new Map(), allSets: [], formats: [], teams: [], oppSpecies: [], loaded: false, error: null };
	const cfg = { minN: DEFAULT_MIN_SAMPLE, minMatchup: DEFAULT_MIN_MATCHUP, trackedFormats: DEFAULT_TRACKED_FORMATS };
	let captureState = typeof o.captureStatus === 'function' ? safe(o.captureStatus) : o.captureStatus || null;
	let destroyed = false;
	let dirty = false;
	const timers = {};
	const unsubs = [];

	const nav = h('div', { class: 'sa-nav', role: 'tablist', 'aria-label': 'Analyzer views' });
	const status = h('div', { class: 'sa-status' });
	const filterHost = h('div');
	const content = h('div', { role: 'tabpanel', 'aria-live': 'polite' });
	rootEl.appendChild(h('div', { class: 'sa-app' }, nav, status, filterHost, content));

	function safe(fn) {
		try {
			return fn();
		} catch (e) {
			return null;
		}
	}
	function debounce(key, fn, ms) {
		clearTimeout(timers[key]);
		timers[key] = setTimeout(() => !destroyed && fn(), ms);
	}

	// ---------- data ----------

	async function loadData() {
		try {
			const [games, sets] = await Promise.all([repo.listGames(), repo.listSets()]);
			data.all = games.map(stripRaw);
			data.setRecords = new Map(sets.map(s => [s.id, s]));
			data.allSets = buildSets(data.all);
			data.formats = listFormats(data.all);
			data.teams = listTeams(data.all);
			data.oppSpecies = opposing(data.all).rows.map(r => r.species).sort();
			data.error = null;
		} catch (err) {
			data.error = err && err.message ? err.message : String(err);
		}
		data.loaded = true;
	}

	async function loadSettings() {
		const get = (k, d) => repo.getSetting(k, d).catch(() => d);
		state.filters = sanitizeFilters(await get(SETTING_KEYS.filters, null));
		const v = await get(SETTING_KEYS.view, 'games');
		if (VIEWS.some(x => x.id === v)) state.view = v;
		cfg.minN = Number(await get(SETTING_KEYS.minSample, DEFAULT_MIN_SAMPLE)) || DEFAULT_MIN_SAMPLE;
		cfg.minMatchup = Number(await get(SETTING_KEYS.minMatchup, DEFAULT_MIN_MATCHUP)) || DEFAULT_MIN_MATCHUP;
		const tf = await get(SETTING_KEYS.trackedFormats, DEFAULT_TRACKED_FORMATS);
		cfg.trackedFormats = Array.isArray(tf) && tf.length ? tf : DEFAULT_TRACKED_FORMATS;
	}

	async function refresh() {
		await loadData();
		render(true);
	}

	// ---------- actions ----------

	const actions = {
		render: () => render(),
		refresh,
		openGame(roomid) {
			state.detail = roomid;
			render();
			safe(() => nav.scrollIntoView({ block: 'start' }));
		},
		closeGame() {
			state.detail = null;
			render();
		},
		clearFilters() {
			state.filters = { ...DEFAULT_FILTERS };
			persistFilters();
			render();
		},
		async updateGame(roomid, patch) {
			const local = data.all.find(g => g.roomid === roomid);
			if (local) Object.assign(local, patch);
			const stored = await repo.getGame(roomid);
			if (stored) await repo.putGame({ ...stored, ...patch, updatedAt: Date.now() });
			render();
		},
		async updateSet(set, patch) {
			const existing = data.setRecords.get(set.id) || (await repo.getSet(set.id)) || { id: set.id, format: set.format, ts: set.ts, tags: [], notes: '' };
			const rec = await repo.putSet({ ...existing, ...patch, games: set.games.map(g => g.roomid), updatedAt: Date.now() });
			data.setRecords.set(set.id, rec);
			render();
		},
		async saveSetting(name, value) {
			await repo.setSetting(name, value);
			if (name === SETTING_KEYS.minSample) cfg.minN = value;
			if (name === SETTING_KEYS.minMatchup) cfg.minMatchup = value;
			if (name === SETTING_KEYS.trackedFormats) cfg.trackedFormats = value;
		},
		saveReplay(g) {
			if (typeof o.saveReplay === 'function') return o.saveReplay(g);
			const room = win && win.app && win.app.rooms && win.app.rooms[g.roomid];
			if (room && typeof room.send === 'function') {
				room.send('/savereplay');
				state.ui.msg = { text: 'Sent /savereplay to the battle room. The replay link appears in that room.' };
			} else {
				state.ui.msg = { text: 'The battle room is not open. Open it again (or use the replay link) and run /savereplay there.' };
			}
			render();
		},
	};
	// only offer the button when something can actually save the replay
	if (typeof o.saveReplay !== 'function' && !(win && win.app && win.app.rooms)) actions.saveReplay = null;

	function persistFilters() {
		debounce('filters', () => repo.setSetting(SETTING_KEYS.filters, state.filters).catch(() => {}), 400);
	}

	function setView(id) {
		state.view = id;
		state.detail = null;
		debounce('view', () => repo.setSetting(SETTING_KEYS.view, id).catch(() => {}), 400);
		render();
	}

	// ---------- render ----------

	function context() {
		const view = VIEWS.find(v => v.id === state.view) || VIEWS[0];
		const query = toQuery(state.filters);
		if (query.team === CURRENT_TEAM) query.team = data.teams.length ? data.teams[0].key : ''; // newest team first
		const games = filterGames(data.all, query);
		const ids = new Set(games.filter(g => g.setId).map(g => g.setId));
		return {
			state, view, repo, actions: { ...actions, setView },
			all: data.all, games, allSets: data.allSets, sets: data.allSets.filter(s => ids.has(s.id)), setRecords: data.setRecords,
			filters: state.filters, minN: cfg.minN, minMatchup: cfg.minMatchup, trackedFormats: cfg.trackedFormats, version: o.version,
		};
	}

	function renderNav() {
		clear(nav);
		for (const v of VIEWS) {
			nav.appendChild(h('button', { type: 'button', role: 'tab', class: 'sa-btn sa-tab', 'aria-selected': String(v.id === state.view), onclick: () => setView(v.id), text: v.label }));
		}
	}

	function renderStatus() {
		clear(status);
		const cs = captureState;
		if (!cs) return;
		const live = (cs.live || []).filter(l => l && l.state !== 'saved');
		if (cs.userName) status.appendChild(h('span', { text: 'Recording as ' + cs.userName }));
		if (live.length) status.appendChild(h('span', { class: 'sa-live', text: `Live: ${live.map(l => (l.players || []).join(' vs ') || l.roomid).join(', ')}${live[0].turn ? ` (turn ${live[0].turn})` : ''}` }));
		if (cs.savedCount) status.appendChild(h('span', { text: `${cs.savedCount} saved this session` }));
		if (cs.hint) status.appendChild(h('span', { class: 'sa-banner', style: 'flex:1 0 100%', text: cs.hint }));
		if (cs.errors && cs.errors.length) status.appendChild(h('span', { class: 'sa-delta-down', title: cs.errors.map(e => (e && e.message) || String(e)).join('\n'), text: `${cs.errors.length} capture error${cs.errors.length === 1 ? '' : 's'}` }));
	}

	function renderFilters(view) {
		clear(filterHost);
		if (!view.filters || !data.all.length) return;
		filterHost.appendChild(
			renderFilterBar({
				filters: state.filters,
				open: state.filtersOpen,
				formats: data.formats,
				teams: data.teams,
				oppSpecies: data.oppSpecies,
				showReviewed: !!view.reviewed,
				set(patch) {
					Object.assign(state.filters, patch);
					persistFilters();
					render();
				},
				toggle() {
					state.filtersOpen = !state.filtersOpen;
					render();
				},
				clear: actions.clearFilters,
			}),
		);
	}

	/** soft = triggered by background data changes: never rebuild under a focused text field (catch up on blur). */
	function render(soft) {
		if (destroyed) return;
		const active = doc.activeElement;
		if (soft === true && active && content.contains(active) && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && active.type === 'text'))) {
			dirty = true;
			return;
		}
		dirty = false;
		const focusSel = 'button,select,input,textarea,[tabindex="0"],a';
		const idx = active && rootEl.contains(active) ? [...rootEl.querySelectorAll(focusSel)].indexOf(active) : -1;
		const ctx = context();
		renderNav();
		renderStatus();
		renderFilters(ctx.view);
		clear(content);
		if (!data.loaded) content.appendChild(h('div', { class: 'sa-empty', text: 'Loading...' }));
		else if (data.error) content.appendChild(h('div', { class: 'sa-banner', text: 'Could not read the local database: ' + data.error }));
		else {
			try {
				content.appendChild(state.detail ? renderGameDetail(ctx) : ctx.view.render(ctx));
			} catch (err) {
				console.error('[Showdown Analyzer] render failed', err);
				content.appendChild(h('div', { class: 'sa-banner', text: 'This view failed to render: ' + (err && err.message ? err.message : String(err)) }));
			}
		}
		if (idx >= 0) {
			const el = rootEl.querySelectorAll(focusSel)[idx];
			if (el && el !== doc.activeElement) safe(() => el.focus({ preventScroll: true }));
		}
	}

	rootEl.addEventListener('focusout', () => {
		setTimeout(() => {
			if (dirty && !destroyed) render();
		}, 0);
	});

	// ---------- wiring ----------

	function scheduleRefresh() {
		debounce('refresh', () => refresh(), 300);
	}
	if (typeof o.onChange === 'function') {
		const u = safe(() => o.onChange(arg => {
			if (arg && typeof arg === 'object' && 'savedCount' in arg) captureState = arg;
			else if (typeof o.captureStatus === 'function') captureState = safe(o.captureStatus) || captureState;
			renderStatus();
			scheduleRefresh();
		}));
		if (typeof u === 'function') unsubs.push(u);
	}
	if (typeof repo.onChange === 'function') {
		unsubs.push(repo.onChange(msg => {
			if (!msg || msg.store === 'games' || msg.store === 'sets' || msg.store === '*') scheduleRefresh();
		}));
	}

	const ready = (async () => {
		render();
		await loadSettings();
		await loadData();
		render();
	})().catch(err => {
		console.error('[Showdown Analyzer] UI init failed', err);
		data.loaded = true;
		data.error = err && err.message ? err.message : String(err);
		render();
	});

	return {
		ready,
		refresh,
		openGame: actions.openGame,
		setView,
		setCaptureStatus(s) {
			const prevSaved = captureState && captureState.savedCount;
			captureState = s;
			renderStatus();
			if (s && s.savedCount !== prevSaved) scheduleRefresh();
		},
		destroy() {
			destroyed = true;
			Object.values(timers).forEach(clearTimeout);
			unsubs.forEach(u => safe(u));
			clear(rootEl);
		},
	};
}
