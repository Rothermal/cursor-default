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
