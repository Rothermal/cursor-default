# Regression: BSB-6 Cloud Lifecycle

Record for [BSB-6](PLAN_BSB_6_CLOUD_LIFECYCLE.md). Each slice adds its section when it
lands.

## BSB-6A Server registration and Baseball wrappers

Migrations `076_baseball_event_platform_publication_constraint.sql` (stages the publication
sport check `NOT VALID`) and `077_baseball_event_cloud_lifecycle.sql` (validates and swaps
it, then everything else). The owner reports migrations 076, 077 and 078 applied
successfully after #491/#492 deployed. This records migration execution, not live
runtime signoff. The BSB-6B1 handshake requires contract 2 / migration 78; 076-077
alone do not satisfy it. Local-only games remain available without that capability.

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

### After applying 076-077 (BSB-6A, owner)

This is the original BSB-6A contract. The BSB-6B1 client below requires 078 and contract 2.

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
  2 / migration 78, reads contract 0/1 or a missing RPC as a backend update, caches per
  account; the setup gate never falls back silently.
- `src/lib/baseball/cloudShell.test.ts` (4 cases): the cloud shell rebuilds players, the
  automatic policy and the player map; a mismatched team, a renamed participant or setup
  version 2 is refused; an independent recorder starts with an empty, pregame stream; a
  final game cannot add one.
- Updated source checks: `sportIsolation.test.ts` (event Baseball is event-eligible, local
  only without a policy, `baseball_events` when automatic), `releaseEntryGuards.test.ts`
  (the enable dispatch) and `cloudRecovery.test.ts` (the shared alerts component).

Pre-repair baseline checks: `pnpm typecheck`, `pnpm lint` (no errors, 3 existing warnings), `pnpm test`
(294 files, 2,762 tests) and `pnpm build` pass.

### PR #492 Review Repairs (2026-10-18)

- Added optional account-lifetime checks throughout the shared event transport, including
  binding, nickname writes, remote reads, event/conflict writes and checkpoint settlement.
  Soccer forwards the same optional guard; existing sport wrappers, event policies and
  conflict semantics remain intact.
- Cloud Games invalidates pending opens on unmount, account change or a newer request,
  including the Hockey/Baseball shared path, Soccer/Basketball and legacy fallthrough.
  Sync settlement checks the original account before any owner-scoped storage read;
  stale success/catch/finally, queued records and flush callbacks preserve the new account's
  manifest. The deferred tests reproduced manifest clearing before the repair.
- Deleted-player recovery can use Baseball's immutable source team before first binding,
  without widening owner/admin approval or leaving durable approval enabled.
- Migration `078_baseball_initial_event_revisions.sql` reissues the 055 writer with only
  its absent-row gate changed: actual positive revisions greater than one are accepted
  for a Baseball game with a matching Baseball setup version 1. Edited events, Undo
  tombstones and restored events upload unchanged; no prior snapshots or revision 1 are
  invented. All other authorization, identity, monotonic/idempotent, final-audit and sibling
  rules remain unchanged. Source tests compare the full writer and capability bodies.
- Baseball capability contract 2 / migration 78 gates actual sync before binding as well
  as setup and Enable cloud sync; the account is checked again after the handshake await.
  Migrations 076, 077 and 078 must be applied in order before this client ships.
- Focused repair and sibling compatibility run: **11 files / 120 tests passed** with
  `--maxWorkers=2`. This covers deferred account changes at transport stages, stale cloud
  opens and sync success/rejection, same-account controls, real checked offline revisions,
  old-backend refusal, first-bind recovery, migration scope and existing sport transports.
  Post-repair full-suite/build/typecheck/lint gates remain coordinator-owned and are not
  claimed here.

The coordinator separately reports **28 passing SQL checks** against the complete 078
migration in PostgreSQL 18.6 via PGlite 0.5.10. The fixture has a minimal schema and stubs
for existing permission helpers. Actual revision-2, deleted revision-2 and restored
revision-3 first inserts retain their values; revision advance, idempotence, stale/conflict,
cross-game/recorder identity, anonymous/viewer/final-primary refusal, allowed late audit
and timestamp limits, sibling first-revision refusal, setup mismatch, capability 0/2,
inactive access and authenticated-only grants pass. The writer outside the initial gate
also matches 055 after line-ending normalization. The pre-repair 055 probe reproduced
the initial-revision conflict. This is bounded local SQL execution, not live Supabase,
full RLS integration or concurrent-client verification. PGlite is only in ignored QA
files; no application dependency was added.

The coordinator also reports 16 real-provider Baseball/Hockey renders at 390px/1280px,
Light/Dark and error/local-only states, with recovery export kind and menu status checked,
no overflow and zero page errors. Those used a fake configured loopback backend with
nonfixture HTTP blocked, not live Supabase. The coordinator reports the 16-case final
repeat also passed on `bb94bd33`; the queue-handoff follow-up below was not part of that
browser candidate.

### Direct Account Handoff Follow-Up

The `bb94bd33` review confirmed a separate automatic-sync stall when account A changes
directly to B without remounting `GameProvider`: B's immediate/debounced attempts queue
behind A, but the stale A worker releases its lock without waking B. B's new dirty record
has no retry timestamp, so it otherwise needs another edit or manual retry.

- After clearing the lock, a stale worker now increments the existing retry tick only
  when another run is queued and the current account is still active. B's current effect
  claims the worker; A's guarded refresh and all old-owner storage guards remain unchanged.
- Two deferred callback tests drive the real automatic queue and 150ms debounce effects
  for a same-provider A-to-B replacement. Both A success and rejection left B stalled
  before the repair. Afterward B syncs without a capture or manual flush, preserves its
  local game id, and becomes clean. Storage remains unchanged when A settles, before B's
  own worker runs. Unrelated auth/persistence effects remain excluded from this harness.
- The existing Basketball source-contract test now checks the combined account/request
  lifetime and guarded adoption instead of its obsolete inequality literal. Behavioral
  cloud-open coverage already includes Basketball, Hockey, Baseball and Soccer.
- Migration 078 loses only its extra EOF blank line; SQL behavior is unchanged from the
  coordinator's 28-check probe above.
- Focused follow-up run on 2026-10-18: **4 files / 45 tests passed** across
  `GameContextSyncLifetime.test.ts`, `GameContext.test.ts`, `releaseEntryGuards.test.ts`
  and `Games.test.ts`, using `--maxWorkers=2`. Full gates and independent re-review of
  this follow-up remain pending; no new live Supabase or device signoff is claimed.

### Author 148e27d5 Account Guards (Pre-Merge Evidence)

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

Author-reported checks before integration: `pnpm typecheck`, `pnpm lint` (no errors, 3 existing warnings),
`pnpm test --maxWorkers=2` (295 files, 2,770 tests) and `pnpm build` pass.

### Merge Integration: de4f52d9 With 148e27d5

- Retained the author's synchronous auth identity updates before React state, plus the
  provider open/resume/prepare-mutation and reopen guards. `isCurrentAccount` now combines
  that auth identity with the captured provider lifetime; `isStaleOwner` delegates to it
  while checking the captured owner. Unmount and a rendered A-to-B-to-A transition do not
  revive old work. The queued-B wake-up still runs only after the stale worker releases
  its lock, without old-owner storage access.
- Cloud Games combines the author's mounted/auth checks with per-request cancellation.
  Shared transport checks remain before and after awaits, including nickname writes.
  All author tests are retained; their capability mocks now return contract 2 / migration
  78 for the actual-sync preflight. Migration 078 and first-bind recovery are unchanged.
- Added deferred integration cases for auth switching before React rerenders, provider
  unmount, A-to-B-to-A replacement, and superseded cloud-open requests. The focused merge
  run passed **13 files / 167 tests** with `--maxWorkers=2`, including both authors' tests,
  the queue handoff, migration/recovery checks and all four sport transports.
  `pnpm typecheck` also passed after resolution.
- The coordinator reports the pre-merge `de4f52d9` full suite passed **298 files / 2,798
  tests**. That and the author's baseline above are separate historical results, not a
  post-merge full gate. Full-suite/build/lint and independent re-review remain coordinator
  owned; the bounded SQL/browser evidence above is not new live Supabase signoff.

### After applying 076-078 (owner)

| Step | Expected |
|---|---|
| Signed out, New Baseball game | "Saved on this device" note, no Sync choice |
| Signed in, New Baseball game | Sync: Cloud (default) and This device only |
| Before applying 078, choose Cloud or retry automatic sync | "Baseball cloud games require the latest backend update"; setup offers Retry and This device only, and actual sync makes no bind/upload calls |
| After applying 076-078, start a team game with Cloud and record a few pitches | Contract 2 / migration 78; game appears in Cloud Games; Game menu says "Synced to the cloud" |
| Open it from Cloud Games on the same device | Resumes the parked copy |
| A game recorded before this release | Game menu: Enable cloud sync; after confirming, it uploads and appears in Cloud Games |
| A second scorer opens the team game | Offered their own recorder stream; it opens unstarted |
| A viewer opens it | Game Info |
| Start a Cloud Games open, then sign out and into another account before it finishes | Nothing opens; the other account's parked games are untouched |

## BSB-6B2 Recorder Authority, Finalize and Reopen

Merged in PR #495; no new migration or release-stage change. Uses the existing
fixed Baseball RPCs from 077 and preserves the capability-v2/078 sync prerequisite.
The owner confirmed 076-078 execution, not the live checks below.

### Automated and Browser Evidence

- Recorder parsing/selection, setup-only canonical payloads, exact checkpoints,
  readiness changes, optional decisions, server score readback and reasoned reopen
  have focused tests. Game Info tests cover owner/admin versus scorer/viewer,
  personal creator, legacy isolation, account/unmount cancellation and callbacks.
- Commands reject cloud-final capture, substitutions, lifecycle and decisions;
  Undo/Restore and correction previews/saves also refuse without changing facts.
  Rendering tests preserve local-only edits and remove cloud-final capture/restore/
  decision controls. A TypeScript test compatibility issue (`Array.at` against the
  existing ES2020 target) was corrected without changing the target or assertions.
- Real parking callbacks persist one matching primary-owned reopen, dirty retry
  state and idempotency. Status-only refreshes leave ended events unchanged and
  do not clear unrelated sync errors. Foreign recorder histories cannot receive
  an appended reopen under this account.
- Disposable Chromium at 390x900 and 1280x900: manager, viewer, and final-viewer in
  Light/Dark, **12 renders / 4 simulated finalize-and-reopen flows passed**. Checked
  decision warning, viewer control absence, publication invalidation, palette token
  application, the reasoned reopen dialog, no horizontal overflow and no page errors.
  An incorrect stylesheet path in the first preview fixture was fixed; only the
  rerun with explicit computed-palette assertions counts as themed evidence.
- These are simulated responses, not live auth/RLS, PostgREST, multi-device,
  physical-mobile, installed-PWA or full-game signoff.
- Original implementation's local gates (before the repair below): **306 files / 2,881 tests passed** with
  `pnpm test --maxWorkers=2`; production build/typecheck passed (14 PWA precache
  entries). ESLint had 0 errors and the same 3 existing Fast Refresh warnings,
  excluding ignored `qa.local` and `.claude` fixtures. Review-control tests:
  **22 passed**. Whitespace checks were clean. CI is reported in the PR separately.

### PR #495 Repair Evidence

The three blockers reported on head `49ee32c97ef88efcc01d25fb49cf7e1008fd863c`
are repaired in the working tree: remote-reopen status refresh, parked-binding
finalization, and same-device reopen of a clean final retained only in memory.
No migration, event/setup schema, release gate or remote Summary scope changed.

- Before implementation, `pnpm test src/context/GameContext.test.ts
  src/pages/GameInfo.test.ts --maxWorkers=2` produced **3 failures / 20 passes**.
  The clean-final/current-state reproduction remained final with no stored record;
  the parked-finalization callback was not invoked, and the new provider transition
  was absent. The coordinator separately reproduced the clean-final failure with
  real React effects and localStorage in disposable Chromium.
- Provider regressions exercise active and parked status-only refresh, unchanged
  history/fingerprints/recovery/errors, exact retry retention through final ->
  read/save/reload -> reopen, queue exclusion while final, and A-final/B-active
  isolation. Auth-before-render, provider/page cancellation, superseded reads,
  replaced/deleted bindings and newer lifecycle generations reject late results.
  Both stale sync success and failure leave newer Baseball finalization intact.
- Same-primary handoff tests cover clean-final persistence actually deleting the
  active slot, rollback-safe replacement, cap/storage failure without eviction,
  one owned non-backdated append, advancing sync revision, repeated delivery and
  redelivery after a later end/finalization. Other-manager/status-only paths leave
  history unchanged; explicit cloud-bound local Reopen rejects a foreign recorder.
- Cloud Games tests cover both active and parked refresh before navigation and
  caller lifetime guards. Tracker tests execute mount/focus/online refresh and
  cleanup. The status-only SDK helper rejects missing, foreign-sport, wrong-id,
  unsupported-status and inaccessible rows without loading any recorder history.
- Final focused command passed **40 files / 569 tests**:

  ```text
  pnpm test src/lib/baseball src/context/GameContext.test.ts src/context/GameContextSyncLifetime.test.ts src/lib/gameParking.test.ts src/lib/cloudSyncState.test.ts src/pages/Games.test.ts src/pages/GameInfo.test.ts src/pages/BaseballCloudLifecycle.test.ts src/lib/hockey/finalization.test.ts src/lib/hockey/cloudSync.test.ts src/lib/basketball/cloudSync.test.ts src/lib/soccer/cloudSync.test.ts --maxWorkers=2 --silent
  ```

  `pnpm typecheck` passed, and `git diff --check` was clean. Full-suite/build/lint,
  exact-final-tree browser rerun and independent rereview remain coordinator-owned.
- The coordinator reported provisional working-tree Chromium evidence: **9 real
  provider/storage cases**, plus **12 responsive/theme renders / 4 simulated
  finalize-and-reopen flows**, passed. These use synthetic auth and simulated cloud
  responses with non-localhost HTTP blocked. They are not live Supabase/RLS,
  two-device, physical-mobile, installed-PWA or release-matrix signoff.

### Owner Post-Deployment Checks (Pending)

| Check | Expected | Status |
| --- | --- | --- |
| Owner/admin and scorer/viewer inspect the same event game | Managers see primary selection/finalization/history; others have compact read-only presence | Pending |
| Finish and sync the primary recording, then finalize | Exact checkpoint, optional decisions warning, server-published runs and canonical lock | Pending |
| Suspend a recording; separately introduce a primary conflict | Suspension/conflict blocks publication; another recorder's audit-only warning does not replace primary authority | Pending |
| Resume a cloud-final active/parked recording | Capture, lineup writes, decisions, Undo/Restore and corrections remain read-only | Pending |
| Primary owner reopens on the same device | One reasoned reopen event, no backdating or duplicate append; corrections sync and may be republished | Pending |
| A different manager/device reopens | Recorder sees an open binding with its ended stream intact, explicitly reopens locally; the old decisions epoch no longer applies | Pending |
| Legacy Baseball and sibling sports | Existing aggregate reads/tracking and other sports' cloud paths unchanged | Pending |

That slice did not add remote Summary. BSB-6C below adds it without claiming the
full BSB-6 exit or broader Baseball release.

## BSB-6C Cloud Summary (Implemented for Review)

### Automated Scope

- Local active/resumed snapshots, isolated effective primary and active canonical
  authorities; cached projection/state tampering; compact viewer reads without
  manager/checkpoint requirements; missing, invalid and quarantined sources.
- Canonical game/envelope/primary/owner/terminal and immutable setup mismatches,
  including participant, team and season identity; no final-primary fallback.
- Primary/status/publication changes during reads, one bounded retry and ongoing
  churn refusal. Account/request/unmount guards stop stale continuations.
- All five remote tabs and read-only decisions; source-derived pitch/play/player
  details, safe unhealthy headers with no totals/details, query-preserving tabs
  and legacy Baseball's requested-Game-Info redirect with an unrelated game active.
- Immediate source hiding on route/account/loading changes, A -> B -> A, refresh
  failure and unmount; stale all-empty local decisions reject changed slot/game/
  account/epoch. Current local saves preserve original capture preferences.
- Remote review uses a localStorage read/write trap and a GameContext dispatch
  spy; the unrelated local snapshot remains unchanged. Existing legacy and sibling
  Summary/routing tests are included in the focused run.

Observed final developer-focused run: **40 files / 499 tests passed**:

```text
pnpm test src/lib/baseball src/pages/BaseballSummary.test.ts src/pages/BaseballSummaryViews.test.ts src/pages/BaseballCloudSummaryRoute.test.ts src/pages/BaseballCloudLifecycle.test.ts src/pages/GameInfo.test.ts src/pages/Games.test.ts src/lib/hockey/summary.test.ts src/lib/basketball/summary.test.ts src/lib/soccer/summary.test.ts --maxWorkers=2 --silent
```

`pnpm typecheck` passed; `git diff --check` was clean. Node initially failed
workspace path resolution inside the filesystem sandbox (`EPERM`); the approved
focused commands ran outside that sandbox. Earlier fixture/assertion failures
were corrected before this run; they do not count as passing evidence. Full
suite/build/lint, exact-final-tree browser rerun and independent review remain
coordinator-owned and are not claimed here.

### Coordinator-Reported Working-Tree Browser Evidence

The coordinator reports **40 renders** (five tabs x primary/canonical x phone/
desktop x Light/Dark), **2 fail-closed publication cases**, **3 stale-lifetime
probes**, and **2 route cases** passing on the working tree. The fixture mounts
the real Summary, real read adapters and cloud-route wrapper with synthetic auth
and simulated SDK responses. It checks source-only names/totals, chart markers,
no decision/correction controls, unchanged local state/storage, zero context
writes, query retention, no page errors/unknown requests or horizontal overflow.
Fixture player-map and heading-locator errors were corrected before those passes.
These are provisional working-tree results, not exact-final-head or live backend
evidence. The coordinator owns the final-tree rerun and independent review.

### Pending Exit Checks

BSB-7 is the next implementation phase; Baseball remains `opt_in`. No new
migration, aggregate destination or settings work is included here. The BSB-6
owner live matrix remains mandatory: actual Supabase auth/RLS and read wrappers,
two recorders/devices, finalize/reopen/re-finalize/canonical review, physical
mobile and installed-PWA behavior. Local tests and simulated browser responses do
not sign off those checks.
