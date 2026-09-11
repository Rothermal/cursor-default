# THM-4 Cloud-status Verification

## Scope

BasketballRecorderStatus, BasketballEnableCloudPanel, and EventCloudConflictDialog
use semantic colors. Shared conflict presentation also applies to Soccer.
Local/cloud choices remain distinct; busy buttons use disabled fill and text.
Export/close controls retain fixed dimensions and the overlay remains translucent.
Long period identifiers wrap within the conflict detail column; enable errors wrap.

Only presentation classes changed. No cloud enablement eligibility, hook,
transport, conflict-resolution, export, authority, or navigation logic changed.
No migration. Production Dark stays gated. Tracker inline notices and remaining
court, legacy, recent-event, Timeline, and Summary surfaces are outside this batch.

## Evidence

- Appearance inventory covers all three files, with targeted checks for conflict
  overlay/control sizing, period wrapping, busy choice colors, and the enable
  action's size/disabled tokens.
- Actual-component Edge fixtures: 32 cases at 390px/1280px and Light/Dark.
  Recorder ready/attention, loading, error, and empty states; cloud-enable
  confirmation/busy/error; Basketball and Soccer conflicts; busy conflicts.
  No page errors or document overflow. Mobile Dark conflict and enable-error
  screenshots were inspected.
- Ready recorder navigation reached the game detail URL. Enable confirmation
  invoked a mocked async operation, disabled its button while pending, and
  displayed a synthetic failure on settlement. Both resolution choices, export,
  and close callbacks ran; busy resolution buttons were disabled. Long payload
  strings and period ids plus active/removed revisions were included.
- Auth/GameContext, recorder presence, cloud-enable eligibility, and Supabase
  were mocked. The fixture does not validate real enablement authorization or
  cloud uploads/resolution. No real game data or cloud writes were involved.
  Temporary fixtures/screenshots were removed.

## Release Follow-up

Verify real tracker composition, eligibility-hidden states, primary/checkpoint
refresh, successful enablement, actual recovery download, multi-conflict queue
advancement, real resolution settlement, keyboard traversal, PWA/offline, and
cross-device sync. Existing ConfirmDialog owns enable confirmation styling.
These focused checks are not complete THM-4 or production Dark release signoff.
Full automated suite, production build, and lint results are recorded in the PR.
