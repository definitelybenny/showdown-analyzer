// Chooses the tab implementation for the running client, waits for it to be ready (polling), and
// falls back to the floating panel when no usable client appears in time or tab creation throws.

import { ROOT_ID, classicTabReady, preactTabReady, describeMissing, detectClient } from './detect.js';
import { openClassicTab } from './tab-classic.js';
import { openPreactTab, resetTabUrl } from './tab-preact.js';
import { openFloating } from './floating.js';

export { resetTabUrl };

let mode = null; // 'classic' | 'preact' | 'floating'
let root = null;
let pending = null;
let reason = '';
const readyFns = [];

function setRoot(el) {
	root = el;
	for (const fn of readyFns.slice()) callReady(fn, el);
}

function callReady(fn, el) {
	try {
		fn(el);
	} catch (err) {
		console.error('[Showdown Analyzer] onReady callback failed', err);
	}
}

/** Called with the container element now, if it exists, and again whenever it is (re)created. */
export function onReady(fn) {
	if (typeof fn !== 'function') return () => {};
	readyFns.push(fn);
	const el = getRoot();
	if (el) callReady(fn, el);
	return () => {
		const i = readyFns.indexOf(fn);
		if (i >= 0) readyFns.splice(i, 1);
	};
}

/** The container element, or null if the tab is not mounted. */
export function getRoot(win = globalThis) {
	const doc = win.document;
	const live = doc && typeof doc.getElementById === 'function' ? doc.getElementById(ROOT_ID) : null;
	return live || root;
}

export function getTabMode() {
	return mode;
}

/** Why the floating fallback is in use ('' otherwise). */
export function getTabDiagnostic() {
	return reason;
}

function toFloating(win, why) {
	mode = 'floating';
	reason = why;
	console.warn('[Showdown Analyzer] mode: floating panel (' + why + ')');
	openFloating(win, { reason: why, onRoot: setRoot, onClosed: () => { root = null; } });
}

/**
 * Open the tab as soon as the client allows it. `focus` is false on startup so we never steal the view.
 * Polls every pollMs for up to waitMs, then falls back to the floating panel.
 */
export function openTab({ win = globalThis, focus = false, pollMs = 500, waitMs = 30000 } = {}) {
	if (pending) {
		pending.focus = pending.focus || focus;
		return;
	}
	if (mode) return;
	const job = pending = { focus, elapsed: 0 };
	const attempt = () => {
		const client = detectClient(win);
		const classic = client === 'classic' && classicTabReady(win);
		const preact = client === 'preact' && preactTabReady(win);
		if (classic || preact) {
			pending = null;
			try {
				if (classic) {
					const tab = openClassicTab(win, { focus: job.focus, onClosed: () => { root = null; } });
					mode = 'classic';
					setRoot(tab.root);
				} else {
					mode = 'preact';
					openPreactTab(win, {
						focus: job.focus,
						onReady: () => {
							const el = getRoot(win);
							if (el) setRoot(el);
						},
						onClosed: () => { root = null; },
					});
				}
			} catch (err) {
				console.error('[Showdown Analyzer] creating the tab failed', err);
				toFloating(win, String((err && err.message) || err));
			}
			return;
		}
		if (job.elapsed >= waitMs) {
			pending = null;
			toFloating(win, describeMissing(win) || 'client not ready');
			return;
		}
		setTimeout(() => {
			job.elapsed += pollMs;
			attempt();
		}, pollMs);
	};
	attempt();
}

/** Test helper: forget all state. */
export function resetTab() {
	mode = null;
	root = null;
	pending = null;
	reason = '';
	readyFns.length = 0;
}
