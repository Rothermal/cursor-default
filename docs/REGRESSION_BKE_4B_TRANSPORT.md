# Regression: BKE-4B Basketball Event Transport

Status: BKE-4B1 automated coverage is implemented. Migration 056 and live Basketball routing are
not active until the migration is applied and BKE-4B2 is merged.

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

BKE-4B1 does not route `GameContext`, write legacy `game_stats`/`shot_chart`, load Basketball cloud
games, or expose Basketball finalization. BKE-4B2 owns automatic sync and BKE-4B3 owns adoption,
conflict UI, offline recovery, and the full role/device matrix.
