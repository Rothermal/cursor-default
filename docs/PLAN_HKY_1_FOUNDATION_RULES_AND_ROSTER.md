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
- hockey roster positions parse/serialize with the `hockey:` prefix and sort in catalog
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
  - `clock: { display: 'count_down' | 'count_up', mode: 'stop_time' | 'running' }`
  - `skatersPerSide` (3..6, default 5), `minimumSkaters` (default 3)
  - `overtime: { kind: 'none' | 'sudden_death', lengthMs, skaters, repeat: boolean }`
  - `shootout: { enabled, rounds, repeatShooters: 'after_all' | 'never' | 'any' }`
  - `tiesAllowed`
  - `penalties: { minorMs, doubleMinorMs, majorMs, misconductMs, releaseMinorOnPowerPlayGoal, coincidentalMinors: 'substitute' | 'play_short' }`
    (read by HKY-3; frozen now so snapshots do not need a v2 immediately)
  - `trapezoid: boolean` (display only)
- Profiles: `nhl_regular`, `nhl_playoffs`, `ncaa`, `usa_hockey_youth`,
  `high_school_us`, `recreational`. Each is an immutable, source-linked record with
  `profileId` and `profileVersion`, following `src/lib/basketball/profiles.ts`.
- Strict parser rejects unknown keys and out-of-range values (fail closed like Soccer and
  Basketball settings); structured diagnostics.
- Settings resolution `built-in -> personal -> team -> match` with source metadata,
  mirroring `src/lib/soccer/settings.ts`. Only parsing/resolution in HKY-1; storage and
  CAS writes come in HKY-5C.

Tests: parse/serialize round-trip, unknown-key rejection, every profile valid, layered
resolution and source labels, clone safety.

### HKY-1B Roster positions, defaults, setup snapshot

Files: `src/lib/hockey/rosterPosition.ts`, `lineupDefaults.ts`, `setup.ts`.

- Position catalog `center | left_wing | right_wing | defense | goalie`, stored as
  `hockey:<value>` in `team_players.position`. Custom text is preserved and sorted after
  standard positions; null/empty/other sports' values read as Unassigned and are never
  rewritten until an explicit edit.
- Actor order helper: position order, then jersey number, then name, then id, with
  Unassigned after known positions (shared decision). Candidate to extract as XS-4 if the
  Football program needs it at the same time.
- Team lineup defaults v1 `{ version: 1, starterPlayerIds, startingGoaliePlayerId, backupGoaliePlayerId }`
  parsed and normalized in memory only (no team settings write until HKY-5C).
- Setup snapshot v1:
  - `trackedTeam: 'home' | 'away' | 'neutral'`, `opponentLabel`,
  - `rules` (complete resolved `HockeyMatchRules`) plus `rulesSource`,
  - `participants[]`: `{ participantId, playerId | null, kind: 'player' | 'anonymous', jersey, name, dressedAs: 'skater' | 'goalie', position }`,
  - `openingLineup`: `{ goalieParticipantId, skaterParticipantIds[] }`, validated
    against `skatersPerSide`; goalie required unless the profile allows starting without
    (not in any built-in),
  - `opponent`: `{ goalieLabel }` only.
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
- Projector replays lifecycle and the anchored countdown clock: period order from rules,
  overtime periods appended only when the rules allow and regulation is tied,
  period ends at zero, clock never runs backward, elapsed values validated against anchors
  (Basketball BKE-6A2 behavior). Clockless games carry `elapsedMs: null` and remain valid.
- Tracked team attacking direction per period derived from rules (alternates every
  period) and stored in projection; display flip lives in preferences.
- Checked commands in `live.ts` return `{ ok, state } | { ok: false, error }` and append
  atomically through `applyGameEventAppendsAndMutations`.
- Capability: hockey event games (`sportGameState?.sportId === 'hockey'`) never enter
  legacy aggregate sync; legacy hockey games without sport state keep today's path.
- Dev gate: a development-only `/setup` branch for `sport=hockey&events=1` renders a
  minimal setup form and a plain period/clock panel (no rink). Production builds never
  render it; tests assert the gate (same contract as `import.meta.env.DEV` consumers
  listed in the Soccer release hardening).

Tests: projector replay (periods, OT only on tie, clock start/pause/set, expiration),
checked command rejection cases, park/resume round-trip, fingerprint stability,
sport-state normalizer rejects malformed input, legacy hockey game untouched,
Soccer/Basketball suites unchanged.

---

## 3. Owner-Confirmed Decisions

| Decision | Choice |
|---|---|
| New games event-only at release (HKY-0 Q1) | Confirmed. HKY-1 only adds the dev-gated event path; the legacy path is retired for new games in HKY-6 |
| Clock default (Q3) | Anchored countdown stop-time, clockless allowed |
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
