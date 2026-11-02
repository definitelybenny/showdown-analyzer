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

## 7. Battle log parsing: how the existing tools do it (detailed)

Read directly from a reference implementation's parser source. All of this works on the same protocol lines we receive live, so it ports straight to JS.

### Inputs
Replay JSON has `players[0..1]`, `format`, `uploadtime`, and `log` (newline-separated protocol). Live, we build the same thing from the room's message stream. Side ids are `p1` / `p2`; active slots are `p1a`, `p1b`, `p2a`, `p2b`.

### Line-by-line extraction (single pass over `log.split('\n')`)
| Line | Used for |
|---|---|
| `\|poke\|p1\|Species, L50, M\|item` | Team preview: full 6-mon roster per side. Species may be a wildcard (`Urshifu-*`) because the forme is hidden in preview. |
| `\|showteam\|p1\|<packed>` | Open team sheet (OTS): packed team; first field before `\|` is the species. Reveals real formes, items, ability, moves. Only trusted if exactly 6 mons parse. |
| `\|switch\|p1a: Nick\|Species, L50, M\|100/100` | **Picks** (a Pokemon is "brought" the first time it is switched in) and **leads** (first 2 distinct switch-ins per side). Also builds `nickname -> species` and `slot -> species` maps used by every later line. Can reveal a hidden forme. |
| `\|drag\|` | Same as switch for forced switch-ins (used for forme reveal, not leads). |
| `\|move\|p1a: Nick\|Move\|p2a: Target` | Move usage: resolve the actor through the nickname/slot map, count per species per move. |
| `\|-terastallize\|p1a: Nick\|Fire` | Which mon Terastallized and to what type. One per side per game. |
| `\|detailschange\|p1a: Nick\|Charizard-Mega-Y` | Mid-battle forme change. Only Mega/Primal suffixes (`-Mega`, `-Mega-X`, `-Mega-Y`, `-Primal`) rewrite the roster slot; Tera and Ogerpon-mask changes also fire this line and must be ignored. On a Mega, rename the species in picks, leads, move counts and tera so it stays one Pokemon. |
| `\|-mega\|p1a: Nick\|Species\|Stone` | Confirms the original held item (stones cannot be transferred). |
| `\|turn\|N` | Turn count = max N seen. |
| `\|win\|Name` | Winner (by player name, case-insensitive compare). Absent = tie/abandoned. |
| `\|raw\|Name's rating: 1279 &rarr; <strong>1294</strong>` | Ladder ELO before/after per player. |
| `\|tier\|... (Bo3)` + `\|uhtml\|bestof\|...<strong>Game 2</strong> of <a href="/game-bestof3-<fmt>-<id>">` | Bo3 detection, game number, and shared set id. Regex: `Game (\d+)` and `href="/game-bestof3-([^"]+)"`. No bestof line = treat as Bo1. |

### Key problems the parser has to solve (and how)
1. **Nicknames**: `|move|` and `|-terastallize|` use the nickname, not the species. Maintain `nick -> species` per side, populated from `|switch|`. (Better: key by slot AND nickname, and update on every switch since slots change.)
2. **Hidden formes**: preview shows `Urshifu-*`, and Zacian/Zamazenta appear without `-Crowned` in preview. Keep the roster entry uncertain until a switch / detailschange / showteam reveals it; then overwrite the slot. Match by Pokedex number (not base species name) so e.g. Zamazenta-Crowned finds its Zamazenta slot. Wildcard slots (`X-*`) are matched first so a different mon with the same dex number is not clobbered.
3. **Species to roster-entry matching**: resolve every species through a canonical name (strip forme noise) and fall back to dex number, then roster index. The simple fallback (prefix match before first hyphen) is wrong for several formes, so we want a real normalizer. Showdown's page already has `Dex`/`BattlePokedex` we can use.
4. **Pick detection**: "brought" = distinct species switched in. Un-brought backs stay unknown for the opponent (we only see their 6 from preview). Our own picks are exact.
5. **Leads**: first two *distinct* switch-ins per side. Order-independent for pair stats (sort the pair).
6. **Which side am I**: cascade, strongest first: (a) exactly one side's username is mine AND its revealed roster matches my team, (b) exactly one side's username is mine, (c) exactly one side's roster matches my team, (d) default p1. The team match compares base species (Mega/Tera variants collapsed, but competitively distinct formes like Ogerpon masks or Calyrex-Shadow/Ice kept separate). In-client we can skip this: `|updateuser|` tells us who "me" is, and for Bo3 both players may be the same user name only in mirror/self-play (edge case, still handle via cascade).
7. **Original items**: only the team sheet (OTS) or `|-mega|` reveal the *starting* item; later item events (Trick, Knock Off) change it, so do not infer from `|-item|` / `|-enditem|`.

### Derived stats (all computed over a list of games, not stored)
- **Usage**: games where the Pokemon was in my picks / total games. Win rate = wins in those games / usage.
- **Leads**: per Pokemon (games led, win rate) and per unordered lead pair (count, win rate); keep top N.
- **Tera / Mega**: games where it terastallized (or mega-evolved) and win rate in those games.
- **Move usage**: per Pokemon, per move, total uses and each move's share of that Pokemon's moves.
- **Opponent matchups**: for each opposing species: games against, wins, win rate, times on their team, times brought, attendance = brought / on team. Best/worst lists need a minimum sample (they use 3). Normalize species to base name before aggregating.
- **Custom matchup query**: user picks opposing species; report per-species win rate, overall win rate in games where the opponent had any of them, and exact-match games where they had all of them.
- Known bug to avoid in the reference: one counter (games-with-pokemon) is incremented in two places, inflating it. Also win rate per move was computed but never surfaced; we can surface it.

### Match (Bo3) grouping
Group by the set id from the `bestof` line; order by game number. Two logs are the same set only if both are Bo3 and ids are equal. Live, the set id is also in the wrapper room id `game-bestof3-<format>-<id>`, and each game is `battle-<format>-<n>`, so we can group without any parsing of HTML.

### Implementation plan for our Core parser (JS, pure)
- `parseLog(lines, {me})` returns `{players, teams{p1,p2}, picks, leads, tera, mega, moves, winner, turns, rating, bo3{matchId, game}}`.
- Streaming variant for live play: feed lines as they arrive per room, finalize on `|win|` / `|tie|` or room close.
- Fixtures: save real logs for (a) Bo1, (b) Bo3 game 1/2/3, (c) OTS format, (d) mega, (e) Urshifu/Zacian hidden formes, (f) a forfeit/tie. Test with `node --test`.
