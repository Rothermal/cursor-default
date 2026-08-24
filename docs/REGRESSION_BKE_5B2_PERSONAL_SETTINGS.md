# BKE-5B2 Basketball Personal Settings Regression

Status: implementation complete. Migration 062 is installed. Live account/offline/conflict checks
remain post-merge evidence; team settings remain BKE-5B3.

## Scope

- anonymous device and authenticated account Basketball caches
- first-load bootstrap from `statkeeper_settings.courtCapture.reboundPromptAfterMiss`
- missing authenticated-row seeding without overwriting an existing cloud row
- cache-first revision CAS writes, pending-offline state, focus/online reconciliation, and explicit
  Use Cloud / Keep This Device conflict recovery
- one `SettingsContext` Basketball personal authority consumed by live rebound capture
- compact Rules, Capture, and Display tabs with draft/discard/save/reset behavior
- profile selection, personal-foul override, resolved rule summary, and profile provenance
- Rules guidance distinguishes event-model defaults from legacy season authority and links directly
  to Data & Sync -> Seasons

The legacy app setting remains read-only bootstrap compatibility. Once a valid Basketball cache or
cloud row exists, that strict schema-version-1 payload is authoritative. Capture and display values
remain non-authoritative UI preferences and never enter game event fingerprints or publications.

## Automated Evidence

Recorded 2026-08-24:

- `pnpm test`: 156 files, 1,063 tests passed
- focused Basketball settings/lifecycle/parser/cloud suite: passed
- `pnpm lint`: zero errors; six existing Fast Refresh warnings, duplicated by the separate
  `.worktrees/bke-5-settings-rollout` checkout
- `pnpm build`: passed; existing Browserslist freshness and bundle-size warnings only
- `git diff --check`: passed

Coverage includes legacy rebound seeding, existing-cloud precedence, revision-matched pending
upload, stale-revision conflict, unsupported-cloud fail-closed behavior, stable fingerprints,
anonymous/account scope separation, wrong-sport cache rejection, and refresh concurrency policy.

## Live Checks

After deployment:

1. With no Basketball settings row, set the legacy rebound preference on the device, sign in, and
   open Settings -> Sports -> Basketball. Confirm the cloud row is created once with that capture
   value and the NFHS v1 default profile.
2. Change Capture and Display values, save, reload, and confirm they return from the account cache
   immediately and then remain Synced after cloud refresh.
3. Change the tracking profile and player foul limit. Confirm the Rules summary and source links
   update, then save/reload and confirm the same resolved values.
4. Go offline, save a change, and confirm the page reports a pending cloud write while the local
   value remains active. Reconnect or focus the page and confirm it syncs.
5. Use two browsers on the same account. Save from browser A, then save a stale draft from browser
   B. Confirm B offers Use Cloud and Keep This Device and that each choice resolves deliberately.
6. Enable the rebound prompt, record a missed court shot, and confirm the rebound prompt opens.
   Disable it, save, and confirm a later missed court shot does not open the prompt.
7. Sign out and confirm anonymous settings do not expose the prior account cache. Sign into another
   account and confirm its settings remain isolated.

## Deferred

- role-aware Team Manage settings lifecycle and presentation: BKE-5B3
- profile-version upgrades and reviewed legacy-season import: BKE-5B4
- setup hierarchy, immutable rules/source binding, and display-default consumption: BKE-5C2
- production event-model opt-in and combined live evidence: BKE-5D
