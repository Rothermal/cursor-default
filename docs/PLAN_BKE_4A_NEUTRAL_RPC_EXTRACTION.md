# Plan: BKE-4A Sport-Neutral RPC Extraction

Status: Proposed implementation plan. Depends on completed BKE-3. No Basketball client behavior is
enabled by this phase.

## 1. Objective

Extract the event cloud contracts created by Soccer migrations 043 through 046 into a
sport-neutral backend while preserving all shipped Soccer behavior. BKE-4A widens shared storage
where Basketball already requires it, but it does not bind, upload, finalize, summarize, or publish
a Basketball game from the client.

The phase exits only when the existing Soccer app still calls the same RPCs and receives the same
authorization, idempotency, conflict, recorder, finalization, reopen, and canonical-publication
behavior through compatibility wrappers.

## 2. Why Four Slices

Migrations 043-046 contain more than 2,700 lines of interdependent SQL, and the finalization layer
alone is roughly 1,400 lines. Replacing that surface in one PR would make permission, trigger, and
rollback review unnecessarily fragile. BKE-4A therefore mirrors the proven Soccer delivery order:

| Slice | Planned migration | Scope |
|---|---|---|
| BKE-4A1 | `050_event_platform_team_side_constraint.sql`, `051_event_platform_cloud_transport.sql` | Staged shared-side constraint; sport predicate, authorization, base binding, participant snapshots, revision writes, and checkpoints |
| BKE-4A2 | `052_event_platform_recovery.sql` | Immutable setup snapshots, existing-game adoption, same-recorder conflicts, and recovery wrappers |
| BKE-4A3 | `053_event_platform_recorder_resolution.sql` | Recorder presence, current checkpoints, effective/selected primary, history, and v3 binding |
| BKE-4A4 | `054_event_platform_publication_constraint.sql`, `055_event_platform_finalization_recovery.sql` | Staged publication allow-list; readiness, finalization, reopen, final-state trigger, late audit uploads, manager conflict preparation, and v4 binding |

Each slice is independently reviewable and must leave current Soccer calls operational before the
next slice starts.

## 3. Starting Constraints

The tables are already mostly sport-neutral, but the current cloud contract contains literal Soccer
gates:

- migration 042 restricts `game_events.team_side` to `tracked | opponent`;
- binding and existing-game adoption require `games.sport_id = 'soccer'`;
- recorder presence, primary selection, readiness, finalization, and reopen are Soccer-named and
  Soccer-filtered;
- canonical publications constrain `sport_id` to exactly `soccer`;
- the games final-state trigger has a Soccer-only publication/reopen branch;
- finalized audit upload and primary conflict preparation hard-code Soccer; and
- the current Soccer capability handshake checks exact Soccer RPC signatures.

The extraction baseline is the latest installed definition of every function, not the migration
that first introduced its name. Migration 046 redefines `upsert_game_event_revisioned`,
`confirm_game_event_stream_checkpoint`, `record_game_event_conflict`, and
`enforce_game_identity_and_final_state`; A1 and A2 must preserve those finalization-era bodies and
their late non-primary audit-upload behavior even though the neutral
`can_upload_final_event_audit` core is not extracted until A4.

The app currently calls Soccer wrappers including `bind_soccer_event_game_v4`, recorder/history
RPCs, finalization/readiness/reopen RPCs, conflict preparation, checkpoint confirmation, and
canonical reads. Those call sites remain unchanged in BKE-4A.

## 4. Neutral-Core Design

### Naming and visibility

- Internal neutral functions use `event` rather than `soccer` in their names and accept an explicit
  `p_sport_id` where game identity alone is not sufficient.
- Neutral cores validate the requested sport against the stored game on every existing-game path.
- Internal helper/core functions are revoked from `anon` and `authenticated` unless a later phase
  explicitly requires direct client access.
- Existing Soccer functions keep their exact signatures and authenticated grants. Each wrapper
  forwards `p_sport_id => 'soccer'` and returns the same columns/JSON keys as before.
- Security-definer functions retain `set search_path = public`; authorization stays inside the
  database and is never delegated to client-provided role claims.

### Sport policy

- A single SQL predicate defines event-capable sports as `soccer` and `basketball`.
- Shared code rejects all other sport ids before reading or mutating event-platform state.
- The `game_events.team_side` row constraint admits `neutral` in A1.
- Event definitions remain stricter than storage. Soccer's registry still accepts only tracked and
  opponent events.
- The canonical-publication constraint becomes an explicit Soccer/Basketball allow-list in A4.
- The games trigger consults the same event-capable policy rather than a Soccer literal.

### Wrapper rule

The extraction must not ask Soccer clients to adopt neutral RPC names. Compatibility wrappers are
part of the permanent backend contract, not temporary aliases to remove in BKE-4E.

## 5. BKE-4A1: Transport Foundation

Migrations 050 and 051 will:

1. widen the `game_events.team_side` check to
   `team_side in ('tracked', 'opponent', 'neutral')` without rewriting existing rows: migration 050
   adds the replacement as `NOT VALID` while the old check remains active, and migration 051 first
   validates the replacement, then removes the old check and finalizes the replacement name;
2. add the event-capable sport predicate and contract comments;
3. extract sport-neutral read/track authorization helpers without broadening team or personal-game
   access;
4. extract the base event-game binding path with explicit sport validation;
5. retain immutable game identity, stable local binding, personal/team scope, and no implicit team
   or player creation;
6. preserve participant snapshot and one-way source-player resolution rules;
7. extract the migration-046 revision-upsert and exact recorder-checkpoint bodies while continuing
   to call the existing `can_upload_final_soccer_audit` compatibility helper until A4; and
8. replace the existing Soccer entry points with signature-compatible wrappers.

### A1 proof

- Existing tracked/opponent Soccer rows remain valid and neutral rows are accepted only by storage.
- Soccer binding remains idempotent for new and existing cloud games.
- Personal and team authorization is unchanged for owner/admin/scorer/viewer roles.
- Stale revisions, tombstones, participant remapping, and checkpoint mismatches fail exactly as
  before.
- Legacy aggregate Basketball sync does not call any neutral event RPC.

## 6. BKE-4A2: Recovery and Conflicts

Migration 052 will:

1. extract immutable setup-snapshot creation and comparison into a sport-neutral binding v2 core;
2. require setup sport identity to match the requested and stored sport;
3. generalize same-recorder conflict recording/resolution without changing conflict ownership;
4. preserve the migration-046 late-audit authorization, unrelated-event merge behavior, and stale
   remote-revision rejection by continuing to call `can_upload_final_soccer_audit` until A4; and
5. retain `bind_soccer_event_game_v2`, `record_game_event_conflict`, and
   `resolve_game_event_conflict` compatibility contracts.

The generic conflict functions may remain directly shared where their existing names are already
sport-neutral. BKE-4A does not rename a neutral API merely for symmetry.

### A2 proof

- Soccer setup snapshots remain immutable and byte-equivalent through rebind.
- Another device can adopt the same Soccer recorder stream without replacing local conflict data.
- Only the recorder, or the existing approved manager finalization path, can resolve a
  conflict.
- No Basketball client path is added.

## 7. BKE-4A3: Recorder Resolution

Migration 053 will:

1. extract current-checkpoint evaluation and effective-primary selection by sport;
2. generalize recorder presence, primary history, and manager selection cores;
3. preserve team owner/admin and personal-game owner authority;
4. keep default-primary ordering deterministic and conflict-aware;
5. preserve immutable primary-selection audit rows; and
6. retain all `*_soccer_*` recorder RPC signatures and response columns as wrappers.

### A3 proof

- The creator/current healthy recorder default is unchanged.
- A selected primary must still have a current conflict-free checkpoint.
- Independent recorder streams never blend.
- Viewer/scorer/manager permissions match the existing Soccer matrix.
- Existing Soccer recorder and history client tests require no RPC-name updates.

## 8. BKE-4A4: Finalization and Recovery

Migrations 054 and 055 will:

1. widen the canonical-publication sport check to the explicit Soccer/Basketball allow-list:
   migration 054 adds the replacement as `NOT VALID` while the Soccer-only check remains active,
   and migration 055 validates the replacement before removing the old check and finalizing the
   replacement name;
2. extract shared manage/readiness/canonical-read, publication locking, invalidation, and reopen
   mechanics into neutral internal cores;
3. keep sport-specific terminal-event and score validation in trusted wrappers/policy functions,
   never in client-supplied configuration;
4. preserve Soccer's server-derived normal score, terminal-event validation, and canonical payload
   checks byte-for-byte in behavior;
5. generalize the games final-state trigger to the event-capable sport predicate while retaining the
   immutable-final rule for non-event sports;
6. generalize pre-finalization non-primary audit uploads and finalized binding checks;
7. extract manager primary-conflict preparation and checkpoint confirmation; and
8. retain every current Soccer finalization, reopen, v4 binding, conflict-preparation, and canonical
   read signature as a wrapper.

Neutral finalization cores are not granted directly to authenticated clients in A4. This prevents a
caller from bypassing sport-specific terminal and scoring validation. BKE-4C adds a trusted
Basketball wrapper only after Basketball semantics and tests exist.

### A4 proof

- Soccer finalization still requires one healthy, fully synced, conflict-free primary stream.
- Canonical Soccer scores are still derived from stored events rather than accepted from the
  client snapshot.
- Finalization remains idempotent and publication history remains append-only.
- Reasoned reopen invalidates rather than deletes, unlocks primary selection, and records the same
  audit family.
- Only pre-finalization non-primary rows may complete as late audit uploads.
- Direct final-status changes remain blocked unless they correspond to a valid event-platform
  publication or reopen transition.
- The existing Soccer capability handshake remains green without changing its advertised version.

## 9. Testing Strategy

### Automated repository tests

Each migration gets a dedicated contract test that verifies:

- constraints and explicit sport allow-lists;
- neutral-core and Soccer-wrapper signatures;
- wrapper forwarding with a fixed Soccer sport id;
- revokes/grants and security-definer `search_path` declarations;
- absence of authenticated grants on internal finalization cores;
- trigger replacement and non-event-sport fallback;
- append-only publication and reason-required reopen invariants; and
- no changes to current Soccer client RPC names.

Run the complete existing Soccer cloud sync, recorder, finalization, capability, canonical
aggregate, Summary-source, and release-entry suites after every slice. Run all Basketball event and
legacy cloud-sync tests to prove the extraction has enabled no Basketball behavior.

### Manual Supabase matrix

Apply migrations 050-055 in order to a test or deployed Supabase project and verify:

1. existing Soccer team and personal games still bind/resume;
2. owner/admin/scorer/viewer permissions are unchanged;
3. exact checkpoints, stale revisions, tombstones, and same-recorder conflicts behave unchanged;
4. multiple Soccer recorders remain isolated and primary selection remains audited;
5. Soccer finalization, canonical read, late non-primary audit upload, and reasoned reopen succeed;
6. direct final-state writes and unauthorized RPC calls fail;
7. a valid neutral event row can be stored only through an authorized event path;
8. an unsupported sport cannot bind or publish through the neutral platform; and
9. current Soccer capability negotiation still succeeds.

Runtime sign-off must record the migration versions, account/team roles used, and pass/fail result.
Static SQL tests are not evidence that PostgreSQL RLS or trigger behavior executed.

## 10. Rollback and Failure Handling

- Each migration applies transactionally, and function replacements are atomic. Constraint
  widening is a validating schema change rather than a catalog-only operation.
- For both widened checks, the `NOT VALID` add and the validation/removal live in consecutive
  migrations so the first migration can commit and release its exclusive lock. The second migration
  validates while the old constraint remains active, then takes the exclusive lock only after the
  scan to remove the old constraint and finalize the replacement name.
- Preflight table size and deployment activity before migrations 050 and 054. If the migration
  runner cannot preserve the required transaction boundary or the lock window exceeds the
  deployment budget, stop and revise the migration sequence rather than falling back to a direct
  drop/add scan.
- Do not drop Soccer wrappers, tables, history, publications, or audit rows.
- A failed migration rolls back as a unit; do not manually apply partial function bodies.
- Once neutral rows or Basketball publications exist, narrowing the constraints is not a valid
  rollback. Disable new Basketball behavior at the client/capability gate and ship a forward fix.
- Export or snapshot production schema metadata before A4 because it replaces the final-state
  trigger and finalization functions.

## 11. Explicitly Out of Scope

- Calling neutral RPCs from Basketball client code: BKE-4B.
- Basketball conflict UI or offline recovery: BKE-4B.
- Basketball primary selection, finalization, reopen, or score validation: BKE-4C.
- Basketball Summary authority: BKE-4D.
- Basketball canonical aggregate readers or release capability version: BKE-4E.
- Soccer client refactoring to neutral RPC names.
- Event backfill for legacy Basketball games.

## 12. Exit Gate

BKE-4A is complete only after A1-A4 merge, migrations 050-055 are applied in order, automated tests
are green, the manual Soccer parity matrix is recorded, and no Basketball client call site can yet
bind or publish an event-backed game. BKE-4B may then add Basketball transport against the proven
neutral layer.
