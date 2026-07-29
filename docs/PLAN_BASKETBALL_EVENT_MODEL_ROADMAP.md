# Plan: Basketball Event Model Roadmap

Required follow-up roadmap for moving basketball from its current counter/action-log/shot
record combination onto the shared `GameEvent` foundation introduced by the soccer program.

Status: BKE-0 architecture planning is drafted in
[PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md](PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md), revised
against the completed SOC-6 program, and awaits its focused Basketball product-model Q&A plus
approval. BKE-1 through BKE-6 implementation is gated on that approval.

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
- explicit local/primary/alternate/canonical Summary authority;
- canonical-publication aggregate transport and cooperative client projection;
- built-in/personal/team/match settings resolution;
- backend capability negotiation and release/history separation.

Basketball should reuse those capabilities, not duplicate them. Basketball still owns:

- basketball event types and payload validation,
- point values and scoring rules,
- shot value, zone, and court coordinates,
- made/missed attempt derivation,
- assist and rebound relationships,
- basketball team/period stats,
- basketball court and summary presentation.

Basketball must reuse Soccer's authority, recovery, settings, and release contracts without copying
Soccer's domain choices blindly. In particular, Basketball still supports direct stat-grid actions,
is already a released sport, and spans rule profiles whose foul, timeout, free-throw, and clock
semantics require their own product-model Q&A.

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
- optional related rebound event,
- recorder and stable event id.

Derived projections include score, field-goal/free-throw makes and attempts, shooting
percentages, shot-chart markers, and player/team summaries.

### Related basketball events

Candidate event families include:

- rebound with offensive/defensive outcome and optional related missed shot;
- separate assist with optional related made shot, preserving direct stat-grid capture;
- steal,
- block with optional related opponent attempt,
- turnover,
- foul,
- minutes/substitution or playing-time event if later enabled,
- structured signed score adjustment/unattributed score,
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

A controlled transition may temporarily populate legacy aggregate rows, but they are **disposable
compatibility projections derived from events, never a dual write** — user actions have exactly one
declared source of truth so counters and events cannot drift independently. BKE-0 §7.1 defines their
rebuild, versioning, fingerprint, and removal behavior.

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
| BKE-0 | Architecture audit, product-model Q&A, event catalog, authority, compatibility, settings/release strategy, and F13 reconciliation | Completed SOC-6 program | Detailed migration design approved; no Basketball code migration required |
| BKE-1 | Shared-engine extraction through court capture. **Splits into BKE-1A-1C** — see BKE-0 §9 | BKE-0 approved | Generic refactors preserve Soccer; Basketball setup/projector and court workflows pass approved parity fixtures |
| BKE-2 | Direct stat grid, event-derived score adjustments, team/period stats, and remaining Basketball actions | BKE-1C | Every new Basketball live action has one event-backed source of truth |
| BKE-3 | Editable Basketball Timeline/detail experience and F13 delivery | BKE-2 | Users can review, revise, remove, restore, and re-link supported local events |
| BKE-4 | Generalized cloud lifecycle, authority-aware Summary, canonical aggregates, capability negotiation, and release readiness. **Splits into BKE-4A-4E** — see BKE-0 §9 | BKE-3 stable | New Basketball games sync and publish canonically behind the internal gate; Soccer remains unchanged; legacy games remain readable |
| BKE-5 | Built-in/personal/team/match Basketball settings, rule profiles, and event-model rollout | BKE-4E | Defaults resolve with source metadata, setup fixes a complete immutable rules snapshot, and the user opt-in ships |
| BKE-6 | Basketball clock, stoppage profiles, substitutions, disqualification, and on-court intervals | BKE-5 | Opt-in clock-anchored games derive real minutes and lineup intervals; clock-less games are unaffected |

BKE-1 is split so the generic state/mutation refactor, deterministic Basketball foundation, and
visible court cutover each receive an independent proof. BKE-4 is split into 4A neutral RPC
extraction with Soccer parity, 4B Basketball bind/sync/recovery, 4C recorder/finalization/reopen, 4D
explicit Summary authority, and 4E canonical aggregates plus capability-backed release readiness.

**Gating:** because the reducer disables every legacy aggregate action the moment a stream exists,
event-game creation stays behind an internal gate through BKE-4E and the user-visible per-game opt-in
ships with BKE-5, once capture, cloud lifecycle, Summary, aggregates, backend capability preflight,
and layered settings are complete (BKE-0 §3.3, §10).

BKE-6 is the proposed clock/lineup fast follower. Basketball stoppage rules vary sharply by age
level and competition, and the shared transport is payload-agnostic, so BKE-0 reserves the clock,
stoppage, and substitution event types while BKE-5 first establishes the rule profiles they consume.

Recommended detailed plan names:

```text
docs/PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md
docs/PLAN_BKE_1_EVENT_FOUNDATION_AND_COURT.md
docs/PLAN_BKE_1A_SHARED_EVENT_ENGINE.md
docs/PLAN_BKE_1B_BASKETBALL_EVENT_FOUNDATION.md
docs/PLAN_BKE_1C_COURT_EVENTS.md
docs/PLAN_BKE_2_COMPLETE_EVENT_CAPTURE.md
docs/PLAN_BKE_3_EVENT_TIMELINE_AND_F13.md
docs/PLAN_BKE_4_EVENT_CLOUD_CUTOVER.md
docs/PLAN_BKE_4A_NEUTRAL_RPC_EXTRACTION.md
docs/PLAN_BKE_4B_BASKETBALL_TRANSPORT.md
docs/PLAN_BKE_4C_RECORDERS_AND_FINALIZATION.md
docs/PLAN_BKE_4D_SUMMARY_AUTHORITY.md
docs/PLAN_BKE_4E_AGGREGATES_AND_RELEASE_READINESS.md
docs/PLAN_BKE_5_SETTINGS_AND_EVENT_ROLLOUT.md
docs/PLAN_BKE_6_CLOCK_AND_LINEUPS.md
```

---

## 8. Q&A Topics

The architecture recommendations are summarized in BKE-0 §11. Before approval, BKE-0 §12b requires
a 24-question Basketball product-model session in six batches:

- competition format and setup;
- participants, opponents, and staff;
- scoring, shooting, and free throws;
- fouls, possession, and administration;
- capture, relationships, and corrections;
- authority, settings, aggregates, and rollout.

This pass is required because the current Basketball stat grid is a compatibility baseline, not a
complete definition of the redesigned product. It must settle rule profiles, overtime, clock scope,
opponent detail, staff discipline, lineup expectations, free-throw trips, foul and timeout
classification, optional possession tracking, event relationships, score behavior, settings
ownership, aggregate destinations, and release fallback.

Current architectural recommendations include separate linked/unlinked assist events, optional
rebound links, opponent participants allowed but not required, event-derived score plus structured
adjustments, per-stat decrement behavior, team-kind actors for team totals, manual minute events
until BKE-6, reasoned reopen for final corrections, canonical aggregate authority, no historical
event backfill, and capability-backed rollout at BKE-5.

BKE-0 also surfaced one topic this roadmap did not anticipate: the shared event tables are
sport-neutral but every binding, recorder, finalization, and reopen RPC in migrations 043-046
is hard-gated on `sport_id = 'soccer'`. **Recommended:** BKE-4A generalizes that layer in place and
keeps the soccer-named functions as thin wrappers, proven by soccer parity tests before any
basketball semantics land.

Completed SOC-6 also added migration 047 canonical aggregate transport, migration 048's generic
sport-settings tables, and migration 049's capability handshake. BKE-4D, BKE-4E, and BKE-5 adopt
those contracts explicitly, with rollout following settings rather than preceding them.

Two authority decisions remain required at BKE-0 approval: event games use reasoned reopen and
republish instead of `stat_corrections`, and canonical publications become Basketball aggregate
authority. Their mechanics belong to BKE-4C and BKE-4E. See BKE-0 §12a.

---

## 9. Regression Requirements

Every BKE implementation phase must cover:

- existing court tap, value override, player switch, assist prompt, rebound prompt, and
  popup stat-line behavior,
- full stat-grid entry and decrement behavior, including manual minutes,
- clear-shot-chart behavior, including the linked assist/rebound stats it reverses today,
- recent-events one-tap undo/restore for single events and durable multi-event capture-command
  groups until the editable Timeline replaces it,
- individual, team, and All shot-chart filters,
- approved event-derived home/opponent score behavior and structured corrections,
- team pseudo-player fouls, timeouts, technicals, turnovers, period controls, and bonus
  indicators,
- local parking, import/export, quota handling, and cross-sport resume,
- offline tracking and retry,
- independent recorder checkout and primary resolution,
- explicit local/primary/alternate/canonical Summary authority and all-recorder review,
- fail-closed unhealthy canonical finals and read-only remote sources,
- finalized games and stat corrections,
- legacy aggregate-only and shot-chart games,
- season, career, tournament, team, and player canonical aggregate views,
- built-in/personal/team/match settings resolution,
- backend capability negotiation, creation rollback, and uninterrupted historical access,
- mobile court, Timeline, popup, stat-grid, Summary, and settings ergonomics.

Projection tests should compare event-derived totals against the current reducer for
equivalent action sequences before any cutover. Intentional product changes, beginning with
scoreboard behavior after a manual adjustment, require named fixtures with approved expected
results rather than being hidden as parity exceptions.

---

## 10. Non-Goals

- Reopening completed Soccer product behavior.
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

BKE-0 revision 5 is drafted. Its approval follows the §12 product-model Q&A and settles the two
authority decisions in §12a, after which:

- add the BKE-1 parent and BKE-1A plan, then detailed BKE plans one implementation slice at a time,
- update this roadmap if phase boundaries move,
- keep README, AGENTS, agent overview, and regression testing synchronized as phases ship.

Background reading for any BKE phase: `docs/PLAN_SOC_0_SOCCER_PRODUCT_MODEL.md` and the
completed SOC event phases, `docs/PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md`, the completed F1-F9 and
F12 plans, and the current reducers, cloud projections, shot review resolution, and correction
RPCs.
