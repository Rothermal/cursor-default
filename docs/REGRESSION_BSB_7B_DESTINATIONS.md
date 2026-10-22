# BSB-7B Destinations Regression

Status: **Implemented; original exact-head CI and independent final review passed; subsequent review fixes verified separately below**
(2026-10-21). Owning scope: [BSB-7, section 8](PLAN_BSB_7_AGGREGATES_SETTINGS_AND_RELEASE.md).
Base: `1deb29cc44d22b32238a3a625f36e34824302afa` (#499 merged), branch
`codex/bsb-7b-stats-destinations`, [PR #500](https://github.com/Rothermal/cursor-default/pull/500).
The original Developer did not commit, push, open the PR, merge, run live SQL or
change rollout; the coordinator subsequently committed and opened the PR. The
owner disabled multi-agent work before the review follow-up below, which uses
single-agent implementation and self-review. No migration or rollout change is added.

## Implemented Boundary

- Leaderboard, Team Stats, Tournament Stats, Player Profile and Career enter the
  Baseball metadata boundary before generic legacy effects mount. Sibling page
  implementations remain the fallback. Metadata, roster and totals are guarded by
  auth epoch and request identity; old results disappear before effects settle.
  Every new request lifetime/explicit refresh gets a unique transport generation,
  so a retained subscriber cannot revive a pre-refresh or A-to-B-to-A request.
- Event Totals and Legacy Totals are explicit independent sources, never blended
  or selected by an empty/error fallback. Events separate Baseball, fastpitch and
  slowpitch; legacy labels its variant as not recorded. Batting opens on hits;
  Baserunning, Pitching and Fielding expose their counters. Nullable rates sort
  behind valid zeroes, retain samples and show all frozen 1..15 pitching bases.
  IP pools integer outs, percentages display percentages, and pitch/unlinked/
  decision coverage is distinct from malformed-source quality.
- Active-roster zero rows and frozen historical contributors remain visible.
  Profile separates its team-season and Personal load; Personal is filtered by
  actual cloud scope. Career pools one variant and exposes team-season/Personal
  segments with readable authorized season labels or unavailable/date fallbacks.
  Its Sport selector retains sibling navigation from current teams plus paged
  resolved legacy sport names, without using legacy counters as event totals.
  Missing legacy-navigation support warns without blocking Baseball totals.
  Removed-junction players can
  recover identity from an authorized canonical source instead of requiring a
  currently readable `players` row or fabricating a name.
- Legacy loading pages authorized final games and setup absence checks, excludes
  every event setup regardless of sport, rejects conflicting explicit/team sport,
  and drains `get_game_stats_resolved` per game. Only the old config's counters
  contribute; malformed/duplicate/noninteger rows isolate their game. Known
  team/opponent placeholders and unreadable/placeholder player identities never
  become player totals. Null-sport Personal records have no inferred provenance;
  player views require an actual resolved player association before listing those
  review/export-only games. No legacy counter enters the event rate engine.
- Remote event history links to Baseball canonical Summary; legacy links to
  Game Info. Aggregate inspection performs no GameContext or local-game writes.
- Creator-only personal Game Info links use the paged creator/guardian pool,
  durable immutable reviewed intents and a stable `cloud:<gameId>` review key.
  Close/Escape/unmount/account/query changes invalidate callbacks. Retry retains
  the original operation and payload. A historical reopen receipt is not a local
  lifecycle command: settlement refreshes current status only. The recorder must
  explicitly Reopen/end/sync and republish. Reviewed personal finalization uses
  `finalizeReviewed` with the pinned map; unavailable new support never falls back
  to the old finalizer. Team and ordinary contract-2/078 behavior are preserved.
- Setup explicitly selects an authorized team tournament. Additive `gameInfo`
  metadata survives save/reload/cloud shell loading without rewriting setup/events.
  Duplicate-binding validation remains before event upload. Optional attachment
  runs after event upload/checkpoint, checks auth epoch, verifies team ownership,
  conditionally updates creator-owned nonfinal games and confirms the affected
  row/readback. Failures retain the selection for retry and show a fingerprint-inert
  warning, without blocking later event sync. A deleted tournament or differing
  cloud attachment cannot strand recorded plays or overwrite cloud metadata.
  No SQL was needed.

## Developer-Observed Checks

```text
pnpm test src/lib/baseball src/hooks/useBaseballAggregateDestination.test.ts src/components/baseball/BaseballPersonalLinks.test.ts src/pages/GameInfo.test.ts src/lib/hockey/aggregateDestinationRoutes.test.ts src/lib/basketball/aggregateDestinationRoutes.test.ts src/lib/soccer/aggregateDestinationRoutes.test.ts --maxWorkers=2 --silent
```

**45 files / 624 tests passed.** This includes new metric/basis/provenance/paging,
hook and metadata lifetime, multi-sport Career navigation, tournament persistence/
refusal/retry, durable dialog intent/cancellation, real reviewed finalization and
concurrent refresh tests, plus existing Baseball and sibling route compatibility.
The existing personal identity tests retain P1/P2 historical receipt replay and
map-CAS refusal coverage. Fake SDK/RPC responses are not live RLS evidence.

`pnpm typecheck` passed before the final legacy access-error guard. Focused ESLint on the new/bounded aggregate UI, hook,
personal-link, finalization-panel, legacy/tournament and related tests passed with
**0 errors / 0 warnings**, also before that final guard. `git diff --check` passed (line-ending notices only).
Initial sandbox Node resolution failed before execution; observed checks used the
approved normal-filesystem runner. Earlier harness timing/missing-fixture-id and
lint failures were repaired before these passes. The dialog close regression also
led to an immediate aborted-operation callback guard; it passed on rerun.

The 624-test run covers the frozen implementation, including access/session
refusals failing the legacy load instead of masquerading as partial quality.
Subsequent edits are documentation only; **110 changed-document local links
resolve**. No later standalone TypeScript process was started alongside the
coordinator's production build/lint. Their completed frozen-candidate results are
recorded separately below, not inferred from focused tests.

### Coordinator-Reported Candidate Gates

After implementation freeze, the coordinator reports these completed results:

- Full suite: **323 files / 3,163 tests passed**, final exit 0, **124.39 seconds**.
- Production build: **passed, final exit 0**, including TypeScript and PWA
  generation; **2,412 modules / 14 precache entries**.
- Repository lint: **0 errors / 3 unchanged Fast Refresh warnings**.
- Review-control tests: **22 passed**.
- Changed-document local links: **110 resolve**; whitespace check: **passed**.

These are coordinator-reported frozen-candidate results, not inferred live results.
Original head `2e1ef27e35d73e99962bb586194fbb0fc2298273` subsequently passed
[exact-head CI](https://github.com/Rothermal/cursor-default/actions/runs/39560252264)
and [fresh independent final review](https://github.com/Rothermal/cursor-default/pull/500#issuecomment-6310332011).
Those passes do not substitute for checking later fixes; see the follow-up below
and PR #500 for the newest head's CI status.

## Coordinator-Reported Frozen Browser Evidence

The coordinator reports the complete frozen browser batch **passed, exit 0**
(session `81370`), using real components and Supabase SDK with synthetic backend
responses/auth: **20 views** (five pages x phone/desktop x Light/Dark),
**180** source/variant/category transitions, keyboard focus checks, no horizontal
overflow, no unexpected RPC/page errors, and no GameContext/local-game storage
writes. Separately reported: **8** held-read metadata/refresh/source/variant races,
**3** empty/invalid/missing-capability states, **4** personal-link viewport/theme
views, **2** removed-junction historical views, and **2** uncertain-link retry
cases (lost response and Escape during held write, exact operation/body retained).
The same batch includes **2** multi-sport Career cases passing:
explicit Baseball and no-sport default both retain navigation to Hockey's URL.

The coordinator visually reviewed the final screenshots and reports no overflow
or overlap. This is frozen-candidate simulated-browser evidence, **not live RLS,
physical-mobile or installed-PWA verification**. Original exact-head CI and
independent final review are separately linked above. The ignored `qa.local`
fixtures/scripts were not edited by the original Developer.

## PR Review Follow-Up (2026-10-21)

All three findings in the [subsequent review](https://github.com/Rothermal/cursor-default/pull/500#issuecomment-6321342095)
were validated against the current source and governing plan, then addressed:

1. Tournament association no longer gates event upload/checkpoint. A deleted
   tournament, different cloud attachment, rejected write or failed readback produces
   a separate warning. Local selection survives retry, successful retry clears the
   warning, and auth/lifecycle/duplicate-binding failures still stop stale work.
2. Career combines current-team sports with paged authorized legacy sport names.
   Discovery is navigation-only, account/query/unmount guarded, and optional;
   failure warns while Baseball aggregates remain available.
3. The plan/index/evidence now distinguish the original completed CI/review from
   this follow-up, rather than continuing to label that original review pending.

Observed follow-up verification:

- Full suite: **323 files / 3,179 tests passed**.
- Expanded Baseball/shared sync/sibling-route suite: **49 files / 691 tests passed**.
- Production build including TypeScript, Vite and PWA: **passed**.
- `pnpm lint`: **0 errors / 17 warnings** including ignored local QA copies.
  `pnpm exec eslint . --ignore-pattern qa.local`: **0 errors / 3 existing warnings**.
- Synthetic browser: **8** legacy-only Hockey navigation cases (explicit/default
  Baseball x 390/1280 width x Light/Dark) and **1** failed-discovery case passed.
  Actual components and SDK were exercised; the warning screenshot was visually
  checked without overlap or horizontal overflow. These are not live RLS/device checks.
- No independent subagent review is claimed for these changes. Current-head CI
  and the final merge verdict are reported on PR #500.

The first focused run exposed a reused deferred test response, and TypeScript
caught a missing envelope narrowing in a new test; both test-harness mistakes were
corrected before the passing checks above. An initial sandbox Node launch failed
before executing tests; successful checks used the approved runner.

## Pending And Risks

- Actual Supabase JWT/PostgREST/RLS and creator/guardian/team-role matrices;
  two-device link/finalize/reopen/republish and tournament retry behavior.
- Physical phone, installed-PWA/offline and the existing
  [BSB-6 exit matrix](REGRESSION_BSB_6_CLOUD_LIFECYCLE.md).
- Unscoped legacy Career must inspect authorized final games to establish
  provenance; many-game scopes can require many bounded reads. No completed
  authoritative cache, guessed legacy variant or ambiguous Personal credit is added.

BSB-7C settings/setup identity creation and BSB-7D event-only cutover are not part
of this delivery. Baseball remains `opt_in`; full 7A/6 live exit and broader rollout
are not signed off. The original review/CI passes are historical evidence; use the
latest PR #500 head and reported checks for its current merge verdict.
