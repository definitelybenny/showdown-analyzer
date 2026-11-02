// Bundles src/main.js into the committed userscript (readable, not minified).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const REPO = 'definitelybenny/showdown-analyzer';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/showdown-analyzer.user.js`;

const header = [
	'// ==UserScript==',
	'// @name         Showdown Analyzer',
	'// @namespace    showdown-analyzer',
	`// @version      ${pkg.version}`,
	'// @description  Records and analyzes VGC battles inside Pokemon Showdown',
	'// @match        https://play.pokemonshowdown.com/*',
	'// @run-at       document-start',
	'// @noframes',
	'// @grant        none',
	`// @homepageURL  https://github.com/${REPO}`,
	`// @updateURL    ${RAW}`,
	`// @downloadURL  ${RAW}`,
	'// ==/UserScript==',
	'',
].join('\n');

const result = await build({
	entryPoints: [path.join(root, 'src/main.js')],
	bundle: true,
	format: 'iife',
	minify: false,
	write: false,
	legalComments: 'none',
	target: 'es2020',
	logLevel: 'warning',
	define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});

const out = path.join(root, 'showdown-analyzer.user.js');
fs.writeFileSync(out, header + result.outputFiles[0].text);
console.log(`wrote ${path.relative(root, out)} (${result.outputFiles[0].text.length} bytes)`);
