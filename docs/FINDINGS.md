# Findings from real replay logs

Refines or contradicts RESEARCH.md. Fixture ids are listed in scripts/fetch-fixtures.mjs.

- **Bo3 detection must use the `|uhtml|bestof|` header, not the tier or format id.** 14 of 151 sampled `gen9championsvgc2026regmc` games (tier has no "(Bo3)") are played as Bo3 sets with wrapper `game-bestof3-gen9championsvgc2026regmc-<n>` (fixtures regmc-2708102734 and regmc-2708104058). Older formats do the same (gen9vgc2024regf-2130600385 is game 2 of a set).
- **OTS names Single Strike Urshifu plain `Urshifu`.** A hidden `Urshifu-*` therefore resolves to `Urshifu`. Rapid Strike is `Urshifu-Rapid-Strike` everywhere.
- **Tera-era OTS carry the Tera type** in the last packed field (`...|50|,,,,,Poison`), exposed as `teraType`. Champions sheets leave it empty.
- **Champions Mega formes** are `X-Mega`, `X-Mega-Y` and `X-Mega-Z` (Staraptor-Mega, Raichu-Mega-Y, Garchomp-Mega-Z, Lucario-Mega-Z, Absol-Mega-Z). `@pkmn/dex` 0.10.12 knows them. A mega'd mon that switches back in shows the Mega forme in `|switch|` details, so Mega suffixes are stripped when matching the roster.
- **`|player|` lines repeat on reconnect** with an empty name (`|player|p1|`) or an empty rating. The parser keeps the first name and rating.
- **`|switch|` can end with `|[from] Parting Shot`** after the HP field. It is ignored.
- **`|swap|<ident>|<pos>|[from] move: Ally Switch`:** the ident is the pre-swap slot. Moves after the swap use the new slot with the same nickname, so move owners are resolved by nickname first.
- **Illusion:** `|replace|p2a: Zero|Zoroark-Hisui` arrives later and carries the real nickname. The earlier disguised `|switch|` must not count as a pick or lead; the parser rewrites that appearance in place.
- **`|clearpoke` can arrive after switches** (reconnect/re-init); per-side state must be reset on it.
- **Frequencies (about 200 recent Reg M-C Bo3 logs):**
  - About 30% of Bo3 games end by forfeit.
  - `lost due to inactivity.` appears in Bo1 and Tera-era games but not in the Bo3 samples.
  - No `|tie` in about 1,500 logs across 10 formats (tie path covered by synthetic tests only; same for Zacian/Zamazenta-Crowned).
  - `|raw|` rating lines appear only on the last game of a rated Bo3, and on every rated Bo1 game.
  - Unrated games have an empty rating in `|player|`.
  - Search results can include other-server replays (ids prefixed `dawn-`); they are not used as fixtures.
- **Move usage:** moves carrying a `[from]` tag are not counted as move usage.
