# Regression: BKE-4B Basketball Event Transport

Status: BKE-4B1 through BKE-4B3 automated coverage is implemented. Migration 056 is required for
live Basketball event binding. The live role/device matrix remains the BKE-4B exit signoff.

## BKE-4B1 Automated Gate

Run:

```powershell
pnpm test
pnpm build
pnpm lint
```

Coverage verifies:

- migration 056 adds one fixed authenticated `bind_basketball_event_game_v4` wrapper over the
  private v4 event binder and does not redefine checkpoint contracts;
- the effective migration-053 checkpoint reader and migration-055 checkpoint writer filter every
  event scan by sport;
- shared same-recorder base, merge, and conflict helpers preserve Soccer behavior;
- Soccer keeps its v4 RPC, ordering, recovery error, full-event upload, and exact checkpoint
  behavior through the shared engine;
- Basketball serializes stable tracked/opponent and late participants without synthetic team or
  neutral participants, and only tracked participants may carry source-team player links;
- a healthy Basketball stream can round-trip through the adapter in isolation; and
- a wrong-sport remote stream stops before event upload or checkpoint confirmation.

## After Migration 056

Verify the fixed wrapper is available and its neutral core remains private:

```sql
select
  has_function_privilege('authenticated',
    'public.bind_basketball_event_game_v4(uuid,text,uuid,uuid,text,text,text,date,jsonb,jsonb)',
    'EXECUTE') as basketball_wrapper_allowed,
  has_function_privilege('authenticated',
    'public.bind_event_game_v4(text,uuid,text,uuid,uuid,text,text,text,date,jsonb,jsonb)',
    'EXECUTE') as neutral_core_allowed;
```

Expected: `true`, `false`.

## BKE-4B2 Automatic Sync Gate

Coverage additionally verifies:

- complete marked Basketball event states select only `basketball_events`, while incomplete marked
  states fail closed and ordinary Basketball remains on `aggregate`;
- `GameContext` routes Basketball through `syncBasketballEventGameToCloud`, preserves the shared
  sync-start/post-await guards, and applies Basketball recovery only to an unchanged snapshot;
- existing-team event setup records immutable source team/season ids and tracked source-player
  links, while personal setup keeps them null;
- nonfinal cloud-bound Basketball games remain editable after first bind and finalized rows remain
  read-only;
- event games do not seed aggregate cloud-resume hydration or call legacy snapshot sync; and
- local match completion does not change cloud status to final or expose finalization.

## BKE-4B3 Recovery And Conflict Gate

Coverage additionally verifies:

- cloud open resumes a matching same-sport parked binding before loading or creating a stream;
- current-recorder Basketball adoption strictly rebuilds immutable setup, participants, raw events,
  sync base, open conflicts, projection, player rows, and a clean fingerprint;
- empty current-recorder history can start an independent stream from the immutable setup without
  depending on the new-game creation toggle;
- malformed setup, participant identity, event history, conflict rows, and projections fail closed;
- the shared conflict dialog and `GameContext` resolution support both sports while Basketball
  advances either selected copy above competing revisions and Soccer preserves its existing policy;
- conflict/base/pending-resolution state survives local normalization, parking, export/import, and
  retry; duplicate cloud bindings are skipped during import with an explicit reason;
- existing active-game confirmation and transactional parked-capacity failure preserve the current
  game; and
- legacy Basketball and Soccer open/sync paths remain isolated.

Basketball canonical finalization and authority-aware summary remain BKE-4C/BKE-4D.

## Live Exit Matrix

Record account ids, roles, local/cloud game ids, browser profiles, and pass/fail notes for:

| # | Scenario | Result / notes |
|---|---|---|
| 1 | Personal first bind, idempotent retry, offline capture, reconnect, exact checkpoint | Pending |
| 2 | Team owner/admin/scorer independent binding; viewer/non-member denial | Pending |
| 3 | Same recorder, two profiles, unrelated additions merge without loss | Pending |
| 4 | Same event conflict; verify both This Device and Cloud choices | Pending |
| 5 | Interrupted bind/event/checkpoint retries the same cloud game | Pending |
| 6 | Malformed/duplicate remote source fails without replacing local state | Pending |
| 7 | Matching parked resume, fresh adoption, active-game cancel, at-capacity failure | Pending |
| 8 | Local complete/abandon uploads while cloud finalization remains blocked | Pending |
| 9 | Legacy Basketball unchanged; event game writes no aggregate stat/shot rows | Pending |
| 10 | Soccer bind/recovery/conflict/finalization/reopen parity | Pending |
