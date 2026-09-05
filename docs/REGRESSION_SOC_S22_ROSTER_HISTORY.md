# Regression - SOC-S22 roster history recovery

**Migration:** apply `067_roster_history_binding_recovery.sql` first.

## 1. Ordinary roster removal

1. Create a Soccer team player and start a local team match containing that player.
2. From Team Manage, use **Remove**, not permanent delete.
3. Continue or complete the match and retry cloud sync.

Expected: the inactive membership remains valid; binding and sync succeed with the
same participant and event counts.

## 2. Permanent deletion guards

1. With an active or parked local match referencing a player, attempt permanent
   deletion from Team Manage and Settings -> Advanced.
2. Attempt deletion of a cloud player that already has event or legacy game history.
3. Create a disposable player with no game history and permanently delete it.

Expected: the first two paths explain that history must be preserved. The clean
disposable identity deletes successfully.

## 3. Already-affected local match

Use the original recovery export when available, or reproduce by creating a match
before migration 067 and permanently deleting one source player before first bind.

1. Record the local participant count, event count, score, status, and clock state.
2. Open the match and observe the known source-team binding error.
3. Export recovery JSON once more before repair.
4. Choose **Preserve History**, review the explanation, and confirm as team owner/admin.
5. Wait for cloud sync, then open the cloud match and its Timeline/Summary.

Expected: sync succeeds; the deleted identity is an unlinked frozen participant;
all recorded values from step 1 are unchanged; no participant or event duplicates
appear; finalization/reopen behavior matches the local state.

## 4. Authority failures

1. Open the known recovery failure as a scorer or viewer.
2. Confirm **Preserve History** is absent, then verify a crafted recovery RPC call
   is rejected by the server.
3. As an owner/admin, retry with a source player that still exists but has no
   source-team membership.
4. Force one owner/admin recovery attempt to fail, then retry ordinary sync after
   resolving the unrelated failure.

Expected: owner/admin authority is required, and an existing wrong-team identity
continues to fail normal binding validation. A failed recovery does not leave
durable recovery approval on later retries. No partial game, participant, or event
rows are created by any rejected attempt.

## 5. Cross-sport smoke

Start one Basketball event game after migration 067 and sync normally. If a
pre-existing Basketball fixture has the deleted-source failure, also confirm its
**Preserve History** action follows the same owner/admin contract.

Expected: the v5 wrapper delegates to v4 behavior, the game binds once, and no
recovery flag is required.
