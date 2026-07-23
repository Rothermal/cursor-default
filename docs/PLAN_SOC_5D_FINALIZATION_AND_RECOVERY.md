# Plan: SOC-5D Finalization and Recovery

Status: Implemented. Migration 046 must be applied after migrations 043 through 045.

## 1. Goal

Turn one healthy soccer recorder stream into an immutable canonical result without blending
other recorders or losing late queued audit history. Finalization must be manager-authorized,
checkpoint-exact, idempotent, and reversible only through a reasoned audited reopen.

SOC-5D does not enable Soccer in production or build the complete soccer summary, field-map,
season aggregate, and settings experience. Those remain SOC-6.

## 2. Shipped Contract

### Finalization readiness

- Team owner/admin users can finalize; scorers and viewers cannot. A personal game can be
  finalized only by its creator.
- Readiness resolves the current primary, exact server checkpoint health, unresolved primary
  conflicts, lock/publication status, and a warning count for unhealthy non-primary streams.
- The primary cloud stream is reloaded and deterministically projected before publication.
  It must be complete and have an ended `completed` or `abandoned` outcome.
- When the primary is the current user, the tracker flushes that local stream first.
- An owner/admin can choose either preserved side of an unresolved primary conflict. The chosen
  event receives a new revision, the decision is audited, and the exact cloud stream is
  re-confirmed before finalization.

### Canonical publication

- `game_event_canonical_publications` is an append-only publication ledger. One partial unique
  index permits one active publication per game while retaining invalidated history.
- `finalize_soccer_event_game` locks the game row, rechecks manager access, primary identity,
  checkpoint revisions/fingerprint, conflicts, setup, every canonical event field against the
  stored primary rows, terminal match event, and event-derived scores in one transaction.
- The same transaction persists the canonical setup plus event stream, locks the primary,
  stores server-derived final scores, marks the game final, and emits `soccer_game_finalized`.
- A byte-equivalent retry returns the existing publication; a different request against an
  already final game fails.
- Direct soccer status changes cannot bypass publication-backed finalization.

### Final review and reopen

- Finalized soccer review uses the canonical snapshot, not a live union or another recorder.
- The client rebuilds the deterministic projection from the immutable canonical setup and event
  stream. A client-supplied projection is never accepted as canonical source data.
- `reopen_soccer_event_game` requires owner/admin or personal-owner access plus a reason.
- Reopen invalidates the active publication, unlocks the selected primary, restores cloud status
  to in progress, clears published score columns, updates matching local bindings, and emits
  `soccer_game_reopened`. Publication history is never deleted.
- A later primary change or corrected result requires reopen and a new publication number.

### Late non-primary audit uploads

- Finalization blocks primary edits and all new post-finalization capture.
- An accepted team recorder who is not the locked primary may finish uploading their own events,
  participant identities, conflicts, and checkpoint only when event timestamps predate the
  active publication.
- A successful late audit upload returns the authoritative final cloud status so that device
  stops presenting the match as editable.
- These rows remain recorder-owned audit history and never change canonical scores, projection,
  primary selection, or publication.
- Client occurrence timestamps cannot prove that an offline event was authored before
  finalization. `stored_at` remains the authoritative server receipt time, so late rows are
  identifiable as post-finalization arrivals and must not be treated as canonical evidence.
- Final soccer parked records remain queued until that audit upload is checkpointed; clean final
  records can then leave local parking normally.

## 3. Safety Boundaries

- Game id plus recorder id remains the stream identity.
- A canonical snapshot contains exactly one recorder's event stream plus the locked match setup.
- PostgreSQL derives publication scores from the verified stored event rows. The client derives
  the richer display projection from the immutable canonical source when loading review.
- The primary checkpoint revision set is compared again under the finalization transaction's
  game-row lock, closing the load-to-publish race.
- Event writers, conflict recording, and checkpoint confirmation take a shared game-row lock, so
  a primary mutation cannot commit between the final checkpoint check and publication.
- Primary-conflict manager resolution cannot remap event identity, sequence, creator timestamp,
  or participant actors.
- Canonical publications and finalization/reopen access-audit rows are client read-only.
- Basketball aggregate finalization and summary behavior are unchanged.

## 4. Verification

Automated coverage includes:

- canonical source round-trip, projection rebuild, and non-final-event rejection;
- readiness and active-publication parsing;
- migration 046 RLS, role, checkpoint, publication, reopen, direct-status, conflict-preparation,
  and late-audit contracts;
- SOC-5A-C cloud transport and parking regressions;
- audit event labels for primary conflict, finalization, and reopen.

Manual PostgreSQL and multi-account verification remains required because this repository has no
Supabase test harness. Use section 11m in `docs/REGRESSION_TESTING.md`.

## 5. Deferred

- Complete final summary tabs, field maps, player and team stat presentation: SOC-6.
- Soccer season/tournament aggregate publication and settings consolidation: SOC-6.
- Full release regression, production availability, and UI reskin: SOC-6.
- Domain-specific manager authoring of a third corrected conflict version: SOC-6. SOC-5D manager
  preparation can choose either durable revision; the recorder can create a normal corrected
  revision before finalization.
