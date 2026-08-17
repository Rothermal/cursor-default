# Plan: BKE-4C Basketball Recorders and Finalization

Status: Product and delivery Q&A approved. BKE-4C1 through BKE-4C4 are implemented; migrations
057 through 059 are required. The BKE-4B live two-device Supabase matrix remains pending and is
carried into the combined BKE-4C exit evidence. Basketball event-game creation remains
internal-only through BKE-4E.

## 1. Objective

Turn one healthy Basketball recorder stream into the authoritative final result without blending
independent recordings or weakening Soccer and legacy Basketball behavior.

BKE-4C adds recorder presence, deterministic provisional primary resolution, manager selection,
transactional canonical publication, audited reopen/republication, and the finalized-correction
boundary. BKE-4D owns detailed authority-aware Basketball Summary review. BKE-4E owns canonical
aggregate readers and release capability negotiation.

## 2. Required Invariants

- Game id plus recorder id remains the identity of one independent event stream.
- Selecting a primary never copies, unions, averages, deduplicates, or rewrites recorder events.
- Only one healthy selected stream can become one active canonical publication.
- Remote primary, alternate-recorder, and canonical sources are read-only. A recorder edits only
  an owned local binding.
- Finalization rechecks access, primary identity, exact checkpoint, conflicts, immutable setup,
  participants, event revisions, terminal state, and derived score inside one transaction.
- Event-backed Basketball games never write `game_stats`, `shot_chart`, or `stat_corrections`.
- Legacy aggregate Basketball finalization, corrections, checkout, and Summary remain unchanged.
- Existing Soccer wrappers, shapes, grants, behavior, and canonical envelope remain unchanged.
- Event-game creation stays behind the internal gate through BKE-4E.

## 3. Recorder Presence and Primary Authority

### Presence

A recorder appears after the first accepted cloud event or verified checkpoint. Compact presence
includes recorder identity, event/checkpoint counts, checkpoint time and currency, conflict count,
primary state, and a health label. Refresh occurs when the panel opens, after the current recorder
syncs, when focus or connectivity returns, and through bounded polling while the panel is visible.
Realtime subscriptions are not required.

Owners/admins and personal-game creators may see detailed health and immutable primary-selection
history. Scorers and viewers receive only the limited status needed to understand which recording
is primary and whether it needs attention. Profile data remains exposed only through scoped
security-definer RPC output; broad profile reads are not added.

### Provisional primary

The shared deterministic resolver remains the source of the automatic default: a healthy creator
checkpoint is preferred, otherwise the earliest healthy checkpoint wins with recorder id as the
stable tie-break. The default is computed rather than persisted. A team owner/admin or personal
game creator may explicitly select another current, conflict-free, completely projectable stream.

An explicit selection remains provisionally primary if it later becomes stale or conflicted, but
is labeled Needs Attention and cannot finalize. Scorers can create and operate their own stream but
cannot select the primary. Viewers cannot create or select streams. App-admin status does not
bypass team RLS.

Non-primary problems produce manager warnings but do not block a healthy primary from finalizing.
No user may mutate another recorder's stream, including a manager who selected it as primary.

## 4. Finalization Readiness

The selected primary is finalization-ready only when all of the following are true:

1. The caller is a team owner/admin or the personal-game creator.
2. The cloud game is an event-backed Basketball game and is not already locked by a different
   publication request.
3. The selected recorder has a complete Basketball projection with no diagnostics.
4. The verified checkpoint is current and exactly matches the stored id/revision set and
   fingerprint.
5. The selected stream has no unresolved same-recorder conflict.
6. The latest effective lifecycle outcome is `basketball.match_ended` with `completed` or
   `abandoned`; suspended and reopened streams cannot finalize.
7. A Completed game has unequal final scores. A tie must continue into overtime before completion.
   An explicitly Abandoned game may retain an unresolved tie.

The current recorder flushes their local queue before readiness is trusted. Another recorder's
stream is reloaded from cloud and projected in isolated read-only state. The confirmation surface
shows the selected recorder, final score, terminal reason, stream health, and alternate-stream
warnings.

## 5. Canonical Publication Contract

Finalization uses the private shared event-platform core through a fixed authenticated Basketball
wrapper. The neutral core remains ungranted. The wrapper installs trusted Basketball terminal and
score policy rather than making the client projection authoritative.

The canonical source contains exactly:

- the selected primary's immutable event stream, including revisions and tombstones;
- the immutable Basketball setup and game participant snapshot;
- server-derived tracked/opponent result data;
- primary, checkpoint, publication, finalizer, and timestamp metadata.

Personal capture/display settings and derived client projection caches are excluded. The existing
event-platform canonical envelope remains version 2 for Soccer compatibility. Basketball adds an
explicit canonical payload schema version 1 inside that envelope, independently versioned from the
Basketball event-stream schema.

The server derives Basketball score from effective `basketball.shot` and
`basketball.score_adjustment` rows using the trusted event schema. It rejects malformed values,
negative totals, a tied Completed result, a nonterminal stream, mismatched setup/participants,
client-supplied projection data, or any event content that differs from stored primary rows.

The finalization transaction locks the game, rechecks every readiness input, locks the selected
primary, appends one publication, writes server-derived final scores, marks the cloud game final,
and records an access-audit event. A byte-equivalent retry returns the existing publication. Any
changed primary, checkpoint, event revision, fingerprint, or snapshot is rejected as stale or
non-idempotent.

An already queued non-primary upload may finish after finalization only through the existing
pre-finalization audit path. Those rows never change canonical output, score, or primary authority.

## 6. Reopen, Corrections, and Republication

Reopen authority matches finalize authority. The request requires a non-empty trimmed reason and
uses a fixed authenticated Basketball wrapper over the private shared reopen core.

One reopen transaction:

1. locks the game and active publication;
2. invalidates, but never deletes, the active canonical publication;
3. unlocks provisional primary selection;
4. restores the cloud game to in-progress and clears published score columns;
5. records who reopened, when, and why in durable publication/access audit history; and
6. tells matching local bindings to refresh before capture or correction resumes.

Only the owner of a local recorder binding may edit that stream after reopen. Managers may select
another eligible stream but cannot edit it. If the original recorder is unavailable, a manager can
use a manager-owned independent stream as a replacement source; there is no privileged mutation of
someone else's history.

Corrections use the BKE-3 event Timeline and checked event commands. `stat_corrections` remains
legacy-only. A corrected result is unofficial until a new explicit finalization appends a later
publication number.

## 7. Management UI

- Game Tracker exposes compact recorder health from its existing cloud-status area.
- Game Info is the durable manager surface for recorder details, primary selection, finalization,
  reopen, and publication history.
- Ending a cloud-bound Basketball event game offers a direct handoff to Game Info. Local capture
  remains complete even if the network or finalization step is unavailable.
- Before BKE-4D, finalized Game Info shows canonical status, result, authority, publication, and
  audit metadata only. It does not pretend the legacy Basketball Summary is canonical.
- Scorer/viewer controls are absent as appropriate, and direct RPC calls remain server-denied.
- Other recorder details are opt-in and read-only. Loading them never hydrates `GameContext`,
  changes the active game, or blends events into the current Timeline.

## 8. Public Database Surface

Expected Basketball wrappers are sport-fixed equivalents of the permanent Soccer surface:

- recorder presence and primary-selection history readers;
- primary selection;
- finalization readiness and canonical publication readers;
- primary-conflict preparation where needed for finalization;
- manager-side primary checkpoint confirmation for a selected recorder's exact cloud stream;
- canonical finalization; and
- reason-required reopen.

Every wrapper fixes `sport_id = 'basketball'`, uses an explicit `search_path`, revokes public
execution, grants only the intended authenticated surface, and delegates to the existing private
or shared core. The generic mutation cores are not granted directly. Database policy independently
enforces role, game sport/authority, stream ownership, terminal semantics, score validity, and
checkpoint freshness.

Primary changes, conflict preparation, finalization, reopen, invalidation, and republication append
durable audit records. SEC-6 presentation may consume these event families, but BKE-4C does not
broaden app-admin access or weaken team RLS.

## 9. Delivery Slices

### BKE-4C1: Backend Policy and Contracts (Implemented)

1. Add the fixed Basketball recorder, history, primary-selection, readiness, canonical-reader, and
   manager-side primary-checkpoint confirmation wrappers needed by later slices.
2. Add trusted Basketball terminal/score validation and preserve the existing Soccer policy.
3. Define and strictly parse Basketball canonical payload schema version 1 inside the platform
   version-2 envelope.
4. Prove grants, revokes, `search_path`, sport fixing, role checks, checkpoint health, terminal/tie
   policy, audit families, and Soccer/legacy Basketball isolation through migration contract tests.

Exit: PostgreSQL can report Basketball recorder/readiness state and validate a prospective
canonical source, but no new user-facing finalization action is exposed.

Implementation record: migration 057 adds fixed Basketball preparation wrappers while keeping the
generic cores and Basketball policy private. Non-managers receive limited recorder status and
primary history stays manager-only. Shared readiness preserves Soccer and recognizes Basketball
Completed/Abandoned endings. `src/lib/basketball/finalization.ts` defines the source-only
Basketball canonical payload schema version 1 inside the existing platform version-2 envelope.
No Basketball finalization or reopen wrapper is granted.

### BKE-4C2: Recorder Presence and Primary Selection (Implemented)

1. Add Basketball recorder client models, strict RPC parsing, primary history, and isolated
   read-only projection loading.
2. Add compact tracker status and the Game Info recorder manager surface.
3. Implement deterministic defaults, explicit authorized selection, Needs Attention state,
   manager detail versus limited-reader status, and visible non-primary warnings.
4. Preserve active/parked games and current owned streams while inspecting another recorder.

Exit: authorized users can understand recorder health and select one eligible primary without any
stream blending or finalization capability.

Implementation record: `src/lib/basketball/recorders.ts` strictly parses role-limited recorder and
history RPC rows, rejects duplicate/multiple-primary output, and loads another recorder through an
isolated cloud shell plus deterministic reprojection. A shared bounded-polling hook refreshes on
sync, focus, visibility, and connectivity. The tracker shows compact primary health and links to
Game Info; Game Info gives managers explicit eligible-primary selection, immutable history,
non-primary warnings, and opt-in read-only stream inspection while scorers/viewers retain compact
status only. Game Info now supports personal Basketball cloud games through creator authority
without weakening team role checks. Active and parked `GameContext` state is never hydrated by
inspection, and finalization/reopen remain absent.

### BKE-4C3: Transactional Canonical Finalization (Implemented)

1. Add the fixed Basketball finalization wrapper over the shared core. Before invoking that core,
   the wrapper must reject a missing or unsupported `canonicalSchemaVersion`; BKE-4C3 accepts only
   Basketball canonical payload schema version 1.
2. Build canonical preview/rebuild helpers and readiness refresh with current-recorder sync flush.
3. Add the end-of-game handoff and Game Info confirmation flow.
4. Prove canonical-schema rejection at the server boundary, idempotent publication, stale-request
   rejection, server-derived score, primary locking, tied-Completed rejection, alternate warning
   behavior, and late non-primary audit isolation.

Exit: one healthy Completed or Abandoned primary stream can become one immutable active canonical
publication, and all ordinary final writes fail closed.

Implementation record: migration 058 preserves the private shared transaction while dispatching
Basketball to its trusted server score/terminal policy, and exposes only a fixed authenticated
Basketball wrapper that rejects missing or unsupported canonical payload schema versions before
delegation. `src/lib/basketball/finalization.ts` strictly parses readiness, conflicts, active
publications, and finalization results; reprojects the selected cloud recorder in isolation;
confirms an exact checkpoint when required; and submits the reviewed source-only snapshot. Ending
a bound Completed or Abandoned Basketball game hands off to Game Info, which flushes an owned
primary, presents score/terminal/health warnings for explicit confirmation, supports manager
conflict preparation, and shows canonical publication authority/audit metadata after success.
Final canonical detail review remains BKE-4D, and reopen remains absent until BKE-4C4.

### BKE-4C4: Reopen, Republication, and Exit Hardening (Implemented)

1. Add the fixed Basketball reopen wrapper and reasoned Game Info workflow.
2. Refresh/recover an owned local binding after reopen without granting cross-recorder edits.
3. Reuse BKE-3 corrections, then prove corrected re-finalization appends a new publication while
   retaining invalidated history.
4. Complete automated regression and the combined BKE-4B/BKE-4C manual Supabase matrix.

Exit: finalized correction is reopen, owned-stream edit, sync, and explicit republication; audit
history is append-only and the full cloud lifecycle is ready for BKE-4D Summary work.

Implementation record: migration 059 exposes fixed authenticated Basketball publication-history
and reopen surfaces while keeping the shared event-platform transaction private. Game Info
requires a reason, presents newest-first active/invalidated publication metadata to managers, and
refreshes matching user-owned parked bindings to in-progress through the sport-neutral recovery
callback. The recorder owner then uses the existing BKE-3 local reopen/correction flow, syncs that
independent stream, ends it, and explicitly finalizes a later publication. Strict client response
parsing and static migration contracts are covered; the combined live Supabase matrix remains
required before broader enablement.

Each slice uses its own branch and PR. Any forward-only migration is isolated in the slice that
needs it and called out for manual Supabase application. Exact migration numbers are assigned from
the repository head when implementation begins.

## 10. Automated Verification

Every slice runs focused tests, the full Vitest suite, production build, ESLint, and
`git diff --check`. Coverage must include:

- Basketball wrapper signatures, fixed sport forwarding, grants/revokes, and neutral-core denial;
- personal creator, team owner/admin, scorer, viewer, non-member, and app-admin-without-team-role;
- recorder presence from event-only and checkpoint rows, deterministic default, explicit change,
  immutable history, stale selection, and manager/limited-reader output;
- isolated other-recorder loading with no active-state or parked-game mutation;
- complete/incomplete/malformed projection, current/stale checkpoint, and open conflict readiness;
- Completed, Abandoned, Suspended, Reopened, tied Completed, overtime-decided, and adjusted-score
  terminal fixtures;
- exact canonical source matching, schema versions, server score derivation, idempotency, and stale
  transaction rejection;
- final write locks, queued non-primary audit completion, reason-required reopen, owned correction,
  and append-only republication;
- unchanged Soccer recorder/finalization/reopen contracts;
- unchanged legacy Basketball finalization/correction/Summary; and
- no event-game writes to legacy aggregate, shot, or correction tables.

Static SQL tests do not prove PostgreSQL RLS, trigger execution, transaction locks, or
security-definer behavior.

## 11. Manual Supabase Matrix

Record migration versions, account ids/roles, cloud and local game ids, browser/device profiles,
and pass/fail evidence for:

1. the pending BKE-4B personal/team bind, checkpoint, offline, recovery, conflict, parking, import,
   and Soccer parity cases;
2. owner/admin/scorer/viewer recorder presence and permission boundaries;
3. two independent recorders remaining isolated while the manager changes primary;
4. selected primary becoming stale/conflicted and later returning healthy;
5. healthy primary finalization with an unhealthy non-primary warning;
6. tied Completed rejection, overtime completion, and tied Abandoned finalization;
7. interrupted and repeated finalization proving one active publication and stale-request denial;
8. finalized write denial plus eligible late non-primary audit completion;
9. reason-required reopen, owned-stream correction, resync, and publication-number increment; and
10. Soccer canonical lifecycle plus legacy Basketball aggregate lifecycle remaining unchanged.

This matrix does not block BKE-4C implementation, but it is required before broader event-model
enablement. BKE-4E consolidates the final release evidence.

## 12. Rollback and Failure Handling

- Database changes are additive. Disable Basketball client entry points if rollout must stop; do
  not delete event streams, checkpoints, selection history, publications, or reopen history.
- A failed readiness/finalization/reopen request leaves the existing local stream and last active
  canonical publication unchanged.
- A final game without one healthy active canonical publication fails closed. It never falls back
  to live primary, alternate, aggregate, or score-only authority.
- A manager inspecting or selecting another recorder never acquires write ownership.
- Shared-platform or Soccer regressions block the affected slice from merging.

## 13. Explicitly Out of Scope

- Full local/primary/alternate/canonical Basketball Summary tabs: BKE-4D.
- Canonical season, career, tournament, team, and player aggregates: BKE-4E.
- Capability negotiation and user-visible event-game rollout: BKE-4E/BKE-5.
- Basketball settings hierarchy and rule-profile UI: BKE-5.
- Anchored clock, substitutions, and lineup intervals: BKE-6.
- Legacy Basketball conversion or historical event backfill.
- Automatic cross-recorder merging, averaging, deduplication, or collaborative editing.
- Direct manager mutation of another recorder's stream.

## 14. Approved Decision Register

The August 2026 Q&A approved all recommended options:

- deterministic healthy provisional primary with manager override;
- manager/personal-owner selection, finalization, and reopen authority;
- one selected stream with no blending;
- event/checkpoint presence, exact health, role-limited detail, and non-primary warnings;
- Completed/Abandoned terminal policy, overtime for tied completion, exact checkpoint readiness,
  and explicit final confirmation;
- source-only canonical snapshots, Basketball payload schema version 1, transactional idempotency,
  and audit-only late non-primary uploads;
- reasoned append-only reopen/republication and owned-stream-only corrections;
- tracker status plus Game Info management, with detailed Summary deferred to BKE-4D;
- fixed Basketball wrappers, trusted database policy, audit integration, and no legacy writes; and
- four implementation slices with the BKE-4B matrix carried into the exit evidence.

## 15. Next Step

Apply migration 059 after 058 and run the minimum pre-BKE-4D runtime checkpoint in
[`REGRESSION_BKE_4C_FINALIZATION.md`](REGRESSION_BKE_4C_FINALIZATION.md). Then begin BKE-4D
explicit-authority Basketball Summary work. The full combined BKE-4B/BKE-4C matrix remains the
broader event-model enablement gate.
