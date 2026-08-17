# Regression: BKE-4C Basketball Recorder Authority and Finalization

Status: BKE-4C1 through BKE-4C4 are implemented. Migrations 057 through 059 are required. The
combined BKE-4B/BKE-4C live Supabase matrix remains pending before broader event-model enablement.

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

## BKE-4C2 Automated Gate

Coverage verifies:

- manager recorder rows retain event/checkpoint/conflict detail while limited-reader nulls parse
  without inventing values;
- malformed booleans, duplicate recorders, multiple primaries, invalid history, and mismatched
  primary-selection responses fail closed;
- explicit primary and Needs Attention state derive from independent recorder rows without
  blending;
- another recorder loads into a fresh Basketball cloud shell, validates sport/ownership, and
  reprojects without dispatching into active or parked `GameContext` state;
- tracker presence refreshes after sync and through bounded focus/visibility/online polling;
- Game Info limits selection, history, and opt-in stream inspection to managers while preserving
  compact scorer/viewer status;
- personal Basketball Game Info uses creator authority and skips team membership queries, while
  team games continue to use owner/admin/scorer/viewer role checks; and
- Basketball finalization and reopen remain unavailable.

## BKE-4C3 Automated Gate

Coverage verifies:

- migration 058 keeps the shared finalization transaction private, preserves Soccer policy, adds
  trusted Basketball policy dispatch, and grants only the fixed Basketball finalization wrapper;
- the Basketball wrapper rejects a missing or unsupported `canonicalSchemaVersion` before calling
  the shared core;
- shared game/checkpoint locking, exact primary/revision/fingerprint/content checks, byte-equivalent
  idempotency, append-only publication numbering, server-derived scores, and audit recording remain
  in the transaction;
- readiness, conflicts, publication metadata, and finalization results parse strictly;
- the selected primary reloads and reprojects in an isolated cloud shell, must be Completed or
  Abandoned, and produces a source-only schema-version-1 review snapshot;
- current-recorder sync flush and exact manager checkpoint confirmation occur before the explicit
  Game Info confirmation;
- conflict preparation and non-primary warnings do not blend or mutate unrelated recorder streams;
- ending a cloud-bound game hands off to Game Info while local-only completion retains Summary;
- a finalized Game Info surface shows canonical score, primary, publication number, finalizer, and
  time without routing into the legacy Basketball Summary; and
- reopen remains unavailable.

## BKE-4C4 Automated Gate

Coverage verifies:

- migration 059 grants only fixed authenticated Basketball publication-history and reopen
  surfaces while the shared mutation core stays private and Soccer is not redefined;
- the existing shared transaction requires manager/creator access and a reason, locks the game and
  active publication, invalidates rather than deletes history, unlocks the selected primary, resets
  published scores, returns the game to in-progress, and appends an access-audit event;
- the client trims and requires a reopen reason, parses the returned game/publication/time
  strictly, and rejects a mismatched game identity;
- Game Info exposes reopen only for a manager/creator with an active canonical publication;
- Game Info shows managers newest-first active and invalidated publication metadata without
  exposing or blending canonical snapshots;
- successful reopen refreshes every matching owned parked binding to in-progress without copying,
  hydrating, or granting edits to another recorder stream; and
- the normal owned-stream BKE-3 reopen/correction/sync/finalize path can append a later publication
  while the invalidated publication remains durable history.

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

## Apply Migration 058

Apply `supabase/migrations/058_basketball_canonical_finalization.sql` after migration 057. Verify
that only the fixed Basketball mutation is public:

```sql
select
  has_function_privilege('authenticated',
    'public.finalize_basketball_event_game(uuid,uuid,jsonb,text,jsonb)', 'EXECUTE')
      as basketball_finalization_allowed,
  has_function_privilege('authenticated',
    'public.finalize_event_game(text,uuid,uuid,jsonb,text,jsonb)', 'EXECUTE')
      as generic_finalization_allowed,
  to_regprocedure(
    'public.reopen_basketball_event_game(uuid,text)'
  ) is null as reopen_still_absent;
```

Expected: `basketball_finalization_allowed = true`, `generic_finalization_allowed = false`, and
`reopen_still_absent = true`.

The wrapper must reject this unsupported payload before publication:

```sql
select public.finalize_basketball_event_game(
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  '[]'::jsonb,
  'test',
  '{"version":2,"canonicalSchemaVersion":2}'::jsonb
);
```

Expected error: `Unsupported Basketball canonical payload schema version`.

## Apply Migration 059

Apply `supabase/migrations/059_basketball_reopen_republication.sql` after migration 058. Verify the
fixed wrapper and private shared core:

```sql
select
  has_function_privilege('authenticated',
    'public.get_basketball_canonical_publication_history(uuid)', 'EXECUTE')
      as basketball_history_allowed,
  has_function_privilege('authenticated',
    'public.reopen_basketball_event_game(uuid,text)', 'EXECUTE')
      as basketball_reopen_allowed,
  has_function_privilege('authenticated',
    'public.reopen_event_game(text,uuid,text)', 'EXECUTE')
      as generic_reopen_allowed,
  has_function_privilege('authenticated',
    'public.reopen_soccer_event_game(uuid,text)', 'EXECUTE')
      as soccer_reopen_unchanged;
```

Expected: `basketball_history_allowed = true`, `basketball_reopen_allowed = true`,
`generic_reopen_allowed = false`, and `soccer_reopen_unchanged = true`.

## Minimum Pre-BKE-4D Runtime Checkpoint

After merging BKE-4C4 and applying migration 059, run this focused checkpoint before beginning
BKE-4D Summary implementation. It does not replace the full exit matrix below:

1. Finalize one healthy terminal primary, then retry the byte-identical request. Confirm one active
   publication, one publication number, server-derived scores, and a locked primary.
2. Prepare finalization, then change the selected primary or its checkpoint/revision/fingerprint.
   Confirm the stale request is rejected without changing the active publication.
3. Attempt ordinary primary writes after finalization. Confirm finalized-write denial while an
   eligible already-queued non-primary audit upload remains unable to change canonical output.
4. Reopen with a manager reason. Confirm the active row is invalidated rather than deleted, the
   primary unlocks, published scores clear, the game returns to in-progress, and audit stores the
   reason. Confirm a short reason and scorer/viewer request are denied without mutation.
5. Open the owned local binding, append the local reopen/correction, sync, end, and explicitly
   re-finalize. Confirm publication 2 is active and publication 1 remains invalidated history.
6. Repeat the Soccer canonical finalization/reopen smoke to confirm migration 059 did not change
   its fixed wrappers or shared runtime behavior.

## BKE-4C Exit Runtime Matrix

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
| 9 | End an owned cloud-bound Completed game | Tracker hands off to Game Info and flushes before review | Pending |
| 10 | Review a healthy Completed primary | Confirmation shows exact recorder, score, terminal reason, current checkpoint, and alternate warnings | Pending |
| 11 | Finalize the reviewed primary | One active publication is inserted, primary locks, game becomes final, and server-derived scores persist | Pending |
| 12 | Repeat the byte-identical finalization request | Existing publication is returned; no second active publication is created | Pending |
| 13 | Change primary/checkpoint/revision/fingerprint after review | Stale finalization is rejected and Game Info refreshes readiness | Pending |
| 14 | Attempt tied Completed finalization, then finish overtime | Tie is rejected; overtime-decided result finalizes | Pending |
| 15 | Finalize an Abandoned tie with unhealthy alternates | Publication succeeds from the healthy primary; alternates remain audit-only warnings | Pending |
| 16 | Use scorer/viewer or unrelated app-admin session | Finalization wrapper denies mutation; canonical status remains read-only where game access permits | Pending |
| 17 | Inspect the finalized Basketball Game Info | Canonical score, primary, publication, finalizer, and timestamp render; legacy Summary stays unavailable | Pending |
| 18 | Repeat Soccer recorder/readiness/finalization/reopen smoke | Existing Soccer behavior is unchanged | Pending |
| 19 | Reopen a finalized game with a manager reason | Active publication is invalidated, primary unlocks, scores clear, game returns to in-progress, and audit records the reason | Pending |
| 20 | Reopen with a short reason or scorer/viewer session | Request is denied and the active publication remains unchanged | Pending |
| 21 | Open an owned local binding after cloud reopen | Matching local cloud status refreshes and only that recorder owner can append the local reopen/correction | Pending |
| 22 | Correct, sync, end, and explicitly re-finalize | Publication number increments; the new row is active and the prior invalidated row remains in history | Pending |
| 23 | Attempt ordinary writes while final or edits to another recorder | Server/client deny mutation without changing canonical output | Pending |

The pending BKE-4B two-device matrix remains part of the combined BKE-4C exit evidence.
