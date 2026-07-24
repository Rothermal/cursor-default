# Plan: Basketball Event Model Roadmap

Required follow-up roadmap for moving basketball from its current counter/action-log/shot
record combination onto the shared `GameEvent` foundation introduced by the soccer program.

Status: BKE-0 architecture planning is drafted in
[PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md](PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md) and
awaits review. SOC-5 is complete, so BKE-1 through BKE-5 implementation is gated only on that
approval.

This roadmap does not block soccer and must not be implemented inside an SOC pull request.

---

## 1. Goal

Make one editable basketball event stream the source of truth for live actions while
preserving the current basketball experience and every historical game.

The redesign should:

- unify court shots, assists, rebounds, direct stat-grid actions, scores, team stats, and
  undo/edit behavior,
- derive player, team, score, shot-chart, summary, and season projections from events,
- reuse the generic event envelope, persistence, editing, and sync infrastructure proven by
  soccer,
- preserve basketball-specific payloads and workflows instead of forcing soccer semantics
  into basketball,
- provide the event-detail foundation needed by the held F13 design,
- avoid a destructive migration or mandatory reconstruction of historical events.

---

## 2. Why This Is Required

Basketball event meaning is currently distributed across several structures:

| Current structure | Responsibility | Limitation |
|---|---|---|
| `Player.stats` | Mutable individual and team pseudo-player totals | Counters do not retain event identity, actors, context, or edit history |
| `ActionLogEntry[]` | Newest-first undo context | Not a complete durable event model; linked rows can represent one user action as multiple entries |
| `ShotRecord[]` | Located basketball shots | Richer than counters but does not own linked assist/rebound or arbitrary editing |
| Score fields | Home/opponent totals and adjustments | Can diverge from scoring actions by design |
| `game_stats` | Cloud aggregate rows per recorder/player/stat | Stores projections, not event relationships |
| `shot_chart` | Cloud shot rows | Separate persistence and recorder-resolution path from aggregate stats |
| `stat_corrections` | Finalized-game resolved overrides | Applies after aggregation rather than editing a source event |

This is workable for fast increment/decrement tracking, but it makes linked editing hard.
For example, one made court shot may also create an assist increment; a missed shot may be
followed by a linked rebound increment; undo must unwind log rows in reverse order rather
than edit one durable play.

The shared event foundation provides a path to solve that fragmentation once, then let
basketball and future sports define their own event payloads and derived-stat rules.

---

## 3. Relationship to Soccer

Soccer introduces and proves the generic capabilities:

- versioned event envelope and stable ids,
- local event persistence inside parked games,
- deterministic aggregate projection,
- event create/edit/delete/tombstone behavior,
- editable timeline/detail UI patterns,
- per-recorder cloud streams,
- offline retry and conflict handling,
- primary-recorder resolution and finalization.

Basketball should reuse those capabilities, not duplicate them. Basketball still owns:

- basketball event types and payload validation,
- point values and scoring rules,
- shot value, zone, and court coordinates,
- made/missed attempt derivation,
- assist and rebound relationships,
- basketball team/period stats,
- basketball court and summary presentation.

The generic envelope must allow basketball adoption, but SOC-1 should not prebuild
basketball payloads before this roadmap receives its own detailed Q&A.

---

## 4. Target Event Model

Exact types belong in the BKE-0 plan. The target event families are:

### Court shot event

One shot event should retain:

- shooter,
- made/missed outcome,
- 1PT/2PT/3PT value,
- court location and zone when available,
- period and event time when basketball timing exists,
- optional assister relationship,
- optional related rebound event,
- recorder and stable event id.

Derived projections include score, field-goal/free-throw makes and attempts, shooting
percentages, shot-chart markers, and player/team summaries.

### Related basketball events

Candidate event families include:

- rebound with offensive/defensive outcome and optional related missed shot,
- assist with optional related made shot,
- steal,
- block with optional related opponent attempt,
- turnover,
- foul,
- minutes/substitution or playing-time event if later enabled,
- direct score adjustment/unattributed score,
- team foul, timeout, technical, and team turnover,
- period change and other basketball match-state events.

The detailed plans must decide which relationships live inside one event payload and which
use separate linked event ids. The model should support one user flow without pretending
every resulting statistic is the same event type.

### Projection rule

For event-capable basketball games:

```text
Basketball GameEvent stream
  -> deterministic basketball reducer/projector
      -> Player.stats and team pseudo-player stats
      -> home/opponent score projections
      -> shot-chart view records
      -> game_stats cloud projections
      -> summary and season aggregates
```

Projection caches may exist for performance and compatibility, but they are not independent
sources of truth.

---

## 5. Historical Compatibility

Historical preservation is a hard requirement.

- Existing games without a basketball event stream remain readable through current
  aggregate and shot-chart paths.
- Do not fabricate exact event timing, ordering, links, or court location from aggregate
  rows when that information never existed.
- A game-level capability/schema version determines whether events or legacy aggregates are
  authoritative.
- New event-capable games may project into existing `game_stats` and `shot_chart` shapes so
  generic analytics continue working during migration.
- Historical shot rows may be optionally wrapped or referenced by synthetic events only
  when the mapping is lossless and explicitly planned.
- Finalized historical corrections remain valid.
- Import/export and parking must preserve both legacy and event-capable game formats.
- No migration may silently change historical scores or totals.

A controlled transition may temporarily dual-write projections, but user actions must have
one declared source of truth so counters and events cannot drift independently.

---

## 6. F13 and Existing Court Plans

The held F13 shot-detail/edit design is a direct consumer of this roadmap.

F13 expects a user to select an existing shot and review or edit:

- shot sequence/identity,
- shooter,
- made/missed result and value,
- location/zone,
- related assist,
- related rebound,
- other event metadata.

Those capabilities align with an event-backed shot and linked basketball events. Therefore:

- do not implement F13 as a new independent metadata system before BKE-0,
- preserve the F13 product intent,
- reconcile the existing F13 plan with the shared event contract during BKE-0,
- deliver the final event detail/edit UI in BKE-3,
- keep F11 quick controls separate unless a later review intentionally folds them into the
  redesigned tracker.

F13 is not discarded; its implementation path moves under the basketball event program.

---

## 7. Proposed Phase Roadmap

Each phase requires a separate implementation plan and one-question-at-a-time Q&A.

| Phase | Purpose | Dependency | Exit condition |
|---|---|---|---|
| BKE-0 | Architecture audit, basketball event catalog, projection contract, compatibility strategy, and F13 reconciliation | Stable SOC-1 shared event contract | Detailed migration design approved; no basketball code migration required |
| BKE-1 | Sport-neutral `sportGameState` extraction, basketball setup/rules snapshot, and court-originated shots with linked assist/rebound | SOC-5 complete and BKE-0 approved | New court actions round-trip through events while preserving current totals, shot views, and undo behavior |
| BKE-2 | Direct stat grid, score adjustments, team/period stats, and remaining basketball actions | SOC-5 complete and BKE-1 | Every new basketball live action has one event-backed source of truth |
| BKE-3 | Editable basketball timeline/detail experience and F13 delivery | SOC-5 complete, shared edit/detail pattern proven, and BKE-2 | Users can review, edit, or delete supported basketball events with projections recalculated |
| BKE-4 | Generalized sport-neutral cloud RPC layer, basketball event sync, recorder resolution, finalization/correction integration, historical hardening, and cutover | SOC-5 complete and BKE-3 stable | New basketball games sync as event-capable records; soccer behavior unchanged; legacy games remain readable and unchanged |
| BKE-5 | Basketball clock, age-level stoppage profiles, substitutions, and on-field intervals | BKE-4 | Opt-in clock-anchored games derive real minutes and lineup intervals; clock-less games are unaffected |

BKE-0 planning does not need to wait for SOC-5. BKE-1 through BKE-5 implementation does not
need to wait for SOC-6 presentation work once SOC-5 has proven the shared event lifecycle
and BKE-0 is approved.

BKE-5 is a deliberate fast follower rather than part of BKE-1 through BKE-3. Basketball
stoppage rules vary sharply by age level and competition, and the shared transport is
payload-agnostic, so the BKE-0 catalog reserves the clock, stoppage, and substitution event
types up front and BKE-5 implements them without an envelope, table, or ordering change.

Recommended detailed plan names:

```text
docs/PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md
docs/PLAN_BKE_1_COURT_EVENTS.md
docs/PLAN_BKE_2_COMPLETE_EVENT_CAPTURE.md
docs/PLAN_BKE_3_EVENT_TIMELINE_AND_F13.md
docs/PLAN_BKE_4_EVENT_CLOUD_CUTOVER.md
docs/PLAN_BKE_5_CLOCK_AND_LINEUPS.md
```

---

## 8. Q&A Topics

All eleven topics below are addressed in
[PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md](PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md) §11,
with recommendations for the open ones and the remaining questions carried into its §12.

- Whether assist remains a linked event or an actor relationship on the made shot.
- Whether a rebound is always separate and optionally linked to a missed shot.
- How opponent-attributed events work without a full opponent roster.
- How manual score adjustments coexist with event-derived scoring.
- Whether decrement buttons edit/delete the newest matching event or create explicit
  correction events.
- How event-backed team pseudo-player stats map to period-scoped ids.
- Whether basketball adds a match clock/substitution model or continues manual minutes.
  **Resolved:** clock-ready catalog now, clock-less through BKE-4, clock delivered in BKE-5.
- How finalized stat corrections interact with event editing.
- Whether new cloud games project to existing `shot_chart` rows or summaries read events
  directly after cutover.
- Which historical shot records, if any, can be losslessly promoted to events.
- How the transition is feature-gated and rolled back if projection discrepancies appear.

BKE-0 also settled one topic this roadmap did not anticipate: the shared event tables are
sport-neutral but every binding, recorder, finalization, and reopen RPC in migrations 043-046
is hard-gated on `sport_id = 'soccer'`. **Resolved:** BKE-4 generalizes that layer in place and
keeps the soccer-named functions as thin wrappers.

---

## 9. Regression Requirements

Every BKE implementation phase must cover:

- existing court tap, value override, player switch, assist prompt, rebound prompt, and
  popup stat-line behavior,
- full stat-grid entry and decrement behavior,
- recent-events undo until the editable timeline replaces it,
- individual, team, and All shot-chart filters,
- home/opponent score behavior and manual corrections,
- team pseudo-player fouls, timeouts, technicals, turnovers, period controls, and bonus
  indicators,
- local parking, import/export, quota handling, and cross-sport resume,
- offline tracking and retry,
- independent recorder checkout and primary resolution,
- cloud Game Summary and all-recorder shot review,
- finalized games and stat corrections,
- legacy aggregate-only and shot-chart games,
- season, career, tournament, team, and player aggregate views,
- mobile court, timeline, popup, and stat-grid ergonomics.

Projection tests should compare event-derived totals against the current reducer for
equivalent action sequences before any cutover.

---

## 10. Non-Goals

- Rewriting basketball during SOC-1 through SOC-6.
- Requiring historical games to contain events they never recorded.
- Sharing soccer event payloads with basketball beyond the generic envelope.
- Removing `game_stats`, `shot_chart`, or correction compatibility before all readers have a
  tested replacement.
- Redesigning basketball visuals merely because the data model changes.
- Implementing held F11 controls without a separate product decision.
- Real-time collaborative editing across recorder streams unless the shared platform later
  adds that capability.

---

## 11. Documentation Handoff

BKE-0 is drafted. Its review should confirm the open questions in its §12, after which:

- add detailed BKE plans one phase at a time, each with its own focused Q&A,
- update this roadmap if phase boundaries move,
- keep README, AGENTS, agent overview, and regression testing synchronized as phases ship.

Background reading for any BKE phase: `docs/PLAN_SOC_0_SOCCER_PRODUCT_MODEL.md` and the
completed SOC event phases, `docs/PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md`, the completed F1-F9 and
F12 plans, and the current reducers, cloud projections, shot review resolution, and correction
RPCs.
