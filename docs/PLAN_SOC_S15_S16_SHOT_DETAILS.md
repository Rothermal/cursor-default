# S15/S16 - Shot Body Part and Goal Placement

Status: reader/preservation and combined capture/review UI implemented;
deployed owner verification pending.
Owner authorized the foundation and confirmed shootout inclusion after PR #413.

## Confirmed decisions

- S15 offers one optional body-part selection on every shot outcome: Left foot,
  Right foot, Header, or Unspecified. Own goals are included. Old events remain
  unspecified; never infer that an unspecified shot used a foot.
- Shootout kicks support Left foot / Right foot / Unspecified, never Header.
  Goal-mouth placement is supported only for scored shootout kicks. Shootout
  capture and review UI belong in the same writer release as ordinary shots.
- S16 offers optional goal-mouth placement only for scored goals, including own
  goals. The view faces the goal the ball entered, from the shooter's perspective.
- Both controls live in a collapsed Shot details section of the existing capture
  dialog. Neither adds a required field or a separate required save step. Body
  part is available for all outcomes; placement is available only for goals.
- Preserve the existing pitch location as the shot origin. Goal-mouth placement
  is a separate coordinate, never a replacement for GameEvent.location.
- Derive approach angle automatically from the origin toward the center of the
  goal being attacked (for an own goal, the goal the ball entered). Display a
  pitch line and angle in degrees, with zero meaning straight-on. No extra entry.
- Approach angle is independent of placement. The pitch line ends at goal center,
  not at the placement marker; it represents shooting position, not an exact
  trajectory. Do not imply measured curve, deflection, elevation, or 3D flight.
- Unlocated goals may have placement but have no approach angle.
- Changing Goal to a non-goal outcome clears placement but retains body part.
- Changing shooter retains the details. Editing origin or attacking direction
  recalculates the angle from the corrected event context.
- Existing detail editing permits adding, changing and clearing optional details.
- Timeline rows show a compact body-part label only. Timeline/pitch detail views
  show body part, placement and approach angle together. Summary reuses the
  presentation read-only.
- No new aggregate statistics, heatmaps or expected-goals calculations.

## Proposed representation and geometry

These implementation details require a code assessment before being finalized:

- Extend existing shot/own-goal payloads with optional, strictly validated fields;
  use an extensible body-part value, not independent booleans.
- Unspecified is a UI label for absent body-part metadata, not a stored
  `'unspecified'` literal. Selecting it clears the field. Legacy absence has the
  same meaning; do not infer whether the recorder deliberately skipped selection.
- Define normalized goal-mouth coordinates explicitly: proposed x=0 left, x=1
  right, y=0 crossbar, y=1 ground, always facing the entered goal. Display flip
  changes neither stored placement nor its viewpoint.
- Derive approach angle using real pitch proportions rather than treating the
  normalized x/y square as equal physical dimensions. Audit existing field
  geometry and disclose that the result is a diagram-based estimate, not a
  measured ball trajectory. Set rounding and singular-origin behavior explicitly.
- Resolve goal end from event-time attacking direction and scoring/own-goal
  semantics. Never use the current display flip or current match direction to
  reinterpret a historical goal.
- Keep angle derived rather than persisting redundant data. Missing or invalid
  geometry must suppress the angle, not fabricate a straight-on result.

## Compatibility and delivery assessment

Inventory event validators, payload cloning, checked capture/correction helpers,
projection, Timeline, field details, Summary, transport, conflict recovery and
canonical source readers. Determine event-version and capability requirements
before writing new fields. Preserve old payload validity and official totals.

Reader support must be available before writers emit new metadata. Decide whether
that requires separate deployments or a guarded writer in one coherent PR after
examining the deployed validation path. Do not assume migration-free support.
Keep S1 capture redesign and PR #410 timing work outside this plan.

Verified compatibility asymmetry: `validateShot` in `src/lib/soccer/events.ts`
currently ignores unknown payload keys, but `validateOwnGoal` requires an empty
object (`SoccerOwnGoalPayload = Record<string, never>`). Any new own-goal metadata
therefore fails validation on existing readers and makes stream inspection
incomplete; it is not merely hidden detail. Shot tolerance alone does not prove
end-to-end field preservation. Reader-first deployment and an explicit old-client
writer/rollout policy are prerequisites, including cached/offline clients. A server
capability check alone does not prove every reader has upgraded. Assess the actual
version/upgrade strategy before enabling either own-goal metadata writer.

Owner prioritization supersedes the backlog's original S1-first ordering: S15/S16
may proceed independently in the existing dialog's optional collapsed section.

## Verification requirements

- Every body-part value across `goal`, `saved`, `blocked`, `off_target`, `woodwork`
  and the separate `soccer.own_goal` event path.
- Optional fields absent on old events; no inferred attribution or changed totals.
- Placement present only on goals; outcome correction clears it atomically.
- Shooter changes preserve details; origin/direction changes recalculate angle.
- Both goal ends, tracked/opponent sides, own goals and flipped field display.
- Straight-on versus diagonal origins using physical aspect ratio; absent origin
  and degenerate geometry do not produce misleading angles.
- Placement edit/clear, historical roles/direction, Undo/Restore and grouped edits.
- Consistent Timeline, marker detail and read-only Summary authority.
- Round trips through parking, import/export, sync/conflict and canonical review.
- Mobile and desktop goal-mouth placement with keyboard-accessible alternatives;
  collapsed details never block the ordinary shot-save workflow.

## Remaining work before implementation

Review the proposed contracts and two-release sequence below, then implement the
foundation tests. Product answers above are confirmed; runtime and deployment
verification remain implementation work.

## Architectural assessment

### Verified integration points

Source paths in this section are repository-relative. Bare Soccer domain filenames
below resolve under `src/lib/soccer/`; the explicit inventory is:

- Domain: `src/lib/soccer/types.ts`, `src/lib/soccer/events.ts`,
  `src/lib/soccer/live.ts`, `src/lib/soccer/projector.ts`,
  `src/lib/soccer/field.ts`, `src/lib/soccer/summaryField.ts`,
  `src/lib/soccer/releaseCapabilities.ts`.
- Event platform: `src/lib/gameEvents/cloud.ts`, `src/lib/gameEvents/registry.ts`.
- Capture/review: `src/components/soccer/SoccerShotCaptureDialog.tsx`,
  `src/components/soccer/SoccerField.tsx`,
  `src/components/soccer/SoccerTimeline.tsx`,
  `src/components/soccer-summary/SoccerFieldReview.tsx`, `src/pages/SoccerSummary.tsx`.

### Confirmed scope: shootout kicks

The six-helper inventory below covers `soccer.shot` (including in-match penalty
shots) and `soccer.own_goal`. It does not cover the distinct `soccer.shootout_kick`
family. That family has `scored`, `saved`, `missed`, `woodwork`, `retake`, and
`forfeited` outcomes in `src/lib/soccer/types.ts`, plus separate capture/revision
helpers in `src/lib/soccer/live.ts` and a shootout workspace/review flow.

Owner confirmed inclusion: Left/Right foot only, and placement only when scored.
`recordSoccerShootoutKick` and `reviseSoccerShootoutKick` extend the original
six-helper inventory. The shared correction boundary preserves detail for all
three event families. No located origin is inferred from the fixed penalty spot;
unlocated shootout kicks have no approach angle. Reader tests include every
shootout outcome, forbid Header and limit placement to scored kicks.

### Integration table

| Surface | Evidence and required work |
| --- | --- |
| Payload contracts | `types.ts` defines shot outcome/situation/source and empty own-goal payload; `events.ts` validators differ in unknown-key tolerance. Extend both with strict optional details without changing score semantics. |
| Capture/correction | `live.ts` has six relevant helpers: live, historical and revise for shot and own goal. All construct payloads explicitly; all must participate. Existing revise helpers would drop details even after reader validation is widened. |
| Shared dialog | `SoccerShotCaptureDialog.tsx` owns live/historical/edit modes, event/revision-based initialization, outcome and own-goal actors. Add detail draft state here without coupling it to actor defaults or parent clock redraws. |
| Raw transport | `gameEvents/cloud.ts` passes payload through RPC mapping and cloud reads. Migration 042 stores JSON objects; the latest upsert definition located in migration 055 passes payload into storage with existing access/revision guards. No dedicated shot columns are required. |
| Version handling | `events.ts` stamps a shared Soccer schema version; the registry rejects newer versions and migrates older ones by event definition. A global version bump would affect unrelated families and is not justified for optional detail fields. |
| Backend capability | `releaseCapabilities.ts` describes backend/setup support, not the application version of other readers. It cannot establish that stale browsers or installed PWAs understand own-goal metadata. |
| Geometry | `SoccerField.tsx` renders 100:64; `field.ts` maps flipped taps to canonical coordinates. `summaryField.ts` separately transforms locations for review orientation. Compute angle before view transforms. |
| Own goals | `projector.ts` derives the own-goal actor side as the opposite of event.teamSide. The event side is the beneficiary. The capture dialog already saves location.attackingDirection for that beneficiary; do not invert it again for an own goal. |
| Review | `SoccerTimeline.tsx`, `soccer-summary/SoccerFieldReview.tsx`, and `SoccerSummary.tsx` are the integration surfaces. Add a shared display-only shot-details component rather than putting remote Summary data into the live editor/state. |

### Proposed payload contract

Retain event schema version 1 with these optional fields on shot/own-goal events;
shootout kicks use the same shape except that Header is excluded:

```ts
bodyPart?: 'left_foot' | 'right_foot' | 'header'
goalPlacement?: { x: number; y: number }
```

Absence is unspecified/unrecorded. New writers omit cleared fields, never emit
an `undefined` JSON value or a stored unspecified literal. Placement requires
finite numbers in [0,1] and exactly x/y keys; ordinary shots may carry it only
when outcome is goal. Own goals inherently qualify. Reject malformed metadata,
including unknown body-part values; do not silently normalize corruption.

Keep old empty own-goal payloads valid. Preserve ordinary-shot unknown-key behavior
unless an independent compatibility audit justifies narrowing it. This optional
v1 extension is deliberately NOT compatible with pre-reader own-goal clients.

Correction semantics must distinguish omitted detail input (preserve existing)
from an explicit clear instruction in command input. Commands canonicalize clears
to absent payload fields. Non-goal outcome changes clear placement regardless of
preservation; body part survives. This lets the reader release protect metadata
through existing editor flows before those editors expose detail controls.

### Proposed geometry contract

Goal-mouth x runs left-to-right and y crossbar-to-ground, facing the entered goal.
Pitch display flip never changes either stored detail. For a located goal with a
known saved attackingDirection, use its canonical goal end. For historical data
without a known direction, suppress angle until a reliable context is available;
never silently substitute the current tracker direction.

For goal center (gx, 0.5), use absolute longitudinal distance
`abs(gx - origin.x) * 100` and lateral distance `abs(0.5 - origin.y) * 64`.
The magnitude is `atan2(lateral, longitudinal) * 180 / PI`, rounded to the nearest
whole degree for display. The line supplies which side the shot came from; no
signed-angle convention is needed. Center-on-goal is undefined and has no angle;
an origin elsewhere on the goal line can yield 90 degrees. Use a small documented
numeric tolerance only for coincident points. Invalid/missing coordinates yield
no line/angle. The 100:64 ratio is a diagram estimate, not claimed match dimensions.

Derive the line from origin to goal center independently of placement. Saved
event-direction corrections update its result; view rotation only rotates the
line. Placement remains shooter-facing even when origin or goal end changes.

### Two-release recommendation

1. **Reader/preservation foundation:** types, strict metadata validation, correction
   preservation, pure geometry/detail readers and tests. No production UI writes
   metadata. Prove raw payload round trips, unchanged score/aggregate outputs,
   old empty own goals and unsupported-old-reader failure fixtures. Keep historical
   event IDs, revisions and fingerprints unchanged until an actual edit occurs.
2. **Capture and review:** optional details editor, goal-mouth input, shared detail
   presentation and compact labels. Ship together in one coherent UI release, not
   separate PRs for each review page. Include keyboard-accessible placement controls,
   clear action and mobile/desktop visual checks. Test every correction path.

Before enabling release 2 for the current single-user deployment, confirm all
participating browser tabs/devices and installed PWAs have loaded release 1 or
newer. This is an operational owner-only rollout, not a guarantee for arbitrary
old clients. A rollback must retain reader/preservation support and disable only
new capture. Reverting to pre-reader clients after writing metadata is unsafe.
Broader multi-user enablement needs an enforced client-upgrade strategy rather
than relying on this manual confirmation.

Current storage inspection suggests no migration is needed for the payload fields
themselves. Validate exact payload round trips and active database constraints
before writer release; no live database verification was performed in this
assessment. A backend enforcement strategy, if later selected, may require one.

### Exit tests for the foundation

- Legacy fixtures retain identical projection, score and canonical fingerprint.
- New metadata survives serialize/pull/push mapping and correction through all six
  shot/own-goal helpers; omission preserves, explicit clear removes.
- Non-goal placement is rejected on reads and cleared by valid outcome correction.
- Each outcome includes all three body-part values plus absent details.
- Both own-goal beneficiary sides resolve the entered goal without double inversion.
- Angle tests cover center, mirrored diagonals, 100:64 ratio, goal-line origins,
  unknown direction, view flip and placement independence.
- Old own-goal validation failure is documented and tested as a rollout boundary,
  never represented as successful backward compatibility.

Assessment scope: local source and migration definitions reviewed; no runtime,
database, or UI changes made. The two-release contract is the recommended next
implementation sequence, not a claim that release gates have been satisfied.

## Foundation delivery record

The preceding assessment describes the pre-implementation investigation. The
reader/preservation release now implements:

- `src/lib/soccer/shotDetails.ts`: strict metadata validation, clone-safe
  preserve/clear behavior and pure 100:64 approach geometry.
- `types.ts` and `events.ts`: optional v1 details on ordinary shots and own goals;
  Left/Right foot only on shootout kicks; scored-only goal placement. Old absent
  fields and empty own goals remain valid; malformed metadata is rejected.
- `live.ts`: `updateSoccerHistoryEvent` preserves omitted metadata centrally for
  all existing correction helpers, treats null as explicit clear input, omits
  cleared fields from persisted JSON and clears placement for non-scoring outcomes.
- No production capture controls or capture-input extensions. Existing live and
  historical capture continues emitting its existing payload shape; synthetic
  new-metadata fixtures exercise reader compatibility and correction preservation.
- No global event-version bump, database migration or raw historical rewrite.

Verification: 1,798 tests across 210 files passed; TypeScript and targeted ESLint
passed. Tests cover all body-part/outcome combinations, malformed coordinates,
legacy own-goal acceptance/old-reader incompatibility, ordinary/own-goal/shootout
editor preservation, clear semantics, JSON/cloud mapping and approach geometry.
Live database and multi-device refresh checks remain pending before writers ship.

Deferred exit coverage: the own-goal beneficiary -> stored capture direction ->
entered-goal test moves to the writer release. Foundation tests cover canonical
geometry at both ends, not the dialog's beneficiary selection. Writer acceptance
must drive both own-goal beneficiary sides through the actual capture path and
assert the stored direction and approach target, including field flip. Do not
substitute a hand-built location test for this integration check.

Review hardening: the shared preservation preparation also covers the generic
`UPDATE_GAME_EVENT` reducer action (unused by current UI), with a regression test.
The old-client boundary test compares a frozen empty-payload validator against
the real serialized/deserialized event and current definition, plus a legacy control.

The foundation shipped in PR #414. The owner confirmed all participating browsers
and installed PWAs refreshed before this writer release.

## Combined capture/review delivery

- Live and historical shots and own goals accept optional body part and scored-only
  placement; correction supports preserving, changing and explicitly clearing both.
- The existing capture dialog has collapsed Shot details. Own goals use the
  beneficiary side's direction exactly once. Changing outcome clears placement.
- Shootout quick outcome buttons remain immediate. Optional Shot details offers a
  detailed outcome/foot/placement path; either save path uses the selected details.
  Successful capture clears the draft. Kick correction includes the same controls.
  Header and inferred approach/origin are never offered for shootouts.
- Timeline (including Summary), Field review, and shootout review reuse the same
  read-only body-part, goal-mouth and derived approach presentation. Legacy absent
  details remain explicitly unspecified/unrecorded.
- No migration, aggregate change, new event version, or historical rewrite.
  Rollback must retain PR #414 readers and preservation; disable/revert only these
  new capture controls, never downgrade stored-event readers.

Verification is recorded in [REGRESSION_SOC_S15_S16_SHOT_DETAILS.md](REGRESSION_SOC_S15_S16_SHOT_DETAILS.md).
Live database constraints and deployed cloud/PWA round trips were not exercised by
the local harness; these remain owner smoke checks, not claimed as completed.
