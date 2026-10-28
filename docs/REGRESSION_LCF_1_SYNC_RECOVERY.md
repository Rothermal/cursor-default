# LCF-1: Revision and Pending-Primary Recovery

Status: merged in #512. On 2026-10-27 the owner confirmed migration 081 was
performed and the affected records could finally merge. This confirms that
recovery outcome, not every finalization, second-device or installed-PWA check.
No production migration, game mutation, import or sync was performed by the agent
during development.

## Reports and Causes

The newer private Basketball export contains 115 events and the screenshot's
32-31 score. It is a later export of the same game whose earlier 61-event export
stopped at 17-17. Neither export contains assists; the separately reported
second-game assisted-shot scoring concern remains open pending its own evidence.
Private exports and player identities are not committed.

The player-binding fix in #510 exposes the next transport blocker: four opponent
free throws were deleted locally before they could upload. The first is sequence
57, revision 2, with a deletion marker. The export records acknowledged cloud
state for the preceding 56 events, but none for these four. Migration 078's writer
accepts first uploads above revision 1 only for Baseball. It returns `conflict`
for this Basketball tombstone's absent-row path without any competing revision.
Retrying cannot change that contract. Resetting revisions or dropping removed
events would lose history and is not the repair.

The other game's screenshot shows `Invalid primary status.` in Recorder Streams.
When no recorder has a current checkpoint and no explicit primary is selected,
the shared reader compares a recorder UUID to NULL. SQL returns NULL for
`is_primary`; the strict client correctly rejects a non-boolean. The same query
incorrectly labels its source `default`. This prevents the recorder list from
rendering, independently of the user's team permissions.

## Implemented Scope

- Migration 081 admits a positive first-upload revision above 1 only with a
  persisted matching event setup: Soccer/Basketball setup 1 or 2,
  Hockey/Baseball setup 1. Aggregate-only and unsupported-sport games do not gain
  this path. Baseball's existing contract remains supported.
- Preserve actual revision, creation/update times and deletion markers. Keep all
  existing-row identity, stale/equal-revision conflict, auth, access and final
  audit-timestamp checks byte-for-byte outside the absent-row gate.
- Return `is_primary: false` and `primary_source: null` when no primary exists.
  Null team-role capability becomes false, never a permission grant. Fixed sport
  wrappers remain unchanged; the generic recorder reader stays private.
- Explicitly revoke the writer's direct `anon` grant as well as PUBLIC access.
  Hosted default privileges can grant EXECUTE directly to `anon`; replacing a
  function or revoking only PUBLIC does not remove that grant. Authenticated
  execution and the existing `auth.uid()` check remain unchanged.
- No parser weakening, automatic primary selection policy change, artificial
  checkpoint, result publication, client schema or rollout change.
- A stream still needs a complete current conflict-free checkpoint before it can
  be selected. Being the sole recorder is not permission to publish unsynced data.

## Observed Evidence

- Full suite: **342 files / 3,533 tests passed**; final focused rerun after a
  test-only TypeScript compatibility adjustment: **3 files / 16 tests passed**.
  Production build/TypeScript and PWA generation pass. Lint has zero errors and
  the three existing Fast Refresh warnings; staged diff checks pass. Vite's
  existing large-chunk advisory remains.
- Isolated PGlite/Postgres execution: **34 scenarios passed**, including both
  failures against original functions, migration rerun, all six supported
  sport/setup combinations, edited and removed first uploads, absent/malformed/
  wrong-sport setup rejection, normal and selected primary states, stale/equal
  conflicts, immutable identity, auth/read/write denial, final audit timestamps,
  owner/admin versus scorer/viewer/missing-role capability, and grants.
  The ACL fixture now gives new functions direct `anon`/`authenticated` grants:
  the pre-review migration fails its anonymous-permission check in this setup;
  the explicit revoke repairs it. This does not claim the live project's ACL
  was inspected.
- Private-export database replay seeded the 56 acknowledged events, reproduced
  the original rejection at sequence 57, then uploaded all 115 events with the
  repaired writer. Every revision and all four deletion markers were preserved.
  This used an in-memory database with minimal fixture tables and authorization/
  checkpoint stubs, not live Supabase/RLS or a full installation of all migrations.
  All five read-only verification-script checks also pass in that database.
- Separate real Basketball projector/serializer replay: **1 file / 1 test passed**;
  all 115 events map across 11 participants after normalized reload. Score stays
  32-31: tracked 3 FT + 10 twos + 3 threes; opponent 11 twos + 3 threes. No assist
  events exist in this recording, so it does not resolve the other scoring report.
- Committed source-contract tests compare both new functions with their previous
  definitions to constrain the changed surface. Shared client tests exercise
  pending rows for all four sports and retain strict rejection of nullable flags.

## Owner Verification After Merge

Owner confirmation above supersedes the migration-pending status. Keep the
following operator steps as reference; checks not specifically confirmed remain
pending, including publication/cloud Summary and the separate scoring report.

1. Apply migration 081 in Supabase SQL Editor. Then run the read-only
   [verification script](../supabase/scripts/verify_081_event_sync_recovery.sql);
   all five results should be true. Existing migration files are not modified.
   If `writer_authenticated_only` is false, the expected function ACL is not in
   place: confirm the latest 081 script, including its explicit `anon` revoke,
   ran successfully. Do not grant anonymous access or weaken the check; retain
   the result for diagnosis if it still fails.
2. Retain the export and retry the existing Basketball game once. Do not import a
   duplicate recording, reset revisions, restore deleted attempts or clear storage.
   Check the 32-31 score remains and sync obtains a current checkpoint.
3. Refresh/reopen the other game's cloud Game Info. Recorder Streams should render
   instead of `Invalid primary status.`. If its checkpoint is stale, resume that
   original local game and sync first; a disabled selection is then intentional.
   A healthy creator/sole stream can become the default primary under the existing
   policy, or an authorized owner/admin can select a healthy stream explicitly.
4. Complete and finalize through the ordinary workflow, then verify cloud Summary.
   Owner live-cloud, physical-mobile and installed-PWA replay remain pending until
   actually performed. If another error appears, retain its export for diagnosis.
