# Plan: SOC-5C Independent Recorders and Primary Resolution

Status: Implemented. Migration 045 must be applied after migrations 043 and 044.

## 1. Goal

Let multiple authorized users record the same soccer game without blending their event histories.
Every recorder retains an independent stream and projection. One provisional primary stream is
the only source eligible for canonical review, while all other streams remain durable and
available read-only.

SOC-5C does not finalize, publish aggregates, lock a primary selection, or enable Soccer in
production. Those remain SOC-5D and SOC-6.

## 2. Shipped Contract

### Recorder presence

- `get_soccer_game_recorders` returns one compact row per recorder with event count, verified
  checkpoint time, checkpoint currency, unresolved conflict count, primary status, and whether
  the current user may select a primary.
- The live tracker displays recorder count, primary name, and an attention indicator.
- Presence refreshes after the current recorder syncs, when the window regains focus, and every
  30 seconds during a cloud-bound match.
- Profile names are exposed only through the scoped security-definer RPC; broad profile reads
  remain denied.

### Independent recording

- `bind_soccer_event_game_v3` preserves the original game creator while allowing an accepted
  owner, admin, or scorer to bind a new recorder-owned stream to an existing team soccer game.
- A second recorder starts from the immutable match setup and game participant snapshot, then
  creates their own opening-lineup, period-start, and clock-start events with new event ids.
- No event is copied from another recorder. Personal games cannot add another recorder.
- Cloud Games resumes an active or parked local binding before loading cloud state, preserving
  unsynced work. Load or projection failures stop the open flow and never become a new kickoff.
- An existing recorder resumes only their own stream through the SOC-5B merge/conflict path.
- Shared participant snapshots contain setup/identity metadata only. Live role and status remain
  recorder-derived; only the game creator can refresh shared names, numbers, and game headers.

### Read-only streams

- Other-recorder event rows load into isolated projection state and are never dispatched into
  the active `GameState`.
- Detailed stream inspection is off by default. The recorder dialog can opt into one read-only
  stream at a time and shows score, status, projection health, and timeline rows.
- Viewers and users without a recorder stream open `/#/soccer/review?gameId=...`, which displays
  only the resolved primary projection.
- `primarySoccerRecorder` returns the single server-resolved primary; callers never union streams
  for canonical statistics.

### Provisional primary

- `game_event_primary_recorders` stores an optional explicit selection. Until selected, the
  healthy creator checkpoint is preferred, then the earliest healthy checkpoint.
- Automatic defaults are not persisted, so a healthy creator takes precedence even when another
  recorder completed the first checkpoint. Explicit owner/admin selections remain durable.
- Only a team owner/admin or personal-game owner can change the primary.
- The target requires a current, conflict-free verified checkpoint. The UI also requires the
  event stream to project without diagnostics.
- Changes append immutable `game_event_primary_recorder_audit` rows and emit the existing
  `soccer_primary_recorder_changed` access-audit event.
- A selected stream can later become stale; it remains primary but displays Needs Attention and
  cannot pass SOC-5D finalization.
- `locked_at` and `locked_by` are reserved for SOC-5D. SOC-5C never locks a selection.

## 3. Safety Boundaries

- Game id plus recorder id remains the stream identity.
- Recorder selection never grants write access to another recorder's events.
- Scorers can create and sync their own stream but cannot select the primary.
- Viewers can inspect team streams but cannot create, revise, resolve, or select them.
- A primary change never rewrites, deletes, combines, or republishes event rows.
- Basketball aggregate sync, checkout primary-recorder behavior, and shot-chart resolution are
  unchanged.

## 4. Verification

Automated coverage includes:

- primary-only selection with no fallback union;
- recorder RPC parsing and cloud-player actor mapping;
- isolated read-only projection;
- fresh independent kickoff bound to the existing cloud game;
- local-binding precedence, empty-stream detection, and load-error propagation;
- migration 045 RLS, role, audit, checkpoint-health, and v3 binding contracts;
- existing SOC-5A/B transport and same-recorder recovery tests.

Manual PostgreSQL verification remains required because this repository has no Supabase test
harness. Use the SOC-5C matrix in `docs/REGRESSION_TESTING.md`.

## 5. Deferred

- Primary lock, canonical snapshot publication, finalization, and audited reopen: SOC-5D.
- Owner/admin resolution of another recorder's outstanding same-recorder conflicts during
  finalization preparation: SOC-5D.
- Soccer summary, field-map comparison, season aggregates, settings consolidation, full release
  QA, and production enablement: SOC-6.
- Live cross-recorder co-editing, automatic stream blending, and deduplication: not planned.
