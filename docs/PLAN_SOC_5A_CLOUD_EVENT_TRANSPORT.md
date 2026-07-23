# Plan: SOC-5A Cloud Binding and Event Transport

Status: Implemented on `feature/soc-5a-cloud-event-transport`.

## 1. Objective

Connect the existing local soccer event workspace to Supabase without introducing conflict,
primary-recorder, or finalization behavior before those phases are ready. A successful SOC-5A
sync means one local game is idempotently bound, participant identities are snapshotted, every
local event revision is present for the current recorder, and the server has verified the exact
revision checkpoint.

## 2. Schema

Migration `043_soccer_event_cloud_transport.sql` adds:

- team or personal cloud scope on `games`, with stable `(created_by, client_local_game_id)` binding;
- nullable `games.team_id` only for explicit personal games;
- soccer sport and tracked-team metadata for personal game identity;
- `game_participants` snapshots with match identity, display data, initial role/status, and an
  optional source cloud-player link;
- `game_event_stream_checkpoints`, containing recorder event count, max sequence, exact
  event-id/revision set, client-computed stream fingerprint, and confirmation time;
- game-scoped read/track authorization helpers and event policies that support both accepted-team
  roles and a personal-game owner;
- an idempotent binding RPC and a server-verifying checkpoint RPC;
- a personal-game-aware revision writer that retains the SOC-1 stale/conflict behavior.

Direct participant/checkpoint writes remain denied. Both are written through narrow
security-definer RPCs.

## 3. Client Flow

1. Parking recognizes a fully initialized soccer event game as syncable.
2. The existing queue keeps its active-first, oldest-dirty ordering and retry behavior.
3. Before upload, the client rebuilds the complete soccer projection. Any malformed event or
   semantic diagnostic leaves the local record dirty with `Needs Attention` behavior.
4. The binding RPC finds or creates the cloud game from the stable local game id and upserts the
   current game-scoped participant snapshots.
5. The RPC returns a local-player to cloud-participant map. Player actors use that game-scoped
   identity; anonymous/team/staff actors remain self-contained event actors.
6. Each event is sent through `upsert_game_event_revisioned` and must return `applied` or
   `idempotent`.
7. The checkpoint RPC verifies cloud count, maximum sequence, and every event id/revision before
   recording the client-computed stream fingerprint as comparison metadata.
8. `GameContext` re-reads the parked record after network awaits. It clears dirty state only when
   the local fingerprint still matches the uploaded snapshot.

## 4. Existing Game Adoption

SOC-2 through SOC-4 games already use stable event ids and normalized setup snapshots. No data
migration or event rewrite is required. Once migration 043 is available and the user is online,
any healthy parked soccer game enters the same queue, binds by its existing local id, snapshots
its current participants, and uploads its unchanged event stream.

Games with malformed envelopes or projection diagnostics remain local and receive a sync error;
SOC-5A never uploads only the apparently healthy subset.

## 5. Compatibility

- Legacy aggregate games continue through `syncGameSnapshotToCloud`.
- Soccer event games never enter aggregate stat/shot replacement, including a defensive sport-id
  guard against an empty aggregate soccer shell.
- Personal soccer rows are excluded from the legacy latest-aggregate-game query. Team-scoped
  soccer rows remain visible in Cloud Games but route back to the parked Soccer dashboard instead
  of opening through aggregate hydration until SOC-5B adds event-aware cloud resume.
- Cloud-team matches retain their selected team and season; local-roster matches do not create a
  season, team, roster, or permanent player records.
- Soccer remains development-only and is not finalizable in SOC-5A.

## 6. Verification

- Unit-test participant snapshot mapping, cloud-team source links, deterministic checkpoints,
  late participant resolution, healthy existing-game adoption, and diagnostic rejection.
- Migration tests statically enforce SQL contracts. Apply migration 043 to a Supabase test project
  for the manual RLS, idempotency, and transactional checks below; this repo has no Postgres test
  harness, so Vitest does not claim database-runtime coverage.
- Run the full Vitest suite, TypeScript production build, and ESLint.
- Manually verify online kickoff, offline kickoff/reconnect, parked-game retry, personal and cloud
  team scope, a revision/tombstone upload, and no basketball cloud-sync regression.

## 7. Deferred

- Remote stream hydration, same-recorder merges, and conflict UI: SOC-5B.
- Other-recorder visibility and primary selection: SOC-5C.
- Canonical publication, finalization, and audited reopen: SOC-5D.
