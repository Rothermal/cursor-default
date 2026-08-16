# Regression: BKE-4B Basketball Event Transport

Status: BKE-4B1 and BKE-4B2 automated coverage are implemented. Migration 056 is required for live
Basketball event binding. BKE-4B3 recovery/adoption and the full role/device matrix remain open.

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

BKE-4B3 owns current-recorder cloud adoption, conflict UI, durable cross-device recovery, and the
full role/device matrix. Basketball canonical finalization remains BKE-4C.

Interim boundary: if the same recorder creates a Basketball same-event conflict from another
device or browser profile before BKE-4B3, the durable conflict intentionally blocks checkpoint and
retry. Local tracking remains authoritative and usable, but there is no Basketball conflict-review
surface in BKE-4B2; BKE-4B3 must resolve the conflict before cloud sync can continue.
