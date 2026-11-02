// Last-resort UI: a small fixed panel appended to <body>, used when no usable client tab API shows up.

import { ROOT_ID, TAB_TITLE } from './detect.js';

const PANEL_ID = 'sa-floating';

const PANEL_CSS = `
#${PANEL_ID}{position:fixed;right:12px;bottom:12px;z-index:100000;width:360px;max-width:calc(100vw - 24px);max-height:70vh;display:flex;flex-direction:column;background:#fff;color:#222;border:1px solid #888;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.35);font:12px/1.4 Verdana,sans-serif}
#${PANEL_ID} .sa-float-head{display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:#e4e8ee;border-radius:6px 6px 0 0;font-weight:bold}
#${PANEL_ID} .sa-float-head button{cursor:pointer}
#${PANEL_ID} .sa-diag{padding:2px 8px;color:#a05000;font-size:11px}
#${PANEL_ID} #${ROOT_ID}{overflow:auto}
`;

/**
 * Build the panel (waiting for <body> at document-start). Calls onRoot(root) once it exists.
 * `reason` is shown as a small diagnostics line.
 */
export function openFloating(win, { reason = '', onRoot, onClosed } = {}) {
	const doc = win.document;
	let built = false;
	const build = () => {
		if (built || !doc.body) return;
		built = true;
		if (doc.getElementById(PANEL_ID)) return;
		const style = doc.createElement('style');
		style.textContent = PANEL_CSS;
		const panel = doc.createElement('div');
		panel.id = PANEL_ID;
		const head = doc.createElement('div');
		head.className = 'sa-float-head';
		const title = doc.createElement('span');
		title.textContent = TAB_TITLE;
		const close = doc.createElement('button');
		close.textContent = 'x';
		close.title = 'Close';
		close.addEventListener('click', () => {
			panel.remove();
			style.remove();
			if (onClosed) onClosed();
		});
		head.appendChild(title);
		head.appendChild(close);
		panel.appendChild(head);
		if (reason) {
			const diag = doc.createElement('div');
			diag.className = 'sa-diag';
			diag.textContent = 'Tab unavailable: ' + reason;
			panel.appendChild(diag);
		}
		const root = doc.createElement('div');
		root.id = ROOT_ID;
		panel.appendChild(root);
		doc.body.appendChild(style);
		doc.body.appendChild(panel);
		if (onRoot) onRoot(root);
	};
	if (doc.body) build();
	else doc.addEventListener('DOMContentLoaded', build, { once: true });
}
