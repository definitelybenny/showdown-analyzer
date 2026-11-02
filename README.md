# Showdown Analyzer

A Tampermonkey userscript that adds an **Analyzer** tab inside Pokemon Showdown. It records your VGC games as you play them, groups Bo3 games into sets, and shows game history, usage, lead and matchup stats, and move usage. Everything stays in your browser (IndexedDB). No account, no server, no replay copy/pasting.

Works in both the classic client and the `/beta` client.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Chrome/Edge: enable **Allow User Scripts** for the extension (Extensions > Tampermonkey > Details). Without it userscripts silently do not run.
3. Open the raw script and confirm the install prompt:
   https://raw.githubusercontent.com/definitelybenny/showdown-analyzer/main/showdown-analyzer.user.js
4. Reload play.pokemonshowdown.com and log in. An **Analyzer** tab appears next to your room tabs.

## What it records

Any `gen9...vgc...` battle you play while logged in (editable in Settings). For each game it keeps the parsed record (teams and open team sheets, picks, leads, Mega, moves, result, rating change, turns) and the compressed raw log, so stats can be re-derived when the parser improves. Spectated games are not saved.

## Data and privacy

All data lives in IndexedDB on play.pokemonshowdown.com. The script makes no network requests except to Showdown's own replay server when backfilling a game it joined mid-way. Use Settings > Data to export or import JSON backups; browsers may clear site data, so export occasionally.

## Development

```
npm install
npm test              # unit + replay-fixture tests
node scripts/build.mjs  # bundles src/ into showdown-analyzer.user.js (committed)
```

Layout: `src/core` (parser, stats, pure), `src/store` (IndexedDB), `src/host` (client hooks, tab), `src/capture` (live recording), `src/ui` (views). See [PLAN.md](PLAN.md), [RESEARCH.md](RESEARCH.md) and [docs/](docs/). UI harness: `node dev/harness.mjs && node dev/serve.mjs`.

Status: early (0.1.0). Live capture is tested against real replay fixtures; the live Tampermonkey path is being verified. Manual checklist: [docs/MANUAL-TESTS.md](docs/MANUAL-TESTS.md).
