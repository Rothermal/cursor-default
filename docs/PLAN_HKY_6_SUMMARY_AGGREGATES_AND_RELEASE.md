# Plan: HKY-6 Summary, Aggregates and Release

Execution plan for the sixth and last core hockey phase defined in
[HKY-0](PLAN_HKY_0_HOCKEY_PRODUCT_MODEL.md) §12. It builds on HKY-1 to HKY-4 (local
capture, penalties, shootout, Timeline and corrections) and
[HKY-5](PLAN_HKY_5_CLOUD_LIFECYCLE.md) (cloud sync, finalize and reopen, settings).

Status: draft for owner review. No runtime behavior changes in this document.

---

## 1. Goal

HKY-6 exits when Hockey is as complete for the owner as Soccer and Basketball:

- a Hockey event game has its own Summary (overview, skaters, goalies, timeline, maps,
  shootout), for a game on this device and for a cloud game, without loading the cloud
  game into the tracker,
- finalized Hockey games feed `hky_*` season stats in the five destinations: Leaderboard,
  Team Stats, Tournament Stats, Player Profile and Career,
- new Hockey games are event games, and the stat grid stays only to open Hockey games
  that already exist (HKY-0 Q1),
- one regression record covers the whole program, including the owner's live checks.

Not in HKY-6:

- line combinations and skater time on ice (module HKY-M3),
- standings tables (M1), per-60 rates (M2) and the other optional modules in HKY-0 §14,
- opponent player stats beyond the anonymous opponent team and goalies (M9),
- Baseball and Football destinations; each has its own phase.

---

## 2. Slices

Each slice is its own PR, in this order. Migration numbers are taken when the PR opens:
today the latest is `074_hockey_settings.sql`, so HKY-6B1 would take 075 unless Baseball
or Football merges one first.

### HKY-6A1 Summary: source, Overview, Skaters and Goalies

- **Route**: `/summary` sends Hockey event games to a new `HockeySummary`, before the
  legacy fallback (the Basketball and Baseball pattern, `isHockeySummaryRoute`). Legacy
  stat-grid Hockey games keep the generic Summary.
- **Source** (`src/lib/hockey/summarySource.ts`), exactly one of:
  - **this device**: the active or parked game,
  - **cloud, final**: the active canonical publication (`get_hockey_canonical_publication`),
  - **cloud, not final**: the primary recorder's stream, through the read HKY-5B2 already
    uses for the finalize preview (`loadHockeyRecorderProjection`).

  Every source is rebuilt with the shared inspect and replay checks; the stored projection
  is never trusted. An unhealthy stream keeps names and setup but shows no totals, with
  the reason. Remote sources are read-only and never hydrate `GameContext`.
- **Entry points**: the tracker's Game menu gets Summary. Ended and abandoned parked Hockey
  games resume on the Summary, and the tracker stays one tap away. Game Info opens the
  Summary for a Hockey event game, both final and not final.
- **Overview**:
  - the score (`3-2 (OT)`, `3-2 (SO)`, a tie, or the suspended or abandoned status and its
    reason),
  - goals and shots on goal by period,
  - power plays (`2/5`), penalty kill, faceoffs (won-lost and %), hits, takeaways,
    giveaways, blocked shots, PIM, icing, offside and timeouts, for both sides,
  - scoring summary: each goal with its period, time (anchored games), strength (EV, PP,
    SH, EN, penalty shot) and assists,
  - penalty summary: each penalty with its period, time, player, kind and minutes,
  - the goalie of record and the decision.
- **Skaters**: one row per dressed tracked skater, in roster order (jersey number, then
  name). Columns are G, A, PTS, +/-, PIM, SOG, shot attempts, FO won-lost and %, hits,
  blocks, takeaways and giveaways, with PP and SH points in the row detail. Plus/minus is
  labelled when some goals had no complete on-ice set (`plusMinusSkippedGoalIds`).
  Players removed by a game misconduct or match penalty are marked.
- **Goalies**: one row per dressed tracked goalie with shots against, saves, goals
  against, SV% and the decision. Time in net and GAA appear only for an anchored clock
  (from `goalieIntervals`); a clockless game shows them as not recorded. Opponent goalies
  get the same row from the tracked side's shots, as team-level context.
- The `hky_*` per-game stats already in the projection are the only stat source. The new
  per-game derivations in §3 live in one pure module that the Summary and the aggregates
  share.

### HKY-6A2 Summary: Timeline, maps and shootout

- **Timeline**: the HKY-4 Timeline rows, oldest first and grouped by period (the Summary
  order Soccer and Basketball use), with the same family filters and read-only detail.
  Corrections stay in the tracker: a local nonterminal game links to the tracker's
  Timeline. Remote and final sources are read-only.
- **Shot map**: located shots on the rink in one attacking direction per side (normalized
  from each period's direction), with filters for side, player, period, outcome (goal,
  saved, missed, blocked) and strength. Close marks share one numbered cluster that opens a
  chooser. Unlocated shots are counted and listed under the map.
- **Faceoff map**: the nine dots with won-lost and % at each, for the team or one taker,
  by period.
- **Shootout tab**, shown only after a shootout starts: rounds, each attempt's shooter
  (or opponent label), goalie and result, the deciding attempt, and per-player shootout
  lines. Shootout attempts stay out of every other total (HKY-3C).
- Marks and rows open the existing read-only detail sheet.

### HKY-6B1 Server: Hockey aggregate sources

One migration:

- **Completion predicate** `_hockey_canonical_snapshot_completed(snapshot)`: canonical
  schema 1 for `hockey`, and the latest of `hockey.match_ended`, `match_abandoned`,
  `match_suspended` and `match_reopened` (in the replay order the shared helper uses) is a
  `match_ended` with a null reason. The shared helper looks for `reason = 'completed'`,
  which Hockey never writes (HKY-5 §6), so it is not reused for Hockey. Games ended early
  with a reason and abandoned games stay out of season totals (§7 Q3).
- **Paging core**: `_event_aggregate_publication_page` (060) is re-created from its
  current body with `'hockey'` added to its sport check and a Hockey branch that uses the
  new predicate. Soccer and Basketball branches are unchanged; the PR includes a diff
  against 060.
- **Fixed wrappers**: `get_hockey_scope_aggregate_publications` and
  `get_hockey_player_aggregate_publications`, with Basketball's signatures. Team, season
  and tournament scopes cover team games; the player request also covers the player's
  personal games (the Basketball rule).
- **Handshake**: `get_hockey_release_capabilities` contract 3 adds
  `aggregateContractVersion: 1` and checks the two wrappers. A client without the
  migration says season stats need a backend update, and everything else keeps working.
- Legacy Hockey games are not touched: no sport backfill and no legacy page RPC (§7 Q2).

### HKY-6B2 Client: aggregates and the five destinations

- **Pure projection** (`src/lib/hockey/aggregateProjection.ts`): replays each canonical
  publication with its setup, maps participants to stable players
  (`participantSourceMap`), and sums the per-game lines from §3. Rates (shooting %, FO%,
  SV%, GAA, points per game) are computed at read time from totals, never summed.
  Malformed publications are isolated and labelled as partial quality, the SOC-6C and
  BKE-4E rule.
- **Transport**: Hockey wrappers through the shared keyset drain, cancellation and
  in-flight sharing that Soccer and Basketball use. It is moved behind a sport adapter
  only where both existing sports keep their tests green.
- **Destinations**: a Hockey route guard runs before the legacy aggregate RPCs in
  Leaderboard, Team Stats, Tournament Stats, Player Profile and Career, as Soccer's and
  Basketball's do:
  - skater categories (Scoring: G, A, PTS; Shooting: SOG, attempts, %; Special teams:
    PPG, PPA, SHG, SHA; Faceoffs; Physical: hits, blocks, takeaways, giveaways;
    Discipline: PIM, penalties; +/-) and goalie categories (GP, GS, decisions, SA, SV,
    SV%, GA, GAA, shutouts),
  - goalies rank only against goalies; a category with a missing input (GAA without time
    in net) is hidden instead of ranked on partial data,
  - active-roster players with no games show as zero rows; game history links each game
    to its Summary,
  - plus/minus and time-based stats carry their coverage (`n of m games`).
- Personal Hockey games appear in the player's Career and Player Profile only, as for
  Basketball.

### HKY-6C Release and regression record

- **New games are event games** (HKY-0 Q1): with HKY-6 complete, the Hockey stage becomes
  `released` (§7 Q5). New Hockey games from the Sport Dashboard, Team Info Start Game and
  direct `/setup` links go to the event setup. The device toggle is
  removed from Settings → Sports → Hockey. The stat-grid tracker and Summary stay
  available only to open and review existing Hockey games, locally and in the cloud.
  Rollback is one line: set the stage back to `opt_in`.
- **Rink orientation default** in Settings → Sports → Hockey (device only, like
  Basketball's court orientation). It seeds a new game's display flip and never enters
  events or fingerprints. Capture switches (faceoffs off, no on-ice prompt) are left out
  until field use asks for them (§7 Q6).
- **Regression record** `docs/REGRESSION_HKY_6_RELEASE.md`: it gathers the automated
  evidence from HKY-1 to HKY-6, the HKY-0 §15 themes, and an owner checklist (one live
  game at phone size, finalize, the five destinations, reopen and re-finalize, a viewer on
  a second device). The checklist stays pending until the owner does it.
- AGENTS.md and docs/README.md say Hockey is released.

---

## 3. Per-game derivations

These are new and pure. The Summary uses them for one game and the aggregates sum them.
Every one reads only the replayed projection and the frozen setup, so a correction
re-derives it.

| Id | Meaning | Rule |
|---|---|---|
| `hky_gp` | Games played | Every dressed tracked participant in the frozen setup |
| `hky_gs` | Goalie games started | The starting goalie in the opening lineup |
| `hky_eng` | Empty-net goals | A tracked goal with `emptyNet` |
| `hky_gwg` | Game-winning goals | The tracked goal that put the winner one past the loser's final total, in regulation or overtime. Not counted for a shootout winner or a tie |
| `hky_w`, `hky_l`, `hky_otl`, `hky_t` | Goalie decisions | From `goalieOfRecord` and the result's `outcome` and `decidedIn`: a loss in overtime or the shootout is `otl`, a tie is `t` for the goalie in net at the end |
| `hky_so` | Shutouts | The only tracked goalie in net for the whole game (no other interval), and opponent regulation and overtime goals are 0 |
| `hky_toi_ms` | Goalie time in net | Sum of goalie intervals; anchored clock only, otherwise absent for that game |
| `hky_so_att`, `hky_so_g`, `hky_so_sa`, `hky_so_sv` | Shootout lines | Match-scoped only; shown in the Summary, never summed into season totals (HKY-0 §8) |

The existing catalog ids stay as they are. Coverage flags travel with each game's line:
plus/minus is complete only when no goal was skipped, and time-based stats exist only for
anchored games.

---

## 4. Data and compatibility rules

- No Hockey event type, payload, setup or rules change.
- Soccer and Basketball Summaries, aggregates, wrappers and capability contracts do not
  change. The one shared function HKY-6B1 re-creates gets one branch and one sport added.
- Legacy Hockey stat-grid games keep opening and syncing through the generic path.
  Releasing event Hockey never removes that access.
- Remote Summary sources never write to local storage or the tracker.
- Aggregates read only active canonical publications. A reopened game drops out until it
  is finalized again.
- Opponent identities stay match-scoped and never enter the player pool or player
  destinations.

---

## 5. Cross-sport items touched

- **XS-1 (release policy)**: Hockey is the first sport to use a `released` event stage in
  `SPORT_EVENT_RELEASE_STAGES`. The stage type and the policy consumer audit
  (`releasePolicy.test.ts`) gain it, so Baseball can follow.
- **XS-2 (event-sport registration)**: the aggregate guard (060) is the last allow-list
  HKY-0 named. HKY-6B1 records the steps for Baseball and Football.
- **XS-11 (aggregate catalog and destinations)**: `hky_*` uses the private paging core and
  the shared transport. Only presentation shared with Basketball is extracted, and both
  existing sports keep their tests.

---

## 6. Regression

Each slice adds its own section to `docs/REGRESSION_HKY_6_RELEASE.md`:

- **6A**: source selection (local, canonical, primary; unhealthy, missing, no access),
  overview and box score on the HKY-2 to HKY-4 fixtures (overtime, shootout, ties,
  suspended, abandoned, penalties with PP releases, empty net, removed goals, recorded
  later additions), skater and goalie rows, shot and faceoff maps, a cloud final game
  reviewed without changing the active game, and phone and desktop browser checks in
  Light and Dark,
- **6B**: the completion predicate (completed, ended early, abandoned, suspended, reopened
  and refinalized) in a scratch database alongside client parity cases, the scope and
  player wrappers by role, aggregate sums and rates on fixtures, coverage labels,
  malformed-publication isolation, and Soccer and Basketball destinations unchanged,
- **6C**: every new-game entry point opens the event setup, existing stat-grid Hockey
  games still open, rollback to `opt_in` restores the toggle, and the owner checklist,
- every slice: `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`.

---

## 7. Owner Questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | Slices: 6A1 Summary source with Overview, Skaters and Goalies; 6A2 Timeline, maps and shootout; 6B1 aggregate migration; 6B2 destinations; 6C release, each its own PR? | Yes |
| Q2 | Hockey games recorded with the old stat grid: should season stats combine them with event games (Basketball does this, with a legacy page RPC and a sport backfill), or show event games only? | Event games only. Old stat-grid games keep their own Game Info and Summary. Say if you have stat-grid Hockey games in the cloud you want counted |
| Q3 | Which finalized games count in season stats: only completed games, or also games ended early with a reason and abandoned games? | Completed games only, the Soccer and Basketball rule. The others still have a Summary and Game Info |
| Q4 | Goalie decisions: count an overtime or shootout loss as OTL, separate from regulation losses (W-L-OTL-T)? | Yes |
| Q5 | When HKY-6 is complete, make new Hockey games event-only on every device (stage `released`, toggle removed), with rollback to `opt_in`? | Yes, in HKY-6C, after your live game on the HKY-6A and 6B build |
| Q6 | HKY-0 §10 listed capture switches (faceoffs off, no on-ice prompt). Add them now, or wait for field use? | Wait. Add only the rink orientation default now |

---

## 8. Delivery Record

Filled in as each slice lands.
