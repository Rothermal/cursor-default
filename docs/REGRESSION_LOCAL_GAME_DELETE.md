# Explicit Local Game Deletion

Status: Implemented for sport dashboard parked games; owner deployment smoke pending.

The former Discard button is now Delete local copy. A confirmation explains permanent
loss of unsynced data, no upload and no cloud deletion, the Settings > Data export
alternative, and the need to close other tabs using the game. Cancel is inert.

The context API keeps its unsynced-data guard by default. Only explicit acknowledgement
from this action allows deletion without syncing. It rechecks current active identity
and rejects an active game or an in-flight sync in this app instance. Deletion removes
the record from the manifest/dirty queue, refreshes the pending flag, and clears only a
matching Basketball draft/resume shortcut. Unrelated games and drafts are untouched.
Cleanup failure is reported separately after successful record deletion. Storage
deletion uses the existing parking snapshot rollback when a write fails.

This does not delete cloud games, recorder streams, teams, roster identities, or data
on other devices. Existing cloud copies remain available for intentional reopening.
It does not cancel an already-issued request in another browser tab or device; close
other tabs before deleting. Cross-tab write coordination remains a separate concern.
Active-game reset, Settings bulk wipe and finalization guards are not loosened.

## Verification

- 224 files / 1,885 tests pass. New tests cover ordinary blocking, explicit override,
  pre-first-upload games, active/sync rejection, Cancel/Confirm component callbacks,
  warning content and rollback when the manifest write fails.
- Typecheck and lint pass (three existing Fast Refresh warnings).
- No production game was deleted or cloud data modified during development.

## Owner Smoke

1. Park an expendable test game with unsynced changes; export it first if needed.
2. Delete local copy, then Cancel: it should remain.
3. Delete local copy and confirm: it should disappear without requiring upload.
4. Reload: it should remain absent from parked games. Other parked games remain.
5. For a previously synced game, verify the existing cloud game is still available.
6. During sync, retry only after it finishes. This action does not cancel that upload.
