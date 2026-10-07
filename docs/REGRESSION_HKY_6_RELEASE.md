# Regression: HKY-6 Summary, Aggregates and Release

Record for [HKY-6](PLAN_HKY_6_SUMMARY_AGGREGATES_AND_RELEASE.md). Each slice adds its
section when it lands. Unit tests and builds do not establish live Supabase, installed PWA
or owner sign-off; those are listed separately.

## HKY-6A1 Summary: source, Overview, Skaters and Goalies

No migration and no event, payload, setup or rules change.

### Automated

| Area | Cases | Result |
|---|---|---|
| Per-game lines (`gameLines.test.ts`) | Paired 2-0 games with the scorers in the other order (the GWG moves, totals equal); the same game with and without `emptyNet` on one goal; a removed winning goal (the GWG moves to the next goal); a recorded-later goal placed in period 1 before the new winner; an unattributed winner; a score adjustment (GWG unattributed); an opponent win (no GWG); a backup goalie who never plays (no GP, no GS); two goalies in a tie (T to the goalie in net at the end, no shutout); a shootout loss (OTL, shutout with no regulation or overtime goals against, shootout lines); goalie time across a pulled goalie, a change between periods, a running game (incomplete) and the ended game (complete); a clock corrected back behind a goalie change in an ended game (incomplete, no GAA) | 9 pass |
| Summary (`summary.test.ts`) | Route predicate (local event game, `gameId` with `sport=hockey`, other sports and stat-grid games excluded); query round trip and Back paths; ended and abandoned games resume on the Summary, running and suspended games on the tracker; source selection: local without cloud calls, final cloud game from its publication, live cloud game from the primary stream, a local copy bound to a final game reads the publication; missing publication, missing primary and a failed cloud read name the problem; a publication that has not ended and an unreadable stream show no totals but keep the setup; result, periods, team stats (blocked shots by the defending side, faceoffs, PIM), scoring rows with assists and the GWG, penalty rows; skaters in jersey order; tracked goalies with decisions, a backup marked as not played, opponent goalies from the tracked side's shots; suspended status with its reason; power play and penalty kill with a clock; a confirmed PP goal with no recorded penalty, and two PP goals on one recorded chance (goals shown, no ratio, a note), one goal on one chance (ratio kept) | 11 pass |
| Hockey folder | `npx vitest run src/lib/hockey/` | 28 files, 369 tests pass |
| Full suite | `pnpm test` | 281 files, 2634 tests pass |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | | Pass (lint: the 3 existing fast-refresh warnings) |

### Browser

Playwright with Chromium against `pnpm dev`, a fresh local anchored game made through
setup: two goals for, one against and a save each way, then Game menu > Summary.

| Check | Result |
|---|---|
| Summary opens from the tracker's Game menu on Overview, labelled This device | Pass |
| Overview: In progress, `2-1`, goals and SOG for period 1, team stats, scoring summary with times and running score, no penalties | Pass |
| Skaters and Goalies tabs; the unplayed backup shows Did not play; time in net marked incomplete while the clock runs | Pass |
| Light and Dark at 390 px, Dark at 1280 px; no horizontal page scroll (wide tables scroll inside their card) | Pass |
| Back returns to the tracker; Abandon with a reason, then Summary shows Abandoned and the reason | Pass |
| Console errors | None |

### Not yet checked

- A cloud game's Summary from Game Info (final and not final) against the live project;
  covered by the source tests with injected reads only.
- Installed PWA and a real phone.
- The owner's live game on the HKY-6A and 6B build (plan §7 Q5).

## HKY-6A2 Summary: Timeline, shot map, faceoff map and shootout

No migration and no event, payload, setup or rules change.

### Automated

| Area | Cases | Result |
|---|---|---|
| Review models (`summaryReview.test.ts`) | Shots from two periods played at opposite ends land at one spot (tracked side to the right, opponent to the left); two shots there share one cluster in game order; an unlocated shot is listed; shooters and periods for the filters; side, player, period, outcome and strength filters (strength recorded on goals only); a filter that hides one of a cluster's shots leaves a single mark; dot rotation (left and right swap, upper and lower swap, twice is the identity); faceoffs at opposite ends tallied at one dot from the tracked side's view, by taker and by period; no shootout summary or tab before the shootout starts; rounds with the first side first, the deciding attempt, shooter and goalie lines (a miss is not a shot against), no shootout attempt on the shot map or in goals; the Summary Timeline reads the source oldest first by period; a recorded-later period 1 shot and faceoff and a period 2 faceoff re-timed into period 1 appear in the Timeline's order on the shot list, in the cluster, in the unlocated list and in both period filters (review fix: the whole stream is ordered before picking shots or faceoffs, so placed events keep their period anchors) | 8 pass |
| Summary (`summary.test.ts`) | Adds: the Timeline reads the publication of a final cloud game and the primary stream of a live one | 11 pass |
| Hockey folder | `npx vitest run src/lib/hockey/` | 29 files, 377 tests pass |
| Full suite | `npx vitest run` | 282 files, 2642 tests pass |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | | Pass (lint: the 3 existing fast-refresh warnings) |

### Browser

Playwright with Chromium against `pnpm dev`: a fresh local clockless NHL game made through
setup. Period 1: a located goal and a located save near the right net, a won faceoff at
the right end upper dot. Period 2 (ends switched): a located miss at the same spot from the
tracked side's view, a lost faceoff at the left end lower dot, an unlocated opponent goal.
Then periods 3 and overtime, and a shootout decided 2-0 on the opponent's second attempt.

| Check | Result |
|---|---|
| Tabs: Overview, Skaters, Goalies, Timeline, Shots, Faceoffs, Shootout (Shootout appears because one started) | Pass |
| Timeline: oldest first by period, game flow and shootout rows included; the detail sheet has no Edit, Remove or Restore | Pass |
| Shots: the three located shots share one numbered mark at the right end; the chooser lists them (period 1 goal, period 1 save, period 2 miss) and each opens the read-only detail; the unlocated opponent goal is counted and listed | Pass |
| Faceoffs: both faceoffs at one dot, `1-1` and `50%` on the rink and in the table; taker and period filters | Pass |
| Shootout: `2-0`, won by the tracked side, rounds with shooters, goalies and results, Deciding on the opponent's saved attempt, shooter and goalie lines | Pass |
| Light and Dark at 390 px, Dark at 1280 px; no horizontal page scroll | Pass |
| Console errors | None |

### Not yet checked

- The maps and Timeline of a cloud game's Summary against the live project; covered by the
  source tests with injected reads only.
- Installed PWA and a real phone.
- The owner's live game on the HKY-6A and 6B build (plan §7 Q5).

## HKY-6B1 Server: Hockey aggregate sources

Migration 075 only. No client calls it yet, and no event, payload, setup or rules change.

### Automated

| Area | Cases | Result |
|---|---|---|
| Migration text (`migration075.test.ts`) | The paging core equals the 060 body with only the Hockey sport, the skipped generic predicate for Hockey and the Hockey branch; only the three fixed Hockey functions are granted and both private helpers are revoked; the handshake's exact contract 1 and contract 0 shapes; `get_hockey_release_capabilities` is not touched | 3 pass |
| Database check (`PG_RUN_AS=postgres supabase/tests/hky6b1/run.sh`, PostgreSQL 16, every migration through 075) | Five games bound, uploaded, checkpointed and finalized from the HKY-5A cases. Completion: completed and reopened-then-ended count, ended early with a reason and abandoned do not, and the personal tie does. Team and season pages for viewer, scorer and owner hold only the two completed team games; `canManage` false for a viewer, true for the owner; items carry the snapshot and the participant source map; tournament page empty; outsider sees nothing. Keyset paging with page size 1 gives two pages and a null cursor at the end. Player page: three games for the scorer (with the personal game), two with the team filter, two for a viewer, none for an outsider. A reopened game leaves the team page. Refusals: the private core, a bad scope type, page size 51, a half cursor, a Baseball core call. Basketball and Soccer pages still answer. Handshake: exact contract 1; release contract still 2 / migration 74; with the player wrapper dropped (rolled back) contract 0 and release still 2; suspended account refused on the handshake and the page; anonymous refused | 25 ok, 8 refused, passed |
| Full suite | `npx vitest run` | 283 files, 2645 tests pass |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | | Pass (lint: the 3 existing fast-refresh warnings) |

### Not yet checked

- 075 applied to the live project (the owner applies it before HKY-6B2 deploys).
- Pages against real published games in the live project; HKY-6B2's destinations exercise
  them from the client.

## HKY-6B2 Client: Hockey season stats

Client only. Needs migration 075; no event, payload, setup, rules or migration change.

### Automated

| Area | Cases | Result |
|---|---|---|
| Projection, composition, transport, player views (`aggregates.test.ts`) | Replay and stable-player mapping. A shootout loss is OTL with the published score, and shootout lines are not summed. Games ended early, abandoned, not final, malformed or from another sport or recorder are left out. Goalie time in net and GAA across regulation lengths. Goalies kept to their games, and the team record. Roster zero rows, with scopes kept apart. Partial quality for unmapped players, disagreeing duplicates and malformed items. Plus/minus counted only from complete games, with an incomplete game's partial value left out of season and career totals, and hidden with none. GP ranked by the games in the category's role for mixed-role players. The player line per game. Career segments split by team season and personal. Profile totals exclude personal games. Visible categories for a new player and a goalie. Outcome, game-line, quality and error copy. Transport: the handshake first, every page by cursor, the player page for player scopes, stopping on backend or client update, rejecting a repeated cursor, one shared load, and one caller cancelling without failing the other | 21 pass |
| Page routes (`aggregateDestinationRoutes.test.ts`) | Leaderboard, Team Stats, Tournament Stats, Player Profile and Career guard Hockey before their legacy RPCs; every game links to the Hockey Summary; the Hockey views read no legacy storage | 6 pass |
| Summary origin (`summary.test.ts`) | `from=team` parses and goes back to Team Info, or the Hockey dashboard without a team | Pass |
| Existing guards | The Soccer route test's Player Profile guard now includes Hockey; the appearance test covers both new components | Pass |
| Full suite | `npx vitest run` | 285 files, 2674 tests pass |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | | Pass (lint: the 3 existing fast-refresh warnings) |

### Browser

Checked at 390 px wide in Chromium, with the components in a temporary page against a
stubbed Supabase. The stub answered the handshake, the 075 pages (three published
fixture games: a 2-1 win, a shootout loss and a timed tie with a goalie change) and the
roster.

- Team Overview: GP 3, 1-0-1-1, GF 4, GA 4. The For/Against table reads 4-3 goals,
  because GF and GA include the shootout winner's goal; a note under the table says so.
- Players: Scoring with a roster player at zero. Goaltending lists only the two goalies,
  with the "GAA and time in net show once every game a goalie played was timed" note.
  Plus/minus shows "0 of 3 games are complete".
- Games: newest first, with W, L (SO) and T.
- Season view with the handshake at contract 0: "Season stats need a backend update".
- Career for the relief goalie: the Goaltending section with "Timed in 1 of 2 games", and
  one season segment with both games.
- Profile: Scoring, Shooting and Faceoffs, plus the season's games with each game's line.

### Not yet checked

- 075 applied to the live project and the destinations on real published games.
- Player Profile and Career reached from the live Team Info roster.

## HKY-6C Release

Hockey's event stage is `released` (owner approval in the project thread, 2026-10-07). No
migration, event, payload, setup or rules change.

### What changes

- Every new Hockey game opens the event setup: Sport Dashboard New Game, Team Info Start
  Game, `/setup?sport=hockey` links and team-only `/setup?teamId=` links for a Hockey team
  (`hockeyNewGamesUseEventTracker`). The `events=1` links keep working.
- Settings -> Sports -> Hockey no longer shows the device toggle. A stored opt-in is kept
  but unused, so a rollback to `opt_in` brings the owner's choice back.
- New setting: **Start new games with the rink flipped** (this device only). Hockey setup
  seeds the new game's `capturePreferences.rinkFlipped` from it; the flip stays out of
  events, projection and fingerprints (`live.test.ts`) and can still be changed in the
  tracker.
- Existing stat-grid Hockey games still open, track and review through the generic
  Setup, tracker, Summary and Game Info, locally and in the cloud. Existing event games
  open at every stage.
- **Rollback**: set `SPORT_EVENT_RELEASE_STAGES.hockey` back to `'opt_in'` in
  `src/lib/sportAvailability.ts`. New games then go to the stat grid unless the device
  toggle is on; nothing stored is rewritten.

### Automated

| Area | Cases | Result |
|---|---|---|
| Release policy (`releasePolicy.test.ts`) | Stage is `released`: new event games without the toggle, toggle hidden, existing games reachable. Rollback to `opt_in` restores the toggle in both directions; `internal` hides it and ignores a stored opt-in; development keeps the preview. Device settings default off and fail closed (`rinkFlippedByDefault` only on an explicit `true`). Every entry point (setup route, Sport Dashboard, Team Info, team-only setup link before any new game starts) uses the shared check; the orientation default only seeds the display flip; the audited policy consumers are App, Hockey settings, Game Setup, Hockey setup, Sport Dashboard and Team Info | 11 pass |
| Hockey library | 32 files under `src/lib/hockey` (HKY-1 to HKY-6) | 409 tests pass |
| Full suite | `npx vitest run` | 285 files, 2676 tests pass |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | | Pass (lint: the 3 existing fast-refresh warnings) |

### Browser

Development build at 390 px, Chromium, Supabase not configured (Hockey enabled in
Settings -> App): Settings -> Sports -> Hockey shows the rink orientation switch and no
event-tracker toggle; turning the switch on stores `rinkFlippedByDefault: true`. Sport
Dashboard New Game opens `/setup?sport=hockey&events=1`, and a direct
`/setup?sport=hockey` link opens the same "New Hockey game" setup.

### Evidence by HKY-0 §15 theme

| Theme | Where it is covered |
|---|---|
| Soccer and Basketball trackers, summaries, cloud and aggregates unchanged | Full suite on every HKY PR, including the Soccer and Basketball route and release-guard tests (`soccer/aggregateDestinationRoutes.test.ts`, `basketball/releaseEntryGuards.test.ts`); HKY-5A, 6B1 database checks re-read Basketball and Soccer pages |
| Legacy stat-grid Hockey games open and review through the generic path | `releasePolicy.test.ts` (tracker route never consults the stage), `sportIsolation.test.ts`, `legacyRules.test.ts`; HKY-6B2 keeps stat-grid games out of season stats only |
| Hockey, Soccer and Basketball games share the parking manifest | `sportIsolation.test.ts`, `gameSyncFingerprint.test.ts` |
| Local-only Hockey without Supabase | HKY-2E and HKY-6C browser checks with Supabase unconfigured; missing cloud policy is local-only (`cloudSync.test.ts`) |
| Park and resume keep events, clock, penalties, goalie and direction | `live.test.ts`, `penalties.test.ts`, `sportIsolation.test.ts` |
| Strength for coincidental minors, PP goal release, double minor, 5v3, empty net | `penalties.test.ts`, `specialTeams.test.ts`, `outcomes.test.ts` |
| Edit and remove rebuild score, goalie stats and strength | `corrections.test.ts`, `timeline.test.ts`, `placement.test.ts` |
| Opponent identities never enter the player pool | `setup.test.ts`, `setupBuilder.test.ts`, `aggregates.test.ts` (opponents are never player rows) |
| Independent recorder streams never combine | `recorders.test.ts`, `finalization.test.ts`, HKY-5A database check |
| Viewer, scorer and admin permissions | HKY-5A and HKY-6B1 database checks, `settingsDefaults.test.ts`, Team Manage read-only panels |
| Mobile rink, dialogs, penalty box and clock never overlap | HKY-2E to HKY-6B2 browser checks at 390 px; owner checklist below |
| Actor pickers never use a stale opening five | `capture.test.ts`, `plays.test.ts` |
| XS extractions keep Soccer and Basketball behavior | `src/lib/surface/location.ts` (HKY-2A) and the shared recorder/finalization modules (HKY-5B2) shipped with the existing Soccer and Basketball tests green |
| Legacy Hockey stays available locally and in the cloud | This release changes only where new games start; Game Info, Summary and the stat-grid tracker are untouched |

### Owner checklist (pending until done)

Apply migration 075 first if it is not applied yet.

- [ ] One live game at phone size: setup from Team Info, the clock, shots, a penalty
      and power-play goal, a goalie change, end of game.
- [ ] Finalize in Game Info; the published score matches.
- [ ] The five destinations (Leaderboard, Team Stats, Tournament Stats, Player Profile,
      Career) show the game, and each game opens its Summary.
- [ ] Reopen with a reason, correct one event, finalize again; the destinations update.
- [ ] A viewer on a second device sees the final game and the stats read only.
- [ ] Settings -> Sports -> Hockey: no event-tracker toggle; the rink orientation default
      flips the next new game.
- [ ] An old stat-grid Hockey game still opens from Cloud Games or Game Info.
