# BKE-5B1 Basketball Settings Foundation Regression

Status: implementation complete. Migration 062 and live authenticated capability verification are
required after merge; Basketball settings UI/lifecycle consumption remains BKE-5B2 and BKE-5B3.

## Scope

- exact schema-version-1 Basketball personal/team settings parsers
- fixed Basketball user/team save clients with no caller-selected sport or schema
- migration 062 private validation and revisioned CAS boundary
- owner/admin-only team writes and metadata-only `basketball_settings_changed` audit
- Basketball release capability contract v2 with `settingsContractVersion: 1`
- unchanged Soccer broad settings validators, RPC signatures, grants, and behavior

Structural overrides are one atomic group: `regulationSegments`, `overtimeTemplate`, `foulWindows`,
and `timeoutPools` must be present together. Scalar `personalFoulLimit` and `clockModel` overrides
remain sparse. Both client and SQL validate this boundary.

## Automated Evidence

Recorded 2026-08-23:

- `pnpm test`: 154 files, 1,055 tests passed
- `pnpm lint`: zero errors; six existing Fast Refresh warnings, duplicated by the separate
  `.worktrees/bke-5-settings-rollout` checkout
- `pnpm build`: passed; existing Browserslist freshness and bundle-size warnings only
- focused BKE-5B1 suite: migration, settings, capability, and cloud-contract tests passed
- `git diff --check`: passed

## Migration

Apply `supabase/migrations/062_basketball_settings_foundation.sql` after migration 061.

If the original migration 062 stopped at a syntax error near the `foulWindows` assignment query,
the `_validate_basketball_rule_overrides` function failed while being created. That validator and
everything after it, including the fixed save RPCs, grants, and capability function, were not
installed. Rerun the corrected migration from the beginning. The SQL Editor execution is
transactional, and the migration statements are idempotent if another runner partially committed,
so neither case requires a separate cleanup migration.

The migration does not redefine the broad Soccer-only validator or either broad Soccer save RPC.
It grants authenticated callers only these new Basketball write surfaces:

```text
save_basketball_user_settings_revisioned(bigint, jsonb)
save_basketball_team_settings_revisioned(uuid, bigint, jsonb)
```

Private validators and `_save_sport_settings_revisioned_core` remain revoked from public callers.
Direct table writes remain denied by migration 048.

## Post-Migration Checks

Run in the Supabase SQL editor:

```sql
select
  to_regprocedure(
    'public.save_basketball_user_settings_revisioned(bigint,jsonb)'
  ) is not null as user_rpc_present,
  to_regprocedure(
    'public.save_basketball_team_settings_revisioned(uuid,bigint,jsonb)'
  ) is not null as team_rpc_present,
  has_function_privilege(
    'authenticated',
    'public.save_basketball_user_settings_revisioned(bigint,jsonb)',
    'EXECUTE'
  ) as authenticated_user_write,
  has_function_privilege(
    'authenticated',
    'public.save_basketball_team_settings_revisioned(uuid,bigint,jsonb)',
    'EXECUTE'
  ) as authenticated_team_write,
  has_function_privilege(
    'anon',
    'public.save_basketball_user_settings_revisioned(bigint,jsonb)',
    'EXECUTE'
  ) as anon_user_write,
  has_function_privilege(
    'anon',
    'public.save_basketball_team_settings_revisioned(uuid,bigint,jsonb)',
    'EXECUTE'
  ) as anon_team_write;
```

Expected: both RPCs present, both authenticated checks `true`, both anonymous checks `false`.

After the matching client deploy, an authenticated event-cloud capability preflight must return the
exact contract below. Calling it directly in the SQL editor has no user JWT and should fail
authentication by design.

```json
{
  "contractVersion": 2,
  "migration": 62,
  "eventTransportVersion": 4,
  "recoveryVersion": 1,
  "recorderResolutionVersion": 1,
  "canonicalFinalizationVersion": 1,
  "summaryAuthorityVersion": 1,
  "aggregateSourceVersion": 1,
  "settingsContractVersion": 1
}
```

## Deferred

- personal cache lifecycle, seeding, offline pending writes, and settings tabs: BKE-5B2
- role-aware Team Manage settings UI: BKE-5B3
- profile upgrade and reviewed legacy-season import: BKE-5B4
- setup authority and event rollout: BKE-5C/BKE-5D
