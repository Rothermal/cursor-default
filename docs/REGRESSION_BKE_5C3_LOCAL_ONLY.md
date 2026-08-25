# BKE-5C3 Basketball Capability and Local-Only Regression

Status: implementation complete. No Supabase migration is required. Basketball Event creation
remains behind the internal gate; BKE-5C4 and BKE-5D remain before release.

## Scope

- automatic Event setup preflights migration 062 capabilities after source/rules validation and
  before capacity, active-game confirmation, tournament writes, or context commit
- failures expose Retry Check, Legacy Cloud, Event Local-Only, and Cancel without silently changing
  authority or replacing the active game
- new Event games persist exact `automatic | local_only` policy in cloud-sync metadata
- pre-C3 Event games with no policy retain automatic compatibility without hydration rewrites
- malformed persisted policy resolves fail-closed while retaining its raw value and any binding as
  repair evidence; Legacy games discard the Event-only field
- local-only team games keep source team/season in immutable setup while cloud binding ids stay null
- local-only survives active storage, parking, reload, export/import, and recovery-state persistence
- local-only is excluded from dirty queue eligibility and guarded again before Basketball bind, pull,
  merge, upload, or checkpoint orchestration
- live and parked surfaces label the game `Cloud Sync: local only`

## Automated Evidence

Recorded 2026-08-25:

- focused capability/policy/setup/transport/parking suite: 8 files, 130 tests passed
- `pnpm test`: 164 files, 1,121 tests passed
- `pnpm typecheck`: passed
- `pnpm lint`: zero errors; six existing Fast Refresh warnings, including the separate worktree
- `pnpm build`: passed; existing Browserslist freshness and bundle-size warnings only
- `git diff --check`: passed

Coverage includes policy compatibility and malformed-input normalization, source/binding separation,
gameplay-fingerprint exclusion, sticky metadata merges, route rejection, zero-RPC transport rejection,
parking/export/import persistence, recovery choices, and preflight ordering before mutation.

## Manual Checks

1. In development, choose an existing Basketball team and Event authority. Go offline before Next.
   Confirm the failure message offers all four recovery actions and the current game remains active.
2. Choose Event Local-Only. Confirm the rules review remains Event, the policy label changes to Local
   only, and Next proceeds without another capability request.
3. Add players and start. Record an event, reload, park/resume, and confirm tracking remains intact and
   both tracker and dashboard say `Cloud Sync: local only`.
4. Export parked games, import on an empty device profile, and confirm the game remains local-only with
   no cloud game/team binding or pending-sync badge.
5. Repeat the failed preflight and choose Legacy Cloud. Confirm the draft returns to Legacy and follows
   the existing aggregate setup path after review.
6. Repeat and choose Cancel. Confirm the setup draft clears, the source route opens, and no game,
   tournament, parking, or authority mutation occurred.
7. Start an automatic Event team game while online. Confirm capability success proceeds and ordinary
   Basketball Event cloud sync remains available.
8. Before starting a team game that was changed to local-only, choose Try Automatic Cloud. Confirm
   the reviewed match overrides remain unchanged and Next runs the capability check again.

## Deferred

- guarded Enable Cloud Sync for a healthy owned local-only game: BKE-5C4
- duplicate-binding/source-role transaction checks and combined BKE-5C exit audit: BKE-5C4
- production Event opt-in and accepted live evidence: BKE-5D
