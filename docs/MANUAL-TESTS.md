# Manual test checklist

Run after each change that touches `src/host`, `src/capture` or the build. Do both clients (classic: play.pokemonshowdown.com, new: /beta).

1. Install the built script in Tampermonkey; reload Showdown. The Analyzer tab appears and opens without errors in the console.
2. Logged out: the tab shows the "log in to record" hint and nothing is saved.
3. Log in; play (or finish) a Bo1 VGC game. It appears in Games within ~2 s of the result, with rating change if rated.
4. Play a Bo3 set. Games group into one set card; set result and rating delta appear after the last game.
5. Reload mid-game and rejoin: the game is saved as partial (or backfilled) and not duplicated.
6. Spectate a game: nothing is saved.
7. Two Showdown tabs open: a game recorded in one shows up in the other without reload.
8. Settings > Data: export, clear, import restores everything; reparse keeps notes/reviewed flags.
9. Tab close/reopen and URL: the page URL stays `/` and a reload does not try to join the Analyzer room.
10. Narrow side panel (about 360 px) and dark theme look correct.
