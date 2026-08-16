# Regression: BKE-4A Event Platform Extraction

Status: BKE-4A1 through BKE-4A4 automated contract coverage is implemented and migrations 050-055
are applied. Owner-only Soccer runtime parity passed on 2026-08-15. The broader role,
multi-recorder, malformed-data, and legacy Basketball matrix remains follow-up evidence rather than
a blocker for the current single-user rollout.

## Owner Runtime Record: 2026-08-15

- Environment: deployed Supabase project and deployed app, authenticated as the owner.
- Migrations 054 and 055 were already applied in order.
- `game_event_canonical_publications_sport_id_check` was present once, validated, and allowed
  `soccer` and `basketball`.
- Personal Soccer passed event capture, cloud sync, Cloud Games resume without duplication,
  finalization, canonical score readback, idempotent finalization, and reasoned reopen.
- Team-owner Soccer passed event capture, cloud sync, Cloud Games resume, finalization, and reopen.
- No app or Supabase errors were observed.

This is an owner-only practical smoke sign-off. Admin/scorer/viewer/nonmember roles, a late
non-primary audit stream, multi-recorder conflict paths, and malformed fixtures were not claimed as
tested in this pass.

## 1. Automated Gate

Run:

```powershell
pnpm test
pnpm build
pnpm lint
```

BKE-4A1 contract tests verify that:

- migration 050 adds the Soccer/Basketball/neutral replacement check as `NOT VALID` without
  dropping or validating the live constraint;
- migration 051 validates before dropping and renaming constraints;
- the event-capable sport allow-list is explicit and private;
- the neutral base binder is private while the existing Soccer signature remains authenticated;
- game and event sport identities must match;
- revision writes retain stale/conflict/idempotent behavior and finalized non-primary Soccer audit
  uploads from migration 046; and
- checkpoints still verify the exact recorder-owned event-id/revision set.

BKE-4A2 contract tests verify that:

- setup/adoption uses a private sport-neutral v2 core behind the existing Soccer v2 signature;
- requested, stored-game, and setup-row sport identities must agree;
- identical rebinds succeed while different setup snapshots lose the atomic conflict update and
  fail without replacing the stored snapshot;
- conflict rows remain recorder-owned and stale remote revisions still fail;
- only finalized non-primary Soccer audit uploads retain the late conflict-recording exception; and
- no authenticated Basketball recovery binder exists.

BKE-4A3 contract tests verify that:

- exact checkpoint health remains revision-, count-, sequence-, and conflict-aware, with every
  event scan restricted to the stored game's sport so legacy mismatched rows fail closed;
- selected-primary, creator-first, then oldest-healthy-checkpoint ordering stays deterministic;
- recorder presence columns and primary-selection history retain the Soccer client contract;
- personal owners and team owners/admins may select only a current conflict-free recorder;
- independent recorder binding cannot copy another stream or replace creator-owned shared metadata;
  and
- neutral recorder/primary/binding functions remain private behind fixed Soccer wrappers.

BKE-4A4 contract tests verify that:

- migration 054 stages the Soccer/Basketball publication allow-list as `NOT VALID`, and migration
  055 validates it before replacing the Soccer-only constraint;
- readiness, canonical reads, finalization, reopen, v4 binding, manager conflict preparation, and
  primary checkpoint confirmation live behind private neutral cores and fixed Soccer wrappers;
- Soccer terminal state and canonical scores are derived by trusted server policy;
- publication history remains append-only and reopen requires a reason;
- finalized non-primary audit uploads use the stored event-platform sport;
- direct canonical-final enforcement covers every Soccer game and only event-marked Basketball
  games, preserving aggregate-only Basketball behavior; and
- no Basketball binding or finalization RPC is granted to authenticated clients.

Static tests do not execute PostgreSQL parsing, locks, RLS, or security-definer privileges.

## 2. Migration Preflight

Before migration 050, inspect activity and row count:

```sql
select count(*) as game_event_rows from public.game_events;

select conname, convalidated, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.game_events'::regclass
  and contype = 'c'
order by conname;
```

Do not begin during an active tracking/sync window. If migration 050 cannot commit independently
before 051 begins, stop; the split exists to release the first migration's exclusive lock before
the validation scan.

## 3. After Migration 050

Verify both checks exist, the old check remains validated, and the replacement is unvalidated:

```sql
select conname, convalidated, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.game_events'::regclass
  and conname in (
    'game_events_team_side_check',
    'game_events_team_side_event_platform_check'
  )
order by conname;
```

Expected: two rows. The replacement includes `neutral` and has `convalidated = false`. Existing
Soccer capture/sync must remain operational; neutral rows remain blocked by the older check.

## 4. After Migration 051

Repeat the constraint query. Expected: one validated `game_events_team_side_check` containing
`tracked`, `opponent`, and `neutral`.

Verify function visibility:

```sql
select
  has_function_privilege('authenticated',
    'public.bind_soccer_event_game(text,uuid,uuid,text,text,text,date,jsonb)', 'EXECUTE')
      as soccer_wrapper_allowed,
  has_function_privilege('authenticated',
    'public.bind_event_game(text,text,uuid,uuid,text,text,text,date,jsonb)', 'EXECUTE')
      as neutral_core_allowed,
  has_function_privilege('authenticated',
    'public.is_event_platform_sport(text)', 'EXECUTE')
      as sport_predicate_allowed;
```

Expected: `true`, `false`, `false`.

## 5. Soccer Runtime Parity

With an authenticated test account:

1. Bind or resume one personal Soccer event game through the existing app flow.
2. Bind or resume one accepted-team Soccer event game as an authorized recorder.
3. From an authenticated client or test harness, call the permanent v1
   `bind_soccer_event_game` RPC directly with one bound game's known local id and identical
   participant payload. Confirm it returns the same `game_id` and `participant_id_map`; migration
   052's live app chain reaches the neutral base binder through v2 and no longer exercises this
   compatibility wrapper indirectly.
4. Confirm an identical app-flow rebind returns the same game and participant mapping.
5. Attempt an incompatible local-id/team binding and confirm it fails.
6. Upload a new event, an idempotent retry, a higher revision, a stale revision, and a tombstone.
7. Confirm a checkpoint with the exact revision set, then verify count, sequence, duplicate-id, and
   revision mismatches fail.
8. For an already-finalized Soccer game with a queued non-primary stream, verify only eligible
   pre-finalization audit rows and their checkpoint may finish uploading.
9. Confirm current Soccer release capability negotiation still succeeds.

Record the account/team role, game ids, migration versions, and pass/fail result. Do not create a
Basketball client binding test in A1 or A2; no authenticated Basketball binder exists until BKE-4B.

## 6. After Migration 052

Verify function visibility:

```sql
select
  has_function_privilege('authenticated',
    'public.bind_soccer_event_game_v2(uuid,text,uuid,uuid,text,text,text,date,jsonb,jsonb)',
    'EXECUTE') as soccer_v2_wrapper_allowed,
  has_function_privilege('authenticated',
    'public.bind_event_game_v2(text,uuid,text,uuid,uuid,text,text,text,date,jsonb,jsonb)',
    'EXECUTE') as neutral_v2_core_allowed,
  has_function_privilege('authenticated',
    'public.record_game_event_conflict(uuid,uuid,jsonb,jsonb)',
    'EXECUTE') as conflict_record_allowed,
  has_function_privilege('authenticated',
    'public.resolve_game_event_conflict(uuid,text,jsonb)',
    'EXECUTE') as conflict_resolve_allowed;
```

Expected: `true`, `false`, `true`, `true`.

Repeat an identical Soccer v2 bind and confirm the game id, participants, setup bytes, and setup
sport remain unchanged. Attempt the same game with a modified setup and confirm the RPC fails while
the original row remains unchanged. Repeat the SOC-5B two-device unrelated-event and same-event
conflict matrix, including an idempotent resolution retry and one stale remote-revision rejection.

## 7. After Migration 053

Verify the authenticated role can execute only the shipped Soccer recorder surface, not the neutral
cores:

```sql
select
  has_function_privilege('authenticated',
    'public.get_soccer_game_recorders(uuid)', 'EXECUTE')
      as soccer_recorders_allowed,
  has_function_privilege('authenticated',
    'public.set_soccer_primary_recorder(uuid,uuid)', 'EXECUTE')
      as soccer_selection_allowed,
  has_function_privilege('authenticated',
    'public.bind_soccer_event_game_v3(uuid,text,uuid,uuid,text,text,text,date,jsonb,jsonb)',
    'EXECUTE') as soccer_v3_binding_allowed,
  has_function_privilege('authenticated',
    'public.get_event_game_recorders(text,uuid)', 'EXECUTE')
      as neutral_recorders_allowed,
  has_function_privilege('authenticated',
    'public.set_event_primary_recorder(text,uuid,uuid)', 'EXECUTE')
      as neutral_selection_allowed,
  has_function_privilege('authenticated',
    'public.bind_event_game_v3(text,uuid,text,uuid,uuid,text,text,text,date,jsonb,jsonb)',
    'EXECUTE') as neutral_v3_binding_allowed;
```

Expected: `true`, `true`, `true`, `false`, `false`, `false`.

For one personal and one team Soccer game, exercise creator/default primary selection, a second
healthy recorder, manager selection, idempotent reselection, stale checkpoint rejection, open
conflict rejection, final-game lockout, and primary history ordering. Confirm scorers and viewers
cannot select a primary, independent streams remain separate, and a non-creator recorder cannot
change shared game or participant snapshot metadata.

## 8. After Migration 054

Inspect `game_event_canonical_publications` constraints. Expected: the validated Soccer-only
`game_event_canonical_publications_sport_id_check` remains active and the replacement
`game_event_canonical_publications_sport_id_event_platform_check` allows Soccer/Basketball with
`convalidated = false`. Apply migration 054 and commit it before running 055.

## 9. After Migration 055

Repeat the constraint query. Expected: one validated
`game_event_canonical_publications_sport_id_check` allowing `soccer` and `basketball`.

Verify authenticated access remains limited to the existing Soccer finalization/readiness/reopen,
v4 binding, and conflict-preparation wrappers plus the already-generic event writer, conflict, and
checkpoint RPCs. Confirm `finalize_event_game`, `reopen_event_game`, `bind_event_game_v4`, and all
other neutral finalization cores return `false` from `has_function_privilege` for `authenticated`.

## 10. Finalization Runtime Matrix

1. Finalize a healthy personal and team Soccer game and confirm stored-event-derived scores,
   canonical readback, idempotent retry, primary lock, and final status.
2. Finish an eligible pre-finalization non-primary audit queue after finalization; reject rows with
   timestamps after publication.
3. Reopen with a reason and confirm the publication is invalidated, not deleted, and the primary is
   unlocked. Confirm direct Soccer final/reopen status writes still fail.
4. Finalize one legacy aggregate Basketball game through its existing path and confirm later writes
   remain blocked by the immutable-final rule.
5. For a Basketball game carrying a matching event setup snapshot, confirm a direct final-status
   write fails without an active canonical publication. Do not call a Basketball neutral binder or
   finalizer; BKE-4B/BKE-4C own those client contracts.

Record migration versions, account/team roles, game ids, and pass/fail results. Static tests do not
replace this PostgreSQL trigger, privilege, and transaction evidence.
