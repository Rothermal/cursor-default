# Plan: BKE-3 Basketball Event Timeline and F13

Detailed implementation plan for replacing the Basketball event game's limited Recent Events
review with an editable Timeline and delivering the held F13 shot-detail experience on the shared
event model.

Status: Approved through the BKE-3 product and delivery Q&A. Implementation is split into BKE-3A
through BKE-3D. BKE-3A through BKE-3C and BKE-3D1/D2 are complete; BKE-3D3 is next.

Depends on:

- [PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md](PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md)
- [PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md](PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md)
- [PLAN_BKE_2_COMPLETE_EVENT_CAPTURE.md](PLAN_BKE_2_COMPLETE_EVENT_CAPTURE.md)
- [PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md](PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md)

## 1. Goal

BKE-3 exits when a healthy local Basketball event game has one coherent Timeline for reviewing,
adding, revising, removing, restoring, and re-linking supported events. A shot marker and its
Timeline row open the same F13 detail surface, with field-goal ordinal, shooter, result, value,
location, zone, and durable assist/rebound/block relationships.

The event stream remains the sole authority. Every correction updates or tombstones immutable event
identity through checked Basketball commands and rebuilds the projection once. No Timeline action
also mutates aggregate counters, `ShotRecord`, or `actionLog`.

BKE-3 remains internal, local-only, and development-only. It does not add Basketball event cloud
transport, recorder authority, finalization, Summary authority, canonical aggregates, layered
Basketball settings, rollout, game clock, substitutions, or lineup intervals. Those remain BKE-4
through BKE-6.

## 2. Existing Foundation

BKE-3 builds on capabilities that already ship:

- `GameState.eventStream` and Basketball `sportGameState` distinguish event authority from legacy
  aggregate games and fail closed when marked state is unhealthy.
- `applyGameEventMutations` updates, deletes, or restores distinct event ids atomically, validates
  only the final candidate projection, and applies all or none.
- Basketball commands already resolve actors, periods, event relationships, availability, rule
  constraints, cloud-binding rejection, and full reprojection.
- `basketballLiveCaptureUnits` groups only events sharing one non-null `captureCommandId` and exposes
  lifecycle boundaries without guessing from adjacency.
- BKE-2 correction commands already prove consequential shot, foul, trip, ejection, and timeout
  deletion plus exact immediate restore.
- Located field goals project directly into `shotChart` with the event id as marker id. Unlocated
  field goals remain authoritative but have no marker.
- The event engine stores the current event revision only. `revision`, `updatedAt`, and `deletedAt`
  prove correction history, but prior field-value snapshots are not retained.

One narrow platform gap remains. `addGameEvents` can append a new relationship group atomically and
`applyGameEventMutations` can revise existing events atomically, but one operation cannot currently
combine both. A shot draft that changes the shot and adds a brand-new assist must still commit all
or none. BKE-3C therefore adds a sport-neutral final-candidate helper that accepts validated appends
plus distinct update/delete/restore targets in one operation. Existing APIs remain intact, duplicate
ids/sequences fail before projection, and unchanged Soccer behavior is an acceptance gate.

The Soccer Timeline is a presentation and workflow precedent, not a Basketball domain API.
Basketball may reuse generic event inspection and mutation primitives, but it owns event families,
capture groups, relationships, ordinals, consequence previews, and editors.

## 3. Delivery Map

| Slice | Scope | Exit condition |
|---|---|---|
| BKE-3A | Track/Timeline workspace, read-only event review, filters, capture groups, revision/deletion presentation, shared read-only shot detail, marker selection/clusters, and legacy marker core detail | Every healthy event is explainable from one local Timeline, marker taps never create shots, and legacy marker review adds no event authority |
| BKE-3B | Checked arbitrary remove/restore commands, explicit capture-group removal, dependency previews, conservative dependent restoration, and quick-Undo coexistence | Any supported local event can be removed or restored without crossing lifecycle/authority boundaries or leaving invalid links |
| BKE-3C | Sport-neutral append-plus-mutate final-candidate helper, F13 shot editor, court location placement, shooter/result/value changes, assist/rebound/block add/remove/re-link, and historical shot additions | Located and unlocated field goals plus their supported relationships can be corrected atomically from marker or Timeline detail while Soccer behavior remains unchanged |
| BKE-3D | Remaining event-family editors, missed-event additions to started periods, complete parity fixtures, regression docs, and BKE-3 exit audit | Every user-recorded Basketball family has checked Timeline correction; lifecycle and identity boundaries remain deliberate; BKE-4 can begin from a stable local model |

Each slice uses its own feature branch and PR. No UI control ships before its checked command,
consequence preview, atomic mutation, and focused tests exist.

## 4. Shared Product Contract

### 4.1 Workspace and quick correction

- Healthy Basketball event games gain `Track` and `Timeline` tabs. `Track` preserves the complete
  BKE-2 court-plus-grid workflow rather than separating court and stats.
- Timeline receives a full in-page working surface; it is not compressed into the old modal.
- The Track footer retains a fast newest-capture Undo action and a separate Timeline action.
- Timeline supports arbitrary deliberate correction. Quick Undo remains newest-first and still
  stops at lifecycle boundaries.
- A successful Timeline mutation clears the one-level quick-Undo restore receipt so a stale receipt
  cannot overwrite a later deliberate edit. Rejected mutations leave it unchanged.
- Legacy Basketball keeps its current tracker and Recent Events behavior.

### 4.2 Timeline ordering, grouping, and filters

- Live Timeline is newest first. Each row displays a stable period label and enough event meaning to
  identify actor, side, outcome, and important relationships.
- Events sharing one non-null `captureCommandId` render as one expandable capture group. Independent
  events remain independent even when adjacent or linked later.
- Editing never rewrites an event's original `captureCommandId`. A newly added relationship is a new
  correction-time capture fact and does not retroactively join the source shot's original group.
- Expanding a group exposes its individual events. Individual correction is the default; removing
  the complete original capture is an explicit separate action with one combined consequence
  preview.
- Lifecycle and participant-identity events render as read-only boundaries. Period and terminal
  correction remains in dedicated lifecycle controls, and identity resolution stays in its
  established administration flow. `basketball.match_roster_added` is the deliberate exception: it
  remains a correction capture so the shipped quick Undo affordance is preserved. Timeline may
  remove or restore it only when checked final-state validation proves that no surviving event or
  identity fact depends on the participant; BKE-3 does not add a roster-addition payload editor.
- Overlapping family filters are: All, Scoring, Shooting, Related Stats, Fouls/FT,
  Administration, and Match Control. One event may qualify for more than one family.
- During active play the default period filter is the current period. After completion the default
  is Full Match. Users can always choose any started period or Full Match.
- Optional side and participant filters narrow dense games without changing the default All-side,
  all-participant view.
- Removed events live in a collapsed Removed section and retain the same family, period, side, and
  participant filters.

### 4.3 Revision and deletion presentation

- Active events with `revision > 1` display a Revised badge plus revision and updated-time metadata.
  Revision means that one or more update, delete, or restore transitions occurred; it does not claim
  that the current payload differs from its original value. The detail surface shows current
  authoritative values only.
- BKE-3 does not add prior-value snapshots. The current shared engine replaces the stored event when
  revising it, and adding a second local audit authority before BKE-4 transport is out of scope.
- Deleted events preserve their latest stored payload and actors, display Removed plus deletion
  metadata, and remain available for checked restoration.
- Restoration increments revision through the shared mutation API. It is not a rollback to an
  invisible prior snapshot.
- Ordinary local edits, removal, and restore need no reason. Existing reason requirements remain for
  official score correction, reopen, and exceptional foul counting overrides.

### 4.4 Authority and lifecycle gates

- Timeline mutation requires a healthy, local Basketball event game with no cloud binding.
- Completed, suspended, and abandoned games are read-only. The user must use reasoned Reopen before
  adding or correcting an event.
- Period breaks may review and correct existing events and may add a recorded-later event to a
  started period. Live capture controls remain disabled until a period starts.
- Corrupt/incomplete streams show diagnostics and read-only coherent context. They never reveal a
  legacy mutation fallback.
- BKE-3 never writes Basketball events to Supabase and never edits a remote or Summary source.

## 5. Recorded-Later Events

### 5.1 Ordering contract

- A missed event may target any started Basketball period after the match has been reopened when
  necessary.
- The new event always receives the recorder's next append sequence. BKE-3 never forges an earlier
  sequence, timestamp, or game clock value.
- Timeline derives a `Recorded later` label when an event targets a period that was not active at
  its append position. This includes an event added to a completed period during a period break.
- Field-goal ordinals follow ordered active field-goal events. A recorded-later field goal therefore
  receives its honest append-order ordinal; deletion/restoration may renumber display ordinals while
  event ids remain stable.
- BKE-6 may later add real clock placement for clock-enabled games. BKE-3 stores `elapsedMs: null`
  and does not fabricate timing.

### 5.2 Projection semantics

- Existing live commands continue to require the active current period.
- Dedicated historical-add commands may target a started period and use the same actor, relationship,
  inventory, non-negative score, and rule validation as live capture.
- BKE-3D changes Basketball stat and administrative replay validation to accept any period that had
  started at that event's append position. Administrative replay also accepts `period_break`, aligning
  its allowed status set with stat replay: `not_started`, `ended`, and `suspended` remain rejected.
  Current-period and active-period enforcement moves to the checked live command boundary; lifecycle
  events keep their existing current-period projector rules. These are explicit replay contract
  changes, not only new command options, so an administrative event added during a break and an event
  appended in Q3 for Q1 both remain projectable after reload.
- Stat replay already accepts an event for the just-ended period during its break because
  `currentPeriodId` retains that period. BKE-3D generalizes that narrow precedent across any previously
  started period and across administrative event families.
- Historical attribution changes period-scoped totals for the selected period, including team fouls
  and timeout inventory. Non-resetting overtime bonus recomputes from the same cumulative helper used
  by the tracker.
- Capture order remains semantic order. A recorded-later foul can change the current projected
  disqualification state, but it does not retroactively invalidate events that were valid earlier in
  the append stream.
- Attempts to target an unstarted/unknown period, violate a period inventory, use an unavailable
  actor at append time, or create an invalid relationship reject the complete command.

## 6. BKE-3A: Timeline and Read-Only Detail

Status: Complete. `src/lib/basketball/timeline.ts` owns pure review/detail derivation;
`BasketballTimeline`, `BasketballShotDetailDialog`, `ShotChartPanel`, and `BasketballCourt` expose the
read-only tracker experience without adding correction authority.

### 6.1 Timeline review model

- Add a Basketball-owned pure review layer that converts event inspection into filtered Timeline
  sections, capture groups, individual rows, relationship summaries, revision flags, and removal
  counts without mutating state.
- Compute labels from event payload snapshots and current participant/team presentation with durable
  fallbacks for unresolved ids or labels.
- Keep lifecycle, roster, identity, score, shot, related-stat, foul, trip, attempt, ejection, timeout,
  and minutes events visible even when no editor exists yet.
- Flag dangling advisory links, empty free-throw trips, unavailable actors, and incomplete inspection
  near the affected row without hiding otherwise coherent history.

### 6.2 Shared shot detail

- Marker taps and Timeline shot rows open one responsive shot-detail component.
- Mobile uses a near-full-screen sheet with a fixed action footer. Desktop uses a constrained modal.
- Game-facing information appears first: field-goal ordinal or FT trip/attempt label, period,
  shooter/side, made/missed result, value, location/zone, and linked assist/rebound/block facts.
- Expandable Details shows event id, recorder, capture timestamp, capture group id, revision,
  updated/deleted metadata, and relationship diagnostics.
- BKE-3A is read-only. Edit controls arrive only with the owning checked command in later slices.

### 6.3 Marker interaction and legacy detail

- Extend `BasketballCourt` with an explicit marker activation callback. Marker pointer/tap handling
  stops propagation so selecting a shot cannot trigger background court capture.
- Pointer activation resolves to the nearest marker inside the generous touch targets. A compact,
  deterministic chooser appears only when the nearest candidates are effectively equidistant;
  keyboard activation opens the explicitly focused marker.
- Closing detail returns to the same court/filter/scroll context.
- Legacy aggregate Basketball markers receive read-only core detail only: derived full-game shot
  number, shooter, result/value, zone/location, and recorded timestamp.
- Legacy detail never guesses F7/F9 links, never synthesizes events, and exposes no editing.

### 6.4 Verification

- Cover every event-family label/filter, capture grouping, period default, side/participant filter,
  corrected/removed state, and unhealthy-stream display.
- Prove marker activation does not add a shot, nearest-marker resolution is stable, and ambiguous
  touch selection is deterministic.
- Verify event and legacy shot ordinals use full-game attempts rather than the current display filter.
- Park/reload an event game and preserve Timeline/detail context derived from authoritative state.

## 7. BKE-3B: Remove and Restore

Status: Complete. `src/lib/basketball/timelineCorrections.ts` owns consequence preview and checked
apply commands; `BasketballTimelineCorrectionDialog` is shared by Timeline rows and shot detail.
See [REGRESSION_BKE_3_TIMELINE.md](REGRESSION_BKE_3_TIMELINE.md).

### 7.1 Checked correction commands

- Add Basketball-owned preview/apply commands for individual remove, complete capture-group remove,
  and selected restore. React never constructs generic mutation arrays directly.
- Every preview names direct stat/score effects, linked-event tombstones, surviving events whose links
  clear, bonus/disqualification/inventory changes, and whether the target is a lifecycle boundary.
- Apply uses one `applyGameEventMutations` call and requires a complete final projection. Projection
  completeness is necessary but not sufficient: Basketball-owned commands also validate final
  family invariants that the projector reports only as advisory relationship warnings.
- Command validation owns duplicate free-throw attempt positions, relationship-target compatibility,
  duplicate official facts, and any other warning-level invariant affected by the candidate. It
  compares baseline and final relationship warnings across the complete stream and rejects every new
  warning attributable to the command, including a dangling link on an untouched surviving event.
  Existing unrelated advisory warnings may remain.
- Rejected commands return the original `GameState` by identity with a typed product-facing error.

### 7.2 Individual and group removal

- Individual removal follows BKE-0 stale-link rules. Removing a shot tombstones linked assists and
  rebounds, unlinks surviving blocks, and states those effects before confirmation.
- Removing a foul clears surviving trip/ejection source links; removing a trip ungroups attempts;
  removing an attempt keeps stable sparse positions and the trip.
- Removing a standalone related stat, turnover, timeout, ejection, minutes adjustment, or score
  adjustment removes only that event unless a validated relationship requires unlinking.
- Complete capture-group removal targets every active member sharing that persisted command id, then
  adds any required dependency mutations. It never sweeps later-linked independent events merely
  because they reference a group member.
- Lifecycle and participant-resolution boundaries are not removable from Timeline. Roster additions
  preserve their shipped correction behavior: removal is available only when no surviving event or
  identity resolution depends on the participant, and it never cascades away that later history.

### 7.3 Conservative restoration

- Restoring a selected source restores that event by default.
- The preview separately offers compatible tombstoned assists/rebounds or other recoverable
  dependents that retain a source id. Nothing extra is preselected.
- Surviving events whose links were cleared are never re-linked automatically. Re-linking is an
  explicit BKE-3C/BKE-3D edit.
- Restore rejects stale revisions or any final projection failure. Basketball command preflight also
  rejects duplicate free-throw positions or official facts, invalid actor/side or relationship
  combinations, and exhausted inventory, including cases that would otherwise produce only a
  `relationshipWarnings` entry.

### 7.4 Verification

- Exercise individual and group remove across every relationship topology.
- Prove exact all-or-none behavior, stale preview rejection, and unchanged-state failures.
- Verify quick Undo and its restore receipt cannot overwrite a later Timeline mutation.
- Park/reload after deletion and restore; current revisions and deleted payloads remain explainable.

## 8. BKE-3C: F13 Shot and Relationship Editing

Status: Complete. `shotEditCommands.ts` owns checked shot drafts, previews, existing-shot edits,
relationship changes, and recorded-later field-goal additions. Marker and Timeline detail share
`BasketballShotEditor`; Timeline also exposes `BasketballHistoricalShotEditor`. The generic
`applyGameEventAppendsAndMutations` primitive validates one final append-plus-mutate candidate and
rebuilds it once. Historical validation is intentionally narrow to shots, assists, rebounds, and
blocks until BKE-3D generalizes replay across the remaining event families.

### 8.1 Shot editor

- The BKE-3A detail surface gains one explicit Edit mode and one atomic Save.
- Editable fields are shooter/side, field-goal or free-throw result, 1PT/2PT/3PT value where valid,
  and location for field goals.
- Locate/Move enters a dedicated court-placement mode. Marker selection is suspended during placement
  and the background tap updates only the draft.
- Moving a shot recalculates normalized location and zone from snapshotted geometry but does not
  silently change its value. Value remains an explicit separately reviewed field. If the retained
  value matches the new geometry, `valueSource` is `court`; otherwise Save promotes it to
  `manual_override` and detail identifies the value as manual.
- An unlocated field goal may gain a location; a wrongly located field goal may be returned to
  unlocated after confirmation. Locating uses `court` when value and geometry agree and
  `manual_override` when they do not. Removing a location changes `court` to `quick_entry`, preserves
  an existing `manual_override`, and never changes the value. An explicit value change follows the
  same deterministic rule for the shot's current location.
- Attempt kind is immutable in BKE-3. A field goal cannot be converted to a free throw or vice versa;
  that transition would also need coordinated location, value-source, trip, and attempt-position
  semantics. Each kind still exposes its valid result, value, actor, and relationship fields.
- Save updates the stable event id, increments revision, rebuilds once, returns to the source view,
  and highlights the corrected row/marker.

### 8.2 Relationship editor

- Shot detail lists active and removed assist, rebound, and block relationships plus standalone
  compatible candidates.
- Users may add, remove, or re-link compatible relationships in the same atomic Save.
- When Save both revises existing events and appends a new relationship, use the BKE-3C
  append-plus-mutate final-candidate helper. React never sequences two commands or performs rollback.
- Made shots may link same-side assists. Missed shots may link offensive/defensive rebounds with the
  correct side relationship and opposite-side blocks. Totals never require a link.
- Changing made/missed, shooter side, or shooter clears every now-invalid surviving
  relationship in the same mutation. The preview names each event that will remain as a standalone
  stat.
- Tombstoned dependents are restored only when explicitly selected and still valid.

### 8.3 F13 numbering and detail behavior

- Active field-goal attempts, located or unlocated, receive projected display ordinals. Free throws
  use trip number and stable attempt position; direct ungrouped FTs say `Ungrouped FT`.
- Ordinals are display metadata, not stored sequence fields, and renumber after removal/restoration.
- Marker and Timeline editing share one draft schema, validator, consequence preview, and command.
- Legacy markers remain read-only and show no guessed relationships.

### 8.4 Verification

- Edit shooter, side, outcome, value, location, and every valid relationship combination.
- Cover made-to-miss, miss-to-made, cross-side actor changes, locate/unlocate, and stale-link cleanup.
- Verify one failed child mutation rolls back every draft change and leaves marker/totals unchanged.
- Confirm overlapping marker selection, filter disappearance after edit, return highlight, keyboard
  escape/focus, and narrow mobile placement behavior.

## 9. BKE-3D: Remaining Editors and Exit Audit

BKE-3D is delivered in four implementation slices so each domain keeps a reviewable command/UI/test
surface:

| Slice | Scope | Exit condition |
|---|---|---|
| BKE-3D1 | Shared non-shot editor/detail foundation; assist, rebound, steal, block, and turnover correction; recorded-later standalone and paired Steal + Turnover additions | Every related-stat and turnover fact can be revised or added through one checked atomic command without weakening shot or turnover relationships |
| BKE-3D2 | Score-adjustment and manual-minutes correction/addition | Signed score/minutes changes preserve reason, non-negative total, player, clock-model, and started-period rules |
| BKE-3D3 | Structured foul, free-throw trip, and free-throw attempt correction/addition | Foul/trip/attempt edits repair dependencies atomically and preserve stable trip positions |
| BKE-3D4 | Ejection and timeout correction/addition, complete parity fixtures, regression record, and BKE-3 exit audit | All remaining user-recorded families have checked Timeline workflows and BKE-4 can begin from a stable local model |

Each slice uses its own feature branch and PR. Event type and stable event identity remain immutable
through every editor.

BKE-3D1 status: Complete. `relatedEventEditCommands.ts` owns checked assist/rebound/steal/block/
turnover drafts, target compatibility, reverse steal-link repair, historical additions, and paired
Steal + Turnover capture. Existing event edits only offer relationship targets in valid capture
order; historical paired capture appends Turnover before Steal so no forward reference is created.
New links are period-local across the shot and related-event editors; an existing cross-period link
remains visible and preserved until explicitly changed. Relinking a turnover also moves capture-group
membership from the detached steal to the newly linked steal so group removal follows visible facts.
`BasketballTimeline` routes these families through one read-only detail sheet and shared responsive
edit/add workflows.

BKE-3D2 status: Complete. `valueEventEditCommands.ts` owns checked score-adjustment and manual-
minutes drafts, previews, edits, and recorded-later additions. Score edits retain the existing
reason/note contract, enforce non-zero whole-number deltas, and reject either side projecting below
zero after old attribution is removed and the replacement is applied. Minutes edits require a
resolved participant, the manual clock model, a signed non-zero whole-number delta, and non-negative
totals for both the former and replacement participant. Score and minutes replay now accepts any
started period; minutes alone also accepts `period_break`, leaving every later administrative family
on its current-period rule until its owning slice. Timeline detail and Add Event share the responsive
value editor, successful mutations clear quick Undo, and projector validation remains the final
fail-closed backstop. BKE-3D3 is next.

### 9.1 Event-family matrix

| Family | Editable fields and constraints |
|---|---|
| Assist/rebound/steal/block/turnover | Actor, side where semantically valid, and optional supported relationship; team/unknown actors remain explicit |
| Score adjustment | Signed delta and existing reason contract; reject a negative final side score |
| Minutes adjustment | Participant/side and signed non-zero delta; reject a negative projected player total and anchored-clock use |
| Foul | Offender, side, class, context, drawn-by, team-control side, incident, and reasoned counting override; clear invalid trip/ejection links atomically |
| Free-throw trip | Award count/context, one-and-one, source foul, technical, and possession-retained fields; reject or atomically resolve invalid existing attempt/source relationships |
| Free-throw attempt | Shooter, result, trip/position where compatible; positions never renumber and sparse/empty trips remain visible |
| Ejection | Player/staff subject, side, reason, source, and optional compatible current-period foul link |
| Timeout | Charged owner/kind or neutral kind/label; enforce the selected period's immutable inventory |

Lifecycle events, roster additions, and participant identity resolutions remain read-only Timeline
boundaries and use their established controls.

### 9.2 Historical additions

- Add Event opens a family chooser, then the same editor used for correction with `recorded later`
  context and a required started-period selection.
- Support shots, related stats, turnovers, score adjustments, minutes, fouls, trips/attempts,
  ejections, and timeouts. Multi-event relationships save atomically.
- Defaults come from the current capture side/participant when eligible but remain editable.
- Historical editors show no fake clock input. Period and append timestamp are the available context
  until BKE-6.

### 9.3 BKE-3 exit audit

- No healthy Basketball event uses `actionLog`, aggregate reducer mutations, or `ShotRecord` as a
  correction authority.
- Every visible edit/remove/restore/add action has a checked Basketball command and exact final-state
  validation.
- Track quick Undo remains fast and newest-first; Timeline owns arbitrary correction.
- Event games remain local-only/internal, cloud-bound games fail closed, and legacy Basketball plus
  Soccer behavior remain unchanged.
- BKE-4A begins only after the complete local event model, correction semantics, and detail surfaces
  are stable.

## 10. Architecture and File Ownership

Expected new Basketball-owned modules:

```text
src/lib/basketball/timeline.ts
src/lib/basketball/timelineCommands.ts
src/lib/basketball/shotDetail.ts
src/lib/basketball/shotEditCommands.ts
src/lib/basketball/eventEditCommands.ts
src/components/basketball/BasketballTimeline.tsx
src/components/basketball/BasketballEventDetailSheet.tsx
src/components/basketball/BasketballShotEditor.tsx
src/components/basketball/BasketballEventEditor.tsx
src/components/basketball/BasketballMarkerChooser.tsx
```

Exact names may follow established local patterns, but ownership boundaries are fixed:

- `src/lib/gameEvents/` remains sport-neutral and receives no Basketball policy.
- Its BKE-3C change is limited to a generic append-plus-mutate final-candidate primitive with
  duplicate-target/id/sequence validation and unchanged existing API behavior.
- `src/lib/basketball/` owns descriptors, compatibility checks, previews, commands, and projection
  semantics.
- React owns drafts, focus, tabs, and presentation only; it never builds event mutation batches.
- Existing family-specific command modules should be reused or extended rather than duplicated.
- `BasketballCourt` receives generic marker activation mechanics but no event-domain knowledge.

## 11. Validation Strategy

Each slice adds focused pure tests before UI exposure. The final BKE-3 gate includes:

- event-family descriptors, overlapping filters, period/side/player narrowing, grouping, ordinals,
  corrected/deleted presentation, and diagnostics;
- marker tap versus court capture, overlap chooser ordering, legacy read-only detail, and no guessed
  links;
- every individual/group remove consequence, selected-dependent restore, stale revision, atomic
  rollback, and quick-Undo receipt invalidation;
- all shot fields and relationship transitions, including locate/unlocate and cross-side changes;
- every remaining event editor and recorded-later addition against regulation, overtime reset/carry,
  inventory, disqualification, score, and trip rules;
- active, period-break, reopened, suspended, abandoned, completed, cloud-bound, malformed, parked,
  exported/imported, and hydrated states;
- complete legacy Basketball and Soccer suites unchanged;
- keyboard focus/escape, screen-reader status, narrow mobile sheets, stable tab dimensions, and no
  marker/court tap leakage;
- `pnpm test`, `pnpm lint`, `pnpm build`, and `git diff --check` for every implementation PR.

## 12. Approved Decisions

1. Use Track and Timeline tabs; Track preserves the existing court/grid workspace.
2. Use newest-first live Timeline ordering.
3. Render expandable persisted capture groups rather than inferred adjacency groups.
4. Retain quick newest-action Undo alongside Timeline.
5. Eventually edit every user-recorded Basketball family, not shots alone.
6. Keep period, terminal, and identity lifecycle events visible and read-only; roster addition keeps
   its established checked correction behavior.
7. Default to individual-event removal and make whole-group removal explicit.
8. Allow recorded-later additions to any started period without fabricated time.
9. Use one shared responsive detail sheet from markers and Timeline.
10. Include explicit court location editing in BKE-3.
11. Support full assist/rebound/block add, remove, and re-link.
12. Resolve pointer taps to the nearest marker and use a deterministic chooser for near-equal candidates.
13. Show current corrected values plus revision metadata; do not retain prior value snapshots.
14. Keep removed events collapsed by default.
15. Restore the selected event by default and require explicit dependent selections.
16. Keep ordinary local correction reason-free unless the existing domain contract requires one.
17. Fully edit structured foul fields with atomic dependent-link repair.
18. Fully edit free-throw trips and attempts while preserving attempt positions.
19. Fully edit validated ejection and timeout meaning.
20. Edit direct stats, minutes, and score adjustments at their source event.
21. Use detailed overlapping event-family filters.
22. Default to current period while active and Full Match after completion.
23. Include optional side and participant filters.
24. Require reasoned Reopen before terminal-game mutation.
25. Put game meaning before expandable technical metadata.
26. Save one complete draft atomically.
27. Return to and highlight the source view after save.
28. Use a near-full-screen mobile sheet and constrained desktop modal.
29. Deliver four slices: 3A review, 3B removal/restore, 3C F13, and 3D remaining editors/exit.
30. Give legacy markers read-only core detail without links or editing.
31. Leave legacy Recent Events unchanged.
32. Keep BKE-3 on the local Game Tracker; BKE-4D owns Summary and remote authority.
33. Let stat/administrative replay accept an already-started target period, and let administrative
    replay accept `period_break`, while checked live commands retain active/current-period
    enforcement; lifecycle replay remains unchanged.
34. Derive shot `valueSource` deterministically when location or value changes and label manual
    values in detail.
35. Treat complete projection as necessary but use Basketball command validation for warning-level
    relationship and duplicate-fact invariants.
36. Preserve checked remove/restore for roster additions without adding a payload editor or cascading
    away dependent history.
37. Describe `revision > 1` as Revised rather than claiming the payload was corrected.
38. Keep field-goal/free-throw attempt kind immutable in BKE-3.

No product decisions remain open for BKE-3 implementation.

## 13. Non-Goals

- Persisting prior field-value snapshots or adding a second correction audit store.
- Guessing links for legacy shots or promoting aggregate games into event authority.
- Editing lifecycle payloads or participant-resolution events directly. Roster additions retain
  checked remove/restore but receive no payload editor.
- Fabricating historical game times or rewriting immutable capture sequence.
- Adding Basketball event cloud rows, migrations, recorder streams, finalization, canonical
  publication, or Summary authority.
- Replacing legacy Basketball tracking before the BKE-5 opt-in.
- Adding game clock, substitutions, lineup intervals, possession tracking, or shot clock.
