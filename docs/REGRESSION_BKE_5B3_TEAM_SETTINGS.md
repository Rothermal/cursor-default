# BKE-5B3 Basketball Team Settings Regression

Status: implementation complete. Migration 062 is required and already installed. Live role and
two-manager conflict checks remain post-merge evidence; upgrades and legacy import remain BKE-5B4.

## Scope

- account-and-team-scoped Basketball settings caches with strict sport/schema validation
- online refresh and manager-only fixed-RPC revision writes without pending offline saves
- application-default resolution for teams with no saved Basketball row
- stale manager writes resolved only by reloading the shared cloud revision
- Team Manage Basketball Rules for accepted owner, admin, scorer, and viewer roles
- owner/admin profile and personal-foul-limit editing with draft, discard, and save controls
- scorer/viewer compact read-only rule review
- resolved built-in versus team-override source labels and profile source links
- shared rules fields reused by personal and team settings to prevent presentation drift

Team defaults never inherit a recorder's personal rules. BKE-5B3 reads and writes only the fixed
Basketball schema-version-1 contract introduced by migration 062. It does not add a migration.

## Automated Evidence

Recorded 2026-08-24:

- `pnpm test`: 158 files, 1,068 tests passed
- focused Basketball team settings/parser/cloud suite: 4 files, 17 tests passed
- `pnpm exec tsc -b --pretty false`: passed
- `pnpm lint`: zero errors; six existing Fast Refresh warnings, duplicated by the separate
  `.worktrees/bke-5-settings-rollout` checkout
- `pnpm build`: passed; existing Browserslist freshness and bundle-size warnings only
- `git diff --check`: passed

Coverage includes strict cache/cloud parsing, wrong-sport and unsupported-schema rejection,
account/team scope separation, stable fingerprints, fixed Basketball team save transport, and
refresh serialization policy. Existing team-role tests retain owner/admin write versus
scorer/viewer read-only boundaries.

## Live Checks

After deployment:

1. Open a Basketball team as its owner. In Team Manage, confirm Basketball Rules initially reports
   the application default when the team has no `team_sport_settings` Basketball row.
2. Open the Rules Editor, select a profile, change the player foul limit, save, reload, and confirm
   the shared row and source labels return at the new revision.
3. Repeat the edit as an accepted admin and confirm save plus the `basketball_settings_changed`
   audit event. Confirm the audit stores metadata rather than the settings payload.
4. Open the same team as an accepted scorer and viewer. Confirm each can review the complete
   resolved rules but receives no profile, foul-limit, discard, or save controls.
5. Open the same team in two owner/admin sessions. Save in session A, then attempt to save the stale
   draft in session B. Confirm B requires Reload Shared Version and cannot overwrite the new row.
6. Disconnect after a successful load. Confirm the account/team-scoped cached value remains
   readable, refresh/editing is unavailable, and no pending team write is created.
7. Switch teams and accounts. Confirm no prior team's or account's cached rules flash or become
   editable in the new scope.

## Deferred

- explicit profile-version upgrade diff/apply and legacy-season import: BKE-5B4
- Team Setup consumption and immutable source-revision binding: BKE-5C
- production event-model opt-in and combined live evidence: BKE-5D
