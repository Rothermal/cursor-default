# BSB-7A Client Foundation Regression

Status: **Client half implemented and locally tested; full 7A exit not claimed**
(2026-10-20). Governing contract: [BSB-7 Q1-Q23 and sections 3-5/7/7A](PLAN_BSB_7_AGGREGATES_SETTINGS_AND_RELEASE.md).
The [server record](REGRESSION_BSB_7A_SERVER.md) owns migration 079 SQL/role/concurrency evidence.

## Delivered Boundary

- `aggregateTypes.ts`, `aggregateStats.ts` and `aggregateProjection.ts` derive
  official eligible canonical contributions through the existing schema-1 parser
  and fresh Summary replay. The complete `stats.ts` counter catalog is reused by
  participant id before confirmed source mapping, not by local/cloud UUID inference.
- GP/roles/starts begin at the successful game start; pregame replacement, unused
  bench, scoreless courtesy runners, DH pitchers, zero-pitch relievers and re-entry
  retain distinct appearance semantics. Merge-converged counters sum, per-game
  appearance flags OR, and ordinary player runs never absorb score adjustments.
- Variants remain separate. Raw counts pool; scheduled-inning bases 1-15 retain
  independent ER/K/outs buckets, IP formats summed integer outs, zero denominators
  stay null, and IBB is not added twice. Team context uses score plus line-score H/E/LOB.
- Pitch count/pitches-seen lower bounds affect only nonexempt Quick PA contributors.
  Pitch ratios use recorded observations from complete pitcher-games, not estimated
  pitch counts. Any incomplete converged pitching contribution excludes that whole
  player-game ratio. Replay marks the actual initial pitch before applying it, so
  mid-PA changes and frozen 1-1 starts use known first-pitch denominators, not BF.
- Decisions use only the current newest ending epoch, explicit awards, actual
  pitching appearances and existing read-time validity checks. Absent, reviewed
  empty and review-needed remain separate; suggestions never become awards.
- `aggregateTransport.ts` drains exact 079 keysets, including pages in other
  variants. Complete personal maps retain explicit canonical-participant nulls and
  raw pin fingerprints; merge-resolved map UUIDs are not rehashed as the raw pin.
  Team aliases remain supported. Malformed/invalid sources isolate the whole game;
  equivalent duplicates count once and publication/game collisions quarantine all
  conflicting contributions in either arrival order. Progress/metrics and partial
  quality remain explicit. Tournament scopes require their authorized owning team;
  an exported association check rejects personal/cross-team attachments. Actual
  tournament setup/save/reload wiring belongs to 7B.
- The additive strict auth snapshot/epoch API preserves existing permissive
  `isCurrentAuthUser` callers. New requests check account epoch before/after awaits
  and delivery, including A -> B -> A. Shared loads use client/account/epoch/scope/
  variant/refresh keys, their own controller and unique subscriber records. One
  subscriber abort or callback exception cannot cancel another; no completed
  authoritative cache is retained. Remote reads write neither GameContext nor storage.
- `featureClient.ts` independently checks exact aggregate/link capabilities without
  changing the release contract 2/078 or caching completed-ready responses.
  `personalIdentity.ts` exposes checked online review/link/reviewed-finalize only.
  `personalLinkIntents.ts` persists explicit account/local-game/participant intent,
  revision, operation UUID and immutable reviewed retry payload. Missing capability,
  network/uncertain write, supersession or storage failure never acknowledges it as
  saved. No general offline identity queue or event-sync acknowledgement is introduced.

## Historical Receipt Boundary

The link command validates operation/game/participant/target, rereads current server
links, then acknowledges only a matching map and still-current persisted intent.
Changing a reviewed request requires a new operation UUID. No retry mutates its
original CAS expectations.

Receipts expose `historicalReopen` and `lifecycleAuthority: 'unverified'`, never an
executable `BaseballReopenHandoff`. A P1 receipt replay after P2 republication, or
after P2 itself reopens with an identical map and no active publication, cannot
authorize another local reopen. The regression uses a distinct P2 id for that case.
BSB-7B owns verification of current publication history before any matching owned
local lifecycle handoff. These clients never append events, reopen local state,
republish automatically, clear unrelated intents or rewrite frozen setup.

## Observed Developer Checks

```text
pnpm test src/lib/authIdentity.test.ts src/lib/baseball/aggregateProjection.test.ts src/lib/baseball/featureClient.test.ts src/lib/baseball/aggregateTransport.test.ts src/lib/baseball/personalIdentity.test.ts --maxWorkers=2 --silent
```

Passed **5 files / 95 tests**: 40 aggregate replay/calculation, 15 transport/lifetime,
14 feature capability, 24 identity/intent/finalization and 2 auth epoch tests.
The initial 38-test run had four fixture failures (sport setup, missing Undo time,
profile ids and intentional-walk movement proposal); those were corrected before
passing runs. They are not passing evidence. `pnpm typecheck` passed with exit 0.
The initial sandbox invocation failed during Node filesystem resolution, before
TypeScript ran; the normal-filesystem rerun is the observed check.

```text
pnpm test src/lib/baseball src/lib/authIdentity.test.ts --maxWorkers=2 --silent
git diff --check
```

The broader compatibility run passed **37 files / 517 tests**, including existing
tracker, substitutions, corrections, Summary, cloud/account, release-policy and
migration source-contract tests. `git diff --check` passed (line-ending notices
only). The earlier TypeScript pass precedes the final four replay-test additions;
the parent owns final-tree repository gates. These checks do not establish live
Supabase, mobile or PWA behavior.

## Parent-Reported Local PostgreSQL Probes

The coordinator reports the real new client APIs running through a named-RPC
adapter against disposable **PostgreSQL 16.14**, actual migrations 001-079, and real
canonical builders. The ignored probe is `qa.local/bsb7a-client-probe.mjs` with
`BSB7AC_CLIENT=1`; response evidence is `qa.local/bsb7a-client-responses.json`.
These files were not edited or replaced by this client implementation.

Reported observations: **3 paged games / GP 3 / 63 outs**, team totals and active
zero rows, invalid-identity isolation, creator review then actual atomic final-P1
link/reopen with intent acknowledgement, reviewed checkpoint finalization to P2,
and **2 historical P1 receipt replays / 0 lifecycle mutations from replay** (P2
active, then P2 reopened). This is direct local PostgreSQL, not PostgREST/JWT or
live Supabase; the probes do not establish the full role/release matrix.

## Final Parent-Observed Local Gates

The coordinator reports the following final working-tree results on 2026-10-20:

- Full suite: **318 files / 3,087 tests passed**.
- Production build, including PWA generation: **passed, final exit 0**.
- Standalone `pnpm typecheck`: **passed**.
- Lint: **0 errors / 3 unchanged Fast Refresh warnings**.
- Review-control tests: **22 passed**.
- Changed-document local links: **118 resolve**.
- `git diff --check`: **passed**.

The coordinator reports no required parent execution sessions still running.
Fresh-context source implementation review reported no consequential findings;
final exact-candidate independent verification, PR references and exact-head CI
remain pending. No source or test changes were made after these gates; the final
developer edit records this evidence only. These local passes do not complete the
live 7A exit or broaden release approval.

## Deployment Report And Pending Checks

**OWNER-REPORTED:** migration 079 applied on **2026-10-20**. No migration was added,
edited or applied by this client work. Owner-reported application is separate from
independently observed live checks.

The parent-observed local gates above remain separate from final exact-candidate
independent review, Git/PR/CI handling and full 7A exit. No destination/link UI, personal
settings/setup wiring, general offline queue, legacy cutover or rollout change is
included. Baseball remains `opt_in`; existing tracker/cloud-sync and old 078 cloud
contract behavior are not gated by these unwired clients.

Actual Supabase JWT/PostgREST/RLS, two-device link/finalize/reopen/republish, physical
mobile, installed PWA and the [BSB-6 live exit matrix](REGRESSION_BSB_6_CLOUD_LIFECYCLE.md)
remain pending. Broader release is not signed off by local units or these probes.
