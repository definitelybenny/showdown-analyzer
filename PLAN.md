# Plan: Showdown Analyzer userscript

Execution plan, derived from RESEARCH.md. Section references (e.g. "R9") point to RESEARCH.md.

## 0. Product definition

A Tampermonkey userscript that adds an "Analyzer" tab to play.pokemonshowdown.com (classic and /beta clients). It records every VGC game as it is played, groups Bo3 games into sets, and shows stats, matchups, game history and team notes inside that tab. No accounts, no server, no replay pasting. Data stays local (IndexedDB) with JSON export/import.

Non-goals for v1: cloud sync, sharing/collaboration, tournament data feeds, speed tiers, damage calc, matchup planner. (Tracked as later milestones.)

## 1. Key decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Source in `src/` ES modules, bundled with esbuild (no minify) into a single committed `showdown-analyzer.user.js` at repo root | Pure-core testability, readable output (Greasy Fork rule), raw GitHub URL works for `@updateURL` |
| D2 | `@grant none`, page-world script; storage in IndexedDB (own DB name `showdown-analyzer`); settings in same DB | Direct access to `app`/`PS`, no hook injection, max Violentmonkey/Greasemonkey portability, no GM size limits (R10). Fallback if M0 shows `@grant none` is unreliable at document-start: use the reference script's injected page hook + CustomEvent bridge (`../mock-regional-helper`) |
| D3 | Capture by wrapping `PS.receive`/`PS.send` (Preact) and `app.receive`/`app.send` (classic); `battle.stepQueue` used as cross-check and backfill at game end | Works regardless of transport (R9). Late injection safe |
| D4 | Support both clients from day one; detect per R9; fall back to a floating panel if the tab API is unavailable | Classic is the default site, Preact is the future |
| D5 | Record the **raw log** (compressed with CompressionStream if available) plus a **parsed game record**; stats always derived from parsed records, re-parseable from raw logs when the parser improves | Parser will have bugs; raw logs make fixes retroactive |
| D6 | Teams: pull from the user's teambuilder (`Storage.teams` / `PS.teams.list`) and from `\|showteam\|` / the request; identify "my team" per game by roster | No paste import needed (R9, R12) |
| D7 | Format-agnostic: track any `gen9...vgc...` format by regex, default = whatever ids the user plays; Mega first-class, Tera optional (R11) | Regulations rotate every ~3 months |
| D8 | UI is vanilla JS + small helper (no framework), CSS scoped under `#sa-root`, dark/light aware via Showdown's own variables | Keep bundle small and avoid conflicts with Preact/Backbone |
| D9 | Pure `core/` (parser, stats, grouping, normalization) has zero DOM/global access and is tested with `node --test` on real replay fixtures | R10 testing |

## 2. Repository layout

```
src/
  core/        parser.js  stats.js  bo3.js  names.js  teams.js (pack/unpack)  schema.js
  store/       idb.js  repo.js (games/sets/teams/settings)  export.js
  host/        detect.js  hook.js (receive/send wrappers)  tab-classic.js  tab-preact.js  tab.js
  capture/     session.js (per-room state machine)  backfill.js (stepQueue + replay.json)
  ui/          app.js  views/{games,sets,usage,matchups,moves,teams,settings}.js  components.js  style.css.js
  main.js
test/
  fixtures/    real replay JSONs (see 4) + expected parsed output
  core/*.test.js  store/*.test.js (fake-indexeddb)  host/*.test.js (mock app/PS)
scripts/       fetch-fixtures.mjs  build.mjs
showdown-analyzer.user.js    (built, committed)
RESEARCH.md  PLAN.md  README.md  CHANGELOG.md
```

## 3. Data model (IndexedDB, v1)

- `games` (key = roomid): `{roomid, format, ts, me, opp, side, result: win|loss|tie|forfeit, turns, teams{p1,p2: [{species, item, ability, moves[], nature, gender}]}, mySetId?, picks{p1,p2}, leads{p1,p2}, mega{p}, tera{p}, moves{p:{species:{move:n}}}, ratingBefore/After?, setId, gameNumber, replayUrl?, notes, reviewed, rawLog (compressed), parserVersion}`
- `sets` (key = wrapper room id): `{id, format, games[roomid], result, ratingBefore/After, tags[], notes, ts}`
- `teams` (key = hash of sorted roster+items): `{id, name?, roster[6], packed?, firstSeen, lastSeen}`; "my team" resolved per game via roster hash against user's teambuilder teams and stored name
- `settings`: tracked formats, display prefs, min-sample thresholds
- Derived (not stored): usage, leads, matchups, move usage, trends. Schema carries `schemaVersion` with migrations; every write path covered by export/import round-trip tests.

## 4. Fixtures (do first, before any parser code)

Script `scripts/fetch-fixtures.mjs` pulls real replays via `https://replay.pokemonshowdown.com/search.json?format=<id>` and `<id>.json` into `test/fixtures/`. Required cases:
1. Bo3 game 1, 2, 3 from one set, plus a Bo3 where games were forfeited
2. Normal finish with Mega Evolution; a game with a Z-Mega if one exists
3. Hidden-forme cases (Urshifu, Zacian/Zamazenta) if present
4. A tie, an inactivity loss
5. Non-Bo3 Bo1 OTS game and a non-Champions VGC game (Tera) for the Tera path
6. A game with nicknames, and one with Ditto/Zoroark/Illusion if findable
Each fixture gets a hand-verified `expected.json` (picks, leads, winner, mega) for the key assertions. Only public replay data is used.

## 5. Milestones

Each milestone ends with: tests green, `node build`, commit, push. No milestone starts before the previous is committed.

### M0. Feasibility spikes (no product code)
Goal: settle the open items in R11 in a real browser (use Claude-in-Chrome / built-in browser on play.pokemonshowdown.com as a guest where possible; guest play does not need a login for most checks).
- `@grant none` at `document-start` under Tampermonkey: can we wrap `PS.receive`/`app.receive` before the client sends the first message?
- Dex coverage: does `Dex.species.get` know Champions Megas and Z-Megas, and `Dex.moves/items` the Champions data?
- Do `window.PSRoom`, `PSRoomPanel`, `PSPanelWrapper`, `preact` exist on /beta?
- Does the client open/route messages for `game-bestof3-*` wrapper rooms, and where do wrapper messages arrive?
- IndexedDB works in the page origin; quota/persist behaviour.
Deliverable: a short "SPIKES.md" with results; adjust D2/D3 if needed (switch to the page-hook fallback).

### M1. Core parser + fixtures + tests
- `parser.js`: streaming `LogParser` (feed lines, `finalize()`), plus `parseLog(lines, {me})`. Handles the lines and edge cases in R7/R8 (showteam sets, preview roster, nick/slot maps keyed on slot+nick and refreshed on every switch, mega/detailschange/formechange, Tera optional, forfeit, rating lines, Bo3 header).
- `names.js`: species normalization via an injected `dex` (client `Dex` in-browser, a tiny stub or `@pkmn/dex` dev-dependency in tests); base-species analytics key vs display forme.
- `teams.js`: packed unpack/export (port from the reference script), roster hashing.
- `bo3.js`: group games by wrapper id from the `bestof` header; order by game number; set result from game results; set rating delta from the last game's rating lines.
- Acceptance: all fixtures parse to the expected output; parser is idempotent and never throws on malformed/truncated input (fuzz with truncated logs).

### M2. Store
- IndexedDB repo with `games`, `sets`, `teams`, `settings`; batch writes; `BroadcastChannel` for multi-tab updates; `navigator.storage.persist()` requested once.
- Export/import JSON (`{schemaVersion, games, sets, teams, settings}`), merge-by-key import, dedupe.
- Acceptance: tests with fake-indexeddb for CRUD, migration stub, export -> import round trip equality.

### M3. Host integration: hooks + tab
- `detect.js`, `hook.js` (wrap receive/send for both clients, emit normalized `(roomid, line)` events), `tab-classic.js` and `tab-preact.js` ported and simplified from the reference script (see R3/R9), `tab.js` chooses and falls back to a floating panel after 30 s.
- Tab shows a proof-of-life: logged-in user, rooms seen, live game status.
- Acceptance: unit tests with mock `app`/`PS`; manual check in both clients (classic and /beta) via browser tooling; tab survives reload and does not break navigation URL (R9 gotchas).

### M4. Live capture
- `session.js`: per battle-room state machine; opens on `|init|`/first lines of `battle-<format>-*` rooms of tracked formats, feeds `LogParser`, finalizes on `|win|`/`|tie` (and on room close if the game ended), and writes the game. Cross-check against `battle.stepQueue`; if the streamed log is incomplete (joined late), replace with `stepQueue` or fetch `<replay-id>.json` (backfill).
- Set assembly: when a game's `bestof` header gives a wrapper id, attach to that set; set result from wrapper `|win|` or from the 2 game results; rating from the last game's `|raw|` lines (which arrive after the wrapper win).
- "My side": `|updateuser|` / `PS.user`/`app.user` name vs `|player|` names (cascade in R7 as fallback for same-name edge cases).
- Own picks/leads: from `|request|` side order after team preview (preferred) else from switches.
- Acceptance: replay-driven integration test feeds a fixture's lines through the hook interface and asserts the stored game/set; manual: play or spectate a live Bo3 and confirm the records.

### M5. UI v1
Views (all computed from stored games, with sample sizes shown and a minimum-sample indicator):
1. **Games**: list with result, opp, teams as sprites/icons, picks, mega, notes, reviewed toggle; filters (result, format, date range, team, opposing Pokemon, reviewed), sort. Detail drawer shows open team sheets (items/moves/ability), turn count, rating change, replay link, "save replay" action (`/savereplay`).
2. **Sets**: Bo3 cards (per-game rows, tags, notes), set record and rating delta.
3. **Usage**: per Pokemon on my team: usage, win%, lead usage/win%, Mega/Tera usage/win%; top lead pairs; filters shared with Games (this fixes the reference's no-filters gap).
4. **Matchups**: per opposing Pokemon: on-team, brought, attendance, games against, win%; best/worst with min-sample; custom team query.
5. **Moves**: per Pokemon move usage, compared against the registered set when known (open team sheets make this exact).
6. **Settings / Data**: tracked formats, export/import, clear data, parser reparse button (D5), version.
- Acceptance: renders from seeded fixtures without a live game (dev harness page), usable at narrow widths (Showdown side panel), no console errors, no layout bleed into the host client.

### M6. Quality pass
- Reparse-all from raw logs after parser version bump; migration test.
- Performance: 1000 games in memory, views render < 200 ms; lazy-decompress raw logs.
- Failure UX: host API changes => visible, non-fatal banner with the diagnostic (which API is missing), never break Showdown.
- README with install steps (incl. Chrome "Allow User Scripts"), screenshots, privacy statement (all local, no network except Showdown).

### M7+. Later (each its own mini-plan, in priority order)
1. Trends: ELO / win-rate over time, rolling windows (gaps in the reference).
2. Backfill/import from replay URLs or `search.json?user=` (grouped by team automatically).
3. Matchup planner and notes per Pokemon (structured calc references).
4. Speed tiers (per-regulation data, Tailwind/TR/Scarf toggles, live spreads from my sets).
5. Damage calc via bundled `@smogon/calc` (Champions: SP -> EV mapping, level 50).
6. Opponent scouting from open team sheets (their sets are already stored).
7. Optional sync/share via export codes or file; Greasy Fork release.

## 6. Testing strategy

- **Unit** (`node --test`): parser, bo3, names, teams, stats, export. Run in CI on every push (GitHub Actions: `npm ci && npm test && node scripts/build.mjs && git diff --exit-code showdown-analyzer.user.js` to ensure the committed bundle matches source).
- **Integration**: replay-driven capture test through mock `app`/`PS` hook interfaces.
- **UI harness**: static page that loads the built script against a mock host and seeded IndexedDB; Playwright smoke tests (tab opens, views render, filters work) with `addInitScript`.
- **Manual live checks** (user-run, short checklist in `docs/MANUAL-TESTS.md`): classic + /beta, spectate a Bo3, play a Bo3, reload mid-set, two tabs open.
- Parser changes always come with a new fixture or case.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Client internals change (`_addRoom`, `PS.addRoomType`) | Feature-detect every API; floating-panel fallback; diagnostics banner; keep host code isolated in `src/host/` |
| `@grant none` timing at document-start | Spike in M0; fallback to the reference page-hook design |
| Champions Dex data missing in client | Bundle a small override table for Megas/Z-Megas; M0 verifies |
| Late join / partial logs | `stepQueue` and replay JSON backfill; mark games `partial: true` and exclude from lead/pick stats |
| Wrapper-room messages not routed to our hook | Derive the set from each game's `bestof` header (the wrapper id is there), not from wrapper traffic |
| Storage loss (site data cleared) | `persist()`, export reminder, auto-export option |
| Hidden formes / Illusion / Ditto parse errors | Fixtures per case, nullable fields, never assume (R7 edge cases) |
| Regulation rotation breaks format detection | Regex-based format detection and user-editable list |
| Naming/credit | Public repo and docs make no references to other tools until the user decides to credit inspiration |

## 8. Working agreements

- Commit small and often; push after each milestone. Commit messages end with the standard attribution line.
- RESEARCH.md stays factual; decisions live here. If research changes a decision, update the table in section 1 and note why.
- Do not mention third-party tool names beyond Showdown, its open-source projects, and generic data sources in this repository (see user instruction); local-only notes go in `*.local.md` (gitignored).
- No milestone expands scope silently: new ideas go to M7+.
