# TUI-2 Hockey Legacy Cutover

Date: 2026-10-25. Status: **implemented for review; deployed checks pending**.
Governing plan: [Shared tracker UI](PLAN_TRACKER_UI_UNIFICATION.md), sections 5-8.
Layout alignment merged in #507. This completes the remaining TUI-2 implementation
boundary, not a new sport release or live-device signoff. Single-agent work and
self-review; no independent agent review is claimed.

## Delivered Boundaries

| Surface | Behavior |
| --- | --- |
| Legacy local active, parked and imported Hockey | Read-only generic Summary; saved stats, notes, ids, ownership and sync debt remain intact |
| Direct setup/players/checkout/game continuation | Legacy goes to Summary; event authority goes to the event tracker, including damaged markers that must fail closed |
| New setup | Personal/team/direct entry always reaches Hockey event setup, even during creation rollback; old preview preference and events parameters cannot restore the grid |
| Start | One complete event-game commit atomically parks the previous game and installs the new one; no intermediate raw Hockey slot or destructive reset |
| Shared Summary | Retired games have no stat corrections, primary-recorder changes, Back to Game or raw finalization; export, error/status and explicit nonfinal sync retry remain available |
| Hockey aggregate eligibility | Old Hockey stat-grid totals remain separate from event-based season/career totals, as approved in HKY-6; no legacy aggregate RPC or sport backfill added |
| Cloud open | Existing authority probe runs first; compatible active/parked local history wins over an older cloud snapshot; duplicates or incompatible event/sibling bindings refuse |
| Old cloud rows | Game Info resolves a null sport_id from the team's season, then inspects Hockey authority; no database row is rewritten |
| Cloud metadata | Both entering and submitting opponent rename refuse legacy Hockey after a current fixed authority read |
| Corrupt event history | Hydration preserves any non-null authority/setup/stream marker, including falsey malformed values; tracker/Summary cannot restore aggregate capture or sync |
| Existing Hockey events | Clockless/anchored histories, tracker, Timeline, Summary, cloud lifecycle and checked commands remain supported independently of creation rollback |
| Sibling sports | Basketball/Baseball retirement and old-data transport remain; Soccer events and Football's current generic tracker/finalization remain unchanged |

No migration, server write restriction, event synthesis, conversion, cleanup,
automatic finalization, access widening or new Hockey aggregate source. Transporting
saved facts is still permitted through existing authorization, stale-result and
final-cloud guards. Viewing a Summary or retrying never acknowledges a failed upload
or discards the local copy. Warned local deletion remains separate data management.

## Verification

Observed final local evidence (CI is recorded on the PR):

- Full suite: **338 files / 3,460 tests passed**. Focused final authority/old-row
  compatibility run: **4 files / 78 tests passed**; the new Hockey cutover file
  contributes **19 tests**. Earlier failures identified stale source-policy assertions
  and the old damaged-setup Summary expectation; explicit true-legacy and malformed
  event cases now pin the separate paths.
- Configured TypeScript/Vite/PWA build passed using placeholder public configuration:
  **2,424 modules / 15 precache entries**. App chunk **3,029,635 bytes**, leaving
  **116,093 bytes** below the unchanged 3 MiB hard limit. Existing code-splitting/
  bundle-headroom operational follow-up remains; the cap was not raised.
- Source lint excluding ignored QA copies: **0 errors / 3 existing Fast Refresh
  warnings**. Review controls: **22 passed**. **146 relative documentation targets**
  and whitespace checks passed.
- Synthetic Chromium: **8 narrow/desktop Light/Dark views / 17 interaction cases
  passed**. Screenshots inspected; no page errors or horizontal overflow. Cases cover
  retired routes, all four roles, corrupt tracker/Summary recovery, rollback, retained
  event access, removed preview UI, local-first Game Info, refused rename, new-game
  atomic commit preserving the prior game, and failed/successful Summary retry without
  changing saved facts. Initial fixture navigation timeout and accessible-name/
  recovery-message selectors were corrected before the passing run.

Committed and browser coverage includes:

- Retired reducer mutations and raw creation refusal across all four cloud statuses.
- Dirty fingerprint, source stats/notes, binding and export/import preservation.
- Duplicate/incompatible binding refusal; malformed authority/setup/stream quarantine.
- Real Game Info/Cloud Games handlers preferring dirty active/parked history, including
  pre-sport-id Hockey rows; unknown authority refuses rather than replacing data.
- Raw finalization refusal for every role, stale callbacks and in-flight flushes;
  Football's otherwise-authorized finalization remains available.
- Atomic new-game commit, clockless/anchored event access, creation rollback and
  retired metadata guards, with actual-browser Summary recovery checks.

Browser fixtures mount the real App routes and components with synthetic auth/cloud
and a GameContext adapter using real reducers and parking transactions. They do not
exercise live Supabase/RLS, real network reconnects, physical-mobile, installed PWA
or full-match behavior. No owner browser/game was loaded, changed or uploaded.

## PR Comment Follow-Up

The [review at e00011b](https://github.com/Rothermal/cursor-default/pull/508#issuecomment-6401811364)
identified a valid permission regression: extending legacy review to Hockey also
made its event-game open action visible to viewers, and the event branch could
create/adopt a recorder stream. Non-tracking users now go directly to read-only
Hockey Summary before any recorder loading/creation or local adoption. The action
label reflects review, not tracking. The adjacent, pre-existing Baseball gap is
closed in the same narrow branch; owners/admins/scorers retain recorder access.

- Four new viewer/unrecognized-role cases reproduced tracker navigation before
  the fix. They now assert Summary routing and no recorder load, creation, prepare,
  resume, dispatch or adoption; six authorized-role cases preserve recorder access.
- Added the missing `startNewGame(hockey)` refusal test and **16 real React Summary
  rendering cases** for bound/nonfinal retry visibility, final/unbound suppression,
  sibling sports and unchanged saved facts. Temporarily removing the start guard
  failed its new test; hiding Retry Sync failed **9** cases. Both mutation probes
  were restored before the passing full run.
- Removed dead route flags, the Hockey preview helper/ignored arguments and unused
  SettingsContext accessors. Stored true/false preview values still round-trip;
  rink orientation, real rules, discovery and creation rollback remain unchanged.
  Route coverage no longer duplicates obsolete preview-flag combinations.
- Final follow-up local suite: **339 files / 3,486 tests passed**. Focused access/
  recovery run: **3 files / 80 tests passed**; cleanup/storage run: **4 files /
  49 tests passed**. Source lint: **0 errors / 3 existing Fast Refresh warnings**;
  review controls: **22 passed**. Configured production/PWA build passed with
  **3,029,497-byte** app chunk and **116,231 bytes** below the unchanged limit.
- Synthetic Chromium rerun: **8 views / 19 interaction cases passed**, including
  viewer Game Info -> Summary for Hockey and Baseball without a prompt, commit or
  state change. Screenshots inspected. These additional role fixtures intentionally
  do not implement cloud recorder/publication readiness; they prove navigation and
  non-adoption, not healthy live remote Summary reads or RLS. Original service/device
  limitations remain, and no pending deployed check is marked passed.

The initial ready verdict is superseded by the follow-up head and CI evidence on
the PR. This remains single-agent implementation/self-review, not independent review.

## Rollback and Pending Deployment

Set `SPORT_EVENT_RELEASE_STAGES.hockey` to `internal` in a reviewed build to stop
new Hockey creation, including development/local-only games. No preview toggle or
legacy fallback returns. Existing event games, old summaries, exports and safe old
transport remain reachable. Presentation rollback is separate from authority.

Cached browsers/PWAs retain old behavior until refreshed; this frontend retirement
does not revoke old clients' server access. Refresh through the existing guarded
update flow without a storage wipe. Preserve all pending broader-rollout checks in
[HKY-6](PLAN_HKY_6_SUMMARY_AGGREGATES_AND_RELEASE.md); no unexecuted row is passed.

| Owner post-deployment check | Status |
| --- | --- |
| Refreshed browser/PWA with retained active/parked records | Pending |
| New local/team Hockey setup, paused opening clock, capture and Summary | Pending |
| Old unfinished/final/local/cloud Summary, export and safe retry/failure recovery | Pending |
| Actual Supabase authorization, cloud sync and two-device authority | Pending |
| Physical-mobile, installed-PWA and full-game validation | Pending |

Next shared-layout package is Football TUI-3 after its FBE event foundations and
phase Q&A. TUI-2 does not authorize disabling Football's only current tracker.
