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

  // Kind-specific primary result
  pass?: {
    result: 'complete' | 'incomplete' | 'intercepted'
    target: { lane: Lane | null; depth: 'behind' | 'short' | 'deep' | null } | null
    catchSpot?: { yard: number } | null      // enables air yards / YAC later
    brokenUpBy?: 'recorded' | 'none' | 'unknown'
  }
  kick?: {
    result:                         // per kind
      | 'good' | 'no_good' | 'blocked'                       // FG / try_kick
      | 'returned' | 'fair_catch' | 'touchback' | 'out_of_bounds'
      | 'downed' | 'muffed' | 'recovered_by_kicking_team'    // punts/kickoffs
    kickEndSpot?: { yard: number } | null    // where the kick landed/was fielded
  }

  // Ordered in-play possession segments after the initial action.
  segments: FootballPlaySegment[]

  end: { yard: number; lane?: Lane | null } // dead-ball spot of the final segment
  outOfBounds: boolean | null

  scoring: null | {
    type: 'touchdown' | 'field_goal' | 'safety' | 'try_success' | 'defensive_try'
    side: 'tracked' | 'opponent'            // who scored
  }

  penalties: FootballPenaltyV1[]           // zero or more flags on the play
  firstDownOverride: boolean | null        // recorder-confirmed "moved the chains" when the spot is ambiguous
  note: string | null
}

type FootballPlaySegment =
  | { type: 'fumble'; fumbleSpot: { yard: number } | null; forcedBy: 'recorded' | 'none' | 'unknown';
      recoveredBy: 'offense' | 'defense' | 'out_of_bounds'; recoverySpot: { yard: number } | null }
  | { type: 'lateral'; spot: { yard: number } | null }
  | { type: 'return'; kind: 'interception' | 'fumble' | 'kick' | 'punt' | 'blocked_kick';
      startSpot: { yard: number } | null }

interface FootballPenaltyV1 {
  code: string                      // catalog id, e.g. 'false_start', 'holding_off', 'dpi', 'custom'
  label: string | null              // required for 'custom'
  against: 'tracked' | 'opponent'
  status: 'accepted' | 'declined' | 'offsetting'
  yards: number | null              // recorded yardage actually walked off (null for spot fouls entered via result spot)
  timing: 'pre_snap' | 'live_ball' | 'dead_ball_after'
  automaticFirstDown: boolean
  lossOfDown: boolean
  replayDown: boolean
}
```

Actors live in the envelope `actors[]` with these roles:

| Role | Used by |
| --- | --- |
| `passer`, `target`, `receiver` | pass (target = intended receiver; receiver only on completions) |
| `rusher` | run, scramble, kneel, sack victim uses `passer` |
| `tackler` (solo) or `tackler_assist` (repeatable; two or more share the tackle) | any live-ball play |
| `sacker` / `sacker_half` | sack |
| `pass_defender`, `interceptor` | pass |
| `fumbler`, `forced_by`, `recovered_by` | fumble segments (indexed by segment order through a `segment` suffix, e.g. `recovered_by:0`) |
| `returner` | return segments, kickoff/punt returns |
| `kicker`, `punter`, `holder`, `long_snapper` | kicks |
| `blocker` | blocked kicks |
| `penalized:<n>` | offender for penalty index n (optional) |
| `scorer` | who crossed the goal line / kicked the FG (derived when unambiguous; stored when not) |

Segment-indexed roles keep one actors list (engine requirement) while tying
actors to segments. The validator enforces allowed roles per kind.

### Minimum valid plays (quick capture)

| Kind | Required | Everything else |
| --- | --- | --- |
| run | snap, end | rusher optional (Unattributed allowed) |
| pass | snap, pass.result, end (defaults to snap on incomplete) | passer/target optional |
| sack | snap, end | passer optional |
| punt / kickoff | snap, kick.result, end | kicker/returner optional |
| field_goal / try_kick | snap, kick.result | kicker optional |
| try_run / try_pass | snap, success flag via `scoring` | actors optional |
| no_play | at least one penalty | end = snap +/- yards |

---

## 6. Other event types

| Type | Payload (v1) | Notes |
| --- | --- | --- |
| `football.situation_set` | `{ possession: side, spot: {yard}, down: 1-4 or null, distance: number or 'goal' or null, reason: 'missed_plays' | 'correction' | 'overtime_start' | 'other', note }` | Resets the fold at its position. Neutral side |
| `football.coin_toss` | `{ winner: side, choice: 'receive' | 'kick' | 'defer' | 'defend_goal', trackedDirection: 'left_to_right' | 'right_to_left', scope: 'game' | 'overtime' }` | Sets opening direction and suggested kickoff |
| `football.timeout` | `{ side: 'tracked' | 'opponent' | 'official' }` | Projection counts remaining per half |
| `football.period_start` / `football.period_end` | `{ }` | Lifecycle; halftime and period-end flips derive direction |
| `football.clock_start` / `football.clock_pause` / `football.clock_set` | Shared anchored-clock shapes (Basketball BKE-6A2); `clock_set` requires a reason | Neutral side. Projection validates play `elapsedMs` against the clock like Basketball, but a mismatch is a warning, not a rejection, so a late-saved play is never lost |
| `football.score_adjustment` | `{ side, delta, reason }` | Signed, reason required; same rules as Soccer |
| `football.match_end` / reopen | Shared platform lifecycle | |

---

## 7. Situation projection

`projectFootballSituation(rules, setup, events) -> { beforePlay[id], afterPlay[id], drives[], current, diagnostics }`

State: `{ period, possession, spot, down, distance | 'goal', lineToGain, tryPending, kickoffPending, timeoutsLeft{tracked,opponent}, score }`.

Fold per play (after applying any `situation_set`):

1. **Before-snap situation** = current state. If `declaredSituation` differs,
   record a `situation_mismatch` diagnostic (warning, not failure) and use the
   declared down/distance for this play's stats (3rd-down conversions etc.).
2. **Possession changes** from the last `fumble`/`return` segment or kick result.
3. **Scoring** from `payload.scoring`, validated against `end.yard` (a TD requires
   the end spot in the scoring side's attacking end zone unless a penalty explains
   it; a safety requires the offense downed in its own end zone). Mismatch is a
   `semantic_validation_failed` diagnostic.
4. **Penalties:** accepted penalties apply their flags; the recorded `end` spot
   is already the enforced spot. Declined/offsetting penalties keep stats but not
   yardage. `replayDown` repeats the down from `end`; `automaticFirstDown` resets.
5. **Next situation:**
   - after TD -> `tryPending` for scorer's side at `rules.trySpot`;
   - after try or FG good -> `kickoffPending` for the scoring side (NFHS/NCAA/NFL);
   - after safety -> free kick pending for the side that was scored upon;
   - possession change -> 1st & 10 (or goal) for the new offense at `end`;
   - offense keeps ball: gain reaches `lineToGain` -> 1st down; else down + 1;
     after 4th down without a first down -> turnover on downs;
   - `firstDownOverride` wins when present.
6. **Drives:** a drive starts at the first scrimmage snap after a possession change
   and ends with its result (TD, FG, missed FG, punt, turnover, downs, safety,
   end of half, end of game).
7. **Periods:** `period_end` of q2 clears downs and sets `kickoffPending` for the
   team that did not kick to open the game (from the coin toss choice, unless
   overridden). OT starts require a `situation_set` or coin toss.

The fold is deterministic and total: an unknown or inconsistent input produces a
diagnostic and the best-effort next state, never an exception. The UI surfaces
diagnostics as "check this play" without blocking capture.

### Why not derive situation purely from `declaredSituation`?

Because one recorder will miss plays. Deriving means the recorder confirms rather
than types, and a mismatch is a visible signal. Storing the declared value keeps
official down-based stats right even when the derivation disagrees.

---

## 8. Stat projection

Walks plays with their before/after situations and emits per-actor `fb_*`
counters plus team totals, following the catalog in FBE-0 §8. Key rules:

- Gain = `end.yard - snap.yard` in the offense's direction, credited to the
  rusher/passer/receiver of the **initial** action only; return segments credit
  returners; fumble/lateral splits follow the NCAA manual (yardage to the
  fumble/lateral spot to the first carrier, remainder to the next).
- Sacks: passer gets a sack taken and sack yards; yards count as rushing or team
  passing per `rules.sackYardage`.
- Receptions/targets only when a target actor or `pass.result = complete` exists.
  Targets are "recorded targets", never inferred.
- Tackles: `tackler` = solo (1.0 total), `tackler_assist` = 0.5 total with
  `fb_tkl_ast`; TFL when the tackle ends behind the snap on a run/sack/scramble.
- Accepted penalties that negate the play (live-ball fouls where the recorded end
  spot is enforcement from the previous spot and `replayDown`) remove play stats
  except the penalty. A per-penalty `negatesPlay` default comes from the catalog
  and is recorder-overridable in FBE-3.
- Kicking: FG distance = (`L` - snap.yard for tracked; snap.yard for opponent) +
  `E` + `rules.fgSnapHoldAllowance` (7 default).
- Punting net = gross - return yards (touchback: 20 yards off per profile).
- Coverage counters (`plays_with_tackler_recorded`, etc.) feed "recorded coverage"
  labels.

---

## 9. Validation

- Strict payload parsing per schema version; unknown keys rejected; round-trip
  preserved by the engine for future versions.
- Spots are integers within field bounds; lanes enumerated.
- Actor roles allowed per kind; required roles per kind (none in quick mode);
  tracked `player` actors must be match participants; opponent actors must be
  label actors.
- Scoring/end-spot consistency, possession consistency, try only when
  `tryPending`, kickoff kinds only when `kickoffPending` or after a `situation_set`
  (warnings, not failures, so a recorder can always continue).
- Rules gates: flag profiles reject kick kinds; 6-player uses 15-yard
  first-down distance.

---

## 10. Tests

- Unit tests for every kind, segment and penalty status.
- Golden fixtures: two or three complete public high-school box scores and one
  NCAA game transcribed to play logs; projection must match the published team
  totals, passing/rushing/receiving leaders and scoring summary exactly.
- Property tests: flipping display direction and re-numbering quarters never
  changes stats; removing a play and restoring it yields the identical projection.
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
| FBE-2C | Situation fold, drives, diagnostics | Edge-case suite green |
| FBE-2D | Stat projector, team totals, coverage, golden fixtures | Golden box scores match |

No migrations in FBE-2. Football cloud storage uses the shared constraint
(migrations 050–051 already permit `tracked | opponent | neutral`).

---

## 12. Questions to confirm in FBE-2 Q&A

1. Integer yards only (no half-yard spots)? [Default: yes.]
2. Penalty catalog scope: ~25 common fouls plus Custom? [Default: yes.]
3. Should `negatesPlay` be a catalog default the recorder can flip, or always
   asked? [Default: catalog default, flip in details.]
4. FG snap/hold allowance of 7 yards (NCAA/NFL convention) for all profiles?
   [Default: 7 for 11-player, profile-configurable.]
