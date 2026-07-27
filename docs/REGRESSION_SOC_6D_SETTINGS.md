# SOC-6D Soccer Settings Regression Matrix

Status: automated coverage implemented; manual operator scenarios ready for release validation.

## Purpose

This matrix verifies the built-in -> personal -> team -> match hierarchy, account and team cloud
reconciliation, fixed match snapshots, authorization, and SOC-6D4 failure handling. Migration
`048_soccer_settings_foundation.sql` is required for cloud-backed checks. SOC-6D4 adds no new
migration.

## Automated Evidence

| Contract | Primary coverage |
|---|---|
| Complete personal and sparse team/match schemas; unknown keys; derived-key rejection; segment validation | `src/lib/soccer/settings.test.ts` |
| Layer precedence, source attribution, whole-layer rejection, atomic arrays, cleared overrides | `src/lib/soccer/settings.test.ts`, `src/lib/soccer/setupSettings.test.ts` |
| Anonymous/user/team cache isolation, corrupt JSON, unsupported records, storage read/write failure | `src/lib/sportSettingsStorage.test.ts`, `src/lib/soccer/teamSettingsSync.test.ts` |
| Existing-cloud precedence, pending edits, conflicts, invalid cloud schema | `src/lib/soccer/personalSettingsSync.test.ts`, `src/hooks/useSoccerPersonalSettings.test.ts` |
| Team refresh serialization and scoped cache behavior | `src/hooks/useSoccerTeamSettings.test.ts`, `src/lib/soccer/teamSettingsSync.test.ts` |
| Malformed cloud responses, backend capability detection, revision arguments | `src/lib/sportSettingsCloud.test.ts` |
| RLS/read-only tables, manager writes, CAS collision handling, audit ordering | `src/lib/soccer/migration048.test.ts` |
| Snapshot preservation and setup hierarchy | `src/lib/soccer/setupSettings.test.ts`, soccer setup/live tests |
| Production Soccer gate | `src/lib/sportAvailability.test.ts` |
| Shared Basketball and parking regressions | Full `pnpm test` suite |

Required commands:

```text
pnpm test
pnpm lint
pnpm build
```

## Manual Operator Matrix

Record browser/device, account ids, team role, migration state, and result for each run.

| Area | Procedure | Expected |
|---|---|---|
| Anonymous/account boundary | Save anonymous defaults; sign in to an account with an existing cloud row; sign out | Cloud row wins while signed in; anonymous defaults return after sign-out |
| First account bootstrap | Sign in with meaningful anonymous defaults to an account with no Soccer row | One revision-1 account row is created; a concurrent create becomes the normal conflict path |
| Multiple accounts | Use two accounts on one browser and alternate sign-in | Each account sees only its user-keyed cache/cloud value |
| Offline personal save | Disable network, save personal defaults, reload, reconnect | Pending local value remains labeled and retries without blocking gameplay |
| Two-session conflict | Load the same revision in two sessions, save A, then save B | B sees both choices; Use Cloud and Keep This Device each resolve deterministically |
| Missing migration | Run without migration 048 | Personal defaults remain local with a backend warning; team defaults are unavailable/read-only |
| Stale team cache | Load team defaults, go offline, and reopen setup | Last valid cache remains labeled and can seed setup; shared editing stays disabled |
| Invalid schema | Return schema version 2 or an unknown rule from cloud | Entire layer is rejected; no individual field from it enters effective rules |
| Corrupt storage | Corrupt the cache JSON and deny localStorage writes | App does not crash; corrupt data is ignored; session state remains with a persistence warning |
| Team roles | Repeat team editor with owner, admin, scorer, and viewer | Owner/admin save; scorer/viewer inspect only; direct writes remain unavailable |
| Audit failure | Force `record_access_audit_event` to fail in a development transaction | Shared settings save rolls back and the client does not report success |
| Setup inheritance | Select two teams with different overrides while retaining one explicit match override | Inherited fields change with team; explicit match override remains |
| Snapshot fixation | Continue setup, park game, change defaults, resume | Existing game retains its complete `rulesSnapshot`; new setup uses current defaults |
| Reset behavior | Reset one section, Reset All and cancel, then confirm Reset All | Section reset is scoped; full reset confirms; neither persists until Save |
| Keyboard | Tab into section tabs; use Left/Right/Home/End; continue through controls | Selection and focus move together; panel relationship is announced; no keyboard trap |
| Status announcements | Trigger saving, pending, cloud error, storage warning, and conflict | Meaningful status/error text is exposed to assistive technology |
| Narrow layout | Test 320 px width with 120-character segment labels and team save controls | Inputs shrink within tracks; actions remain readable and do not overlap |
| Basketball regression | Repeat Basketball app settings, sport settings, setup, active/parked restore, and sign-out | Existing Basketball storage and workflows are unchanged |
| Production gate | Build production and navigate directly to Soccer chooser/setup/tracker routes | Soccer remains unavailable until SOC-6E |

## Failure Interpretation

- A malformed or unsupported stored layer must be rejected as a whole.
- A browser cache failure may reduce persistence, but must not broaden access or replace a valid
  cloud authority.
- A shared write is successful only when the settings mutation and audit call both commit.
- Manual release checks should not clear or rewrite an existing match snapshot to make current
  defaults appear.
