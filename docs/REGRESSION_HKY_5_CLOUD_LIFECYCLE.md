# Regression: HKY-5 Cloud Lifecycle

Record for [HKY-5](PLAN_HKY_5_CLOUD_LIFECYCLE.md). Each slice adds its section when it
lands.

## HKY-5A Server registration and Hockey wrappers

Migrations `072_hockey_event_platform_publication_constraint.sql` (stages the publication
sport check `NOT VALID`) and `073_hockey_event_cloud_lifecycle.sql` (validates and swaps
it, then everything else). Not yet applied to the Supabase project; the owner applies both,
in order, before the HKY-5B client ships.

### Local database

All 73 migrations applied in order to a throwaway PostgreSQL 16 database with stubs for
Supabase's `auth` schema (`auth.users`, `auth.uid()` from `request.jwt.claim.sub`) and the
`anon`, `authenticated`, `service_role` and `authenticator` roles. Calls ran under
`SET ROLE authenticated` with the user set per call. This exercises the SQL, grants and
row-level checks, not PostgREST or the deployed project. The harness is in
[`supabase/tests/hky5a/`](../supabase/tests/hky5a/README.md): `run.sh` rebuilds the cases,
applies every migration and runs the three tables below, exiting non-zero on any mismatch.
Changing the policy's early-clinch rule to "more goals wins" makes it fail on review probe 1.

**Server and client parity.** Games built with the real Hockey commands (the same ones the
tracker runs) were loaded as cloud events. The server policy's score was compared with the
client's final score (`result.finalScore`, or the score when abandoned):

| Game | Client | Server | Result |
|---|---|---|---|
| Regulation win with saves, misses, blocks, signed adjustments and an undone goal | 3-1 | 3-1 | Pass |
| Youth tie | 1-1 | 1-1 | Pass |
| Scoreless youth tie | 0-0 | 0-0 | Pass |
| Shootout early clinch (2-0 with one opponent attempt left) | 1-0 | 1-0 | Pass |
| Shootout sudden-death win after a complete round | 0-1 | 0-1 | Pass |
| Review probe 1: reasoned end after only the first attempt of a three-round shootout (goals 1-0, no winner) | 0-0 | 0-0 | Pass |
| Review probe 2: reasoned end after the first sudden-death goal, before the answering attempt | 0-0 | 0-0 | Pass |
| Shootout abandoned mid-round | 0-0 | 0-0 | Pass |
| Overtime goal after a tied regulation | 1-2 | 1-2 | Pass |
| Abandoned in the second period | 2-1 | 2-1 | Pass |
| Ended early with a reason | 0-1 | 0-1 | Pass |
| Reopened, adjusted and ended again | 1-1 | 1-1 | Pass |
| Suspended | not ended | refused | Pass |
| Reopened and not ended again | not ended | refused | Pass |
| In progress | not ended | refused | Pass |

**Refused inputs** (each a copy of a valid game with one change):

| Change | Server |
|---|---|
| Shootout `rounds` missing, `2.5`, or shootout rules `null` | "Hockey shootout rules are unavailable for finalization" |
| Two shootout starts; attempts differing by two; attempts without a start | "invalid Hockey shootout data" |
| Attempt outcome `blocked`; shot outcome `scored`; adjustment delta `2` or `"1"`; a goal on the neutral side; shot schema version 2 | "invalid Hockey scoring data" |
| Adjustments taking a score below zero | "Canonical Hockey scores are invalid" |
| End event schema version 2 | "do not end in a final Hockey outcome" |
| A removed tracked goal (valid) | Accepted 0-1 |

**Lifecycle as real roles** (team game, shootout early clinch):

| Step | Result |
|---|---|
| `get_hockey_release_capabilities` as a scorer | `contractVersion` 1, migration 73 |
| Scorer binds with `bind_hockey_event_game_v5`, uploads 15 events (player actors mapped to participants) and confirms the checkpoint | Pass |
| Readiness: viewer and scorer cannot finalize; owner can; primary is the scorer, ended, checkpoint current, no conflicts | Pass |
| Recorder list: owner sees event counts, viewer sees none | Pass |
| Viewer finalize refused; owner finalize without `canonicalSchemaVersion` refused | Pass |
| Owner finalizes: publication 1, game final at 1-0 (shootout goal added) | Pass |
| Scorer event write after final refused | Pass |
| Reopen with a one-letter reason refused; scorer reopen refused; owner reopens: game in progress, tracked score cleared and opponent score reset to 0 (shared reopen behavior), publication 1 inactive with its reason | Pass |
| Scorer publication history refused; owner re-finalizes: publication 2, final 1-0 | Pass |
| Audit rows: `hockey_game_finalized` 1, `hockey_game_reopened` 1, `hockey_game_finalized` 2 | Pass |
| Outsider readiness refused; Hockey setup version 2 refused; personal Hockey bind accepted | Pass |
| Baseball through the private binder and readiness, as the database owner: "Sport is not supported by the event platform" | Pass |

The re-created `bind_event_game_v2`, `get_event_finalization_readiness` and
`finalize_event_game` differ from their 069, 057 and 058 sources only by the added Hockey
lines (checked by script and by `migration073.test.ts`).

### Automated

`src/lib/hockey/migration073.test.ts` (8 cases): staged then validated constraint; Hockey
only, no Baseball, Football or aggregate functions; shared functions equal their latest
sources plus the Hockey branch; terminal predicate; score and decided-shootout policy;
wrapper grants and private cores; canonical schema check before finalizing; handshake.
`src/lib/hockey/hky5aParityCases.test.ts` builds the 15 parity games and checks the client
scores in the table above; the database harness reuses it.

Checks: `pnpm typecheck`, `pnpm lint` (no errors, 3 existing warnings), `pnpm test`
(266 files, 2516 tests on the merged head) and `pnpm build` pass.

## HKY-5B1 Client sync

### Automated

`src/lib/hockey/cloudSync.test.ts` (17 cases):

- route: `hockey_events` only for an `automatic` game; local-only, missing (pre-HKY-5B) and
  malformed policies stay `unsupported`; a malformed policy reports a repair error;
  local-only strips binding metadata; legacy stat-grid Hockey is untouched;
- adapter: fixed binder, frozen setup, `source_player_id` only for team games, anonymous
  participants for players without ids; sync refuses device games and other recorders;
- Enable cloud sync: offered only for a device game this account recorded, with the
  reason otherwise; uploads with the automatic policy and records the binding; stops
  before uploading on inactive access, a viewer role or a failed handshake;
- handshake: exact contract 1 / migration 73 only, contract 0 or a missing RPC means the
  migrations are not applied, a newer contract means a stale client, per-account cache;
- setup choice: signed out or This device only saves locally; Cloud starts only after a
  ready handshake and never falls back silently.

`src/lib/hockey/cloudRecovery.test.ts` (4 cases, from the PR #472 review): a team game
whose source player was deleted before its first upload resolves the approving team from
its immutable setup, offers Preserve history to the owner, and sends the one-attempt
approval on the first bind.

### Manual (after the owner applies 072 and 073)

| Step | Expected |
|---|---|
| New Hockey game, signed in, before the migrations are applied | Cloud shows the backend-update message with Retry and This device only; Start is disabled until one is chosen |
| New personal Hockey game with Cloud | Events sync as recorded; the game appears in Cloud Games |
| New team Hockey game with Cloud as a scorer | Same, bound to the team and season |
| Hockey game made before HKY-5B | Stays on this device; the Game menu offers Enable cloud sync, which uploads every event |
| Park the cloud game, then open it from Cloud Games | Resumes the parked copy |
| Open the same team game from Cloud Games on a second account (scorer) | Offers to start an independent recorder stream |
| Open it as a viewer, or after it is final | Goes to Game Info |
| Edit the same event on two devices with one account | Conflict banner, Review, keep local or cloud |
| Team game kept offline, a source player deleted elsewhere, then reconnect | Binding error; the team owner sees Preserve history, which binds with the frozen player |

## HKY-5B2 Recorders, finalize and reopen

### Automated

`src/lib/hockey/finalization.test.ts` (10 cases):

- published score: goals plus adjustments, one goal for a decided shootout, also when the
  game is abandoned after the shootout; ended publishes as completed, abandoned as
  abandoned, suspended and running games do not publish;
- canonical snapshot: version 2 envelope, payload schema 1, setup only (no projection),
  round-trips through the parser; another recorder, a cached projection or another schema
  is refused;
- prepare confirms the exact checkpoint with the Hockey wrapper and rechecks readiness;
  finalize sends the snapshot to `finalize_hockey_event_game` and returns the stored score
  (the preview score, flagged unconfirmed, when it cannot be read back); a suspended primary
  is refused before any checkpoint call;
- reopen trims the reason and refuses a short one; history has no reopen mode;
- a finalized binding refuses capture, corrections, Undo and remove with one message, and
  accepts capture again once the binding is in progress;
- the reopen handoff appends `hockey.match_reopened` with the reason only to the primary
  recorder's ended stream, never earlier than its last event, once; anyone else's copy
  only returns to in progress; another game id is refused.

`src/lib/hockey/recorders.test.ts` (2 cases): the fixed Hockey wrappers for recorders,
history and primary selection, and the duplicate-primary and echo checks.

The Basketball recorder, finalization and reopen tests pass unchanged on the shared code.

### Manual (after the owner applies 072 and 073)

| Step | Expected |
|---|---|
| Owner opens Game Info for a synced Hockey game while it is in progress | Recorder Streams list; no Finalize until the primary ends or is abandoned |
| Second scorer records an independent stream; owner selects it as primary | Primary changes and the history lists the selection |
| Primary ends the game; owner chooses Review Finalization | Review shows the score (with the shootout note when one decided it) |
| Finalize and Lock | Game Info shows Final with the server's score; Cloud Games shows final |
| Recorder opens the game afterwards | Tracker shows the read-only banner; capture, Timeline edits and Undo are refused; no local Reopen |
| Suspended primary | Finalize stays unavailable |
| Owner reopens with a reason on the recorder's device | Publication history shows it invalidated; a parked copy of the game is in progress again with the reason in the Timeline (a cleanly synced final copy may already have been cleared on reload: opening the game then loads the recorder's stream, and the Game menu Reopen continues it) |
| Recorder corrects a goal and syncs; owner finalizes again | Publication 2 with the corrected score |
| Viewer opens Game Info for a final game | Score and recorder presence; no Finalize or Reopen; opening says there is no stream of theirs |

### Pending

- Apply 072 and 073 to the Supabase project (owner).
- Two-device live check after HKY-5B2: one recorder, a viewer on a second device, finalize,
  reopen, correct and re-finalize (the manual table above).
