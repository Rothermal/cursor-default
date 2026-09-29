# Plan: HKY-3 Penalties, Strength and Outcomes

Execution plan for the third hockey phase defined in
[HKY-0](PLAN_HKY_0_HOCKEY_PRODUCT_MODEL.md) §12. It builds on HKY-1 (rules, setup,
lifecycle and clock) and [HKY-2](PLAN_HKY_2_RINK_AND_CORE_CAPTURE.md) (rink, shots,
goalies, faceoffs, plays, Recent Events, and the owner tracker behind a default-off toggle).

Status: draft for owner review. Nothing in HKY-3 is built until this plan is approved.
§7 lists the questions that need an answer; each has a recommendation.

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
`captureCommands.ts`, `src/components/hockey/HockeyPenaltyDialog.tsx`,
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
- `captureCommandId`,
- actors: `offender` (player or goalie), `served_by` (required when the offender cannot
  serve: goalie, bench, staff, or a double penalty where the offender also sits a
  misconduct), `drawn_by` (optional, other side).

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

**Strength projection**: skaters per side = `skatersPerSide` minus penalties counting
against strength (never below `minimumSkaters`), plus one extra attacker when that side's
goalie is pulled. The projection exposes the current state and a timeline for review.
Clockless games record penalties, PIM and the box list, but have no timers and no derived
strength (§7 Q1).

**Stats**: `hky_pim`, `hky_pen` (penalties taken), `hky_pend` (drawn); team PIM and
penalties by side.

**UI**:

- A Penalty button in the quick row opens `HockeyPenaltyDialog` (side, offender, class,
  infraction, served by when needed, drawn by, delayed flag).
- A compact penalty box under the scoreboard shows each side's running and waiting
  penalties with remaining time and the current strength (for example `5v4`).
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
`src/components/hockey/HockeyShootoutPanel.tsx`.

- **Overtime** already exists (HKY-1, HKY-2B sudden death). HKY-3C adds overtime
  strength: `overtime.skaters` sets skaters per side for the overtime period (3v3 in NHL
  regular season), and penalties in 3v3 add a skater to the other side instead of
  removing one, as the NHL does (§7 Q3).
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
  third waiting), coincidental minors under both rules, a misconduct with a substitute,
  a game misconduct removing the player,
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
| Q2 | Penalty expiry: derived from the game clock (no event, moves with clock corrections), rather than the recorder tapping "penalty over"? | Derived, with a Release early action in the penalty box for rare cases |
| Q3 | 3v3 overtime: penalties add a skater to the other side (NHL style) rather than removing one? | Yes, when `overtime.skaters` is 3 |
| Q4 | Timeouts: record without enforcing a per-game limit? | Yes; show the count, no rules field |
| Q5 | Icing and offside: counts per side from the Play dialog, location optional? | Yes |
| Q6 | Shootout: a hockey-specific module following Soccer's shape, rather than extracting a shared core now? | Hockey-specific; extract only if another sport needs it |
| Q7 | Infractions: a fixed catalog plus Other with a free label? | Yes |
| Q8 | Plus/minus: count EV, SH and EN goals, skip PP goals and goals without a complete on-ice set? | Yes, with a quality note for skipped goals |
