# Plan: BSB-1 Baseball Event Foundation

Detailed execution plan for the first Baseball implementation phase defined in
[BSB-0](PLAN_BSB_0_BASEBALL_PRODUCT_MODEL.md). BSB-1 builds the pure, UI-free Baseball
engine: rules, setup snapshot, participants, event definitions, the base/out/count/
half-inning projection, derived statistics, and checked commands. It mirrors BKE-1's
role for Basketball.

Status: BSB-1A-C engine implemented (2026-09-26) in `src/lib/baseball/`, registered
with the shared event runtime and sport-state dispatch. Nothing in BSB-1 is reachable
from production UI; legacy Baseball grid games are unchanged. See section 9 for the
delivery record and documented approximations.

---

## 1. Scope

In scope:

- `src/lib/baseball/` module with immutable rules v1 and built-in profiles.
- Setup snapshot: tracked side (home/away), scheduled innings, tracked batting order
  and defensive alignment, opponent batting-order slots, starting pitchers.
- Event definitions registered with the shared `GameEventRegistry`.
- Deterministic projector producing base/out/count/half-inning/lineup state after
  every event, plus score, line score and derived box statistics.
- Checked command layer (`commands.ts`) that validates against current projection and
  returns appended events or a typed error; command-produced groups are atomic.
- Default runner-movement proposal for each batted-ball result (used by BSB-3 UI).
- `sportGameState` integration for event-authority Baseball games, fail-closed.
- Exhaustive unit tests, including full-game fixtures.

Out of scope (later phases): any React UI, roster/team-settings persistence and
migrations (BSB-2), Timeline edit/restore UI (BSB-4 builds on the BSB-1 mutation
validation), cloud transport (BSB-6), aggregates (BSB-7).

---

## 2. Module Layout

Follow the Basketball layout so reviewers recognize it:

```text
src/lib/baseball/
  types.ts            payload, participant, rules, setup and projection types
  profiles.ts         immutable built-in rule profiles + clone-safe lookup/layering
  rules.ts            exact rules v1 parser/validator
  setup.ts            setup snapshot parser, participants, opponent slots
  positions.ts        position catalog (1-9, DH, EH, custom, Unassigned) + ordering
  periods.ts          half-inning ids/order helpers
  events.ts           GameEventDefinition registrations and payload validators
  projector.ts        replay engine (state machine) + diagnostics
  runners.ts          RunnerMovement validation and default proposals per result
  scoring.ts          RBI, earned-run defaults, LOB, pitcher-of-record, decisions suggestion
  stats.ts            derived batting/pitching/fielding/team totals (bsb_* ids)
  commands.ts         checked commands (pitch, in-play, quick PA, baserunning,
                      substitution, lifecycle, score adjustment)
  gameState.ts        BaseballSportGameState version 1 normalize/fingerprint
  index.ts
  *.test.ts
  fixtures/           full-game command scripts (youth 6-inning, 9-inning DH, walk-off,
                      extra innings with placed runner, run-rule)
```

---

## 3. Contracts

The sections below describe the shipped contract in `src/lib/baseball/types.ts` and
`commands.ts`. The original pseudocode was replaced after review so the plan and the
code cannot disagree.

### 3.1 Rules v1 (`rulesSchemaVersion: 1`)

```text
BaseballMatchRules
  rulesSchemaVersion: 1
  profileId, profileVersion           source link (BKE-5A pattern)
  variant                             'baseball' | 'softball_fastpitch' | 'softball_slowpitch'
  scheduledInnings                    positive integer
  ballsForWalk, strikesForStrikeout   defaults 4 / 3
  startingBalls, startingStrikes      slowpitch leagues may start at 1-1
  twoStrikeFoulIsOut                  slowpitch option
  twoStrikeFoulBuntIsStrikeout, droppedThirdStrike
  battingOrderFormat                  'standard' | 'designated_hitter' | 'extra_hitter' | 'continuous'
  maxExtraHitters                     ignored by continuous
  defensivePlayers                    9, or 10 for slowpitch (short fielder)
  reentry                             'none' | 'starters_once' | 'unlimited'
  courtesyRunners, stealing, leadingOff, balks
  extraInningsAllowed
  placedRunnerBase, placedRunnerFromInning     null or base + first inning it applies
  runRules                            Array<{ afterInning, lead }> (empty = none)
  maxRunsPerHalfInning                null | number
  tiesAllowed
  pitchCountWarnings: number[], pitchCountLimit: number | null
```

`normalizeBaseballMatchRules` is an exact parser: unknown keys, wrong types or
out-of-range values fail closed. `createBaseballMatchRules(profileId, overrides)`
clones a frozen profile. Snapshots are frozen on the game at initialization.

### 3.2 Setup snapshot v1

```text
BaseballMatchSetup
  version: 1
  trackedSide: 'home' | 'away'
  opponentName, sourceTeamId, sourceSeasonId
  rulesSnapshot: BaseballMatchRules
  participants: Array<{ id, playerId | null, displayName, number, position, bats, throws }>
  trackedLineup: {
    battingOrder: participantId[]     length per format (continuous = everyone listed)
    defense: Record<'1'..'10', participantId>   fielding number -> participant;
                                                 the starting pitcher is defense['1']
  }
  opponentSlots: Array<{ id, label, number, position, bats }>   batting-order slots only
  opponentPitcher: { id, label, number, throws }
```

`participant.id` is the stable match identity; `playerId` links to the roster when
present. Opponent slots never map to `players`. `validateBaseballMatchSetup` enforces
format rules (DH/EH/continuous lengths, unique ids, full defense).

Setup is immutable once the stream exists: `initializeBaseballEventGame` accepts an
identical setup as a no-op and rejects any other setup with `already_initialized`.
Late tracked additions and mid-game opponent slot additions are deferred to BSB-4.

### 3.3 Event payloads

Nine event types, all schema version 1, all with a `captureCommandId`:

- `baseball.game_started` (neutral).
- `baseball.pitch`: `{ result, pitchLocation | null, inPlay | null, movements }`.
  `inPlay` is required exactly when `result === 'in_play'`. Pitch location uses the
  catcher's view (0..1 spans the zone; values outside are balls).
- `baseball.plate_appearance` (quick path): `{ result, inPlay | null, finalBalls |
  null, finalStrikes | null, movements }`; the PA is recorded with an estimated pitch
  count.
- `baseball.baserunning`: `{ play, movements }` for steals, pickoffs, WP/PB/balk and
  other between-pitch plays.
- `baseball.substitution`: one of `pinch_hitter`, `pinch_runner`, `courtesy_runner`,
  `defensive { position, incomingId, outgoingId | null }`, `position_change`,
  `opponent_pitcher`, `opponent_slot`.
- `baseball.half_inning_ended` (neutral; `time_limit`, `mercy` or `other` only).
- `baseball.game_ended` / `baseball.game_reopened` (neutral).
- `baseball.score_adjustment`: `{ delta, reason }` on the adjusted side.

Runner movements are always explicit:
`{ runnerId, from, to, reason, fielders, errorBy, earned, rbi, runCounts }`. The
projector implies none; commands and `proposeBaseballMovements` supply defaults.

Fielder references in the payload are fielding numbers. At capture, commands stamp
envelope `actors` with the resolved identities: `batter` (pitch and quick PA),
`pitcher`, and `fielder_{n}` for P, C and every fielding number the play references
while the tracked side is fielding. On replay:

- Fielding credit goes to the stamped participant. When the replayed lineup resolves
  a different player (for example after an earlier lineup correction), the projection
  records an `actor_mismatch` warning instead of silently reattributing history.
- Batting and pitching lines follow the replayed order, because the order itself
  drives the state machine; a stamped batter or pitcher that disagrees produces the
  same warning.
- Unstamped events fall back to the replayed lineup.

Corrections never cascade fielding attribution. Batting and pitching lines can change after a correction, and each change carries an explicit mismatch warning. BSB-4 correction UI surfaces the warnings.

Envelope conventions: `teamSide` is the batting side, lifecycle events are `neutral`,
`period` is the current half-inning (`inning-{n}-top|bottom`), `elapsedMs` is always
`null`, and `location` is the batted-ball spot with `attackingDirection: 'unknown'`.

### 3.4 Projection state

```text
BaseballMatchProjection
  status: 'pregame' | 'in_progress' | 'final' | 'suspended' | 'abandoned'
  inning, half, battingSide, outs, balls, strikes, pitchesInPlateAppearance
  currentBatterId
  bases: { first, second, third }: { runnerId, responsiblePitcherId, reachedBy, unearned } | null
  lineups: { tracked, opponent }: { battingOrder, nextBatterIndex, defense, pitcherId,
                                     appearedIds, starterIds, removedIds, reenteredIds }
  score: { tracked, opponent }, lineScore: per half { runs, hits, errors, leftOnBase, complete }
  battingLines, pitchingLines, fieldingLines      keyed by participant or opponent slot id
  plateAppearances                                 ordered records
  opponentSlotDetails, opponentPitchers
  pendingEnd: null | 'regulation' | 'walk_off' | 'run_rule'
  result: null | { outcome, winner, note }
  warnings: BaseballProjectionWarning[]           actor mismatches (advisory)
```

The shared `GameEventProjection` receives `playerStatsById` (`bsb_*`),
`homeTeamScore` and `opponentScore` from this state.

---

## 4. Projection Rules (state machine)

1. Events replay in capture order. The period must match the projected current half.
2. A pitch updates the count; terminal counts resolve the PA. A strikeout with a
   dropped-third-strike movement for the batter is still a K.
3. Every movement in an event is validated together: named runners must occupy their
   `from` bases, no passing or collisions, forced runners must move, and nothing
   happens after the third out except runs that legally score before it.
4. Forced advances are never implied. Walks, HBP and catcher's interference must list
   the batter and every forced runner; `proposeBaseballMovements` builds that list.
5. On the third out the half closes: left-on-base is recorded, bases and count clear,
   and the next half opens. The bottom of the last scheduled inning is skipped when
   the home side leads. Placed runners are inserted per rules.
6. Runs score for the batting side, charged to the runner's responsible pitcher, with
   earned and RBI defaults per section 9 unless the movement overrides them.
7. Substitutions update lineups immediately. A pinch or courtesy runner takes over the
   runner's base and keeps the responsible pitcher. A player already batting, fielding
   or on base cannot enter again.
8. Re-entry follows `reentry`; continuous order grows rather than replaces.
9. Ending: `pendingEnd` is set when a legal ending is reached (regulation, walk-off, run
   rule) and blocks further play until `game_ended` is recorded. A score adjustment
   recomputes it from the adjusted score: an ending that no longer holds resumes the
   interrupted half or opens the next one, and an adjustment that gives the home side
   the lead in the bottom half can create a walk-off or run-rule ending.
10. Replay stops at the first invalid event with `semantic_validation_failed`,
    projecting only what was valid before it.

---

## 5. Commands

Every command takes the current `GameState` and returns
`{ ok: true, state, events } | { ok: false, state, code, message }` where `code` is
`not_baseball`, `invalid_setup`, `legacy_activity_present`, `already_initialized`,
`stream_not_initialized` or `rejected`.

- `initializeBaseballEventGame(state, setup)`, `startBaseballGame`
- `recordBaseballPitch({ result, pitchLocation?, inPlay?, location?, movements? })`
- `recordBaseballPlateAppearance({ result, inPlay?, location?, finalBalls?, finalStrikes?, movements })`
- `recordBaseballBaserunning({ play, movements })`
- `substituteBaseball(side, substitution)`
- `endBaseballHalfInning(reason, note)`, `endBaseballGame(outcome, { forfeitWinner?, note? })`,
  `reopenBaseballGame`, `adjustBaseballScore(side, delta, reason)`
- Helpers: `baseballMovement(...)`, `proposeBaseballMovements(projection, kind, fielders)`

Commands stamp the period and actors, pre-validate with a replay to give a precise
message, then append through `applyGameEventAppendsAndMutations`, so a rejected command
never leaves a half-applied state.

---

## 6. Slices

| Slice | Content | Exit |
| --- | --- | --- |
| BSB-1A | types, positions, profiles, rules v1, setup v1, periods, gameState normalize/fingerprint; fail-closed `sportGameState` routing for event-authority Baseball | Exact parsing tests; legacy Baseball grid games unaffected |
| BSB-1B | event definitions, projector for pitches/count/outs/bases/halves/score, movement validation, lifecycle | Full-game fixtures replay to known line scores and base states |
| BSB-1C | runner proposals, scoring (RBI, earned, LOB, inherited runners, pitcher of record), stats.ts, substitutions and eligibility, checked commands | Box scores for fixtures match hand-scored expectations; every command rejects invalid state with a typed error |

---

## 7. Test Matrix (minimum)

- Count: 4-ball walk, 3-strike K looking/swinging, two-strike fouls, foul bunt K,
  foul tip K, HBP, intentional walk, catcher's interference.
- Bases: forced advances on BB with every base combination; single/double/triple/HR
  defaults; runner thrown out advancing; double play (6-4-3), triple play; sac fly with
  tag-up; sac bunt; fielder's choice; error with extra bases; steals, caught stealing,
  pickoff, WP/PB/balk advances; dropped third strike reach.
- Illegal movements rejected: empty base, collision, passing, fourth out.
- Third-out timing: force-out third out cancels run; timing play run counts.
- Halves: automatic change on three outs; skipped bottom of last inning; walk-off;
  run rule; max runs per half; extra innings with placed runner (unearned run).
- Lineups: PH, PR (runner identity replaced, responsibility retained), defensive
  switch, pitching change with inherited runners scoring, DH forfeiture, re-entry
  per rule variant, continuous batting order, batting out of order correction event.
- Stats: AB/PA exclusions (BB, HBP, SH, SF, CI), OBP/SLG denominators, ER vs R,
  LOB, IP from outs, pitcher of record, first-pitch strikes.
- Determinism: replay equality, fingerprint stability, clone safety.
- Isolation: Soccer/Basketball projections and legacy Baseball aggregate games
  unchanged; unknown sports still fail closed.

---

## 8. Risks

- **Scoring judgement.** Hit vs error, RBI and earned runs are scorer decisions. The
  model captures them explicitly with defaults; it must never "correct" the recorder.
- **Cascade corrections.** Editing an early out changes every later state. BSB-1's
  validation must report the first invalid event precisely so BSB-4 can preview it.
- **Rule breadth.** Youth variations are numerous. Ship profiles for the level Mark
  uses first (BSB-0 Q3) and keep Custom exact rather than guessing.
- **Performance.** Replay of a ~300-pitch game on every append must stay fast;
  incremental projection may be needed if profiling shows it. Measure in BSB-1B.

---

## 9. Delivery Record (2026-09-26)

Implemented in `src/lib/baseball/`: `types`, `positions`, `profiles` (7 profiles:
NFHS baseball default, youth, MLB, NCAA, NFHS softball fastpitch, slowpitch, custom),
`rules` (exact parser), `periods`, `state` (setup validation and sport-state
normalizer), `events` (9 event types), `projector` (replay state machine), `stats`
(`bsb_*` ids and rate helpers) and `commands` (checked commands plus
`proposeBaseballMovements`). `gameEvents/runtime.ts` and `sportGameState/state.ts`
register Baseball; event games are fail-closed out of legacy aggregate sync by the
existing `isAggregateCloudSyncEligible` guard. `baseball.test.ts` covers profiles,
setup formats, counts, walks/strikeouts, forced runners, hits, double plays, third-out
timing, steals/WP/PB/CS, errors and unearned runs, half-inning rotation, walk-off,
run rule, max runs, placed runner, time limit, suspend/reopen, score adjustment,
pinch hitter/runner, re-entry, pitching changes with inherited runners, opponent
slots, courtesy runners, and a full 7-inning replay from the raw stream.

Verification: typecheck clean; lint 0 errors and the 3 known warnings; 226 files /
1,923 tests pass; production build passes.

Changes from the plan text above:

- Max runs per half-inning ends the half automatically after the event that reaches
  the cap (runs on that play count). `baseball.half_inning_ended` is only for
  `time_limit`, `mercy` or `other` endings.
- A defensive substitution carries `outgoingId` so a new fielder can take a vacated
  batting slot (after a pinch hitter or runner). A vacant position blocks the next
  pitch until filled.
- Commands always write explicit movements; the projector implies none. Walks and
  strikeouts must include the batter movement and every forced runner.
- Actor stamping and the mismatch-warning contract were added after review (section
  3.3).
- Late roster additions and adding opponent slots mid-game are deferred to BSB-4.

Documented approximations (scorer can override per movement where noted):

- Force-out detection for the third-out rule uses the base state at the start of the
  play; a batter out listed earlier on the same play removes the force. A batter
  credited with a hit is treated as having reached first. `runCounts` overrides.
- RBI default: runs scoring on `on_play`, `forced` or `awarded` movements without an
  error, except ground-ball double plays and non-third-base runners on a batter's
  error. `rbi` overrides.
- Earned runs: unearned when the runner reached on an error, catcher's interference
  or as a placed runner, or scored on an error or passed ball. `earned` overrides.
  No full inning reconstruction.
- On a fielder's choice the replacing runner keeps the batter's pitcher of record
  rather than inheriting the retired runner's pitcher.
- Quick plate appearances derive pitch counts from the final count as a lower bound
  (two-strike fouls are unknown).
- DH forfeiture, NFHS courtesy-runner eligibility limits and batting out of order are
  not enforced yet.

### 9.1 Review follow-ups (PR #430)

Mark's review found three defects, now fixed with regression tests in
`reviewRegressions.test.ts`:

- Re-initializing a started game with a different setup replayed existing events under
  new rules. Setup is now immutable once the stream exists (section 3.2).
- A courtesy runner already on base could replace a second runner. Being on base now
  counts as being in the game for every substitution entry point.
- A score adjustment could leave a stale `pendingEnd`. Endings are now recomputed from
  the adjusted score (section 4, rule 9), including walk-off and run-rule invalidation.

The review also asked for resolved actor identities (section 3.3) and a new-sport
isolation matrix. `sportIsolation.test.ts` covers legacy Baseball on the aggregate
route, event Baseball rejected by every cloud route, corrupt or unknown state failing
closed, reload fingerprint stability, and mixed-sport park/export/import.

Registering the engine does not make Baseball event games creatable or cloud-synced.
Creation needs a setup UI and release gate (BSB-2/BSB-3). Cloud sync needs fixed sport
RPC wrappers plus the capability and creation gates Soccer and Basketball use (BSB-6).

### 9.2 Prerequisites before a profile is user-facing

| Before exposing | Required |
| --- | --- |
| Any profile | Setup UI with release gate (BSB-2); tracker (BSB-3) |
| `designated_hitter` / `extra_hitter` formats | DH forfeiture when the DH or pitcher fields; EH/DH slot eligibility checks |
| NFHS profiles with courtesy runners | NFHS courtesy-runner eligibility (who may serve, how often, and for whom), checked against the current rule book |
| Softball fastpitch | DP/FLEX substitution rules; re-entry per NFHS softball |
| Softball slowpitch | Verify the 1-1 start count and two-strike foul out with a real league rule set; short-fielder position labels in the UI |
| Any profile in competitive use | Batting-out-of-order appeal event and correction flow (BSB-4) |
