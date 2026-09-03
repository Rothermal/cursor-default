# Soccer Restarts Implementation Plan

Status: implementation in progress. R1 domain readers are implemented; R2-R4
remain. Corner, throw-in, and goal-kick capture are in scope; tap-to-place and
omitted-taker behavior are resolved.

> **For agentic workers:** Implement this plan task-by-task. Use review
> checkpoints between delivery slices. Do not implement directly from
> `PLAN_SOC_FIELD_TEST_BACKLOG.md`; this file is the execution plan for `S17`
> and `S20`.

**Goal:** Make corner, throw-in, and goal-kick capture a short, obvious
tap-to-place Field workflow with an optional taker, without adding a second
event type.

**Architecture:** Keep one `soccer.team_event`. Widen `kind`, add an optional
`taker` actor, project team totals, and replace Quick Team with a temporary
one-shot Restart field mode. `GameEvent.location` is the only placement source
of truth. Offside remains available in the confirmation sheet. Foul free kicks
stay on `soccer.foul`.

**Tech Stack:** Existing soccer event engine (`src/lib/soccer/`), Field
tracker (`SoccerGameTracker`, `SoccerField`,
`SoccerIncidentCaptureDialog`), Timeline/Summary review, Vitest.

## Global Constraints

- Do not add a new event type or dual-write `game_stats`.
- Existing parked `kind: 'corner' | 'offside'` events must keep projecting.
- `teamSide` remains the awarded/restarting side.
- Optional taker: tracked participant or opponent label. An omitted taker
  stores no actor; `teamSide` still credits the team. Never store a tracked
  `participantId` on an opponent restart (`S13`).
- Live corner, throw-in, and goal-kick capture starts with a tap on the main
  field. The existing `soccerFieldLocation` conversion stores canonical field
  coordinates. Historical and correction flows may retain an unknown location.
- Field flip remains display-only. It changes where the recorder taps, not the
  canonical coordinate or attacking direction stored on the event.
- Offside is not a restart, but remains a `team_event` kind in the same compact
  confirmation sheet so Quick Team can go away.
- Optional taker is for review labels only. Do not add per-participant restart
  counters or first-release `soc_*` restart catalog ids in this plan.
- Side totals increment for every event regardless of whether a taker or
  location is known.
- Do not require a restart event for every dead ball.
- Do not implement `S7` shot-source auto-link. Existing corner-to-
  `corner_sequence` source candidates remain unchanged.
- Soccer stays event-authoritative. Do not modify Basketball behavior.

### Plan readiness

Product decisions are complete. An omitted taker stores no actor rather than a
redundant Team actor. Review surfaces label that state `Taker not recorded`;
team totals continue to derive from `teamSide`.

The additive event change keeps Soccer event schema version 1 so historical
events remain readable. Old deployed readers still do not understand new
kinds. Merge and deploy domain plus review-reader support before any live or
historical UI can write `throw_in`, `goal_kick`, or `taker`. Cached/PWA clients
are part of this compatibility rule. If writers deploy first, a stale reader
does not merely hide the unknown event: registry diagnostics make its stream
inspection incomplete, which blocks projection-dependent review and
finalization and can resemble the `S14` failure. R1/R2 deployment and cached
client validation are therefore hard gates for R3, not advisory sequencing.

---

## 1. Why

First matches asked for corner placement plus taker and then throw-ins. Corner
already exists, but it is buried behind Quick **Team** -> Corner/Offside. Its
Left/Right buttons set a field pin, and save currently drops actors. Throw-in
and goal kick do not exist. Summary already has a Restarts filter while the live
button still says Team.

This plan is the `S17` / `S20` execution slice.

## 2. Settled decisions

1. Keep one `soccer.team_event` schema. Add `throw_in` and `goal_kick` kinds.
2. Replace the Field quick-row **Team** control with **Restart**.
3. Restart arms a temporary one-shot field mode. It does not replace or persist
   over the recorder's normal Shot/Defense/Foul mode.
4. The next field tap opens a compact confirmation sheet with Corner,
   Throw-in, Goal kick, and Offside. A strong geometric match may preselect a
   kind, but the recorder can correct it before Save.
5. `GameEvent.location` is authoritative. Do not introduce a second
   categorical side/placement payload.
6. Corner, throw-in, and goal kick allow optional actor role `taker`.
7. Offside keeps optional `offside_player` and does not allow `taker`.
8. Opponent restarts allow an opponent label or no taker, never the selected
   tracked player chip. Omitted takers store no actor on either side.
9. Timeline/Field/Summary labels use kind, awarded side, and optional taker,
   for example `Tracked throw-in - #7`. Field position shows which corner or
   touchline location was used.
10. Side totals gain `throwIns` and `goalKicks`; Corners and Offsides remain.
11. Routine free kicks remain represented by the foul event's restart field.

## 3. Data

### Payload

```ts
export type SoccerTeamEventKind =
  | 'corner'
  | 'offside'
  | 'throw_in'
  | 'goal_kick'

export interface SoccerTeamEventPayload extends JsonObject {
  kind: SoccerTeamEventKind
}
```

No placement field is added to the payload. Located events use the existing
top-level `GameEvent.location`; historical events with no location remain valid.

### Actors

| Kind | Allowed actors | Required |
|---|---|---|
| `corner` | `taker` | no |
| `throw_in` | `taker` | no |
| `goal_kick` | `taker` | no |
| `offside` | `offside_player` | no |

Reject `offside_player` on restart kinds and reject `taker` on offside.
Validate opponent takers with the same rule as `validateIncidentActor` (`S13`):
no tracked `participantId`.

### Projection

`SoccerSideAttackingTotals` (`types.ts`) adds:

```ts
throwIns: number
goalKicks: number
```

Initialize both to `0` in `emptySideTotals` (`state.ts`). Increment the
`teamSide` total by kind. Do not add per-participant restart counters or
`soc_corner` / `soc_throw_in` / `soc_gk_kick` to `aggregateStats.ts`.
First-slice readers are Summary team comparison and Timeline/Field labels.

### Location and suggestion helpers

Reuse `soccerFieldLocation(displayX, displayY, flipped, captureDirection)` so a
tap always becomes a canonical location before the draft opens. Add a pure,
tested helper that suggests a restart kind from the canonical location plus
`teamSide` and tracked attacking direction:

- near the awarded side's attacking corner: Corner
- on either touchline outside the corner threshold: Throw-in
- in the awarded side's defending goal-area threshold: Goal kick
- elsewhere: no forced suggestion; show the compact kind chooser

The helper suggests only. Save uses the visible selected kind. Flipping the
field must not change the canonical result for the same physical pitch point.
Historical Add/Edit may set, change, clear, or leave location unknown through
the existing location editor.

## 4. UI

Replace Field quick-row **Team** with **Restart**.

Live flow:

1. Tap **Restart**. The main pitch enters a visibly active, temporary one-shot
   restart mode.
2. Tap the restart location on the pitch.
3. Open a compact confirmation sheet:

```text
Kind: Corner | Throw-in | Goal kick | Offside
Side: Tracked | Opponent   (current capture side; confirmable)
Taker: Player | Label | Not recorded            (restart kinds only)
Offside player             (offside only, existing control)
Location: field thumbnail / Change / Clear
Save
```

4. Save or Cancel returns to the prior Shot/Defense/Foul mode. Successful Save
   does not leave Restart armed.

The field interaction needs an accessible active-state label and live status
announcement so it is clear that the next pitch tap records a restart rather
than the normal capture mode. Timeline Add Event **Team Event** opens the same
sheet without requiring an initial field tap; location stays optional there.
Correction of an old corner can add a taker or location without changing its
`eventType`.

Live defaults:

- Kind: suggestion from the tapped location, otherwise Corner
- `teamSide`: current Field capture side
- Location: tapped canonical field coordinate
- Taker: none (`Taker not recorded`); do not write a Team actor

## 5. Files

**Domain**

- `src/lib/soccer/types.ts` - kinds and `SoccerSideAttackingTotals`
- `src/lib/soccer/events.ts` - `validateTeamEvent` and the
  `soccer.team_event` actor gates. Today the allow-list accepts only
  `offside_player`, while `validTeamEventActors` independently requires every
  non-offside team event to have zero actors. Replace both gates with explicit
  per-kind role/cardinality validation: restart kinds allow at most one
  `taker`; Offside allows at most one `offside_player`; cross-kind roles fail
  registry inspection
- `src/lib/soccer/soc4.ts` - `applyTeamEvent` owns contextual actor validity
  after schema inspection (including opponent/tracked participant safety) and
  retains defensive fail-closed per-kind role checks
- `src/lib/soccer/state.ts` - `emptySideTotals`
- `src/lib/soccer/field.ts` - pure location-to-kind suggestion helper
- `src/lib/soccer/soc4.test.ts`, `field.test.ts` - compatibility, projection,
  attribution, and geometry tests

**Live / review**

- `src/pages/SoccerGameTracker.tsx` - one-shot Restart state and field routing
- `src/components/soccer/SoccerIncidentCaptureDialog.tsx` - confirmation sheet
- `src/components/soccer/SoccerTimeline.tsx` - labels and Add Event
- `src/lib/soccer/summary.ts` - team comparison rows
- `src/lib/soccer/summaryTimeline.ts`, `summaryField.ts` - labels and marker kinds
- `src/components/soccer/SoccerField.tsx` - active mode and marker glyphs if needed

**Docs**

- `docs/PLAN_SOC_FIELD_TEST_BACKLOG.md` - keep `S17` / `S20` linked here
- `docs/REGRESSION_TESTING.md` - add a restart capture script
- `docs/AGENT_CODEBASE_OVERVIEW.md` - plan status

## 6. Delivery slices

```text
R1  Domain readers: kinds, taker, totals, suggestion helper, compatibility tests [implemented]
R2  Review readers: Timeline / Summary / Field labels and team comparison
R3  Writers: one-shot live capture plus historical Add/Edit
R4  Regression docs and backlog status
```

Each slice may be its own PR. R1 and R2 may merge without capture UI. R3 must
not merge until the deployed reader path accepts every event it can write, and
must not ship if opponent takers can attach a tracked player. No SQL migration
is expected because cloud event transport stores validated envelopes and JSON
payloads. Capability and live Supabase checks remain part of exit regression.

## 7. Tasks

### Task 1: Widen team-event readers

**Files:** `types.ts`, `events.ts`, `state.ts`, `soc4.ts`, `field.ts`, tests

- [x] Add failing tests:
  - located `throw_in` with no actor increments `sideTotals.tracked.throwIns`
  - located `goal_kick` increments `goalKicks`
  - registry and projection accept one tracked `taker` on a tracked throw-in
  - registry accepts the `taker` shape but projection rejects a tracked
    `participantId` taker on an opponent throw-in
  - historical unlocated `{ kind: 'corner' }` still increments `corners`
  - registry rejects a corner carrying `offside_player`
  - registry rejects an offside carrying `taker`
  - registry rejects duplicate or multiple actor roles for each kind
  - kind suggestions cover attacking corners, touchlines, defending goal area,
    ambiguous interior points, both attacking directions, and flipped display
- [x] Confirm new tests fail, then implement kinds, both registry actor gates,
  defensive projection validation, totals, and the pure suggestion helper.
- [x] Run focused Soccer domain/field tests.
- [x] Commit `feat(soccer): add restart team events`.

R1 keeps event schema version 1 and accepts historical located or unlocated
team events. Restart kinds permit at most one `taker`; Offside permits at most
one `offside_player`; projection retains the contextual opponent/tracked
identity gate. Suggestions use canonical coordinates with an eight-percent
end/touchline threshold and the center thirty-percent of the defending end as
the goal-area band. They are defaults only and never alter the saved location.
The Field marker reader recognizes both new kinds with the existing generic
restart glyph so reader deployment can precede R2 presentation work.

### Task 2: Add review readers

**Files:** `SoccerTimeline.tsx`, `summary.ts`, `summaryTimeline.ts`,
`summaryField.ts`, `SoccerField.tsx`, tests

- [ ] Add a failing Summary test: non-zero throw-ins and goal kicks appear in
  team comparison; zero rows remain hidden.
- [ ] Timeline and marker labels include kind, awarded side, and taker label.
  Location remains visible spatially rather than duplicated as a side label.
- [ ] Field review treats new kinds as restart-family markers.
- [ ] Verify historical unlocated corners remain readable.
- [ ] Run focused Summary, SOC-4, and Field tests.
- [ ] Commit `feat(soccer): show restart labels and team totals`.

### Task 3: Add restart writers

**Files:** `SoccerIncidentCaptureDialog.tsx`, `SoccerGameTracker.tsx`, focused tests

- [ ] Replace Quick **Team** with **Restart** and add temporary one-shot state;
  do not persist Restart as a capture preference.
- [ ] Route the next main-field tap through `soccerFieldLocation`, suggest a
  kind, and open the shared confirmation sheet.
- [ ] Allow the visible kind to be corrected before Save. Taker editing must
  use opponent-safe attribution (`S13`) and Save must preserve valid actors.
- [ ] Keep the Offside path and existing optional `offside_player` behavior.
- [ ] Save/Cancel restores the prior capture mode and never leaves Restart
  armed. Changing capture side or leaving the Field tab also cancels it.
- [ ] Keep historical Add/Edit location optional and route it through the same
  validated command path.
- [ ] Remove the live Left/Right corner buttons and their module-private
  `cornerLocation` helper. Historical Add/Edit retains the generic Set/Clear
  field editor and does not add a replacement corner shortcut.
- [ ] Manually verify an opponent throw-in cannot select a tracked roster
  participant as taker.
- [ ] Commit `feat(soccer): add tap-to-place restart capture`.

### Task 4: Close docs and regression

**Files:** this plan, field-test backlog, `REGRESSION_TESTING.md`, overview

- [ ] Mark `S17` and `S20` implemented only after R1-R4 land.
- [ ] Add a manual script:
  - Restart -> tap an attacking corner -> confirm Corner + taker
  - Restart -> tap a touchline -> confirm opponent Throw-in without taker
  - Restart -> tap the defending goal area -> confirm Goal kick
  - flip the field and repeat equivalent taps; stored/reviewed positions remain
    canonical and labels remain correct
- [ ] Record capability/live Supabase evidence and cached-reader compatibility.
- [ ] Commit `docs: record soccer restart capture`.

## 8. Acceptance

- Field tab shows Restart instead of Team.
- Restart is a temporary one-shot field mode and never overwrites the normal
  Shot/Defense/Foul preference.
- A corner, throw-in, or goal kick begins by tapping its field location, then
  allows kind confirmation and an optional taker.
- `GameEvent.location` is the only placement source of truth.
- Field flip produces the same canonical result for the same pitch location.
- Opponent restarts cannot store a tracked participant as taker.
- Old located or unlocated corner/offside events still project.
- A client with R1/R2 reader support can pull every event R3 writes; writers
  never deploy first.
- Summary team comparison can show throw-ins and goal kicks.
- Timeline identifies the restart, awarded side, and known taker; Field shows
  the recorded position.
- `pnpm test`, `pnpm lint`, and `pnpm build` stay green.
- No new `soc_*` aggregate ids or SQL migration in this plan.

## 9. Out of scope

- `S7` auto-linking the next shot to the last restart
- `S18` upright cluster counts
- Goal-mouth placement (`S16`) or header (`S15`)
- Free-kick events separate from fouls
- Kick-ins and other competition-specific restarts
- Season player restart leaderboards
- Formation lineup (`S19`)

## 10. Backlog links

- `S17` Make the existing corner event obvious
- `S20` Throw-ins and goal kicks
- Related later: `S7` last restart as next shot source
