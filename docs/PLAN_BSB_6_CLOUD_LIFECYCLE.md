# Plan: BSB-6 Baseball Cloud Lifecycle

Execution plan for the sixth Baseball phase defined in
[BSB-0](PLAN_BSB_0_BASEBALL_PRODUCT_MODEL.md) §10 and §12. It builds on BSB-1
([engine](PLAN_BSB_1_EVENT_FOUNDATION.md)), BSB-2
([roster, defaults and setup](PLAN_BSB_2_ROSTER_SETTINGS_AND_SETUP.md)), BSB-3
([tracker](PLAN_BSB_3_DIAMOND_AND_PITCH_CAPTURE.md)), BSB-4
([lineup and corrections](PLAN_BSB_4_LINEUP_AND_CORRECTIONS.md)) and BSB-5
([Summary](PLAN_BSB_5_SUMMARY.md)). It repeats the steps Hockey took in
[HKY-5](PLAN_HKY_5_CLOUD_LIFECYCLE.md), using the sport-neutral recorder, finalization,
cloud-policy and handshake code that HKY-5 extracted.

Status: approved (planning PR #484 merged 2026-10-15). Q1-Q7 follow the recommendations
until the owner says otherwise. BSB-6A is in review.

Exit condition (BSB-0 roadmap): the two-device live check passes, and finalized canonical
games review read-only.

---

## 1. Goal

BSB-6 exits when a Baseball event game behaves in the cloud the way a Hockey event game
does:

- a signed-in recorder's Baseball game binds to a cloud game, uploads its events and keeps
  syncing while it is played, offline included, with the shared conflict and recovery
  handling,
- personal games and team games both work. A team game links its roster players to the
  team, and the team's scorers and viewers see it in Cloud Games,
- a team owner or admin can finalize a finished game. The server checks the primary
  recording, works out the runs itself, publishes the canonical record and locks it,
- a finalized game can be reopened with a reason, corrected by its recorder and finalized
  again, with every publication kept in history,
- the Baseball Summary opens a cloud game read-only: the primary recording while the game
  is not final, and the canonical publication once it is,
- a release handshake keeps an older client and an older database from talking past each
  other. Without the server functions, Baseball stays on this device and says why.

Not in BSB-6:

- `bsb_*` aggregates and the five stats destinations (BSB-7). The aggregate-source guard
  (060) is not widened,
- personal Baseball settings sync (BSB-7). Team settings already save through migration
  071 and are unchanged,
- the production release stage change (BSB-7). Baseball stays `opt_in` behind the
  device toggle,
- two recorders scoring one stream together, and any shared live stream (BSB-0 §11).

---

## 2. Slices

Each slice is its own PR. Migration numbers are taken when each PR opens: today the latest
is `075_hockey_aggregate_sources.sql`, so BSB-6A would take 076 and 077.

### BSB-6A Server: register Baseball and add its wrappers

Two migrations, the Hockey 072/073 pattern: the first stages the publication sport check
`NOT VALID`, and the second validates it after the first transaction releases its lock and
adds everything else.

- **Allow-lists, Baseball only**:
  - `is_event_platform_sport` adds `'baseball'`,
  - the canonical publication `sport_id` check is replaced with one that adds
    `'baseball'`,
  - the setup-snapshot gate in `bind_event_game_v2` accepts Baseball setup version 1. The
    server stores the snapshot without parsing it, except for the two rule fields the
    score policy reads (below),
  - the aggregate-source guard (060) is not widened.
- **Ended stream**: `is_baseball_primary_stream_ended(game, recorder)` is true when the
  latest `baseball.game_ended` or `baseball.game_reopened` in the primary stream is a
  `game_ended` whose outcome is not `suspended` (Q1).
- **Score policy**: `validate_baseball_finalization_policy(game, recorder)` returns the
  tracked and opponent runs from the primary recorder's active events at their current
  revision, in the order the shared cores replay them (Q2):
  - the batting side of each half comes from the period id (`inning-{n}-top` is the away
    side) and the stored setup's `trackedSide`,
  - each half starts with no outs and empty bases, except for a placed runner when the
    stored `rulesSnapshot.placedRunnerBase` is set and the inning is at least
    `placedRunnerFromInning`,
  - for each `baseball.pitch`, `baseball.plate_appearance` and `baseball.baserunning`
    event it reads the `movements` list:
    - the plate appearance ends on the event when a movement starts from `batter` (the
      engine only allows a batter movement then),
    - a run is a movement to `home`. It counts when its `runCounts` override says so.
      When the override is null, it counts unless the event makes the half's third out
      and that out is one of these two (the projector's `runsCountByDefault`,
      `projector.ts` around line 942):
      - **the batter before reaching first base**: the third out is the batter's own
        movement, and the batter was not credited with a hit. A batter whose `inPlay.result`
        is a single, double, triple, home run or ground-rule double reached first before
        being put out, so runs on that play count. The policy reads the result from the
        event's `inPlay`, never from the movement alone,
      - **a force out**: the third out is a runner who started on a forced base, and no
        batter out comes before it in the event's listed out order. Bases are forced only
        when the plate appearance ends on the event: first is forced when occupied, second
        when first and second are, and third when all three are, all judged from the bases
        at the start of the event. An earlier batter out removes the force,
      - the third out is the `(3 - outs before the event)`th out movement in listed order,
        so the order of out movements matters and the policy keeps it,
    - out movements add to the half's outs, and the bases are updated from where each
      runner started and finished. A runner whose run does not count still leaves the
      bases,
  - `baseball.score_adjustment` deltas are added for their `team_side`,
  - it refuses malformed movements and payloads, more than three outs in a half, a
    negative or overflowing score, and an unreadable period id or rule field, as the
    Basketball and Hockey policies refuse theirs,
  - a tie is accepted. The tracker already decides whether a game can end tied,
  - a forfeit publishes the recorded runs. The forfeit winner stays in the stored end
    event and the Summary shows it (Q1).
- **Shared dispatch**: `get_event_finalization_readiness` and `finalize_event_game` gain an
  `elsif p_sport_id = 'baseball'` branch. Both are re-created from their latest bodies
  (073 for Hockey), changing only that branch, with a diff in the PR.
- **Fixed Baseball wrappers**, each a thin call into the existing private core with the
  sport fixed to `'baseball'`, named as Hockey's are:
  - `bind_baseball_event_game_v5`,
  - `get_baseball_game_recorders`, `get_baseball_primary_recorder_history`,
    `set_baseball_primary_recorder`,
  - `get_baseball_finalization_readiness`, `get_baseball_canonical_publication`,
    `finalize_baseball_event_game` (schema version 1), `reopen_baseball_event_game` (reason
    required), `get_baseball_canonical_publication_history`,
  - the three manager conflict-preparation wrappers,
  - `get_baseball_release_capabilities` contract version 1: authenticated, active app
    access, and every table and fixed RPC present, including 071's team settings save.
- Roles are unchanged: owners and admins finalize, reopen and pick the primary; scorers
  record; viewers read.
- Legacy Baseball grid games stay on aggregate sync and are never treated as event games.
- **Tests**: a `supabase/tests/bsb6a` harness, like `hky5a`, runs the policy against a
  scratch database on fixtures exported from the client engine, so the server's runs and
  the projector's score are compared on the same games: walk-offs, a third-out force with
  a runner crossing the plate, a batter out before first on the third out, a recorder
  override either way, a placed runner in extra innings, a half ended early, score
  adjustments, removed and revised events, and a forfeit. It includes the two third-out
  cases the engine counts as one run each: bases loaded with one out, a runner scores, the
  batter is retired second and the runner from first third (no force left); and a runner
  on third with two outs, the batter singles and is put out while the runner scores. Each
  is also run with its out movements in the other order.

The owner applies the migrations before the BSB-6B client deploys. The handshake keeps the
client local-only until then.

### BSB-6B1 Client: sync and cloud policy

- **Transport**: `src/lib/baseball/cloudSync.ts` adds a Baseball adapter to the shared
  event transport:
  - binding RPC `bind_baseball_event_game_v5`,
  - setup snapshot is `sportState.setup`; participants are the setup participants, with
    `source_player_id` for roster players of a team game (the Hockey rule). Opponent
    slots and pitchers stay in the setup snapshot, as they are labels,
  - conflict revision policy `advance`,
  - recovery error, rebuild and quarantine from the shared transport.
- **Routing**: `cloudSyncRouteForState` returns `'baseball_events'` for a complete Baseball
  event game whose policy is `automatic`. Legacy Baseball games keep `'aggregate'`.
- **Cloud policy** per game in `src/lib/eventCloudPolicy.ts`: a missing policy means local
  only for Baseball (the Hockey default), so games recorded before BSB-6B never upload
  unless the recorder chooses Enable cloud sync in the Game menu (Q3). Enable needs active
  access, a tracking role on the team, the handshake, and every event recorded by this
  account.
- **Setup**: `BaseballEventSetup` offers Cloud or This device only when the recorder is
  signed in. Cloud needs the handshake; a failed check explains why and offers Retry or
  This device only. The "saves on this device only" note goes away.
- **Tracker**: the sync status and conflict review that Hockey shows, from the shared
  components.
- **Cloud Games and resume**: Baseball event games appear in Cloud Games. Opening one
  resumes the recorder's matching parked binding first, then the recorder's cloud stream,
  or starts an independent stream. Final games and viewers go to Game Info.

### BSB-6B2 Client: recorders, finalize and reopen

- **Game Info** for a Baseball event game, through the shared `EventRecorderManager` and
  `EventFinalizationPanel` with Baseball's RPC names: owners and admins get the recorder
  list, primary selection, readiness with the server's reasons, conflicts, Finalize,
  publication history and Reopen with a reason. Scorers and viewers see the score, status
  and compact recorder presence.
- **Finalize**: accepts a primary stream that ended completed, by the run rule, by a time
  limit, by forfeit, or abandoned; a suspended game must be resumed and ended first (Q1).
  It previews the runs the server's policy will publish, confirms the exact checkpoint,
  then reads the stored score back. If the server counted differently, its score is shown
  with a note.
- **Pitcher decisions**: the preview notes when the primary stream has no decisions for
  its current end. It does not block finalizing. Decisions are events in the recorder's
  stream, so only the primary recorder's device can set them (Q4).
- **Reopen**: one kind, with a reason (Q5). The server invalidates the publication and
  unlocks primary selection. Events are only ever appended by their own recorder, on that
  recorder's device: a manager never appends to another recorder's stream. There are two
  paths (Q7):
  - **same account and device**: when the manager who reopens is also the primary
    recorder and holds the parked copy, the reopen result is handed to that copy (the Hockey
    handoff). It appends `baseball.game_reopened` with the reason, never earlier than its
    last event, and applying it twice changes nothing,
  - **another account or device**: there is no durable receipt to fetch (only
    Basketball's 064 has a handoff read). The primary's copy learns the cloud game is no
    longer final when its binding status is refreshed: on opening the game from Cloud
    Games or Game Info, and on the tracker's sync. The binding then reads in progress, but
    the stream stays ended. The tracker shows "Reopened in the cloud" with a Reopen button,
    which runs the existing local reasoned Reopen under the recorder's own identity. The
    recorder enters the reason. Until then the stream is unchanged, and the owner may
    finalize it again as it is,
  - either way, appending `baseball.game_reopened` ends the decisions' epoch, as in
    BSB-5D, so the recorder sets decisions again after the game ends again. A status refresh
    alone changes no event and keeps the old epoch.
- **Finalized games are read-only**: capture, Undo, Timeline remove, restore and edit, the
  Lineup sheet, endings and the decisions sheet refuse with that reason until Reopen. The
  tracker shows a banner and hides local Reopen.

### BSB-6C Client: cloud Summary

- `baseballSummarySource` gains the two remote sources Hockey's has, so a Summary reads
  exactly one of:
  - **this device**: the active or parked game (today's behavior),
  - **cloud primary**: the primary recorder's stream of a cloud game that is not final,
  - **canonical**: the active publication of a final cloud game.
- Each source is re-inspected and replayed, as today; the stored projection is never
  trusted, and a remote source never touches `GameContext` or local storage. An unhealthy
  source keeps names and shows no totals.
- `/summary?gameId=` routes Baseball event cloud games to `BaseballSummary`, before the
  legacy fallback. Game Info and Cloud Games link to it.
- Every tab works on remote sources. They are read-only: Plays, Spray and Pitches open play
  details only, the decisions card shows the stored decisions without Set or Change, and the
  link to the tracker's Timeline shows only for this device's game while it is not final in
  the cloud.

---

## 3. Data and compatibility rules

- No Baseball event type, payload, setup or rules change. Events upload exactly as stored.
- Soccer, Basketball and Hockey functions, wrappers and capability contracts are unchanged.
  The two shared dispatch functions are re-created with one added branch each.
- Football stays off the event platform until its own cloud phase.
- Legacy Baseball grid games keep aggregate sync (production holds one, BSB-0 §10).
- Existing local Baseball event games keep working on this device. Nothing uploads without
  the recorder choosing cloud.
- The cloud policy and binding metadata stay outside gameplay fingerprints.
- Server runs come from the primary stream only. Other recorders' streams stay isolated.

---

## 4. Cross-sport items touched

- **XS-2 (event-sport registration)**: Baseball is the second new sport on the event
  platform. It repeats Hockey's HKY-5A steps for Baseball only.
- **XS-3 (legacy vs event capability)**: Baseball stays in
  `LEGACY_AGGREGATE_CLOUD_SPORT_IDS` for legacy games; event games route by
  `sportGameState`.
- Shared files get Baseball entries only: the transport adapter registry, the cloud-route
  switch, the cloud-policy default, Cloud Games and Game Info dispatch, and the Summary
  route. Each Baseball entry goes in its own sport slot, so it does not collide with
  Football work.

---

## 5. Regression

`docs/REGRESSION_BSB_6_CLOUD_LIFECYCLE.md` when implementation lands:

- server (the `bsb6a` harness, and by the owner after applying): bind, upload, checkpoint,
  conflict and recovery for a Baseball game; the policy's runs on the shared fixtures;
  refusals for an unfinished or suspended stream and malformed payloads; finalize, reopen
  with reason, re-finalize and history; viewer and scorer refusals; Soccer, Basketball and
  Hockey readiness and finalize unchanged,
- client unit tests: adapter payloads, routing for event, legacy and local-only games, the
  cloud-policy default, the handshake (exact, older, newer), Game Info gating by role,
  finalized-game refusals, the reopen handoff and decision epochs, and the Summary sources.
  The reopen tests cover a manager and a primary recorder on different accounts: the
  manager's reopen appends nothing to the recorder's stream; the recorder's copy reads in
  progress after a status refresh and offers Reopen; Reopen appends once even when applied
  twice; corrections after it upload; decisions from the old epoch stop counting; and
  re-finalizing publishes the corrected runs,
- browser at phone size against the dev server: setup with Cloud, play, sync status, Cloud
  Games listing, Game Info finalize and reopen, and the cloud Summary,
- two-device live check by the owner after deploy: one recorder, a viewer on a second
  device, finalize, reopen, correct and re-finalize, then the canonical Summary. It includes
  a reopen from the second device by a manager who is not the recorder, followed by the
  recorder's Reopen on the first device. It stays pending until done,
- BSB-1 to BSB-5 tests pass unchanged; Soccer, Basketball and Hockey suites pass,
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

---

## 6. Risks

- **Server runs versus the engine.** Baseball's score comes from runner movements, and
  whether a run counts depends on the outs and bases at that moment. The policy replays
  only what it needs (outs, which bases are occupied, the placed runner and the third-out
  rule), so it is larger than the Basketball or Hockey policy. Parity tests run both on the
  same exported games, and Finalize shows both scores if they ever differ.
- **Re-creating shared functions.** Readiness and finalize serve three sports already. The
  migration copies their latest bodies and adds one branch.
- **Reopen across devices.** After a reopen from another device, the recorder's stream
  stays ended until the recorder taps Reopen. If the owner finalizes again before that, the
  same events publish again, which is correct but may surprise. Game Info says which
  recorder still has to reopen.
- **Decisions and finalizing.** Decisions can only be set on the recorder's device, and a
  reopen clears them until the game ends again. An owner finalizing from another device may
  publish a game without decisions; the preview says so.
- **Migration order.** A client deployed before the migrations stays on this device. The
  handshake does this, and setup says so.

---

## 7. Owner Questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | Which ends can be finalized: completed, run rule, time limit, forfeit, abandoned? And what score does a forfeit publish? | All five, with the runs as recorded (the Soccer, Basketball and Hockey rule). A forfeit keeps its winner in the end event, and the Summary shows it. A suspended game must be resumed and ended first |
| Q2 | Should the server work out the runs from the events itself, or trust the score the recorder's device sends? | The server works them out, as it does for the other sports, with parity tests against the engine |
| Q3 | Baseball games recorded before BSB-6B: leave them on this device, with Enable cloud sync in the Game menu? | Yes. Nothing uploads unless the recorder enables it |
| Q4 | Pitcher decisions at finalize: block finalizing until they are set, warn, or ignore? | Warn only. Decisions are optional, and only the recorder's device can set them |
| Q5 | Reopen: one kind with a reason, as Hockey has? | Yes. The local Reopen already lets the recorder correct or resume, and the owner finalizes again explicitly |
| Q6 | Slices: 6A server migrations, 6B1 sync and cloud policy, 6B2 recorders, finalize and reopen, 6C cloud Summary, each its own PR? | Yes |
| Q7 | When a manager reopens on a different account or device from the primary recorder, should the recorder's device show "Reopened in the cloud" with a Reopen button the recorder confirms, or should BSB-6A add a durable reopen receipt the recorder's device reads and applies on its own (as Basketball's 064 does)? | The Reopen button. It needs no new server read, and the recorder's own reason and identity go on their stream. A durable receipt can follow later if this becomes a chore |

---

## 8. Delivery Record

Filled in as each slice lands.

### BSB-6A (in review)

- Migrations `076_baseball_event_platform_publication_constraint.sql` and
  `077_baseball_event_cloud_lifecycle.sql`, as §2 describes. Not applied yet; the owner
  applies 076 then 077 before BSB-6B ships.
- `validate_baseball_finalization_policy` replays the primary stream in `stream_sequence, id`
  order, keeping only outs and base occupancy per half-inning, and refuses the malformed
  inputs listed in the regression record. Ties and forfeits publish the recorded runs.
- The shared `bind_event_game_v2`, `get_event_finalization_readiness` and
  `finalize_event_game` are 073's bodies plus one Baseball line or branch each; every
  Baseball wrapper is Hockey's with the sport renamed. `get_baseball_release_capabilities`
  is contract 1 (migration 77) and also requires 071's team settings save.
- Tests: `migration077.test.ts`, `bsb6aParityCases.test.ts` (24 games) and the
  `supabase/tests/bsb6a` harness (parity, 35 malformed inputs, the team role flow, and
  Hockey's HKY-5A flow on the new schema). See
  [REGRESSION_BSB_6_CLOUD_LIFECYCLE.md](REGRESSION_BSB_6_CLOUD_LIFECYCLE.md).
- Nothing on the client changes in this slice.
