# Plan: BKE-4B Basketball Event Transport

Status: Product and delivery Q&A approved. Implementation has not started. BKE-4B is split into
three reviewable slices: BKE-4B1 shared transport and backend entry, BKE-4B2 Basketball automatic
sync, and BKE-4B3 recovery/conflicts/offline exit evidence.

## 1. Objective

Connect internally gated event-backed Basketball games to the event cloud platform completed in
BKE-4A without changing Soccer behavior, converting legacy Basketball games, or introducing final
Basketball authority early.

A healthy owned Basketball stream must bind idempotently, pull and merge the same recorder's cloud
stream before upload, preserve independent team recorders, upload revisioned events, confirm an
exact checkpoint, survive offline and cross-device recovery, and expose explicit conflict choices.
The local owned stream remains authoritative throughout BKE-4B. BKE-4C owns recorder presence,
primary selection, canonical finalization, reopen, and finalized correction integration.

## 2. Approved Boundaries

- BKE-4B1 starts only after migrations 054 and 055 are applied separately and in order and the
  BKE-4A Soccer runtime parity record is complete. Migration 056 depends on the v4 neutral platform
  installed by 055.
- Event transport is automatic through the existing local sync queue for authenticated users.
- Personal games and authorized team games ship together.
- Owners, admins, and scorers may create or resume their own recorder stream. Viewers cannot create
  an editable binding.
- Team recorder streams remain independent. BKE-4B does not blend them or select a primary.
- Only games explicitly marked `gameDataAuthority: 'sport_events'` may enter this path. Aggregate
  Basketball games are never converted or inferred from partial cloud rows.
- Event games do not write `game_stats` or `shot_chart`. Raw events and exact recorder checkpoints
  are their cloud source until canonical projection phases.
- The production capability version and user-visible creation settings remain unchanged. Existing
  event cloud records remain discoverable even when the device creation gate is off.
- BKE-4B adds no Basketball finalization wrapper. An event binding creates the setup snapshot that
  activates canonical final-state enforcement, so direct final status and finalization attempts
  must fail closed until BKE-4C.
- A locally ended stream still uploads completely and checkpoints successfully while the cloud
  `games.status` remains `in_progress`.

## 3. Shared Transport Contract

The existing Soccer order is the required event-platform order:

```text
validate healthy owned local source
  -> bind or resume this recorder
  -> load this recorder's remote stream
  -> three-way merge against the last cloud-confirmed base
  -> persist competing same-event revisions as conflicts
  -> rebuild and require a complete sport projection
  -> upload every merged event revision/tombstone
  -> close pending explicit conflict choices
  -> confirm exact count, max sequence, id/revision set, and fingerprint
  -> mark the local record synced only if no newer local edit exists
```

The client implementation extracts this workflow from Soccer into `src/lib/gameEvents/` with a
small sport adapter for binding, setup/participant serialization, normalization, projection, and
product-facing error labels. Soccer keeps its existing RPC names and observable behavior. The
shared layer must not import Soccer or Basketball domain modules.

`gameEventSyncBase`, the three-way merge, and conflict resolution move from Soccer ownership into
the shared event package. Compatibility re-exports are acceptable during the extraction when they
reduce churn, but new Basketball code must consume the shared owner.

## 4. Binding And Participant Rules

Migration 056 adds one authenticated entry point:

```sql
bind_basketball_event_game_v4(
  p_existing_game_id uuid,
  p_client_local_game_id text,
  p_source_team_id uuid,
  p_source_season_id uuid,
  p_team_name text,
  p_opponent_name text,
  p_competition_name text,
  p_game_date date,
  p_participants jsonb,
  p_setup_snapshot jsonb
)
```

It is a fixed `'basketball'` wrapper over private `bind_event_game_v4`. The neutral core remains
ungranted. The already-generic revision writer, conflict record/resolution, and checkpoint RPCs are
reused directly; Basketball wrappers for those functions would add surface without adding policy.

The binding sends the complete immutable Basketball setup and every tracked/opponent participant.
Stable match participant ids remain `client_participant_id`; source cloud player links remain
one-way resolution metadata. Team and neutral actors do not become synthetic participants.
Participants added during the game use the same immutable-identity rules as the local event model.

The v4 core already enforces personal/team scope, accepted team tracking authority, immutable setup,
stable local binding, participant identity, and finalized non-primary audit restrictions. BKE-4B
must prove those checks through the Basketball wrapper rather than duplicate them in client code.

## 5. Local Authority And Retry

- Network, binding, upload, conflict-audit, or checkpoint failure never rolls back local events.
- A partially completed first sync retains its cloud `game_id`; retry reuses the idempotent binding
  and uploads only the state still needed for an exact checkpoint.
- One sync may run per local game. A later local revision makes an older async result stale; stale
  completion cannot clear dirty state, replace events, or overwrite conflict metadata.
- The existing parked-game sync queue, focus/online retry, dirty revision, and post-await latest
  state checks remain the orchestration boundary.
- Sync state distinguishes syncing, offline/pending, conflict, malformed/quarantined source, and
  ordinary transport failure. Event payload contents are not written to diagnostics or telemetry.
- Tracking remains available while offline or during ordinary retries. An unresolved conflict or
  malformed merged source blocks upload/checkpoint until repaired, but preserves the coherent local
  game.

## 6. Pull, Merge, And Conflicts

Pull always precedes upload. The merge compares local and remote versions of each event against
`cloudSync.eventSyncBase`:

- one-sided or unchanged events merge automatically;
- if only one side changed from the base, that side wins;
- if both changed the same event differently, preserve the local candidate, create/update the
  recorder-owned cloud conflict row, and block the checkpoint;
- unrelated local and remote events combine deterministically;
- malformed envelopes, duplicate ids, unsupported versions, or an incomplete Basketball
  projection quarantine the remote/merged source instead of dropping rows.

Conflict review becomes sport-neutral. Choosing Local or Cloud creates the existing pending
resolution record and must produce a complete Basketball projection. For Basketball, the chosen
value is uploaded at a revision greater than both competing revisions before the cloud conflict
audit row closes. The shared helper must retain Soccer's established remote-choice revision
behavior through an explicit adapter policy; BKE-4B cannot silently rewrite Soccer conflict
semantics merely to make the implementation uniform. Invalid choices are rejected locally without
mutating the stream or marking the conflict resolved.

## 7. Cross-Device Resume And Parking

Cloud Games must distinguish event-backed Basketball from aggregate Basketball using the immutable
setup row plus strict setup/state normalization, never merely the presence of raw event rows.

Opening an owned Basketball event cloud game follows this order:

1. resume a local parked record already bound to the cloud `game_id`;
2. otherwise load the current user's recorder stream, immutable setup, participants, and open
   conflicts into one new local parked record;
3. reject adoption when the recorder has no stream and lacks tracking authority;
4. preserve any other active game and use the existing parking transition;
5. fail without replacement when the 12-game capacity is reached.

Adoption preserves event ids, revisions, setup, participants, sync base, conflicts, binding ids,
and dirty state. Parking and Settings export/import retain `eventSyncBase`, open conflicts, pending
conflict resolutions, and cloud metadata. Import never silently rebinds one local record to a
different cloud game.

Existing event records remain resumable regardless of the device's internal creation toggle. That
toggle controls only creation, not history or recovery. Remote review and alternate-recorder review
remain BKE-4C/BKE-4D scope; BKE-4B opens only the current user's editable recorder stream.

## 8. Delivery Slices

### BKE-4B1: Shared Transport And Backend Entry

1. Add migration 056 with the fixed authenticated Basketball v4 binding wrapper, explicit revoke,
   grant, `security definer`, and `search_path` contract.
2. Add regression coverage proving the effective migration-055
   `confirm_game_event_stream_checkpoint` definition and migration-053
   `is_event_checkpoint_current` both filter event scans by the stored/requested sport. Migration
   056 must not reissue either function or restore migration 051's superseded unfiltered scan.
3. Move same-recorder merge/base/conflict helpers into `src/lib/gameEvents/` while preserving all
   Soccer behavior and tests.
4. Extract the bind/pull/merge/upload/resolve/checkpoint algorithm into a sport-neutral client
   transport with strict adapter boundaries.
5. Keep Soccer as the first adapter and prove byte-equivalent RPC names, ordering, errors, recovered
   state, and checkpoint semantics.
6. Add the Basketball adapter contract and participant/setup serialization tests without routing
   live GameContext sync yet.

Exit: Soccer remains green through the shared engine, the Basketball wrapper is the only new public
RPC, and a pure/mock Basketball adapter can round-trip a healthy stream without changing app flow.

### BKE-4B2: Basketball Automatic Sync

1. Route healthy marked Basketball games through the event transport in `GameContext`; leave every
   aggregate Basketball game on `syncGameSnapshotToCloud`.
2. Bind personal and authorized team games automatically through the existing queue.
3. preserve participant mapping, event sync base, cloud game metadata, and exact checkpoint state.
4. Serialize per-game attempts and apply the existing sync-start plus post-await stale-result
   guards to events, conflicts, and pending resolutions.
5. Keep local ended games uploadable while cloud status remains nonfinal and expose the intentional
   BKE-4C finalization boundary without offering a dead-end finalization action.
6. Prove no event game writes legacy aggregate or shot-chart tables.

Exit: one-device personal/team Basketball event games sync automatically, retry safely, remain
locally authoritative, and cannot accidentally use aggregate sync or cloud finalization.

### BKE-4B3: Recovery, Conflicts, And Exit Audit

1. Add strict Basketball cloud loading/adoption for the current recorder and matching parked-game
   resume-first behavior.
2. Generalize tracker conflict controls and `GameContext` resolution methods across Soccer and
   Basketball with sport-specific projection validation.
3. Preserve conflict/base/pending state across reload, parking, export/import, offline retry, and
   cross-device adoption.
4. Add malformed remote quarantine, duplicate prevention, capacity failure, and active-game
   protection.
5. Complete automated regression and the manual Supabase matrix.

Exit: two devices can merge unrelated work, detect and explicitly resolve competing revisions,
recover after offline/partial sync, and resume without data loss or duplicate cloud/local games.

## 9. Authorization Matrix

| Scope/role | Bind own stream | Upload/correct own stream | Adopt editable stream | Other recorder stream |
|---|---:|---:|---:|---:|
| Personal creator | Yes | Yes | Yes | Not applicable |
| Team owner/admin | Yes | Yes | Yes | Deferred presence/review |
| Team scorer | Yes | Yes | Yes | Deferred presence/review |
| Team viewer | No | No | No | Read-only review deferred |
| Non-member | No | No | No | No |

App-admin status does not bypass team RLS. A finalized game can accept only the existing eligible
pre-finalization non-primary audit queue; normal BKE-4B games cannot finalize yet.

## 10. Automated Verification

Every slice runs full Vitest, build, lint, and `git diff --check`. Focused coverage includes:

- migration 056 signature, fixed sport forwarding, revokes/grants, and absence of neutral-core or
  finalization grants;
- effective migration-055 checkpoint confirmation and migration-053 checkpoint currency using the
  same sport-filtered count, sequence, and revision scans, with no superseding 056 definition;
- unchanged Soccer binding, merge, recovery, conflict, checkpoint, final-game audit, and cloud-load
  tests after shared extraction;
- Basketball setup/participant serialization for tracked/opponent, late participants, stable ids,
  source-player links, and neutral/team actor exclusion;
- personal/team binding authorization and viewer/non-member rejection;
- stored game, requested binding, and per-event sport identity agreement, including wrong-sport
  adapter/event rejection before upload can produce a checkpoint;
- pull-before-upload ordering, idempotent retry, tombstones, stale/idempotent/conflicting revisions,
  exact checkpoint count/sequence/revision/fingerprint, and partial first sync;
- unrelated-event merge, same-event conflict, local/cloud choice, invalid choice rejection, pending
  offline resolution, and malformed/duplicate remote quarantine;
- per-game serialization plus sync-start and post-await stale completion rejection;
- aggregate Basketball isolation and no `game_stats`/`shot_chart` event-game writes;
- local ended-stream upload with cloud finalization remaining blocked;
- matching parked resume, cross-device adoption, active-game preservation, capacity rejection, and
  export/import round trips;
- event-game discovery independent from the creation toggle; and
- legacy Basketball and complete Soccer regression suites.

Static migration tests do not prove PostgreSQL RLS, trigger execution, or transaction behavior.

## 11. Manual Supabase Matrix

After migration 056, record migration version, account ids, team roles, local/cloud game ids,
devices or browser profiles, and pass/fail results for:

1. personal creator first bind, idempotent rebind, offline capture, reconnect, and exact checkpoint;
2. team owner, admin, and scorer independent bindings plus viewer/non-member denial;
3. two-device same-recorder unrelated additions merging without loss;
4. two-device same-event edits producing one durable conflict and both Local/Cloud resolution paths;
5. interrupted bind/event/checkpoint stages recovering against the same cloud game;
6. malformed/duplicate remote data failing closed without overwriting the local record;
7. parked matching resume, fresh adoption, active-game preservation, and at-capacity rejection;
8. local completed/abandoned stream upload while direct/cloud finalization remains blocked;
9. aggregate Basketball sync/finalization remaining unchanged and event games producing no legacy
   aggregate/shot rows; and
10. Soccer bind, recovery, conflicts, late audit upload, finalization, reopen, and capability parity.

## 12. Rollback And Failure Handling

- Migration 056 is additive. If the client rollout must stop, disable Basketball event transport at
  the internal client route; do not delete cloud event rows, bindings, setup, conflicts, or
  checkpoints.
- Never narrow the shared constraints or remove permanent Soccer wrappers.
- A shared-client extraction regression is fixed forward or reverted before Basketball routing is
  enabled; Soccer parity is the BKE-4B1 merge gate.
- A bound local game retains its cloud id after partial failure. Creating a replacement cloud game
  is not a recovery strategy.
- Quarantined or conflicting records remain exportable and locally inspectable.

## 13. Explicitly Out Of Scope

- Recorder presence, provisional primary selection, alternate stream review, and history: BKE-4C.
- Trusted Basketball terminal/score policy, canonical finalization, reopen, and finalized
  correction integration: BKE-4C.
- Authority-aware Basketball Summary: BKE-4D.
- Canonical aggregate readers and capability-version negotiation: BKE-4E.
- User-visible event-model opt-in and settings hierarchy: BKE-5.
- Legacy Basketball event backfill or conversion.
- Dual-writing event projections into `game_stats` or `shot_chart`.
- Live collaboration or automatic merging of independent recorders.

## 14. Exit Gate

BKE-4B is complete only when BKE-4B1 through BKE-4B3 are merged, migration 056 is applied, the
automated and manual matrices are green, Soccer and legacy Basketball remain unchanged, and an
internally gated Basketball event game can bind, synchronize, recover, conflict-resolve, park,
export/import, and cross-device resume without acquiring final or aggregate authority.
