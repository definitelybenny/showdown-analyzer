# M0 spike results (2026-11-02)

Checked in a real browser against the live site (guest session, no login). Items needing Tampermonkey or a live Bo3 are listed at the bottom as still open.

## Verified

| Question | Result |
|---|---|
| Default client | Classic: `window.app` is an object, `window.PS` is undefined. `app.receive`, `app.send`, `app.rooms`, `Storage` all present. |
| /beta client | `window.PS` object with `addRoomType, join, leave, focusRoom, receive, send, update, rooms, teams, user, rightRoomList, leftRoomList` all present. `/beta` rewrites the URL to `/` after load. |
| Panel classes on /beta | `window.PSRoom`, `window.PSRoomPanel`, `window.PSPanelWrapper` are functions and `window.preact` is an object (so the tab approach in PLAN.md D4 works without an adapter). `window.Teams` and `window.Dex` also exist. |
| Dex coverage (Champions) | `Dex.species.get` knows `Absol-Mega-Z`, `Lucario-Mega-Z`, `Garchomp-Mega-Z`, `Froslass-Mega`, `Charizard-Mega-X`, `Zamazenta-Crowned`. Z-Mega formes are named `<Base>-Mega-Z` (`forme: "Mega-Z"`). `isNonstandard` is `"Future"` for the new Megas, so **do not filter on `exists`/`isNonstandard`**, only on `exists`. No bundled override table is needed. |
| Format list | `BattleFormats` includes `gen9championsvgc2026regmc` and `gen9championsvgc2026regmcbo3` (plus other `gen9champions*` ids), so the client already knows the formats. |
| CSP | No CSP meta tag on the page (header check in RESEARCH.md found none either). |
| Storage | `indexedDB` available; quota about 6.6 GB in this profile; `navigator.storage.persist()` returned `false` (not granted automatically for this origin/profile, so we must not rely on it and need the export reminder). |
| Compression | `CompressionStream` is available, so raw logs can be stored compressed. |
| Username | Guest sessions read as `Guest NNNNNNN` on both clients (`app.user.get('name')` / `PS.user.name`). The code must treat `PS.user.named === false` / guest names as "not logged in" and re-read the name after `|updateuser|`. |

## Decisions confirmed or changed

- Confirmed: support both clients (D4); `window.PSRoom` etc. are real globals.
- Confirmed: use the client's own `Dex` for forme/base-species resolution (no custom Mega table).
- Changed: do not depend on `navigator.storage.persist()`; add an export reminder and optional auto-export (PLAN.md section 7 mitigation becomes the primary protection).
- Note: the classic client builds `app` at the end of `<body>`; with `document-start` we must poll for `app.receive` / `PS.receive` (50 ms, as the reference script does) before wrapping.

## Still open (need a real Tampermonkey install or a live Bo3)

1. `@grant none` at `document-start` wraps `app.receive` / `PS.receive` early enough that no first messages are missed. Plan: poll at 50 ms; on a miss, backfill from `battle.stepQueue` and replay JSON (already in the plan). If Tampermonkey injects too late for `@grant none`, switch to the page-hook fallback (D2).
2. Whether the client routes messages for `game-bestof3-*` wrapper rooms through `receive`. The plan does not depend on this (set identity comes from each game's `bestof` header).
3. How `|request|` arrives for the user's own picks in a live Bo3 (needed for own leads/picks; fallback is the switch order).
