# Plan: SOC-5 Cloud Sync and Finalization

Status: Implemented. Product decisions are complete; SOC-5A through SOC-5D are implemented.

## 1. Goal

Make soccer's recorder-owned event history durable across local parking, offline work, and
cloud devices without blending independent recorder streams or publishing ambiguous stats.
The local event stream remains authoritative while tracking. Cloud storage mirrors accepted
revisions, records verified checkpoints, and later supports explicit conflict resolution,
primary-recorder selection, finalization, and audited reopen.

SOC-5 does not enable Soccer in production. Summary, aggregates, settings consolidation,
release QA, and production enablement remain SOC-6.

## 2. Delivery Slices

### SOC-5A: Cloud binding and event transport

- Bind a local soccer game idempotently to one cloud game at kickoff or the first online sync.
- Support an existing cloud team or a personal game with no silently created team.
- Snapshot participants at game scope and retain optional links to cloud-roster players.
- Upload each event revision through the SOC-1 revision-aware repository.
- Confirm a server-verified recorder checkpoint before marking the parked game synced.
- Adopt healthy SOC-2 through SOC-4 local games without rewriting event ids or history.

### SOC-5B: Offline recovery and same-recorder conflicts

- Pull the same recorder's remote stream before binding or resuming on another device.
- Merge unrelated events and identify only competing revisions of the same event as conflicts.
- Add durable conflict records, side-by-side resolution, retry details, and export recovery.
- Preserve local edits until the server confirms both revisions and checkpoint state.

### SOC-5C: Independent recorders and primary resolution

- Keep every recorder stream separate in storage and projection.
- Show minimal other-recorder presence by default with an optional detailed read-only view.
- Add provisional primary-recorder selection and an audit trail for changes.
- Exclude non-primary streams from canonical statistics without deleting them.

### SOC-5D: Finalization and recovery

- Restrict finalization to team owner/admin users, or the owner of a personal game.
- Require a healthy, fully synced primary stream with no unresolved primary diagnostics.
- Publish canonical setup/events, derive final scores, and lock the selected primary in one
  idempotent transaction.
- Permit audit-only completion of already queued non-primary uploads.
- Add reason-required audited reopen; late primary changes require reopen.

Implemented by migration 046, `src/lib/soccer/finalization.ts`, and
`SoccerFinalizationPanel`. See
[`PLAN_SOC_5D_FINALIZATION_AND_RECOVERY.md`](PLAN_SOC_5D_FINALIZATION_AND_RECOVERY.md).

## 3. Reviewed Decisions

### Cloud authority and transport

1. The local event stream is authoritative during tracking; cloud storage mirrors it incrementally.
2. Every accepted event or revision is queued for automatic upload and offline retry.
3. Cloud transport writes individual event revisions plus recorder stream checkpoint metadata.
4. Sync failure never blocks local capture. It remains visible and blocks only finalization or an
   unsafe discard.

### Offline queue and recovery

5. The active game syncs first, followed by parked games from oldest dirty record forward.
6. A record becomes synced only after the server confirms revisions and the local
   checkpoint/fingerprint still matches the sync-start snapshot.
7. Retry uses exponential backoff plus reconnect, focus, and manual retry triggers.
8. Repeated failure preserves all local data, identifies the game and error, supports export, and
   blocks discard or finalization while the authoritative stream is unsynced.

### Recorder ownership and devices

9. Every authenticated recorder owns an independent stream; streams never auto-blend.
10. The same user on multiple devices shares one recorder stream. Unrelated events merge, while
    competing revisions of the same event require resolution.
11. Team owners, admins, and scorers may record; viewers remain read-only.
12. The tracker always shows compact other-recorder presence/status. Detailed read-only streams
    are optional behind an off-by-default toggle or tab and never enter the active projection.

### Conflict resolution

13. Only competing revisions of the same event in the same recorder stream are conflicts.
14. A recorder resolves their own conflicts; owner/admin users may resolve remaining conflicts
    when preparing finalization.
15. Resolution shows both revisions and permits choosing either or creating a corrected revision;
    the audit history is retained.
16. Unrelated remote changes continue syncing and never silently replace a locally edited event.

### Primary recorder

17. Each soccer game has one primary recorder stream.
18. The creator or initial healthy recorder is the default; owner/admin users may choose another.
19. Primary selection is provisional during play and locks explicitly at finalization; reopen
    unlocks it.
20. Non-primary streams are retained indefinitely but excluded from canonical statistics.

### Finalization

21. Team games may be finalized only by owners/admins. Personal games may be finalized by their
    owner.
22. Finalization requires a completed or abandoned match, selected healthy primary, full primary
    sync, and no primary conflicts or projection diagnostics.
23. One idempotent server transaction locks the primary revision, verifies and stores canonical
    setup/events, derives final scores from stored events, and marks the cloud game final.
24. Unsynced non-primary streams warn but do not block. Their already queued events may arrive
    later as audit-only history.

### Finalized games and resume

25. Finalization locks primary editing and new non-primary capture while allowing pre-finalization
    queued audit uploads to finish.
26. Reopen is an owner/admin, reason-required, audited server transaction that unfinalizes the game
    and restores the appropriate recorder context.
27. Another device loads cloud state before binding, compares it with local unsynced work, and
    preserves both until merge or conflict resolution completes.
28. Late primary changes never republish canonical results automatically; the game must reopen.

### Rollout and status language

29. Online kickoff creates/binds the cloud game promptly. Offline kickoff keeps stable local ids
    and binds idempotently on reconnect.
30. Local-roster matches become personal cloud games with game-scoped participant snapshots; the
    app never creates a permanent team silently.
31. Healthy existing local soccer games may bind and upload as-is, without event-history rewrites.
32. Compact states are `Local`, `Syncing`, `Synced`, `Needs Attention`, and `Finalized`. Detailed
    retries and conflicts live on a secondary surface. Primary selection, conflict resolution,
    finalization, and reopen are audited.

## 4. Safety Contract

- Aggregate basketball sync remains unchanged and cannot consume event-backed games.
- A game id plus recorder id identifies one event stream.
- Event ids, sequence ownership, revisions, tombstones, and original timestamps survive transport.
- Game participant ids are scoped to one match; optional source-player links provide continuity
  without making local or guest participants permanent roster entities.
- A checkpoint is evidence that the cloud contains the recorder's exact event-id/revision set.
  Its stream fingerprint is client-computed comparison metadata and is not independently derived
  by PostgreSQL; neither value grants permission to delete local history.
- Finalized canonical output is always reproducible from the locked primary stream and snapshots.
- Late non-primary rows retain server `stored_at` receipt time. Client event timestamps support
  offline ordering but are not proof that a late-arriving event was authored before finalization;
  those rows remain non-canonical audit history.

## 5. Deferred Beyond SOC-5

- Live collaborative co-editing of one stream.
- Automatic merging of different recorders into one projection.
- Production soccer enablement and complete summary/season UI (SOC-6).
- Basketball migration to the shared event model (BKE roadmap).
