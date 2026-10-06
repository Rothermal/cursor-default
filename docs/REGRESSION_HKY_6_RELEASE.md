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
