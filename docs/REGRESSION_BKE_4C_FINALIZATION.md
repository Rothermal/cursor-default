# Regression: BKE-4C Basketball Recorder Authority and Finalization

Status: BKE-4C1 automated coverage is implemented. Migration 057 is required before Basketball
recorder/readiness clients ship in BKE-4C2. Canonical finalization and reopen remain unavailable
until BKE-4C3/BKE-4C4.

## BKE-4C1 Automated Gate

Run:

```powershell
pnpm test
pnpm build
pnpm lint
```

Coverage verifies:

- migration 057 exposes only fixed Basketball recorder, primary-selection, readiness,
  canonical-reader, conflict-preparation, and manager checkpoint-confirmation wrappers;
- generic event-platform policy and mutation cores remain private;
- recorder count, checkpoint timestamp, and conflict-count details are manager-only while limited
  primary/health status remains readable through existing game access;
- primary-selection history is available only to a team owner/admin or personal-game creator;
- shared readiness retains its Soccer terminal path and adds Basketball Completed/Abandoned
  terminal recognition;
- trusted Basketball score policy accepts only version-1 tracked/opponent shot and adjustment
  score sources, rejects negative totals, and rejects a tied Completed result;
- no authenticated Basketball finalization or reopen RPC exists in BKE-4C1;
- Basketball canonical payload schema version 1 sits inside the unchanged event-platform version-2
  envelope, excludes projection/preferences, validates setup/events strictly, and forbids mixed
  sports or recorders; and
- migration 053, 055, and 056 contracts remain green.

Static tests do not execute PostgreSQL parsing, RLS, locks, or security-definer behavior.

## Apply Migration 057

Apply `supabase/migrations/057_basketball_recorder_finalization_contracts.sql` after migration 056.
Then verify the fixed surface and private cores:

```sql
select
  has_function_privilege('authenticated',
    'public.get_basketball_game_recorders(uuid)', 'EXECUTE')
      as recorder_reader_allowed,
  has_function_privilege('authenticated',
    'public.get_basketball_primary_recorder_history(uuid)', 'EXECUTE')
      as primary_history_allowed,
  has_function_privilege('authenticated',
    'public.set_basketball_primary_recorder(uuid,uuid)', 'EXECUTE')
      as primary_selection_allowed,
  has_function_privilege('authenticated',
    'public.get_basketball_finalization_readiness(uuid)', 'EXECUTE')
      as readiness_allowed,
  has_function_privilege('authenticated',
    'public.get_basketball_canonical_publication(uuid)', 'EXECUTE')
      as canonical_reader_allowed,
  has_function_privilege('authenticated',
    'public.confirm_basketball_primary_checkpoint_for_finalization(
      uuid,uuid,integer,jsonb,integer,bigint,text
    )', 'EXECUTE') as manager_checkpoint_allowed,
  has_function_privilege('authenticated',
    'public.get_event_finalization_readiness(text,uuid)', 'EXECUTE')
      as generic_readiness_allowed,
  has_function_privilege('authenticated',
    'public.validate_basketball_finalization_policy(uuid,uuid)', 'EXECUTE')
      as basketball_policy_allowed;
```

Expected: the six fixed Basketball results are `true`; the two generic/private results are
`false`.

Confirm publication mutation remains absent:

```sql
select
  to_regprocedure(
    'public.finalize_basketball_event_game(uuid,uuid,jsonb,text,jsonb)'
  ) is null as finalization_still_absent,
  to_regprocedure(
    'public.reopen_basketball_event_game(uuid,text)'
  ) is null as reopen_still_absent;
```

Expected: both values are `true`.

## BKE-4C1 Runtime Matrix

Use one personal Basketball event game and one accepted-team Basketball event game with at least
two independent recorders when available.

| # | Scenario | Expected | Result / notes |
|---|---|---|---|
| 1 | Personal creator reads recorders/readiness/history | Full detail and manager capability | Pending |
| 2 | Team owner/admin reads recorders/readiness/history | Full detail and manager capability | Pending |
| 3 | Team scorer/viewer reads recorder presence | Limited primary/health status; detail columns are null | Pending |
| 4 | Scorer/viewer selects primary or reads history | Server denies the request | Pending |
| 5 | Owner/admin selects a current conflict-free recorder | Selection and immutable audit history update | Pending |
| 6 | Select a stale or conflicted recorder | Server rejects selection | Pending |
| 7 | End primary as Completed or Abandoned and refresh readiness | `primary_ended` is true | Pending |
| 8 | Suspend or reopen the primary and refresh readiness | `primary_ended` is false | Pending |
| 9 | Inspect a local completed Basketball game after migration 057 | Cloud finalization remains unavailable | Pending |
| 10 | Repeat Soccer recorder/readiness/finalization/reopen smoke | Existing Soccer behavior is unchanged | Pending |

The pending BKE-4B two-device matrix remains part of the combined BKE-4C exit evidence.
