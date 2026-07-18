# F13 - Shot detail + linked metadata + edit modal

> Supersedes the old F10 "shot sequence numbers / recency highlight" sketch. F10's
> visible numbering is no longer needed as a standalone feature; the useful version is a
> tappable shot detail surface with durable shot number and linked F7/F9 metadata.
>
> Status: held as a standalone feature. Product intent is assigned to the future basketball
> event-model program; see
> [PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md](PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md).
>
> **Hold note:** Do not start this plan independently. Reconcile its shot detail, linked
> metadata, and correction requirements during BKE-0, then deliver the event-backed detail
> surface in BKE-3 if that phase plan confirms the scope.

## Goal

Let a scorer tap an existing shot marker and inspect the full shot event: shot number in
the game, shooter, result, shot value, zone/location, timestamp, and any assist or rebound
captured through F7/F9. In later phases, make those fields editable so the shot chart can
serve as a correction surface, not only a capture surface.

## Why This Replaces F10

The original F10 proposed visible sequence numbers or recency styling on markers. That is
useful only if it helps reconstruct what happened. A details modal does that better:

- The court can stay visually clean.
- Shot number becomes metadata instead of marker clutter.
- F7 assists and F9 rebounds can be shown with the shot they belong to.
- The same modal can become the natural edit/correction surface.

## Current Architecture Constraint

Today `ShotRecord` contains only shot-local data:

```ts
interface ShotRecord {
  id: string
  x: number
  y: number
  made: boolean
  shotType: '2pt' | '3pt'
  zone: ShotZone
  playerId: string
  timestamp: number
}
```

F7 and F9 intentionally avoided data-model changes:

- F7 assist: `ADD_SHOT`, then separate `INCREMENT_STAT(ast)`.
- F9 rebound: `ADD_SHOT`, then optional separate `INCREMENT_STAT(oreb|dreb)`.
- F12 recent-events makes those adjacent undo rows visible.

That is enough for live capture and LIFO undo, but not enough for a reliable shot-detail
modal after reload/cloud sync. A modal could guess from action order while the local
`actionLog` is intact, but the relationship is not durable.

## Proposed Data Model

> **Historical proposal only:** Do not implement this `ShotRecord` extension as written.
> BKE-0 must replace it with the approved shared event envelope, basketball projections,
> and legacy-game compatibility strategy before BKE-3 delivers the detail/edit surface.

Extend `ShotRecord` with optional linked metadata:

```ts
interface ShotRecord {
  id: string
  x: number
  y: number
  made: boolean
  shotType: '2pt' | '3pt'
  zone: ShotZone
  playerId: string
  timestamp: number
  sequenceNumber?: number
  assistPlayerId?: string
  reboundPlayerId?: string
  reboundStatId?: 'oreb' | 'dreb'
}
```

Cloud persistence likely needs a new migration adding nullable columns to `shot_chart`:

- `sequence_number integer`
- `assist_player_id uuid null references players(id)`
- `rebound_player_id uuid null references players(id)`
- `rebound_stat_id text null check (rebound_stat_id in ('oreb', 'dreb'))`

Existing rows can remain valid with nulls. The app can backfill display-only shot numbers
from array order/timestamp when `sequenceNumber` is absent.

## Phase Plan

### Phase 1 - Read-only shot details modal

**Purpose:** deliver immediate user value with low risk.

- Add `selectedShotId` state to the court surface.
- Make existing shot markers tappable without interfering with court-tap capture.
- Add `ShotDetailModal` showing:
  - shot number: `sequenceNumber` if present, otherwise derived display order
  - shooter/player label
  - made/miss and 2PT/3PT
  - zone
  - timestamp/game order context
  - assist/rebound only when durable metadata exists
- For old shots, show assist/rebound as "Not linked" rather than guessing.

**Data changes:** none required if this phase derives shot number only.

### Phase 2 - Link F7/F9 metadata at capture time

**Purpose:** make new assists/rebounds durable on the shot record.

- Assign a stable `sequenceNumber` when creating a shot.
- When F7 assist is selected, write `assistPlayerId` into the shot and still increment
  `ast` for totals.
- When F9 rebound is selected, write `reboundPlayerId` + `reboundStatId` into the shot and
  still increment `oreb`/`dreb` for totals.
- Update local display paths and Game Summary shot chart review to understand the fields.

**Data changes:** `ShotRecord` type change. LocalStorage migration is passive because all
new fields are optional.

### Phase 3 - Cloud persistence

**Purpose:** preserve shot detail metadata across devices and cloud game review.

- Add Supabase migration for the new `shot_chart` columns.
- Update `cloudSync` shot upsert rows.
- Update local hydration from cloud rows.
- Update F3 all-recorder review loader to include linked metadata.
- Define behavior when linked player rows are no longer present locally:
  - retain ids for cloud display if possible
  - gracefully show "Unknown player" when not mappable

**Data changes:** Supabase migration plus cloud sync/read mapping.

### Phase 4 - Shot edit modal

**Purpose:** allow correction from the shot itself.

Editable fields:

- shooter/player
- made vs missed
- 2PT vs 3PT
- assist player for made shots
- rebound player/stat for missed shots

Reducer work:

- Add an `UPDATE_SHOT` action that receives previous and next shot details.
- Reverse old stat impacts:
  - old shooter shot stat (`2pt`, `3pt`, `2pt_miss`, `3pt_miss`)
  - old assist `ast`, if present
  - old rebound `oreb`/`dreb`, if present
- Apply new stat impacts.
- Update the `ShotRecord`.

UX rules:

- Made shots can have an assist; missed shots cannot.
- Missed shots can have a rebound; made shots cannot.
- Changing made <-> missed clears incompatible linked metadata unless the user chooses a
  new valid linked event.
- Editing location can be deferred; shot value can be edited without moving the marker,
  matching F5.

### Phase 5 - Undo and audit polish

**Purpose:** make edits explainable and reversible.

Options:

- **A: Edit has no one-tap undo.** Simpler, but inconsistent with current tracker
  expectations.
- **B: Add `shot_edit` action log entries with a full before/after snapshot.**
  Recommended if editing ships.
- **C: Event-sourced recompute.** Most robust, but much larger than F13 needs initially.

Recommended path: Phase 4 can ship with a `shot_edit` action log entry that restores the
previous shot and stat impacts.

## Pre-handoff Design Decisions Needed

- **D1 - Sequence source:** assign `sequenceNumber` at capture time, or derive forever from
  sorted shot order? Recommendation: assign at capture for durability; derive only for
  legacy rows.
- **D2 - Cloud timing:** implement local metadata first, or include cloud migration in the
  same PR? Recommendation: split local read-only/modal from cloud persistence.
- **D3 - Edit scope v1:** allow only player/result/value edits, or include assist/rebound
  edits immediately? Recommendation: include assist/rebound once metadata exists; otherwise
  the modal solves only half the correction problem.
- **D4 - Undo for edits:** require undo support in the first editable phase?
  Recommendation: yes, but via a specific `shot_edit` log snapshot rather than many small
  synthetic increments/decrements.
- **D5 - Historical F7/F9 rows:** should the app attempt to infer links for old local
  action logs? Recommendation: no. Show only durable links; do not guess.
- **D6 - Marker affordance:** marker tap opens details; court background tap opens capture.
  Need mobile QA to ensure marker taps do not leak through to court capture.

## Key Files

- `src/types.ts` - `ShotRecord`, `ActionLogEntry`, `GameAction`
- `src/context/GameContext.tsx` - `ADD_SHOT`, future `UPDATE_SHOT`, undo
- `src/components/shot-chart/BasketballCourt.tsx` - marker tap affordance
- `src/components/shot-chart/ShotChartPanel.tsx` - selected shot state and modal wiring
- `src/components/shot-chart/CourtEventPopup.tsx` - F7/F9 metadata capture
- `src/lib/cloudSync.ts` - shot_chart read/write mapping
- `supabase/migrations/` - new nullable `shot_chart` metadata columns
- `docs/REGRESSION_TESTING.md` - marker tap/detail/edit/cloud review cases

## Risks

| Risk | Mitigation |
|---|---|
| Stat totals drift after editing | Centralize shot stat impact calculations in a pure helper with tests. |
| Undo gets confusing for edits | Add a dedicated `shot_edit` action log entry with a snapshot. |
| Cloud review cannot map linked players | Store nullable ids, map when possible, show fallback labels when not. |
| Modal tap conflicts with court tap | Stop event propagation on markers and add Playwright/manual mobile checks. |
| Scope grows too large | Ship read-only modal first, then metadata, then editing. |

## Suggested Acceptance Criteria

Phase 1:

- Tapping a shot marker opens a modal without adding a new shot.
- Modal shows shot number, shooter, result/value, zone, and timestamp/order.
- Closing the modal returns to the same court view.

Phase 2-3:

- New made shots with F7 assist show the assister in the shot modal after reload/cloud sync.
- New missed shots with F9 rebound show rebound player/team and offensive/defensive type
  after reload/cloud sync.
- Legacy shots without metadata still show core shot details.

Phase 4-5:

- Editing shot player/result/value updates shot marker details and stat totals.
- Editing assist/rebound updates linked metadata and stat totals.
- Undo after a shot edit restores previous shot details and totals.
