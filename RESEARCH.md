# Research: in-Showdown VGC recorder/analyzer (Tampermonkey)

Goal: a userscript that adds a tab inside Pokemon Showdown that records and analyzes VGC battles, so there is no copy/pasting replays into an external site.

## 1. Feature inventory of existing external recorder tools

Features worth matching, grouped by how hard they are in a userscript.

### Core (v1)
- **Team management**: import a team from a pokepaste/pokebin URL or Showdown export text; show sets and sprites. Showdown gives us the packed team directly (`|showteam|` / `PS.teams`), so no paste needed.
- **Battle log parsing**: per game, extract both teams, the picks (brought 4 of 6), leads, Tera usage, moves used, winner.
- **Bo3 grouping**: games in a Bo3 set share a match id (`game-bestof3-...` room id; the log has a `|uhtml|bestof|` line with `Game N`). Group into sets and records (W-L).
- **Stats**:
  - Per-Pokemon usage rate and win rate when brought
  - Lead usage / lead win rate, top lead pairs
  - Tera usage and win rate
  - Move usage per Pokemon
  - Matchup stats per opponent Pokemon: games against, win rate, how often it is on their team vs. actually brought ("attendance"), best/worst matchups (min 3 games)
  - Custom matchup query: pick opponent Pokemon, see win rate against any/all of them
- **Search/filter**: by Pokemon, tag, opponent, format.

### Later
- **Damage calculator** (`@smogon/calc`, which Showdown's own client already bundles/loads for its calc; reuse rather than add a dependency if possible).
- **Speed tiers**: per-regulation reference with the team's Pokemon overlaid; Tailwind / Trick Room / Scarf toggles.
- **Pokemon notes** (free text, saved calcs per team member).
- **Opponent planner**: lead/back plans per opponent team.
- **Data portability**: JSON export/import. Cloud sync/accounts are NOT needed; the userscript can keep everything local.

### Things the external tools need a server for that we do NOT
- Auth/accounts, DB, REST API. Replaced by `GM_setValue` / IndexedDB.
- Fetching the battle log by URL: we already have the log live in the client.

## 2. How the external tools get their data (and the in-Showdown advantage)

External approach: user pastes a replay URL, the server fetches `<replay-url>.json` and parses the `log` field (plus `players`, `format`, `uploadtime`).

- Winner: `|win|NAME` line.
- Side identification: match username and/or team against the registered team; fall back to p1.
- Bo3 detection: `|tier|` contains `(Bo3)`; match id parsed from the `|uhtml|bestof|` href; game number from "Game N".
- Picks/leads/Tera/moves come from the standard protocol lines (`|poke|`, `|switch|`, `|-terastallize|`, `|move|`, etc.).

In-Showdown advantage: we see the exact same protocol stream live, so there is no replay upload step, no fetch, and we know who "me" is from `|updateuser|`. We also get **private information the replay does not**: our own full team and `|request|` data. Optionally still support replay URLs (`https://replay.pokemonshowdown.com/<id>.json`, needs `@connect replay.pokemonshowdown.com`) for backfilling old games.

## 3. Tampermonkey: adding a real tab to Showdown

A working reference exists locally at `../mock-regional-helper/mock-regional-helper.user.js` (same author). Findings from it:

### Userscript header
- `@match https://play.pokemonshowdown.com/*`, `@run-at document-start`, `@noframes`.
- Grants: `GM_getValue`, `GM_setValue`, `GM_listValues`, `GM_deleteValue`, `GM_xmlhttpRequest`, `GM_setClipboard`, `unsafeWindow`.
- `@connect` for any external host (replay.pokemonshowdown.com, pokepast.es).
- `@updateURL` / `@downloadURL` pointing at the raw GitHub file gives auto-update.

### Page hook (must run in page context)
Userscript sandbox cannot reliably wrap the page's own objects, so the script injects a `<script>` (from `pageHook.toString()`) at document-start and talks to the sandbox over `CustomEvent`s on `window`. At document-start there may be no `<html>` yet, so a MutationObserver waits for `document.documentElement`.

### Reading battle traffic
Three layers, in order of preference:
1. **New (Preact) client**: wrap `PS.receive(msg)` (all incoming `>roomid\n|...` text) and `PS.send(msg, roomid)`. Works even if injected late.
2. `Worker` wrapper for `client-connection-worker` (new client's transport), messages arrive already decoded.
3. `WebSocket` wrapper (classic client, SockJS framing: `a["..."]` frames, `o`, `h`, `c`).
Once PS is hooked, silence the transport hooks to avoid double-counting.

Sending commands (e.g. `/savereplay`): use `app.send` (classic), `PS.send` (new), else the worker/socket.

### Two clients to support
Showdown currently ships both a classic (Backbone, `window.app`) client and a new Preact client (`window.PS`, `/beta`). Detect with:
- classic: `app._addRoom`, `app.rooms`, `app.topbar` exist
- new: `PS.send` exists, then wait for `PS.addRoomType`, `PS.join`, `PSRoom`, `PSRoomPanel`, `PSPanelWrapper`, `preact.h` (panel classes load after PS itself)
Poll (500 ms, ~30 s cap) for readiness; fall back to a floating sidebar if neither appears.

### Classic client tab
```
room = app._addRoom('view-<id>', 'html', true, 'Title');   // nojoin = true
move room from app.roomList to app.sideRoomList; room.isSideRoom = true
room.leave = () => {}                 // not a server room: don't send /leave
hook room.destroy to learn when the tab is closed
append <div id="root"> into room.el, render into it
app.focusRoomRight(id); app.topbar.updateTabbar();
```
Tab icon: patch `app.topbar.renderRoomTab` and swap the `fa-file-text-o` class for another FontAwesome icon.

### New client tab
Register a custom room type, then join it:
```
class MyRoom extends PSRoom { constructor(o){ super(o); this.type = ID; this.classType = ID; this.location = 'right'; this.noURL = true; } }
class MyPanel extends PSRoomPanel { render(){ return preact.h(PSPanelWrapper,{room:this.props.room}, preact.h('div',{id:'root'})); } }
Object.assign(MyPanel, { id, routes:[id], Model:MyRoom, location:'right', title, noURL:true, icon });
PS.addRoomType(MyPanel); PS.join(ID, { noURL:true, autofocus:true });
```
Gotchas found there: focusing the room puts `/<id>` in the URL, and a reload would try to `/join` it as a server room, so rewrite the URL back to `/` with `history.replaceState` (run once at document-start and on focus). Preact leaves DOM children it did not create alone, so rendering our own UI into the root div is safe.

### Other practical notes
- Identify "me" from `|updateuser|` (strip rank char and `@status`).
- Battle rooms: `battle-<formatid>-<n>`; Bo3 wrapper rooms: `game-bestof3-<formatid>-<n>`.
- Packed team format is documented in the Showdown sim (`sim/teams.ts`); the reference script has a working `unpackTeam`/`exportTeam` we can crib from (same author, so reuse is fine).
- Rating change arrives as a `|raw|` line: `Name's rating: 1500 &rarr; <strong>1516</strong>`.
- State: `GM_setValue` JSON blob for small state; keep big history (logs) under separate keys, or move to IndexedDB (via the page or the sandbox) if logs get large. A stored raw log is ~10-40 KB per game.
- Structure the code as a pure `Core` (parsing, stats, no DOM/GM) plus UI, so the core is testable under Node. The reference script does this.

## 4. Proposed architecture

```
showdown-analyzer.user.js
  Core      pure: protocol parser, battle model, Bo3 grouping, stats, team pack/unpack
  Store     GM_* / IndexedDB wrapper, schema versioning, export/import
  PageHook  injected: PS/app/WS/Worker hooks, tab creation for classic + new client
  UI        tab views: Games | Sets | Stats | Matchups | Teams | Settings
```

Data model (local):
- `team`: id, name, packed team, tags, format
- `game`: roomid, format, me/opp names, my/opp full or revealed teams, picks, leads, tera, moves used, winner, turns, timestamp, raw log (optional), replay url
- `set`: bestof3 id, game ids, result
- Everything derived (stats) is computed from games, not stored.

Parsing lines to handle: `|player|`, `|teamsize|`, `|poke|` (preview team), `|showteam|`, `|switch|`/`|drag|` (leads = first two switches per side), `|-terastallize|`, `|detailschange|`/`|-mega|`, `|move|`, `|win|`, `|tie|`, `|tier|`, `|uhtml|bestof|`, `|raw|` rating.

## 5. Open questions / risks
- **New vs classic client**: which does the user play on? Supporting both doubles the tab code; the reference already solves both.
- **Team preview picks**: the log only reveals brought Pokemon when they enter the field; the "brought 4" for a side is known from `|switch|` plus later reveals, but unrevealed backs stay unknown for the opponent. Our own picks are known from `|request|`/`|showteam|`.
- **Regulation/format ids** change each season; make the tracked format a setting (the reference uses a settings field with a default).
- **Storage limits** of `GM_setValue` for many stored raw logs: decide early whether to keep raw logs or only the parsed game record (recommend parsed record + optional raw).
- **Sprites/dex data**: need name normalization and sprites. Showdown serves sprites and its dex (`BattlePokedex` etc.) already on the page, so we should reuse `window.Dex`/`BattlePokedex` and the sprite CDN rather than bundling data.
- **Damage calc / speed tiers** are large; defer until the recorder core is solid.

## 6. Suggested next steps
1. Scaffold `showdown-analyzer.user.js` with the page hook + an empty tab that opens in both clients.
2. Build `Core` log parser with fixtures (save a handful of real Bo3 logs) and Node tests.
3. Live capture: finish a game, store the parsed record, show a Games list.
4. Bo3 grouping and the Stats views.
5. Team import and "which team was this game" matching.
6. Export/import JSON, then damage calc / speed tiers.
