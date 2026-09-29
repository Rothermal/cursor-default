# Plan: HKY-3 Penalties, Strength and Outcomes

Execution plan for the third hockey phase defined in
[HKY-0](PLAN_HKY_0_HOCKEY_PRODUCT_MODEL.md) §12. It builds on HKY-1 (rules, setup,
lifecycle and clock) and [HKY-2](PLAN_HKY_2_RINK_AND_CORE_CAPTURE.md) (rink, shots,
goalies, faceoffs, plays, Recent Events, and the owner tracker behind a default-off toggle).

Status: approved (PR #446 merged, 2026-09-29); built with the §7 recommendations.
HKY-3A is implemented; §8 is the delivery record.

---

## 1. Goal

HKY-3 exits when a local hockey event game records the complete core catalog:

- penalties with offender, server, infraction, class and length, a live penalty box, and
  players removed by game misconducts and match penalties,
- a derived strength state (5v5, 5v4, 4v4, 5v3, 6v5...) on anchored-clock games,
- goal strength (EV, PP, SH) prefilled from that state and confirmed by the recorder, with
  minors released on a power-play goal,
- power-play and penalty-kill totals, PIM, PPG/PPA/SHG/SHA, and plus/minus,
- team timeouts, icing and offside,
- overtime, a hockey shootout, and a structured result (regulation, overtime or shootout
  win, loss or tie) with the shootout kept out of player and goalie totals.

Not in HKY-3: Timeline edit, remove, restore and recorded-later additions (HKY-4), cloud
(HKY-5), Summary and aggregates (HKY-6), team line defaults (HKY-5C/6C), line changes and
skater TOI (optional module HKY-M3), mercy rules.

---

## 2. Slices

### HKY-3A Penalties, penalty box and strength

Files: `src/lib/hockey/penalties.ts` (new), `events.ts`, `projector.ts`, `stats.ts`,
`captureCommands.ts`, `recentEvents.ts`, `src/components/hockey/HockeyPenaltyDialog.tsx`,
`HockeyPenaltyBox.tsx`.

**Event** `hockey.penalty`, `schemaVersion: 1`, side `tracked | opponent` (the penalized
side):

- `class`: `minor | double_minor | major | misconduct | game_misconduct | match | penalty_shot`,
- `infraction`: an id from a fixed catalog (tripping, hooking, slashing, interference,
  holding, high_sticking, roughing, cross_checking, boarding, charging, elbowing,
  too_many_men, delay_of_game, unsportsmanlike, fighting, abuse_of_officials, other)
  plus `infractionLabel` for `other`,
- `durationMs`: stamped from the rules for the class, with an override allowed,
- `offenderKind`: `player | goalie | bench | staff`,
- `delayed`: boolean, context only,
- `captureCommandId`: the capture unit, shared by every penalty recorded in one dialog
  save, so Undo and Restore remove and bring back all of them together,
- `coincidenceGroupId`: `string | null` (see Capture and coincidence below),
- actors: `offender` (player or goalie), `served_by` (required when the offender cannot
  serve: goalie, bench, staff, or a minor whose offender also sits a misconduct from the
  same capture unit), `drawn_by` (optional, other side).

**Capture and coincidence.** One dialog save records one or more penalties as one capture
unit through a single atomic `applyGameEventAppendsAndMutations` call. Every penalty in
it has the same `captureCommandId`, `occurredAt`, period and clock time.

- Coincidence is never inferred from equal lengths or overlapping times. The recorder
  ticks "Coincidental" in the dialog when the unit holds penalties for both sides, and
  every penalty in the unit then gets `coincidenceGroupId = captureCommandId`. Otherwise
  every penalty keeps `coincidenceGroupId: null`. Two equal minors saved separately are
  therefore always unrelated, even at the same clock time.
- Validation (capture and replay): a non-null group id must equal the event's own
  `captureCommandId`; every event sharing it must have the same group id, period and
  clock time; and the group must hold at least one penalty for each side. Anything
  else is a replay error that quarantines the stream, as other invalid Hockey events do.
- Within a group, strength effects cancel pairwise by class: minor with minor, double
  minor with double minor, major with major (match counts as a major). Leftovers count
  normally. Under `coincidentalMinors: 'play_short'` the one exception is a group of
  exactly one minor per side recorded while both sides are at full strength: both
  minors then count and the teams play 4v4. Every other group substitutes.
- Cancelled penalties still run their box timers and still count as PIM. They never
  count as power-play opportunities and are never released by a power-play goal.
- Minor plus misconduct on one player is one unit with two events for the same
  offender: the minor needs `served_by` (a teammate), and the offender's misconduct
  timer starts when the minor's timer ends. It is not a coincidence group unless the
  other side is in the same unit and the recorder ticks Coincidental.
- Early release: see the `hockey.penalty_release` event below.

**Event** `hockey.penalty_release`, `schemaVersion: 1`, side of the penalized team,
anchored games only:

- payload `captureCommandId`, `penaltyEventId`, `segment` (`1 | 2`; always `1` except for
  a double minor), `reason` (short free text, required),
- validation: the referenced event is an active `hockey.penalty` of the same side whose
  segment has box time and is running or waiting at the release's clock time; a
  segment is released at most once; majors, misconducts, game misconducts and match
  penalties can be released too, since this is a recorder correction, not a rule.
- Effective moment is the release's own period and clock time. The segment ends there,
  and a waiting penalty behind it starts. Replay policy for clock corrections: when a
  later correction makes the segment end naturally before the release's clock time,
  the release is inert and shows a diagnostic note; it never extends a penalty.
- Assessed `durationMs`, PIM and penalty counts never change; only box time served and
  strength do.
- It is its own capture unit, so Undo removes it and the segment runs again. Timeline
  edit and remove come in HKY-4 with the other penalty events.

**Penalty box projection** (`penalties.ts`), anchored games only:

- Each penalty with box time opens a timer when its period's clock runs. Timers run and
  stop with the game clock, carry across a period end, and expire when their time runs
  out. Expiry is derived from the clock, not an event, so a clock correction moves it.
- A side has at most two penalties counting against its strength at once; further ones
  wait (stacked) and start when a slot frees.
- A double minor is two consecutive minor segments.
- Misconducts give the player box time but never change strength; a substitute stays on.
- Game misconducts and match penalties remove the player for the rest of the game:
  capture rejects them as a new actor, and a match penalty also adds 5 minutes of
  strength-affecting time served by a teammate.
- Coincidental penalties follow `penalties.coincidentalMinors`: `substitute` cancels the
  strength effect of equal minors, `play_short` lets both sides play short (4v4).
- `penalty_shot` has no box time; the recorder then records the penalty shot through the
  existing shot flow with `penaltyShot: true`.

**Strength projection** exposes two named counts per side, and every consumer says which
one it reads:

- `baseSkaters`: the period's skaters (`skatersPerSide`, or `overtime.skaters` in
  overtime) adjusted by penalties counting against strength (never below
  `minimumSkaters`). It never includes an extra attacker.
- `skatersOnIce`: `baseSkaters` plus one when that side's net is empty. This is the
  displayed strength (for example `6v5`) and the input to goal-strength prefill.

The empty-net increment is applied in exactly one place, the step from `baseSkaters` to
`skatersOnIce`. The projection exposes the current state and a timeline for review.
Clockless games record penalties, PIM and the box list, but have no timers and no derived
strength (§7 Q1).

**Stats**: `hky_pim`, `hky_pen` (penalties taken), `hky_pend` (drawn); team PIM and
penalties by side.

**UI**:

- A Penalty button in the quick row opens `HockeyPenaltyDialog` (side, offender, class,
  infraction, served by when needed, drawn by, delayed flag). "Add another penalty"
  adds rows to the same save, and "Coincidental" appears once both sides have a row.
- A compact penalty box under the scoreboard shows each side's running and waiting
  penalties with remaining time and the current strength (for example `5v4`). Each
  running or waiting penalty has Release early, which asks for a reason.
- Recent Events labels penalties; Undo already covers new capture units.

### HKY-3B Goal strength, special teams, timeouts, icing and offside

Files: `penalties.ts`, `captureCommands.ts`, `projector.ts`, `stats.ts`,
`HockeyShotDialog.tsx`, `HockeyPlayDialog.tsx`.

- **Goal strength.** `hockey.shot.strength` (frozen in HKY-2B as `ev | pp | sh | null`)
  is now written for goals: the dialog prefills it from the projected state and the
  recorder confirms or changes it. Stored strength wins over re-derivation, so a later
  clock correction never silently relabels a goal. Clockless games ask the recorder
  with EV preselected. HKY-2 goals keep `strength: null` and read as "not recorded".
- **Power-play goal release.** When `penalties.releaseMinorOnPowerPlayGoal` is true, a
  goal confirmed as PP ends the running minor of the short-handed side that has the least
  time left. For a double minor it ends only the segment being served. Majors and
  misconducts are never released.
- **Special teams totals**: PP opportunities (a penalty that gives the other side a
  man advantage), PP goals, PK percentage; `hky_ppg`, `hky_ppa`, `hky_shg`, `hky_sha`.
- **Plus/minus (HKY-2 Q5).** Tracked skaters on the ice get +1 for a goal for and -1 for
  a goal against when the goal is even-strength or short-handed, including empty-net
  goals. Power-play goals do not count. Only goals with a complete on-ice set count;
  the rest are listed as a quality note.
- **Timeouts**: `hockey.timeout`, side `tracked | opponent`, clock paused. No per-game
  limit is enforced; the tracker shows the count per side (§7 Q4).
- **Icing and offside**: `hockey.team_event` with `kind: icing | offside`, side
  `tracked | opponent` (the side called), optional location. Recorded from the Play
  dialog and counted per side (§7 Q5).

### HKY-3C Overtime, shootout and outcomes

Files: `src/lib/hockey/shootout.ts` (new), `projector.ts`, `live.ts`,
`captureProjection.ts`, `HockeyShotDialog.tsx`,
`src/components/hockey/HockeyShootoutPanel.tsx`.

- **Overtime** already exists (HKY-1, HKY-2B sudden death). HKY-3C adds overtime
  strength: `overtime.skaters` sets skaters per side for the overtime period (3v3 in NHL
  regular season), and penalties in 3v3 add a skater to the other side instead of
  removing one, as the NHL does (§7 Q3), up to `skatersPerSide` (4v3, then 5v3).
- **On-ice validation follows the event-time strength.** Today `checkHockeyOnIce`
  (`captureProjection.ts`) caps a complete set at the period's skaters, plus one for an
  empty net, so a complete 4-skater set in a 3v3 overtime is rejected. HKY-3C changes it
  to take the side's `baseSkaters` at the event's clock time from the strength
  projection, never `skatersOnIce`, and to add the empty-net attacker once from the
  set's own goalie field, as today:
  - anchored games: minimum `min(minimumSkaters, baseSkaters)`, maximum `baseSkaters`,
    plus one when the set's goalie is the empty net,
  - clockless games (no derived strength): the period's skaters as today, widened in
    overtime to `skatersPerSide`, because penalties can only add overtime skaters, plus
    one for an empty net in the same way,
  - capture and replay use the same function, and the on-ice picker in the shot dialog
    reads the same limit, so the UI never offers a set that replay rejects.
  Pre-HKY-3 games have no penalties, so the allowed count equals today's period cap and
  every existing fixture validates unchanged.
- **Shootout** when the rules have one, the game is tied after overtime, and ties are
  not allowed:
  - `hockey.shootout_started` (first shooting side), `hockey.shootout_attempt`
    (side, shooter participant or opponent label, goalie, outcome `goal | saved | missed`),
  - rounds from `shootout.rounds`, then sudden death, with an early decision when one side
    cannot catch up,
  - shooter eligibility from `shootout.repeatShooters`,
  - attempts never count as shots, goals or saves in skater or goalie totals.
- **Outcome**: the projection exposes `result` (`win | loss | tie`) and `decidedIn`
  (`regulation | overtime | shootout`), plus the display score `3-2 (SO)` where the
  shootout winner gets one goal in the final score only. Suspended and abandoned games
  keep no result.
- **Goalie of record**: the goalie in net for the tracked side when the deciding goal was
  scored (or the goalie who played the shootout), exposed for HKY-6 W/L/OTL.
- The HKY-1 projector comment ("a tie that the rules do not allow still needs a shootout")
  is resolved: `canEndWithoutReason` becomes true once the shootout decides.

---

## 3. Data and compatibility rules

- No migration and no cloud route; event hockey stays local-only.
- No setup change. Rules v1 already has `penalties` and `shootout`; no new rules field is
  needed (§7 Q4 keeps timeouts unlimited).
- New event types only; existing payloads keep their shape. `hockey.shot.strength` was
  frozen in HKY-2B, so writing it needs no schema version 2.
- HKY-1 and HKY-2 games load and replay unchanged, with the same fingerprint. Literal
  pre-HKY-3 fixtures prove it, as in HKY-2.
- Every accepted command still round-trips through `HYDRATE_STATE`.
- Legacy hockey stat-grid games, Soccer, Basketball and Baseball are untouched.

---

## 4. Cross-sport items touched

| Id | In HKY-3 |
|---|---|
| XS-6 | Not extracted. Penalty timers read the existing Hockey clock projection |
| XS-7 | Not extracted (§7 Q6). The hockey shootout follows the Soccer shootout's shape but stays in `src/lib/hockey/shootout.ts` |

---

## 5. Regression

`docs/REGRESSION_HKY_3_PENALTIES_AND_OUTCOMES.md` when implementation lands:

- a minor expiring on the clock, a power-play goal releasing a minor, a major not
  released, a double minor released after its first half, stacked penalties (5v3 and the
  third waiting), a misconduct with a substitute, a game misconduct removing the player,
- coincidence: a grouped minor pair under `substitute` and under `play_short`, the same
  two equal minors saved separately (unrelated, 5v4 then 4v5), a group of two minors
  against one (one leftover), a group with only one side rejected, a group id that
  differs from its capture id rejected, minor plus misconduct served by a teammate with
  the misconduct starting after the minor; each case round-trips through
  `HYDRATE_STATE`, and one Undo removes and Restore brings back the whole unit,
- manual release: a released minor ends early with PIM unchanged; a released
  double-minor segment 2; the release surviving hydration; a clock correction making the
  release inert with its note; Undo of the release letting the segment run again,
- overtime on-ice: complete tracked 4v3 and 5v3 overtime goal sets accepted at capture
  and replay, hydrated, and scored in plus/minus under the plus/minus rule; a 4-skater
  set rejected in 3v3 with no penalty; the shot dialog offering the same limits,
- empty net counted once: a regulation empty-net set of 6 accepted and 7 rejected; a
  penalty-free 3v3 overtime empty-net set of 4 accepted and 5 rejected; a literal
  pre-HKY-3 empty-net goal fixture replaying unchanged,
- goal strength prefilled for EV, PP, SH and a pulled-goalie 6v5, and changed by the
  recorder; a clock correction not relabelling stored strength,
- plus/minus with complete, partial and missing on-ice sets,
- clockless games recording penalties without timers and asking for goal strength,
- NHL regular season to a shootout win, NHL playoffs to a second overtime, youth
  ending in a tie,
- HKY-1 and HKY-2 games still load; park and resume with Soccer and Basketball games,
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

---

## 6. Risks

- Penalty rules have many edge cases. The engine covers the standard NHL/USA Hockey
  cases listed in §5; anything rarer is corrected by the recorder through goal strength
  and, from HKY-4, Timeline edits. The derived strength is only ever a prefill.
- Screen space on a phone: the penalty box must stay one or two lines, and the quick row
  gains one button (Penalty). Timeout, icing and offside go in the Play dialog.

---

## 7. Owner Questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | Clockless games: record penalties without timers or derived strength, and ask for goal strength each time? | Yes |
| Q2 | Penalty expiry: derived from the game clock (no event, moves with clock corrections), rather than the recorder tapping "penalty over"? | Derived, with a Release early action in the penalty box for rare cases, recorded as a `hockey.penalty_release` event (HKY-3A) |
| Q3 | 3v3 overtime: penalties add a skater to the other side (NHL style) rather than removing one? | Yes, when `overtime.skaters` is 3 |
| Q4 | Timeouts: record without enforcing a per-game limit? | Yes; show the count, no rules field |
| Q5 | Icing and offside: counts per side from the Play dialog, location optional? | Yes |
| Q6 | Shootout: a hockey-specific module following Soccer's shape, rather than extracting a shared core now? | Hockey-specific; extract only if another sport needs it |
| Q7 | Infractions: a fixed catalog plus Other with a free label? | Yes |
| Q8 | Plus/minus: count EV, SH and EN goals, skip PP goals and goals without a complete on-ice set? | Yes, with a quality note for skipped goals |

---

## 8. Delivery record

### HKY-3A (implemented)

- `penalties.ts` owns the class and infraction catalogs, rules lengths, segments, game
  time (clock played in earlier periods plus the current elapsed) and the box simulation.
  The box is never stored: `hockeyPenaltyBoxAt` replays penalties and releases up to a
  game time, so pausing, setting the clock and period ends move every timer. Penalties or
  releases later than the requested time (only after the clock was set back) count as
  happening at it.
- `hockey.penalty` and `hockey.penalty_release` are sided capture events. Replay checks
  a unit when it closes: a coincidence group needs both sides, and a tracked minor whose
  offender also has a misconduct in the unit needs a server. Actor checks cover the
  offender kind, a skater server other than the offender, and the other side's drawer.
- Strength: `hockeyStrengthState` gives `baseSkaters` and `skatersOnIce` per side; the
  floor is `min(minimumSkaters, period skaters)` until HKY-3C adds overtime skaters.
- Removal: game misconducts and match penalties add the tracked offender to
  `removedParticipantIds`. Replay rejects them as any later actor, in an on-ice set, or as
  a goalie going in; the dialogs hide them. Removing the goalie in net is refused until
  another goalie goes in.
- Stats: `hky_pim` (minutes), `hky_pen`, `hky_pend`, and team `penaltyTotals`.
- UI: a Penalty button in the quick row opens `HockeyPenaltyDialog` (rows saved as one
  unit, Coincidental once both sides have a row); `HockeyPenaltyBox` sits under the
  scoreboard with the strength, each running or waiting segment and Release.
- Deviations: an opponent server stays optional, because opponent players are labels;
  clockless games list this period's penalties under the scoreboard instead of a box.
- Tests: `penalties.test.ts` (30 cases). Record:
  [REGRESSION_HKY_3_PENALTIES_AND_OUTCOMES.md](REGRESSION_HKY_3_PENALTIES_AND_OUTCOMES.md).

