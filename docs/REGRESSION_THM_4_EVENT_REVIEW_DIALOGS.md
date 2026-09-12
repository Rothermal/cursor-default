# THM-4 Event-review Dialog Verification

## Scope

BasketballShotDetailDialog, BasketballEventDetailDialog, and
BasketballTimelineCorrectionDialog use semantic surfaces, text, separators,
diagnostics, action colors, and disabled states. Remove confirmation retains
danger-action styling; restore uses application accent. Revised and removed
labels remain distinct, including struck-through removed relationships.

Overlays explicitly use 45% opacity. Fixed header/footer regions leave the body
scrollable; close controls cannot shrink. Long metadata, relationship labels,
warnings, restore options, consequences, and errors wrap within their columns.
The native restore checkbox uses application accent and retains its dimensions.

Only presentation classes changed in runtime components. Correction previews,
dependency selection, validation, dispatch, focus behavior, callbacks, and
authority remain unchanged. No migration or production Dark enablement.

## Evidence

- Appearance inventory covers all three files with targeted guards for
  translucent overlays, fixed close/header/footer sizing, metadata/diagnostic
  wrapping, and remove/restore/disabled confirmation colors. The audit excludes
  only the exact existing domain prose `return 'Lineup transition'` from its
  transition-utility check, after asserting exactly one occurrence.
- Actual-component Edge fixtures: 32 cases across 390px/1280px widths, 640px
  height, and Light/Dark. General event detail; editable shot; read-only legacy
  shot; removed shot with Restore; removal success; dependent restore selection;
  blocked preview; failed application. Long unbroken fixture text was included.
- Assertions checked edit/remove/restore callbacks, read-only action absence,
  dependent checkbox selection reaching the preview helper, successful mock
  application dispatch plus applied/close callbacks, disabled blocked action,
  failure without dispatch, Escape, viewport dialog bounds, no document overflow,
  no page errors, and computed 45% overlay opacity. Shot technical details were
  expanded. Mobile Dark shot and failed-correction screenshots were inspected.
- GameContext and correction preview/application helpers were mocked. This tests
  presentation and callback wiring, not actual consequence computation or reducer
  mutation. No real game data or cloud writes. Temporary fixtures were removed.
  Full automated suite/build/lint results are recorded in the PR.

## Release Follow-up

Validate real Tracker/Timeline/Summary composition, permission-driven action
availability, actual correction consequences and dependency restoration,
stale-preview failures, focus traversal, and PWA/offline use. The Timeline host,
historical editors, court/capture, remaining tracker controls, and Summary remain
outside this batch. THM-4 and the THM-6 production Dark audit are not complete.
