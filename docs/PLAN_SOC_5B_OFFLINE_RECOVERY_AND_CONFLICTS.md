# Plan: SOC-5B Offline Recovery and Same-Recorder Conflicts

Status: Implemented. Migration 044 must be applied after 043.

## 1. Goal

Resume one recorder's soccer event stream on another device without replacing offline work.
Pull cloud history before upload, merge unrelated events, and require an explicit choice only when
both devices changed the same event after their last common cloud-confirmed copy.

SOC-5B does not expose other recorders, choose a primary recorder, finalize soccer games, or enable
Soccer in production. Those remain SOC-5C, SOC-5D, and SOC-6.

## 2. Recovery Contract

Migration `044_soccer_event_recovery.sql` adds:

- an immutable event-game setup snapshot required to reconstruct soccer rules and opening roster;
- durable recorder-owned conflict rows containing both competing event revisions;
- `bind_soccer_event_game_v2`, which adopts an existing cloud game id, preserves the original local
  binding, snapshots setup once, and returns the current participant map and metadata atomically;
- narrow RPCs to record and resolve a same-recorder conflict without granting direct table writes.

The client stores a per-event last-confirmed base in `CloudSyncState`. For each event id:

1. An event present on only one side is preserved.
2. Identical local and remote copies are idempotent.
3. If exactly one copy differs from the confirmed base, that copy wins.
4. If both copies differ, or no common base is known, the local copy remains active and both copies
   are stored as a conflict.
5. Choosing **This Device** creates a revision above both copies. Choosing **Cloud** adopts the cloud
   revision exactly. Either choice is queued locally and closes the cloud audit row on next sync.

Projection validation runs after merge and before upload. Semantically incomplete merged history is
preserved locally with Needs Attention status and is never checkpointed as healthy.

## 3. Resume and Queue Behavior

- Soccer Cloud Games may include team-scoped and personal rows.
- Resume loads the immutable setup, current participants, this user's event stream, and open conflict
  rows before creating a local parked record.
- A team member with no recorder stream cannot accidentally open another recorder's stream as their
  own; multi-recorder visibility remains SOC-5C.
- Automatic sync pauses while explicit conflicts remain, but the parked record stays dirty and
  discard protection remains active.
- Unrelated remote events are projected and uploaded with local events before the server confirms a
  new exact revision checkpoint.
- Local edits made while recovery is awaiting the network are not overwritten. The merged result is
  adopted only when the sync-start fingerprint still matches the latest parked record.

## 4. Recovery UI

- The tracker status changes to **Needs Attention** and opens a side-by-side conflict dialog.
- Each choice shows event type, revision, side, match time, active/removed state, update time, and
  payload details.
- Retry details remain visible on the tracker for non-conflict sync errors.
- A one-game JSON recovery export is available from conflict and retry surfaces.

## 5. Verification

- Unit test unrelated merges, one-sided revisions, divergent revisions, both resolution choices,
  participant adoption, queue pause, and migration security contracts.
- Run all Vitest tests, TypeScript production build, and ESLint.
- Apply migrations 043 and 044 to a Supabase test project for database-runtime verification; static
  migration tests do not replace Postgres RLS/RPC testing.

### Manual two-device matrix

1. Sync a soccer game on device A; resume it from Soccer Cloud Games on device B.
2. Add an event offline on B, reconnect, and confirm A later pulls it without a conflict.
3. Edit different events offline on A and B; reconnect both and confirm both changes survive.
4. Edit the same event differently offline on A and B; confirm Needs Attention and both copies.
5. Choose each resolution in separate runs; confirm the choice survives reload and syncs cleanly.
6. Resolve while offline, reconnect, and confirm the pending audit resolution clears.
7. Add and resolve a late participant on A; confirm B adopts the participant and related events.
8. Open a personal soccer game on a second device and confirm no permanent team/player is created.
9. Confirm a different team recorder cannot resume this user's stream through SOC-5B.
10. Trigger a network failure, export recovery JSON, retry, and confirm local capture remains intact.

## 6. Deferred

- Other-recorder presence, read-only stream views, and primary selection: SOC-5C.
- Canonical publication, finalization, and audited reopen: SOC-5D.
- Importing a one-game recovery export through the UI; the export is preservation/support evidence
  in SOC-5B, while normal parked-game import remains under Settings.
