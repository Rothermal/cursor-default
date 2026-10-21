# BSB-7B Destinations Regression

Status: **Implemented; frozen local gates and simulated browser batch passed; exact-head CI and independent final review pending**
(2026-10-21). Owning scope: [BSB-7, section 8](PLAN_BSB_7_AGGREGATES_SETTINGS_AND_RELEASE.md).
Base: `1deb29cc44d22b32238a3a625f36e34824302afa` (#499 merged), branch
`codex/bsb-7b-stats-destinations`. No commit, push, PR, merge, live SQL, migration,
release-stage or rollout action was performed by this Developer. The coordinator
owns Git, full repository gates, exact-candidate browser QA and fresh review.

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
  Its Sport selector retains sibling navigation. Removed-junction players can
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
  Post-bind validation preserves the duplicate-binding validator, checks auth epoch,
  verifies team ownership, conditionally updates creator-owned nonfinal games and
  confirms the affected row/readback before uploads/checkpoints acknowledge sync.
  Failures retain the local selection for retry; no SQL was needed.

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

These are coordinator-reported frozen-candidate results. Exact-head CI and the
fresh Reviewer's final whole-source verdict remain pending; neither is inferred
from local gates. No owned test processes remain; only the QA server remains.

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
physical-mobile or installed-PWA verification**. Exact-head CI and independent
final review remain separate. The ignored `qa.local` fixtures/scripts were not
edited by this Developer.

## Pending And Risks

- Exact-head CI and independent final review. Completed frozen local gates and
  simulated-browser results are reported above.
- Actual Supabase JWT/PostgREST/RLS and creator/guardian/team-role matrices;
  two-device link/finalize/reopen/republish and tournament retry behavior.
- Physical phone, installed-PWA/offline and the existing
  [BSB-6 exit matrix](REGRESSION_BSB_6_CLOUD_LIFECYCLE.md).
- Unscoped legacy Career must inspect authorized final games to establish
  provenance; many-game scopes can require many bounded reads. No completed
  authoritative cache, guessed legacy variant or ambiguous Personal credit is added.

BSB-7C settings/setup identity creation and BSB-7D event-only cutover are not part
of this delivery. Baseball remains `opt_in`; full 7A/6 live exit and broader rollout
are not signed off. **Merge readiness remains incomplete pending exact-head CI
and independent final review.**
