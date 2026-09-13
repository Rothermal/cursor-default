# S15/S16 - Shot Body Part and Goal Placement

Status: product Q&A confirmed; code-backed architectural assessment complete;
proposed two-release implementation contract below awaits review.
No runtime implementation is authorized by this document alone.

## Confirmed decisions

- S15 offers one optional body-part selection on every shot outcome: Left foot,
  Right foot, Header, or Unspecified. Own goals are included. Old events remain
  unspecified; never infer that an unspecified shot used a foot.
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

### Open scope decision: shootout kicks

The six-helper inventory below covers `soccer.shot` (including in-match penalty
shots) and `soccer.own_goal`. It does not cover the distinct `soccer.shootout_kick`
family. That family has `scored`, `saved`, `missed`, `woodwork`, `retake`, and
`forfeited` outcomes in `src/lib/soccer/types.ts`, plus separate capture/revision
helpers in `src/lib/soccer/live.ts` and a shootout workspace/review flow.

The confirmed phrase "all shots" did not explicitly settle shootout inclusion.
Do not treat its omission from the current implementation map as owner-approved
exclusion. Recommendation: defer shootout-specific UI to a named follow-up while
keeping the detail contract reusable, but confirm this boundary with the owner
before finalizing writer scope. If included now, extend the helper inventory,
reader/preservation tests, scored-only placement rules and shootout review plan;
do not infer a located origin merely because penalty kicks use a fixed spot.

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

Retain event schema version 1 with these optional fields on both event families:

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
