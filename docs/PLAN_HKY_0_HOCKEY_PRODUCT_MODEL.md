# Plan: HKY-0 Hockey Product Model

High-level product and technical plan for bringing ice hockey up to the level of Soccer
and Basketball. HKY-0 sets the direction for the whole hockey program. Each phase below
gets its own detailed execution plan and owner Q&A before code work begins, exactly as
the SOC and BKE programs did.

Status: approved. The owner accepted every recommended default in §17 on 2026-09-26;
HKY-1 may proceed. No runtime behavior changes in this document.

Related plans:

- [SOC-0 Soccer product model](PLAN_SOC_0_SOCCER_PRODUCT_MODEL.md) (the template this follows)
- [Basketball event roadmap](PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md) (clock, lineup, cloud cutover lessons)
- [Shared product and interaction decisions](PRODUCT_AND_INTERACTION_DECISIONS.md)
- [Event timing and live lineups](PLAN_EVENT_TIMING_AND_LIVE_LINEUPS.md)
- [Soccer field-test backlog](PLAN_SOC_FIELD_TEST_BACKLOG.md) (sideline lessons to apply up front)
- [HKY-1 execution plan](PLAN_HKY_1_FOUNDATION_RULES_AND_ROSTER.md)

---

## 1. Goal

Build a hockey-native tracking experience on the shared event platform, with the same
product shape Soccer has today:

- team roster with hockey positions and Starter/Bench (and optional line) defaults,
- per-game setup that snapshots rules, participants, and the opening lineup,
- a full rink as the primary live capture surface,
- structured, editable events as the source of truth, with derived totals,
- an editable Timeline, a hockey Summary, cloud sync/finalization, and canonical
  season aggregates,
- release behind the same owner-only, default-off opt-in used for Soccer.

Hockey should be the cheapest of the three remaining sports because:

1. Its event shape is close to Soccer: two sides, goals, shots with outcomes, a goalie,
   a flowing continuous-play surface with attacking direction, penalties, an optional
   shootout.
2. Its clock is close to Basketball: countdown stop-time periods, which BKE-6 already
   modelled as an anchored clock.
3. The cloud platform is already sport-neutral after BKE-4A (private cores, fixed
   per-sport wrappers). Hockey adds wrappers and policy, not new infrastructure.
4. There is no legacy hockey data to protect in the cloud: on 2026-09-26 the production
   database had 0 hockey games and 0 hockey seasons/teams (checked with a read-only query).

The two genuinely new problems are **line changes on the fly** (skaters change while the
clock runs, constantly) and **manpower strength** (power play, shorthanded, empty net)
derived from penalties and goalie pulls. This plan keeps both out of the recorder's way in
the core release and makes them explicit, labelled modules.

The current hockey entry in `src/config/sports.ts` (Goal, Assist, Shot, Hit, Block,
Takeaway, Giveaway, Minor/Major penalty, Save, Goal Against) is a baseline only. Its stat
ids are open for redesign, as Soccer's were.

---

## 2. Product Boundaries

### Detailed tracked team, simplified opponent

Same as SOC-0. The selected team gets player-level attribution. The opponent defaults to:

- Opponent Team,
- Opponent Goalie (one anonymous identity, or a jersey number when entered),
- optional opponent jersey numbers/names added during the game when useful.

No full opponent roster is required. Tracked side is explicitly Home, Away, or Neutral.
Hockey scoresheets are number-heavy, so optional opponent jersey entry should be one tap
away (this is Soccer backlog S5 "reusable opponent identities"; see XS-8).

### Shared management, hockey-specific live experience

Reuse: sport dashboard, teams/rosters, seasons, invites/roles, parking/resume, Cloud
Games, Game Info, audit, generic setup fields.

Hockey-specific: rules and setup, lineup/lines, rink capture, hockey event dialogs, penalty
box and strength display, Timeline families, Summary, settings, aggregates.

### One path for new games

Basketball carries both a legacy aggregate tracker and an event tracker because it had
years of real data. Hockey has none in the cloud. Recommendation: when hockey releases,
**new hockey games are event games only**; the generic stat-grid hockey tracker is kept
only to open and review any legacy local or cloud hockey games that already exist
(`LEGACY_AGGREGATE_CLOUD_SPORT_IDS` keeps covering them). This avoids BKE-5's
Legacy/Event setup toggle entirely. Owner confirmation is question Q1.

---

## 3. Target Mental Model

```text
Hockey game setup
  -> tracked side, competition profile (periods, length, OT, shootout, strength rules)
  -> select dressed players; starting goalie; starting five (optional lines)
  -> start period (clock paused at period length)
  -> hockey tracker
       -> Start/Stop clock (whistle-to-whistle)
       -> tap rink -> Shot / Faceoff / Hit / Takeaway / Giveaway / Block
            -> outcome, actor(s), goalie, assists when relevant -> one event
       -> quick controls: Penalty, Goalie change / pull, Timeout, Icing, Offside,
          Line change (optional module), Score adjustment
       -> penalty box shows running penalties and derived strength (5v4, 4v4, 6v5 EN)
       -> Timeline shows every event, editable and revisioned
  -> period end / intermission / overtime / shootout
  -> hockey summary
       -> overview & box score (by period, PP, shots, faceoffs, PIM)
       -> skaters, goalies
       -> timeline
       -> shot map / faceoff map
       -> shootout (only if one happened)
```

Events, not mutable counters, are the source of truth.

---

## 4. Rink Playfield

### Geometry

A full rink rendered in SVG, landscape, normalized to 0..1 on both axes, using standard
dimensions as the reference (200 ft x 85 ft, 28 ft corner radius). Drawn markings:

- boards with rounded corners, goal lines (11 ft from each end), blue lines (75 ft from
  each end), center red line,
- goal creases and nets, goaltender trapezoid (profile-dependent; NHL only),
- center faceoff circle and dot, four end-zone circles with dots and hash marks, four
  neutral-zone dots (nine faceoff locations total),
- referee crease optional.

Rinks differ (international is wider; many youth rinks are smaller). The app stores
**normalized** coordinates, so a different drawing never changes stored data. Profile
may pick the drawn variant later; v1 draws one standard rink.

### Direction and zones

- Store `GameEventLocation { x, y, attackingDirection }` exactly as Soccer does.
- Teams change ends **every period** (unlike Soccer halves). Rules supply the tracked
  team's attacking direction per period; overtime follows the profile. A manual flip is
  display-only, as in Soccer S9/S18, and persists per device.
- Zones (offensive / neutral / defensive) are **derived** from x and direction at read
  time, never stored separately.
- Faceoff capture snaps a tap to the nearest of the nine dots and stores the dot id in
  the payload as well as the location.
- Shots store location; the net-face placement grid (Soccer S16 "goal-mouth placement")
  is a hockey add-on candidate (glove/blocker/five-hole/high/low), not core.

The pure geometry lives in `src/lib/hockey/rinkGeometry.ts` with the same shape as
`src/lib/soccer/field.ts` (`hockeyRinkLocation(displayX, displayY, flipped, direction)`).
Soccer's display-flip helper and cluster logic are candidates for extraction (XS-5).

---

## 5. Rosters, Positions, and Lines

Follows the approved app-wide roster rule in
[shared decisions](PRODUCT_AND_INTERACTION_DECISIONS.md#players-and-lineups): one default
position and Starter/Bench status per player on the team roster; games snapshot them.

### Positions

Standard catalog, in actor-order sequence:

| Order | Stored value | Label | Group |
|---|---|---|---|
| 1 | `hockey:center` | Center (C) | Forward |
| 2 | `hockey:left_wing` | Left Wing (LW) | Forward |
| 3 | `hockey:right_wing` | Right Wing (RW) | Forward |
| 4 | `hockey:defense` | Defense (D) | Defense |
| 5 | `hockey:goalie` | Goalie (G) | Goalie |

Custom positions sort after standard ones; missing/malformed values read as Unassigned
(not coerced, per the shared rule), unlike Soccer's legacy Midfielder fallback. Storage
uses `team_players.position` with the `hockey:` prefix, mirroring Soccer's `soccer:`
convention in `src/lib/soccer/rosterRole.ts`.

Goalie is special in hockey in a way it is not in Soccer: skater and goalie stats are
separate stat lines, and a player is dressed as a skater or as a goalie for a game. A
game-level role therefore distinguishes **skater** from **goalie**; the roster position
supplies the default.

### Starters and lines

- Starting lineup: 1 goalie + 5 skaters (profile player count; 4v4 and 3v3 youth
  formats supported through the rules).
- Team default: Starter/Bench per player plus a **default starting goalie** and a backup.
- **Lines (optional defaults):** forward lines F1-F4 (C/LW/RW) and defense pairs D1-D3,
  stored in team settings as ordered player-id slots, analogous to Soccer's team
  formation (S19) and lineup defaults (S23). Lines are a convenience for line changes and
  for the Line-change module; they never enforce who may be on the ice.
- In-game edits never write back to team defaults; later default edits never rewrite a
  snapshot game (same as Soccer/Basketball).

---

## 6. Match Model

### Rules and profiles

Precedence as in Soccer and Basketball:
`built-in profile -> personal hockey defaults -> team overrides -> game overrides`, with
a complete immutable `rulesSnapshot` frozen at setup.

Built-in profiles (source-linked, versioned, like `src/lib/basketball/profiles.ts`):

| Profile | Periods | OT | Shootout | Notes |
|---|---|---|---|---|
| NHL regular season | 3 x 20 | 5 min 3v3 sudden death | 3 rounds then sudden death | Trapezoid, ties not allowed |
| NHL playoffs | 3 x 20 | 20 min 5v5 periods, repeat | none | |
| NCAA / college | 3 x 20 | 5 min (3v3 variants by league) | optional | |
| USA Hockey youth | 3 x 12/15/17 (configurable) | optional | optional | Running clock option |
| High school (US) | 3 x 15/17 | 8 min | optional | |
| Recreational / custom | configurable | configurable | configurable | Ties allowed |

Rule fields:

- regulation period count and length, intermission (display only),
- clock display (countdown default, count-up option), stop-time vs running clock,
- skaters per side (5, 4, 3) and minimum on ice (3),
- overtime: none / sudden death N minutes at K skaters, repeating or single,
- shootout: none / N rounds then sudden death, repeat-shooter rule,
- ties allowed,
- penalty lengths: minor 2, double minor 4, major 5, misconduct 10 (all configurable,
  youth leagues shorten them),
- minor released on power-play goal (yes default),
- coincidental-minor handling (substitute on the ice vs play 4v4),
- delayed-penalty / pulled-goalie allowed,
- mercy rule / running-clock-at-margin (youth; optional, later).

### Clock

Hockey uses Basketball's anchored countdown stop-time model (BKE-6A2/6B3): Start/Pause,
reasoned Set Clock, period end at zero, event time stamped from the anchored clock.
The recorder presses Start at the drop of the puck and Stop at the whistle. A clockless
option remains (events carry period only, no elapsed time) for recorders who do not want
to run the clock; strength and time-on-ice modules then degrade to manual entry.

Whether to reuse the Basketball clock projection directly or extract a shared anchored
clock is XS-6.

### Lineup, goalies, and minutes

Core tracks:

- opening lineup and **goalie in net** at all times (goalie change, pull for extra
  attacker, return) — required for saves, goals against, save %, empty-net goals, and
  goalie of record,
- **on-ice skaters at a goal** (optional multi-select in the goal dialog, prefilled from
  the most recent on-ice set) — enough for plus/minus without tracking every shift.

Not core: every line change. Continuous shift tracking by one person is the hardest
thing in hockey stat-keeping and conflicts with the open
[timing assessment](PLAN_EVENT_TIMING_AND_LIVE_LINEUPS.md) (running-clock lineup
changes). It is an optional **Line changes** module (HKY-M3) that, when enabled,
records one-tap line swaps using the default lines without stopping the clock, and
then derives skater TOI and full on-ice context. Goalie TOI is core because goalie
changes are rare and explicit.

### Strength state

Derived, not typed, when the clock runs:

- penalty events start penalty timers per side; timers run with the game clock,
- minors release on a power-play goal against the penalized side (profile rule),
- coincidental penalties handled per profile,
- a pulled goalie adds an extra attacker,
- the projection yields strength at any moment: `5v5`, `5v4`, `4v4`, `5v3`, `6v5 EN`...

Each goal stores the recorder-confirmed strength (EV / PP / SH / EN, plus penalty-shot
flag) prefilled from the derived value. If the clock is off or projection is unsure, the
recorder picks it. Stored strength wins over re-derivation, so a clock correction never
silently changes a published PP goal (same principle as the timing assessment:
corrections are future-only for labels).

### Outcomes

Regulation win/loss/tie, overtime win/loss, shootout win/loss, suspended, abandoned.
Regulation+OT score stays separate from the shootout score. The shootout winner gets one
goal in the final score by convention; display this as `3-2 (SO)` and keep player goal
totals unchanged, matching Soccer's shootout separation.

---

## 7. Core Event Catalog

Event types use the `hockey.` prefix. Every family listed is core unless marked.

### 7.1 Shots and goals

One `hockey.shot` event with an outcome, mirroring `soccer.shot`:

| Outcome | Derived |
|---|---|
| Goal | shot attempt, shot on goal, goal, goalie GA (goalie in net) |
| Saved | shot attempt, shot on goal, goalie save |
| Missed | shot attempt only (wide / high / post / crossbar subtype) |
| Blocked | shot attempt; optional linked blocker (defending side) gets a block |

- Shooter: tracked player / opponent team or jersey / unknown.
- Goal: primary and secondary assist (0-2), strength (EV/PP/SH/EN), empty-net flag,
  penalty-shot flag, optional on-ice skaters for plus/minus.
- Goalie defaults to the projected goalie in net for the defending side; editable.
- Optional detail (add-on, not required to save): shot type (wrist, slap, snap, backhand,
  tip/deflection, wraparound), rebound, rush, net placement.
- Own goal: hockey credits the last attacking player to touch the puck; the recorder
  picks the scorer or "Team (unattributed)". No separate own-goal event.
- Penalty shot: a shot with `penaltyShot: true`, taken by one shooter against one goalie.
- Goals and shots derive Corsi (all attempts) and Fenwick (unblocked attempts) at read
  time; they are not captured separately.

### 7.2 Faceoffs

`hockey.faceoff`: dot id (1 of 9), winning side, optional tracked participant (taker)
and optional opponent taker label. Derives faceoffs won/lost/FO% per player and team,
and by zone. Faceoff capture is where hockey differs most from Soccer in tempo: there
are 50-70 per game, so the flow must be two taps (dot, then Won/Lost for the tracked
center already preselected from the last faceoff). This is the main place hockey should
learn from Soccer backlog S1 (faster capture).

### 7.3 Physical and possession events

- `hockey.hit`: hitter, optional player hit.
- `hockey.takeaway`, `hockey.giveaway`: one actor.
- Blocked shots come from the linked blocker on a Blocked shot; do not double count
  (same rule as Soccer blocks).

### 7.4 Penalties and discipline

`hockey.penalty`:

- offender: player, goalie, bench/team (bench minor), coach/staff,
- served by: required when the offender cannot serve (goalie, bench, staff),
- drawn by (optional),
- infraction (tripping, hooking, slashing, interference, holding, high-sticking,
  roughing, cross-checking, boarding, too many men, delay of game, unsportsmanlike,
  fighting, other...),
- class: minor, double minor, major, misconduct, game misconduct, match; plus
  penalty-shot awarded,
- duration derived from class and rules; override allowed.

Derives PIM, penalties taken/drawn, PP opportunities, strength timeline. A game
misconduct or match penalty removes the player from eligibility (like Soccer red cards,
but the team does not necessarily play short; the served portion does).

Delayed penalty (calling the penalty before the whistle) is represented as the penalty
event at the stoppage time; optional "delayed" flag for context only.

### 7.5 Goalie and team events

- `hockey.goalie_change`: goalie in/out, reason (tactical, injury, pulled for attacker,
  return, penalty).
- `hockey.timeout`: team, one per game by default.
- `hockey.team_event`: icing, offside (like Soccer's corner/offside box-score team
  events; optional location).
- `hockey.score_adjustment`: signed, reason-required (reuse Soccer/Basketball pattern).
- Lifecycle: period start/end, clock start/pause/set, match suspended/abandoned/ended,
  reopen, rules changed.
- Lineup: opening lineup, lineup transition (on-ice set change) for the Line-change
  module and corrections.

### 7.6 Shootout

Reuse the Soccer shootout model (`src/lib/soccer/shootout.ts`): dedicated shootout mode,
rounds and sudden death, shooter and goalie per attempt, outcome goal/saved/missed,
eligibility rules (profile: may a shooter repeat before everyone has shot). Shootout
attempts never count as goals or shots in skater/goalie totals. Extraction of a shared
shootout core is XS-7.

---

## 8. Derived Stat Catalog

Aggregate stat ids use the `hky_` prefix (like `soc_` and `bk_`).

### Skaters

GP, G, A (primary/secondary kept), PTS, +/- (only when on-ice data is complete for that
goal; quality-labelled otherwise), PIM, PPG, PPA, SHG, SHA, GWG (derived at finalization),
ENG, SOG, shot attempts, missed, blocked-by-opponent, shooting %, FOW, FOL, FO%, hits,
blocks, takeaways, giveaways, TOI (only with Line-change module or complete anchored data).

### Goalies

GP, GS, TOI (from goalie in/out and anchored clock), SA, SV, GA, SV%, GAA (only with
TOI; otherwise suppressed), shutouts (full game, no GA, sole goalie), W/L/OTL/T as
**goalie of record** (derived: the goalie in net when the winning goal was scored),
shootout saves/attempts kept match-scoped only (like Soccer M3).

### Team and match

Score by period, shots by period, PP x/y, PK %, faceoffs, hits, blocks, PIM, takeaways,
giveaways, icing/offside, timeouts, result and decision stage.

### Aggregates

Canonical cross-game projection from active publications (SOC-6C / BKE-4E pattern) feeding
Leaderboard, Team Stats, Tournament Stats, Player Profile, and Career with the `hky_*`
catalog. Standings/points tables are deferred (M1 in the Soccer backlog, shared).

---

## 9. Live Tracker UX

- **Surface-first:** the rink is the primary workspace; no global player strip. Event
  dialogs default actors to Unattributed per the shared decision, except faceoff taker,
  which defaults to the last tracked center on ice because it is almost always the same
  player within a shift (owner question Q7).
- **Tap rink ->** a compact chooser: Shot (then outcome), Faceoff (snapped dot), Hit,
  Takeaway, Giveaway. Blocked-shot blockers are picked inside the shot flow.
- **Quick controls row** (no location): Penalty, Goalie, Timeout, Icing/Offside, Score
  adj., Line change (module).
- **Scoreboard strip:** score, period, clock with Start/Stop, SOG by side, and a
  **penalty box** chip per side showing running penalties and current strength.
- **Recent events + Undo** on the rink from day one (Soccer S4 lesson).
- **Keep the rink on screen** on a phone; quick controls above/below it, filters
  collapsed (Soccer S3/S11 lesson).
- **Timeline tab:** oldest-first by period, family filters (Shots, Goals, Faceoffs,
  Physical, Penalties, Goalies, Team, Lifecycle), revisioned edit/remove/restore and
  recorded-later additions.
- **Lineup/Goalie tab:** current goalie, on-ice five (if tracked), bench, penalty box,
  lines.

---

## 10. Hockey Settings

Settings -> Sports -> Hockey (grouped, not per stat):

- personal rule defaults (profile, periods, length, OT, shootout, penalty lengths),
- clock display and stop-time vs running,
- default capture options (faceoff capture on/off, on-ice-at-goal prompt on/off),
- modules: Line changes (TOI), Shot detail, Net placement,
- display: rink orientation.

Team Manage -> Rules / Lines / Lineup defaults for owners/admins; scorers and viewers
review read-only (Soccer SOC-6D and S19/S23 pattern).

---

## 11. Cloud, Offline, and Security

Hockey reuses the event platform as Basketball did after BKE-4A:

- local-first; the event stream lives in the parked game record,
- one recorder per stream; independent streams; manager primary selection,
- canonical finalization/reopen through the private shared cores with a hockey policy,
- fixed authenticated hockey wrappers only (no generic sport parameter from clients),
- settings through the existing `user_sport_settings` / `team_sport_settings` tables with
  strict hockey validation and CAS writes,
- release capability handshake like migrations 049/061,
- team roles unchanged (owner/admin finalize, scorer tracks, viewer reads).

Server allow-lists that must add `hockey` (see XS-2): `is_event_platform_sport` (051),
the publication `sport_id` check (054), the aggregate-source guard (060), and the
setup-snapshot version gate (069).

---

## 12. Implementation Roadmap

| Phase | Purpose | Exit condition |
|---|---|---|
| HKY-0 | This product model plus owner Q&A | Answers to §17 recorded; HKY-1 plan approved |
| HKY-1 | Hockey domain foundation: types, rules v1 + profiles, setup snapshot, participants, roster positions, team Starter/Bench and starting-goalie defaults, sport-state union, event registry and projector skeleton, lifecycle and clock events, dev-only gate ([plan](PLAN_HKY_1_FOUNDATION_RULES_AND_ROSTER.md)) | A local dev-only hockey game can be set up, started, park/resumed, with period/clock replay tested; no UI release |
| HKY-2 | Rink surface and core capture: rink SVG, direction per period, shots/goals/assists/goalie links, faceoffs, hits/takeaways/giveaways, goalie changes and empty net, score adjustments, Recent Events undo | A local hockey game's scoring and shot/faceoff stats can be tracked end-to-end on the rink |
| HKY-3 | Penalties and strength: penalty events, penalty box, strength projection, PP/SH/EN classification, timeouts, icing/offside, overtime, shootout, structured outcomes | Complete core catalog tracked locally, including OT and shootout |
| HKY-4 | Timeline and corrections: revisioned edit/remove/restore for every family, recorded-later additions, dependency-aware corrections (assist/goalie/strength links), lineup/on-ice correction | Every recorded event is reviewable and correctable locally |
| HKY-5 | Cloud lifecycle: fixed hockey wrappers over event-platform cores (bind, recorders, primary, finalization policy, reopen, canonical read), transport routing, settings persistence, release capability handshake | Hockey games sync, finalize, and reopen canonically behind the gate |
| HKY-6 | Summary, aggregates, settings UI, release: Summary tabs, `hky_*` canonical aggregates and five destinations, Team Manage rules/lines, production opt-in stage, regression matrix | Hockey ships as owner-only opt-in without regressing Soccer/Basketball |
| HKY-M* | Modules after first live games (§14) | Planned separately from field-test evidence |

Recommended slice split (to be confirmed in each phase plan):

```text
HKY-1A  types, rules v1, profiles, settings parsing (pure)
HKY-1B  roster positions, Starter/Bench + goalie defaults, setup snapshot, participants
HKY-1C  sport state, registry, projector skeleton, lifecycle + anchored clock, dev gate
HKY-2A  rink geometry + component (read-only render, flip, dot snapping)
HKY-2B  shot/goal capture and projection, goalie in net, goalie change/pull
HKY-2C  faceoff/hit/takeaway/giveaway capture; Recent Events undo on rink
HKY-2D  team default lines (F1-F4, D1-D3) and Team Manage Lines tab
HKY-3A  penalty events, penalty box and strength projection
HKY-3B  goal strength prefill/confirmation, PP/PK totals, timeouts, icing/offside
HKY-3C  overtime and shootout (shared shootout core), outcomes
HKY-4A  Timeline review and filters
HKY-4B  revisioned corrections and recorded-later additions
HKY-5A  server wrappers + allow-list extension migration(s)
HKY-5B  client transport, recorders, finalization/reopen UI
HKY-5C  settings persistence and release capability handshake
HKY-6A  Summary (overview, skaters, goalies, timeline, maps, shootout)
HKY-6B  aggregates and destinations
HKY-6C  settings UI, Team Manage, release stage, regression record
```

Migration numbers are deliberately left unassigned: Football and Baseball programs will
add migrations in parallel, so numbers are chosen when each migration PR is opened.

Estimated relative size: HKY-1..4 are smaller than SOC-1..4 because the shared engine,
correction patterns, clock projection, and Timeline components exist. HKY-5 is much
smaller than SOC-5 because BKE-4A made the server cores sport-neutral. HKY-3 (strength)
is the one piece with no existing analogue.

---

## 13. Shared Cross-Sport Work (XS)

These items came up while planning hockey and apply equally to Football and Baseball.
They are named so all three plans can reference the same item. None is approved; each
should be done once, by whichever sport reaches it first, without speculative
generalization beyond the sports that actually use it.

| Id | Item | Where today | Why it matters |
|---|---|---|---|
| XS-1 | Per-sport release policy. `getSportAvailabilityPolicy` special-cases only `soccer`; every other sport is "released" whenever the device toggle is on | `src/lib/sportAvailability.ts` | A new event sport needs `unreleased / preview / released` without another hard-coded branch. Replace with a per-sport stage table |
| XS-2 | Server event-sport registration. Adding a sport means editing `is_event_platform_sport` (051), the publication `sport_id` check (054), the aggregate guard (060), and the setup version gate (069), plus fixed wrappers like 056-061 | `supabase/migrations/` | One reviewed "register sport" migration pattern per sport; migration numbers must be coordinated across the three programs |
| XS-3 | Legacy vs event capability. `LEGACY_AGGREGATE_CLOUD_SPORT_IDS` includes hockey/football/baseball; event games must fail closed out of aggregate sync | `src/lib/sportGameState/capabilities.ts` | Each sport's state normalizer must be registered before its event games exist |
| XS-4 | Roster position storage. Soccer stores `soccer:<role>` in `team_players.position`; Basketball stores free text; shared decision wants per-sport catalog + custom + Unassigned | `soccer/rosterRole.ts`, `basketball/positions.ts` | A small shared `sportPosition` helper (prefix, catalog order, custom, unassigned) used by hockey and football; baseball also needs it |
| XS-5 | Surface location helper. `soccerFieldLocation` handles normalized x/y, attacking direction, and display flip | `src/lib/soccer/field.ts` | Rink and football field reuse it directly; baseball diamond uses fixed orientation (`attackingDirection: 'unknown'`) |
| XS-6 | Anchored clock. Basketball's countdown stop-time projection (`clockProjection.ts`, `clockCommands.ts`) and Soccer's clock differ | `src/lib/basketball/`, `src/lib/soccer/live.ts` | Hockey and Football both need countdown stop-time; extract when the second consumer lands, not before |
| XS-7 | Shootout core. Soccer's shootout rounds/eligibility/sudden death | `src/lib/soccer/shootout.ts` | Hockey needs the same; Football OT is different and does not reuse it |
| XS-8 | Reusable opponent identities (Soccer S5) | Soccer backlog | Hockey/football scoresheets use opponent jersey numbers heavily |
| XS-9 | Team lineup/line defaults in `team_sport_settings` (Soccer v3 `lineupDefaults`, Basketball v2) | migrations 068, 070 | Same `{ version, starterPlayerIds }` shape; hockey adds lines, football adds depth chart, baseball adds batting order |
| XS-10 | Running-clock lineup changes | [Timing assessment](PLAN_EVENT_TIMING_AND_LIVE_LINEUPS.md) | Hockey line changes and football substitutions both happen with the clock running |
| XS-11 | Aggregate catalog + destinations pattern (`soc_*`, `bk_*`) | `soccer/aggregate*`, `basketball/aggregate*` | Add `hky_*`, football and baseball catalogs through the same private paging core |

---

## 14. Optional Future Modules (HKY-M*)

| Module | Candidate data |
|---|---|
| M1 Standings | W-L-OTL-T, points (2/1/0 or 3-2-1-0), tiebreakers (shared with Soccer M1) |
| M2 Rates | Per-game and per-60 rates once TOI is reliable |
| M3 Line changes | One-tap line swaps while the clock runs; skater TOI and shifts; complete plus/minus |
| M4 Shot detail | Shot type, rebound, rush, screened, deflection |
| M5 Net placement | Goal-mouth grid for shots on goal (Soccer S16 analogue) |
| M6 Zone entries/exits | Carry/dump/pass entries; controlled exits |
| M7 Advanced goaltending | Rebounds allowed, freezes, high-danger saves |
| M8 Expected goals | Documented model from shot location/type; never manually entered |
| M9 Full opponent roster | Opponent skater/goalie stats beyond jersey labels |
| M10 Suspension tracking | Game misconduct / match penalty eligibility across games |
| M11 Collaborative capture | Shared stream across recorders (Soccer M13) |

---

## 15. Regression Themes

Every HKY phase plan must cover:

- Soccer and Basketball trackers, summaries, cloud, and aggregates unchanged,
- legacy aggregate hockey games still open and review through the generic path,
- hockey/soccer/basketball games coexist in the parking manifest,
- local-only hockey works with Supabase unconfigured,
- park/resume preserves events, clock, penalties, goalie, direction,
- strength derivation matches the rules for common and edge cases (coincidental minors,
  PP goal release, double minor split, 5v3, empty net),
- editing/removing an event rebuilds score, goalie stats, and strength,
- opponent lightweight identities never leak into the permanent player pool,
- independent recorder streams never combine,
- viewer/scorer/admin permissions match the access matrix,
- mobile rink, dialogs, penalty box, and clock never overlap.

---

## 16. Non-Goals

- Continuous shift tracking in the core release (it is module M3).
- Full opponent rosters.
- Real-time shared multi-recorder capture.
- Referee-grade penalty bookkeeping beyond what strength and PIM need.
- Video tagging.
- Changing Soccer or Basketball behavior inside HKY PRs, except deliberate XS extractions
  that keep their tests green.

---

## 17. Resolved Owner Decisions

The owner accepted every recommendation on 2026-09-26.

| # | Question | Decision |
|---|---|---|
| Q1 | New hockey games event-only at release? | Yes. The generic stat grid stays only for opening existing hockey games |
| Q2 | First competition level? | USA Hockey youth and adult rec, with NHL as a built-in profile |
| Q3 | Recorder runs the game clock? | Anchored clock on by default; clockless games allowed |
| Q4 | Prompt for on-ice skaters on each goal (plus/minus)? | Yes, optional prompt prefilled from the last set |
| Q5 | Line changes / time on ice in the first release? | No; later as module M3 |
| Q6 | Faceoffs core in the first release? | Yes, two-tap flow |
| Q7 | Faceoff taker defaults to the last tracked center? | Yes, a deliberate exception to the shared Unattributed default |
| Q8 | Strength derived from penalties, confirmed on each goal? | Yes |
| Q9 | Ties and shootouts? | Profile-driven; ties allowed in rec/youth profiles |
| Q10 | Team default lines in the first phase? | No. Starter/Bench plus starting goalie in HKY-1; lines in HKY-2D |
| Q11 | Stats tracked on paper that are missing? | None identified; revisit after first live games |
