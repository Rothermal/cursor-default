# Plan: BKE-6B Production Setup and Live Clock

Status: BKE-6B1 is implemented. BKE-6B2 production anchored setup is next. The BKE-6 product Q&A
is complete and introduces no open product decisions for this phase.

Parent: [PLAN_BKE_6_CLOCK_AND_LINEUPS.md](PLAN_BKE_6_CLOCK_AND_LINEUPS.md)

Foundation: [PLAN_BKE_6A_CLOCK_LINEUP_FOUNDATION.md](PLAN_BKE_6A_CLOCK_LINEUP_FOUNDATION.md)

---

## 1. Goal

Turn the implemented anchored-clock and opening-lineup contracts into a production workflow for new
local Basketball Event games. A recorder must be able to:

- deliberately choose and review rules version 3;
- select a valid tracked opening lineup;
- start, observe, pause, adjust, expire, and recover an anchored clock;
- capture every in-period event at the authoritative canonical elapsed time;
- park, reload, and resume without losing clock authority; and
- retain exact behavior for clockless Event games, Legacy Basketball, Soccer, and historical games.

BKE-6B does not implement live substitutions, lineup-changing boundary review, equal-play
overrides, lineup-history correction, anchored cloud transport, or anchored Summary. It does add the
narrow same-current-five confirmation needed to continue an equal-play-off game at a configured
boundary. The broader workflows remain BKE-6C and BKE-6D work.

---

## 2. Current-State Audit

The no-UI BKE-6A foundation already supplies the hard authority contracts:

1. Strict `BasketballMatchRulesV3` and `BasketballMatchSetupV2` parsing, deliberate v2-to-v3 draft
   upgrades, and exact clock/lineup capability parsing.
2. Neutral Start, Pause, Adjustment, and Stoppage events with deterministic anchored-clock replay.
3. Opening and live lineup projection, exact participation intervals, boundary guards, equal-play
   evaluation, and checked no-UI commands.
4. Event definitions that admit non-null elapsed time while projection still requires null for every
   clockless stream and the exact canonical value for anchored in-period events.
5. Persisted wall-clock anchors in the event stream. Reload recovery therefore needs no second clock
   store and no per-second reducer writes.

The production path still has five intentional gaps:

- `PlayerSetup` rejects rules version 3 and cannot collect the opening-lineup authority required by
  setup version 2.
- The local setup draft has no opening-lineup step or restart-safe progress for that step.
- `GameTracker` has no sticky clock controls, display scheduler, expiration materializer, or recovery
  warning surface.
- Ordinary Basketball command factories default `elapsedMs` to null; callers do not share one
  authoritative capture-time resolver.
- Parking and active-game replacement do not intercept a running anchored clock.

No database migration is expected. Migration 063 already provides the isolated capability contract,
and BKE-6D owns anchored transport, readiness, finalization, and publication.

---

## 3. Locked Implementation Boundaries

### 3.1 Local-only anchored creation

BKE-6B enables only an explicit local-only anchored game. It must not bind, upload, auto-create, or
finalize an anchored cloud game. Any selected cloud destination or existing cloud source blocks the
anchored commit before active-game state is replaced and explains that cloud support arrives in
BKE-6D. Clockless Event and Legacy cloud paths remain unchanged.

The capability client remains tested but is not treated as permission to wire partial transport.
BKE-6D must require both the existing release capability and
`clockAndLineupsVersion: 1` before enabling the complete cloud lifecycle.

### 3.2 Opening lineup versus BKE-6C

BKE-6B owns only immutable opening-lineup capture:

- exactly five eligible tracked participants when five or more exist;
- one through four only after a non-empty short-handed reason;
- zero or more than five rejected;
- Bench and DNP remain explicit setup states; and
- opponent lineup authority remains null unless stable opponent participants already exist.

BKE-6B does not add an opponent roster builder merely to populate optional authority.

Rules requiring equal-play decisions are not silently weakened. Production start is temporarily
limited to anchored rules with equal play `off`. This admits the six equal-play-off built-in
profiles after deliberate version-3 upgrade; Youth Equal-Play remains blocked until BKE-6C supplies
candidate-lineup review and reasoned override controls.

For a configured lineup-change boundary, BKE-6B exposes one narrow `Confirm current five` action for
each side with lineup authority. It calls the implemented checked confirmation command with the
unchanged projected participant ids before Clock Start. It cannot change participants, satisfy an
equal-play violation, infer a substitution, or edit prior history. A recorder who needs a lineup
change must wait for BKE-6C rather than misrecord the same five. This minimal confirmation makes the
ordinary built-in profiles exercisable without pulling the substitution workflow into BKE-6B.

### 3.3 Personal display preferences

Tenths, expiration sound, and expiration vibration are device capabilities and do not belong in the
strict cloud settings authority. Store them explicitly under the existing device-local
`AppSettings.basketball` payload created for `eventTrackerPreviewEnabled`.

`AppSettings.courtCapture` is not an eligible home. Its rebound preference bootstraps the exact,
CAS-synced `BasketballPersonalSettingsV1.capture` payload; adding local-only fields there risks
invalidating or accidentally syncing the personal record. Keep `defaultCourtFlipped` in the
existing personal settings authority only. Team settings continue to own rules, not personal
presentation.

This avoids widening the exact cloud settings payload for preferences that may differ legitimately
between a phone, tablet, and desktop. Invalid persisted booleans fail closed to documented defaults;
sound or vibration failures never affect clock authority.

### 3.4 One authoritative event timestamp path

All in-period Basketball capture commands must resolve one command moment before creating events:

```text
clockless game -> occurredAt plus elapsedMs null
anchored paused -> occurredAt plus fixed projected elapsedMs
anchored running -> occurredAt plus elapsed derived from the persisted anchor
expired running -> materialize one expiration Pause, then capture at period duration
invalid/recovery state -> reject capture with a focused diagnostic
```

The resolver is shared command-domain code, not a React-only helper. Related events in one capture
group receive the same `occurredAt` and `elapsedMs`. No event factory reads `Date.now()` internally,
and no caller independently calculates elapsed time.

---

## 4. Delivery Slices

Each slice receives its own implementation branch and PR.

| Slice | Scope | Exit condition |
|---|---|---|
| BKE-6B1 | **Implemented.** Device preferences, version-3 compatibility confirmation, restart-safe setup-draft contract, and reusable anchored workflow guards | Rules/settings/setup drafts remain strict and backward compatible; no production anchored game starts yet |
| BKE-6B2 | Event Setup review, focused Opening Lineup step, immutable setup-v2 commit, and explicit local-only start | A supported local anchored game starts paused with exact opening authority; unsupported cloud and BKE-6C-dependent starts fail before replacement |
| BKE-6B3 | Shared command-time resolution, sticky clock strip, same-five boundary confirmation, Start/Pause/Stoppage/Set Clock, display ticking, expiration, and recovery | Every anchored capture has exact canonical elapsed time and the clock runs without per-second state writes across Track and Timeline |
| BKE-6B4 | Running-clock park/replacement interception, reload/background/offline hardening, period-flow integration, accessibility/responsive polish, and exit audit | A supported local anchored game can run, pause, adjust, expire, park/reload, and complete periods while parity gates remain green |

---

## 5. BKE-6B1: Contracts and Draft Workflow

### 5.1 Device preferences

Extend `AppSettings.basketball` with exact device-local fields and conservative defaults:

- show tenths below one minute: on;
- expiration sound: off; and
- expiration vibration: off.

Do not add these fields to `AppSettings.courtCapture`, `BasketballPersonalSettingsV1`, or
`BasketballTeamSettingsV1`. Expose them in Settings -> Sports -> Basketball -> Display. Controls must describe unavailable
browser capabilities without promising they will work. A user gesture may prepare sound, but saving
a preference never requests broad permission or emits an alert.

### 5.2 Version-3 save confirmation

Personal and team settings already support deliberate version-3 draft upgrades. Before saving any
version-3 clock bundle, show the approved compatibility warning: older clients cannot parse this
authority and may be unable to start a new team-sourced Event game. The confirmation applies to
version-3 clockless and anchored bundles because schema version, not selected clock mode, defines
the compatibility boundary.

The warning must occur before local cache or cloud CAS mutation. Cancel leaves the current saved
authority and revision untouched. Team read-only roles never see an enabled save action.

### 5.3 Setup draft evolution

Introduce a new strict local draft envelope for opening-lineup progress while preserving the current
version-1 parser and stored drafts. The new draft records only editable setup state, never projected
clock state:

- reviewed rules and source metadata;
- participant statuses needed to derive Starter, Bench, and DNP;
- tracked opening ids and optional short-handed reason;
- optional opponent authority only when stable opponent participants exist; and
- the current setup step.

Parsing a valid old draft restores the existing clockless flow. It does not invent an anchored
lineup or auto-upgrade rules. Invalid or account-mismatched drafts retain the current fail-closed
behavior.

### 5.4 Shared policy helpers

Add pure helpers for:

- whether a rules snapshot can enter the temporary equal-play-off BKE-6B runtime;
- whether a setup target is explicit local-only or cloud-backed;
- whether the active game has a running anchored clock; and
- whether a proposed action is a mutation-free visit or a park/replacement commit.

These helpers become the single policy source for B2 setup and B4 parking interception. Do not
scatter rules-version or clock-running checks across route components.

### 5.5 Tests

- exact old/new local preference parsing and malformed-value fallback;
- version-3 warning accept/cancel and no-write cancellation;
- owner/admin edit versus scorer/viewer review behavior;
- setup-draft v1 compatibility, v2 round trip, account isolation, and corruption rejection;
- supported-runtime and local/cloud policy matrices; and
- unchanged clockless setup/settings fixtures.

---

## 6. BKE-6B2: Production Anchored Setup

### 6.1 Event Setup review

Keep the existing setup route and progressive draft. When resolved rules are version 3, review must
show:

- clockless or anchored mode and its source;
- regulation segment durations and count direction;
- equal-play policy and lineup-change boundaries;
- local-only authority for the BKE-6B anchored path; and
- the complete source-aware change review before a deliberate version-3 commit.

Legacy and rules-v1/v2 Event setup retain their current steps and do not see empty clock panels.

### 6.2 Opening Lineup step

Add one focused step after participant selection and before game start. Use stable match participant
ids and immutable setup order, not cloud player ids or current UI indexes.

The tracked team UI separates Starter, Bench, and DNP, shows a stable `n / 5` count, and supports
touch and keyboard operation. Selecting fewer than five when five are available opens a reasoned
short-handed confirmation. The final screen previews the exact opening five and reason.

Do not put substitution, role, captain, equal-play override, or live minutes controls in this step.

### 6.3 Atomic start

Extend the checked start command to build `BasketballMatchSetupV2`, initialize the event stream,
append Period 1 Start, and expose the already projected opening lineup as one successful state
transition. The period opens paused; setup never appends Clock Start.

Validation failure returns the untouched pre-start state and preserves the draft for correction.
The setup commit also checks the current active-game replacement policy before mutation. A cloud
target or a rules configuration awaiting BKE-6C fails before parking/replacing another game.

### 6.4 Tests

- five starters, reasoned one-to-four, zero, over-five, DNP, and ineligible participant cases;
- stable ids and participant-order canonicalization;
- Period 1 paused initialization and no implicit Clock Start;
- unsupported equal-play and cloud-target preflight with no state mutation;
- setup-draft reload at every step and cancellation behavior;
- narrow/mobile layout, focus order, validation announcements, and long names/numbers; and
- complete clockless Event and Legacy setup parity.

---

## 7. BKE-6B3: Live Clock and Canonical Capture Time

### 7.1 Command-time resolver

Extend the shared Basketball command context to return the authoritative event `elapsedMs` for the
injected `occurredAt`. Route every gameplay, scoring, lifecycle, administrative, Timeline-add, and
late-participant append through it where the event occurs in an active period.

The audit must include court shots and linked assists/rebounds, direct grid stats, free-throw trips,
fouls, turnovers, ejections, timeouts, score adjustments, period controls, Timeline historical adds,
and any helper that directly creates a Basketball event. Historical Timeline additions keep their
explicit reviewed time rather than using the live moment.

An atomic capture group receives one resolved moment. If expiration must be materialized, append the
expiration Pause and requested capture in one candidate rebuild where the command semantics permit;
otherwise materialize Pause first and require retry with a visible explanation. Never record a
gameplay event beyond period duration or at a stale projected time.

### 7.2 Sticky clock strip

Place one stable, compact strip above the Basketball Track/Timeline workspace so switching tabs does
not unmount authority or move primary controls. It contains:

- period label and count-up/countdown display;
- large Start or Pause control;
- Set Clock action;
- compact current-five chips; and
- `Confirm current five` when a boundary is pending; and
- a disabled or explanatory Bench action until BKE-6C.

The display may update with a component timer while running. The timer derives from the persisted
projection and current `now`; it never dispatches ticks. Whole seconds are normal, with optional
tenths below one minute. Current five remains projection-derived.

### 7.3 Clock actions

- Start uses the checked command and current lineup guard.
- Pause is immediate. Optional stoppage context uses the fixed BKE-6 catalog and appends atomically.
- Set Clock first pauses if necessary, requires a reason, accepts count-direction-aware input, and
  stores only canonical elapsed time.
- When the caller's wall clock maps before the running interval's monotonic elapsed watermark,
  including when it precedes the anchor, checked Set Clock takes one narrow recovery branch. Require
  the running clock's non-null `lastRunningElapsedMs`, let that be `recoveryElapsedMs`, and derive the
  matching persisted instant as
  `anchorOccurredAt + (recoveryElapsedMs - anchorElapsedMs)`. Pause at that exact
  last-known-good elapsed/instant pair, then append the recorder's reasoned adjustment at the same
  instant in one atomic group. Clamping merely to `anchorOccurredAt` is invalid after any later
  running event because it would move behind the projector's elapsed watermark. Ordinary Pause and
  gameplay capture remain rejected at a backward timestamp. The UI states that the event time was
  clamped because the device clock moved backward.
- At a pending equal-play-off boundary, `Confirm current five` calls
  `confirmBasketballLineup` separately for every side with lineup authority. Start remains blocked
  until all required confirmations succeed. The action cannot select a different five.
- Manual MIN capture is hidden and command-rejected for anchored games; historical manual-minute
  rows remain visible and inert.

### 7.4 Expiration and recovery

Use one route-level scheduler keyed by the projected anchor and period duration. At or beyond the
boundary, append exactly one authoritative expiration Pause through the checked command. Projection,
not timer identity, prevents duplicates after delayed callbacks, focus changes, or Strict Mode
remounts.

On reload, focus, visibility return, and online return:

- derive the current moment from the persisted anchor;
- materialize a normal expiration when within the accepted bound;
- show the BKE-6A recovery warning for backward or implausibly long wall-clock movement; and
- block new capture until the recorder resolves an unsafe clock with reasoned Set Clock. A backward
  jump uses the exact last-known-good elapsed/instant pair defined in section 7.3, so the recorder is
  never trapped waiting for device time to pass the old anchor or rejected for moving behind an
  already captured running event.

Expiration emits one visual announcement and best-effort sound/vibration according to device
preferences. Notification failure is presentation-only and cannot retry or duplicate authority.

### 7.5 Tests

- fake-clock Start/Pause/Set Clock and countdown/count-up/tenths display;
- paused versus running event timestamps across every event family;
- identical timestamps for linked capture groups;
- expiration during foreground, delayed callback, reload, background return, and duplicate effects;
- backward time both before and after an intervening running event, exact watermark-derived recovery
  time, excessive delta, offline return, and reasoned recovery;
- same-five tracked and optional-opponent boundary confirmation plus Clock Start guards;
- Track/Timeline switching with stable clock and controls;
- manual-minute hidden/inert behavior; and
- no per-second dispatch, fingerprint, dirty revision, or cloud queue churn.

---

## 8. BKE-6B4: Parking, Period Flow, and Exit Audit

### 8.1 Running-clock mutation interception

Centralize one confirmation used only for actions that will mutate parking or replace the active
game:

- explicit Park;
- setup Continue after the existing replacement warning;
- New Game or resume/import actions that commit a different active game; and
- any equivalent `GameContext` operation discovered by the action audit.

When the anchored clock is running, offer `Pause and continue` or `Cancel`. The first choice appends
a normal Pause at one injected timestamp and proceeds only after that state succeeds. Cancel changes
neither game nor manifest.

Opening setup, editing a draft, backing out, changing routes, switching Track/Timeline, or other
mutation-free navigation never pauses the clock. Browser close and reload retain anchor recovery.

### 8.2 Period lifecycle

Integrate existing checked period controls with the sticky strip:

- End Period atomically pauses a running clock at the authoritative moment;
- the next period opens paused at elapsed zero;
- Start remains explicit; and
- terminal local game controls require a paused clock.

For BKE-6B, completing all periods is supported for equal-play-off rules. Configured boundaries use
the narrow same-five confirmation from section 3.2. Equal-play advisory/enforced profiles remain
setup-blocked until BKE-6C, rather than becoming stranded at a decision the UI cannot complete.

### 8.3 Exit regression record

Create `docs/REGRESSION_BKE_6B_PRODUCTION_CLOCK.md` during B4 with automated results and an honest
manual matrix. At minimum cover:

- clean local anchored setup through completion;
- running and paused park/reload/resume;
- expiration in foreground and after background/reload;
- Set Clock forward/backward and recovery-warning resolution;
- clockless Event, Legacy Basketball, Soccer, and mixed parked games;
- phone/tablet/desktop, keyboard, screen reader announcements, reduced motion, and alert preferences;
- local-only/cloud preflight, same-five boundary continuation, and equal-play gating; and
- production build, lint, focused suites, and full test suite.

Owner smoke may remain explicitly Not run when time is limited. Automated success and a migration
status do not imply browser/PWA behavior passed.

---

## 9. Expected Ownership Map

Implementation should follow existing ownership rather than creating a parallel tracker:

| Area | Expected owner |
|---|---|
| Device display/alert preferences | `src/lib/basketball/` settings helper plus `BasketballSettings` |
| Restart-safe setup progress | `src/lib/basketball/setupDraft.ts` |
| Immutable start validation | `src/lib/basketball/commands.ts` and setup/state contracts |
| Setup screens | existing Basketball branches in `PlayerSetup` and supporting focused components |
| Canonical command moment | shared Basketball command context/helper used by all event command modules |
| Clock display/runtime materialization | focused Basketball hook/component mounted by `GameTracker` |
| Parking/replacement policy | pure Basketball policy helper plus centralized `GameContext` action path |
| Regression evidence | focused unit/component tests and `REGRESSION_BKE_6B_PRODUCTION_CLOCK.md` |

The UI scheduler may use browser time, but event projection and checked command modules remain the
only authority. Avoid a second clock reducer, mutable singleton, interval accumulator, or
localStorage clock mirror.

---

## 10. Compatibility Gates

Every slice must prove:

- rules versions 1 and 2 remain permanently clockless;
- version-3 clockless games still require null event elapsed values and retain manual minutes;
- existing Event streams and Legacy games are not converted or backfilled;
- malformed anchored setup or event history remains quarantined at the last coherent projection;
- Soccer and shared event transport behavior are unchanged;
- direct cloud review never hydrates local anchored authority;
- running display updates do not dirty, sync, or fingerprint the game; and
- an unsupported client cannot silently reinterpret anchored authority as clockless.

---

## 11. Deferred to BKE-6C and Later

- Bench substitution sheet and atomic multi-player changes;
- between-period candidate-lineup selection, changed-five review, and equal-play evaluation;
- role/captain changes, late-player entry workflow, ejection replacement, and short-handed recovery;
- advisory/enforced equal-play presentation and reasoned overrides;
- Recent Events/Timeline clock and lineup correction, Undo dependencies, and Set Current Lineup;
- anchored Players/Summary, exact-second aggregates, and plus-minus quality;
- anchored cloud bind/sync/conflicts/readiness/finalization/reopen/publication; and
- owner release smoke and the broader BKE-6 matrix.

---

## 12. Completion Rule

BKE-6B is complete only after B1 through B4 merge, the regression record is current, and a supported
new local anchored game can setup, run, pause, capture exact event times, adjust, expire, park/reload,
and complete periods without changing any clockless or other-sport behavior. The feature remains
default-off and owner-only, cloud lifecycle remains unavailable, and BKE-6C-dependent rules remain
honestly blocked until their complete workflow ships.
