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

---
# Part 2: Verified protocol, client, and platform findings (2026-11-02)

Legend: [V] verified against live site/source, [S] from docs/search, [?] unverified. This part supersedes anything above it that conflicts (notably: the current ladder format has **no Tera**).

## 8. Protocol facts (sources: pokemon-showdown `sim/SIM-PROTOCOL.md`, `sim/*.ts`, `server/room-battle*.ts`)

### Line formats
- `|player|p1|NAME|AVATAR|RATING`, `|teamsize|p1|N` (4 in VGC), `|gametype|doubles`, `|gen|9`, `|tier|[Gen 9 Champions] VGC 2026 Reg M-C (Bo3)`, `|rule|...`, `|clearpoke`, `|poke|p1|Species, L50, F|` (item field is literal `item` or blank), `|teampreview|4`.
- `|showteam|p1|<packed>` [V]: with Force Open Team Sheets (Bo3 format) it is public, so spectators and players both get it. Per set: `name|species|item|ability|moves(csv)|nature|evs|gender|ivs|shiny|level|extra`; for team sheets name is blank so the first field is the species, evs/ivs blank, nature filled in the Champions mod, level only if not 100. Sample from a live log: `Froslass||Froslassite|CursedBody|Blizzard,ShadowBall,AuroraVeil,Protect|Timid||F|||50|]Dragonite||...`. **This gives us the opponent's full sets (item, ability, 4 moves, nature) for free.** Item/ability/move names are packed IDs without spaces (`ShadowBall`, `CursedBody`) and need normalizing via Dex.
- `|switch|p1a: Nick|Species, L50, M|100/100` (same shape for `|drag|`). HP is `cur/max` for your side, `pct/100` for the foe.
- `|move|p1a: X|Move|p2a: Y` (+ `[miss]`, `[from]`, `[still]`), `|faint|POKE`, `|turn|N`.
- `|-mega|POKE|BASESPECIES|STONE` then usually `|detailschange|POKE|Species-Mega|HP`. `|-terastallize|POKE|Type` exists in other formats only. Also `|-formechange|`, `|replace|` (Illusion reveal), `|-transform|` (temporary, does not change details).
- `|win|NAME` (two allies: `A & B`), `|tie`. Forfeit: `|-message|NAME forfeited.` or `NAME lost due to inactivity.` followed by `|win|` [V in a live log].
- `|raw|NAME's rating: 1293 &rarr; <strong>1312</strong><br />(+19 for winning)` arrives right after `|win|` [V live log].
- `|request|{...}` is player-only and NOT part of the battle log. Team-preview request: `{teamPreview:true, maxChosenTeamSize:4, side:{pokemon:[...]}}` in team-slot order. After picking, the next request's `side.pokemon` is reordered to the picks (first 2 = leads, `active:true`). Each pokemon has `ident, details, condition, active, stats, moves, baseAbility, item, ability` (and `teraType`/`terastallized` except in the Champions mod).
- `|updateuser|NAME|NAMED|AVATAR|SETTINGS_JSON`, `|uhtml|NAME|HTML`, `|inactive|...` timer lines.

### Bo3 mechanics [V from server source + a live replay]
- **Wrapper room** `game-bestof3-<formatid>-<N>`: no battle protocol. Gets `|html|<h2>Game 1</h2>`, per-game links, `|html|NAME won game N!`, set end `|win|NAME` (or `|tie`), and `||NAME forfeited the series.`.
- **Game rooms** `battle-<formatid>-<M>`: M comes from a global counter, NOT derived from the wrapper id and not necessarily consecutive. Example from a real replay: game room `...-2708117051`, its wrapper `game-bestof3-...-2708115532`. So the **only link between games is the wrapper id**, found in the `|uhtml|bestof|` line's href. (The earlier idea of deriving it from the room id is wrong.)
- Each game log begins with `|uhtml|bestof|<h2><strong>Game N</strong> of <a href="/game-bestof3-<fmt>-<wrapperN>">a best-of-3</a></h2>` and an `|html|` score table with win circles [V]. The previous game's room gets `|uhtml|next|Next: <a href="/battle-...">Game N of 3</a>`.
- Between games: 40 s ready timer (`BEST_OF_IN_BETWEEN_TIME`), `/confirmready`, then the next game starts regardless.
- **The team is NOT re-chosen between games** (same packed team), but every game has a fresh team preview where 4 are picked again, so brings/leads can change.
- **Rating**: individual games are unrated; the ladder update happens once at set end, and the `|raw|` rating lines go to the LAST game's battle room, after the wrapper's `|win|`. Per-game ELO is therefore not available; only a set-level ELO delta. (The live sample, a forfeit in game 2, did show rating lines: treat rating lines as "set ended here".)
- Replay search can return `rating: null` and `private`/`password` fields.

### Team preview picks
- Client sends `/team 1234` (1-based; order = lead, lead, back, back). Nothing is echoed in the protocol; we learn our own picks from the next `|request|` order, and the opponent's only from `|switch|`/`|drag|`. `|teamsize|` says both sides bring 4.
- With open team sheets both sides' full 6 appear in `|showteam|` (public), so the opponent's roster and sets are fully known; their 4 picks are only known as they appear (unrevealed backs stay unknown).

### Edge cases
- Zacian/Zamazenta show as `Zacian-*` in preview; showteam rewrites to `-Crowned` when holding the Rusted item. With Species Reveal Clause off, Urshifu, Greninja, Gourgeist, Pumpkaboo, Xerneas, Silvally, Dudunsparce also show `-*`.
- Champions mod: Mega only, **no Tera**, one Mega per team per battle (source), new Z-Megas (e.g. Absol Z, Lucario Z, Garchomp Z [S]). Expect forme names like `-Mega-Z` [?]. Still handle `|-terastallize|` for other formats.
- Illusion: `|switch|` shows the disguise, `|replace|` reveals. Nicknames: identity is `p1a: Nick`, species only in DETAILS.
- Spectators see no `|request|` and see foe HP as percent, but do see `|showteam|` under Force OTS.
- `/savereplay` result is a popup `|html|<p>Your replay has been uploaded!...` with `https://replay.pokemonshowdown.com/<fullid>`.

### Real log skeleton [V] (a Reg M-C Bo3 game 2 that ended by forfeit)
```
|uhtml|bestof|<h2><strong>Game 2</strong> of <a href="/game-bestof3-...-2708115532">a best-of-3</a></h2>
|gametype|doubles / |player|p1|NAME|avatar|rating / |gen|9 / |tier|... / |rated| / |rule|...
|clearpoke / |poke|p1|Froslass, L50, F| x6 per side / |teampreview|4
|showteam|p1|<packed> / |showteam|p2|<packed>
|teamsize|p1|4 / |teamsize|p2|4 / |start
|switch|p1a: ... (x4 leads) / |turn|1 ... / |faint| ... / |-message|X forfeited. / |win|Y
|raw|Y's rating: 1293 &rarr; <strong>1312</strong><br />(+19 for winning)
|raw|X's rating: 1201 &rarr; <strong>1182</strong><br />(-19 for losing)
```

## 9. Showdown client internals (sources: live site JS, smogon/pokemon-showdown-client, Showdex)

- **Default client is the classic Backbone one** (`js/oldclient/*.js`, `window.app`). The Preact client lives at `/beta` (`js/client-main.js`, `window.PS`). No announced deprecation or migration date found [V]; the repo is actively committed to (late Oct 2026). **Support both** (detect: classic = `typeof window.app?.receive === 'function'`; Preact = `typeof window.PS?.join === 'function'`, same as Showdex).
- **Classic globals**: `app` (rooms, roomList, sideRoomList, curRoom, user, topbar, socket, send, receive, `_addRoom`, `focusRoom`, `focusRoomRight`), `Storage` (teams, prefs), `Dex`, `BattleLog`, `toID`, `Battle`, `BattlePokedex`/`BattleMovedex`/`BattleItems`/`BattleAbilities`. **Preact globals**: `PS` (rooms, roomTypes, leftRoomList/rightRoomList, teams, user, join, leave, focusRoom, addRoomType, send, receive), `Dex`, `Teams`. That `PSRoomPanel`/`PSPanelWrapper`/`preact` are `window.*` is [?] in general, but the existing reference script uses `window.PSRoom` etc. and works.
- **Custom tab**: classic = `app._addRoom('view-<id>','html',true,title)` (nojoin), set `isSideRoom`, move to `sideRoomList`, `focusRoomRight`, override `leave`/`requestLeave`; icon via patching `app.topbar.renderRoomTab` (a `[X]` title prefix also renders an icon). `_addRoom` does not call `updateSideRoom()`/`updateLayout()` (`addRoom` does). Preact = `PS.addRoomType(PanelClass)` + `PS.join(id,{noURL:true,autofocus,autoclosePopups:false})`. Both are undocumented internals; stability risk is higher on Preact (active development) than classic (effectively frozen).
- **Teams**: classic `Storage.teams[]` = `{name, format, gen, team: <packed>, folder,...}` from `localStorage['showdown_teams']`; helpers `Storage.unpackTeam`, `Storage.exportTeam`, `Storage.whenTeamsLoaded`. Preact `PS.teams.list` = `{name, format, folder, packedTeam,...}`, helpers `Teams.unpack/pack/export`. **We can offer "my teams" straight from the user's Showdown teambuilder, no paste import.**
- **Username**: classic `app.user.get('name'|'userid')`; Preact `PS.user.name`/`.userid`/`.named`.
- **Battle log without parsing the socket**: `app.rooms[id].battle.stepQueue` (classic) / `PS.rooms[id].battle` (Preact) is a `string[]` of protocol lines; join with `\n` for replay format. `battle.ended` after `|win|`/`|tie`. Also `battle.p1.name`, `tier`, `turn`, `rated`, `mySide`, `myPokemon` (own team, from the request). Caveats: log only covers what the room received since joining; closing the room destroys the battle (grab the log first); `|request|` is NOT in stepQueue; `battle.subscribe` has a single listener slot (do not overwrite it; wrap or poll). Our receive/send hook remains the more robust capture path, with `stepQueue` as a cross-check and backfill.
- **Static assets** [V]: sprites `https://play.pokemonshowdown.com/sprites/{gen5,gen5ani,ani,dex,home-centered}/<id>.(png|gif)`, `types/<Type>.png`, `itemicons-sheet.png`, `pokemonicons-sheet.png` (40x30 grid; `Dex.getPokemonIcon(species)` returns the CSS background). Use `Dex.resourcePrefix`. Data files are CORS-open: `data/pokedex.(js|json)`, `moves.(js|json)`, `items.js`, `abilities.js`, `typechart.js`, `aliases.js`, `formats.js`, `learnsets.json` (items/typechart/aliases `.json` 404). Dex API: `toID`, `Dex.species.get/moves.get/items.get/abilities.get` (exists, baseSpecies, forme, types, baseStats), `Dex.forGen`, `Dex.formats.get`. **Caveat: the Champions mod's species/Mega/Z-Mega data may not be in the client's default Dex tables [?]; verify in a console.**
- **CSP**: no CSP header or meta seen on `/` or `/beta` [V]; inline scripts, `<script>` injection and fetches work. The page uses a framebuster (`if (self===top) ... else top.location = self.location`), so **iframes are not an option**; stay in-client.
- **Damage calc**: not bundled in the client (only rough tooltip estimates). `@smogon/calc` (smogon/damage-calc, npm) would have to be bundled or loaded via `@require`.
- **Gotchas**: `app = new App()` runs in an inline script at the end of body; with document-start you must wait for `window.app`, `app.rooms`, `app.user`, `Storage.whenTeamsLoaded` (poll). Preact: `PS` is created when deferred `client-main.js` runs. With any `@grant` you are sandboxed: use `unsafeWindow`. No service worker. Clicking the page background calls `app.dismissPopups()`, which can close custom overlays. Classic routes `*path` to `tryJoinRoom`, so navigating to our tab id can try to /join it on the server; use `noURL` (Preact) and `history.replaceState` back to `/`. Layout switches by window width (>=916 px shows the rooms list; mini tabs under 420 px).

## 10. Userscript platform findings (Tampermonkey etc.)

- **Storage**: GM_* values are per-script, live in the extension, survive "clear site data"; limits are undocumented [?] and each set likely re-serializes the script's whole store, so one giant blob is a bad idea. TM 5.3+ has batch `GM_setValues/getValues/deleteValues`; the `GM.*` promise API is the portable one (Greasemonkey 4 supports only `GM.*`). `GM_addValueChangeListener` gives cross-tab sync for GM values only.
- **IndexedDB / localStorage on play.pokemonshowdown.com**: real browser quotas and indexes (IndexedDB), async; but shared origin with Showdown's own storage (teams live in `localStorage['showdown_teams']`) and wiped by clear-site-data. Use a unique DB/key prefix, call `navigator.storage.persist()`, and sync tabs with `BroadcastChannel`.
- **Recommendation**: IndexedDB for games (large, queryable), GM storage for small settings, plus JSON export/import as backup and the cross-device story. A GM-only design is viable at a few hundred games if keyed one-key-per-game with a small index.
- **Grants/injection**: `@grant none` runs in the page world (direct access to `app`/`PS`); any `@grant GM_*` sandboxes (use `unsafeWindow`). A single script cannot mix. Replay JSON and pokepast.es are CORS-friendly [V] (replay.pokemonshowdown.com allows `Origin: https://play.pokemonshowdown.com`; pokepast.es `/<id>/json` and `/raw` allow `*`), so we likely need **no GM_xmlhttpRequest**; `@grant none` plus IndexedDB gives maximal Violentmonkey/Greasemonkey portability and removes the need for a separate page-hook injection. Trade-off: the reference script uses grants for GM storage; we would use IndexedDB instead.
- **MV3 / Chrome** [S]: Tampermonkey 5.3+ uses the `userScripts` API; the user must enable "Allow User Scripts" (Chrome 138+, extension details page) or Developer Mode, else scripts silently do not run. Document in README. Firefox keeps MV2.
- **Distribution**: `@updateURL`/`@downloadURL` to raw GitHub (cache about 5 min [?]); bump `@version` for updates; GitHub Releases give immutable per-version URLs. Greasy Fork: no minified/obfuscated code, 2 MB cap, libraries via `@require`, readable single-file bundle OK, update checks at most daily.
- **Testing**: pure Core under `node --test` against saved replay JSON fixtures (fetch `https://replay.pokemonshowdown.com/<id>.json`; list via `search.json?format=<id>` [V]); UI via Playwright with `addInitScript`; mock GM_* if used; a mock `app`/`PS` harness page for tab code. Real-Showdown e2e is flaky (login).
- **Replay endpoints** [V]: `https://replay.pokemonshowdown.com/<id>.json` (`{id, format, players, log, uploadtime, rating, ...}`), `<id>.log`, `search.json?format=<fmt>` (also `user=`), CORS as above. Useful for backfilling old games and collecting fixtures.

## 11. VGC context (as of 2026-11-02)

- **Current format**: `[Gen 9 Champions] VGC 2026 Reg M-C` = `gen9championsvgc2026regmc` (Open Team Sheets, `bestOfDefault`), Bo3 = `gen9championsvgc2026regmcbo3` (Force OTS, Best of 3) [V in formats.ts and live replays]. Earlier: Reg M-A (`...regma[bo3]`, 2026-04-08 to 06-17), Reg M-B (`...regmb[bo3]`, retired), older non-Champions `gen9vgc2025regi` etc. **M-C runs 2026-09-09 to 2026-12-02** [S, official press release]; expect an M-D after that. Detect with `^gen9championsvgc\d{4}reg[a-z]+(bo3)?$` and make it configurable; do not hardcode.
- **Mechanics**: Champions = Mega Evolution only (no Tera), Z-Megas added in M-C. The parser must treat Mega as first-class and Tera as optional.
- **Team sources**: pokepast.es `/<id>` (HTML), `/<id>/raw` (text), `/<id>/json` (`{paste,title,author,notes}`), CORS `*` [V]. Pokebin not researched [?]. From Showdown we get teams directly, plus `|showteam|` in OTS games, so paste import is optional.
- **Tournament/usage data**: no public LabMaus API found [?]. Limitless has developer docs (docs.limitlesstcg.com/developer.html) [S]; Pikalytics exposes markdown-ish pages under `/ai/...` with unknown terms and an unverified API path [?]. All optional/later.
- **To verify empirically in a real browser before/while coding**: Showdown CSP on subpaths, `window.PSRoomPanel` etc. exposure, Champions-mod Dex data availability, GM storage size behaviour, how the live client handles `game-bestof3-*` wrapper rooms (does it open a room for the wrapper, and does our hook see its messages?), exact Z-Mega forme names.

## 12. Feature, UX and data-model detail of the reference recorder (read from its source)

The reference is a web SPA (React + Tailwind) with a server and DB. Its frontend only renders parsed `battleData`; everything below is what we need to replicate or improve in a tab inside Showdown. Game context: Pokemon Champions Reg M-A/B/C, Mega is the mid-battle mechanic, and its calc "Gen 10" mode means Champions with Stat Points (SPs).

### 12.1 Navigation and setup
- Per-team sidebar tabs: Replays, Game by Game, Match by Match, Usage Stats, Matchup Stats, Move Usage, Matchup Planner, Pokemon Notes, Calculator, Speed Tiers, Type Chart. Team menu: edit, export, share, delete. Home page: global tiles (teams, games, wins, win rate), team cards with a regulation chip and win rate, filters (text/Pokemon tag, regulation select, folder).
- Creating a team needs: name, paste URL, optional regulation, and **at least one tracked Showdown username** (needed to decide which side is "me"). We do not need any of that: username comes from the client, teams come from the teambuilder.
- Regulation is a free-form string; `isMegaRegulation` (regex `Regulation\s+M(-[A-Z])?$`) toggles the Mega vs Tera columns. We should derive it from the format id instead.

### 12.2 Pages (what is shown, controls, data)
Valid games for stats = result is win/loss and parsed data present.
- **Usage Stats**: table per team Pokemon: Usage (count, %), Win %, Lead usage, Lead win %, Mega-or-Tera usage and win %. Two cards, "Most Common Leads" and "Best Leads (Win %)", top 6 unordered pairs with sprites, count, `xW-yL`, win %. Win-rate colour: >=60 green, >=40 yellow, else red. "Based on N games". **No filters at all** (opportunity: date range, format/regulation, Bo3-only, opponent rating, per-team).
- **Matchup Stats**: four top-5 cards (best/worst matchups with min 3 encounters; highest/lowest attendance = brought / on team). Per opposing Pokemon: timesOnTeam, timesBrought, gamesAgainst, winsAgainst, winRate, attendanceRate. "Custom Team Analysis": 6 slots with a search dropdown over every opposing Pokemon ever seen, per-slot win %, W-L, encounters, plus a plain-mean average.
- **Move Usage**: pie chart per Pokemon from move counts; slices under 5% grouped as "other"; moves coloured green if in the registered set, red if "not in paste" (useful for spotting set changes). With open team sheets we can do better (compare against the actual set).
- **Game by Game**: filters result (all/win/loss), reviewed status, sort (date/result/opponent, asc/desc), tag filter by opposing Pokemon, bulk mark reviewed/unreviewed, summary (total/wins/losses/win rate). One card per game.
- **Match by Match** (Bo3): tiles (matches, wins, losses, win rate); search box with prefixes `tag:x`, `user:x`, or plain opposing Pokemon names (tags AND together). One card per match.
- **Replays**: flat list, filter by opposing Pokemon, copy all / filtered URLs, add replay, delete, edit note.
- **Matchup Planner** (opponent prep): per opposing team (from a paste): your Leads(2)+Back(2) plan(s) and notes, colour label (9 colours), drag-reorder, collapse/expand all, filter by opposing Pokemon, "Group by leads" (one card per unordered lead pair across all plans, sorted by number of matchups), and a "Recent Tour" browser that imports tournament teams as matchup teams. Each opponent team shows "N confirmed - M possible" past games against that exact team (see 12.5).
- **Pokemon Notes**: per team member: free-text note and a list of saved calc strings (coloured by OHKO/2HKO/3HKO regex). Keyboard: Ctrl/Cmd+Enter save, Esc cancel.
- **Speed Tiers**, **Calculator**: see 12.6 and 12.7.
- **Type Chart**: defensive only: 18 attacking types x your 6 Pokemon, cells 4x/2x red, 1/2x-1/4x green, 0 grey; per-column weak/resist counts; accounts for ability immunities and filter-type effects.

### 12.3 Cards
- **Game card**: result badge, opponent, date, replay link, Reviewed toggle; opposing team sprites; your picks and their picks; Mega (forme sprite) or Tera (sprite + type) per side; ELO before -> after (change); inline notes.
- **Bo3 card**: set result (No games / Win / Loss / yellow Incomplete), per-game rows (result, link, your picks, their picks, or "Not played"), editable tags and notes on the set.
- **Lead group card**: two lead sprites + "N MUs"; expands to list opponent teams; hover shows the back pair.
- **Add replay (bulk)**: paste many replay URLs; a preview groups them by "which 6-Pokemon team the user played" (active team pinned first, "unidentified" bucket last) with per-group "copy URLs" and "import into this team". For us this is the **backfill/import feature** (and we can group by team automatically, since teams come from Showdown).
- Import/export: JSON with options (replays, replay notes, match notes, opponent plans, member notes) and a share code (6 chars, SHA-256 dedupe, expiry, rate-limited). We only need local JSON export/import (share code is optional later).
- Collaboration/sharing with granular permissions exists server-side; out of scope for a local userscript.

### 12.4 Data model (their server schema; reduce to what we need)
- **Team**: name, paste URL, regulation, tracked usernames, created/updated. Replay count / win rate derived.
- **Replay**: url (unique per team), notes, full raw log, opponent, result win/loss, reviewed flag, gameNumber 1-3 or null, date, match FK. No tags on replays; tags only on Match.
- **BattleData** (derived per game): winner, userPlayer/opponentPlayer, teams{p1,p2}, teamDetails{player:[{species, item (null unknown, "" known empty)}]}, actualPicks, teraEvents, megaEvents {pokemon, megaForme}, eloChanges{before, after, change}, moveUsage{player:{pokemon:{move:count}}}.
- **Match** (Bo3 container): opponent, notes, tags[], replays[], derived result/isComplete.
- **TeamMember**: pokemonName, slot, notes, calcs[] (strings). Sync keeps notes when the paste changes (by species).
- **GamePlan / GamePlanTeam / composition**: opposing team paste, colour, position, notes, compositions `{lead1, lead2, back1, back2, notes}`.
- **Folder**: user-defined folders, a team can be in many.
- Export JSON v1.0: `{version, exportedAt, options, team{name, pokepaste, regulation, showdownUsernames, teamMembers}, replays[{url, battleLog, opponent, result, gameNumber, date, notes}], matches[{opponent, notes, tags, replayUrls}], opponentPlans[...]}`; replays link to matches by URL; folders/colours/reviewed/order are not exported (a gap we should not repeat).

### 12.5 Name normalization and roster matching
- Species registry generated from `@pkmn/dex` (+ Showdown aliases + app aliases + sprite map): `{num, form, name, displayName, baseSpecies, types, aliases}`. Competitive formes collapse to a `baseSpecies` **analytics key** (e.g. Zamazenta and Zamazenta-Crowned share one) while display keeps the full forme. We can use the client's own `Dex` for this (verify it covers Champions Megas).
- **Exact 6-vs-6 roster matching** between a pasted opponent team and a game's revealed roster: normalize both (strip Ogerpon Tera suffixes, resolve aliases/forme bases), then multiset match by backtracking. Output `confirmed` / `possible` / `none`; wildcard formes (`*`) and unknown items only yield `possible`. With open team sheets (our format) the opponent roster and items are known exactly, so "confirmed" is the common case; Mega stone -> resulting forme rules let a held stone stand in for an unrevealed forme.
- Result helpers: accept win/loss/lose; win rate = rounded integer (we should keep decimals and show sample size).

### 12.6 Speed tiers
- Generated per regulation from a species list (Megas auto-expanded from the base; Z-Megas only in M-C); 4 rows per species: max +Spe, max neutral, 0 neutral, 0 -Spe; Champions uses Stat Points (`sps*8-4` EV equivalent; 32 SPs = 252 EVs). UI: regulation select, Tailwind (x2) and Trick Room (reverse) toggles, click a row to toggle Choice Scarf (x1.5, floored) for that row; table columns `#, Pokemon, Speed, Base, Spread`; your team's rows are computed live from the set (item multipliers: Scarf x1.5, Iron Ball/Power items x0.5, Quick Powder x2 Ditto only); Mega stone adds a mega-forme row; pastes with all values <= 32 are treated as SPs. No handling for speed stages, paralysis, Unburden, or Speed-boosting abilities (opportunity).
- Source data refreshed by a weekly job from species lists (seeded from Serebii).

### 12.7 Damage calc
- Engine `@smogon/calc`; Champions mode reuses the Gen 9 engine with SPs mapped to EVs, IVs 31, level 50. Field state: game type, terrain, weather, gravity, Ruin abilities, per-side screens, Helping Hand, Tailwind, Friend Guard, Steely Spirit, Power Spot, Battery, hazards; status, boosts, current HP %, Tera type, Protosynthesis/Quark Drive boosted stat, per-move BP override and crit. Custom patch for Aura Guard (not in the engine).
- Sets come from a community VGC setdex (NCP), refreshed weekly, plus your own team's sets from the paste. "Save" appends the result description string to a team member's calc list (text only, not re-openable). Opportunity: save structured calc state (attacker, defender, field, move) so calcs are re-openable and linkable to matchup plans.

### 12.8 Known gaps and opportunities (their open issues and source)
- No timeline/trend views: ELO over time (requested, ELO data exists but is not charted), rolling win rate. No date range, opponent-rating, or Bo3-only filters; Usage Stats has no filters at all.
- Custom matchup analysis only gives an average win rate (maintainers want lead/back suggestions with statistical sufficiency). No confidence intervals or minimum-sample warnings beyond a "3 encounters" gate. No lead-vs-lead tables, bring-order/turn-by-turn analysis, damage-taken, or speed-control tracking.
- Ditto/Zoroark (Transform/Illusion) not handled in logs; nickname parsing, forme/sprite mismatches (Urshifu, Koraidon), replays where you are p2, and replays between two tracked usernames were recurring bugs. Team versioning requested (no versioning of set changes).
- Replay search is limited to opposing Pokemon name (plus `user:`/`tag:` on Bo3); no search by move, item or Tera/Mega; replays have notes but no tags; no sort/filter by date/opponent on the flat list.
- Calcs are free text; speed tiers ignore in-battle modifiers and are not tied to an opponent; type chart is defensive only (offensive coverage requested).
- Requires an account and a server; export drops folders, colours, reviewed flags and plan order; mobile layout was a repeated source of bugs.
- **Where we are structurally better**: no account, no paste step, no replay upload, live capture, own teams from the teambuilder, exact opponent sets via open team sheets, instant stats, works offline.
