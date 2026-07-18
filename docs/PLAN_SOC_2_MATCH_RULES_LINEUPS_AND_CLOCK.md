# Plan: SOC-2 Match Rules, Lineups, and Clock

Detailed implementation plan for soccer match setup, participation, timing, and match-state
history. SOC-2 builds on the shared event foundation from SOC-1 and is intentionally split
into three sequential pull requests so each change remains reviewable and testable.

Status: Complete. SOC-2A, SOC-2B, and SOC-2C are implemented.

---

## 1. Goal

Create the soccer match-state foundation needed before field events and scoring are added.
The phase must support configurable competition rules, a selected match roster, an opening
lineup, game-specific roles, an accurate clock, periods, substitutions, corrections, and a
readable match history.

SOC-2 does not add soccer shots, goals, score controls, field capture, or cloud event sync.
Those remain in later soccer phases.

---

## 2. Delivery Slices

### SOC-2A: Domain and event foundation

- Add typed soccer rule, setup, participant, role, and runtime projection models.
- Add `sportGameState` to `GameState` as a discriminated sport-owned container.
- Register production soccer match-state event schemas and the soccer projector.
- Add semantic projection diagnostics that stop at the last coherent event.
- Add atomic batch event mutations and reducer support.
- Project soccer starts, appearances, and exact participation time into local state.
- Preserve soccer setup and raw events through persistence, parking, import, and hydration.
- Explicitly exclude soccer setup and event-backed games from aggregate automatic cloud sync until SOC-5.
- Add focused unit and persistence tests. No user-facing soccer workflow ships in this slice.

### SOC-2B: Setup, roster, lineup, and kickoff (complete)

- Add a development-only soccer entry through the normal sport chooser and dashboard.
- Add soccer-specific match information and per-game rule overrides under `/setup`.
- Add the two-step `/players` flow: Match Roster, then Starter/Bench roles and review.
- Support cloud roster selection as a read-only setup source without creating a cloud game.
- Support stable game-local anonymous participants.
- Validate player-count and goalkeeper rules, with an explicit short-handed confirmation.
- Start a match by atomically recording opening lineup, period start, and clock start events.

### SOC-2C: Live clock, periods, lineup, and correction UI (complete)

- Add the soccer `/game` clock, period, lineup, substitution, role, and direction controls.
- Add live elapsed time and participation time without per-second reducer writes.
- Add period transitions, extra-time choices, match end, and explicit reopen behavior.
- Add compact match-history correction tools for all SOC-2 event types.
- Show projection diagnostics and block dependent controls when history is incoherent.
- Keep the completed match route as a read-only soccer review surface.

SOC-2B starts only after SOC-2A is merged. SOC-2C starts only after SOC-2B is merged.

---

## 3. Authority and State Model

### Hybrid authority

The fully resolved match setup is persisted as a snapshot in `GameState`. Dynamic match
state is authoritative in the event stream and is rebuilt by the soccer projector.

```text
GameState
  sportGameState
    sportId: soccer
    version
    setup
      resolved rules snapshot
      tracked-team designation
      source team/season references
      selected match participants
      initial attacking direction
    projection
      match and period status
      clock anchor
      on-field and bench participants
      current roles
      exact participation intervals and totals
      substitution usage
      current attacking direction
```

The setup snapshot remains sufficient to reproduce the match rules used by an existing
game even if app defaults change later. Projection data is a cache and is always
rebuildable from the setup plus active events.

### Rules precedence

SOC-2 exposes app defaults and per-game overrides:

```text
game override -> app soccer defaults
```

The typed resolver should accept future personal and season layers, but those settings are
not exposed until SOC-6. The intended final precedence remains:

```text
game override -> season rules -> personal defaults -> app defaults
```

Mid-match rule changes are validated `match_rules_changed` events. They do not rewrite
the immutable opening snapshot or shortcut completed period history.

---

## 4. Match Rules

### Defaults

First-use defaults are:

- two 45-minute regulation periods,
- count-up clock with continuous match display,
- 11 maximum on-field players,
- no return substitutions,
- unlimited substitutions and substitution windows unless configured,
- optional extra time and shootout availability represented explicitly.

All defaults are editable before kickoff.

### Period structure

Regulation is an ordered list of segments with stable ids, labels, and nominal durations.
Presets may create common structures, but custom segment count, duration, and labels are
supported. Extra time is modeled as a separate ordered segment collection.

The clock supports:

- count up or count down for display,
- continuous match elapsed time or per-period display,
- canonical cumulative active `elapsedMs` regardless of display mode,
- manual start, pause, correction, and period transitions,
- stoppage/overrun after nominal duration without automatic period end.

The user manually ends every period. Ending a period atomically pauses the clock and marks
the period complete. The next period is shown, with its expected attacking direction, but
requires an explicit Start Period action.

### Player and substitution limits

Configured player count is the maximum allowed on field. A short-handed start is allowed
only after confirmation.

Rules may independently configure:

- total incoming substitutions (`null` means unlimited),
- substitution windows (`null` means unlimited), and
- whether a player may return after leaving.

One substitution-window event may contain several player changes. It consumes one window
and one substitution per incoming replacement. Halftime changes are flagged and do not
consume a window. When return substitutions are disabled, normal re-entry is blocked; an
explicit game-wide rule-change event may enable it.

---

## 5. Participants, Lineups, and Roles

### Match roster

Before kickoff, the recorder selects a Match Roster. Each selected participant is assigned
Starter or Bench plus an initial game role. Unselected roster members are Absent and
receive no appearance or minutes.

Cloud roster data may be used as a read-only source. The soccer setup snapshot preserves
source team and season ids, but SOC-2 does not populate `cloudSync` or create a cloud game.

Late arrivals are introduced by a timestamped match-roster addition event. The participant
may be added to the bench or atomically enter the field, but an appearance is recorded only
when they enter.

### Participant identity

Participants can reference an existing local/cloud-backed player or use a stable game-local
anonymous identity. Anonymous participants can start, substitute, receive roles, accrue
minutes, and be corrected. A later participant-resolution event can map that identity to a
roster player and retroactively rebuild starts, appearances, and minutes.

No full opponent lineup is modeled in SOC-2. Opponent identity remains lightweight match
context until later event phases need specific opponent actors.

### Roles

Every match participant has a game-specific role and eligibility. Structured role groups
are Goalkeeper, Defender, Midfielder, Forward, and Custom, with an optional display label.
Roles are not permanent player attributes.

At kickoff exactly one on-field participant must be the goalkeeper. The goalkeeper may be
a roster player or a stable `Goalkeeper unknown` participant. Bench players may be marked
as backup goalkeepers. Only one on-field goalkeeper may be active at a time.

Role changes are timestamped events. A player may move among roles throughout the match.
SOC-2 displays total minutes; the event model preserves enough history for future
minutes-by-role analysis.

### Opening and live lineup

The opening lineup is one atomic event containing all starters and their roles. Live
substitutions normally pair player out and player in, while explicit exit-only and
entry-only variants support injuries, cards, short-handed play, and corrections.

The live UI uses On Field and Bench tabs with role labels and focused substitution and role
actions. The full-field lineup visualization belongs to SOC-3.

---

## 6. Clock and Participation

### Persisted clock anchor

The running clock is represented by a persisted real-time anchor plus canonical elapsed
time. The UI renders from that anchor on a lightweight timer. It must not dispatch reducer
actions or write local storage every second.

The anchor allows the clock to continue accurately while the tab is in the background or
the device is locked. Pausing closes active participation intervals at the resulting match
time. Starting the clock opens intervals for every active on-field participant.

### Time precision

Exact milliseconds are authoritative. Live match and match review display `MM:SS`.
Season and career aggregates use rounded whole minutes.

Participation projects these compatibility statistics into `Player.stats`:

- `soc_start`
- `soc_app`
- `soc_min_sec`

Exact milliseconds and open interval anchors remain in the soccer projection. `soc_min_sec`
is an aggregate compatibility cache, not the timing source of truth.

### Corrections

A clock correction is an explicit `clock_adjusted` event and changes the timeline from that
point forward. Earlier event timestamps remain unchanged. Individual historical events may
also be corrected through revisioned event edits.

---

## 7. Match Lifecycle and Direction

### Lifecycle

The projected lifecycle supports:

```text
not_started -> in_progress -> period_break -> in_progress -> ended
```

After the final regulation period, the UI offers extra time when configured or End Match.
Shootout availability and lifecycle status are represented, but shootout kicks are SOC-4.

`match_ended` is a local event in SOC-2. It stops minutes, locks match controls, and does not
finalize or upload a cloud game. A `match_reopened` event returns the match to the break
after its last completed period so corrections or additional play are explicit history.

### Team designation and field direction

Score/event identity remains Tracked Team versus Opponent. Setup separately records whether
the tracked team is Home, Away, or Neutral.

The recorder selects the tracked team's first-period attacking direction. Normal and
extra-time periods alternate automatically. A manual direction-change event can override
the calculated direction. Shootout direction is deferred with shootout capture.

---

## 8. Event Catalog

SOC-2A registers versioned production schemas for:

- `soccer.opening_lineup`
- `soccer.period_started`
- `soccer.period_ended`
- `soccer.clock_started`
- `soccer.clock_paused`
- `soccer.clock_adjusted`
- `soccer.match_rules_changed`
- `soccer.substitution_window`
- `soccer.role_changed`
- `soccer.attacking_direction_changed`
- `soccer.match_roster_added`
- `soccer.participant_resolved`
- `soccer.match_ended`
- `soccer.match_reopened`

Starting a match is one batch mutation containing separate opening-lineup, period-started,
and clock-started events. The entire batch is appended and projected once, or not at all.
Ending a period similarly batches clock pause and period end when needed.

Capture sequence is the primary order for soccer state transitions. Period and elapsed
time remain event metadata and review context; a later clock correction must not reorder
earlier actions.

---

## 9. Semantic Projection and Diagnostics

Envelope/schema validation from SOC-1 runs before the soccer projector. The soccer
projector then validates state-machine semantics, including:

- legal lifecycle and period transitions,
- clock start/pause state,
- known participant references,
- on-field count and goalkeeper invariants,
- role and substitution legality,
- return-substitution and configured limits,
- nonnegative and coherent canonical times,
- match end/reopen rules.

If a historical edit invalidates a later event, all raw events remain preserved. Projection
continues only through the last valid event. The offending event and all later events are
reported as unprojected diagnostics. Dependent controls and finalization are blocked until
the history is repaired.

Projection health is derived and never persisted. The persisted sport projection contains
only deterministic soccer runtime state.

---

## 10. Routing and User Experience

SOC-2 reuses the existing routes with soccer-specific components:

- `/setup`: match information and rules,
- `/players`: Match Roster, then lineup and roles,
- `/game`: live clock, lineup, match controls, and focused history.

Soccer remains unavailable in normal production settings until SOC-6. SOC-2B adds a
development-only Soccer card through the normal sport chooser/dashboard so the standard
route flow can be tested without a separate preview architecture.

The clock receives the prominent Start/Pause control. Clock correction, period end,
direction, and rule changes live in a compact action menu with confirmations for destructive
transitions. No soccer score buttons or legacy soccer stat grid appear in SOC-2.

After `match_ended`, `/game` becomes a read-only review of periods, clock, lineup, minutes,
history, diagnostics, corrections, and reopen. The complete soccer summary is SOC-6.

---

## 11. Persistence and Sync Boundary

The setup, projection, and raw event stream must round-trip through active local storage,
parking, export/import, and hydration. Missing `sportGameState` on legacy saves normalizes
to `null`.

The local dirty fingerprint includes the authoritative setup snapshot and raw events. It
excludes the rebuildable soccer projection and derived diagnostics.

Until SOC-5, any game with sport-owned setup or an initialized event stream is local-only
for automatic cloud sync. It must not enter the legacy aggregate snapshot queue, create a
cloud game, or be marked synced through that path. Source roster ids in soccer setup do not
change this rule. The aggregate sync function also enforces this boundary for direct callers.

---

## 12. Test Plan

### SOC-2A automated coverage

- Rule defaults, resolution, validation, custom periods, extra time, and limits.
- Every soccer event schema accepts valid payloads and rejects malformed payloads.
- Opening lineup and period/clock startup project deterministically.
- Clock anchors, pause/resume, corrections, and exact participation intervals.
- Paired, entry-only, exit-only, multi-change, halftime, return, and limited substitutions.
- Role changes, goalkeeper rules, late arrivals, and anonymous participant resolution.
- Period transitions, direction alternation/override, match end, and reopen.
- Semantic failure stops projection at the last coherent event and reports later events.
- Batch append is atomic and rebuilds once.
- Starts, appearances, and seconds project into player compatibility stats.
- Soccer state and raw events survive hydrate, parking, export, and import.
- Legacy saves normalize without changing basketball behavior.
- Setup-only and event-backed soccer games are excluded from aggregate auto-sync and queue dirtying.

### SOC-2B automated coverage

- Development-only workspace availability is independent of the persisted Soccer toggle.
- Regulation presets, custom segment resizing, and ordered stable segment ids.
- Kickoff records lineup, period start, and clock start as one projected event batch.
- Kickoff rejects invalid goalkeeper lineups without mutating the existing state.
- Soccer resume routing distinguishes match setup, lineup, and started-match stages.

### SOC-2C automated coverage

- Atomic clock pause/period end and next-period/clock start transitions.
- Running and stopped clock corrections with canonical `MM:SS` display behavior.
- Count-down overrun display for per-period clocks.
- Substitution windows, exact participation time, and substitution counts.
- Atomic rejection of invalid goalkeeper role changes.
- Clock start/pause toggling, match end, and explicit reopen.
- Revisioned history corrections that preserve invalid raw events and expose diagnostics.

Manual narrow-mobile, desktop, background/resume, lineup, correction, extra-time, end,
and reopen checks live in `docs/REGRESSION_TESTING.md` section 11d.

---

## 13. Explicit Deferrals

- Shots, goals, assists, score derivation, cards, fouls, saves, and field events: SOC-3/4.
- Opponent lineup management: not planned for the core single-recorder model.
- Shootout kick capture and shootout score: SOC-4.
- Automatic event cloud sync, finalization, and aggregate publication: SOC-5.
- Production sport enablement, full summary, season rules/default settings, and aggregate
  reporting: SOC-6.
- Full-field lineup visualization: SOC-3.
- Minutes by role: future derived analysis.
- Personal and season rule editors: SOC-6.
- Basketball conversion to the shared event model: separate basketball redesign roadmap.

---

## 14. Locked Decisions

The implementation must preserve these reviewed decisions:

1. Setup is snapshot authority; dynamic match state is event authority.
2. A running persisted clock continues through backgrounding and device lock.
3. Defaults are 2x45, count up, 11 players, and no return substitutions.
4. SOC-2 exposes app and game rule layers; personal/season layers wait for SOC-6.
5. Tracked/opponent identity is separate from Home/Away/Neutral designation.
6. Player count is an on-field maximum; short-handed kickoff requires confirmation.
7. Kickoff requires exactly one goalkeeper, including an unknown goalkeeper option.
8. All participants have game roles; bench players may be backup goalkeepers.
9. Role changes are timestamped and preserve future minutes-by-role derivation.
10. Opening lineup is one atomic event.
11. Substitutions support paired, exit-only, and entry-only changes.
12. Disabled return substitutions require an explicit rule override before re-entry.
13. `elapsedMs` is cumulative active playing time, including stoppage and excluding breaks.
14. Count direction and continuous/per-period display are independent settings.
15. Nominal duration never automatically ends a period.
16. Direction alternates by period and supports an explicit manual override event.
17. Extra-time structure is modeled now; shootout kick capture waits for SOC-4.
18. Clock correction is an explicit event.
19. SOC-2C has focused correction history; the complete timeline comes later.
20. Soccer uses the existing setup, players, and game routes.
21. Soccer is development-only until SOC-6.
22. SOC-2 does not model an opponent lineup.
23. Anonymous tracked participants are stable game-local identities.
24. Match Roster separates selected participants from absent roster members.
25. Exact milliseconds are stored; live review uses `MM:SS`; aggregates round minutes.
26. Regulation and extra-time segments are ordered, configurable collections.
27. Kickoff records lineup, period start, and clock start in one batch mutation.
28. Clock corrections apply forward and do not reorder prior events.
29. Opening rules are immutable; mid-match changes are events.
30. `GameState` owns a discriminated `sportGameState` container.
31. Live clock rendering does not write state every second.
32. Starts, appearances, and seconds project into compatibility player stats.
33. Soccer events remain local-only until SOC-5.
34. Cloud rosters are read-only setup sources in SOC-2.
35. Development preview follows the normal sport card and route flow.
36. Live lineup uses On Field/Bench tabs; field placement waits for SOC-3.
37. Start/Pause is prominent; secondary match controls use a compact menu.
38. End Period pauses and completes; the next period starts explicitly.
39. Substitution and window limits are nullable; halftime changes use no window.
40. Invalid later history is preserved and produces an incomplete projection.
41. Projection stops at the last valid event.
42. Late arrivals use match-roster addition events and earn appearances only on entry.
43. Match end is a local event and does not cloud-finalize.
44. Reopen is an explicit event returning to the last completed-period break.
45. One substitution-window event may contain multiple changes.
46. Participant resolution retroactively maps an anonymous identity to a roster player.
47. `/players` is a two-step Match Roster then Lineup/Roles flow.
48. Ended matches remain reviewable on `/game` until SOC-6 adds full summary.
49. SOC-2 has no score controls or legacy soccer stat grid.
50. Delivery is split into SOC-2A domain, SOC-2B setup, and SOC-2C live control PRs.
