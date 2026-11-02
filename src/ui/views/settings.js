// Settings / Data: tracked formats, sample thresholds, export/import, reparse, clear, version info.
import { h, btn, sectionTitle } from '../components.js';
import { exportAll, importData } from '../../store/export.js';
import { downloadJson } from '../../store/download.js';
import { parseLog } from '../../core/parser.js';
import { PARSER_VERSION } from '../../core/schema.js';

/** Same default the capture layer uses when the setting is unset. */
export const DEFAULT_TRACKED_FORMATS = ['^gen9(champions)?vgc\\d{4}'];

export function renderSettings(c) {
	const ui = c.state.ui;
	const say = (text, kind) => {
		ui.msg = { text, kind: kind || 'info' };
		c.actions.render();
	};
	const busy = fn => async () => {
		try {
			await fn();
		} catch (err) {
			say('Failed: ' + (err && err.message ? err.message : String(err)), 'error');
		}
	};

	const formats = h('textarea', { 'aria-label': 'Tracked formats', rows: 3, value: c.trackedFormats.join('\n') });
	const minSample = h('input', { type: 'number', min: 1, max: 100, value: String(c.minN), 'aria-label': 'Minimum sample for win rates', style: 'width:70px' });
	const minMatchup = h('input', { type: 'number', min: 1, max: 100, value: String(c.minMatchup), 'aria-label': 'Minimum sample for matchups', style: 'width:70px' });
	const fileInput = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Import file' });
	const mode = h('select', { 'aria-label': 'Import mode' }, h('option', { value: 'merge', text: 'Merge with existing data' }), h('option', { value: 'replace', text: 'Replace all data' }));
	const armed = ui.clearArmed;

	return h(
		'div',
		{ class: 'sa-settings' },
		ui.msg ? h('div', { class: 'sa-banner', role: 'status', text: ui.msg.text, style: ui.msg.kind === 'error' ? 'border-color:var(--sa-bad)' : '' }) : null,

		sectionTitle('Recording'),
		h('label', { class: 'sa-field' }, h('span', { text: 'Tracked formats (one regular expression per line, matched against the format id)' }), formats),
		h('div', { class: 'sa-note', text: 'Default tracks every VGC format of generation 9 and Champions. Changes apply to new games.' }),
		h('div', { class: 'sa-row' },
			btn('Save formats', busy(async () => {
				const list = formats.value.split('\n').map(s => s.trim()).filter(Boolean);
				for (const src of list) new RegExp(src, 'i');
				await c.actions.saveSetting('trackedFormats', list.length ? list : DEFAULT_TRACKED_FORMATS);
				say('Tracked formats saved.');
			}), { primary: true }),
			btn('Reset to default', busy(async () => {
				await c.actions.saveSetting('trackedFormats', DEFAULT_TRACKED_FORMATS);
				say('Tracked formats reset.');
			})),
		),

		sectionTitle('Statistics'),
		h('div', { class: 'sa-row' },
			h('label', { class: 'sa-field' }, h('span', { text: 'Min games (win rates)' }), minSample),
			h('label', { class: 'sa-field' }, h('span', { text: 'Min games (matchups)' }), minMatchup),
			btn('Save', busy(async () => {
				await c.actions.saveSetting('ui.minSample', Math.max(1, Number(minSample.value) || 5));
				await c.actions.saveSetting('ui.minMatchup', Math.max(1, Number(minMatchup.value) || 3));
				say('Thresholds saved.');
			})),
		),
		h('div', { class: 'sa-note', text: 'Win rates from fewer games than this are shown faded. Hover a win rate to see its 95% interval.' }),

		sectionTitle('Data', `${c.all.length} games, ${c.allSets.length} sets stored locally`),
		h('div', { class: 'sa-row' },
			btn('Export JSON', busy(async () => {
				const data = await exportAll(c.repo);
				downloadJson(`showdown-analyzer-${new Date().toISOString().slice(0, 10)}.json`, data);
				say(`Exported ${data.games.length} games.`);
			}), { primary: true }),
		),
		h('div', { class: 'sa-row', style: 'margin-top:8px' }, fileInput, mode,
			btn('Import', busy(async () => {
				const file = fileInput.files && fileInput.files[0];
				if (!file) return say('Choose a JSON file first.', 'error');
				const text = await file.text();
				const r = await importData(c.repo, text, { mode: mode.value });
				await c.actions.refresh();
				say(`Imported ${r.games} games, ${r.sets} sets (${r.mode}).`);
			})),
		),
		h('div', { class: 'sa-note', text: 'Your data lives only in this browser. Export regularly: clearing site data deletes it.' }),
		h('div', { class: 'sa-row', style: 'margin-top:8px' },
			btn('Reparse all games', busy(async () => {
				const dex = typeof window !== 'undefined' && window.Dex && window.Dex.species ? window.Dex : undefined;
				const r = await c.repo.reparseAll((raw, old) => parseLog(raw, { me: old.me, dex }));
				await c.actions.refresh();
				say(`Reparsed ${r.updated} games${r.failed.length ? `, ${r.failed.length} failed (no raw log or parse error)` : ''}.`, r.failed.length ? 'error' : 'info');
			}), { title: 'Rebuild stats from the stored raw logs after a parser update' }),
			btn(armed ? 'Really delete everything?' : 'Clear all data', busy(async () => {
				if (!armed) {
					ui.clearArmed = true;
					return c.actions.render();
				}
				ui.clearArmed = false;
				await c.repo.clearAll();
				await c.actions.refresh();
				say('All data deleted.');
			}), { danger: true, class: armed ? 'sa-armed' : '' }),
			armed ? btn('Cancel', () => { ui.clearArmed = false; c.actions.render(); }) : null,
		),

		sectionTitle('About'),
		h('div', { class: 'sa-sub', text: `Showdown Analyzer${c.version ? ' ' + c.version : ''} · parser v${PARSER_VERSION} · store schema v${c.repo.schemaVersion}` }),
	);
}
