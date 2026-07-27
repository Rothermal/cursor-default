# Plan: SOC-0 Soccer Product Model

High-level product and technical plan for adding soccer as StatKeeper's next fully
supported sport. SOC-0 defines the stable direction for the soccer program. Each
implementation phase in this document must receive its own detailed execution plan and
Q&A review before code work begins.

Status: SOC-1 through SOC-6D implemented. SOC-6E release planning is complete in
`PLAN_SOC_6E_RELEASE_HARDENING.md`.

---

## 1. Goal

Build a soccer-native tracking experience without copying basketball's counter-first UI or
making soccer a one-off architecture.

The soccer program should:

- optimize for one recorder capturing detailed events for a selected team,
- keep opponent tracking fast and mostly team-level,
- use structured, editable events as the source of truth,
- derive consistent player, goalkeeper, team, score, and season totals,
- provide a full soccer field plus quick-event controls,
- support youth, grassroots, school, and adult competition variations,
- work offline and with local multi-game parking,
- preserve independent recorder streams and current cloud checkout behavior,
- establish a shared event foundation that later sports can adopt.

The existing soccer entry in `src/config/sports.ts` is a one-time strategy baseline only.
Its current categories, labels, and stat ids are open for redesign and are not requirements.

---

## 2. Product Boundaries

### Detailed tracked team, simplified opponent

The selected team receives player-level event attribution. Opponent events default to
lightweight identities:

- Opponent Team
- Opponent Goalkeeper
- optional opponent jersey number and/or name when useful

No full opponent roster is required. The tracked team may be Home, Away, or Neutral; that
choice is explicit during setup and is not inferred from which team has detailed players.

### Shared management, soccer-specific live experience

Reuse these sport-aware flows:

- sport dashboard,
- teams and rosters,
- seasons,
- game setup where fields are truly generic,
- local parking and resume,
- cloud games,
- auth, roles, permissions, and audit boundaries.

Add soccer-specific behavior for:

- lineup and match-rule setup,
- match clock and periods,
- full-field live tracking,
- soccer event entry and editing,
- soccer summary and field maps,
- soccer settings.

### Delivery model

SOC-0 defines the complete useful catalog, but implementation is phased. Every item is
classified as core, derived, optional later, or intentionally excluded from manual capture.
The first release should not attempt professional analyst-level collection by one person.

---

## 3. Target Mental Model

```text
Soccer game setup
  -> select tracked-team side and competition rules
  -> select starters and game-specific roles
  -> start match clock
  -> soccer tracker
       -> tap field for location-relevant event
       -> choose outcome and actor(s)
       -> or use quick event control
       -> save one editable GameEvent
       -> derive score and stat totals
       -> show event in timeline
  -> period / substitution / extra-time / shootout controls
  -> soccer summary
       -> overview / box score
       -> player statistics and minutes
       -> event timeline
       -> field maps
```

Events, not mutable counters, are the soccer source of truth.

---

## 4. Shared Event Foundation

### Generic envelope, sport-specific payload

Introduce a versioned `GameEvent` envelope that can support soccer now and other sports
later. The detailed SOC-1 plan should settle exact TypeScript and SQL shapes, but the shared
contract needs fields equivalent to:

```text
GameEvent
  id                    stable local/cloud UUID
  schemaVersion         payload migration/version discriminator
  sportId               soccer for this program
  gameId/localGameId    cloud and offline ownership
  recorderUserId        independent recorder stream
  eventType             stable sport event identifier
  teamSide              tracked or opponent; mapped to home/away
  period                regulation, extra time, or shootout segment
  elapsedMs             canonical elapsed match time
  occurredAt            deterministic ordering/correction fallback
  location?             normalized x/y plus attacking direction
  actors[]              player, goalkeeper, staff, team, or unknown roles
  payload               event-type-specific outcome and metadata
  createdAt/updatedAt   sync and review metadata
  deletedAt?            tombstone for offline-safe deletion
```

Requirements:

- Event ids remain stable through edits and sync.
- Event payloads are validated by event type and schema version.
- Location is nullable. The UI encourages field capture but supports Location unknown.
- Actors use explicit roles such as shooter, creator, scorer, goalkeeper, blocker,
  offender, fouled player, player in, and player out.
- Team/staff incidents do not require a `players` row.
- Derived totals are rebuilt deterministically from the event stream.
- Editing or deleting an event recalculates every affected total.
- Event order does not depend only on client wall-clock time.

### Aggregate compatibility

Current summaries, season RPCs, and cloud data use `game_stats`. Soccer event derivation
should produce compatible aggregate rows rather than requiring every generic view to read
raw events immediately.

For soccer:

- `game_events` is authoritative.
- local `Player.stats` and cloud `game_stats` are projections/caches.
- projections must be rebuilt from events instead of independently edited.
- score is derived from goal events and explicit score-adjustment events.
- finalization stores a consistent event stream and aggregate projection.

Stat corrections for finalized games need a detailed phase decision: either continue as a
separate resolved-stat overlay or become correction events. SOC-1 must preserve existing
basketball correction behavior while defining the soccer path.

### Multi-recorder model

Each recorder owns an independent event stream. Finalization resolves a primary recorder,
matching the current checkout model. SOC-0 does not introduce a shared real-time timeline,
cross-recorder event merging, or event deduplication.

---

## 5. Match Model

### Configurable rules

Rule precedence:

```text
app defaults -> personal soccer defaults -> shared team overrides -> game overrides
```

Later layers win per field. Personal defaults are complete; team and game layers are sparse
overrides.

The rule model should cover:

- regulation period count and duration,
- count-up or countdown display,
- player count,
- substitution policy and return substitutions,
- extra-time availability and period lengths,
- penalty shootout availability,
- assist limit/display behavior,
- optional competition-specific labels.

Store canonical elapsed time regardless of clock display. Support pause, resume, manual
clock correction, stoppage time, and event entry while the clock is stopped.

### Lineup and minutes

- Select starters before kickoff.
- Assign game-specific roles: goalkeeper, defender, midfielder, forward, or custom.
- Keep position off the permanent player identity.
- Maintain the current on-field lineup.
- A substitution pairs a player leaving with a player entering.
- Allow return substitutions when rules permit.
- Derive starts, appearances, and minutes from lineup and clock events.
- Provide correction tools for late or missed substitution entry.

### Field direction

Use a full field. Store normalized coordinates and the tracked team's attacking direction
for the period. Switch ends automatically when rules call for it and provide a manual flip.
Analysis can normalize the tracked team to attack left-to-right without losing match context.

### Outcome states

Support structured outcomes:

- regulation win, loss, or draw,
- extra-time result,
- shootout advancement,
- suspended,
- abandoned.

Keep regulation/extra-time score separate from shootout score.

---

## 6. Core Event Catalog

### 6.1 Shots, goals, and chance creation

A shot is one event with one outcome:

| Outcome | Derived behavior |
|---|---|
| Goal | Shot + shot on target + player goal + team goal; goalkeeper goal allowed when known |
| Saved | Shot + shot on target + linked goalkeeper save |
| Blocked | Shot + optional linked defender block; not a shot on target by default |
| Off target | Shot only |
| Woodwork | Shot only; retained as an off-target subtype |

Core shot context:

- open play,
- penalty,
- direct free kick,
- corner/set-piece sequence,
- own goal.

Any shot may identify a primary creator. A non-goal shot derives a key pass/chance created.
A goal supports a primary and optional secondary assist. Penalty goals and own goals disable
assist attribution where the selected stat convention does not permit it.

The goal workflow must support:

- attributed scorer,
- unattributed team goal,
- own goal without crediting an opponent player goal,
- explicit score correction without creating a goal statistic.

Potential detailed-goal add-on:

- body part,
- cross or through-ball origin,
- rebound,
- defensive error,
- fast-break/build-up classification,
- other competition-specific detail.

### 6.2 Defensive actions

SOC core:

- tackle with won/lost outcome,
- interception,
- clearance,
- ball recovery,
- shot block linked from the opposing shot event.

Do not separately increment a defender block when it is already linked to a shot. Pressures,
duels, aerial duels, dribbled-past events, and defensive errors are advanced modules.

### 6.3 Goalkeeping

Derive core goalkeeper statistics from opposing shots:

- saves,
- goals allowed,
- save percentage,
- penalty saves,
- clean sheets,
- minutes and appearances.

An opponent shot may use an unknown shooter and still link to the tracked goalkeeper.
Claims, punches, distribution, sweeper actions, save technique, and detailed handling
outcomes are advanced goalkeeper modules.

### 6.4 Fouls and discipline

A foul incident may contain:

- committing player/team,
- optional player fouled,
- optional location,
- no sanction, yellow, straight red, or second-yellow red.

Cards can also exist without a linked foul. Card recipients may be:

- player,
- named or unnamed coach/team staff,
- team/bench.

Derive fouls committed, fouls drawn, yellow cards, and red cards. Staff and bench cards
appear in team discipline and the timeline but never in player statistics.

Season views aggregate discipline. Automatic eligibility/suspension enforcement is a
future team-management module.

### 6.5 Team and match events

Directly capture:

- corner kick,
- offside,
- substitution,
- period start/end,
- clock adjustment,
- score correction,
- match suspension/abandonment,
- shootout kick when applicable.

Derive goals, shots, shots on target, saves, fouls, cards, and penalties won/conceded from
their underlying events. Routine throw-ins, goal kicks, and free kicks are not core events.

### 6.6 Penalty shootout

Use a dedicated shootout mode. Each kick may record:

- kicker or unknown team actor,
- goalkeeper or unknown goalkeeper,
- scored, saved, missed, or woodwork outcome,
- kick order and sudden-death round.

Shootout goals determine advancement but do not increase match score or normal player goal
totals.

---

## 7. Derived Stat Catalog

Derived values should not be manually incremented when their source events exist.

### Player attacking

- goals,
- assists, with primary/secondary relationship retained,
- shots,
- shots on target,
- shot accuracy,
- goal conversion rate,
- key passes/chances created,
- penalty goals and attempts,
- direct-free-kick goals,
- own goals separately classified.

### Player defending and discipline

- tackles attempted/won/lost and win rate,
- interceptions,
- clearances,
- ball recoveries,
- blocked shots,
- fouls committed/drawn,
- yellow and red cards.

### Goalkeeper

- starts, appearances, and minutes,
- saves,
- goals allowed,
- save percentage,
- penalty saves/attempts faced,
- clean sheets and shared/combined clean-sheet context.

### Team and match

- score and result,
- shots and shots on target by side,
- corners and offsides,
- fouls and cards,
- goalkeeper saves,
- penalties won/conceded,
- lineup participation and substitutions,
- shootout result.

### Season player aggregates

The first soccer release should feed existing season/player views with appearances, starts,
minutes, attacking, defensive, discipline, and goalkeeper totals. Per-match and per-standard
match-duration rates may be added when the base totals are stable.

Team W-D-L, goals for/against, goal difference, clean sheets, configurable standings points,
and competition tiebreakers are designed follow-ups rather than first-release scope.
Per-game result capture is core; aggregating those results into a season table is the
deferred feature.

---

## 8. Optional Future Modules

SOC-0 reserves event shapes and settings groups for later planning. These modules are not
part of the core six-phase release unless a detailed phase explicitly promotes them.

| Module | Candidate data |
|---|---|
| Detailed goal metadata | Body part, assist delivery, rebound, error, build-up type |
| Technical actions | Dribble attempts/results, crosses, dispossessions, turnovers |
| Passing | Passer, recipient, completion, start/end location, direction, type |
| Advanced defending | Pressures, ground/aerial duels, dribbled past, errors |
| Possession | Dedicated live possession timer with neutral/dead-ball state |
| Advanced goalkeeping | Claims, punches, distribution, sweeper actions, handling outcomes |
| Team standings | W-D-L, points rules, tiebreakers, table views |
| Discipline eligibility | Competition accumulation, reset, and suspension rules |
| Post-game review | Coach ratings, player notes, Player of the Match |
| Collaborative capture | Shared live event stream, deduplication, and conflict handling |

Do not estimate possession from sparse events. Do not generate opaque player ratings from an
incomplete event set. Expected-goals models may later derive from location/context and a
documented model; xG is not a manually entered SOC core stat.

---

## 9. Live Tracker UX

### Primary surface

- Render a soccer field, never a basketball court or generic decorative placeholder.
- A field tap begins location-relevant capture.
- Keep quick-event controls for substitutions, cards, corners, offsides, clock, and other
  actions where a location is optional or unhelpful.
- Remember the active/recent player, but allow actor changes before save.
- Filter actor choices to on-field players where appropriate, with an override for correction.
- Support Location unknown without blocking save.

### Context-adaptive flow

```text
Field tap
  -> choose event/outcome
  -> default to active/recent on-field player
  -> add linked actors/context when relevant
  -> save

Quick event
  -> choose event type
  -> choose actor/team if relevant
  -> save
```

Shot example:

```text
Tap location
  -> Shot
  -> shooter
  -> Goal / Saved / Blocked / Off target / Woodwork
  -> context
  -> creator/assist prompt when relevant
  -> goalkeeper/blocker when relevant
  -> save one linked event
```

### Editable timeline

Every soccer event appears in a chronological timeline. Selecting an event opens a detail
view that can change actors, outcome, clock time, period, location, or metadata, or delete
the event. Derived totals update immediately.

This is deliberately stronger than basketball's current newest-only undo behavior.

### Summary

The first soccer Game Summary has four focused views:

1. Overview and box score
2. Player statistics, lineup, and minutes
3. Editable/reviewable event timeline
4. Field maps

Add a separate shootout section only when a shootout exists.

---

## 10. Soccer Settings

Settings -> Sports -> Soccer should avoid one toggle per stat. Use grouped rule sections.

Core settings/rules:

- personal rule defaults,
- count-up/countdown display,
- default period count and duration,
- default player count,
- return substitution default,
- extra-time/shootout defaults,
- field orientation preference where useful.

Potential future module groups:

- Advanced Defending,
- Chance Creation,
- Detailed Goal Metadata,
- Technical Actions,
- Passing,
- Possession,
- Advanced Goalkeeping.

Team and game rules override personal defaults. Every implemented core event family remains
available. Optional module toggles are added only when those advanced modules ship; disabling a
future module must not hide or corrupt historical events that used it.

---

## 11. Cloud, Offline, and Security Direction

The detailed phases must preserve these invariants:

- Soccer works without Supabase.
- The active soccer event stream persists inside its parked local game record.
- Basketball and soccer games can be parked and resumed independently.
- Sync works per local game id and per recorder stream.
- Cloud event edits use stable ids and tombstones/version checks rather than destructive
  replace-all behavior where practical.
- Team access uses the existing owner/admin/scorer/viewer model.
- Viewers remain read-only; scorers can track; owner/admin retain finalization and correction
  authority.
- RLS/RPC authorization remains the enforcement boundary.
- Event payloads cannot be trusted solely because the client derived valid aggregates.
- Existing finalized basketball games and aggregate RPCs remain compatible.

A likely cloud addition is a generic `game_events` table keyed by game, recorder, and event
id, plus any RPC/projection changes required for primary-recorder resolution. The exact
migration and conflict strategy belong in SOC-1 and SOC-5 plans.

---

## 12. Implementation Roadmap

| Phase | Purpose | Primary exit condition |
|---|---|---|
| SOC-1 | Shared game-event foundation, local persistence, derivation engine, and cloud schema | Versioned soccer events can round-trip locally and through the schema behind disabled UI; deterministic projections are tested |
| SOC-2 | Soccer rules, tracked-team side, lineup roles, clock, periods, direction, substitutions, and minutes | A local soccer match can maintain corrected lineup/time state across park/resume |
| SOC-3 | Full field, shot/goal/chance flows, goalkeeper links, score events, and editable timeline | Core attacking game can be tracked locally end-to-end with consistent derived totals |
| SOC-4 | Defense, discipline/staff cards, corners, offsides, shootouts, and structured outcomes ([execution plan](PLAN_SOC_4_MATCH_EVENT_CATALOG.md)) | Core soccer event catalog is usable and editable locally |
| SOC-5 | Cloud sync, independent recorder streams, primary resolution, finalization, and resume hardening ([detailed plan](PLAN_SOC_5_CLOUD_SYNC_AND_FINALIZATION.md)) | Complete: SOC-5A-D implement transport, recovery, recorder resolution, canonical finalization, and audited reopen |
| SOC-6 | Soccer summaries, field maps, season aggregates, settings modules, regression hardening, and enablement ([execution roadmap](PLAN_SOC_6_SUMMARY_AND_RELEASE.md)) | Soccer can be enabled as a supported sport without regressing basketball or parking |

Each phase receives a separate plan and one-question-at-a-time Q&A before implementation.
Recommended names:

```text
docs/PLAN_SOC_1_SHARED_EVENT_FOUNDATION.md
docs/PLAN_SOC_2_MATCH_RULES_LINEUPS_AND_CLOCK.md
docs/PLAN_SOC_3_FIELD_AND_ATTACKING_EVENTS.md
docs/PLAN_SOC_4_MATCH_EVENT_CATALOG.md
docs/PLAN_SOC_5_EVENT_CLOUD_SYNC.md
docs/PLAN_SOC_6_SUMMARY_AND_RELEASE.md
```

---

## 13. Future Basketball Event Redesign

This follow-up is required but does not block soccer.

Detailed roadmap:
[PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md](PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md).

Basketball currently distributes event meaning across:

- mutable player/team stat counters,
- `actionLog` entries used for undo,
- richer `shotChart` records,
- separate linked assist/rebound increments,
- planned F13 shot detail/edit behavior.

After the soccer event foundation is proven, follow the dedicated basketball program to
evaluate migration onto `GameEvent`:

- keep all historical aggregate-only games readable,
- dual-write or project aggregates during a controlled transition,
- migrate basketball court actions before generic stat-grid actions,
- unify shot, assist, rebound, score, and undo/edit relationships,
- use the shared event detail/timeline pattern to unblock F13,
- avoid rewriting basketball inside any SOC implementation PR.

The shared envelope must be designed so basketball can adopt it, but SOC-1 should not add
premature basketball payload types merely to prove theoretical generality.

---

## 14. Regression Themes

Every SOC implementation plan must cover:

- basketball tracker and court remain unchanged unless explicitly planned,
- basketball summary and cloud resolution remain unchanged,
- basketball and soccer can coexist in the parking manifest,
- local-only soccer works with Supabase unconfigured,
- park/resume preserves events, clock, lineup, and field direction,
- actor ids survive cloud player mapping,
- editing/deleting events rebuilds projections and score,
- opponent lightweight identities do not leak into the permanent player pool,
- independent recorder streams do not combine or double-count,
- viewer/scorer/admin permissions match the access matrix,
- historical events remain visible when an optional module is disabled,
- HashRouter routes and sport dashboard filters remain compatible,
- mobile field, popups, timeline, clock, and controls do not overlap.

SOC-0 introduces no executable behavior, so it does not add a placeholder regression script.
SOC-1 through SOC-4 should add manual coverage as behavior appears, SOC-5 should add cloud,
offline, and recorder-resolution cases, and SOC-6 should consolidate the complete soccer
release suite in `REGRESSION_TESTING.md`.

---

## 15. Non-Goals

- Full opponent roster management in the first soccer release.
- Shared real-time multi-recorder event editing.
- Professional-level capture of every pass, touch, run, pressure, or possession phase.
- Automatic player ratings.
- Inferred possession from sparse events.
- Team standings and competition tiebreakers in the first release.
- Automatic card-suspension enforcement.
- Video tagging or clip synchronization.
- Basketball event migration inside SOC-1 through SOC-6.
- Enabling the dormant soccer configuration before the release phase is ready.

---

## 16. Research Baseline

StatKeeper uses competition-neutral definitions and documents its own exact behavior.
References inform the model but do not make the app NCAA-only or professional-only.

- IFAB Laws and permitted youth/grassroots modifications:
  `https://www.theifab.com/laws/latest/general-modifications/`
- IFAB match duration:
  `https://www.theifab.com/laws/latest/the-duration-of-the-match/`
- NCAA soccer rules, shot outcomes, assists, saves, and own goals (Rule 10):
  `https://ncaaorg.s3.amazonaws.com/championships/sports/soccer/rules/PRXSO_RulesBook.pdf`
- FIFA Football Language overview and advanced event taxonomy:
  `https://www.fifatrainingcentre.com/en/resources-tools/football-language/`
- FIFA defensive-event definition:
  `https://www.fifatrainingcentre.com/en/resources-tools/football-language/out-of-possession/defensive-event/index.php`
- FIFA attempt-at-goal outcomes:
  `https://www.fifatrainingcentre.com/en/resources-tools/football-language/in-possession/distributing-the-ball/attempt-at-goal/attempt-at-goal-outcome/index.php`

---

## 17. Resolved SOC-0 Decisions

- Detailed tracked team; simplified opponent with optional lightweight identities.
- Review the complete stat catalog now and implement it in phases.
- Soccer events are authoritative; totals are derived.
- Use a generic event envelope with soccer-specific event payloads.
- Add an explicit future basketball event-redesign follow-up.
- Optional running clock, configurable display, editable timestamps, and derived minutes.
- Full soccer field plus quick-event controls.
- One shot event with structured outcomes.
- Primary plus optional secondary assist.
- Core goal context now; detailed goal metadata later.
- Link chance creation to shots; do not capture every pass in core.
- Outcome-aware defensive core.
- Derive goalkeeper totals from opposing shots.
- Link fouls and cards; support player, coach/staff, and bench recipients.
- Maintain on-field lineup and game-specific roles.
- Track corners and offsides as box-score team events.
- Possession is a future optional timer, never inferred from sparse events.
- Advanced technical statistics are optional future modules.
- Use layered personal, season, and game rule configuration.
- Use dedicated shootout mode.
- Provide editable event timeline during and after the game.
- Keep independent recorder streams and primary-recorder resolution.
- Store period-aware direction and normalized full-field coordinates.
- Use context-adaptive interaction with remembered/recent player.
- Configure grouped modules rather than every stat independently.
- Soccer summary uses overview, player stats, timeline, and field-map views.
- Reuse generic management flows; specialize lineup, tracker, settings, and summary.
- Score derives from goals plus explicit unattributed-goal/adjustment events.
- Split implementation into SOC-1 through SOC-6.
- Support structured regulation, extra-time, shootout, suspended, and abandoned outcomes.
- Aggregate player season stats; defer team standings.
- Location is encouraged but nullable.
- Track card accumulation; defer suspension enforcement.
- Keep ratings in a future post-game review module.
- Use competition-neutral StatKeeper definitions.
