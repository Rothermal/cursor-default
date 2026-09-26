# Plan: BSB-1 Baseball Event Foundation

Detailed execution plan for the first Baseball implementation phase defined in
[BSB-0](PLAN_BSB_0_BASEBALL_PRODUCT_MODEL.md). BSB-1 builds the pure, UI-free Baseball
engine: rules, setup snapshot, participants, event definitions, the base/out/count/
half-inning projection, derived statistics, and checked commands. It mirrors BKE-1's
role for Basketball.

Status: in progress. Owner decisions are recorded in BSB-0 section 16. Nothing in
BSB-1 is reachable from production UI.

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

### 3.1 Rules v1 (`rulesSchemaVersion: 1`)

```text
BaseballMatchRules
  rulesSchemaVersion: 1
  profileId, profileVersion           source link (BKE-5A pattern)
  scheduledInnings                    positive integer
  ballsForWalk, strikesForStrikeout   defaults 4 / 3
  twoStrikeFoulBuntIsStrikeout        boolean
  droppedThirdStrike                  boolean
  battingOrder: { format: 'standard' | 'designated_hitter' | 'extra_hitter'
                  | 'continuous', extraHitters: 0..2 }
  reentry: 'none' | 'starters_once' | 'unlimited'
  courtesyRunners: boolean
  stealing: boolean, leadingOff: boolean, balks: boolean
  extraInnings: { allowed: boolean, placedRunner: null | { base: 'second' | 'first' } }
  runRule: null | Array<{ afterInning: number, lead: number }>
  maxRunsPerHalfInning: null | number
  tiesAllowed: boolean
  pitchCount: null | { warnAt: number[], limit: number | null }
```

Exact parsing: unknown keys, wrong types or out-of-range values fail closed with a
diagnostic; snapshots are frozen on the game at start and never rewritten.

### 3.2 Setup snapshot v1

```text
BaseballSetup
  setupSchemaVersion: 1
  trackedSide: 'home' | 'away'
  opponentName
  rules: BaseballMatchRules
  tracked: {
    participants: Participant[]         stable participantId, playerId?, name, number,
                                        position (default), bats?, throws?
    battingOrder: participantId[]       length per rules (continuous = all listed)
    defense: Record<Position1to9 | 'DH', participantId>
    startingPitcher: participantId
  }
  opponent: {
    slots: OpponentSlot[]               slotId, order, label?, number?
    startingPitcher: { id, label?, number? }
  }
```

Participants follow Soccer/Basketball: `participantId` is the stable match identity;
`playerId` links to the roster when present. Opponent slots never map to `players`.
Late tracked additions and opponent slot additions are commands (BSB-4 UI).

### 3.3 Event payloads

As listed in BSB-0 section 6. Implementation notes:

- `baseball.pitch` schema v1: `{ result, pitchLocation?: {x,y}, batterHand?,
  movements?: RunnerMovement[], inPlay?: InPlayDetail }`. `inPlay` is required iff
  `result === 'in_play'`. Movements on a non-in-play pitch are limited to running
  reasons (stolen base, caught stealing, wild pitch, passed ball, balk, error on
  throw, pickoff-during-pitch) plus the batter-runner on ball four/HBP/dropped third
  strike.
- `baseball.plate_appearance` schema v1 (quick path): `{ result, finalCount?,
  inPlay?, movements }`; marks the PA as `pitchesTracked: false` in projection.
- Fielder references are position numbers; the projector resolves tracked fielders to
  participants from the defensive alignment at that moment. Commands also stamp the
  resolved `participantId` into actors (`fielder`, `pitcher`, `catcher`, `batter`,
  `runner`) so later lineup corrections surface as diagnostics rather than silently
  reattributing history.
- `teamSide` = batting side. Lifecycle events are `neutral` (definitions opt in).
- `period` = current half-inning, stamped by commands from projection.
- `elapsedMs` = `null` always; validators reject numbers.
- `location` = batted-ball spot, `attackingDirection: 'unknown'`, only allowed on
  in-play pitches and quick PAs with `inPlay`.

### 3.4 Projection state

```text
BaseballProjection
  status: 'pregame' | 'in_progress' | 'final' | 'suspended' | 'abandoned'
  half: { inning, half: 'top' | 'bottom', periodId, battingSide }
  outs: 0..3, count: { balls, strikes }, pitchesInPa
  bases: { first, second, third }: RunnerRef | null
  batter: { side, identity, battingSlot }
  lineups: per side { battingOrder, nextSlot, defense, pitcher, used/eligible sets }
  score: { tracked, opponent }, lineScore: per half runs/hits/errors
  plateAppearances: ordered records (for Timeline/Summary)
  pitcherLines, batterLines, fielderLines  (feed stats.ts)
  canEndGame: { walkOff, runRule, maxRuns, regulationComplete } (advisory)
  diagnostics
```

`projection.playerStatsById` / `homeTeamScore` / `opponentScore` in the shared
`GameEventProjection` are filled from this state for compatibility surfaces.

---

## 4. Projection Rules (state machine)

1. Events replay in capture order (`sequence`, then id). Period is validated against
   the projected current half; an event stamped for another half is a diagnostic.
2. A pitch updates the count. Terminal counts resolve the PA (walk, strikeout).
   A strikeout with a dropped-third-strike movement for the batter is still a K.
3. Every movement is applied atomically for the event: validate all `from` bases are
   occupied by the named runner (or batter), apply outs in `outNumber` order, then
   advances from the lead runner backward; reject collisions, passing, and any
   movement after the third out except runs that legally score before it (timing
   play flag on the scoring movement; force-out third out never lets runs score).
4. Forced advances on walk/HBP/catcher's interference are **implied** when omitted
   (the batter-runner and forced runners move exactly one base); non-forced runners
   stay unless a movement says otherwise.
5. On the third out the half closes: left-on-base is recorded, the base state and
   count clear, the next half opens with the next batter in the other side's order.
   The bottom of the last scheduled inning is skipped when the home side leads.
   Placed runners are inserted automatically in extra innings per rules.
6. Runs: each movement to `home` scores a run for the batting side, charged to the
   runner's `responsiblePitcher`, earned per section 7 of BSB-0 unless overridden,
   RBI credited per scoring.ts defaults unless overridden.
7. Substitutions update lineups immediately; a pinch runner replaces the runner's
   identity on the base keeping `responsiblePitcher` and `reachedBy`; a pitching
   change leaves existing runners charged to the previous pitcher (inherited runners).
8. Eligibility: removed players cannot re-enter unless rules allow and the slot
   matches; DH rules enforced; continuous order grows the order rather than replacing.
9. Game end: `game_end` requires a legal ending (regulation complete, walk-off, run
   rule, max innings with ties allowed, or an explicit reasoned suspension/abandon/
   forfeit). After `final`, capture events are rejected; reopen is a BSB-6 concern.
10. Incomplete streams (unknown event, failed validation) project what is valid up to
    the failure and report diagnostics; they never fabricate state beyond it.

---

## 5. Commands

Each command takes current `GameState`, validates against projection, and returns
`{ ok: true, events }` or `{ ok: false, error }` with a typed code. Examples:

- `recordPitch({ result, pitchLocation?, movements? })`
- `recordBallInPlay({ battedBallType, result, location?, fielders, errorBy?, movements })`
  — proposal helper `proposeMovements(state, result)` supplies defaults.
- `recordQuickPlateAppearance(...)`
- `recordBaserunning({ movements, reason })`
- `substitute({ kind, ... })`, `changePitcher(...)`, `switchPositions(...)`
- `endHalfInning({ reason })` (non-three-out only), `endGame({ outcome, reason })`,
  `suspendGame`, `abandonGame`, `adjustScore({ delta, reason })`

Commands build complete events with ids, sequence, period and actors, then validate
the whole candidate stream with `applyGameEventAppendsAndMutations` so a command never
leaves a half-applied state.

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
