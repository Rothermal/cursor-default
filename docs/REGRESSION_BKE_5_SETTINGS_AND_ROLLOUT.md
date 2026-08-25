# BKE-5 Basketball Settings and Rollout Regression Record

Status: BKE-5D1 implementation complete with production policy `internal`. BKE-5D2 activation,
deployment evidence, and owner smoke signoff remain pending. The broader live matrix remains open.

Plans: [PLAN_BKE_5_SETTINGS_AND_EVENT_ROLLOUT.md](PLAN_BKE_5_SETTINGS_AND_EVENT_ROLLOUT.md) and
[PLAN_BKE_5D_RELEASE_AND_EXIT.md](PLAN_BKE_5D_RELEASE_AND_EXIT.md)

## 1. D1 Contract

- `getBasketballEventCreationPolicy` is the only build-stage decision for new Basketball Event
  creation. `internal` production always blocks it; development and future `opt_in` production also
  require the exact device preference.
- `statkeeper_settings.basketball.eventTrackerPreviewEnabled` defaults false, accepts only a
  boolean, and remains device-local across account changes. It is separate from whole-sport
  discovery, rebound capture, and Supabase-backed Basketball settings.
- Settings -> Sports -> Basketball -> Tracker owns the preview switch. Internal production shows
  it disabled. Tracker changes never enter cloud CAS, save, discard, reset, or conflict flows.
- Game Setup keeps Classic as the fresh default and uses Classic/New tracker labels. An unavailable
  Event draft is preserved but cannot commit; choosing Classic remains possible.
- The atomic parking transaction re-reads the persisted preference and rejects an unauthorized
  net-new Event slot before any durable replacement. UI state alone is not trusted.
- Only the exact matching committed pre-start Event slot may update with policy or preference off.
  Started, mismatched, imported-shaped, or merely uncommitted drafts cannot claim that exception.
- Player Setup/start and all active, parked, imported, recovery, sync, Summary, Game Info,
  Timeline, finalization, reopen, publication, and aggregate paths remain outside the creation gate.
- Legacy Basketball and Soccer behavior are unchanged. Event and Legacy paths never dual-write.

## 2. Policy Matrix

| Build stage | Device preference | New Classic | New Event | Existing Event |
|---|---:|---:|---:|---:|
| Internal development | Off | Allowed | Blocked | Allowed |
| Internal development | On | Allowed | Allowed | Allowed |
| Internal production | Off | Allowed | Blocked | Allowed |
| Internal production | On | Allowed | Blocked | Allowed |
| Opt-in development | Off | Allowed | Blocked | Allowed |
| Opt-in development | On | Allowed | Allowed | Allowed |
| Opt-in production | Off | Allowed | Blocked | Allowed |
| Opt-in production | On | Allowed | Allowed | Allowed |

Basketball whole-sport discovery continues to use `enabledSports.basketball`; it does not imply
permission to create an Event game.

## 3. Automated Evidence

BKE-5D1 focused coverage proves the full injected policy matrix, strict storage compatibility,
namespace isolation, setup lifecycle distinctions, guard ordering, fresh commit-time preference
read, rollback-safe parking behavior, and static release-entry boundaries.

Verification at implementation head:

- `pnpm typecheck` - passed
- focused BKE-5D1 suite - 5 files / 91 tests passed
- `pnpm test` - 166 files / 1,151 tests passed
- `pnpm lint` - 0 errors; 6 existing Fast Refresh warnings, including duplicate worktree paths
- `pnpm build` - passed; existing Browserslist-age and chunk-size warnings only
- `git diff --check` - passed

## 4. D1 Internal Checks

These checks validate hardening without exposing production creation:

- [ ] Development, fresh device: Tracker preference defaults off and fresh setup uses Classic.
- [ ] Development, preference on: fresh setup can deliberately choose New tracker; reload preserves
  the device preference but the next genuinely fresh setup still defaults to Classic.
- [ ] Development, preference turned off after restoring an uncommitted Event draft: draft stays
  Event, Continue is blocked, and choosing Classic does not mutate a game before commit.
- [ ] Development, preference turned off after committing Game Setup: reopening the exact local
  pre-start record preserves New tracker and Player Setup can start it.
- [ ] Production/internal build with stored true: switch is disabled, new Event commit is blocked,
  and Classic setup remains usable.
- [ ] Existing active, parked, imported/recovery, bound cloud, and terminal Event games remain
  reachable with the preference off.

## 5. D2 Owner Release Signoff

BKE-5D2 must start from merged D1, rerun all automated checks, and change only the centralized
production stage from `internal` to `opt_in` plus expected tests/evidence. Record the deployed commit,
CI/build result, migration ceiling, and each focused owner smoke result from the D plan.

Initial owner-only deployment may precede manual validation. Any failure receives an explicit
Pass, Fail, Blocked, or Not run disposition; it is not silently accepted. Migration 062 must already
be present, but BKE-5D adds no database migration.

## 6. Broader-Release Matrix

The combined BKE-4/BKE-5 role, two-device recorder/conflict, offline recovery, browser/PWA,
responsive, accessibility, cloud/local-only conversion, finalization/reopen, canonical aggregate,
and multi-sport checks remain pending until actually exercised. They are mandatory before the New
tracker is offered beyond the initial owner-only rollout.

## 7. Rollback

Set `BASKETBALL_EVENT_RELEASE_STAGE` back to `internal`, rebuild, and deploy. Do not reverse
migration 062, clear the stored preference, alter authority, remove bindings, stop eligible queue
entries, or hide existing Event games. Rollback blocks only new Event creation.
