# Plan: FBE-2 Football Play Event Model and Situation Projection

Execution plan for the football domain core: rules profiles, `football.*` event
definitions on the shared engine, validation, the situation projector (down,
distance, spot, possession, drives, score) and the stat projector. FBE-2 is a
pure library under `src/lib/football/` with tests; it ships no UI and no cloud.

Status: proposed; awaiting owner Q&A. Parent: [FBE-0](PLAN_FBE_0_FOOTBALL_PRODUCT_MODEL.md).

---

## 1. Scope

In scope:

- `src/lib/football/rules.ts` and `profiles.ts`: immutable versioned rules and
  built-in profiles (FBE-0 §5).
- `src/lib/football/events.ts`: event type constants, payload types, strict
  validators and registration with `src/lib/gameEvents/registry.ts`.
- `src/lib/football/situation.ts`: pure fold that returns the situation before
  and after every play plus drive boundaries.
- `src/lib/football/projector.ts`: `SportGameEventProjector` producing score,
  per-player `fb_*` counters, team totals and diagnostics.
- `src/lib/football/gameState.ts`: football `sportGameState` (setup snapshot,
  rules snapshot, participants) and its entry in `src/lib/sportGameState/`.
- Fixture play logs from real public box scores used as golden tests.

Out of scope: UI (FBE-3), Timeline/edit commands beyond the checked append and
mutation helpers the engine already provides (FBE-4), cloud (FBE-5).

---

## 2. Principles

1. **The play is atomic.** One snap = one `football.play` event, saved and
   revised as a unit. Stats never come from separate increment events.
2. **Spots, not yards.** The recorder records where the ball ended (and where
   things happened inside the play); gains, first downs and field position are
   derived. Directly typed yardage is allowed as an alternative input but is
   converted to a spot before saving.
3. **Situation is derived and overridable.** Down/distance/spot/possession come
   from the previous play's outcome. When the derived situation is wrong, the
   recorder appends `football.situation_set`; earlier plays are not rewritten.
4. **Recorded, not adjudicated.** StatKeeper does not enforce penalties. The
   recorder records the penalty and the resulting spot; the app suggests
   enforcement from a catalog but the recorded result wins.
5. **Explicit unknowns.** Every optional actor or detail distinguishes "not
   recorded" from "none" (e.g., no tackle because the ball went out of bounds).
6. **Deterministic replay.** Ordering is the engine's period/sequence order;
   projection never depends on wall clock.

---

## 3. Envelope usage

Uses the shared `GameEvent` envelope from `src/lib/gameEvents/types.ts` unchanged.

| Envelope field | Football meaning |
| --- | --- |
| `sportId` | `football` |
| `eventType` | `football.play`, `football.situation_set`, ... |
| `teamSide` | For plays: the side **in possession at the snap** (`tracked` / `opponent`). Kickoffs use the kicking side. Admin events use `neutral` where the definition opts in |
| `period` | `{ id: 'q1'..'q4' | 'h1'..'h2' | 'ot-1'.., order }` from the rules' period format |
| `elapsedMs` | Game-clock elapsed time in the period when the play was saved, from the anchored clock; null only for untimed games (FBE-0 §3) |
| `location` | Null. Authoritative spots are in the payload in yard units (§4) |
| `actors` | Every player involved, each with a role (§6). Opponent actors are `unknown`/`team` label actors with optional jersey |
| `payload` | Play definition (§5) |

No envelope change is needed. Envelope `location` stays null because a play has
several spots (snap, catch, end, fumble, enforcement) and one normalized point
would misrepresent it.

---

## 4. Field coordinates

- Unit: integer yards. Half yards are not tracked (stat crews round to the yard).
- Frame: **tracked-team frame.** `0` is the tracked team's goal line;
  `L = rules.fieldLength` (100 normally) is the opponent's goal line. End zones
  are `-E..0` and `L..L+E` (E = end-zone depth, 10 normally).
- A spot is `{ yard: integer }` with `-E <= yard <= L + E`. Optional
  `lane: 'left' | 'middle' | 'right'` records hash/width context for pass target
  and run direction charts.
- Display converts to football language using the possessing side:
  tracked at 35 -> "OWN 35" when tracked has the ball, "OPP 35" when the opponent
  has it; 50 -> "50".
- Gains are computed in the **offense's direction**: tracked offense gains when
  `yard` increases, opponent offense gains when it decreases.
- Display direction (which way the tracked team goes on screen) is a projection of
  period and the coin toss, never stored in plays. Flipping quarters rewrites
  nothing.

Rationale: stat definitions are one-dimensional; a tracked-frame integer is
exactly what a stat crew writes ("ball on the OPP 34"), survives end changes, and
works for 80-yard and flag fields by rules.

---

## 5. `football.play` payload (schema version 1)

A play records three different spots, and nothing is allowed to stand in for
another one:

| Spot | Meaning | Used for |
| --- | --- | --- |
| `snap` | Line of scrimmage or kick spot | Gains, FG distance |
| Carry `endSpot` values; the last one is the **dead-ball spot** | Where each ball carrier's run ended; the last carry ends the action | Player yardage, scoring |
| `nextSnap` | Enforced spot for the next snap, after penalty enforcement or a touchback | Next situation only |

Example: a run from 20 to 30 followed by a 15-yard dead-ball foul by the defense.
The run carry ends at 30, so the rusher gets 10 yards. `nextSnap` is 45, so the
defense is charged 15 penalty yards, and the next snap is 1st & 10 at the 45.

```ts
interface FootballPlayPayloadV1 {
  kind:
    | 'run' | 'pass' | 'sack' | 'scramble' | 'kneel' | 'spike'
    | 'punt' | 'field_goal' | 'kickoff' | 'onside_kick' | 'free_kick'
    | 'try_kick' | 'try_run' | 'try_pass'
    | 'no_play'                     // penalty-only (false start, delay, etc.)
  snap: { yard: number }            // line of scrimmage / kick spot
  // Situation as the recorder confirmed it at the snap. Null = accept derived.
  declaredSituation: { down: 1|2|3|4; distance: number | 'goal' } | null

  pass?: {
    result: 'complete' | 'incomplete' | 'intercepted'
    target: { lane: Lane | null; depth: 'behind' | 'short' | 'deep' | null } | null
    catchSpot?: { yard: number } | null      // enables air yards / YAC later
    brokenUp: 'recorded' | 'none' | 'unknown'
  }
  kick?: {
    result:
      | 'good' | 'no_good' | 'blocked'                       // FG / try_kick
      | 'returned' | 'fair_catch' | 'touchback' | 'out_of_bounds'
      | 'downed' | 'muffed' | 'recovered_by_kicking_team'    // punts/kickoffs
    kickEndSpot: { yard: number } | null     // where the kick landed or was fielded
  }

  // Ordered ball-carrier legs. Empty for incomplete passes, spikes,
  // kicks that end without a carry (touchback, fair catch, no_good) and no_play.
  carries: FootballCarryV1[]

  // Enforced next-snap spot. Null = derive it from the dead-ball spot and the
  // rules (touchback spots, try spot, kickoff spot). Required when an accepted
  // penalty moves the ball.
  nextSnap: { yard: number } | null

  scoring: null | {
    type: 'touchdown' | 'field_goal' | 'safety' | 'try_success' | 'defensive_try'
    side: 'tracked' | 'opponent'            // who scored
  }

  penalties: FootballPenaltyV1[]           // zero or more flags on the play
  firstDownOverride: boolean | null        // recorder-confirmed "moved the chains" when the spot is ambiguous
  note: string | null
}

interface FootballCarryV1 {
  key: string                       // 'c0', 'c1', ... contiguous, unique within the play
  side: 'tracked' | 'opponent'      // team in possession during this leg
  kind:
    | 'rush' | 'scramble' | 'sack' | 'kneel' | 'reception'
    | 'lateral' | 'fumble_recovery'
    | 'interception_return' | 'kick_return' | 'punt_return' | 'blocked_kick_return'
  startSpot: { yard: number } | null   // null = unknown (e.g. recovery point not seen)
  endSpot: { yard: number; lane?: Lane | null } | null
  endedBy:
    | 'tackled' | 'out_of_bounds' | 'touchdown' | 'fumble' | 'lateral'
    | 'downed' | 'touchback' | 'safety' | 'kneel' | 'unknown'
  fumble?: {                        // only when endedBy = 'fumble'
    forced: 'recorded' | 'none' | 'unknown'
    outcome: 'recovered' | 'out_of_bounds' | 'out_of_end_zone'
  }
}

interface FootballPenaltyV1 {
  code: string                      // catalog id, e.g. 'false_start', 'holding_off', 'dpi', 'custom'
  label: string | null              // required for 'custom'
  against: 'tracked' | 'opponent'
  status: 'accepted' | 'declined' | 'offsetting'
  timing: 'pre_snap' | 'live_ball' | 'dead_ball_after'
  enforcement: 'previous_spot' | 'spot_of_foul' | 'end_of_run' | 'succeeding_spot' | 'dead_ball_spot' | null
  yards: number | null              // yards walked off as recorded; null when not recorded
  negatesPlay: boolean              // saved at capture from the catalog default or the recorder's choice
  automaticFirstDown: boolean
  lossOfDown: boolean
  replayDown: boolean
}
```

`negatesPlay` and every other catalog-derived flag are copied into the event when
the play is saved. Replay never reads the live catalog, so later catalog changes
cannot change historical games.

### Actor attribution

Actors live in the envelope `actors[]`. Roles that belong to a carry carry its
key as a suffix, so each actor maps to exactly one carry, side and endpoint.
Identity is never inferred from array order.

| Role | Meaning |
| --- | --- |
| `passer`, `target` | pass (target = intended receiver) |
| `carrier:<key>` | ball carrier for that carry; for a `reception` carry this is the receiver; for `sack` it is the passer |
| `tackler:<key>`, `tackler_assist:<key>` | who stopped that carry (solo or shared) |
| `forced_by:<key>` | forced the fumble that ended that carry |
| `sacker`, `sacker_half` | sack credit |
| `pass_defender`, `interceptor` | pass; `interceptor` must also be `carrier` of the `interception_return` carry |
| `kicker`, `punter`, `holder`, `long_snapper`, `blocker` | kicks |
| `penalized:<n>` | offender for penalty index n (optional) |

A carry with no `carrier:<key>` actor is Unattributed. Its yards count toward
the side's team totals and no player gets them. The validator rejects a keyed
role whose key has no matching carry, and rejects actors on a carry from the
wrong side's roster.

### Minimum valid plays (quick capture)

| Kind | Required | Everything else |
| --- | --- | --- |
| run / scramble / kneel | snap, one carry with an end spot | carrier optional |
| pass | snap, pass.result; a `reception` carry when complete | passer/target/receiver optional |
| sack | snap, one `sack` carry | passer optional |
| punt / kickoff | snap, kick.result; a return carry when returned | kicker/returner optional |
| field_goal / try_kick | snap, kick.result | kicker optional |
| try_run / try_pass | snap, `scoring` or explicit failure | actors optional |
| no_play | at least one penalty and `nextSnap` | |

The FBE-3 entry sheet builds carries for the recorder: one tap for a simple run
makes one carry, and fumble/lateral/return details add carries.

---

## 6. Other event types

| Type | Payload (v1) | Notes |
| --- | --- | --- |
| `football.situation_set` | `{ possession: side, spot: {yard}, down: 1-4 or null, distance: number or 'goal' or null, reason: 'missed_plays' | 'correction' | 'overtime_start' | 'other', note }` | Resets the fold at its position. Neutral side |
| `football.coin_toss` | `{ winner: side, choice: 'receive' | 'kick' | 'defer' | 'defend_goal', trackedDirection: 'left_to_right' | 'right_to_left', openingKickingSide: side, secondHalfKickingSide: side, scope: 'game' | 'overtime' }` | Both kicking sides are recorded explicitly, because the choice alone does not fix them after a defer or goal choice |
| `football.timeout` | `{ side: 'tracked' | 'opponent' | 'official' }` | Projection counts remaining per half |
| `football.period_start` / `football.period_end` | `{ }` | Lifecycle; period ids come from the frozen period format (§7.1) |
| `football.clock_start` / `football.clock_pause` / `football.clock_set` | Shared anchored-clock shapes (Basketball BKE-6A2); `clock_set` requires a reason | Neutral side. A play-stamp mismatch is a football warning, not a rejection (§7.3) |
| `football.score_adjustment` | `{ side, delta, reason }` | Signed, reason required; same rules as Soccer |
| `football.match_end` / reopen | Shared platform lifecycle | |

---

## 7. Situation projection

`projectFootballSituation(rules, setup, events) -> { beforePlay[id], afterPlay[id], drives[], current, warnings }`

State: `{ period, possession, spot, down, distance | 'goal', lineToGain, tryPending, kickoffPending, timeoutsLeft{tracked,opponent}, score }`.

### 7.1 Periods from the frozen format

The frozen rules produce an ordered `regulationPeriodIds` list:
`['q1','q2','q3','q4']` for quarters or `['h1','h2']` for halves. Nothing
compares against literal ids.

- **Opening period** = `regulationPeriodIds[0]`; setup appends its `period_start`.
- **Halftime** = the end of `regulationPeriodIds[length / 2 - 1]` (q2 or h1).
  Halftime resets timeouts and sets `kickoffPending` for the coin toss's
  `secondHalfKickingSide`.
- **Direction flips** at the end of every regulation period for quarters and at
  halftime for halves.
- **Overtime** periods `ot-1..` follow the last regulation period. Each one starts
  with a `situation_set` or an overtime-scope coin toss.

### 7.2 Fold per play (after applying any `situation_set`)

1. **Before-snap situation** = current state. If `declaredSituation` differs,
   record a `situation_mismatch` warning. The play's down-based stats (such as
   3rd-down conversions) use the declared down and distance.
2. **Dead-ball spot** = the last carry's `endSpot`. For a play with no carries it
   is the snap, or the kick result spot for kicks. **Possession** after the
   action = the last carry's side, or the kick result.
3. **Scoring** comes from `payload.scoring`. It must agree with the carries: a
   touchdown requires the last carry to have `endedBy: 'touchdown'` for the
   scoring side, and a safety requires `endedBy: 'safety'` in the defending end
   zone. Scoring uses the dead-ball spot. Penalty enforcement after a score moves
   only `nextSnap` (the try or kickoff spot), never the scoring endpoint.
4. **Penalties:** accepted penalties apply their flags. `nextSnap`, when present,
   is the enforced spot; when absent, the next spot is derived from the dead-ball
   spot. Penalty yards come from the recorded `yards` when present, otherwise from
   the distance between the base spot and `nextSnap`. Declined and offsetting
   penalties are counted but move nothing.
5. **Next situation:**
   - after a TD, `tryPending` for the scoring side at `nextSnap` or `rules.trySpot`;
   - after a successful try or FG, `kickoffPending` for the scoring side;
   - after a safety, a free kick is pending for the side that gave up the safety;
   - possession change: 1st & 10 (or goal) for the new offense at the next spot;
   - the offense keeps the ball: a next spot at or past `lineToGain`, or an
     automatic first down, gives a 1st down; `replayDown` repeats the down;
     otherwise down + 1 (+1 more for `lossOfDown`); after 4th down without a first
     down, turnover on downs;
   - `firstDownOverride` wins when present.
6. **Drives:** a drive starts at the first scrimmage snap after a possession change
   and ends with its result (TD, FG, missed FG, punt, turnover, downs, safety,
   end of half, end of game).

### 7.3 Football warnings versus fatal diagnostics

The shared engine treats any projector diagnostic as fatal:
`src/lib/gameEvents/projection.ts` marks the projection incomplete, and
`mutations.ts` rejects the append, including an atomic append-plus-mutate.
Football does not relax that. It uses the sport projection warning pattern
instead: recoverable issues live in
`sportGameState.projection.warnings: FootballProjectionWarning[]`, like
Basketball's `relationshipWarnings` and Baseball's projection `warnings`, and
are never returned as shared diagnostics.

| Recoverable warning (play saves; totals stay official) | Fatal diagnostic (append rejected) |
| --- | --- |
| `situation_mismatch`: declared down/distance differs from the derived value | Payload fails strict parsing, unknown keys, bad enums |
| `unexpected_sequence`: try without `tryPending`, a kickoff not after a score or half, or a scrimmage play while a kickoff is pending | Spot outside field bounds, or a non-integer yard |
| `first_down_override_conflict`: the override contradicts the spots | Carry keys not contiguous, a keyed role pointing at a missing carry, or an actor on the wrong side |
| `clock_stamp_mismatch`: play `elapsedMs` is inconsistent with the anchored clock | Tracked player actor who is not a match participant; opponent `player` actor |
| `unknown_yardage`: a carry with a null start or end spot | Scoring that contradicts its own carries (§7.2 step 3) |
| `possession_gap`: the play's side differs from derived possession with no `situation_set` | Kind forbidden by the rules (e.g. kicks in a flag profile) |

Warnings appear in the UI as "check this play" and never block capture. A stream
with fatal diagnostics (possible only through import or recovery, since the
append path rejects them) is quarantined like Soccer and Basketball. Its totals
are suppressed and never published or aggregated.

### Why not derive situation purely from `declaredSituation`?

Because one recorder will miss plays. Deriving means the recorder confirms rather
than types, and a mismatch is a visible signal. Storing the declared value keeps
official down-based stats right even when the derivation disagrees.

---

## 8. Stat projection

Walks plays with their before/after situations and emits per-actor `fb_*`
counters plus team totals, following the catalog in FBE-0 §8. When an accepted
penalty has `negatesPlay: true`, every carry, pass and tackle stat on that play
is dropped, and only the penalty and the next situation remain. Key rules:

- **Carry yards** = `endSpot - startSpot` in the carrying side's direction,
  credited to that carry's `carrier:<key>`. The first carry's start is the snap
  unless recorded. This is the NCAA split for laterals and fumbles: each carrier
  gets the yards of their own leg.
- **Rushing** comes from `rush`, `scramble` and `kneel` carries, plus `sack`
  carries when `rules.sackYardage = 'rushing'`.
- **Passing yards** on a completion = the `reception` carry's yards measured from
  the snap (catch plus run after catch). The receiver gets the same number as
  receiving yards. With `team_passing` accounting, sack yards count against team
  passing.
- **Returns:** interception, fumble, kick and punt return carries credit their
  carrier's return yards.
- **Unknown yardage:** a carry with a null start or end spot still counts its
  attempt, reception or return, but contributes no yards. It increments an
  `unknown_yards` coverage counter so summaries can label totals as incomplete.
  Unattributed carries count toward team totals only.
- **Penalty yards** are charged to the penalized side's team totals and never
  change player yardage.
- **Sacks:** the passer gets a sack taken and the sack yards. `sacker` gets 1.0 and
  `sacker_half` gets 0.5.
- **Receptions and targets** are counted only when recorded. Targets are
  "recorded targets", never inferred.
- **Tackles:** `tackler:<key>` counts 1.0 as a solo tackle, and
  `tackler_assist:<key>` counts 0.5 with `fb_tkl_ast`. A tackle for loss is a
  tackle on a carry that ends behind the snap.
- **Kicking:** FG distance = (`L` - snap.yard for tracked; snap.yard for opponent)
  + `E` + `rules.fgSnapHoldAllowance` (7 default).
- **Punting:** net = gross - return yards, with the touchback deduction from the
  profile.
- **Coverage counters** (`plays_with_tackler_recorded`, `unknown_yards`, etc.)
  feed the "recorded coverage" labels.

---

## 9. Validation

- Strict payload parsing per schema version; unknown keys rejected; the engine
  preserves round-trips for future versions.
- Spots are integers within field bounds; lanes are enumerated.
- Actor roles are allowed per kind, keyed roles must reference existing carries,
  tracked `player` actors must be match participants, and opponent actors must be
  label actors.
- Everything in the fatal column of §7.3 rejects; everything in the warning column
  saves with a warning.
- Rules gates: flag profiles reject kick kinds, and 6-player uses a 15-yard
  first-down distance.
- Registering football event definitions does not make cloud transport or
  production game creation available. Those stay behind the FBE-5/FBE-6 gates and
  the shared allow-list migration (FBE-0 §12).

---

## 10. Tests

- Unit tests for every kind, carry kind and penalty status.
- **Spot separation fixtures:** a run from 20 to 30 plus a 15-yard dead-ball foul
  gives the rusher 10 yards, the defense 15 penalty yards and a next snap at 45; a
  touchdown followed by a penalty enforced on the try or kickoff keeps the scoring
  endpoint and moves only `nextSnap`; a holding foul with `negatesPlay: true` drops
  all play stats.
- **Multi-carry fixture:** an interception return that ends in a fumble recovered
  and returned by the passing team (three carries, two sides) credits each leg to
  its own keyed carrier, including an Unattributed leg and an unknown-spot leg.
- **Warning versus fatal:** a situation mismatch saves with a warning and official
  totals; a structurally invalid play is rejected by append and by atomic
  append-plus-mutate; Soccer and Basketball rejection tests are unchanged.
- **Period format:** a four-quarter game and a two-half game each verify the
  opening period id, the halftime transition, the timeout reset and the
  second-half kickoff side.
- Carry over the transactional invalid-replay and immutable-setup tests from the
  Baseball foundation (#430) and the explicit anchored/untimed lifecycle cases from
  the Hockey plan (#429).
- Golden fixtures: two or three complete public high-school box scores and one
  NCAA game transcribed to play logs; projection must match the published team
  totals, passing/rushing/receiving leaders and scoring summary exactly.
- Property tests: flipping display direction never changes stats; removing a play and restoring it yields the identical projection.
- Situation edge cases: pick-six, fumble out of the end zone (touchback), safety
  after a sack, muffed punt recovered by kicking team, onside kick, offsetting
  penalties, penalty on a try, defensive 2-pt return, turnover on downs, missed
  FG returned for TD.

---

## 11. Slices

| Slice | Content | Exit |
| --- | --- | --- |
| FBE-2A | Rules/profile types and built-ins (period format quarters/halves, period lengths by age group); football `sportGameState` + setup snapshot types; capability registration kept fail-closed | Types and parsers tested |
| FBE-2A2 | Clock events and anchored clock projection, extracted from or shared with `src/lib/basketball/clockProjection.ts` where the semantics match; time of possession per drive | Clock replay and correction tests |
| FBE-2B | Event definitions, validators, registry, checked append helpers | Every kind validates/rejects as specified |
| FBE-2C | Situation fold, period format lifecycle, drives, football warnings versus fatal diagnostics | Edge-case suite green |
| FBE-2D | Stat projector, team totals, coverage, golden fixtures | Golden box scores match |

No migrations in FBE-2. Football cloud storage uses the shared constraint
(migrations 050–051 already permit `tracked | opponent | neutral`).

---

## 12. Questions to confirm in FBE-2 Q&A

1. Integer yards only (no half-yard spots)? [Default: yes.]
2. Penalty catalog scope: ~25 common fouls plus Custom? [Default: yes.]
3. Should `negatesPlay` be a catalog default the recorder can flip, or always
   asked? [Default: catalog default, flip in details; the chosen value is always
   saved on the event.]
4. FG snap/hold allowance of 7 yards (NCAA/NFL convention) for all profiles?
   [Default: 7 for 11-player, profile-configurable.]
