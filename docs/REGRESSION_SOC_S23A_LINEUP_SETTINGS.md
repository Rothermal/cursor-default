# Regression - SOC-S23A lineup settings foundation

**Migration:** apply `068_soccer_lineup_status_defaults.sql` before deploying
the S23A client or saving Soccer team settings with that client.

**Scope:** schema and transport foundation only. The Lineup Defaults editor is
S23B and Player Setup consumption is S23C.

## 1. Automated coverage

The focused suite covers:

- strict version-1 lineup-default parsing, UUID normalization, deterministic
  ordering, uniqueness, and defensive bounds;
- immutable sparse Starter/Bench transitions;
- complete-membership reconciliation that retains inactive members and cleans
  only missing ids;
- team settings v1 and v2 normalization into the current v3 model;
- exact v3 parsing, fingerprints, rules-only copy, formation transitions, and
  discriminated cleanup modes with dual-readiness lineup preparation;
- current v3 cache/cloud writes plus v1/v2 cache/cloud reads;
- SQL parity for schema versions, lineup validation, manager CAS authority,
  coarse audit metadata, and private helper permissions.

Run:

```powershell
pnpm exec vitest run src/lib/soccer/lineupDefaults.test.ts src/lib/soccer/settings.test.ts src/lib/soccer/teamSettingsSync.test.ts src/lib/soccer/migration068.test.ts src/hooks/useSoccerTeamSettings.test.ts
```

## 2. Migration verification

1. Apply migration 068 in Supabase.
2. Open Team Manage for a Soccer team with an existing schema-v1 or schema-v2
   settings row.
3. Confirm Rules and Formation still load exactly as before.
4. As owner/admin, make and save one harmless Rules or Formation change.
5. Inspect `team_sport_settings` for that team.

Expected:

- the save succeeds through the existing revisioned RPC;
- `schema_version` is now `3`;
- `settings.lineupDefaults` is exactly
  `{ "version": 1, "starterPlayerIds": [] }`;
- existing rules and formation remain intact; and
- `access_audit_events.metadata.changed_fields` contains only coarse field
  names and never player ids.

## 3. Compatibility and conflict behavior

1. Keep one tab on the pre-S23A bundle if a controlled stale-PWA check is
   available.
2. Save schema v3 from an updated tab.
3. Refresh/reconcile the updated tab and trigger a stale-revision save from a
   second updated tab.

Expected:

- updated clients read v1, v2, and v3 and preserve the full rules, formation,
  and lineup-default record through cache and conflict replacement;
- the stale revision returns the existing conflict result without overwriting
  cloud data; and
- a pre-S23A bundle fails the v3 team settings record closed until its PWA
  update is accepted or all scoped tabs close and reload. This reverse-
  compatibility window is accepted for the rollout.

## 4. Authorization smoke

1. Save a team setting as owner/admin.
2. Attempt the same fixed RPC as scorer, viewer, and a non-member.

Expected: owner/admin succeeds; every other role is denied. The new private
lineup validator is not executable through the authenticated API.

## 5. Exit

- Migration 068 applies without error.
- Focused tests and the repository gate pass.
- One v1/v2 row upgrades to v3 without losing rules or formation.
- Audit metadata remains coarse.
- No lineup editor or match-prefill behavior is expected before S23B/S23C.
