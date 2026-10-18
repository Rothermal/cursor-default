# Regression: BSB-6 Cloud Lifecycle

Record for [BSB-6](PLAN_BSB_6_CLOUD_LIFECYCLE.md). Each slice adds its section when it
lands.

## BSB-6A Server registration and Baseball wrappers

Migrations `076_baseball_event_platform_publication_constraint.sql` (stages the publication
sport check `NOT VALID`) and `077_baseball_event_cloud_lifecycle.sql` (validates and swaps
it, then everything else). Not yet applied to the Supabase project; the owner applies both,
in order, before the BSB-6B client ships. Until then the handshake keeps Baseball on the
device.

### Local database

All 77 migrations applied in order to a throwaway PostgreSQL 16 database with stubs for
Supabase's `auth` schema (`auth.users`, `auth.uid()` from `request.jwt.claim.sub`) and the
`anon`, `authenticated`, `service_role` and `authenticator` roles. Calls ran under
`SET ROLE authenticated` with the user set per call. This exercises the SQL, grants and
row-level checks, not PostgREST or the deployed project. The harness is in
[`supabase/tests/bsb6a/`](../supabase/tests/bsb6a/README.md): `run.sh` rebuilds the cases,
applies every migration and runs the tables below, exiting non-zero on any mismatch.

**Server and client parity.** Games built with the real Baseball commands (the ones the
tracker runs) were loaded as cloud events. The server policy's runs were compared with the
projector's score (tracked-opponent; the tracked side is home unless noted):

| Game | Client | Server | Result |
|---|---|---|---|
| Walk-off double in the bottom of the seventh | 1-0 | 1-0 | Pass |
| Tracked team away: top-of-the-first home run, then a full regulation | 1-0 | 1-0 | Pass |
| Bases loaded, two outs: force at second for the third out while the runner from third crosses | 0-0 | 0-0 | Pass |
| Runner on third, two outs: the batter is thrown out at first while the runner crosses | 0-0 | 0-0 | Pass |
| Bases loaded, one out: the runner from third scores, the batter is retired second and the runner from first third (no force left) | 0-1 | 0-1 | Pass |
| The same play with the runner from first listed first and the batter third (the batter out before first ends it) | 0-0 | 0-0 | Pass |
| Runner on third, two outs: the batter singles and is put out while the runner scores | 0-1 | 0-1 | Pass |
| The same play with the batter's out listed first | 0-1 | 0-1 | Pass |
| Recorder override counts the run on a force third out | 0-1 | 0-1 | Pass |
| Recorder override takes away a run on a single | 0-0 | 0-0 | Pass |
| Double steal: runner steals home while the trailing runner is caught for the third out | 0-1 | 0-1 | Pass |
| Softball fastpitch, placed runner at second from the eighth: the placed runner scores in the top, a two-run walk-off home run in the bottom | 2-1 | 2-1 | Pass |
| Half ended early (time limit) with two runners on; runs in later halves | 1-1 | 1-1 | Pass |
| Slowpitch: the top half closes at five runs; two runs in the bottom | 2-5 | 2-5 | Pass |
| Run rule reached in the bottom of the fifth with two grand slams and a two-run home run (Quick PA) | 10-0 | 10-0 | Pass |
| Score adjustments +2, -1 and +3 on top of a home run | 1-4 | 1-4 | Pass |
| A scoring single removed with Undo | 0-0 | 0-0 | Pass |
| A scoring single edited so the runner holds at third (revision 2) | 0-0 | 0-0 | Pass |
| Forfeit (tracked winner) after an opponent home run: the recorded runs publish | 0-1 | 0-1 | Pass |
| Abandoned with runners on after a three-run home run | 0-3 | 0-3 | Pass |
| Reopened, adjusted and ended again | 1-1 | 1-1 | Pass |
| Suspended | not ended | refused | Pass |
| Reopened and not ended again | not ended | refused | Pass |
| In progress | not ended | refused | Pass |

Changing the policy to ignore an earlier batter out (so the runner from first stays a force)
makes it fail on the fifth row.

**Refused inputs** (each a copy of a valid game with one change):

| Change | Server |
|---|---|
| Setup row missing; `trackedSide` missing; placed runner base `fourth`, inning `8.5`, or a base without an inning | "Baseball rules are unavailable for finalization" |
| Period id `inning-7-middle`; period order that does not match the id; a half-inning going backward | "unreadable Baseball half-inning" |
| Movement from `home`; a movement that does not advance; `runCounts` as text, on a base, or missing; two batter movements; a batter movement on a baserunning play; a quick plate appearance without one | "invalid Baseball runner movements" |
| A runner moved from an empty base | "move a runner who is not on that base" |
| Two runners finishing on second | "put two runners on one base" |
| A fourth out on the third-out play | "more than three outs in a half-inning" |
| A steal recorded after the third out in the same half | "record play after the third out" |
| A pitch for the fielding side; pitch schema version 2; movements not a list or six of them; adjustment delta `1.5`, `"1"` or `51`; an adjustment for the neutral side | "invalid Baseball scoring data" |
| An adjustment taking a score below zero | "Canonical Baseball scores are invalid" |
| End event schema version 2, outcome `rained_out`, or for one side | "do not end in a final Baseball outcome" |
| The walk-off double removed (valid) | Accepted 0-0 |
| An opponent +2 adjustment (valid) | Accepted 1-2 |
| An unchanged copy (valid) | Accepted 1-0 |

**Lifecycle as real roles** (team game, the walk-off):

| Step | Result |
|---|---|
| `get_baseball_release_capabilities` as a scorer | `contractVersion` 1, migration 77 |
| Scorer binds with `bind_baseball_event_game_v5`, uploads 124 events (player actors mapped to participants) and confirms the checkpoint | Pass |
| Readiness: viewer and scorer cannot finalize; owner can; primary is the scorer, ended, checkpoint current, no conflicts | Pass |
| Recorder list: owner sees event counts, viewer sees none | Pass |
| Viewer finalize refused; owner finalize without `canonicalSchemaVersion` refused | Pass |
| Owner finalizes: publication 1, game final at 1-0 | Pass |
| Scorer event write after final refused | Pass |
| Reopen with a one-letter reason refused; scorer reopen refused; owner reopens: game in progress, scores cleared as for the other sports, publication 1 inactive with its reason | Pass |
| Scorer publication history refused; owner re-finalizes: publication 2, final 1-0 | Pass |
| Audit rows: `baseball_game_finalized` 1, `baseball_game_reopened` 1, `baseball_game_finalized` 2 | Pass |
| Outsider readiness refused; Baseball setup version 2 refused; personal Baseball and Hockey binds accepted | Pass |
| Football through the private binder and readiness, as the database owner: "Sport is not supported by the event platform" | Pass |
| Hockey's HKY-5A role flow on the 077 schema (bind, upload, readiness, finalize, reopen, re-finalize, audit rows) | Pass |

The re-created `bind_event_game_v2`, `get_event_finalization_readiness` and
`finalize_event_game` differ from their 073 bodies only by the added Baseball lines, and each
Baseball wrapper is Hockey's with the sport renamed (checked by `migration077.test.ts`).

### Automated

`src/lib/baseball/migration077.test.ts` (7 cases): staged then validated constraint; Baseball
only, no Football or aggregate functions; shared functions equal their 073 bodies plus the
Baseball branch; terminal predicate; replay order, half-inning parsing, batting side,
placed runner and third-out rule; wrappers equal Hockey's, with grants and private cores;
handshake equal to Hockey's 073 one plus the 071 team settings check and migration 77.
`src/lib/baseball/bsb6aParityCases.test.ts` builds the 24 parity games and checks the client
scores in the table above; the database harness reuses it.

Checks: `pnpm typecheck`, `pnpm lint` (no errors, 3 existing warnings), `pnpm test` and
`pnpm build` pass.

### After applying (owner)

| Step | Expected |
|---|---|
| Apply 076, then 077 | Both apply without errors |
| `select public.get_baseball_release_capabilities();` signed in | `contractVersion` 1, migration 77 |
| `select public.get_hockey_release_capabilities();` signed in | Unchanged: contract 2 |

## BSB-6B1 Client sync and cloud policy

### Automated

- `src/lib/baseball/cloudSync.test.ts` (19 cases): route only for the automatic policy
  (started or not); device games by default; a game with no policy stays on the device and
  is not rewritten; a malformed policy fails closed with "Baseball cloud policy is invalid";
  a local-only game loses its binding metadata; legacy grid games stay off the event route;
  participants link `source_player_id` only for a team game, opponent slots stay in the
  setup snapshot; the adapter binds through `bind_baseball_event_game_v5` with policy
  `advance`; device games and another recorder's events are refused; Enable cloud sync
  offers, explains, uploads with the automatic policy, and stops before uploading on
  inactive access, a viewer role or a missing backend; the handshake accepts only contract
  1 / migration 77, reads contract 0 or a missing RPC as a backend update, caches per
  account; the setup gate never falls back silently.
- `src/lib/baseball/cloudShell.test.ts` (4 cases): the cloud shell rebuilds players, the
  automatic policy and the player map; a mismatched team, a renamed participant or setup
  version 2 is refused; an independent recorder starts with an empty, pregame stream; a
  final game cannot add one.
- Updated source checks: `sportIsolation.test.ts` (event Baseball is event-eligible, local
  only without a policy, `baseball_events` when automatic), `releaseEntryGuards.test.ts`
  (the enable dispatch) and `cloudRecovery.test.ts` (the shared alerts component).

Checks: `pnpm typecheck`, `pnpm lint` (no errors, 3 existing warnings), `pnpm test`
(294 files, 2,762 tests) and `pnpm build` pass.

### Review fix: account changes during sync or a cloud open

The review of `15a892cb` found two account-lifetime gaps that this slice exposed Baseball to:

- The shared transport (`syncEventGameToCloud`) now takes `assertCurrent` and calls it
  before the bind, the nickname writes, conflict records, every event upsert, conflict
  resolution and the checkpoint, and before the result settles. Every sport's wrapper passes
  it (Soccer's now too), so events recorded by one account never upload once another
  account is signed in.
- `src/lib/authIdentity.ts` holds the account the auth client last reported, set
  synchronously in `AuthContext`. `GameContext`'s `isStaleOwner` combines it with the
  provider's account. Sync success and failure, the queue loop, `refreshParkingState`,
  the flush callbacks, Enable cloud sync and reopen handling all stop before reading parked
  games as the old account (`readManifest` clears every parked game on an owner mismatch).
  So do `openGameSnapshot`, `resumeParkedGame` and `prepareActiveGameMutation`, which a page
  may call after an await.
- Cloud Games cancels an open once the page unmounts or the account changes
  (`openIsStale`), before navigating or touching storage.

Tests: `src/lib/baseball/cloudAccountSwitch.test.ts` (5 cases: uploads while the account
holds; no writes when it changes during the remote read; stops after the first event write
without a checkpoint; no settled result when it changes during the checkpoint; no bind when
it already changed). The middle three fail on the previous transport. `GameContext.test.ts`
adds 3 cases: callbacks captured for one account refuse to open, resume, prepare or flush
after another account signs in, and that account's parked game survives; a control showing
that a read as the old account clears it; and a normal open still works.
`releaseEntryGuards.test.ts` checks the new Cloud Games guard.

Checks after the fix: `pnpm typecheck`, `pnpm lint` (no errors, 3 existing warnings),
`pnpm test --maxWorkers=2` (295 files, 2,770 tests) and `pnpm build` pass.

### After applying 076-077 (owner)

| Step | Expected |
|---|---|
| Signed out, New Baseball game | "Saved on this device" note, no Sync choice |
| Signed in, New Baseball game | Sync: Cloud (default) and This device only |
| Before applying 077, choose Cloud | "Baseball cloud games require the latest backend update" with Retry and This device only; Continue disabled |
| After applying, start a team game with Cloud and record a few pitches | Game appears in Cloud Games; Game menu says "Synced to the cloud" |
| Open it from Cloud Games on the same device | Resumes the parked copy |
| A game recorded before this release | Game menu: Enable cloud sync; after confirming, it uploads and appears in Cloud Games |
| A second scorer opens the team game | Offered their own recorder stream; it opens unstarted |
| A viewer opens it | Game Info |
| Start a Cloud Games open, then sign out and into another account before it finishes | Nothing opens; the other account's parked games are untouched |

