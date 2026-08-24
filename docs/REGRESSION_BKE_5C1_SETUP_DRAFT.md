# BKE-5C1 Basketball Setup Draft Regression

Status: implementation complete. No Supabase migration is required. Basketball event creation
remains behind the internal gate; BKE-5C2 through BKE-5C4 remain before release work.

## Scope

- strict version-1 Basketball setup draft with exact account-scoped storage
- corrupt, unsupported, cross-account, and impossible authority/source rejection
- mutation-free Basketball entry from Sport Dashboard, Team Info, and direct team links
- Legacy default with the internal Event preview stored only in the draft
- reload-safe team, opponent, date, tournament, season, authority, and source choices
- no setup-time `GameContext` writes for editing, capability failure, Cancel, or route loading
- deferred tournament insert/URL update after validation, capacity check, and final confirmation
- best-effort tournament compensation when the local commit fails
- one rollback-safe context/storage transaction for a complete setup candidate
- matching committed pre-start setup updates the same local slot instead of creating another
- unchanged Soccer and other-sport entry behavior

`src/lib/basketball/setupDraft.ts` already carries the complete version-1 Event review shape so
reload parsing stays strict. C1 seeds that hidden review from current application defaults only.
BKE-5C2 replaces that seed with authoritative personal/team revisions, visible rules review,
match overrides, stale-revision Refresh/Keep, complete `rulesSource`, and display-default
consumption before event-stream initialization.

## Automated Evidence

Recorded 2026-08-24:

- `pnpm test`: 162 files, 1,093 tests passed
- focused draft/entry/parking/routes: 4 files, 63 tests passed
- `pnpm build`: passed; existing Browserslist freshness and bundle-size warnings only
- `pnpm lint`: zero errors; six existing Fast Refresh warnings, including the separate worktree
- `git diff --check`: passed

Coverage proves account isolation, strict parsing, route identity, Legacy/Event candidate creation,
source-authority preservation, exact parking rollback after a failed manifest write, one-slot
recommit, mutation-free Basketball entry source ordering, and explicit sport query routing.

## Live Checks

After deployment:

1. With a local game active, choose Basketball New Game. Confirm setup opens without parking or
   replacing the active game and without an immediate confirmation.
2. Enter team/opponent/date/tournament values, enable the internal Event preview when available,
   reload, and confirm the same draft returns.
3. Cancel setup. Confirm the source dashboard/team opens and the prior active game is unchanged.
4. Repeat setup and Continue. Confirm the parking confirmation appears only now, the prior game is
   parked, and exactly one new Basketball game opens in Player Setup.
5. Return from Player Setup to Game Setup, edit the opponent, and Continue. Confirm the same local
   game is updated rather than adding a second parked row.
6. Start from Basketball Team Info. Confirm setup loads that team read-only before Continue and a
   viewer still cannot enter the tracking flow.
7. Repeat a Soccer start from Sport Dashboard and Team Info to confirm its established capability
   and setup routing remain unchanged.

## Deferred

- authoritative settings hierarchy, rule/source freeze, stale revisions, and court default: BKE-5C2
- capability recovery and durable Event local-only transport policy: BKE-5C3
- guarded Enable Cloud Sync plus BKE-5C exit hardening: BKE-5C4
- production event-model opt-in and combined live evidence: BKE-5D
