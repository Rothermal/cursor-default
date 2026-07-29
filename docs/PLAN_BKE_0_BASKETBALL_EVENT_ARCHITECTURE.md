# Plan: BKE-0 Basketball Event Architecture

Architecture audit, basketball event catalog, projection contract, compatibility strategy, and
F13 reconciliation for moving basketball onto the shared `GameEvent` foundation proven by the
soccer program.

Status: Draft, revision 5 — updated against the completed SOC-6 summary, canonical aggregate,
settings, and release program. **Every** recommendation in §11 remains a proposal pending BKE-0
approval. §12 now requires a focused Basketball product-model Q&A before the event catalog is
frozen; the current basketball counter grid is a compatibility baseline, not a complete product
definition. No basketball code changes belong to BKE-0.

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
- Linked-event integrity rules and the one shared-engine addition basketball needs (§6.2).
- Cloud strategy for BKE-4, including the soccer-gated RPC problem.
- Summary-source authority, canonical aggregates, settings hierarchy, and release-capability
  lessons from SOC-6.
- Revised phase boundaries, including BKE-1A-1C and BKE-4A-4E splits plus the clock as a fast
  follower.
- Rollout gating, including why event games stay internal until BKE-5.

### Excluded

- Any basketball implementation. BKE-1 through BKE-6 own that.
- Reopening soccer product decisions or changing shipped SOC-6 behavior.
- Sharing soccer event payloads with basketball beyond the generic envelope.
- Redesigning basketball visuals because the data model changed.

---

## 3. Architecture Audit

### 3.1 The shared platform is reusable with one addition

`src/lib/gameEvents/` is sport-neutral and needs no change to its envelope, storage, ordering, or
projection model for basketball. It needs exactly one capability added — an atomic multi-event
mutation for edits that touch a linked pair (§6.2) — which is sport-neutral and equally useful to
soccer:

| Capability | File | Basketball relevance |
|---|---|---|
| Event envelope, actors, period, location, diagnostics | `types.ts` | `elapsedMs` is already `number \| null`; `location` is normalized `0..1`; actors are role-tagged `player \| staff \| team \| unknown` |
| Definitions keyed by `(sportId, eventType)` with sequential migrations and validation | `registry.ts` | Basketball registers beside soccer; duplicate keys throw |
| Projector registry and full deterministic rebuild | `projection.ts` | One pure projector per sport |
| initialize / add / addBatch / update / delete / restore | `mutations.ts` | Revisioned edits and tombstones, atomic full rebuild per accepted mutation. **Batch is append-only**: update/delete/restore are one event each (`mutations.ts:154-210`) — see §6.2 |
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

**Recommended first move in BKE-1A:** extract `src/lib/sportGameState/` (union type, dispatching
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

   This gate is all-or-nothing: it is not scoped to the actions a given phase has replaced. The
   moment BKE-1B initializes a stream, the full stat grid, both score controls, the period control,
   clear, and undo stop responding — even though BKE-2 is what replaces them and BKE-4 is what makes
   the game syncable. **An event game is therefore only as complete as the last shipped phase, which
   is why event-game creation stays behind an internal gate until BKE-5** (§10). No user-visible
   opt-in may land while a created game would be partially capturable or local-only.

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

SOC-6 added two more reusable boundaries that the earlier BKE draft did not include:

- migration 047's RLS-scoped canonical-publication aggregate transport and client-side cooperative
  projection; and
- migration 049's exact-version backend capability handshake and separation of new-game
  availability from existing-record access.

**Recommendation (pending BKE-0 approval):** BKE-4 generalizes this layer rather than duplicating it.
Add sport-neutral functions (`bind_event_game`, `finalize_event_game`,
`get_event_game_recorders`, `get_canonical_publication`, `reopen_event_game`, and peers), relax the
publication `sport_id` constraint to an allow-list, make the games trigger consult the
event-capable sport list instead of a literal, and keep every existing `*_soccer_*` function as a
thin wrapper that forwards with `p_sport_id => 'soccer'`. Shipped soccer behavior and client call
sites remain untouched; a parallel basketball RPC family would fork roughly two thousand lines of
SQL and every later fix.

The generalized backend also exposes a versioned event-platform capability contract. Basketball is
already a released sport, so this contract does **not** hide Basketball or gate historical access.
It controls only whether a client may create a new event-backed Basketball game against the current
backend. Older backends may offer an explicit legacy-game path; newer incompatible backends request
a client update; offline local-only behavior is an explicit user choice. No fallback silently changes
the requested authority model.

### 3.6 SOC-6 presentation, settings, and release lessons

The event transport is only part of the completed Soccer standard. Basketball must also reuse these
proved contracts:

1. **Explicit summary authority.** Summary loads one discriminated source:
   `local | cloud_primary | cloud_recording | canonical`. A retained local copy of a cloud-final
   game is never final authority, alternate recorder streams never blend, and canonical finals fail
   closed when their active publication is missing or unhealthy.
2. **Source-aware editing.** Only an editable owned local binding exposes mutation controls. Remote
   primary, alternate recorder, and canonical sources are read-only; opening an owned remote stream
   for edits first resumes or restores its local binding.
3. **Diagnostic suppression.** An incomplete projection may retain last coherent context and raw
   inspection data, but cannot present official totals, leaders, finalization, or aggregate output.
4. **Canonical aggregate reads.** Cross-game Basketball totals eventually rebuild authorized active
   canonical publications in TypeScript. They do not treat client-authored `game_stats` rows as a
   second authority.
5. **Layered settings.** Built-in, personal, team, and match overrides resolve deterministically
   with source metadata; the complete match snapshot becomes immutable at game start. Display and
   capture preferences remain separate from match rules.
6. **Release and history are separate.** One centralized policy controls creation of new
   event-backed games. Disabling or rolling back that creation path never hides, rewrites, or blocks
   recovery of existing local, cloud, or canonical event games.

These are architecture requirements, not optional UI polish. BKE-4 through BKE-6 carry their mechanics,
and every earlier phase must shape its types so those mechanics do not require another authority
rewrite.

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

`BasketballMatchRules` snapshots the resolved rules at setup time — initially the existing
`BasketballTeamStatsConfig` fields (`periodsPerGame`, `periodLabels`, `bonusThreshold`,
`doubleBonusThreshold`, `hasOneAndOne`, `overtimeLabel`, `overtimeFoulsReset`, `timeoutsPerPeriod`,
`timeoutsPerOvertime`) plus period segment identity and one new field:

```text
clockModel: 'none' | 'anchored'    // 'none' for BKE-1..5; 'anchored' unlocked by BKE-6
```

Snapshotting at setup matches soccer and addresses a real current weakness: today a mid-season change
to `seasons.team_stats_config` retroactively changes how a completed game's bonus banner reads,
because `resolveTeamStatsConfig` re-resolves at render time.

**Scope of that fix:** it applies to **new event games only**. Legacy aggregate games have no setup
snapshot, keep re-resolving through `resolveTeamStatsConfig`, and retain their current retroactive
behavior. Nothing in the BKE program changes how an existing finished game reads its bonus banner;
fixing that for legacy games would need a separate backfill decision, which §7's no-backfill rule
currently forbids.

BKE-5 moves resolution onto the generic sport-settings foundation proven by SOC-6D:

```text
built-in profile -> personal defaults -> team defaults -> explicit match overrides
                 -> complete immutable BasketballMatchRules snapshot
```

The BKE-1B setup type must be able to retain source metadata and a complete snapshot even though the
account-backed settings UI arrives later. Capture/display preferences such as rebound prompting,
selected participant, court orientation, and shot-value override are not match rules and never
change projection or canonical publication.

`BasketballMatchParticipant` reuses soccer's participant idea: a stable match-local `participantId`,
optional resolved `playerId`, display name, number, initial status, and — unlike soccer —

```text
teamSide: 'tracked' | 'opponent'    // required; part of stable match identity
```

**The participant roster holds players only.** The two team pseudo-players are *not* participant rows
— see §4.5.

Setup snapshots the opening participant registry. Active `basketball.match_roster_added` events may
extend that registry later without mutating setup, and `basketball.participant_resolved` may attach a
stable cloud `playerId` to the same match-local `participantId`. Historical events continue to use
`participantId`; later resolution never requires rewriting their actor payloads.

**Why participants carry a side and soccer's do not.** `GameEventActor` has no side field; only the
envelope does (`gameEvents/types.ts:12-33`). Soccer gets away with that because its roster is
tracked-team-only, so `validateActorSide` (`soccer/projector.ts:849-876`) can treat "has a
`participantId`" as "is on the tracked side" and require opponent actors to be label/`unknown`/team
rows with no participant. Basketball intends to allow opponent participants (§12b q3), which breaks
that inference immediately: a shot plus linked assist could reference actors from either roster and
nothing would say which is wrong. Making the side part of participant identity
keeps §4.5's same-side and opposite-side rules deterministic, and lets a future opponent roster land
without re-deriving every existing event's attribution.

`BasketballMatchProjection` carries match status, current/started/completed period ids, participant
totals keyed by `participantId`, team totals, period-scoped team fouls and timeouts, bonus status per
period, score, end reason, and result.

### 4.2 Event catalog

Namespaced `basketball.*`, schema version 1. Clock-less at rest, clock-ready by construction.

**Catalog status:** the events below are the architecture baseline needed to preserve today's
Basketball behavior. They are not frozen until the §12 product-model Q&A reviews the desired
Basketball statistics, rule levels, foul/free-throw model, staff discipline, possession state,
timeouts, periods/overtime, and lineup expectations. New answers may enrich payloads or add event
families; they may not introduce a second aggregate authority.

**Scoring and shooting**

| Event | Payload | Actors |
|---|---|---|
| `basketball.shot` | `value: 1 \| 2 \| 3`, `made: boolean`, `attempt: 'field_goal' \| 'free_throw'`, `zone: ShotZone \| null` | `shooter` (required) |
| `basketball.assist` | `relatedEventId: string \| null` | `assister` |
| `basketball.score_adjustment` | `delta: number` (signed), `reason: 'scoreboard_control' \| 'unattributed_score' \| 'official_correction'`, `note: string \| null` | `team` |

Envelope `location` carries court coordinates; `teamSide` carries tracked/opponent. Free throws and
unlocated quick actions set `location: null`, and remain statistically authoritative — exactly the
rule SOC-6 settled for soccer's unlocated events.

There is **no `located` boolean**. "Located" is `location !== null`, derived wherever it is needed;
storing both invites a stream where they disagree and forces every reader to pick a winner. §4.5
gives the full validation contract.

There is **no `assist` or `blocked_by` actor on the shot**. Both are separate events with optional
links, and each relationship has exactly one owner. This differs intentionally from Soccer's
goal/assist actor model because Basketball must preserve direct stat-grid `ast` entry when no made
shot has been recorded. Court capture appends the shot and linked assist atomically; direct grid
capture appends an unlinked assist. A block likewise remains valid when the denied attempt was not
tracked and survives correction of that attempt.

**Possession and defense**

| Event | Payload | Actors |
|---|---|---|
| `basketball.rebound` | `kind: 'offensive' \| 'defensive'`, `relatedEventId: string \| null` | `rebounder` |
| `basketball.steal` | `relatedEventId: string \| null` | `stealer`, optional `turnover_by` |
| `basketball.block` | `relatedEventId: string \| null` | `blocker` |
| `basketball.turnover` | `kind: 'player' \| 'team'` | `committed_by` |

`relatedEventId` links an assist to its made shot, a rebound to its missed shot, a block to the
attempt it denied, and a steal to the turnover it forced. Links are advisory for *totals*: a valid
stream may omit them, and projection never requires a link to compute a stat. They are not advisory
for *integrity* — a link that exists must be valid, and §6.2 defines what happens when an edit would
invalidate one.

The `turnover_by` actor on `basketball.steal` and its `relatedEventId` are **mutually exclusive**, for
the same reason the shot has no `blocked_by`: when the turnover is its own event, that event owns who
committed it; the actor exists only for the common case where the opponent's turnover is not tracked
as an event of its own. Validation rejects a steal carrying both.

**Discipline and administration**

| Event | Payload | Actors |
|---|---|---|
| `basketball.foul` | provisional foul classification, shooting context, and `countsToTeamTotal` | `committed_by` (player, staff, or team), optional `drawn_by` |
| `basketball.timeout` | `kind: 'full' \| 'short'` | `team` |
| `basketball.minutes_adjustment` | `deltaMinutes: number` (signed, non-zero integer) | `player` (required) |
| `basketball.period_started` / `basketball.period_ended` | `periodId: string` | — |
| `basketball.match_roster_added` | `participant`, `destination` | — |
| `basketball.participant_resolved` | `participantId`, `playerId`, `displayName`, `number` | — |
| `basketball.match_ended` | `reason: 'completed' \| 'suspended' \| 'abandoned'` | — |
| `basketball.match_reopened` | `reason: string \| null` | — |

`basketball.minutes_adjustment` exists because `min` is the one basketball stat with no natural
producing event under `clockModel: 'none'`, and `INCREMENT_STAT` / `DECREMENT_STAT` are no-ops once a
stream exists (§3.3). Without it, minutes silently become unrecordable in an event game. Semantics:

- **Increment** appends `deltaMinutes: +1`.
- **Decrement** appends `deltaMinutes: -1` whenever the participant's projected minutes are ≥ 1, and
  is disabled otherwise. It does **not** tombstone the newest adjustment: `deltaMinutes` is any
  signed non-zero integer, so tombstoning a `+5` would drop five minutes for one tap and tombstoning
  a newest `-1` would *raise* the total. Appending is the only rule that is correct for every valid
  history, including edited and negative ones.
- **Edit** revises `deltaMinutes` on an existing event rather than appending a compensating one.
- **Undo** (F12, newest-first) still tombstones the newest adjustment — that is undoing a specific
  recorded action, not arithmetic on a total, and it is correct precisely because it targets an event
  the user just created.
- Every add and update validates that the participant's resulting total stays **non-negative**.
- `min` projects as the sum of active `deltaMinutes` for the participant, **not floored**. A negative
  sum is only reachable through a tombstone or a merged multi-recorder stream that validation never
  saw; flooring it at 0 would hide that. A negative total therefore makes the stream **incomplete**
  under §5's rule — displayable, diagnosable, not finalizable until repaired.
- The event is deliberately narrow — one stat, one signed integer — rather than a general
  `manual_stat` escape hatch, so no stat that *does* have a producing event can be written twice.

**BKE-6 interaction.** When `clockModel: 'anchored'`, `min` is interval-derived and
`basketball.minutes_adjustment` events are ignored by the projector (retained in the stream, shown as
inert in the timeline, never silently deleted). Games snapshotted at `clockModel: 'none'` keep
adjustment-derived minutes forever — BKE-6 changes no historical game's totals.

**Reserved — defined in the catalog, not implemented until BKE-6**

`basketball.clock_started`, `basketball.clock_paused`, `basketball.clock_adjusted`,
`basketball.stoppage`, `basketball.substitution_window`, `basketball.role_changed`.

Reserving them now costs nothing at the transport layer — `game_events` stores one row per event with
JSONB payload — and guarantees BKE-6 needs no envelope, table, or ordering change. Until BKE-6 they
are unregistered, so a stream containing one quarantines rather than silently mis-projecting.

**Coverage check.** Every stat id in the basketball `SportConfig` (`src/config/sports.ts:17-99`) has a
producing event, with no orphans:

| Stat id(s) | Produced by |
|---|---|
| `ft`, `ft_miss` | `basketball.shot` — `attempt: 'free_throw'`, `value: 1`, `made` |
| `2pt`, `2pt_miss`, `3pt`, `3pt_miss` | `basketball.shot` — `attempt: 'field_goal'`, `value: 2 \| 3`, `made` |
| `oreb`, `dreb` | `basketball.rebound` — `kind` |
| `ast` | `basketball.assist`, linked or unlinked |
| `stl` | `basketball.steal` |
| `blk` | `basketball.block` — sole representation; no `blocked_by` actor exists |
| `to` | `basketball.turnover` — `kind: 'player'` |
| `pf` | `basketball.foul` — player actor |
| `min` | `basketball.minutes_adjustment` under `clockModel: 'none'`; interval-derived in BKE-6 |
| `team_foul_pN` | `basketball.foul` — team actor, period from event |
| `team_to_used_pN` | `basketball.timeout` — team actor, period from event |
| `team_tech` | `basketball.foul` — `kind: 'technical'`, team actor |
| `team_turnover` | `basketball.turnover` — `kind: 'team'` |

### 4.3 Linking: separate facts with optional relationships

An **assist is a separate event** with an optional made-shot link. Soccer's actor-on-goal model is
not copied blindly: Basketball's full stat grid already records assists independently, and BKE-2
must not make that action impossible or fabricate a shot. F7's "Made → Assisted by?" flow appends
the shot and assist in one atomic command, with the assist pointing to the shot. The Timeline may
present that linked pair as one play while preserving two editable facts.

A **rebound also stays separate** with an optional missed-shot link. It is a distinct possession
outcome, can occur without any preceding tracked shot, and can be team-attributed. F9's prompt
appends a second event linked to the first.

Player totals still land on the same stat ids, so no summary, leaderboard, or career surface changes
shape. The relationship improves detail and correction behavior without becoming a prerequisite for
counting either stat.

### 4.4 Capture preferences

`BasketballCapturePreferences` persists the tracker's sticky selections the way soccer's does —
selected participant, capture side, and the 2PT/3PT override state — so a tracker session resumes
where it left off after a page reload or a local park/unpark. They are **not** a device-handoff
mechanism: because they are excluded from sync and publication (below), a second device initializes
its own preferences from its own defaults.

**They are resumable UI state, not projection truth.** Precisely:

- The projector never reads them. A rebuild from events alone produces identical stats, score, shot
  records, and `BasketballMatchProjection` regardless of what the preferences hold. (The earlier
  wording — "so the projector can rebuild without the UI holding hidden state" — overstated this;
  what they prevent is UI state lost on reload, not projection ambiguity.)
- They are **excluded from the sync fingerprint**, following soccer exactly:
  `sportGameStateForFingerprint` (`src/lib/soccer/state.ts:101-108`) already returns only
  `{ sportId, version, setup }`. Changing the selected player or capture side therefore does not
  dirty cloud sync or trigger a re-upload.
- They are **excluded from canonical publication and final aggregate semantics**. Two recorders with
  different capture preferences are not in conflict, and a published game's payload never contains
  them.
- They ride along in the parked-game blob and in `sportGameState` for resume only, and are normalized
  defensively (unknown values fall back to defaults) the way `normalizeSportGameState` does today.

### 4.5 Team actors, participants, and the validation contract

**Team pseudo-players are actors, not participants.** `__team_home__` / `__team_opp__` remain
projection targets — the team-stat UI is unchanged — but they do not appear in
`BasketballMatchSetup.participants`. Team-attributed events use a `team`-kind actor, and the projector
maps `(team actor, envelope teamSide)` to the corresponding pseudo-player row.

A `team`-kind actor is a `GameEventLabelActor`, which **requires a `label`** and has no `playerId`
(`gameEvents/types.ts:28-33`); it carries no `participantId`. So the actor supplies role, kind, and
label, and the *envelope's* `teamSide` supplies the side — no actor-type change is proposed or
needed. Basketball populates `label` from the snapshotted team designation so a published stream is
readable without resolving the roster. Rationale for keeping them out of the roster:
the participant roster is the input to every future player, lineup, and minutes surface, and seeding
it with two non-players contaminates all of them. This replaces the contradictory wording that
previously appeared in §4.1 and §12, and is stated here once as a single proposal **pending BKE-0
approval** — it is no longer carried as an open question in §12b.

**Staff are labeled actors, not player participants.** A coach or bench technical can use a
`staff`-kind actor with a durable label even when that person is not represented in the tracked
roster. §12 decides whether a future staff setup roster is useful, but the event envelope must not
force a coach's discipline onto a player or anonymous team actor.

**Where validation lives.** `GameEventDefinition.validate` (`gameEvents/registry.ts:8-15`) receives
one event and nothing else, so it can enforce payload shape, actor roles, and envelope agreement —
but it *cannot* see the rest of the stream, and therefore cannot validate a `relatedEventId`. Link
rules are enforced in the basketball command layer at capture/edit time, and re-checked by the
projector, which downgrades rather than rejects (see "stale links" below).

**Per-event validation** (registry, single-event):

| Rule | Applies to |
|---|---|
| `attempt: 'free_throw'` requires `value === 1`, `location === null`, `zone === null` | `basketball.shot` |
| `attempt: 'field_goal'` requires `value === 2 \| 3` | `basketball.shot` |
| `zone !== null` requires `location !== null`, and `zone` must be the zone that `location` falls in | `basketball.shot` |
| `value === 3` requires a `zone`/`location` outside the arc when located | `basketball.shot` |
| `deltaMinutes` is a non-zero integer | `basketball.minutes_adjustment` |
| `delta` is a non-zero integer; `reason` is a known code; `official_correction` requires a non-empty `note` | `basketball.score_adjustment` |
| team-attributed events carry a `team` actor (with its required `label`) and no player actor | `foul`, `timeout`, `turnover: 'team'` |

**Actor/side validation** (needs the effective participant registry: setup plus preceding active
roster/resolution events):

| Rule | Applies to |
|---|---|
| A `player` actor must reference an effective participant by stable `participantId`; an actor `playerId`, when present at capture, must match the participant's then-current resolved id | every event with a player actor |
| That participant's `teamSide` must equal the event's envelope `teamSide` | `shooter`, `assister`, `rebounder`, `stealer`, `blocker`, `committed_by`, `player` |
| An actor attributed to a side with no roster uses `team` or `unknown` kind and carries **no** `participantId` | any event on a side without participants |
| A `staff` actor carries a stable label, no player `participantId`, and the event side supplies attribution | staff discipline |
| A participant's `teamSide` is fixed when that participant enters the match registry and never inferred from later events | setup or `match_roster_added` |
| Later `participant_resolved` changes identity resolution only; it does not invalidate an older actor whose `playerId` was null | historical events |

This is basketball's explicit replacement for soccer's implicit "a `participantId` means the tracked
side" convention (`soccer/projector.ts:849-876`), which stops working the moment an opponent roster
can exist (§4.1).

**Relationship validation** (command layer, needs the stream):

| Rule | Applies to |
|---|---|
| An assist link must reference an active made `basketball.shot`; assister and shooter must differ | `basketball.assist` |
| A linked assister must have the **same** `teamSide` as the shot | `basketball.assist` |
| `relatedEventId` must reference an active `basketball.shot` with `made === false` | `basketball.rebound` |
| `kind: 'defensive'` links to an opposite-side missed shot; `kind: 'offensive'` to a same-side one | `basketball.rebound` |
| `relatedEventId` must reference an active, missed, opposite-side `attempt: 'field_goal'` shot | `basketball.block` |
| `relatedEventId` must reference an active `basketball.turnover` on the opposite side, and may not be combined with a `turnover_by` actor | `basketball.steal` |
| Every `relatedEventId` must resolve **within the same game stream** | all linked events |

A link that fails these rules is rejected at capture/edit time. A link that *becomes* invalid later
is handled by the staleness policy in §6.

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
- `min` projects as the summed `deltaMinutes` of active `basketball.minutes_adjustment` events under
  `clockModel: 'none'`. BKE-6 derives it from clock intervals when `clockModel: 'anchored'`, and
  ignores adjustment events in those games only (§4.2).
- **Score semantics intentionally improve.** Event-game score is always made-shot points plus signed
  score-adjustment events. A quick scoreboard `+/-` appends `reason: 'scoreboard_control'` without a
  modal; an explicit official correction requires a note. Unlike today's reducer, the first tracked
  side score-button tap does not freeze an absolute `homeTeamScore` that ignores later player shots.
  Equivalence tests must assert the approved event behavior after score controls rather than claim
  byte-for-byte legacy semantics that the target model intentionally retires.
- **Shot ordinal.** The displayed shot number is the 1-based index of the shot in the ordered list of
  active `basketball.shot` events, derived in the **shot-review projection** and keyed by event id.
  `ShotRecord` is unchanged: it stays `{ id, x, y, made, shotType, zone, playerId, timestamp }`
  (`src/types.ts:11-20`) so the `shot_chart` mapping in `cloudSync.ts` needs no migration and §8's
  "the `ShotRecord` extension is superseded" stays true. The ordinal lives on a separate
  `BasketballShotReviewEntry { eventId, ordinal, … }` type owned by the review/detail layer, never on
  a persisted record. Envelope `sequence` is
  **not** a shot number: it is recorder capture order across every event type, so fouls, rebounds and
  timeouts consume values in between; it is supplied by the caller rather than assigned by the engine
  (`mutations.ts:66-153` validates uniqueness of `id`, not of `sequence`); and independent recorder
  streams each number from their own origin. The ordinal is a display projection that renumbers when
  an earlier shot is removed — if a stable-forever shot label is wanted instead, it needs its own
  immutable payload field and an explicit decision (§12b q5).
- **The ordinal counts every attempt**, not only chart markers: all active `basketball.shot` events,
  including free throws and unlocated field goals. They are one authoritative event family, and a
  chart-only numbering would make the same shot "Shot 8" in the chart and "Shot 12" in a timeline or
  player-detail list. The consequence is deliberate and must be visible in the UI: entering the detail
  view by tapping a chart marker can land on a non-contiguous number, so the detail surface always
  shows attempt type (FG vs FT, located vs not) beside the ordinal. Confirm at approval — §12b q5.
- Capture preferences are never an input (§4.4). Two streams that differ only in preferences project
  identically.
- Any unknown, malformed, unmappable, or unsupported event makes the stream incomplete. Incomplete
  streams still display valid events but cannot finalize or publish aggregates — the SOC-1 rule,
  unchanged.
- **Equivalence and intentional-difference requirement.** Before any cutover, a fixture suite replays
  identical action sequences through the current reducer and the event projector and asserts equal
  player stats, team stats, score, and shot records except for decisions explicitly recorded as
  intentional product improvements. Every exception needs its own fixture and expected result; the
  scoreboard's post-adjustment behavior above is the first such exception. This is the acceptance
  gate for BKE-1B, BKE-1C, and BKE-2, not a nice-to-have.

---

## 6. Correction, Undo, and Decrement

- **Undo** tombstones the newest active event (revisioned delete); restore is another revisioned
  mutation. This is the SOC-1 contract and it already works.
- **Score corrections** use `basketball.score_adjustment` with a signed delta and structured reason,
  replacing `homeScoreAdjustment`. Quick scoreboard taps use the automatic `scoreboard_control`
  reason; an official correction requires a note. The projector forces `homeScoreAdjustment: 0`
  anyway
  (`projection.ts:93`), so event games have exactly one adjustment mechanism.
- **F12 Recent events** reads the ordered active stream instead of `actionLog` (which the projector
  clears). Recommendation: keep strict newest-first removal through BKE-2 and deliver arbitrary
  removal with the BKE-3 timeline, where the consequence of removing a linked event can actually be
  shown (§6.2).

### 6.1 Decrement is a per-stat contract, not one rule

"Tombstone the newest event matching participant + stat" is only correct when the stat has a
**standalone** producing event. Applied blindly it can still delete facts the user did not intend:
decrementing `pf` on a shooting foul removes the team-total contribution with it, and removing a
linked assist changes the detail attached to a made shot even though the shot itself must survive.

| Stat | Producing event | Decrement behavior |
|---|---|---|
| `oreb`, `dreb` | `basketball.rebound` | Tombstone the newest matching active event. Its link to the missed shot dies with it; the shot is untouched. |
| `stl` | `basketball.steal` | Tombstone the newest matching active event. |
| `blk` | `basketball.block` | Tombstone the newest matching active event. |
| `to`, `team_turnover` | `basketball.turnover` | Tombstone the newest matching active event. |
| `min` | `basketball.minutes_adjustment` | Append `deltaMinutes: -1` when projected minutes are ≥ 1; disabled otherwise. Never tombstones, because adjustments carry arbitrary signed values (§4.2). |
| `team_foul_pN`, `team_to_used_pN`, `team_tech` | `basketball.foul` / `basketball.timeout`, team actor | Tombstone the newest matching active event **for that period**, resolved by event `period.id`. |
| `ast` | `basketball.assist` | Tombstone the newest matching assist. A linked shot remains untouched. |
| `2pt`, `3pt`, `ft`, `*_miss` | `basketball.shot` | Tombstone the newest matching shot; in the same atomic mutation tombstone active linked `assist` and `rebound` events and **unlink** (not remove) active linked `block` events (§6.2). The UI states the consequence before applying. |
| `pf` | `basketball.foul`, player actor | Tombstone the foul. Because one foul can project to both the player and the team total, the confirmation names both effects. A foul whose player and team contributions need to diverge is an edit in BKE-3, not a decrement. |

Where no matching active event exists, the control is disabled rather than producing a negative
total — matching today's `DECREMENT_STAT` guard (`gameReducer.ts:299-303`). No decrement path ever
writes a negative correction event; the compensating `basketball.minutes_adjustment` is the single
exception and exists only because minutes have no other producing event.

Until BKE-3 ships the detail editor, any decrement whose contract row says "revise" or names a
multi-event consequence is available only where the corresponding capture flow already exists — BKE-2
must not ship a stat-grid button that silently does the wrong thing.

### 6.2 Linked-event integrity and multi-event mutations

`updateGameEvent`, `deleteGameEvent`, and `restoreGameEvent` (`gameEvents/mutations.ts:154-210`) each
revise exactly one event; only `addGameEvents` is a batch. F13-class edits break that assumption — a
made shot becoming a miss, a shooter changing side, or a shot being removed can each invalidate an
assist, rebound, or block that points at it.

**Required platform addition — lands in BKE-1A:** a validated atomic multi-event mutation,
`applyGameEventMutations(state, [{ update | delete | restore }...])`, that validates every member,
applies all or none, and rebuilds the projection once. Without it, "remove this shot and its rebound"
is two mutations with a visible invalid state between them, and a failure halfway leaves the stream
inconsistent. This is a sport-neutral change, benefits soccer's timeline equally, and is the only
engine change the BKE program requires.

It lands in **BKE-1A**, before BKE-1C can produce a multi-event correction: clear-chart (§6.3)
tombstones many shots plus their dependents in one command, and undoing a shot that already has a
linked rebound needs the same atomicity. BKE-3 then builds the detail editor on an engine capability
that is already proven, rather than introducing both at once.

**Stale-link policy.** Links stay advisory for projection — totals never require one — but staleness
is resolved, not ignored:

| Situation | Resolution |
|---|---|
| Linked shot is tombstoned | Linked `assist` and `rebound` events are tombstoned in the same atomic mutation after confirmation. A linked `block` is **unlinked, not removed** and survives as a standalone defensive stat |
| Linked shot is edited so the link becomes invalid (made ⇄ missed, side or shooter change) | The dependent event's `relatedEventId` is cleared to `null` in the same atomic mutation; assist/rebound/block totals survive as standalone stats, and the Timeline flags them as unlinked for review |
| Link points at a missing or already-tombstoned event on load | Projector treats it as `null`, records a diagnostic, and **does not** mark the stream incomplete — a dangling advisory link is not a projection failure |
| Link points outside the game stream | Rejected at capture/edit time (§4.5); if present on load it is treated as dangling |

**Why linked assists/rebounds and blocks part company on removal.** Today's
`clearEntireShotChart` reverses linked `ast`, `oreb`, and `dreb`, so removing a captured shot and its
same-flow dependent facts preserves current behavior. A block is the defending player's own stat,
recorded from the other side, valid whether or not the attempt it denied was ever tracked. Removing
it because the shooter's team corrected a shot would delete an opponent stat as a side effect.
Editing rather than removing a shot is less destructive: all three dependent event types survive
unlinked, and the user may explicitly remove or re-link them in BKE-3.

**Restore symmetry.** Grouped delete requires grouped undo, or the two operations disagree:

- **Immediate undo** of a grouped removal (F12, or the command's own undo affordance) restores the
  whole group in one atomic mutation. The command layer knows the exact ids it just tombstoned.
- **Later restore** from the BKE-3 timeline restores the selected shot, then offers to restore every
  tombstoned dependent that still points at it — tombstoned assists and rebounds retain their `relatedEventId`,
  so the group is recoverable from the stream itself with no group-id column and no engine change.
  Dependents the user declines stay tombstoned, and the restored shot keeps no dangling reference to
  them.
- A dependent that was **unlinked** rather than tombstoned (blocks, and any link cleared by an edit)
  is not re-linked automatically on restore. Re-linking is an explicit edit, because the projector
  cannot know the user still means the same relationship.

Retaining a knowingly-invalid link is never an option: it would let the timeline assert a
relationship the data no longer supports.

### 6.3 Clear Shot Chart

`clearEntireShotChart` (`src/lib/clearShotChart.ts`) today removes every `ShotRecord`, reverses the
shot's own stat, and reverses linked `ast`/`oreb`/`dreb` increments via `linkedShotId` — even when
unrelated actions trail them in the log. Under events this is a multi-event correction, not clearing a
projection: the projection has no independent existence to clear.

**Its scope today is narrower than "every shot," and the event command must match.** The command
starts from `state.shotChart`, and `ShotRecord` (`src/types.ts:11-20`) requires `x`, `y`, `zone`, and
`shotType: '2pt' | '3pt'`. A free throw and an unlocated quick-entry basket therefore **cannot** be
in `shotChart` at all, and clearing the chart has never touched them. Tombstoning every active
`basketball.shot` would silently erase free-throw and unlocated scoring stats that the current button
leaves alone — a real regression, not a modelling detail.

**Recommendation: retain the command, scoped to what the chart actually contains.** One atomic
mutation (§6.2) that tombstones:

**Removed:**

- Active `basketball.shot` events with `attempt: 'field_goal'` **and** `location !== null` — exactly
  the events that project into `ShotRecord[]`.
- Their linked active `basketball.assist` events, matching today's linked `ast` reversal.
- Their linked active `basketball.rebound` events, matching today's `oreb` / `dreb` reversal.

**Preserved:**

- Free throws (`attempt: 'free_throw'`) — never in the chart, so never cleared.
- Unlocated field goals — likewise never in the chart.
- Linked `basketball.block` events, which are unlinked rather than removed (§6.2). Today's linked-stat
  set is `['ast', 'oreb', 'dreb']` (`clearShotChart.ts:14`) and contains no block.
- `steal`, `turnover`, `foul`, `timeout`, `score_adjustment`, and `minutes_adjustment` events.

The confirmation states the full consequence count, for example: "removes 24 chart shots, 8 linked
assists, and 9 linked rebounds."

**Equivalence fixture requirement.** The BKE-1C fixture suite (§5) must include a game containing made
and missed free throws and at least one unlocated field goal alongside charted shots. "Everything
preserved is byte-identical" would be the wrong assertion: a located and an unlocated field goal share
the same `2pt` / `3pt` / `*_miss` stat ids, so clearing the charted attempts *must* move those
combined counters. The fixture asserts three separable things:

| Assertion | Scope |
|---|---|
| Event envelopes and revisions of the preserved free-throw and unlocated events are **byte-identical** before and after | The stream |
| `ft` / `ft_miss` totals are **unchanged** | Stat ids the cleared events cannot contribute to |
| `2pt` / `3pt` / `*_miss` totals and score decrease by **exactly** the removed charted attempts' contribution, leaving the unlocated attempts' contribution intact | Stat ids shared between charted and non-charted shots |

The row assertion and the counter assertions fail independently and are both needed: the first
catches a command whose *scope* is too wide (it tombstones events it should not), the last two catch
a command with the right scope but the wrong *arithmetic* (it reverses a preserved event's
contribution, or double-subtracts a shared one). Without a fixture containing free throws and an
unlocated attempt, every located-only case passes either way.

The command is not retargeted to "scrub locations only" either: its user meaning is *undo this
chart's scoring*, and keeping the totals while deleting the positions would change what the button
does. This lands in BKE-1C acceptance and regression scope (§13), since BKE-1C is where shots first
become events and where the legacy `CLEAR_SHOT_CHART` action first no-ops.

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
- One declared source of truth per game at all times. No dual-write where counters and events can
  drift.

### 7.1 Compatibility projections are disposable, never a dual write

Event-capable games may populate the existing `game_stats` and `shot_chart` rows so that readers
which have not migrated keep working. This is **not** "dual projection" and not a dual write — those
terms imply two authorities, which is exactly what this model forbids. They are **disposable
compatibility projections** with the following contract:

- **Derived only.** Every row is a pure function of the event stream. Nothing writes a compatibility
  row that the projector did not produce, and nothing reads one back into the stream.
- **Rebuildable.** They are truncated and regenerated from events on demand. Losing them costs a
  rebuild, never data.
- **Versioned.** Each write records the projector version that produced it, so a projector change
  identifies stale rows deterministically instead of by timestamp.
- **Fingerprint-inert.** They contribute nothing to the sync fingerprint. The event stream and setup
  already determine it; including derived rows would make an identical game appear dirty after a
  projector upgrade.
- **Terminal.** Each compatibility surface is removed as its readers migrate. Their lifetime is per
  reader, not indefinite and not a single flag day. §12a a2 decides what those readers migrate
  *to*.

For an event game, a discrepancy between a compatibility row and the projection is always a bug in
the projection path, never an alternate opinion to reconcile.

---

## 8. F13 Reconciliation

The held F13 design (`PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md`) proposed extending `ShotRecord` with
`sequenceNumber`, `assistPlayerId`, `reboundPlayerId`, `reboundStatId` plus four nullable `shot_chart`
columns. **That data-model proposal is superseded.** The product intent is preserved and delivered by
the event model instead:

| F13 requirement | Event-model answer |
|---|---|
| Durable shot identity | Event `id` — stable across every revision (`mutations.ts:154-180` preserves it) |
| Shot number shown to the user | Projected shot ordinal over ordered active `basketball.shot` events (§5). **Not** envelope `sequence`, which counts every event type and is caller-supplied |
| Shooter, result, value, zone, location | `basketball.shot` payload plus envelope `location` |
| Linked assist | `basketball.assist` with optional `relatedEventId` (§4.3) |
| Linked rebound | `basketball.rebound` with `relatedEventId` |
| Editable shooter/result/value/links | `updateGameEvent` revision, full projection rebuild; edits that invalidate a link use the atomic multi-event mutation and stale-link policy in §6.2 |
| Removing a shot with dependents | Atomic batch tombstone with the consequence stated up front (§6.1, §6.2) |
| Undo after edit | Revision history; restore is a revisioned mutation |
| Legacy shots show core detail only | Legacy games stay aggregate-only; no guessed links |

No `shot_chart` migration and no `UPDATE_SHOT` reducer action are needed. F13 delivery stays in BKE-3
and builds on the atomic multi-event mutation that BKE-1A adds to the shared engine (§6.2).

---

## 9. Revised Phase Roadmap

| Phase | Purpose | Depends on | Exit condition |
|---|---|---|---|
| BKE-0 | This architecture plus focused Basketball product-model Q&A | Completed SOC-6 program | Product catalog, authority, compatibility, settings, release, and phase contracts approved |
| BKE-1A | Sport-neutral `sportGameState` extraction and atomic multi-event mutation | BKE-0 approved | Soccer behavior remains identical; generic state dispatch and all-or-nothing mutations are independently proven |
| BKE-1B | Basketball setup, participants, rules snapshot, event definitions, projector, and parity fixtures | BKE-1A | An internal fixture game rebuilds deterministic state with no live UI cutover |
| BKE-1C | Court shots, linked/unlinked assists and rebounds, undo, clear chart, filters, and popup parity | BKE-1B | Court workflows round-trip through events and approved equivalence fixtures pass. **Internal gate only** |
| BKE-2 | Stat grid, score adjustments, team/period stats, fouls, timeouts, minutes adjustments, and remaining actions | BKE-1C | Every new Basketball live action has one event-backed source of truth. **Internal gate only** |
| BKE-3 | Editable Basketball Timeline and event detail; F13 delivery | BKE-2 | Users can review, revise, remove, restore, and re-link supported local events. **Internal gate only** |
| BKE-4A | Sport-neutral RPC extraction: neutral functions, `*_soccer_*` wrappers, publication constraint relaxed to an allow-list, games trigger consults the event-capable sport list | BKE-3 stable | Soccer parity — every existing soccer test and RPC call site passes unchanged against the generalized layer. No basketball behavior yet |
| BKE-4B | Basketball binding, event transport, offline sync and recovery | BKE-4A | An internally-gated basketball event game syncs, recovers offline, and round-trips its stream |
| BKE-4C | Recorder resolution, primary selection, finalization, reopen, correction integration | BKE-4B | Multi-recorder basketball games resolve a primary and finalize; the §12a a1 correction model is implemented |
| BKE-4D | Authority-aware Summary for local, primary, alternate recorder, and canonical sources | BKE-4C | Final sources fail closed, remote sources stay read-only, and every Basketball detail view uses one explicit authority |
| BKE-4E | Canonical aggregate transport/readers, compatibility retirement plan, capability handshake, and release readiness | BKE-4D | Season/career/team/player/tournament destinations agree and backend capability preflight is ready; the internal gate remains closed |
| BKE-5 | Built-in/personal/team/match settings hierarchy, Basketball rule profiles, and event-model rollout | BKE-4E | Defaults resolve with source metadata, every new game fixes a complete immutable rules snapshot, and **the user-visible per-game opt-in ships** |
| BKE-6 | Clock, stoppage profiles, substitutions, disqualification, and on-court intervals | BKE-5 | Opt-in `clockModel: 'anchored'` games derive real minutes and lineup intervals; clock-less games remain unaffected |

**Why BKE-1 splits.** The former BKE-1 mixed a generic refactor, a new atomic mutation primitive, a
new sport state, a projector, setup, and the complete court workflow. The 1A-1C split gives each PR
one proof: unchanged Soccer infrastructure, deterministic Basketball foundation, then visible court
parity.

**Why BKE-4 splits.** As a single phase it combined a behavior-preserving generalization of roughly
two thousand lines of proven soccer SQL with basketball binding, sync and recovery, recorder
resolution, finalization, Summary authority, canonical aggregates, capability negotiation, and
production cutover. The 4A-4E split keeps the Soccer parity proof isolated, prevents Summary from
inferring authority out of mixed state, and keeps cross-game aggregate migration out of the release
switch PR.

**BKE-6 is the recommended fast follower** (pending BKE-0 approval). It ships after the settings
hierarchy rather than inside BKE-1..3 because
basketball stoppage rules vary sharply by level, and because the transport is payload-agnostic — adding
the reserved event types later needs no table, envelope, or ordering change. Its rules profiles extend
the existing `BASKETBALL_PRESETS` (NFHS / NCAA / NBA / FIBA / youth) the way
`src/lib/soccer/setupRules.ts` layers IFAB / U.S. High School / Custom profiles over soccer rules.
Until BKE-6, `min` stays a manual stat and `elapsedMs` stays null. Canonical elapsed time always
increases from period start; a countdown clock is a display/rules projection, never reversed event
time.

Plan filenames:

```text
docs/PLAN_BKE_1_EVENT_FOUNDATION_AND_COURT.md       # parent for 1A-1C
docs/PLAN_BKE_1A_SHARED_EVENT_ENGINE.md
docs/PLAN_BKE_1B_BASKETBALL_EVENT_FOUNDATION.md
docs/PLAN_BKE_1C_COURT_EVENTS.md
docs/PLAN_BKE_2_COMPLETE_EVENT_CAPTURE.md
docs/PLAN_BKE_3_EVENT_TIMELINE_AND_F13.md
docs/PLAN_BKE_4_EVENT_CLOUD_CUTOVER.md              # parent for 4A-4E
docs/PLAN_BKE_4A_NEUTRAL_RPC_EXTRACTION.md
docs/PLAN_BKE_4B_BASKETBALL_TRANSPORT.md
docs/PLAN_BKE_4C_RECORDERS_AND_FINALIZATION.md
docs/PLAN_BKE_4D_SUMMARY_AUTHORITY.md
docs/PLAN_BKE_4E_AGGREGATES_AND_RELEASE_READINESS.md
docs/PLAN_BKE_5_SETTINGS_AND_EVENT_ROLLOUT.md
docs/PLAN_BKE_6_CLOCK_AND_LINEUPS.md
```

---

## 10. Rollout and Gating

**Two gates, not one.** Because the reducer's no-op switch is all-or-nothing (§3.3), a game with a
stream is only as capturable as the last shipped phase. So event-game *creation* and the *user-visible
opt-in* are separate controls:

| Gate | Controls | Open from |
|---|---|---|
| Internal/development gate | Whether an event stream can be created at all | BKE-1C, developer/internal builds only |
| User opt-in | Whether a coach sees and chooses "track this game with the event model" | **BKE-5**, once capture, cloud lifecycle, Summary, aggregates, capability preflight, and layered settings exist |

Through BKE-1C..BKE-3 an event game is intentionally incomplete — BKE-1C has no stat grid or scores,
BKE-2 has no Timeline editor, and none of the three can sync — so no user may create one. Equivalence
fixtures, internal builds, and hand-enabled test games carry those phases; they do not need a
production user to prove correctness.

Rules that apply once the opt-in is open:

- New basketball games opt into the event model; existing and in-progress games never convert
  mid-flight.
- The opt-in is resolved at setup and snapshotted into `BasketballMatchSetup`, so a game's authority
  cannot change after tip-off.
- Backend capability preflight happens before replacing or parking an active game for a cloud-team
  event flow. Capability failure leaves existing state untouched and offers explicit legacy or
  local-only paths where supported.
- Rollback is turning the setting off: new games return to the aggregate path. Already-created event
  games keep their streams and stay readable — they are never downgraded to counters.
- Rollout policy never gates historical access, recovery export, existing event-game resume, or
  canonical review.
- The equivalence fixture suite (§5) runs in CI from BKE-1B onward and is the tripwire for projection
  drift.

If an earlier production rollout is ever wanted, the phase boundaries have to move rather than the
gate: any phase that enables user-created event games must leave every enabled game fully capturable
and durable on its own.

---

## 11. Recommended Decisions

These answer the eleven questions in roadmap §8. **Nothing here is approved yet** — every row is a
recommendation this document proposes and the BKE-0 review decides, including rows 7 and the cloud
strategy, which an earlier revision mislabeled as settled.

| # | Question | Recommendation |
|---|---|---|
| 1 | Assist: linked event or actor relationship? | Separate `basketball.assist` with optional made-shot link, preserving direct stat-grid capture (§4.3) |
| 2 | Rebound always separate and optionally linked? | Yes — separate event, optional `relatedEventId` (§4.3) |
| 3 | Opponent-attributed events without an opponent roster? | Allow opponent participants in the schema now, but never require opponent roster setup; team-kind and `unknown` actors stay valid. Never fabricate opponent participants; participants carry `teamSide` (§4.1, §12b q3) |
| 4 | Manual score adjustments vs event-derived scoring? | Always event-derived score plus signed structured adjustments; quick controls use an automatic reason, official corrections require a note, and legacy absolute-score freezing retires (§5, §6) |
| 5 | Decrement: delete newest matching event or explicit correction? | Per-stat contract (§6.1): tombstone standalone facts, append negative minute adjustments, and confirm multi-event shot/foul consequences. No blanket rule |
| 6 | Team pseudo-player stats and period-scoped ids? | Team-kind **actors**, not participant rows, projecting into `__team_home__` / `__team_opp__`; period-scoped ids derived from event `period.id`, emitting the id strings the UI reads today (§4.5, §5) |
| 7 | Match clock and substitutions, or manual minutes? | Clock-ready catalog now, settings/rule profiles in BKE-5, clock in BKE-6; `min` produced by `basketball.minutes_adjustment` until then (§4.2, §9) |
| 8 | Finalized `stat_corrections` vs event editing? | Reasoned reopen and republication; `stat_corrections` retires for event games and stays valid for legacy games. **Authority model decided at BKE-0 approval**; mechanics delivered in BKE-4C (§12 a1) |
| 9 | Project to `shot_chart`/`game_stats`, or read events directly? | Disposable compatibility projections during transition (§7.1), with canonical publications as durable aggregate authority. **Authority decided at BKE-0 approval**; reader migration delivered in BKE-4E (§12a a2) |
| 10 | Which historical shots can be promoted to events? | None. No backfill (§7) |
| 11 | How is the transition gated and rolled back? | Internal gate through BKE-4E, capability-backed opt-in at BKE-5, snapshotted at setup; existing records remain accessible (§10) |
| — | Cloud RPC strategy | Generalize in place, Soccer functions become wrappers, split across BKE-4A-4E (§3.5, §9) |
| — | Summary authority | Explicit local/primary/recording/canonical source; remote and canonical sources read-only; unhealthy finals fail closed (§3.6, §9) |
| — | Settings hierarchy | Built-in → personal → team → match, with complete immutable setup snapshot and separate capture/display preferences; required before rollout (§3.6, §4.1) |
| — | Block representation | `basketball.block` only; no `blocked_by` actor on the shot (§4.2) |
| — | Manual minutes | `basketball.minutes_adjustment`, narrow by design; ignored by anchored-clock games only (§4.2) |
| — | Clear Shot Chart | Retained as one atomic tombstone batch over **charted** shots plus linked assists/rebounds; free throws, unlocated shots, and linked blocks survive (§6.3) |
| — | Participant identity | `BasketballMatchParticipant` carries `teamSide`; actor/side validation checks the actor against both roster and envelope (§4.1, §4.5) |
| — | Restore symmetry | Grouped delete implies grouped restore; tombstoned dependents are recoverable via their retained `relatedEventId` (§6.2) |
| — | Multi-event edits | Atomic `applyGameEventMutations` added to the shared engine in BKE-1A; stale links cleared or tombstoned, never retained invalid (§6.2) |
| — | Capture preferences | Resumable UI state; excluded from projection, fingerprint, and publication (§4.4) |
| — | Shot number | Projected ordinal over **all** active shots including free throws and unlocated attempts, never envelope `sequence` (§5, §8, §12b q5) |

---

## 12. Decisions Requested and Remaining Questions

The two authority questions are **decided at BKE-0 approval**, not deferred to a later phase. They
determine what the projector and cloud layer are allowed to treat as truth, which BKE-1B needs before
it writes a line of projector code; only their *mechanics* belong to BKE-4C and BKE-4E.

### 12a. Authority decisions requested at BKE-0 approval

**a1. Finalized corrections.** Soccer requires reasoned reopen plus republication for any change to a
final game. *Proposed decision:* basketball event games adopt the same model and retire
`stat_corrections`; legacy aggregate games keep `stat_corrections` exactly as today. An overlay on top
of event-derived totals would reintroduce a second authority — precisely what §7 forbids — and reopen
reuses the RPCs BKE-4A already generalizes. **Delivered in BKE-4C.**

**a2. Aggregate authority after cutover.** *Proposed decision:* canonical publications become the
durable aggregate authority for event games, the way SOC-6C makes them for soccer; `game_stats` and
`shot_chart` receive disposable compatibility rows only until each reader migrates (§7.1).
**Delivered in BKE-4E**, whose scope is sized by this answer.

If either proposed decision is rejected, §7 and §9 need revision before BKE-1B starts.

### 12b. Required Basketball product-model Q&A

Soccer received a dedicated product-model pass before its event catalog was implemented.
Basketball needs the same treatment. Today's stat grid remains the compatibility floor, but it must
not silently define the ceiling for a redesigned system. Run these as organized batches of four,
record the chosen option and rationale, and fold the answers back into §§4, 9, 11, and 13 before
BKE-0 is approved.

**Batch A — competition format and setup**

1. Which rule profiles are first-class at release: youth, NFHS, NCAA, NBA, FIBA, and Custom?
2. How are regulation periods, dynamic overtime periods, labels, durations, foul resets, and timeout
   resets represented?
3. Which clock behaviors belong in BKE-6: count down, stoppages, tenths, shot clock, and
   period/game-local display?
4. How much setup is acceptable when saved defaults already resolve every required field?

**Batch B — participants, opponents, and staff**

5. Is opponent tracking team-only by default with an optional full opponent participant roster?
6. Which lineup facts are required: starters, bench, on-court five, positions/roles, captain, and
   temporary role changes?
7. How do late participants, jersey changes, unresolved cloud players, duplicate numbers, and player
   merges retain stable match identity?
8. Are coaches/staff snapshotted in setup, or represented as durable labeled actors only when they
   receive a technical, ejection, or other administrative event?

**Batch C — scoring, shooting, and free throws**

9. Which traditional and advanced Basketball stats are first-release requirements, and which are
   derived only when possession/lineup data is complete?
10. Which shot zones and coordinate rules are authoritative, and do quick/unlocated attempts remain
    valid everywhere?
11. Do free throws carry a `tripId`, sequence position, awarded count, one-and-one state, source foul,
    technical context, and retained-possession result?
12. Does the displayed shot ordinal include all attempts and renumber after correction, as §5
    recommends?

**Batch D — fouls, possession, and administration**

13. What foul taxonomy is needed, and exactly which player/staff/team fouls count toward personal,
    team, bonus, and disqualification totals under each profile?
14. How are technicals, flagrant/intentional fouls, double fouls, ejections, and player
    disqualification represented?
15. Which timeout classes and inventories are needed, including full, short/30-second, media,
    official, and profile-specific carryover?
16. Are jump balls, alternating-possession arrow, held balls, possessions, and possession outcomes
    first-release events, optional modules, or explicit future work?

**Batch E — capture, relationships, and corrections**

17. Confirm separate linked/unlinked assist events so both F7 and direct stat-grid capture remain
    valid.
18. Which relationships must be durable beyond assist/rebound: block-to-shot, steal-to-turnover,
    foul-to-free-throw trip, and substitution-to-lineup window?
19. Confirm F12 stays newest-first until BKE-3 provides consequence-aware arbitrary Timeline edits.
20. Confirm event-game score always remains made-shot points plus adjustments and intentionally
    retires the legacy absolute-score freeze after a scoreboard tap.

**Batch F — authority, settings, aggregates, and rollout**

21. Confirm §12a's canonical publication and reasoned reopen authority.
22. Which Basketball options are built-in, personal, team, match-specific, display-only, or capture
    preferences in the BKE-5 hierarchy?
23. Should BKE-5 event-backed creation be an explicit per-game opt-in during rollout, and when may an
    unavailable backend offer legacy or local-only fallback?
24. Which season/team/player/career/tournament categories and rates must BKE-4E expose, and how are
    partial-quality canonical aggregates labeled?

The Q&A may add catalog fields or phases. It may not weaken the settled architecture invariants:
stable event ids, one authority per game, no fabricated historical backfill, isolated recorder
streams, canonical final publication, and immutable match rules after start.

---

## 13. Regression Mapping

Every regression requirement in roadmap §9 maps to the phase that must cover it:

| Requirement | Phase |
|---|---|
| Court tap, value override, player switch, assist prompt, rebound prompt, popup stat line | BKE-1C |
| Full stat-grid entry and decrement | BKE-2 |
| Recent-events undo | BKE-1C, replaced by BKE-3 |
| Individual, team, and All shot-chart filters | BKE-1C |
| Home/opponent event-derived score, quick adjustments, and reasoned corrections | BKE-2 |
| Team fouls, timeouts, technicals, turnovers, period controls, bonus indicators | BKE-2 |
| Clear Shot Chart: charted shots and linked assists/rebounds removed; free-throw, unlocated-field-goal, and linked-block **events survive byte-identical**; `ft` totals unchanged; shared `2pt`/`3pt` totals drop by exactly the charted contribution (§6.3) | BKE-1C |
| Grouped restore after grouped removal, and non-restoration of unlinked dependents (§6.2) | BKE-1C, extended in BKE-3 |
| Local parking, import/export, quota, and cross-sport resume | BKE-1B/1C |
| Manual minutes increment, decrement, and edit, including signed/edited histories and the non-negative guard (§4.2) | BKE-2 |
| Actor/side validation against participant roster, opponent attribution, and staff labels (§4.5) | BKE-1B |
| Per-stat decrement contract, including standalone `ast` removal and confirmed multi-event removals (§6.1) | BKE-2, completed in BKE-3 |
| Multi-event mutation atomicity, including all-or-nothing failure (§6.2) | BKE-1A |
| Stale-link resolution across edits (§6.2) | BKE-3 |
| Soccer RPC parity against the generalized layer — no observable change | BKE-4A |
| Offline tracking and retry | BKE-4B |
| Independent recorder checkout and primary resolution | BKE-4C |
| Finalized games and stat corrections | BKE-4C (implements §12a a1) |
| Local/primary/alternate/canonical Summary authority, read-only remote review, and fail-closed diagnostics | BKE-4D |
| Existing-record access independent of rollout and device preference | BKE-4D/4E/5 |
| Legacy aggregate-only and shot-chart games, including their unchanged retroactive bonus behavior (§4.1) | Every phase |
| Season, career, tournament, team, and player canonical aggregates | BKE-4E (implements §12a a2) |
| Backend capability version, legacy/local fallback, and stale-client handling | BKE-4E |
| Built-in/personal/team/match settings resolution, immutable setup snapshots, rollout, and rollback | BKE-5 |
| Anchored clock, substitutions, disqualification, and on-court intervals | BKE-6 |
| Mobile court, Timeline, popup, stat-grid, Summary, and settings ergonomics | BKE-1C, BKE-3, BKE-4D, BKE-5 |

Each phase adds its own numbered section to `docs/REGRESSION_TESTING.md`, following the SOC-1..SOC-6B
pattern in §11a-11r.

---

## 14. Non-Goals

- Reopening or rewriting completed Soccer product behavior.
- Requiring historical games to contain events they never recorded.
- Sharing soccer event payloads with basketball beyond the generic envelope.
- Removing `game_stats`, `shot_chart`, or correction compatibility before every reader has a tested
  replacement.
- Redesigning basketball visuals because the data model changed.
- Implementing held F11 controls without a separate product decision.
- Real-time collaborative editing across recorder streams.
- Changing how legacy aggregate games resolve their rules — the immutable snapshot in §4.1 applies to
  new event games only.
- Exposing an incomplete event game to users to hit an earlier rollout date (§10).

---

## 15. Documentation Handoff

Before BKE-1A begins:

- complete the §12 product-model Q&A and fold every approved answer into this document;
- mark the §12a authority decisions approved or revise §§7 and 9;
- add the BKE-1 parent and BKE-1A plan with their focused implementation Q&A;
- update the roadmap phase table if boundaries move;
- keep `README.md`, `AGENTS.md`, `docs/AGENT_CODEBASE_OVERVIEW.md`, and
  `docs/REGRESSION_TESTING.md` synchronized as each phase ships.
