# Plan: BKE-0 Basketball Event Architecture

Architecture audit, basketball event catalog, projection contract, compatibility strategy, and
F13 reconciliation for moving basketball onto the shared `GameEvent` foundation proven by the
soccer program.

Status: Draft for review. Recommendations in §11 are proposals, not settled decisions; §12 lists
what still needs a focused Q&A pass. No basketball code changes belong to BKE-0.

Parent roadmap: [PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md](PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md)

---

## 1. Goal

Give basketball one editable event stream as the source of truth for live actions, deriving player
totals, team totals, score, shot chart, summaries, and season aggregates from that stream — while
preserving the current basketball experience and every historical game.

BKE-0 exits when the event catalog, projection contract, compatibility rules, phase boundaries, and
cloud strategy below are reviewed and approved. Nothing in `src/` or `supabase/migrations/` changes
during BKE-0.

## 2. Boundaries

### Included

- Audit of the shared platform, the soccer-shaped seams, and the current basketball model.
- Proposed basketball event catalog and `BasketballSportGameState` shape.
- Projection contract and equivalence-testing requirement.
- Correction/undo/decrement semantics.
- Historical compatibility and authority rules.
- F13 reconciliation.
- Cloud strategy for BKE-4, including the soccer-gated RPC problem.
- Revised phase boundaries, including the clock as a fast follower.

### Excluded

- Any basketball implementation. BKE-1 through BKE-5 own that.
- Reopening soccer product decisions or touching SOC-6C/6D/6E scope.
- Sharing soccer event payloads with basketball beyond the generic envelope.
- Redesigning basketball visuals because the data model changed.

---

## 3. Architecture Audit

### 3.1 The shared platform is reusable as-is

`src/lib/gameEvents/` is sport-neutral and needs no structural change for basketball:

| Capability | File | Basketball relevance |
|---|---|---|
| Event envelope, actors, period, location, diagnostics | `types.ts` | `elapsedMs` is already `number \| null`; `location` is normalized `0..1`; actors are role-tagged `player \| staff \| team \| unknown` |
| Definitions keyed by `(sportId, eventType)` with sequential migrations and validation | `registry.ts` | Basketball registers beside soccer; duplicate keys throw |
| Projector registry and full deterministic rebuild | `projection.ts` | One pure projector per sport |
| initialize / add / addBatch / update / delete / restore | `mutations.ts` | Revisioned edits and tombstones, atomic full rebuild per accepted mutation |
| Stream normalization, ordering, quarantine | `stream.ts`, `envelope.ts` | Unknown/malformed rows are preserved, not dropped |
| Row serialization and revision-aware upsert | `cloud.ts`, migration `042_game_events.sql` | Table and write RPC are sport-neutral |

Ordering is already what basketball needs: period order, then `elapsedMs` when present, then recorder
capture `sequence`, then event id. A clock-less basketball stream orders correctly on
`(period.order, sequence, id)` with `elapsedMs` left null.

`GameEventProjection` (`gameEvents/types.ts:106-113`) already carries `shotChart: ShotRecord[]` — a
basketball-shaped field that predates any basketball projector. The shot chart is therefore a
projection target with no generic-layer change.

### 3.2 Soccer-shaped seams that must widen first

These are the only blockers to basketball populating `GameState.sportGameState`:

| Seam | Location | Required change |
|---|---|---|
| `SportGameState` is an alias for the soccer state | `src/lib/soccer/types.ts:308` | Becomes a discriminated union over `sportId` |
| `normalizeSportGameState` returns `null` for anything non-soccer | `src/lib/soccer/state.ts:68-99` | Dispatch on `sportId` to a per-sport normalizer |
| `sportGameStateForFingerprint` lives in the soccer module | `src/lib/soccer/state.ts:101-108`, imported at `src/lib/gameSyncFingerprint.ts:3` | Moves to the sport-neutral home |
| Core domain types import from the soccer module | `src/types.ts:6` | Import from the sport-neutral home |
| Registry/projector singletons are composed from soccer only | `src/lib/gameEvents/runtime.ts:6-7` | Compose soccer + basketball definitions and projectors |
| Aggregate sync eligibility hardcodes the sport id | `src/lib/gameSyncFingerprint.ts:32-38` | Becomes capability-based: a game is aggregate-eligible when it has no event stream and no sport-owned setup, regardless of sport |
| Sport workspace availability is a soccer special case | `src/lib/sportAvailability.ts` | Extend when basketball event games become opt-in |

**Recommended first move in BKE-1:** extract `src/lib/sportGameState/` (union type, dispatching
`normalizeSportGameState`, `sportGameStateForFingerprint`) as a pure, behavior-preserving refactor
with no basketball semantics in it. Soccer keeps its own normalizer; only the indirection moves. This
lands independently, is fully covered by existing soccer tests, and unblocks everything after it.

`isSoccerEventCloudSyncEligible` (`gameSyncFingerprint.ts:41-47`) stays soccer-specific; basketball
gets its own predicate in BKE-4 rather than overloading soccer's.

### 3.3 Two constraints the basketball projector inherits

These drive most of the design and are non-negotiable without changing the generic engine:

1. **The projector owns everything the tracker reads.** `rebuildGameEventProjection`
   (`projection.ts:83-98`) replaces `players[].stats`, `opponentScore`, `homeTeamScore`,
   `shotChart`, and `sportGameState`, forces `homeScoreAdjustment: 0`, and **clears `actionLog` to
   `[]`**. Any basketball surface reading `actionLog`, `homeScoreAdjustment`, or `currentPeriod` must
   either be re-sourced from the projection or from the raw stream.
2. **Legacy actions become no-ops.** `gameReducer.ts:120` short-circuits all twelve legacy aggregate
   actions (`ADD_SHOT`, `REMOVE_LAST_SHOT`, `UNDO_LAST_SHOT`, `CLEAR_SHOT_CHART`, `INCREMENT_STAT`,
   `DECREMENT_STAT`, the four score actions, `UNDO`, `SET_PERIOD`) as soon as `eventStream !== null`.
   Court taps and stat-grid taps must dispatch event appends instead.

Stream initialization is also guarded: `initializeGameEventStream` (`mutations.ts:32-64`) refuses when
the sport has no installed projector, when `requiresSportGameState` is set and `sportGameState.sportId`
does not match, or when `hasLegacyAggregateActivity(state)` is true. Basketball's projector sets
`requiresSportGameState: true`, so an event stream can only start from a completed basketball setup on
a game with no aggregate activity.

### 3.4 Current basketball model and its consumers

Meaning is spread across five structures that can drift independently:

| Structure | Holds | Limitation |
|---|---|---|
| `Player.stats` | Individual and team pseudo-player counters | No event identity, actor context, or edit history |
| `ActionLogEntry[]` | Newest-last undo context | One user action can be several rows (`linkedShotId`); not durable across sync |
| `ShotRecord[]` | Located shots | No linked assist/rebound; no arbitrary edit |
| `opponentScore` / `homeTeamScore` / `homeScoreAdjustment` | Scoreboard | Intentionally divergent from scoring stats |
| `game_stats` / `shot_chart` / `stat_corrections` | Cloud projections and post-hoc overrides | Store aggregates, not relationships; corrections apply after aggregation |

Consumers that BKE phases must keep working (each is a regression obligation in §13):

`src/pages/GameTracker.tsx`, `src/components/shot-chart/` (`ShotChartPanel`, `CourtEventPopup`,
`BasketballCourt`, `ShootingSummary`), `src/components/RecentEventsPopup.tsx` +
`src/lib/actionLogLabels.ts`, `src/pages/GameSummary.tsx` + `src/pages/game-summary/`,
`src/lib/shotChartViews.ts`, `src/lib/shotChartReview.ts`, `src/lib/assistCandidates.ts`,
`src/lib/reboundPrompt.ts`, `src/lib/basketballBonus.ts`, `src/lib/teamPlayers.ts`,
`src/lib/teamStatsPeriods.ts`, `src/lib/teamStatsSummary.ts`, `src/lib/playerStatSummaryTables.ts`,
`src/lib/gameScore.ts`, `src/lib/clearShotChart.ts`, `src/lib/rosterAlignment.ts`, the `shot_chart`
mapping in `src/lib/cloudSync.ts`, and `src/lib/legacyFinalStats.ts`.

Two existing details are load-bearing for the catalog:

- **Team pseudo-players.** `__team_home__` / `__team_opp__` (`src/lib/teamPlayers.ts:4-5`) are roster
  entries carrying team stats. They must remain the projection target so team-stat UI is unchanged.
- **Period-scoped stat ids.** `GameTracker.tsx:38-39` derives `${action.id}_p${currentPeriod}` for
  actions flagged `periodScoped` (`team_foul`, `team_to_used`). Under events these ids must derive
  from the event's own period identity, not from a mutable counter.

Basketball also already has named rule presets — `BASKETBALL_PRESETS` in
`src/config/teamStatsDefaults.ts:27-75` (NFHS, NCAA, NBA, FIBA, youth halves, youth quarters) merged
by `resolveTeamStatsConfig`. This is the natural base for the immutable rules snapshot in §4.1 and for
the age-level profiles the clock phase needs.

### 3.5 Cloud reality check

The tables are sport-neutral: `game_events`, `game_participants`, `game_event_stream_checkpoints`,
`game_event_setup_snapshots`, `game_event_conflicts`, `game_event_primary_recorders`,
`game_event_canonical_publications`. The RPC layer is not.

| Gate | Where |
|---|---|
| Binding filters `g.sport_id = 'soccer'` | `043:261,292`, `044:85`, `045:375`, `046:738` |
| Recorder presence, primary history, primary selection | `045:109,155,276` |
| Manage/audit authority, readiness, canonical read, finalize, reopen | `046:58,86,126,281,331,341,518,579` |
| Publication rows pinned by constraint | `046:7` — `sport_id text not null check (sport_id = 'soccer')` |
| Games trigger branches on soccer for reopen and canonical-finalization enforcement | `046:643,654` |
| Conflict preparation and primary checkpoint confirmation | `046:1101,1251` |

`upsert_game_event_revisioned` is sport-neutral on the normal path; it hardcodes soccer only inside
its post-finalization audit branch (`046:876`).

**Decision (approved):** BKE-4 generalizes this layer rather than duplicating it. Add sport-neutral
functions (`bind_event_game`, `finalize_event_game`, `get_event_game_recorders`,
`get_canonical_publication`, `reopen_event_game`, and peers), relax the publication `sport_id`
constraint to an allow-list, make the games trigger consult the event-capable sport list instead of a
literal, and keep every existing `*_soccer_*` function as a thin wrapper that forwards with
`p_sport_id => 'soccer'`. Shipped soccer behavior and client call sites are untouched; a parallel
basketball RPC family would fork roughly two thousand lines of SQL and every later fix.

---

## 4. Target Basketball Model

### 4.1 `BasketballSportGameState`

Mirrors the soccer shape: an immutable setup snapshot plus a rebuildable projection.

```text
BasketballSportGameState
  sportId: 'basketball'
  version: 1
  setup: BasketballMatchSetup      // immutable after tip-off
    version, trackedTeamDesignation, sourceTeamId, sourceSeasonId,
    rulesSnapshot: BasketballMatchRules,
    participants: BasketballMatchParticipant[]
  projection: BasketballMatchProjection   // rebuilt from events, never persisted as truth
  capturePreferences: BasketballCapturePreferences
```

`BasketballMatchRules` snapshots the resolved season rules at setup time — the existing
`BasketballTeamStatsConfig` fields (`periodsPerGame`, `periodLabels`, `bonusThreshold`,
`doubleBonusThreshold`, `hasOneAndOne`, `overtimeLabel`, `overtimeFoulsReset`, `timeoutsPerPeriod`,
`timeoutsPerOvertime`) plus period segment identity and one new field:

```text
clockModel: 'none' | 'anchored'    // 'none' for BKE-1..4; 'anchored' unlocked by BKE-5
```

Snapshotting at setup matches soccer and fixes a real current weakness: today a mid-season change to
`seasons.team_stats_config` retroactively changes how a completed game's bonus banner reads, because
`resolveTeamStatsConfig` re-resolves at render time. For event games, the snapshot is authoritative
and later settings changes never rewrite an existing game.

`BasketballMatchParticipant` reuses soccer's participant idea: a stable match-local `participantId`,
optional `playerId`, display name, number, and initial status. The two team pseudo-players are
represented as participants with a `team` kind so team stats have stable actors.

`BasketballMatchProjection` carries match status, current/started/completed period ids, participant
totals keyed by `participantId`, team totals, period-scoped team fouls and timeouts, bonus status per
period, score, end reason, and result.

### 4.2 Event catalog

Namespaced `basketball.*`, schema version 1. Clock-less at rest, clock-ready by construction.

**Scoring and shooting**

| Event | Payload | Actors |
|---|---|---|
| `basketball.shot` | `value: 1 \| 2 \| 3`, `made: boolean`, `attempt: 'field_goal' \| 'free_throw'`, `zone: ShotZone \| null`, `located: boolean` | `shooter` (required), `assist` (optional), `blocked_by` (optional) |
| `basketball.score_adjustment` | `delta: number` (signed), `reason: string` | `team` |

Envelope `location` carries court coordinates; `teamSide` carries tracked/opponent. Free throws and
unlocated quick actions set `location: null` and `located: false`, and remain statistically
authoritative — exactly the rule SOC-6 settled for soccer's unlocated events.

**Possession and defense**

| Event | Payload | Actors |
|---|---|---|
| `basketball.rebound` | `kind: 'offensive' \| 'defensive'`, `relatedEventId: string \| null` | `rebounder` |
| `basketball.steal` | `relatedEventId: string \| null` | `stealer`, optional `turnover_by` |
| `basketball.block` | `relatedEventId: string \| null` | `blocker` |
| `basketball.turnover` | `kind: 'player' \| 'team'` | `committed_by` |

`relatedEventId` links a rebound to its missed shot, a block to the attempt it denied, and a steal to
the turnover it forced. Links are advisory: a valid stream may omit them, and projection never
requires a link to compute totals.

**Discipline and administration**

| Event | Payload | Actors |
|---|---|---|
| `basketball.foul` | `kind: 'personal' \| 'technical' \| 'flagrant'`, `shooting: boolean`, `countsToTeamTotal: boolean` | `committed_by` (player or team), optional `drawn_by` |
| `basketball.timeout` | `kind: 'full' \| 'short'` | `team` |
| `basketball.period_started` / `basketball.period_ended` | `periodId: string` | — |
| `basketball.match_roster_added` | `participant`, `destination` | — |
| `basketball.participant_resolved` | `participantId`, `playerId`, `displayName`, `number` | — |
| `basketball.match_ended` | `reason: 'completed' \| 'suspended' \| 'abandoned'` | — |
| `basketball.match_reopened` | `reason: string \| null` | — |

**Reserved — defined in the catalog, not implemented until BKE-5**

`basketball.clock_started`, `basketball.clock_paused`, `basketball.clock_adjusted`,
`basketball.stoppage`, `basketball.substitution_window`, `basketball.role_changed`.

Reserving them now costs nothing at the transport layer — `game_events` stores one row per event with
JSONB payload — and guarantees BKE-5 needs no envelope, table, or ordering change. Until BKE-5 they
are unregistered, so a stream containing one quarantines rather than silently mis-projecting.

**Coverage check.** Every stat id in the basketball `SportConfig` (`src/config/sports.ts:17-99`) has a
producing event, with no orphans:

| Stat id(s) | Produced by |
|---|---|
| `ft`, `ft_miss` | `basketball.shot` — `attempt: 'free_throw'`, `value: 1`, `made` |
| `2pt`, `2pt_miss`, `3pt`, `3pt_miss` | `basketball.shot` — `attempt: 'field_goal'`, `value: 2 \| 3`, `made` |
| `oreb`, `dreb` | `basketball.rebound` — `kind` |
| `ast` | `assist` actor on `basketball.shot` |
| `stl` | `basketball.steal` |
| `blk` | `basketball.block` |
| `to` | `basketball.turnover` — `kind: 'player'` |
| `pf` | `basketball.foul` — player actor |
| `min` | Manual stat under `clockModel: 'none'`; interval-derived in BKE-5 |
| `team_foul_pN` | `basketball.foul` — team actor, period from event |
| `team_to_used_pN` | `basketball.timeout` — team actor, period from event |
| `team_tech` | `basketball.foul` — `kind: 'technical'`, team actor |
| `team_turnover` | `basketball.turnover` — `kind: 'team'` |

### 4.3 Linking: actor roles versus separate events

Follow soccer. An **assist is an actor role on the made shot**, not its own event — soccer models
assists as actors on `soccer.shot` governed by the `maxAssistsPerGoal` rule, and basketball's F7 flow
("Made → Assisted by?") produces exactly one user action that today becomes two undo rows. One event
with two actors makes F12's double row disappear and makes F13's "linked assist" durable for free.

A **rebound stays a separate event** with an optional link. Unlike an assist it is a distinct
possession outcome with its own actor, can occur without any preceding tracked shot, and can be team-
attributed. F9's prompt appends a second event linked to the first.

Player totals still land on the same stat ids: an `assist` actor increments `ast`, so no summary,
leaderboard, or career surface changes shape.

### 4.4 Capture preferences

`BasketballCapturePreferences` persists the tracker's sticky selections the way soccer's does —
selected participant, capture side, and the 2PT/3PT override state — so the projector can rebuild
without the UI holding hidden state.

---

## 5. Projection Contract

```text
Basketball GameEvent stream
  -> deterministic basketball projector (pure, no React, no Supabase)
      -> Player.stats for individuals            (2pt, 3pt, ft, *_miss, oreb, dreb, ast, stl, blk, to, pf, min)
      -> Player.stats for team pseudo-players    (team_foul_pN, team_to_used_pN, team_tech, team_turnover)
      -> homeTeamScore / opponentScore
      -> ShotRecord[] for the shot chart
      -> BasketballMatchProjection (periods, bonus status, timeouts, result)
```

Rules:

- Projections are caches. The event stream is the only source of truth; nothing writes a projected
  total back into the stream.
- Period-scoped team ids derive from the event's `period.id`, replacing `${id}_p${currentPeriod}`
  derivation from a mutable counter. The projector emits the same id strings the current UI reads, so
  `basketballBonus.ts`, `teamStatsPeriods.ts`, and the tracker grid need no change.
- `min` remains a manually incremented stat under `clockModel: 'none'`. BKE-5 replaces it with
  interval-derived seconds when `clockModel: 'anchored'`.
- Any unknown, malformed, unmappable, or unsupported event makes the stream incomplete. Incomplete
  streams still display valid events but cannot finalize or publish aggregates — the SOC-1 rule,
  unchanged.
- **Equivalence requirement.** Before any cutover, a fixture suite replays identical action sequences
  through the current reducer and the event projector and asserts equal player stats, team stats,
  score, and shot records. This is the acceptance gate for BKE-1 and BKE-2, not a nice-to-have.

---

## 6. Correction, Undo, and Decrement

- **Undo** tombstones the newest active event (revisioned delete); restore is another revisioned
  mutation. This is the SOC-1 contract and it already works.
- **Decrement buttons** tombstone the newest active event matching that participant and stat id.
  They do not write negative correction events. Rationale: a correction event would double the stream
  for the most common mistake, and the totals would then depend on reading two rows instead of one.
  When no matching active event exists, the button is disabled rather than creating a negative total —
  matching today's `DECREMENT_STAT` guard (`gameReducer.ts:303`).
- **Score corrections** use `basketball.score_adjustment` with a signed delta and required reason,
  replacing `homeScoreAdjustment`. The projector forces `homeScoreAdjustment: 0` anyway
  (`projection.ts:93`), so event games have exactly one adjustment mechanism.
- **F12 Recent events** reads the ordered active stream instead of `actionLog` (which the projector
  clears). Out-of-order removal becomes possible for the first time; whether to expose it in BKE-1 or
  hold it for BKE-3's timeline is an open question (§12).

---

## 7. Historical Compatibility

Authority is per game, decided by one field:

| `eventStream` | Meaning |
|---|---|
| `null` | Legacy aggregate-only. Reads and writes through the current counter/shot-chart/`game_stats` paths, forever. |
| non-null | Events authoritative. Aggregate mutations are no-ops; totals come from projection. |

Hard rules:

- No backfill. Aggregate rows never become synthetic events; timing, ordering, links, and court
  location that were never recorded are not invented.
- No historical score or total changes, silently or otherwise.
- Finalized historical corrections (`stat_corrections`) remain valid for legacy games.
- Parked-game export/import round-trips both formats. An empty initialized stream and a legacy `null`
  stream must produce different sync fingerprints — already true via
  `canonicalGameEventStreamForFingerprint`.
- Event-capable games may project into the existing `game_stats` and `shot_chart` shapes during the
  transition so generic analytics keep working. Whether that dual projection is permanent or removed
  after BKE-4 is an open question (§12).
- One declared source of truth per game at all times. No dual-write where counters and events can
  drift.

---

## 8. F13 Reconciliation

The held F13 design (`PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md`) proposed extending `ShotRecord` with
`sequenceNumber`, `assistPlayerId`, `reboundPlayerId`, `reboundStatId` plus four nullable `shot_chart`
columns. **That data-model proposal is superseded.** The product intent is preserved and delivered by
the event model instead:

| F13 requirement | Event-model answer |
|---|---|
| Durable shot number | Event `sequence` on the envelope; display order from deterministic ordering |
| Shooter, result, value, zone, location | `basketball.shot` payload plus envelope `location` |
| Linked assist | `assist` actor on the same shot event (§4.3) |
| Linked rebound | `basketball.rebound` with `relatedEventId` |
| Editable shooter/result/value/links | `updateGameEvent` revision, full projection rebuild |
| Undo after edit | Revision history; restore is a revisioned mutation |
| Legacy shots show core detail only | Legacy games stay aggregate-only; no guessed links |

No `shot_chart` migration and no `UPDATE_SHOT` reducer action are needed. F13 delivery stays in BKE-3.

---

## 9. Revised Phase Roadmap

| Phase | Purpose | Depends on | Exit condition |
|---|---|---|---|
| BKE-0 | This document | SOC-1 stable | Catalog, contract, compatibility, and cloud strategy approved |
| BKE-1 | Sport-neutral `sportGameState` extraction; basketball setup, rules snapshot, participants; court-originated shots with linked assist/rebound | BKE-0 approved | New court actions round-trip through events; totals, shot views, and undo match the reducer on the equivalence fixtures |
| BKE-2 | Stat grid, score adjustments, team/period stats, fouls, timeouts, remaining actions | BKE-1 | Every new basketball live action has one event-backed source of truth |
| BKE-3 | Editable basketball timeline and event detail; F13 delivery | BKE-2 | Users can review, revise, remove, and restore supported events with projections rebuilt |
| BKE-4 | Generalized sport-neutral cloud RPC layer; basketball event transport, recorder resolution, finalization, correction integration, cutover | BKE-3 stable | New basketball games sync as event-capable records; soccer behavior unchanged; legacy games readable and unchanged |
| BKE-5 | Clock, stoppage profiles, substitutions, on-field intervals | BKE-4 | Opt-in `clockModel: 'anchored'` games derive real minutes and lineup intervals; clock-less games unaffected |

**BKE-5 is the approved fast follower.** It ships after BKE-4 rather than inside BKE-1..3 because
basketball stoppage rules vary sharply by level, and because the transport is payload-agnostic — adding
the reserved event types later needs no table, envelope, or ordering change. Its rules profiles extend
the existing `BASKETBALL_PRESETS` (NFHS / NCAA / NBA / FIBA / youth) the way
`src/lib/soccer/setupRules.ts` layers IFAB / U.S. High School / Custom profiles over soccer rules.
Until BKE-5, `min` stays a manual stat and `elapsedMs` stays null.

Plan filenames:

```text
docs/PLAN_BKE_1_COURT_EVENTS.md
docs/PLAN_BKE_2_COMPLETE_EVENT_CAPTURE.md
docs/PLAN_BKE_3_EVENT_TIMELINE_AND_F13.md
docs/PLAN_BKE_4_EVENT_CLOUD_CUTOVER.md
docs/PLAN_BKE_5_CLOCK_AND_LINEUPS.md
```

---

## 10. Rollout and Gating

- New basketball games opt into the event model; existing and in-progress games never convert
  mid-flight.
- The opt-in is a setting resolved at setup and snapshotted into `BasketballMatchSetup`, so a game's
  authority cannot change after tip-off.
- Rollback is turning the setting off: new games return to the aggregate path. Already-created event
  games keep their streams and stay readable — they are never downgraded to counters.
- The equivalence fixture suite (§5) runs in CI from BKE-1 onward and is the tripwire for projection
  drift.

---

## 11. Recommended Decisions

These answer the eleven questions in roadmap §8. Items marked **approved** were settled in the BKE-0
review; the rest are recommendations open to challenge in the §12 Q&A.

| # | Question | Recommendation |
|---|---|---|
| 1 | Assist: linked event or actor relationship? | Actor role on the made shot (§4.3) |
| 2 | Rebound always separate and optionally linked? | Yes — separate event, optional `relatedEventId` (§4.3) |
| 3 | Opponent-attributed events without an opponent roster? | Team-kind actor on the opponent side; `unknown` actor when neither player nor team is known. Never fabricate opponent participants |
| 4 | Manual score adjustments vs event-derived scoring? | `basketball.score_adjustment` with signed delta and required reason; `homeScoreAdjustment` retires for event games (§6) |
| 5 | Decrement: delete newest matching event or explicit correction? | Tombstone the newest matching active event (§6) |
| 6 | Team pseudo-player stats and period-scoped ids? | Team participants as actors; period-scoped ids derived from event `period.id`, emitting the same id strings the UI reads today (§5) |
| 7 | Match clock and substitutions, or manual minutes? | **Approved:** clock-ready catalog now, clock-less through BKE-4, clock delivered in BKE-5 (§9) |
| 8 | Finalized `stat_corrections` vs event editing? | **Open** — see §12 |
| 9 | Project to `shot_chart`/`game_stats`, or read events directly? | Project during transition; **open** whether dual projection persists after BKE-4 (§12) |
| 10 | Which historical shots can be promoted to events? | None. No backfill (§7) |
| 11 | How is the transition gated and rolled back? | Per-game opt-in snapshotted at setup; equivalence fixtures in CI (§10) |
| — | Cloud RPC strategy | **Approved:** generalize in place, soccer functions become wrappers (§3.5) |

---

## 12. Open Questions for Focused Q&A

1. **Finalized corrections.** Soccer requires reasoned reopen plus republication for any change to a
   final game. Should basketball adopt that and retire `stat_corrections` for event games, or keep
   `stat_corrections` as an overlay on event-derived totals? Adopting reopen is more consistent and
   reuses BKE-4's generalized RPCs; keeping the overlay preserves an existing admin workflow.
2. **Dual projection lifetime.** After BKE-4, do event games keep writing `game_stats` and `shot_chart`
   rows indefinitely for the existing resolved-stat RPCs, or do basketball aggregate readers move to
   canonical publications the way SOC-6C moved soccer? The second is cleaner and much larger.
3. **Out-of-order removal in F12.** Events make it possible immediately. Expose it in BKE-1, or keep
   strict newest-first undo until BKE-3's timeline ships?
4. **Free-throw sequences.** Model each free throw as its own `basketball.shot`, or add a
   `basketball.free_throw_set` grouping event for 1-and-1 and two-shot trips? Per-shot is simpler and
   matches the current `ft` / `ft_miss` counters.
5. **Opponent individual tracking.** Basketball currently tracks opponent scoring as a bare number.
   Should the catalog leave room for opponent participants now, or stay team-only until a phase asks
   for it?
6. **Team-stat participants.** Represent `__team_home__` / `__team_opp__` as real
   `BasketballMatchParticipant` rows, or keep them purely as projection outputs with team-kind actors
   carrying only a side? The first is more uniform; the second changes less.
7. **Setup friction.** Soccer's event flow added a real setup step. How much setup is acceptable
   before a basketball game — is snapshotting resolved season rules plus roster enough, or does the
   current one-tap start need preserving?

---

## 13. Regression Mapping

Every regression requirement in roadmap §9 maps to the phase that must cover it:

| Requirement | Phase |
|---|---|
| Court tap, value override, player switch, assist prompt, rebound prompt, popup stat line | BKE-1 |
| Full stat-grid entry and decrement | BKE-2 |
| Recent-events undo | BKE-1, replaced by BKE-3 |
| Individual, team, and All shot-chart filters | BKE-1 |
| Home/opponent score and manual corrections | BKE-2 |
| Team fouls, timeouts, technicals, turnovers, period controls, bonus indicators | BKE-2 |
| Local parking, import/export, quota, cross-sport resume | BKE-1 |
| Offline tracking and retry | BKE-4 |
| Independent recorder checkout and primary resolution | BKE-4 |
| Cloud Game Summary and all-recorder shot review | BKE-4 |
| Finalized games and stat corrections | BKE-4 (gated on §12 question 1) |
| Legacy aggregate-only and shot-chart games | Every phase |
| Season, career, tournament, team, and player aggregates | BKE-4 (gated on §12 question 2) |
| Mobile court, timeline, popup, and stat-grid ergonomics | BKE-1 and BKE-3 |

Each phase adds its own numbered section to `docs/REGRESSION_TESTING.md`, following the SOC-1..SOC-6B
pattern in §11a-11r.

---

## 14. Non-Goals

- Rewriting basketball during SOC-6.
- Requiring historical games to contain events they never recorded.
- Sharing soccer event payloads with basketball beyond the generic envelope.
- Removing `game_stats`, `shot_chart`, or correction compatibility before every reader has a tested
  replacement.
- Redesigning basketball visuals because the data model changed.
- Implementing held F11 controls without a separate product decision.
- Real-time collaborative editing across recorder streams.

---

## 15. Documentation Handoff

When BKE-1 begins:

- confirm the §12 answers and fold them into this document;
- add `docs/PLAN_BKE_1_COURT_EVENTS.md` with its own focused Q&A;
- update the roadmap phase table if boundaries move;
- keep `README.md`, `AGENTS.md`, `docs/AGENT_CODEBASE_OVERVIEW.md`, and
  `docs/REGRESSION_TESTING.md` synchronized as each phase ships.
