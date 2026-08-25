# BKE-5C4 Enable Cloud Sync Regression Record

Status: Implementation complete. Automated exit evidence is recorded below. Live Supabase,
two-device, role-change, and installed-PWA evidence remains part of the BKE-5D production opt-in
signoff; no release policy changes in this slice.

Plan: [PLAN_BKE_5C_SETUP_AUTHORITY_AND_BINDING.md](PLAN_BKE_5C_SETUP_AUTHORITY_AND_BINDING.md)

## 1. Delivered Contract

- Game Tracker and local Summary offer **Enable Cloud Sync** only for an explicit, healthy
  local-only Basketball Event stream whose events belong to the signed-in recorder. Summary keeps
  the action reachable after completion or suspension routes the game out of live tracking.
- The irreversible cloud transition requires confirmation and performs fresh app-access,
  source-team tracking-role, and migration-062 release-capability checks.
- The existing Basketball v4 binder remains the only game-creation/adoption path. Its returned
  game id is checked against every other local parked binding before remote pull or event upload.
- Bind, same-recorder pull/merge, complete event upload, and checkpoint all finish before the local
  policy changes from `local_only` to `automatic` or any binding metadata is installed.
- A local edit, active-game switch, duplicate binding, authorization/capability failure, transport
  failure, checkpoint failure, or storage failure leaves the local policy, events, parked identity,
  and active state unchanged. A failure before upload may leave an idempotently reusable binder
  shell. If a local edit is detected only after upload and checkpoint finish, cloud may contain the
  complete pre-edit recorder stream while the unchanged local game remains local-only; a deliberate
  retry reuses that binding and reconciles the latest stream.
- Confirmed state replacement snapshots and restores the parked record, manifest, active mirror,
  and pending-sync flag together when browser storage fails.
- Successful conversion persists a clean automatic binding, survives park/resume/reload, and routes
  only through Basketball Event transport. It never enters legacy aggregate sync.

## 2. Automated Evidence

The BKE-5C4-focused coverage proves:

- exact signed-in recorder ownership and malformed/bound local-only rejection
- fresh app-access, source-team role, and release-capability gates before transport
- personal-source role-check omission and team scorer/owner/admin acceptance
- local snapshot revalidation after asynchronous preflight
- binder-result duplicate validation before cloud pull, upload, conflict write, or checkpoint
- automatic policy/binding installation only in the returned post-checkpoint state
- atomic record/manifest/mirror rollback on local storage failure
- successful automatic binding round-trip through park, resume, and reload
- `basketball_events` routing after conversion and permanent exclusion from aggregate routing
- unchanged Soccer transport and legacy Basketball behavior through the complete suite

Verification at implementation head:

- `pnpm typecheck` - passed
- focused BKE-5C4 suite - 4 files / 78 tests passed
- `pnpm test` - 165 files / 1,134 tests passed
- `pnpm lint` - 0 errors; 6 existing Fast Refresh warnings
- `pnpm build` - passed; existing Browserslist-age and chunk-size warnings only
- `git diff --check` - passed

## 3. Manual BKE-5D Carry-Forward Matrix

These checks deliberately remain unchecked until BKE-5D runs against the deployed backend and the
installed production-like PWA. They do not block the internal BKE-5C implementation merge.

- [ ] Personal local-only: record several events, reload, confirm the enable prompt, and verify one
  cloud game, one recorder stream, exact score/events, a current checkpoint, and automatic status.
- [ ] Team local-only as owner/admin/scorer: verify source team/season and participant links, then
  confirm the game appears once in Team Info and Cloud Games.
- [ ] Team role revoked to viewer before enable: verify the fresh check rejects, no event rows upload,
  and local tracking/export remain intact.
- [ ] Offline or stale installed PWA: verify the command fails without local mutation; reconnect or
  update, retry, and confirm the idempotent binder does not create a duplicate game.
- [ ] Edit or switch games while enablement is waiting: verify the stale operation is rejected and a
  deliberate retry uploads the latest complete stream. If rejection occurs after upload/checkpoint,
  confirm the pre-edit cloud game is visible once and the retry reuses it rather than creating a
  duplicate.
- [ ] Park, resume, reload, and restart the installed app after success: verify the same local/cloud
  binding and ordinary automatic sync resume.
- [ ] Keep a Soccer game, a legacy Basketball game, an automatic Basketball Event game, and a
  local-only Basketball Event game parked together; verify only eligible dirty records sync and no
  authority writes through another sport's transport.
- [ ] Finalize/reopen and aggregate-review the converted game using the existing BKE-4C/BKE-4D/BKE-4E
  matrix; verify one canonical authority and no legacy Basketball rows for the Event game.

## 4. BKE-5D Handoff

BKE-5C is implementation-complete but remains under the internal Basketball Event creation gate.
BKE-5D owns the centralized `internal -> opt_in` release policy, default-off device preference,
combined BKE-4/BKE-5 live evidence, owner acceptance, production rollback instructions, and the only
change that may expose Event creation to production users.
