# Plan: BKE-1C Basketball Court Events

Detailed plan for moving the existing Basketball court workflow onto the authoritative event
foundation while keeping normal Basketball games on the legacy aggregate path.

Status: Complete. Product and delivery decisions were confirmed in the BKE-1C Q&A, and BKE-1C1
through BKE-1C3 are implemented. BKE-2 direct live actions are next.

Depends on:

- [PLAN_BKE_1_EVENT_FOUNDATION_AND_COURT.md](PLAN_BKE_1_EVENT_FOUNDATION_AND_COURT.md)
- [PLAN_BKE_1B_BASKETBALL_EVENT_FOUNDATION.md](PLAN_BKE_1B_BASKETBALL_EVENT_FOUNDATION.md)
- [PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md](PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md)

## 1. Goal

BKE-1C exits when a development-only local Basketball event game can use the existing inline court
to record located shots, optional linked assists/rebounds, and every current popup action through
one checked event command layer. Shot filters, newest-first grouped undo/restore, and Clear Shot
Chart must operate on events without changing Soccer or any unmarked Basketball game.

BKE-1C is not a complete Basketball tracker cutover. Score controls, the direct stat grid, team and
period controls, cloud sync, Summary, and user-visible event-game creation remain later phases.

## 2. Phase Map

| Phase | Scope | Exit condition |
|---|---|---|
| BKE-1C1 | Checked Basketball court command foundation, development-only local creation intent, setup/participant snapshot, atomic match start, and fixture helpers | **Implemented:** a local internal game becomes event-authoritative before aggregate sync can start, initializes one coherent Period 1 history, and rejects every partial/invalid transition |
| BKE-1C2 | Court/popup integration, all popup event outputs, participant/team actor mapping, per-shot value override, capture preferences, projected filters, and event-mode tracker shell | **Implemented:** existing court capture gestures round-trip through events with inline failure handling while legacy Basketball UI remains unchanged |
| BKE-1C3 | Capture-unit Recent Events, one-level undo/restore, court Undo, Clear Shot Chart dependency mutations, persisted inverse receipt, and complete parity/regression proof | **Implemented:** grouped corrections are atomic and reload-safe; chart clearing preserves every excluded event exactly and the BKE-1 program exits |

Each slice used its own feature branch and PR. All BKE-1C slices are complete.

## 3. Guardrails

- The event model toggle exists only in development builds, applies only to a new local Basketball
  game, defaults off every time, and is never remembered as a user preference.
- Event creation intent stamps `gameDataAuthority: 'sport_events'` before game information can enter
  aggregate auto-sync. A setup-in-progress marked game may be resumed on `/setup` or `/players`, but
  cannot mutate or sync as a legacy game.
- The creation gate controls new games only. Any parked event-owned game remains resumable even when
  the gate is unavailable; disabling creation never hides or reclassifies existing data.
- No existing or in-progress aggregate game converts to events. The internal toggle is unavailable
  after aggregate activity or cloud binding exists.
- No BKE-1C change writes Basketball events to Supabase. Migration 042 still rejects neutral event
  sides and BKE-4A owns that widening.
- One court gesture produces one checked state transition. React never dispatches a shot and linked
  fact as separate best-effort writes.
- Projection remains the sole source of score, player/team totals, and `ShotRecord[]` for event
  games. `actionLog` remains empty.
- Soccer event definitions, commands, tracking, corrections, sync, and release behavior remain
  unchanged.

## 4. BKE-1C1: Command And Setup Foundation

### 4.1 Development-only creation intent

- Add a development-only Event Model toggle to local Basketball setup. It defaults off for every
  new game and is absent from production builds, existing-team selection, and team deep-link flows.
  A signed-in unbound `New Team` setup may select the toggle; doing so explicitly changes that
  setup to `Local Team`, clears cloud-season intent, and prevents cloud team/game creation.
- Selecting it marks the new game event-owned before `SET_GAME_INFO` can make the state eligible for
  aggregate sync. Deselecting is allowed only while no stream, setup snapshot, or aggregate activity
  exists.
- Setup/player routes recognize a marked but not-yet-initialized game as resumable setup, not as a
  generic corruption screen. Every tracker, sync, and aggregate mutation path continues to treat
  missing authoritative data as quarantined.

### 4.2 Setup snapshot

- Build `BasketballMatchSetup` from the confirmed local roster and current resolved team-stat rules.
- Exclude both team pseudo-players from participant rows. Every selected individual becomes a
  tracked-side participant with a stable generated `participantId`, current local `playerId`, name,
  number, and `initialStatus: 'bench'`.
- Do not invent an opponent roster. Opponent team capture uses team/unknown actors until a later
  phase supplies optional opponent participants.
- Default the tracked team designation to the existing local game's tracked/home semantics. BKE-5
  owns user-facing rule/source overrides.

### 4.3 Atomic start

- The Player Setup Start action builds the sport state, initializes the stream, and appends the first
  `basketball.period_started` event through one checked helper before navigation.
- Intermediate candidate states are never dispatched. Any setup, registry, projection, or append
  failure returns the original state, leaves the user on Player Setup, and displays a useful error.
- The first period comes from the immutable rules snapshot. Sequence starts at one and every later
  command derives its next sequence from the stored stream rather than React-local counters.
- Starting an event game through cloud checkout is rejected. The existing aggregate checkout flow
  remains unchanged.

### 4.4 Checked command API

- Add a Basketball-owned command module following the proven Soccer live-helper pattern. Commands
  accept `GameState` plus recorder/time dependencies and return either a complete rebuilt state or a
  typed product-facing error.
- Centralize current period, next sequence, participant/team actor mapping, capture-command id
  generation, normalized court location, and event timestamps.
- Commands use the global registry/projector and require complete final projection. UI call sites
  hydrate only successful results.

### 4.5 Implementation

- `src/lib/basketball/commands.ts` owns creation intent, immutable setup construction, atomic Period
  1 start, current command context, per-recorder sequencing, actor mapping, command ids, normalized
  locations, and timestamps.
- The centralized release policy exposes the setup toggle only in development. Selecting it on a
  new unbound Basketball setup stamps event authority before game information and changes the
  source label to `Local Team`; existing-team and cloud-bound starts remain rejected.
- Player Setup excludes team pseudo-players from the immutable participant snapshot and dispatches
  one hydrated result only after stream initialization and the first period event project fully.
- Marked setup-in-progress and initialized games survive parking/reload/import without aggregate
  fallback. Persisted projection is discarded and rebuilt from the stored event stream on hydrate.

## 5. BKE-1C2: Court And Popup Integration

### 5.1 Dual runtime path

- `ShotChartPanel` retains the current reducer path for unmarked legacy games.
- A healthy Basketball event game uses checked Basketball commands. Invalid marked games expose
  diagnostics and never fall through to `ADD_SHOT` or `INCREMENT_STAT`.
- Event-mode command failure keeps the popup open with an inline error. No partial event, pulse, or
  selection change is presented as successful.

### 5.2 Shot commands

- A court tap still starts from geometry-derived 2PT/3PT. A user override records
  `valueSource: 'manual_override'`; otherwise it records `valueSource: 'court'`.
- Manual value override applies to the current shot only. The next tap returns to geometry. The
  existing capture preference field is reset to `null` after capture or cancel.
- Convert court feet to normalized event coordinates through the shared Basketball geometry module.
  The event id becomes the projected `ShotRecord.id`; no parallel chart row is written.
- A shot without a prompted fact is a single event with `captureCommandId: null`.
- Made plus assist and missed plus rebound are append-only atomic batches. Every member shares one
  new `captureCommandId`, and the related fact points to the shot event id.

### 5.3 Actors and popup parity

- Preserve the existing player picker: tracked individuals plus tracked and opponent team chips.
  Event side derives from the selected entry; no separate side control is added.
- Individual selections map to stable setup participants. Team chips map to side-correct team or
  unknown actors and project back to the existing pseudo-player ids.
- Keep all five standalone popup actions: offensive rebound, defensive rebound, steal, block, and
  assist. They append independent events with null relationships and null command ids.
- Prompted offensive/defensive rebound defaults and candidate lists remain unchanged. Prompted
  assists remain same-side and cannot target the shooter.
- The popup stat line reads the event projection and updates after a successful player switch or
  capture.

### 5.4 Event-mode tracker shell

- Retain the projected read-only scoreboard, player selector, inline court, shot filters, notes, and
  Recent Events.
- Hide score mutation controls, the direct stat grid, team/bonus controls, period controls, and the
  post-start Add Player control until BKE-2 supplies event commands for them.
- Lock the participant roster after start. BKE-2 owns late participant capture through
  `basketball.match_roster_added`.
- Preserve individual, team, and All chart filters. Filters change display only and never retarget a
  command.
- Persist selected participant/team-side display preferences for park/resume without including them
  in authoritative fingerprints.

### 5.5 Implementation

- `captureBasketballCourtEvent` is the single checked adapter for every existing court-popup output.
  It maps projected participants and team pseudo-player ids to event actors, derives period and
  per-recorder sequence centrally, and hydrates React only after complete projection.
- Located shots convert shared court feet to normalized event coordinates. Geometry-preserving
  choices use `court`; a changed 2PT/3PT choice uses `manual_override`, and the projected event id
  is the only shot-chart record id.
- Prompted assists and rebounds append atomically with their shot, relation, and shared command id.
  Standalone popup facts retain null relation and command ids. Invalid combinations return the
  original state and remain visible as an inline popup error.
- Event capture preferences persist the selected participant or team side and temporary value
  override while remaining fingerprint-inert. Successful capture and cancel clear the override.
- The event tracker keeps the projected scoreboard, selector, court, filters, notes, and disabled
  Recent Events shell. Legacy score/grid/team/period/Add Player controls and chart corrections are
  hidden until their owning phases; unmarked Basketball continues through the unchanged reducer
  path.

## 6. BKE-1C3: Undo, Restore, And Clear Chart

### 6.1 Capture units

- Read event-backed Recent Events from ordered Basketball events instead of `actionLog`.
- A non-null `captureCommandId` renders as one row containing every member of that gesture. A null id
  is its own capture unit. Labels summarize the group, for example `Made 3PT + Assist`.
- Only the newest active capture unit can be undone. Older rows remain context until BKE-3 provides
  arbitrary Timeline correction.
- Undo tombstones every active member of the unit in one `applyGameEventMutations` call.

### 6.2 One-level restore receipt

- Store one validated, non-authoritative `lastCourtUndo` receipt in Basketball capture preferences.
  It records only the event ids to restore and the previous links required to invert updates.
- Add the receipt without bumping `BASKETBALL_GAME_STATE_VERSION`. Normalization treats the field as
  optional and defaults missing/invalid values to `null`, so existing marked development games stay
  readable instead of being quarantined by a persisted-shape change.
- The receipt survives park/reload and is cleared by any new capture, successful restore, or
  unrelated event mutation. It is fingerprint-inert by construction because
  `sportGameStateForFingerprint` includes only sport id, version, and immutable setup; capture
  preferences never enter fingerprints or publication.
- Recent Events shows `Restore last undone` only while the receipt still matches the current stream.
  Restore applies every inverse mutation atomically; stale or invalid receipts fail visibly and
  cannot partially restore history.
- This receipt is required for Clear Shot Chart because current event rows retain revisions but not
  previous payload bodies; an unlinked block cannot otherwise recover its former shot id.

### 6.3 Court Undo

- Enable the court-specific Undo button only when the newest active capture unit contains a located
  field goal.
- Undo the complete newest unit, including its prompted assist or rebound. Never search past a newer
  standalone capture to find an older shot.
- Restore remains in Recent Events rather than changing the court button's meaning.

This is a named intentional improvement over legacy behavior. The legacy court button checks only
the newest `actionLog` row's `shotId`; a prompted assist/rebound is a trailing row with only
`linkedShotId`, so the button is disabled immediately after that grouped gesture. Event mode keeps
the same strict newest-first boundary but correctly recognizes the whole persisted capture unit.
Parity fixtures must expect the availability difference rather than disabling grouped event undo to
match the legacy limitation.

### 6.4 Clear Shot Chart

- Clear every active located field-goal event in the game, regardless of the current All/team/player
  filter.
- Tombstone each linked active assist and rebound in the same atomic command.
- Preserve linked block totals by updating each block to `relatedEventId: null`. Record the previous
  shot link in the one-level restore receipt.
- Preserve free-throw attempts/trips, every unlocated field goal, steals, turnovers, fouls,
  timeouts, score adjustments, minutes, standalone assists/rebounds/blocks, and all unrelated rows
  byte-identically.
- Confirmation reports exact counts for shots, linked assists/rebounds, and unlinked blocks before
  applying. Successful clear produces one restoreable correction receipt, not a synthetic event.

### 6.5 Implementation

- `courtCorrections.ts` derives newest-first court capture units from validated active Basketball
  events. Shared command ids form one row; null command ids remain independent rows; lifecycle
  events cannot enter the correction surface.
- Recent Events renders grouped event labels and permits only the newest active unit to undo. The
  court Undo delegates to the same command and is enabled only when that newest unit contains a
  located field goal, so it never skips a newer standalone fact.
- Undo atomically tombstones every active unit member. Clear Chart atomically tombstones every
  located field goal plus linked assists/rebounds and updates linked blocks to a null relation while
  preserving their totals.
- `lastCourtUndo` stores exact post-mutation revisions, restorable event ids, and prior block links.
  Normalization treats the optional receipt as fail-soft, park/reload preserves valid receipts, and
  restore requires every stored revision and state to still match before applying one atomic batch.
- New capture and unrelated reducer event mutations clear the one-level receipt. Capture
  preferences remain outside fingerprints, and legacy Basketball continues using `actionLog` and
  the existing reducer correction behavior.

## 7. Verification

### BKE-1C1

- Development toggle is absent from production and cloud/team flows, defaults off, and blocks
  aggregate sync before game information is stored.
- Setup snapshot excludes pseudo-players, marks individuals bench, permits no opponent roster, and
  starts Period 1 atomically.
- Reload/park/import of marked setup-in-progress and initialized games preserves authority without
  aggregate fallback.

### BKE-1C2

- Legacy reducer and current court tests remain unchanged.
- Event parity fixtures cover made/missed 2PT/3PT, geometry and manual override, selected-player
  switching, team-side capture, all standalone popup stats, assisted makes, rebound outcomes, and
  inline command failure.
- Event projection matches approved legacy player/team totals, score, markers, filters, and popup
  stat lines. No command double-writes `actionLog` or `shotChart`.

### BKE-1C3

- Single and grouped captures undo newest-first and restore after park/reload.
- A prompted assist/rebound leaves legacy court Undo disabled but enables event-mode court Undo for
  the complete newest capture unit; this is the approved intentional improvement.
- A newer standalone event prevents court Undo from reaching an older shot.
- Clear Chart removes all and only located shots plus approved dependents across filters.
- Free throws and unlocated attempts remain byte-identical; `ft` totals do not move; shared 2PT/3PT
  totals drop by exactly the located contribution; blocks retain totals and restore their links.
- Full Basketball, Soccer, parking, fingerprint, unit, lint, and production-build checks pass.

## 8. Approved Decisions

1. Split implementation into BKE-1C1 command/setup, BKE-1C2 court integration, and BKE-1C3
   corrections/parity.
2. Use a development-only, local-only, non-sticky setup toggle.
3. Event-back every existing popup action while leaving the full grid to BKE-2.
4. Put one-level grouped Restore in Recent Events.
5. Preserve the current player/team picker and infer event side from selection.
6. Reset manual shot-value overrides after each shot.
7. Keep failed commands open with inline errors and no partial write.
8. Render one Recent Events row per capture gesture.
9. Mark all initial participants bench until lineup truth exists.
10. Initialize setup, stream, and Period 1 atomically before tracker navigation.
11. Clear the entire chart across filters with exact dependency handling and consequence counts.
12. Keep the legacy newest-first boundary and never skip later captures, while intentionally fixing
    the legacy limitation that disables court Undo after a prompted assist/rebound.
13. Hide unimplemented mutation surfaces in event mode rather than rendering no-op controls.
14. Lock the event-game roster after start until late-participant UI ships.
15. Default the internal toggle off and stamp authority before aggregate auto-sync is possible.
16. Always allow existing parked event games to resume; creation and history access are separate.

No product decisions remain open for BKE-1C2 implementation.
