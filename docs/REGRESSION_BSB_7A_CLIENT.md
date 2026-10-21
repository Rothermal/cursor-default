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
links, then acknowledges only the confirmed current target for this participant
and still-current persisted intent. Later links for other participants may change
the full map/fingerprint without blocking that target's settlement. Both responses
still require complete exact map parsing. Changing a reviewed request requires a
new operation UUID. No retry mutates its original CAS expectations.

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

This is the original client-half handoff snapshot, before the PR #499 repair below;
its counts are not post-repair candidate gates.

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

## PR #499 Review Repair

Baseline: `3c322aba`; review item `6305746321`. The focused repair removes only the
whole historical-map/fingerprint equality requirement from link acknowledgement.
A matching validated operation receipt, fresh confirmation of this participant's
target, and current account/local-game/participant/revision/operation intent are
still required. Receipt/current-review schema parsing, write CAS, immutable retry
payloads and historical-only lifecycle metadata are unchanged.

The new stateful fake-RPC regression uses the real persisted-intent store: operation
1 links t1 but loses its response, operation 2 links t2 and settles, then operation
1 retries its original UUID/payload and settles despite its historical map lacking
t2's later link. The existing different-current-target case still retains intent.
This is a client/store protocol test, not a new live or SQL integration pass.

Three additional discriminating cases use actual commands and canonical builders:
both team/season setup-versus-cloud mismatches begin otherwise healthy; an original
pitcher replaced before game start has explicit decisions accepted by the older
pregame-inclusive decision history but no actual pitching appearance. The latter
must report review-needed and no awards. Existing production guards are unchanged.
The unused three-reference `incompletePitchers` appearance field is removed;
pitcher coverage still derives from replayed `pitchingLines.untrackedPlateAppearances`.

Observed follow-up commands/results:

```text
pnpm test src/lib/baseball/personalIdentity.test.ts src/lib/baseball/aggregateProjection.test.ts --maxWorkers=2 --silent
```

- Tests added first, before the repair: **1 failed / 67 passed** across 2 files;
  only the lost-reply acknowledgement reproduced the defect.
- After repair: **2 files / 68 tests passed** (25 identity, 43 aggregate).

```text
pnpm test src/lib/baseball/aggregateProjection.test.ts -t "actual pitching appearance|otherwise healthy canonical setup/cloud" --maxWorkers=2 --silent
```

With only the two relevant production guards temporarily disabled, the three new
cases produced **3 expected failures / 40 skipped**, proving the tests discriminate
those guards. Both guards were immediately restored, with no retained production
change to `aggregateProjection.ts`. This deliberately failing probe is not a pass.

```text
pnpm test src/lib/authIdentity.test.ts src/lib/baseball/aggregateProjection.test.ts src/lib/baseball/featureClient.test.ts src/lib/baseball/aggregateTransport.test.ts src/lib/baseball/personalIdentity.test.ts --maxWorkers=2 --silent
```

Final focused follow-up: **5 files / 99 tests passed** (43 aggregate, 25 identity,
15 transport, 14 capability, 2 auth). Original snapshot counts above remain intact.

The coordinator additionally reports the repaired client passing the actual local
PostgreSQL **16.14** probe in `qa.local/bsb7a-client-probe.mjs` with
`BSB7AC_CLIENT=1` and `BSB7AC_LINK_RACE=1`: operation 1 links t3 in SQL, an injected
lost response leaves its intent pending, operation 2 links t4, and the original
operation 1 retry returns its historical map while the fresh current map includes
both links. Acknowledgement is **true**, operation 1's pending intent is removed,
current t3/t4 links remain intact, and lifecycle authority remains **unverified**.
The earlier P1/P2 historical lifecycle probes also passed again: **2 retries /
0 lifecycle mutations**. This is parent-reported direct local PostgreSQL evidence,
not live Supabase/JWT/PostgREST or a migration action. No source or test changed
after the 99-test focused pass; this addition records integration evidence only.

Parent-owned full gates, exact-candidate independent review and PR/CI verification
must be rerun for the repair; none is inferred from the original handoff. No
SQL migration/UI/rollout or live action is included, and full 7A live exit remains pending.

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
