# Soccer Restarts Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Use
> subagent-driven development or execute inline with review checkpoints.
> Steps use checkbox syntax. Do not implement from
> `PLAN_SOC_FIELD_TEST_BACKLOG.md` — this file is the execution plan for
> `S17` and `S20`.

**Goal:** Make corner, throw-in, and goal-kick capture a short, obvious
Field-tab restart sheet, with optional taker and left/right where it
matters, without adding a second event type.

**Architecture:** Keep one `soccer.team_event`. Widen `kind`, add optional
`restartSide` and a `taker` actor, project team totals, and replace Quick
Team with a Restart sheet. Offside stays on that sheet so it does not
disappear. Foul free kicks stay on `soccer.foul`.

**Tech Stack:** Existing soccer event engine (`src/lib/soccer/`), Field
tracker (`SoccerGameTracker`, `SoccerIncidentCaptureDialog`), Timeline /
Summary review, Vitest.

## Global Constraints

- Do not add a new event type or dual-write `game_stats`.
- Existing parked `kind: 'corner' | 'offside'` events must keep projecting.
- `teamSide` remains the awarded/restarting side (same as today’s corner).
- Optional taker: tracked participant, team, or opponent label. Never a
  tracked `participantId` on an opponent restart (`S13`).
- Left/right is required for corner and throw-in in the live sheet, stored
  as `restartSide`. Goal kick has no left/right. Historical corners without
  `restartSide` stay valid; derive display side from location when possible.
- Offside is not a restart. It stays a `team_event` kind on the same sheet
  so Quick Team can go away.
- Optional taker is stored for Timeline/Field labels. Do not add
  per-participant restart counters in this plan. Side totals increment for
  every restart regardless of taker. Per-player restart counts wait for
  later `soc_*` catalog ids.
- Do not require a restart on every dead ball. Skip/unknown location is
  allowed.
- Do not implement `S7` shot-source auto-link in this plan. Existing corner
  → `corner_sequence` source candidates stay as they are.
- Do not add throw-in / goal-kick ids to the first-release `soc_*` player
  catalog. Team comparison and Timeline/Field labels are enough.
- Soccer stays event-authoritative. No basketball files.

---

## 1. Why

First matches asked for corner side + taker and then throw-ins. Corner
already exists. It is buried behind Quick **Team** → Corner/Offside, Left
/Right only set a pin, and save drops actors. Throw-in and goal kick do
not exist. Summary already has a Restarts filter; the live button still
says Team.

This plan is the `S17` / `S20` execution slice.

## 2. Settled decisions

1. One `soccer.team_event` schema. New kinds: `throw_in`, `goal_kick`.
2. One Field-tab **Restart** control replaces **Team**.
3. The sheet kinds are Corner, Throw-in, Goal kick, Offside.
4. Corner and throw-in collect Left / Right as `payload.restartSide`.
5. Optional taker on corner, throw-in, and goal kick. Role id is `taker`.
6. Offside keeps optional `offside_player`. It does not get `taker`.
7. Default opponent restarts to unknown/label or team, never the selected
   tracked chip.
8. Timeline / Field / Summary labels use kind + side + taker, for example
   `Tracked right throw-in · #7`.
9. Side totals gain `throwIns` and `goalKicks`. Corners and offsides stay.
10. Goal kicks are in scope. Routine free kicks are not; they stay on the
    foul restart field.

## 3. Data

### Payload

```ts
export type SoccerTeamEventKind = 'corner' | 'offside' | 'throw_in' | 'goal_kick'
export type SoccerRestartSide = 'left' | 'right'

export interface SoccerTeamEventPayload extends JsonObject {
  kind: SoccerTeamEventKind
  restartSide?: SoccerRestartSide | null
}
```

- `restartSide` is required for new live corner and throw-in saves.
- `restartSide` must be null/absent for offside and goal kick.
- Historical corners with no `restartSide` remain valid.

### Actors

| Kind | Allowed actors | Required |
|---|---|---|
| `corner` | `taker` | no |
| `throw_in` | `taker` | no |
| `goal_kick` | `taker` | no |
| `offside` | `offside_player` | no |

Reject `offside_player` on restart kinds. Reject `taker` on offside.
Validate opponent takers with the same rule as `validateIncidentActor`
(`S13`): no tracked `participantId`.

### Projection

`SoccerSideAttackingTotals` (`types.ts`) adds:

```ts
throwIns: number
goalKicks: number
```

Initialize both to `0` in `emptySideTotals` (`state.ts`; module-private,
typed as `SoccerMatchProjection['sideTotals']['tracked']`).

Increment `teamSide` totals by kind. Do not add per-participant restart
counters and do not add `soc_corner` / `soc_throw_in` / `soc_gk_kick` to
`aggregateStats.ts`. First-slice readers are Summary team comparison
(side totals) and Timeline/Field labels (kind + side + optional taker).
Per-player restart counts wait for a later catalog-id slice.

### Location helpers

Keep `cornerLocation(direction, side)`. Add `throwInLocation` near the
touchline for the awarded side’s left/right. Goal kick can offer a
shortcut on the defending goal area; otherwise location unknown is fine.

## 4. UI

Replace the Field quick row **Team** with **Restart**.

Sheet:

```text
Kind: Corner | Throw-in | Goal kick | Offside
Side: Tracked | Opponent   (already the capture side; confirm on the sheet)
Left | Right               (corner and throw-in only)
Taker: Player | Team | Unknown   (optional; hidden for offside)
Offside player             (offside only, existing control)
Location shortcuts + Set / Clear
Save
```

Timeline Add Event **Team Event** opens the same sheet. Correction of an
old corner must be able to add `restartSide` and a taker without changing
`eventType`.

Live defaults:

- Kind: Corner
- `teamSide`: current Field capture side
- `restartSide`: unset until the recorder taps Left/Right
- Taker: none / team, not the tracked player chip when side is opponent

## 5. Files

**Domain**

- `src/lib/soccer/types.ts` — kinds, `restartSide`, `SoccerSideAttackingTotals`
- `src/lib/soccer/events.ts` — `validateTeamEvent` and the `soccer.team_event`
  actor allow-list. Today that list is only `offside_player`
  (`events.ts:152`); every other role, including a future `taker`, is
  rejected at the registry. Widening the list is required.
- `src/lib/soccer/soc4.ts` — `applyTeamEvent`. Today a corner then rejects
  the one permitted role (`offside_player`). Keep per-kind rules: `taker`
  only on restart kinds, `offside_player` only on offside.
- `src/lib/soccer/state.ts` — `emptySideTotals` (module-private)
- `src/lib/soccer/soc4.test.ts` — new kinds, historical corner, opponent taker reject

**Live / review**

- `src/pages/SoccerGameTracker.tsx` — Restart button label
- `src/components/soccer/SoccerIncidentCaptureDialog.tsx` — sheet
- `src/components/soccer/SoccerTimeline.tsx` — labels, Add Event
- `src/lib/soccer/summary.ts` — team comparison rows
- `src/lib/soccer/summaryTimeline.ts` / `summaryField.ts` — labels, marker kinds
- `src/components/soccer/SoccerField.tsx` — throw-in / goal-kick glyphs if needed

**Docs**

- `docs/PLAN_SOC_FIELD_TEST_BACKLOG.md` — mark `S17` / `S20` planned
- `docs/REGRESSION_TESTING.md` — add a short restart capture script
- `docs/AGENT_CODEBASE_OVERVIEW.md` — point at this plan

## 6. Delivery slices

```text
R1  Domain: kinds, restartSide, taker, projection, tests
R2  Live Restart sheet and Field-tab control
R3  Timeline / Summary / Field labels and regression
```

Each slice is its own PR if needed. R1 can merge without UI. R2 must not
ship if opponent takers can still attach a tracked player. R3 is labels
only — no new cloud RPCs.

## 7. Tasks

### Task 1: Widen the team-event domain

**Files:** `types.ts`, `events.ts`, `state.ts`, `soc4.ts`, `soc4.test.ts`

- [ ] **Step 1:** Add failing tests in `soc4.test.ts`:
  - a `throw_in` with `restartSide: 'left'` and no actor increments
    `sideTotals.tracked.throwIns`
  - a `goal_kick` increments `goalKicks`
  - a tracked `taker` on a tracked throw-in is accepted
  - a tracked `participantId` taker on an opponent throw-in is rejected
  - a historical `{ kind: 'corner' }` with no `restartSide` still
    increments `corners`
  - a corner with `offside_player` still fails schema/projection
- [ ] **Step 2:** Run `pnpm exec vitest run src/lib/soccer/soc4.test.ts`
  and confirm the new cases fail.
- [ ] **Step 3:** Implement kinds, validation, and `applyTeamEvent`.
  Widen the `soccer.team_event` allow-list in `events.ts` so `taker` is
  permitted, then keep per-kind actor rules in `applyTeamEvent`. Add
  `throwIns` / `goalKicks` to `SoccerSideAttackingTotals` and initialize
  them to `0` in `emptySideTotals`. Do not add participant restart
  counters.
- [ ] **Step 4:** Re-run the soc4 tests until they pass.
- [ ] **Step 5:** Commit `feat(soccer): add throw-in and goal-kick team events`

### Task 2: Restart capture sheet

**Files:** `SoccerIncidentCaptureDialog.tsx`, `SoccerGameTracker.tsx`

- [ ] **Step 1:** Add a focused helper test if one exists for incident
  drafts; otherwise cover through `soc4` + a small capture-label unit if
  needed. Do not add a React RTL suite unless the repo already has one
  for this dialog.
- [ ] **Step 2:** Replace Quick **Team** with **Restart**. Open the same
  `team_event` draft.
- [ ] **Step 3:** Sheet shows four kinds. Left/Right required before save
  for corner and throw-in. Taker editor uses opponent-safe attribution
  (`S13`). Saving a corner/throw-in/goal-kick writes `taker` when set and
  never strips actors for those kinds.
- [ ] **Step 4:** Offside path stays the current optional offside player
  control. It does not show Left/Right or taker.
- [ ] **Step 5:** Manual check: opponent Restart → Throw-in cannot pick a
  tracked roster player as taker.
- [ ] **Step 6:** Commit `feat(soccer): add Field restart sheet`

### Task 3: Review labels and team comparison

**Files:** `SoccerTimeline.tsx`, `summary.ts`, `summary.test.ts`,
`summaryTimeline.ts`, `summaryField.ts`, `SoccerField.tsx`

- [ ] **Step 1:** Failing summary test: a throw-in and a goal kick appear
  in team comparison when non-zero; zeros stay hidden like other rows.
- [ ] **Step 2:** Timeline `eventDetail` / marker labels include kind,
  `restartSide`, and taker label.
- [ ] **Step 3:** Field review treats throw-in and goal kick as restart
  family markers (same filter as today’s team events).
- [ ] **Step 4:** Run `pnpm exec vitest run src/lib/soccer/summary.test.ts src/lib/soccer/soc4.test.ts src/components/soccer/SoccerField.test.ts`
- [ ] **Step 5:** Commit `feat(soccer): show restart labels and team totals`

### Task 4: Docs and backlog

**Files:** this plan, field-test backlog, `REGRESSION_TESTING.md`, overview

- [ ] **Step 1:** Mark `S17` and `S20` implemented only after R1–R3 land.
  Until then they stay **planned** and link here.
- [ ] **Step 2:** Add a manual script: Restart → Corner left + taker;
  Restart → Throw-in right unknown opponent; Restart → Goal kick; flip
  field and confirm labels still read correctly (`S18` is separate).
- [ ] **Step 3:** Commit `docs: record soccer restart capture`

## 8. Acceptance

- Field tab shows Restart, not Team.
- A corner can be saved with left/right and an optional taker in two or
  three taps after opening the sheet.
- A throw-in and a goal kick can be saved the same way.
- Opponent restarts cannot store a tracked participant as taker.
- Old corner/offside events still project.
- Summary team comparison can show throw-ins and goal kicks.
- Timeline says what the restart was, which side, and who took it when
  known.
- `pnpm test` / `pnpm lint` / `pnpm build` stay green.
- No new `soc_*` aggregate ids in this plan.

## 9. Out of scope

- `S7` auto-linking the next shot to the last restart
- `S18` upright cluster counts
- Goal-mouth placement (`S16`) or header (`S15`)
- Free-kick events separate from fouls
- Kick-ins / other competition restarts
- Season player restart leaderboards
- Formation lineup (`S19`)

## 10. Backlog links

- `S17` Make the existing corner event obvious
- `S20` Throw-ins
- Related later: `S7` last restart as next shot source
