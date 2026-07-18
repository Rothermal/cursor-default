# Plan: SOC-1 Shared Event Foundation

Detailed implementation plan for the sport-neutral event infrastructure required by the
soccer program. This phase builds and tests the foundation behind disabled UI. It does not
add production soccer event types, enable soccer, or change basketball tracking behavior.

Status: Implementation complete; migration 042 requires manual Supabase application.

---

## 1. Goal

Create a versioned, offline-first event platform that can become the authoritative source
for soccer and later sports while preserving all aggregate-only basketball games.

SOC-1 exits when:

- a versioned raw event stream survives local game persistence and parking,
- registered event schemas validate and migrate into typed runtime events,
- deterministic sport projectors rebuild all event-derived state after mutations,
- unknown or malformed events are preserved and quarantined with diagnostics,
- a recorder-owned event can round-trip through an isolated Supabase repository,
- stale and conflicting cloud revisions are detected instead of overwritten,
- focused tests prove the model using test-only fixtures, and
- existing basketball tracking and automatic cloud sync remain unchanged.

---

## 2. Boundaries

### Included

- Generic TypeScript event envelope and actor model.
- Versioned raw `GameEventStream` embedded in `GameState`.
- Sport/event/schema registry with migration and validation hooks.
- Deterministic ordering, quarantine diagnostics, and projection engine.
- Pure initialize/add/edit/tombstone/restore mutation helpers.
- Thin event actions in the existing `gameReducer`.
- Legacy local-state normalization and sync fingerprint coverage.
- `game_events` table, RLS, indexes, and revision-aware write RPC.
- Isolated cloud serialization, player-id mapping, upsert, and per-recorder load helpers.
- Unit tests with a test-only fixture schema and projector.
- Documentation and manual regression notes.

### Excluded

- Production soccer event types or soccer tracker UI. SOC-2 through SOC-4 own those.
- Wiring events into the automatic `GameContext` cloud queue. SOC-5 owns orchestration.
- Cross-recorder merging, shared timelines, or recorder deduplication.
- Same-user multi-device sequence collision resolution.
- Finalization, correction overlays, and aggregate publication from soccer events.
- Basketball event conversion or dual-write behavior. See
  `PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md`.
- Event tombstone compaction or physical client deletes.

---

## 3. Authoritative Model

### Stream ownership

`GameState` gains:

```ts
eventStream: GameEventStream | null
```

`null` means the game is legacy aggregate-only. A versioned stream object means events are
authoritative, including when its event list is empty. Missing legacy fields normalize to
`null` during load and import.

The containing parked-game record supplies local game ownership. A cloud `game_events` row
supplies cloud game ownership. Those container identities are not duplicated as mutable
fields in every local event.

### Generic event envelope

The raw envelope contains:

- client-generated UUID `id`, used unchanged as the cloud row id,
- `sportId`, `eventType`, and `schemaVersion`,
- nullable `recorderUserId` for the independent recorder stream,
- immutable per-recorder capture `sequence`,
- ordered period/segment identity,
- nullable canonical `elapsedMs`,
- `occurredAt`, `createdAt`, and mutable `updatedAt`,
- `revision`, beginning at 1,
- tracked/opponent team side,
- optional normalized location and attacking direction,
- role-tagged actors,
- event-specific object payload, and
- nullable `deletedAt` tombstone.

Actors are discriminated by `kind`:

- `player` references a local player id in local storage,
- `staff`, `team`, and `unknown` may use labels without requiring a player row.

Sport validators define allowed actor roles, cardinality, and payload semantics.

### Ordering

Display/projection order is deterministic:

1. period/segment order,
2. elapsed match time when present,
3. recorder capture sequence,
4. event id as the stable tie-breaker.

Wall-clock timestamps are metadata and fallback context, not the sole ordering authority.

---

## 4. Registry and Projection

### Validation registry

Definitions are keyed by `(sportId, eventType)` and declare a current schema version.
Sequential migration functions convert older raw payloads into the current runtime shape.
The current validator returns a typed event or structured diagnostics.

The registry must:

- preserve the original raw value,
- reject unsupported future schema versions from projection,
- quarantine unknown event types and malformed envelopes,
- never rewrite preserved raw data merely because a runtime migration succeeded, and
- expose typed unions to sport-specific callers.

### Projection engine

The generic engine owns:

- envelope inspection,
- schema migration and validation,
- quarantine collection,
- tombstone filtering, and
- deterministic ordering.

One pure projector per sport receives the complete ordered active typed stream and rebuilds
that sport's player, team, and score projections. It does not apply generic stat deltas.

Projection health is derived through pure selectors and is never persisted. Any unknown,
malformed, unmappable, or unsupported event makes the stream projection incomplete. Valid
events may still be displayed, but incomplete streams cannot publish aggregate projections,
finalize, or perform destructive cloud replacement.

SOC-1 registers no production event schemas. Tests use a fixture soccer schema and fixture
projector to prove migration, validation, ordering, and full rebuild behavior.

---

## 5. Mutations and Reducer Integration

Event logic remains in dedicated pure helpers. The existing `gameReducer` stays the single
runtime state authority and receives thin actions for:

- explicit stream initialization,
- add event,
- update event,
- tombstone event,
- restore event.

Adding to a `null` stream is rejected. Initialization is explicit and allowed only for a
new game without legacy aggregate activity. New soccer setup will initialize its stream in
SOC-2. Legacy basketball remains `null` until the basketball migration program.

Mutation rules:

- ids and creation metadata remain stable,
- edit/delete/restore increment revision and refresh `updatedAt`,
- delete sets `deletedAt`; restore clears it,
- accepted mutations rebuild the complete projection atomically,
- invalid mutations return the unchanged state with a structured error from pure helpers,
- reducer actions do not create duplicate legacy `actionLog` rows.

Future event-backed Undo tombstones the latest active event. Restoring it is another
revisioned mutation. UI wiring belongs to the sport-specific tracker phases.

---

## 6. Local Persistence and Dirty Detection

Whole-state parking already preserves added fields. SOC-1 will additionally:

- normalize missing/invalid legacy `eventStream` values to `null`,
- validate the stream container without deleting unknown raw entries,
- include canonical raw events, revisions, and tombstones in the game sync fingerprint,
- exclude derived projections and diagnostics from that fingerprint,
- include event-backed games in persistable-game detection, and
- verify parked export/import preserves the stream unchanged.

An empty initialized stream and a legacy `null` stream must produce different fingerprints.

---

## 7. Cloud Schema and Repository

### `game_events` table

Migration `042_game_events.sql` adds one row per event with scalar columns for:

- event id, game id, and recorder id,
- sport id, event type, and schema version,
- capture sequence and revision,
- period, elapsed time, team side, and event timestamps,
- location, actors, and payload JSONB,
- tombstone and server storage timestamps.

PostgreSQL enforces the generic envelope: UUIDs, non-empty identifiers, positive versions,
non-negative sequence/time, JSON container kinds, and timestamp/tombstone consistency.
Sport payload semantics stay in the TypeScript registry.

### Access rules

- Accepted owner/admin/scorer members may insert or update events for trackable games.
- `recorded_by` must equal `auth.uid()` for every client write.
- Accepted viewers may read event rows but cannot write them.
- Managers cannot rewrite another recorder's raw stream.
- Final games reject ordinary event writes; final corrections remain separate.
- No normal client hard-delete policy is provided.

### Revision-aware writes

An RPC performs atomic event writes:

- a missing id inserts revision 1 or greater,
- a higher revision updates the existing row,
- the same revision and identical logical data is idempotent,
- the same revision with different data reports a conflict,
- a lower revision reports stale,
- an id cannot move between games or recorder owners.

Client wall-clock timestamps never decide write precedence. Same-revision multi-device
collisions are surfaced for SOC-5 rather than silently resolved.

### Isolated repository

SOC-1 adds repository functions but does not call them from automatic sync:

- serialize one local event, mapping local player actor ids to cloud player UUIDs,
- upsert one recorder-owned transport event through the revision RPC,
- load one recorder's rows in deterministic order,
- map cloud player UUIDs back to local ids,
- validate loaded events through a supplied registry, and
- return structured transport, mapping, validation, stale, and conflict diagnostics.

An unmapped local actor blocks only that event's upload and leaves it unchanged locally.
An unmapped cloud actor preserves and quarantines the untouched transport row until roster
mapping is repaired. Actor references are never silently converted to `unknown`.

---

## 8. Test Plan

### Automated

- Legacy missing stream normalizes to `null`.
- Explicit initialization distinguishes an empty authoritative stream from legacy state.
- Null-stream event mutation is rejected.
- Fixture v1 payload migrates to a typed v2 runtime event without rewriting raw storage.
- Unknown, future-version, and malformed events are preserved and quarantined.
- Tombstones are excluded from active projection but retained in raw storage.
- Ordering follows segment, elapsed time, sequence, and id.
- Add/edit/delete/restore rebuild the full projection and revisions correctly.
- Reducer event actions delegate without changing basketball behavior.
- Fingerprints change for raw event/revision/tombstone changes and ignore diagnostics.
- Park/export/import retains raw streams.
- Actor upload/download mapping succeeds and mapping failures are structured/quarantined.
- Cloud row parsing preserves invalid transport data.
- Migration text tests cover table/RLS/no-delete/revision conflict invariants where useful.

### Manual regression

- Start, track, park, resume, sync, and summarize a basketball game unchanged.
- Import an older parked-game export and confirm it remains aggregate-only.
- Confirm soccer is still disabled and no new tracker controls are visible.
- Apply migration 042 manually before exercising isolated cloud repository tests.

---

## 9. Implementation Checklist

- [x] Add generic event types, runtime envelope guards, and stream normalization.
- [x] Add typed registry, sequential migration, diagnostics, and deterministic ordering.
- [x] Add sport projector contract and complete-stream projection engine.
- [x] Add pure initialize/add/edit/tombstone/restore helpers.
- [x] Add thin actions to the existing game reducer.
- [x] Normalize local and cloud-hydrated legacy games to `eventStream: null`.
- [x] Update parking persistence/import checks and sync fingerprinting.
- [x] Add migration 042 with schema, indexes, RLS, grants, and revision-aware RPC.
- [x] Add isolated transport mapping and cloud repository functions.
- [x] Add fixture-based unit and SQL contract tests.
- [x] Update README migration list, architecture notes, and regression coverage.
- [x] Run `pnpm lint`, `pnpm test`, and `pnpm build`.

---

## 10. Resolved Decisions

1. Raw generic envelope plus sport-specific typed registry.
2. Capture sequence plus match time, with deterministic id tie-break.
3. Versioned stream embedded in `GameState`.
4. Full deterministic projection rebuild after every accepted mutation.
5. Stable ids, revisioned edits, and tombstone deletion.
6. One cloud row per event with scalar identity fields and JSON actors/payload.
7. Schema and isolated repository now; automatic sync orchestration in SOC-5.
8. Recorder-owned writes; accepted viewers read; no cross-recorder manager rewrites.
9. One client UUID is both local and cloud identity.
10. Role-tagged player/staff/team/unknown actors.
11. Versions keyed by sport, event type, and schema version; runtime migration is non-destructive.
12. Test-only fixture events in SOC-1; no production soccer catalog yet.
13. Generic stream engine plus one full projector per sport.
14. Preserve malformed/unknown rows and block publication/finalization while incomplete.
15. Dedicated pure event helpers called by the existing reducer.
16. Revision-aware cloud writes with explicit stale/conflict results.
17. Unmapped local players block only the affected upload.
18. Generic database constraints; semantic validation in TypeScript.
19. Raw stream participates in the sync fingerprint; projections do not.
20. Legacy games normalize to `eventStream: null`.
21. Projection diagnostics are derived, not persisted.
22. Unmapped cloud actors are preserved and quarantined.
23. Event streams require explicit initialization.
24. Event-backed Undo is a revisioned tombstone/restore mutation.

---

## 11. Follow-On Handoffs

- SOC-2 registers the first production soccer schemas/projector and initializes streams for
  new soccer matches while adding rules, lineup, and clock state.
- SOC-3 and SOC-4 expand the same registry and projector with match events and editing UI.
- SOC-5 wires recorder streams into parking/cloud orchestration, conflict handling,
  aggregate publication, resume, and finalization.
- BKE-0 planning may begin after SOC-1; BKE implementation waits until SOC-5 proves the
  complete event lifecycle.
