# TUI-1 Basketball Event-Only Cutover

Date: 2026-10-24. Status: **implementation merged in #506; deployed checks pending**.
Governing plan: [Shared tracker UI](PLAN_TRACKER_UI_UNIFICATION.md), especially
sections 5-8. Layout merged in #491. This second PR changes creation/legacy policy,
not clock semantics, event schemas, Supabase contracts, migrations or app/team access.
Single-agent implementation/self-review; no independent agent review claimed.

## Delivered Boundaries

| Surface | Behavior |
| --- | --- |
| Dashboard, Team Info, explicit/team-only setup | Basketball event setup; old preview true/false and `events` parameters cannot select the old tracker |
| Settings and setup | No tracker-version tab, toggle or Legacy fallback. Rules, capture, display, clock alerts, sport discovery and explicit cloud/local-only choices remain |
| Old setup draft | Still parseable and preserved on load; cannot build/commit a legacy game. Explicit Start new event setup discards that draft's authority/overrides, not an existing game |
| Final setup commit | Rechecks event authority and creation policy before parking changes. `internal` rollback refuses new local-only/cloud games; exact matching committed pre-start event setup can continue |
| Legacy active/parked/imported games | Read-only Summary; no `/setup` continuation, `/players`, `/checkout` or `/game` capture path. Saved facts, notes, shot rows, ids, ownership and dirty metadata are not converted |
| Legacy Summary | No corrections, primary changes or raw finalization, even for managers. Saved-device versus resolved-cloud source label, unfinished aggregate exclusion, export access and existing sync/recovery remain |
| Cloud open | Resolve authority first, then prefer compatible local history. Duplicate or incompatible bindings refuse rather than hydrating over local facts. Missing/unreadable authority does not become legacy |
| Navigation labels | Known legacy active/parked/bound cards say View Summary. Unclassified cloud cards say Open saved game until authority is resolved; healthy event games retain their tracker path |
| Legacy cloud metadata | Both opening and submitting opponent rename check fixed sport authority before editing/writing |
| Damaged event markers | Preserved through normalization so malformed event records cannot regain aggregate capture/sync authority |
| Existing Basketball events | Clockless/anchored, half-/full-court history, tracking, Timeline, recovery, Summary, cloud lifecycle and aggregate readers retain their existing contracts |
| Sibling sports | Baseball's #505 retirement stays in force. Hockey/Football capture and mutations remain until their own cutovers; Soccer event behavior and mixed-sport parking are preserved |

`src/lib/legacyGameRetirement.ts` shares only the two retired sports' classification,
fact-mutation guards, marker preservation, raw-finalization refusal and local binding
checks. Baseball keeps its creation-only switch and fixed cloud readers. Basketball
keeps its draft, setup transaction, exact capabilities, clock, lineup and transport.
No universal sport engine or general identity mapping UI is added.

Transport of old facts is not permission to edit/finalize them. Existing aggregate
sync and final-cloud/stale-result guards remain; viewing Summary never clears debt.
Explicit warned data-management deletion remains separate. Previously finalized
legacy contributions remain eligible; unfinished games stay excluded from season/
career totals without conversion or a Finalize exception. Old chart rendering is
best effort, not permission to erase stored rows or stats.

## Observed Verification

- Initial implementation suite: **334 files / 3,374 tests passed**. Final focused
  malformed-authority, finalization, cloud-open and context run: **4 files / 81 tests
  passed**. Earlier broad focused coverage passed 14 files / 233 tests before the
  seven additional malformed-marker cases; the final full suite includes them all.
- Configured TypeScript/Vite/PWA build passed with placeholder public Supabase
  configuration and build id `tui1-cutover-20261024`: **2,421 modules / 15 precache
  entries**. Local app chunk **3,026,335 bytes**, **119,393 bytes** below the unchanged
  3 MiB hard limit. Exact-head CI is recorded on the PR.
- Repository lint: **0 errors / 3 existing Fast Refresh warnings**. Review controls:
  **22 tests passed**. **169 local documentation link targets** and whitespace checks passed.
- Synthetic Chromium: **8 desktop/narrow Light/Dark views / 16 interaction cases
  passed**, including retired routes, all four roles, stale personal/team draft
  preservation and explicit reset, one event-only setup commit preserving the prior
  game, creation rollback, historical clockless-event access during rollback, removed
  settings controls, dirty local Game Info review and refused cloud rename.
- Screenshots were inspected. No page errors or horizontal overflow on passing runs.
  The visual pass caught a Baseball-specific footer label; it now returns to the
  current sport. Fixture storage-key encoding and team-settings schema errors were
  corrected before the reported passing browser run.
- Existing Baseball/Hockey browser batch rerun against the shared extraction:
  **8 views / 18 interaction cases passed**, including Baseball creation rollback,
  dirty local review, legacy rename refusal and plain legacy Hockey setup.

Committed tests exercise reducer refusals, fingerprint/debt/export preservation,
import, incompatible binding refusal, corrupt markers, historical event replay,
setup/transaction rollback and exact continuation, raw finalize/stale callbacks,
cloud-open ownership and shared handler/route guards. Retained generic aggregate
reducer tests now use an unretired sport; Basketball projection compatibility uses
frozen historical totals rather than re-enabling retired capture.

Browser fixtures mount real routes/components with synthetic auth/Supabase responses
and isolated GameContext adapters. They are not live RLS, full-game, physical-mobile
or installed-PWA signoff. No SQL was changed or run. The existing independent-review
and live-check records are not retroactively marked passed.

## PR Comment Follow-Up

Both comments in [PR #506's review](https://github.com/Rothermal/cursor-default/pull/506#issuecomment-6382248234)
were accepted and addressed without changing game/cloud policy:

- Added nine committed Game Info runtime cases: dirty active/parked Basketball and
  Baseball history, incompatible active/parked Basketball event bindings, unknown
  Basketball authority, and refused prepare/resume transitions. The tests exercise
  real parked storage and assert no cloud replacement, dispatch or storage rewrite.
- Temporarily disabled both Game Info binding blocks: all nine new cases failed.
  Restored both production blocks unchanged; the focused run passed **5 files /
  97 tests**. The mutation is not part of the committed change.
- Removed the unused Basketball/Baseball preview getters and setters from
  `SettingsContext`. Stored fields and parsing remain untouched; two explicit
  true/false round-trip cases preserve both old preferences. No creation consumer
  or Hockey setting was changed.
- Reran the synthetic Chromium cutover batch after the context cleanup: **8 views /
  16 interaction cases passed**, with the same synthetic-service limitations above.
- Follow-up full suite: **334 files / 3,385 tests passed**. Configured
  TypeScript/Vite/PWA build passed with placeholder public Supabase configuration
  and build id `tui1-review-20261024`: **2,421 modules / 15 precache entries**,
  **3,025,928-byte** app chunk, **119,800 bytes** below the unchanged cap. Review
  controls: **22 tests passed**. Source lint (`pnpm lint --ignore-pattern
  'qa.local/**'`): **0 errors / 3 existing Fast Refresh warnings**. The unrestricted
  local lint also scanned ignored QA fixtures/copied checkouts and failed on two
  unrelated unused variables there; CI runs without those local-only files.

## Rollback and Pending Release Evidence

- Change `BASKETBALL_EVENT_RELEASE_STAGE` from `released` to `internal` through a
  reviewed build. It blocks new creation, including local-only/development; it does
  not restore Legacy/opt-in or hide existing events, old summaries, exports or sync.
- A matching already-committed pre-start event setup may continue. Old aggregate
  setup drafts cannot use this exception. Layout rollback is separate from authority.
- Refresh used browsers/PWAs through the guarded update flow and confirm the deployed
  build; cached old clients retain their old behavior. No forced reload/storage wipe.
- Exact release contract 2/062 and clock/lineup contract 1 remain unchanged, as do
  app access, team roles and server-side finalization. No new migration is required.
- The existing route-level code-splitting follow-up remains in
  [operations](OPERATIONS.md#configured-build-and-offline-assets); the precache limit
  is not raised or silently bypassed.

Owner-only post-deployment validation is approved, not a broader-release signoff:

| Deployed check | Status |
| --- | --- |
| Updated browser/PWA build and retained parked games | Pending |
| Fresh personal/team event setup with the old preference off; clock, court capture, lineup and Summary | Pending |
| Final/unfinished/offline legacy summary, source labels, export and safe old-data sync | Pending |
| Actual Supabase/auth/RLS, cloud enable/sync and role refusals | Pending |
| Two-device conflicts/primary, finalize, reopen, correct and republish | Pending |
| Canonical versus finalized-legacy season/team/player/career totals | Pending |
| Physical phone, installed PWA, offline/reconnect and active-game guarded update | Pending |
| Deployed creation rollback with saved-game access and exact pre-start continuation | Pending |

The [BKE-6E matrix](REGRESSION_BKE_6E_RELEASE.md) keeps its historical owner results
and open issues. Clock independence and running-clock substitutions remain in the
[separate assessment](PLAN_EVENT_TIMING_AND_LIVE_LINEUPS.md), not this cutover.
