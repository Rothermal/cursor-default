# S15/S16 - Shot Body Part and Goal Placement

Status: product Q&A decisions confirmed; implementation assessment pending.
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

Perform the code-backed assessment, settle exact payload/version and geometry
contracts, and write acceptance tests plus a deployment sequence. Product answers
above are confirmed; these technical contracts are not yet claimed as verified.
