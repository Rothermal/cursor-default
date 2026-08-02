# Plan: BKE-1B Basketball Event Foundation

Parent plan for the Basketball setup, event catalog, projector, and parity-fixture program.

Status: Complete. BKE-1B1, BKE-1B2, and BKE-1B3 are implemented. The split gives state,
stat-event projection, and administrative parity an independent proof. No active user rollout is
required while the BKE program is under construction.

Depends on:

- [PLAN_BKE_1A_SHARED_EVENT_ENGINE.md](PLAN_BKE_1A_SHARED_EVENT_ENGINE.md)
- [PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md](PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md)

## 1. Goal

BKE-1B exits when a complete, internally gated Basketball event fixture can rebuild setup,
participants, score, player and team statistics, shot records, periods, discipline, timeouts, and
match result deterministically. The existing aggregate Basketball path and every Soccer event path
must remain unchanged.

## 2. Phase Map

| Phase | Scope | Exit condition |
|---|---|---|
| BKE-1B1 | Immutable rules/setup, participant identity, sport-state normalization, and lifecycle events/projection | Basketball setup and lifecycle histories normalize, rebuild, fingerprint, and park without entering the live runtime registry |
| BKE-1B2 | Shooting, scoring, assists, rebounds, steals, blocks, turnovers, links, and stat projection | **Implemented:** court and box-score fixture events deterministically rebuild score, player/side/team totals, and located shot records |
| BKE-1B3 | Fouls, ejections, timeouts, minutes, durable event-authority/quarantine marker, complete parity fixtures, and runtime registration | **Implemented:** the complete catalog passes parity/integration tests; corrupt event state cannot fall back to aggregate sync; Basketball event support is registered behind the internal creation gate |

The split is an implementation boundary, not a product-model change. BKE-1C remains the first
court-command and live capture cutover.

## 3. BKE-1B1 Scope

### Included

- `BasketballSportGameState` version 1 with immutable setup, rebuildable projection, and normalized
  capture preferences.
- Complete baseline `BasketballMatchRules` snapshots derived from the current resolved team-stat
  configuration, with stable regulation segment identities, a dynamic-overtime template,
  `clockModel: 'none'`, and rules-source metadata reserved for BKE-5 layers.
- Stable tracked/opponent player participants with starter, bench, or DNP opening status; optional
  player resolution, number, position, and captain metadata; and duplicate-id rejection.
- Lifecycle event definitions for period start/end, late roster additions, participant resolution,
  match end, and match reopen.
- A pure lifecycle projector that rebuilds status, periods, the effective participant registry,
  end reason, and result without reading React, Supabase, capture preferences, or mutable legacy
  counters.
- Basketball membership in the neutral `SportGameState` union and normalizer registry.
- Focused hydration, parking, and fingerprint coverage.

### Excluded

- Shooting, scoring, player-stat, team-stat, discipline, timeout, and minutes events (BKE-1B2/1B3).
- Court commands, stat-grid commands, popup behavior, filters, and undo (BKE-1C/BKE-2).
- Global Basketball event definitions/projector registration (delivered in BKE-1B3).
- Supabase migrations, cloud transport, finalization, Summary, aggregates, and settings UI.
- Anchored clock, substitutions, and on-court intervals (BKE-6).

## 4. State Contract

- Setup is cloned at creation and never changed by projection.
- `participantId` and `teamSide` are stable match identity. Resolution may add or replace the cloud
  `playerId`, display name, and number without rewriting historical actors.
- Team pseudo-players and staff are not participant rows.
- Regulation segment ids are stable and unique. Overtime ids are derived as `overtime-N` from a
  snapshotted template and are appended only when their period starts.
- Capture preferences are resume-only state and remain outside fingerprints and projection.
- Basketball can simultaneously support legacy aggregate games and recognized event-owned setup.
  Aggregate sync remains eligible only for unmarked legacy games with no event stream or sport
  state. BKE-1B3 adds a durable top-level `gameDataAuthority: 'sport_events'` marker that is
  normalized independently of those fields.
- Existing unmarked Basketball games remain legacy. A marked event game whose stream or setup
  fails normalization is quarantined with recovery diagnostics and remains ineligible for aggregate
  sync; corruption never silently changes its authority model.

## 5. Lifecycle Contract

- The initial projection is `not_started` and contains the setup participant registry.
- All six lifecycle families are side-less administrative facts and therefore require
  `teamSide: 'neutral'`; tracked/opponent variants are invalid.
- A period can start once, only after the previous started period has ended. Its payload period id
  and envelope period must agree.
- A started period can end once and must be the current period.
- Late roster additions require a new participant id and may enter as bench or DNP. Team side never
  changes after entry.
- Participant resolution requires an existing participant and a non-empty player id. It updates
  projected identity only.
- Match end requires at least one started period. Completed, suspended, and abandoned are explicit
  reasons; only completed derives a winner/draw from the projected score.
- Reopen applies only to ended/suspended matches and returns to period break or in-progress state
  according to the latest period history. It clears the previous end result without changing events.
- Any invalid transition emits diagnostics, preserves the stream, and prevents authoritative
  completion.

## 6. Proof

- Rules and setup validation reject malformed snapshots, duplicate segments, duplicate participant
  ids, invalid side/status metadata, and inconsistent compatibility fields.
- State normalization drops persisted projection truth, rebuilds a clean projection, and normalizes
  capture preferences defensively.
- Lifecycle fixtures cover regulation, dynamic overtime, late tracked/opponent participants,
  identity resolution, completion, suspension/abandonment, reopen, duplicate sequences, and invalid
  transitions.
- Lifecycle definitions explicitly opt into neutral and reject tracked/opponent sides.
- Fingerprints include immutable Basketball setup but exclude projection and capture preferences.
- Park/import/hydration round trips recognize valid Basketball state and reject malformed state.
- Existing Soccer, aggregate Basketball, full unit, lint, and production-build checks remain green.

## 7. BKE-1B2 Implementation

### Event families

- `basketball.free_throw_trip` owns optional structured award context without contributing a stat.
- `basketball.shot` owns field-goal/free-throw makes and misses, score, optional normalized court
  location, explicit value source, and optional trip position.
- `basketball.assist`, `basketball.rebound`, `basketball.steal`, and `basketball.block` are independent
  facts with optional links. Totals never depend on a link.
- `basketball.turnover` distinguishes player/unknown attribution from explicit team turnovers.
- `basketball.score_adjustment` is signed, team-attributed, and requires a note for official
  corrections.

All BKE-1B2 stat families are tracked/opponent events with `elapsedMs: null`. Definitions enforce
payload shape, actor roles/kinds, shot geometry/value compatibility, grouped free-throw fields,
score-adjustment reasons, and team-turnover attribution. Effective participant and side identity are
rechecked during projection.

### Projection

- Participant totals remain keyed by stable `participantId` and map to current local player ids only
  at the compatibility projection boundary.
- `sideStats` counts every attributable fact for full side totals. `teamActorStats` separately maps
  team/unknown facts into the existing home/opponent pseudo-player rows; explicit team turnovers
  emit `team_turnover` while still contributing to side turnover totals.
- Made shots plus signed adjustments are the only score authority. Ending a match derives its result
  from that projected score.
- Located field goals project to unchanged `ShotRecord` rows. Free throws and unlocated field goals
  remain authoritative for score/stats but do not fabricate chart coordinates.
- `src/lib/basketball/courtGeometry.ts` now owns the court constants, zone classifier, and canonical
  normalized-event-coordinate conversion. The existing component module re-exports it, so live UI
  and event validation cannot drift.
- Valid links must point backward to an already projected active event. Missing, tombstoned,
  future, or semantically stale links produce `relationshipWarnings`, degrade to unlinked facts,
  preserve totals, and do not make the stream incomplete.

### Still excluded

- Court/stat-grid commands, grouped undo, clear-chart mutations, and UI cutover remain BKE-1C/BKE-2.
- Supabase event transport remains blocked by migration 042's neutral-side constraint until BKE-4A.

## 8. BKE-1B3 Implementation

### Administrative events and projection

- `basketball.foul` records personal, technical, flagrant, intentional, and double fouls with
  explicit context, actors, optional drawn-by attribution, incident grouping, and reasoned counting
  overrides. Projection derives player/team fouls, period team fouls, team technicals, snapshotted
  bonus state, and player disqualification.
- `basketball.ejection` supports player and staff subjects, official rulings, automatic-threshold
  validation, and advisory links to related fouls.
- `basketball.timeout` separates charged full/30-second team timeouts from neutral media/official
  stoppages. Projection counts charged usage per side and period without inventing team ownership
  for neutral stoppages.
- `basketball.minutes_adjustment` provides signed manual player minutes for the current no-clock
  model. Negative projected totals fail closed; adjustments are ignored when an anchored clock owns
  minutes in a future rules version.

### Authority and registration

- Event-stream initialization and every successful event mutation stamp the top-level
  `gameDataAuthority: 'sport_events'` marker. The marker participates in fingerprints and parking
  normalization independently from event/setup data.
- Marked games with a missing or malformed stream/setup emit recovery diagnostics, reject aggregate
  reducer writes, and remain ineligible for aggregate cloud sync. Unmarked historical Basketball
  games continue on the existing aggregate path.
- Basketball definitions and projector are registered in `gameEvents/runtime.ts`. The ordinary New
  Game flow still does not initialize Basketball event state, so BKE-1C remains the deliberate live
  capture cutover.

## 9. Delivery

1. Merge BKE-1B1 with no global Basketball event runtime registration.
2. Merge BKE-1B2 stat definitions/projection using a private Basketball fixture registry/projector.
3. Re-audit the complete BKE-1B1/BKE-1B2 catalog against the BKE-1B3 administrative map.
4. Merge BKE-1B3 administrative projection, parity fixtures, durable authority/quarantine, and
   global internal registration.
5. Keep normal game creation on the aggregate path and proceed to BKE-1C court capture.
