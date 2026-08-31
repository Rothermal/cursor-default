# BKE-6D4 Regression: Finalization and Reopen

Status: Implementation complete. Apply migration 064 manually before live cloud validation.

## Automated Gates

Run:

```powershell
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Focused coverage includes anchored finalization, reopen handoff, lifecycle projection, Timeline
correction, migration 064 source/grant checks, parking, cloud transport, and mixed-flow hydration.

### Automated Evidence

| Gate | Result |
|---|---|
| Focused BKE-6D4 tests | Passed: 6 files, 108 tests |
| Full Vitest suite | Passed: 180 files, 1,286 tests |
| TypeScript | Passed: `pnpm typecheck` |
| ESLint | Passed with 0 errors and the 6 pre-existing Fast Refresh warnings |
| Production build | Passed: 2,168 modules transformed |
| Diff hygiene | Passed: `git diff --check` |

The focused tests independently exercise all ten blocker codes, combined ordering, corrupt and
clockless authority, abandoned and completed/overtime authority, stale persisted clock rows,
blocked preview behavior, server blocker catalog/order source parity, Correct-records lineup
editing, idempotent recorder handoff, and local/cloud reopen reason parity. A client-only
`source_invalid` remains actionable because full client reprojection is intentionally stricter than
the server's row checks; every shared client-only blocker still triggers the stale-parity guard.
Migration source tests do not replace the live Supabase parity matrix below.

## Contract Matrix

| Scenario | Expected |
|---|---|
| Clockless Event or Legacy Basketball finalization/reopen | Existing RPC and mode-less resume behavior are unchanged |
| Anchored preview with an incomplete period, running/unsafe clock, lineup gap, replacement, boundary review, equal-play gap, or tie | Ordered actionable blockers appear and Finalize remains disabled |
| Ready anchored primary | Fresh access plus release and clock/lineup capabilities pass; exact checkpoint and persisted-row policy agree; one canonical publication is created |
| Correct records | Publication history records reason/mode; prior recorder's matching binding appends one idempotent reopen event; Tracker is Timeline-only and terminal context is retained |
| Resume game | Exact final period and elapsed clock return paused; current five requires review; Start is explicit; `0:00` is never reset automatically |
| Manager differs from recorder | Manager may invalidate/reselect but cannot clone or mutate the recorder stream; the prior recorder receives the strict handoff |
| Sync after correction/resume | Rows and checkpoint update, but no publication is created until a manager runs a new preview and Finalize |
| Republication | Prior publication remains immutable with actor/reason/mode; one new active publication replaces it |

## One-Device Supabase Smoke

Status: **Not run.** Migration 064 has not been applied from this branch. Record each result after
deployment rather than treating the automated SQL source tests as live database evidence.

1. Apply `064_basketball_anchored_finalization_reopen.sql` in the Supabase SQL editor.
2. Create an owner-only anchored Event game, enable cloud, track a short match, pause, resolve all
   lineup/boundary/equal-play prompts, complete or abandon, and sync.
3. Open Cloud Game Info, select the primary if needed, Review Finalization, verify no blockers, and
   Finalize. Confirm canonical Summary and aggregates remain available.
4. Reopen with **Correct records** and a reason. Open the matching parked game: only Timeline is
   available. Edit one record, sync, then explicitly finalize again.
5. Reopen the new publication with **Resume game**. Open the parked game: verify the exact period and
   clock value are paused, confirm the lineup, explicitly Start, finish, sync, and finalize again.
6. Review Publication History. Each invalidated row retains its finalizer, invalidator, timestamp,
   reason, and mode; only the newest publication is active.

The broader two-device, roles, offline/PWA, responsive, rollback, and mixed-sport matrix remains
BKE-6E release evidence before access expands beyond owner-only opt-in.

## Manual Matrix Status

| Matrix | Status |
|---|---|
| One-device bind, upload, select, finalize, reopen-correct, republish, reopen-resume, republish | Not run |
| Two-device recorder/manager handoff and stale-checkpoint behavior | Not run |
| Owner/admin/scorer/viewer authorization boundaries | Not run |
| Offline queue, conflict, rollback, and recovery import/export | Not run |
| Legacy, clockless Basketball, Soccer, and mixed-sport runtime parity | Not run |
| Responsive, accessibility, PWA reload, and rollback smoke | Deferred to BKE-6E |
