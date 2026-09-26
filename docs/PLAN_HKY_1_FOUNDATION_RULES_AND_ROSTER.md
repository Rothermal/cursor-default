# Plan: HKY-1 Hockey Foundation, Rules, and Roster

Execution plan for the first hockey implementation phase defined in
[HKY-0](PLAN_HKY_0_HOCKEY_PRODUCT_MODEL.md). HKY-1 builds the hockey domain behind a
development-only gate. It adds no production UI, no cloud writes, and no migration.

Status: approved for implementation. The owner accepted every HKY-0 §17 recommendation
on 2026-09-26.

---

## 1. Goal

HKY-1 exits when:

- `src/lib/hockey/` owns strict, clone-safe hockey types, rules v1, and built-in profiles,
- hockey roster positions parse as plain codes (C, LW, RW, D, G) and sort in catalog
  order, with custom positions and Unassigned handled per the shared roster rule,
- a hockey setup snapshot (rules, tracked side, participants, starting goalie, opening
  five) is frozen at game start,
- `SportGameState` includes `HockeySportGameState`, registered in
  `src/lib/sportGameState/state.ts`, and hockey event games fail closed out of legacy
  aggregate sync,
- hockey lifecycle and clock events are registered in `src/lib/gameEvents/runtime.ts`
  with a projector that replays periods and the anchored countdown clock,
- a development-only route lets an engineer set up, start, pause, end periods, park, and
  resume a hockey event game locally,
- Soccer, Basketball, and legacy hockey behavior are unchanged, with tests proving it.

Not in HKY-1: rink rendering, shots, faceoffs, penalties, strength, Timeline, Summary,
cloud, settings UI, release stage.

---

## 2. Slices

### HKY-1A Types, rules, profiles (pure)

Files: `src/lib/hockey/types.ts`, `rules.ts`, `profiles.ts`, `settings.ts` (parse only).

- `HockeyMatchRules` v1 (`rulesSchemaVersion: 1`, exact keys, JSON-safe):
  - `regulation: { periods, periodLengthMs }`
  - `clockModel: 'anchored' | 'none'` — the timing discriminator (same values as
    `BasketballClockModel`). It is frozen with the rest of the snapshot and is separate
    from the stop-time/running choice below. See §2.1.
  - `clock`: `{ display: 'count_down' | 'count_up', mode: 'stop_time' | 'running' }` when
    `clockModel` is `anchored`; exactly `null` when it is `none` (the parser rejects any
    other combination)
  - `skatersPerSide` (3..6, default 5), `minimumSkaters` (default 3)
  - `overtime`: `null` (no overtime) or `{ lengthMs, skaters, repeat: boolean, endsPolicy: 'continue_alternation' | 'same_as_last_regulation' }` (sudden death)
    (`endsPolicy` drives OT attacking direction, §2.2; every built-in profile uses
    `continue_alternation`)
  - `shootout`: `null` (no shootout) or `{ rounds, repeatShooters: 'after_all' | 'never' | 'any' }`
  - `tiesAllowed` (when false, the rules must include a shootout or repeating overtime)
  - `penalties: { minorMs, doubleMinorMs, majorMs, misconductMs, releaseMinorOnPowerPlayGoal, coincidentalMinors: 'substitute' | 'play_short' }`
    (read by HKY-3; frozen now so snapshots do not need a v2 immediately)
  - `trapezoid: boolean` (display only)
- Profiles: `usa_hockey_youth` (default), `recreational`, `high_school_us`, `ncaa`,
  `nhl_regular`, `nhl_playoffs`, `custom`. Each is an immutable, versioned record with a
  governing-family label, following `src/lib/baseball/profiles.ts`. Values are tracking
  defaults, not a rulebook transcription.
- Strict parser rejects unknown keys and out-of-range values (fail closed like Soccer and
  Basketball settings); structured diagnostics.
- Settings authority follows Basketball's **personal-or-team** model
  (`resolveBasketballSettingsHierarchy` in `src/lib/basketball/settings.ts`), not Soccer's
  four-layer chain: a team game resolves `built-in profile -> team settings -> match
  overrides`; a personal (no-team) game resolves `built-in profile -> personal settings ->
  match overrides`. A recorder's personal defaults never leak into a team game, so two
  recorders on the same team get identical rules. Source metadata labels each field.
  Only parsing/resolution in HKY-1; storage and CAS writes come in HKY-5C. Neither
  existing sport's resolver changes.

Tests: parse/serialize round-trip, unknown-key rejection, every profile valid,
`clockModel`/`clock` combination rejection, personal-authority and team-authority
resolution with source labels, two recorders with different personal settings resolving
identical rules for the same team, clone safety.

### HKY-1B Roster positions, defaults, setup snapshot

Files: `src/lib/hockey/positions.ts`, `lineupDefaults.ts`, `setup.ts`.

- Position catalog `C | LW | RW | D | G`, stored as plain codes in
  `team_players.position` (HKY-0 §5). Standard codes normalize to upper case; custom text
  is preserved and sorted after standard positions; blank values read as Unassigned and
  are never rewritten until an explicit edit.
- Actor order helper `sortHockeyActors`: position order, custom, Unassigned, then jersey
  number, name, and id (shared decision). Candidate to extract as XS-4.
- Team lineup defaults v1 `{ version: 1, starterPlayerIds (max 6), startingGoaliePlayerId, backupGoaliePlayerId }`
  parsed and normalized in memory only (no team settings write until HKY-5C). A goalie
  cannot also be a starter skater; pruning inactive players is an explicit call.
- Setup snapshot v1 (`HockeyMatchSetup`, field names aligned with Baseball's setup):
  - `trackedTeam: 'home' | 'away' | 'neutral'`, `opponentName`, `sourceTeamId`,
    `sourceSeasonId`,
  - `rulesSnapshot` (complete resolved `HockeyMatchRules`) plus `rulesSource`
    (per-field source from the resolver),
  - `firstPeriodAttackingDirection: 'left_to_right' | 'right_to_left'` — which end the
    tracked team attacks in period 1, in canonical rink coordinates (§2.2). Home/Away
    does not imply it,
  - `participants[]`: `{ id, playerId | null, displayName, number, position, dressedAs: 'skater' | 'goalie' }`
    (a null `playerId` is a local-only participant; a roster player may be dressed once),
  - `openingLineup`: `{ goalieParticipantId, skaterParticipantIds[] }`; the goalie must be
    dressed as a goalie and exactly `skatersPerSide` distinct skaters must start,
  - `opponentGoalie`: `{ id, label, number }` only.
- `prefillHockeyOpeningLineup` fills the opening lineup from team defaults only; players
  without a default stay on the bench and nothing is inferred from roster order.
- `hockeyTrackedAttackingDirection` implements §2.2.
- Participants are snapshot-owned and immutable, so later roster edits never change a game
  (Soccer S22 lesson). Deselected players are pruned.

Tests: position parsing and ordering, custom and Unassigned handling, snapshot
validation (goalie count, skater count, duplicates, dressed-as consistency), clone safety.

### HKY-1C Sport state, events, projector, dev gate

Files: `src/lib/hockey/state.ts`, `events.ts`, `projector.ts`, `live.ts`, plus
registration in `src/lib/sportGameState/state.ts` and `src/lib/gameEvents/runtime.ts`.

- `HockeySportGameState` `{ sportId: 'hockey', version: 1, setup, projection, preferences }`
  with a strict normalizer registered alongside Basketball and Soccer; fingerprint
  inclusion follows Soccer (preferences such as rink flip stay out of fingerprints).
- Event definitions, all `schemaVersion: 1`, `teamSide` per definition opt-in:
  - `hockey.opening_lineup`
  - `hockey.period_started`, `hockey.period_ended`
  - `hockey.clock_started`, `hockey.clock_paused`, `hockey.clock_set` (reason required)
  - `hockey.match_ended`, `hockey.match_suspended`, `hockey.match_abandoned`,
    `hockey.match_reopened` (reason required)
- Projector replays lifecycle for both clock models (§2.1): period order from rules,
  overtime periods appended only when the rules allow and regulation is tied. For
  anchored games the clock never runs backward and elapsed values are validated against
  anchors (Basketball BKE-6A2 behavior). The projector reads `clockModel` from the frozen
  rules; it never infers the model from whether clock events exist.
- Tracked attacking direction per period is derived from the frozen setup and rules
  (§2.2) and exposed in projection; the display flip lives in preferences only.
- Checked commands in `live.ts` return `{ ok, state } | { ok: false, error }` and append
  atomically through `applyGameEventAppendsAndMutations`.
- Capability: hockey event games (`sportGameState?.sportId === 'hockey'`) never enter
  legacy aggregate sync; legacy hockey games without sport state keep today's path.
- Dev gate: a development-only `/setup` branch for `sport=hockey&events=1` renders a
  minimal setup form and a plain period/clock panel (no rink). Production builds never
  render it; tests assert the gate (same contract as `import.meta.env.DEV` consumers
  listed in the Soccer release hardening).

Tests: projector replay (periods, OT only on tie, clock start/pause/set, expiration),
clockless replay with `elapsedMs: null` on every event, clock commands rejected in
clockless games, clockless period end at any time, anchored early end requires a reason,
both initial attacking directions across three regulation periods and OT under each
`endsPolicy`, checked command rejection cases, park/resume and reload round-trips for
both clock models (direction and canonical coordinates unchanged), fingerprint stability,
sport-state normalizer rejects malformed input, legacy hockey game untouched,
Soccer/Basketball suites unchanged.

### 2.1 Clock models

`clockModel` is chosen at setup (default `anchored` per owner decision Q3), frozen in the
rules snapshot, and cannot change after the game starts in HKY-1. A mid-game switch is
not supported; a recorder who stops running the clock keeps an anchored game paused.

| | `anchored` | `none` (clockless) |
|---|---|---|
| Period start | `hockey.period_started` opens the period paused at elapsed 0 | `hockey.period_started` with `elapsedMs: null` |
| Clock commands | Start, Pause, reasoned Set Clock | Rejected with `clock_unavailable`; never offered in UI |
| Event time | `elapsedMs` from the anchored clock at the command | `elapsedMs: null` on every event; period is the only time context |
| Period end | Appends Pause (if running) + `hockey.period_ended` atomically. At expiration no reason is needed; ending before expiration requires a reason on the event | Manual command at any time; never requires reaching zero |
| Park/reload | Running clock is paused through the shared active-game mutation guard (BKE-6B4) | Nothing to pause |
| Minutes / TOI | Goalie TOI derivable | Goalie TOI and GAA suppressed, labelled unavailable |

### 2.2 Attacking direction

- Authority: `setup.firstPeriodAttackingDirection`. Game setup asks which end the tracked
  team attacks in period 1 (default `left_to_right`; HKY-2 shows it on the rink drawing,
  HKY-1's dev form uses a plain choice).
- Regulation: odd periods use the initial direction, even periods the opposite.
- Overtime: `continue_alternation` keeps alternating by period number (NHL: OT 1 matches
  period 2); `same_as_last_regulation` keeps the period-3 direction for every OT period.
- Shootout: no attacking direction (attempts are not located).
- The display flip is a per-device preference and never changes stored coordinates or
  projected direction. A reasoned correction for a wrongly chosen initial direction is an
  HKY-2 decision, because it depends on how located events store direction.

---

## 2.3 Delivery record

- HKY-1A: `src/lib/hockey/types.ts`, `rules.ts`, `profiles.ts`, `settings.ts`, and
  `hockey.test.ts`. No UI, registration, or migration. Missing personal/team settings
  resolve to the default profile; malformed settings fail closed and name the layer.
- HKY-1B: `positions.ts`, `lineupDefaults.ts`, `setup.ts`, and `setup.test.ts`. Pure
  parsers and helpers only; nothing reads or writes team settings yet.

## 3. Owner-Confirmed Decisions

| Decision | Choice |
|---|---|
| New games event-only at release (HKY-0 Q1) | Confirmed. HKY-1 only adds the dev-gated event path; the legacy path is retired for new games in HKY-6 |
| Clock default (Q3) | `clockModel: 'anchored'` with countdown stop-time; `none` selectable at setup; frozen after start |
| Settings authority | Personal-or-team (Basketball model), per PR #429 review |
| Penalty rule fields frozen in rules v1 | Yes; inert until HKY-3 |
| Lines (Q10) | Not in HKY-1; HKY-2D |

---

## 4. Regression

Add `docs/REGRESSION_HKY_1_FOUNDATION.md` when implementation lands:

- dev gate hidden in production build,
- legacy hockey stat-grid game still starts, parks, resumes, syncs (aggregate),
- hockey event game parks/resumes with clock and period intact across reload,
- Soccer and Basketball Event games unaffected in the same parking manifest,
- `pnpm typecheck`, `pnpm lint`, `pnpm test` green.

---

## 5. Exit

HKY-1 is complete when all three slices merge with tests, the regression record exists,
and AGENTS.md has a short Hockey foundation gotcha entry. HKY-2 planning then starts from
the rink geometry.
