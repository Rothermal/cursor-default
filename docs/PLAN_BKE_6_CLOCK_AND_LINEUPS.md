# Plan: BKE-6 Basketball Clock and Lineups

Status: Product Q&A complete. All 48 clock, lineup, correction, cloud, settings, and rollout
decisions are approved. The five-slice delivery plan is ready for review; implementation has not
started.

Parent: [PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md](PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md)

---

## 1. Goal

Add an opt-in anchored Basketball game clock, stoppage context, opening and live lineups,
substitutions, and event-derived on-court intervals to new Event games. Clockless Event games,
Legacy Basketball games, existing Soccer behavior, and historical canonical publications must
remain unchanged.

BKE-6 consumes the immutable segment durations and lineup boundaries introduced in BKE-5. It does
not add a shot clock, possession tracking, or real-time collaborative editing.

---

## 2. Inherited Decisions

The approved BKE-0 and BKE-5 contracts already require:

- canonical elapsed time to count forward even when the display counts down;
- start, pause, adjustment, stoppage, substitution, and role-change event families;
- starter, bench, and DNP setup state for anchored games;
- stable match participant ids through corrections, cloud resolution, and merges;
- substitution events to derive lineup intervals without separate persisted lineup-window rows;
- manual minute adjustments to remain authoritative forever for `clockModel: 'none'` games and to
  become visible but inert for `clockModel: 'anchored'` games;
- shot-clock tracking to remain a separately planned add-on;
- existing games to retain their snapshotted clock model and authority.

The BKE-5D owner smoke and broader live matrix remain release evidence work. They do not change the
BKE-6 product model or block this planning pass.

---

## 3. Approved Q&A Decisions

### Batch A: Clock authority

1. Unlock `clockModel: 'anchored'` through personal, team, and match settings. Existing built-in
   profiles, saved settings, and games remain clockless until deliberately changed. Setup presents
   the resolved clock source before committing the immutable match snapshot.
2. Basketball defaults to a countdown display for anchored rules, while count-up remains an
   available profile or match choice. Persisted canonical elapsed time always increases.
3. Start and Pause are explicit clock commands. Ending a period pauses atomically, but recording a
   shot, foul, timeout, free throw, or other gameplay event never silently changes clock state.
4. Pause is always immediately available without a required reason. When the recorder selects an
   optional reason, the command records the pause and linked structured stoppage atomically.

### Batch B: Clock lifecycle

5. Every period opens paused at its configured duration. The recorder confirms the lineup and then
   explicitly starts the clock; starting a period never starts time implicitly.
6. The clock stops automatically at `0:00` and provides visible and audible feedback, but period
   completion remains a separate explicit End Period command.
7. A running clock advances from its persisted wall-clock anchor while the app sleeps, reloads, or
   is briefly offline. On return, an elapsed value beyond a reasonable period bound produces a
   recovery warning instead of silently accepting or discarding the time.
8. Set Clock atomically pauses a running clock and appends a reason-required adjustment. The
   adjustment remains reviewable and correctable in Timeline; prior clock events are never rewritten.

### Batch C: Display and opening lineups

9. The live clock shows whole seconds normally and tenths below one minute. Tenths are controlled by
   a personal display preference and never alter the immutable rules snapshot or event timing.
10. The tracked team requires exactly five starters when at least five eligible participants exist.
    A lineup of one through four requires explicit short-handed confirmation; zero cannot start.
11. Opponent tracking remains team-only by default. If opponent participants are present, their
    on-court lineup is optional. Opponent minutes and lineup-dependent metrics render only when the
    source proves complete opponent coverage.
12. Late players may be added as stable match participants while the clock is paused. They default
    to Bench and may enter immediately through the normal substitution command.

### Batch D: Live substitutions

13. Substitutions are available only while the clock is paused. The recorder selects every outgoing
    and incoming participant, reviews the resulting lineup, and commits one atomic multi-player
    command.
14. A substitution may contain balanced swaps or reasoned exit-only and entry-only changes for
    injury, eligibility, and short-handed recovery. A resulting lineup below five requires an
    explicit reason; a lineup above five is rejected.
15. Every segment marked as a lineup-change boundary requires lineup review before the clock can
    start. The same five may be confirmed unless the resolved equal-play policy requires a change.
16. Disqualification and ejection never infer a replacement. An ineligible on-court participant is
    flagged as replacement required, and the next clock start is blocked until the lineup is fixed.
    Their interval remains truthful through the explicit exit rather than ending at a guessed time.

### Batch E: Lineup history and minutes

17. Position and captain labels are optional, game-specific metadata. Timestamped changes support
    review but never restrict participant eligibility or substitution choices.
18. Timeline may atomically edit a substitution's participants and effective clock time after a
    consequence preview. The final candidate must reproject completely and cannot create overlapping,
    oversized, or otherwise impossible lineup history.
19. A missed substitution has two explicit recovery paths: backdate a historical correction when
    its time is known, or use a reason-required Set Current Lineup command when timing is uncertain.
    Current-lineup recovery begins accurate tracking at the command time and does not invent earlier
    intervals.
20. Playing time is the intersection of on-court intervals and running-clock intervals. Paused time,
    timeouts, between-period time, and other wall time never count toward derived minutes.

### Batch F: Equal play and Summary

21. Equal-play policy supports `off`, `advisory`, and `enforced`. Youth Equal-Play defaults to
    enforced. An authorized override requires a reason and remains visible in event history.
22. Equal-play rules may configure minimum periods, maximum consecutive periods, and allowed
    participation imbalance. Evaluation occurs against the upcoming lineup at each boundary, and
    the product does not claim universal league compliance.
23. Player Summary presents Starter, Bench, or DNP status; derived `MM:SS`; stint intervals;
    position history; and a clear complete or incomplete lineup-quality state.
24. Player and five-person lineup plus-minus derive only when tracked lineup and scoring histories
    are complete. Possession-based lineup ratings remain hidden until the separate possession module
    supplies complete source events.

### Batch G: Live clock capture

25. Every event in an anchored game receives the current canonical elapsed time automatically. A
    running clock computes it from the persisted anchor; a paused clock uses its fixed elapsed value.
26. A compact sticky clock strip remains visible across live Track and Timeline views. It provides a
    large Start or Pause control plus focused Set Clock and lineup actions without moving the tracker.
27. Optional stoppage context uses a concise fixed catalog: timeout, foul or free throw, out of
    bounds, substitution, injury, official review, and other with an optional note. Context never
    synthesizes a timeout, foul, substitution, or other gameplay event.
28. Expiration produces one visual alert and optional sound or vibration controlled by personal
    display preferences. It never creates a repeating alarm or authoritative event by itself.

### Batch H: Cloud and game lifecycle

29. Cloud-backed anchored creation, sync, and finalization require an explicit
    `clockAndLineupsVersion: 1` server capability. Explicit local-only creation remains available;
    older clients continue handling clockless games and fail closed rather than misprojecting an
    anchored stream.
30. Every recorder stream owns one complete clock and lineup history. Independent streams are never
    blended; existing primary selection and canonical publication choose one coherent source.
31. Primary finalization requires a terminal paused clock, completed periods, valid lineup history,
    no unresolved replacement requirement, and a recorded reason for every equal-play override.
32. Reasoned Reopen offers Correct records or Resume game. Correction mode keeps the clock paused
    and exposes Timeline repair; Resume restores the period and lineup workspace but still requires
    an explicit Start Clock command.

### Batch I: Rules and settings compatibility

33. BKE-6 introduces immutable Basketball rules schema version 3 for anchored-clock,
    display-direction, stoppage, and equal-play fields. Versions 1 and 2 remain readable and
    permanently clockless.
34. Saved defaults never auto-upgrade. Deliberately selecting Anchored converts only the editable
    draft to version 3, shows the complete source-aware diff, and persists after confirmation.
35. Owners and admins edit shared team clock and equal-play defaults. Scorers and viewers review
    them read-only, and Game Setup snapshots the exact resolved source and values.
36. An owner, admin, or scorer authorized to track the game may record a reason-required per-game
    equal-play override. Viewers cannot override, and every override remains visible in Timeline and
    Summary.

### Batch J: Event contract and corrections

37. Setup owns the opening lineup. Every later configured boundary appends one complete
    `basketball.lineup_confirmed` snapshot before Clock Start, proving review even when the same five
    remain on court.
38. One `basketball.substitution` event stores the complete resulting on-court lineup plus its mode
    and reason. Projection derives incoming and outgoing differences from prior state and rejects a
    stale, oversized, ineligible, or otherwise impossible transition.
39. Clock Start stores canonical elapsed time and a wall-clock anchor, Pause stores the resulting
    canonical elapsed time, and Adjustment stores the replacement elapsed time plus reason. Replay
    never infers authoritative clock values from envelope creation timestamps or per-second writes.
40. A newest clock or lineup command supports grouped Undo only when no later event depends on it.
    Otherwise Timeline presents a consequence-aware correction that validates and rebuilds the full
    candidate once.

### Batch K: Setup, live UI, and aggregates

41. Event Game Setup reviews the resolved clock mode and source diff. Anchored Player Setup adds one
    focused Opening Lineup step; the existing clockless setup flow remains unchanged.
42. The current five remain visible as compact chips beside the sticky clock. A Bench action opens a
    bottom sheet for multi-player substitution and resulting-lineup review without crowding the
    court or stat grid.
43. Canonical projection preserves exact participation seconds and derives `MM:SS`, starts,
    appearances, DNP, and completeness-gated plus-minus. Clockless manual minutes continue mapping
    to seconds without rewriting prior publications.
44. Manual MIN controls remain available for clockless games. Anchored games present derived time;
    any historical manual-minute events stay visible in Timeline but are explicitly inert.

### Batch L: Operations and delivery

45. Explicit local-only anchored creation may proceed without a server capability. Cloud-backed
    creation, later binding, upload, and finalization require `clockAndLineupsVersion: 1`.
46. Park, sport switch, and new-game navigation intercept a running clock and offer Pause and
    continue or Cancel. Unexpected close or reload still recovers from the persisted anchor.
47. Delivery splits into five phases: rules/events/capability; setup/live clock;
    substitutions/equal play/corrections; Summary/aggregates/cloud lifecycle; and release hardening.
48. Anchored mode remains default-off and owner-only initially. Post-deployment owner smoke is
    permitted, but the multi-device, role, offline, PWA, mixed-sport, correction, finalization, and
    aggregate matrix must pass before broader defaults are considered.

---

## 4. Rules and Settings Contract

### Immutable version 3

BKE-6 adds a strict `BasketballMatchRulesV3`. It retains the version-2 segment, foul-window,
timeout-pool, overtime, and personal-foul fields and adds only clock/lineup authority:

```ts
interface BasketballMatchRulesV3 {
  rulesSchemaVersion: 3
  regulationSegments: BasketballSegmentRule[]
  overtimeTemplate: BasketballOvertimeRule
  foulWindows: BasketballFoulWindowRule[]
  timeoutPools: BasketballTimeoutPoolRule[]
  personalFoulLimit: number
  clockModel: 'none' | 'anchored'
  clockDisplayDirection: 'count_down' | 'count_up'
  clockExpiration: 'stop_at_zero'
  stoppageMode: 'explicit'
  equalPlayPolicy: {
    mode: 'off' | 'advisory' | 'enforced'
    minimumPeriods: number | null
    maximumConsecutivePeriods: number | null
    maximumPeriodImbalance: number | null
  }
}
```

Exact names and nesting may be refined in BKE-6A, but these semantics may not move between
authorities. Tenths, sound, vibration, and other local presentation choices remain personal display
preferences. Period duration, display direction, manual stoppage policy, and equal-play constraints
remain immutable match rules.

Version 1 and version 2 snapshots never acquire anchored semantics. Their strict parsers and
projection fixtures remain unchanged. A version-3 snapshot may use `clockModel: 'none'`, but an
equal-play mode other than `off` requires `anchored` because no trustworthy participation source
exists otherwise.

### Settings hierarchy

The existing hierarchy remains:

```text
match override -> team default -> personal default -> built-in profile
```

- Existing built-in versions and saved defaults remain clockless.
- Selecting Anchored upgrades only the editable draft after a complete source-aware diff.
- Saving personal/team version 3 continues through the existing revision-CAS contracts.
- Team owners/admins edit; scorers/viewers review read-only.
- Game Setup snapshots the complete resolved version-3 value and source revisions.
- Disabling Anchored in a draft never converts or rewrites an existing game.

The BKE-6A migration audit decides whether strict database settings validation and the cloud
capability extension require one migration. No speculative table or event-envelope migration is
allowed.

---

## 5. Event and Projection Model

### Event families

BKE-6 registers the previously reserved families and the minimum additional lineup evidence:

| Event | Authority |
|---|---|
| `basketball.clock_started` | Period-local elapsed value plus persisted wall-clock anchor |
| `basketball.clock_paused` | Exact period-local elapsed value at pause/expiration |
| `basketball.clock_adjusted` | Reasoned replacement of the current period elapsed value |
| `basketball.stoppage` | Optional structured context linked to the same Pause command |
| `basketball.lineup_confirmed` | Complete side-specific lineup at a configured boundary |
| `basketball.substitution` | Complete resulting lineup, transition mode, and optional/required reason |
| `basketball.role_changed` | Optional game-specific position/captain metadata change |
| `basketball.equal_play_override` | Authorized reasoned override of one enforced boundary decision |

Setup owns opening starter/bench/DNP state. A period-boundary confirmation proves review without
inventing a substitution. `substitution` modes cover normal, short-handed, injury/eligibility,
boundary, and current-lineup recovery transitions; they do not require separate player-in/player-out
rows. The projector derives the transition against prior state.

Pause plus optional stoppage is one capture group. No shot, foul, timeout, free throw, ejection, or
substitution implicitly starts or pauses the clock. Existing event relationships stay unchanged.

### Anchored clock projection

Projection owns period-local canonical elapsed time. Countdown is calculated as
`durationMs - elapsedMs`; event ordering continues to use period/sequence/event-id rules. Running
display time is derived from the last Start anchor without reducer writes or storage writes each
second.

At expiration, one scheduled transition appends the deterministic Pause at the period duration. If
the browser sleeps through that timer, recovery materializes the same capped Pause once and warns
the recorder that the app resumed after the expected boundary. End Period remains explicit.

Set Clock pauses first when needed, records old/new elapsed values and reason, and may move time
forward or backward only within the current period's valid range. It never rewrites Start/Pause
history or completed-period identity.

### Lineups and intervals

Projection derives, per supported side:

- current on-court and bench participants;
- boundary-confirmation state and replacement requirements;
- starter, appearance, DNP, position, and captain history;
- on-court intervals and running-clock intervals;
- exact participation seconds from their intersections;
- lineup-quality diagnostics and equal-play status;
- completeness-gated player/five-person plus-minus.

The tracked side normally has five eligible players. One through four requires a reasoned
short-handed transition; zero cannot start and more than five is invalid. Opponent lineup authority
is optional and independent. Missing opponent coverage does not invalidate tracked-team minutes,
but it suppresses opponent minutes and metrics that require complete opponent history.

Manual-minute events remain effective only for clockless rules. In anchored streams they stay
visible and inert. Projection never combines manual and interval-derived time.

### Diagnostics and corrections

The stream remains displayable to its last coherent projection when invalid clock/lineup history is
encountered. New capture, cloud readiness, and finalization fail closed until repaired. Diagnostics
must distinguish at least stale anchors, invalid elapsed values, missing confirmations, duplicate or
ineligible lineup participants, oversized/empty lineups, unresolved replacement, impossible
substitution transitions, and equal-play override defects.

Newest dependency-free clock/lineup capture groups may use Recent Events Undo. Timeline owns
historical adjustment, substitution, role, confirmation, and override correction with consequence
previews and one final atomic append/mutation/reprojection. Set Current Lineup is a reasoned present
recovery and explicitly leaves earlier uncertain intervals incomplete rather than fabricating time.

---

## 6. Product Surfaces

### Setup and settings

- Personal and Team Basketball Rules expose version-3 Clock and Equal Play controls with source
  metadata, CAS conflict handling, complete diff review, and existing role permissions.
- Personal Display owns tenths-below-one-minute, expiration sound, and vibration.
- Event Game Setup shows clock mode/direction, equal-play policy, source revisions, and complete
  immutable rules before commit.
- Anchored Player Setup adds Match Roster and Opening Lineup review. The tracked side requires five
  when possible; late participants default to Bench.
- Clockless Event and Legacy setup remain byte-for-byte compatible outside shared labels.

### Live tracker

- A compact sticky strip keeps period, clock, Start/Pause, Set Clock, current five, and Bench action
  visible across Track and Timeline without resizing the court/stat grid.
- Start is blocked by unconfirmed boundaries, invalid lineup size, replacement requirements, or an
  unresolved enforced equal-play decision.
- The substitution bottom sheet supports multi-player selection, resulting-lineup review,
  short-handed reasons, optional role/captain changes, and atomic commit.
- Gameplay capture automatically stamps effective anchored elapsed time whether running or paused.
- Park, sport switch, New Game, and game replacement intercept a running clock with Pause and
  continue or Cancel. Unexpected reload recovers from the anchor.
- Expiration emits one visual alert and optional local sound/vibration; it never loops.

### Timeline, Summary, and aggregates

- Timeline adds Clock and Lineup families, current revision/removal metadata, structured detail,
  consequence previews, grouped Undo boundaries, and correction-only Reopen behavior.
- Players shows Starter/Bench/DNP, exact `MM:SS`, stints, positions, participation quality, and
  eligible plus-minus.
- Overview/Team surfaces disclose clock mode, final clock health, equal-play overrides, and lineup
  completeness without presenting unsupported metrics.
- Canonical aggregate projection preserves exact seconds. Clockless manual minutes continue mapping
  to seconds, while anchored games contribute interval-derived seconds, starts, appearances, DNP,
  and completeness-gated plus-minus.
- Possession-based ratings remain absent until an independently complete possession module exists.

---

## 7. Cloud, Capability, and Lifecycle

The shared event rows and recorder transport remain payload-agnostic. Each recorder owns one full
clock/lineup stream; pull/merge never blends recorder histories. Primary selection, checkpointing,
canonical publication, reopen, and audit remain the BKE-4 authority model.

Cloud-backed anchored setup, later local-only binding, upload, readiness, and finalization require
`clockAndLineupsVersion: 1`. Explicit local-only anchored creation may proceed without a reachable
server, retaining the durable local-only policy until a successful capability-backed enablement.

An unsupported or malformed anchored source fails closed with upgrade/quarantine guidance. Older
clockless clients and games retain existing capability and transport behavior. BKE-6A must audit
whether the capability RPC can be extended compatibly or needs a fixed next-version surface.

Finalization requires:

- terminal paused clock and every expected period completed;
- complete primary clock and tracked-lineup projection;
- no replacement requirement or invalid participant transition;
- reasoned records for all enforced equal-play overrides;
- exact current recorder checkpoint and existing publication readiness.

Reopen still invalidates the active publication and preserves history. Correct records leaves the
clock terminal/paused and enables Timeline repair. Resume game restores the period workspace and
requires lineup review plus explicit Start before time advances. Republication remains explicit.

---

## 8. Delivery Plan

Each slice receives a detailed implementation plan and review before code begins.

| Phase | Scope | Exit condition |
|---|---|---|
| BKE-6A | Strict rules v3, settings/profile parsing, registered clock/lineup events, deterministic projection, checked commands, feature capability, and compatibility fixtures; no production UI | Clock/lineup streams project and quarantine deterministically, versions 1-2 remain unchanged, and capability/local-only boundaries are proven |
| BKE-6B | Personal/team/match controls, immutable setup review, opening lineup, sticky live clock, timestamps, expiration/recovery, Set Clock, and parking guards | A new local anchored game can setup, run, pause, adjust, expire, park/reload, and complete periods without affecting clockless games |
| BKE-6C | Multi-player substitutions, boundary confirmations, roles/captain, short-handed/replacement flows, equal-play enforcement/override, Recent Events, Timeline correction, and Set Current Lineup | Complete and incomplete lineup histories are accurately captured, corrected, diagnosed, and converted to exact intervals/minutes |
| BKE-6D | Players/Overview/Timeline detail, exact-second aggregates, plus-minus quality, cloud capability/bind/sync, recorder readiness, finalization, correction/resume reopen, and republication | One coherent recorder can sync and publish anchored authority; remote/canonical review is read-only and aggregate output is quality-gated |
| BKE-6E | Release-entry audit, older-client/clockless parity, responsive/accessibility/PWA hardening, rollback record, owner smoke, and broader matrix disposition | Anchored remains default-off, owner evidence is recorded honestly, and broader enablement is blocked until its matrix passes |

BKE-6B may be split into setup and live-clock PRs, and BKE-6C may be split into capture and
correction PRs, when the detailed plan shows either review surface is too large. Those are delivery
slices, not new product scope.

---

## 9. Regression Requirements

### Automated

- exact rules-v1/v2 hydration and projection parity plus strict v3 validation/round trips;
- settings hierarchy, explicit upgrade, CAS conflict, account/team cache isolation, and permissions;
- Start/Pause/expiration/recovery/adjustment sequences with fake time and no per-second writes;
- countdown/count-up and tenths presentation over identical canonical elapsed values;
- background, reload, offline, device-time anomaly, and duplicate-expiration recovery;
- opening five, short-handed confirmation, late participant, optional opponent, and boundary review;
- multi-player substitution, entry/exit-only, disqualification/ejection replacement, and role history;
- equal-play off/advisory/enforced evaluation and reasoned authorization overrides;
- interval intersection, exact seconds, manual-minute inertness, starts/appearances/DNP, and
  completeness-gated plus-minus;
- grouped Undo, stale correction preview, historical substitution edit, and current-lineup recovery;
- parking/import/export/fingerprint/sync stale-result behavior with running and paused anchors;
- local-only, capability failure, later cloud enablement, recorder isolation, checkpoint, conflict,
  finalization, both reopen modes, republication, and canonical review;
- aggregate exact-second composition and strict exclusion of incomplete lineup-dependent metrics;
- Legacy Basketball, clockless Event Basketball, Soccer, and mixed-sport route parity.

Use fake/system clocks deliberately. Tests must prove time behavior without sleeping in real time.
No test may depend on locale-formatted timestamps or wall-clock execution speed.

### Manual release matrix

- owner/admin/scorer/viewer and personal/team game paths;
- clean device, persisted preference, local-only, cloud enablement, and capability failure/recovery;
- two devices/recorders with primary conflict and non-primary audit-only history;
- online/offline, reload, background/PWA close-open, expiration, and device clock drift;
- phone/tablet/desktop layouts, keyboard/focus order, screen-reader announcements, sound/vibration
  preferences, and reduced-motion behavior;
- clockless Event, Legacy Basketball, anchored Event, and Soccer parked together;
- substitution/equal-play/correction/finalization/reopen/republication and aggregate destinations.

Owner-only post-deployment smoke may precede this full matrix. Every row receives Pass, Fail,
Blocked, or Not run with evidence; no unchecked row is implied to pass.

---

## 10. Compatibility Guardrails

- Do not initialize anchored clocks or lineup history for existing clockless games.
- Do not infer historical starters, substitutions, or intervals from aggregate minutes.
- Do not delete manual-minute events when they become inert in an anchored stream.
- Do not let display orientation or countdown presentation alter canonical event coordinates or
  elapsed-time ordering.
- Do not gate access to active, parked, imported, cloud, final, reopened, or canonical Event games
  on the current device's creation preference.
- Keep shared event transport payload-agnostic; add a migration only if an audited database or RPC
  contract actually requires one.

- Preserve independent recorder streams; do not create cross-recorder clock or lineup merges.
- Keep exact event/raw publication authority; do not publish cached projection or wall-clock display
  state as a second source of truth.
- Keep newly unsupported anchored sources diagnosable and readable to their last coherent event.

---

## 11. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Browser sleep or delayed timers distort display | Persist anchors, clamp expiration deterministically, warn on recovery, and test with fake time |
| Running clock is parked or replaced accidentally | Intercept deliberate navigation and require Pause and continue |
| Old clients accept schema 1 but do not know BKE-6 events | Add explicit feature capability and fail-closed upgrade/quarantine handling |
| Corrections create impossible overlapping lineups | Consequence preview plus atomic final reprojection; no partial mutation |
| Equal-play UI implies universal legal compliance | Configurable narrow constraints, source labels, and explicit non-compliance disclaimer |
| Partial opponent or missed substitution history yields false metrics | Separate quality flags and hide dependent minutes/plus-minus rather than estimate |
| Clock controls crowd the mobile tracker | Stable compact strip, current-five chips, and one focused Bench bottom sheet |
| BKE-6 disturbs released clockless games | Immutable version gates, parity fixtures, and no historical upgrade/backfill |

---

## 12. Non-Goals

- shot clock, possession arrow, possession events, usage, pace, or possession-based ratings;
- automatic clock changes inferred from fouls, shots, free throws, timeouts, or substitutions;
- mandatory opponent roster or opponent lineup tracking;
- universal league/officiating compliance claims or automated lineup scheduling;
- historical starter, substitution, interval, or plus-minus backfill;
- blending independent recorder clocks/lineups or real-time collaborative clock control;
- converting Legacy or existing clockless Event games to anchored authority;
- a broad tracker reskin unrelated to clock and lineup ergonomics.

---

## 13. Completion Rule

BKE-6 is implementation-complete only after BKE-6A through BKE-6E merge, required migrations are
applied, automated gates pass, default-off production access is preserved, the owner smoke record is
explicit, and broader access remains blocked until the full release matrix has an accepted
disposition. Planning approval alone does not close BKE-6.
