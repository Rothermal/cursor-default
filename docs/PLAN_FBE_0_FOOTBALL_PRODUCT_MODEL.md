# Plan: FBE-0 Football Product Model

High-level product and technical plan for bringing Football up to the level of
Soccer and Basketball: sport-specific rosters and positions, starters, a football
field playfield, and an authoritative event model. FBE-0 sets direction only. Each
phase below gets its own execution plan and owner Q&A before code work begins.

Status: proposed. No runtime behavior. Open questions for the owner are collected
in [§16](#16-open-questions-for-the-owner); the rest of the document states the
default this plan assumes until the owner answers.

Companion plans:

- [FBE-1 Rosters, positions and unit starters](PLAN_FBE_1_ROSTER_POSITIONS_AND_UNITS.md)
- [FBE-2 Play event model and situation projection](PLAN_FBE_2_PLAY_EVENT_MODEL.md)
- [FBE-3 Field playfield and live play capture](PLAN_FBE_3_FIELD_AND_LIVE_CAPTURE.md)

---

## 1. Goal

Football today is a `SportConfig` entry in `src/config/sports.ts` with five
counter categories (passing, rushing, receiving, defense, kicking) on the generic
stat grid. It has no positions, no lineup, no field, no down-and-distance, no
yardage, and it is disabled by default in `src/lib/settingsStorage.ts`.

The football program should:

- let one recorder track a tracked team's game play by play, from the sideline,
  without falling behind the snap cadence (~25–40 s between plays),
- make the **play** the unit of record, and derive down, distance, ball spot,
  possession, drives, score and every box-score stat from the play stream,
- store yardage precisely enough for real football stats (passing/rushing/receiving
  yards, returns, punts, field goals by distance) while letting the recorder skip
  detail they did not see,
- give each player a football position and each team default starters per unit
  (offense, defense, specialists), following the cross-sport roster decisions,
- provide a 100-yard field with end zones as the capture surface,
- reuse the shared event engine, cloud transport, recorder/finalization, summary
  and aggregate platforms that Soccer and Basketball already proved,
- keep existing aggregate-grid football games readable.

The existing football categories and stat ids are a baseline only. They are open
for redesign and are not requirements.

---

## 2. Why football needs its own event shape

Soccer and Basketball record **incidents**: a shot, a foul, a rebound. Each event
has one or two actors and stands mostly alone. Football is **discrete and
stateful**:

- The game advances in snaps. Every snap starts from a spot with a down, distance
  and possession, and ends at a new spot that sets the next snap's situation.
- One play produces several stats for several players at once: a completed pass is
  a passing attempt, completion and yards for the passer; a target, reception and
  yards for the receiver; a tackle for a defender; maybe a first down, a fumble, a
  recovery and a return.
- A play can change possession mid-play (interception, fumble) and score for either
  team (pick-six, scoop-and-score, safety).
- Penalties modify a play after the fact: accepted, declined or offsetting, with
  yardage from different enforcement spots and consequences for the down.
- Stat definitions depend on competition rules (for example, sack yardage counts
  against rushing in NFHS/NCAA but against team passing in the NFL).

So the football event model is **one compound `football.play` event per snap**,
with ordered segments inside it, plus a small set of non-play administrative
events. Details are in [FBE-2](PLAN_FBE_2_PLAY_EVENT_MODEL.md). This mirrors how
every football stat crew, from high-school books to NFL play-by-play, records the
game: a play-by-play log is the source; everything else is derived.

---

## 3. Product boundaries

### Detailed tracked team, simplified opponent

As in Soccer and Basketball, the tracked team gets player attribution on both
offense and defense. Opponent actors default to lightweight identities (Opponent
Team, optional jersey number). No opponent roster is required. Opponent play
yardage, score and team totals are still fully derived because they come from the
play spots, not from opponent players.

### Two capture depths, one event

Football is too fast for one person to record every defender on every play. The
same `football.play` event supports:

- **Quick:** play type, result spot (tap the field), and the key offensive actor
  if known. This alone produces score, down/distance, drives, team yardage and
  most individual offensive stats.
- **Detailed:** adds target, tacklers, pass defended, lane/depth, penalties,
  returners and so on.

Every optional field has an explicit "not recorded" state; missing detail never
becomes a fabricated value. Summaries label coverage (for example, "tackles
recorded on 38 of 61 defensive plays") rather than pretending to be complete.

### Shared management, football-specific live experience

Reuse: sport dashboard, teams/rosters, seasons, parking, cloud games, auth/roles,
settings storage, event engine, cloud transport, finalization, summary shell and
aggregate destinations.

Specialize: football positions and unit starters, rules profiles, setup (coin toss,
direction, opening kickoff), the field surface, play entry, the drive/play
timeline, football summary and stat catalog.

### Clock is optional

A running football game clock stops and restarts on many rules; tracking it
correctly is a separate job on most sidelines. The default is **quarter-only, no
running clock**: each play may carry an optional recorder-entered game-clock
snapshot (`elapsedMs` stays null otherwise). A later opt-in clock can reuse the
shared timing direction in `PLAN_EVENT_TIMING_AND_LIVE_LINEUPS.md`. Time of
possession is therefore not in the core catalog.

### Personnel tracking is optional

Football allows unlimited substitution between plays. Tracking the exact eleven
on every snap is out of scope for core capture. The lineup model is **unit
starters** (offense, defense, specialist roles) plus "appeared" derived from being
an actor or a starter. Per-play personnel is an optional later module (§9).

---

## 4. Target mental model

```text
Football game setup
  -> tracked team, opponent label, home/away/neutral
  -> rules profile (NFHS 11, NCAA, NFL-style, youth, 8-man, 6-man, flag 7v7, custom)
  -> starters per unit (offense, defense) and specialists (K, P, LS, H, KR, PR)
  -> coin toss result, tracked team's opening direction, opening kickoff
  -> football tracker
       -> situation bar: possession, down & distance, ball on, quarter, score
       -> pick play type (Run, Pass, Punt, FG, Kickoff, PAT/2-pt, Penalty only ...)
       -> tap field for result spot (snaps to yard; lane from tap)
       -> choose actors (defaults from unit starters, position order)
       -> optional: tacklers, penalty, fumble/turnover, return
       -> save one editable football.play event
       -> projection derives next down/distance/spot/possession/score
  -> timeouts, quarter end, halftime direction switch, overtime series
  -> football summary
       -> overview & scoring summary
       -> team stats (first downs, 3rd-down conversions, yards, turnovers, penalties)
       -> player box score (passing, rushing, receiving, defense, kicking, returns)
       -> drive chart and play-by-play
```

Events are the football source of truth. Totals and situation are projections.

---

## 5. Match model

### Rules profiles

Built-in, source-linked, immutable profiles (same pattern as
`src/lib/basketball/profiles.ts` and Soccer's IFAB/US HS/Custom):

| Profile | Players | Field | Key differences |
| --- | --- | --- | --- |
| NFHS 11-player (US high school) | 11 | 100 yd + 10 yd end zones | 12-min quarters; sack yards are rushing; OT from 10-yd line (state-adopted); try from 3 |
| NCAA | 11 | 100 + 10 | 15-min quarters; sack yards rushing; alternating OT from 25, 2-pt attempts from 3rd OT |
| NFL-style | 11 | 100 + 10 | 15-min quarters; sack yards are team passing; try from 15 for kick, 2 for 2-pt; modified sudden-death OT |
| Youth tackle (Pop Warner-style) | 11 | 100 + 10 (80 for some divisions) | Try point values can be inverted (kick = 2, run/pass = 1); shorter quarters |
| 8-player | 8 | 80 + 10 | Different positions in use; kick try values vary by state |
| 6-player | 6 | 80 × 40 | 15-yard first downs; FG = 4; kick try = 2, run/pass = 1; mercy rule |
| Flag / 7v7 | 5–7 | 40–70 + 10 | No kicking, no tackles (flag pulls), no-run zones, fixed possessions |
| Custom | any | configurable | Clone of any profile |

Rule fields StatKeeper needs (not a rules engine; only what the projection uses):

- players per side, field length (goal line to goal line) and end-zone depth,
- first-down distance (10, or 15 for 6-player),
- quarter count and nominal length, overtime format label,
- try spot and point values per try type (kick, run, pass),
- safety value, FG value, TD value,
- kickoff spot and touchback spots (kickoff, punt),
- sack-yardage accounting (`rushing` | `team_passing`),
- timeouts per half, whether unused timeouts carry to OT,
- flag-mode switches: kicking disabled, "tackle" labelled as "flag pull",
  no-run-zone warnings (display only).

Rule precedence matches Soccer and Basketball:
`built-in profile -> personal -> team -> match snapshot`, frozen at game start.

### Periods and overtime

Periods are `q1..q4`, then `ot-1..ot-n`. StatKeeper does not enforce overtime
formats. At an OT start the recorder picks possession and the start spot (the
profile suggests the spot). Each OT period may contain several possessions.
Halftime switches the tracked team's display direction; quarters 2 and 4 flip
automatically too (teams change ends every quarter in 11-player football).

### Field direction and coordinates

Store spots as **yards from the tracked team's own goal line** (`0` = tracked goal
line, `fieldLength` = opponent goal line; end zones are negative and above
`fieldLength`). This is independent of display direction, so flipping ends per
quarter never rewrites events. The UI renders "own 35" / "opp 20" / "ball on 50"
from this value and the possessing side. Details in FBE-2 §4.

### Outcome states

Win/loss/tie, overtime result, suspended, abandoned, forfeit (recorded as an
outcome with a note; scores are never fabricated). Mercy/running-clock rules are
labels only.

---

## 6. Rosters, positions and starters

Follows [Shared product decisions §Players and lineups](PRODUCT_AND_INTERACTION_DECISIONS.md).
Detailed plan: [FBE-1](PLAN_FBE_1_ROSTER_POSITIONS_AND_UNITS.md).

- One default position per player on the team roster, stored in
  `team_players.position` as a plain code or custom label, like Basketball's
  BAR-1 positions (the team's sport already scopes the value).
- Standard catalog grouped by unit, in actor-picker order:
  - Offense: QB, RB, FB, WR, TE, C, G, T (plus `OL` as a generic lineman)
  - Defense: DE, DT, NT, LB (OLB, ILB/MLB), CB, S (FS, SS), `DL`/`DB` generics
  - Specialists: K, P, LS, H, KR, PR
  - then custom positions, then Unassigned.
- Two-way players are normal (high school and youth). A player's default position
  is their primary position; unit membership is separate.
- Team default starters are stored **per unit**: `offense` (up to players-per-side),
  `defense` (same), and specialist role assignments (K, P, LS, H, KR, PR; each one
  player or empty). A player may be in both offense and defense starters.
- New games snapshot positions, unit starters and specialists once into setup;
  later edits in either direction do not rewrite each other.
- Actor pickers order by position within the relevant unit: when the tracked team
  has the ball, offensive starters and offensive positions first; on defense,
  defensive starters first; for kicks, the specialist first. Everyone dressed stays
  selectable because substitution is unrestricted.

---

## 7. Event catalog (summary)

Full definitions, payload shapes and projection rules live in
[FBE-2](PLAN_FBE_2_PLAY_EVENT_MODEL.md).

| Event type | Purpose |
| --- | --- |
| `football.play` | One snap or free kick: run, pass, sack, scramble, kneel, spike, punt, field goal, kickoff, onside kick, free kick after safety, try (kick / 2-pt), penalty-only (no play). Holds spots, actors, segments (fumbles, laterals, returns), penalties, and the scoring result |
| `football.situation_set` | Recorder override of possession, spot, down and distance when the derived situation is wrong or plays were missed. Never retimes earlier plays |
| `football.timeout` | Charged timeout for a side (or official's timeout) |
| `football.period_start` / `football.period_end` | Quarter/OT boundaries, halftime, direction |
| `football.coin_toss` | Winner, choice (receive/kick/defer/goal), for setup and OT |
| `football.score_adjustment` | Signed, reason-required correction, as in Soccer/Basketball |
| `football.match_end` / reopen family | Shared lifecycle via the event platform |

---

## 8. Derived stat catalog

Prefix `fb_*` for canonical aggregates (Soccer uses `soc_*`, Basketball `bk_*`).
Definitions follow NCAA/NFHS stat-crew conventions by default, with the profile
flag for sack accounting.

**Passing:** attempts, completions, yards, TD, INT, sacks taken, sack yards, long,
completion %, yards/attempt, passer rating (NCAA formula default; NFL formula when
the profile says so), 2-pt passes.

**Rushing:** attempts, yards, TD, long, yards/carry, fumbles, fumbles lost, 2-pt runs.

**Receiving:** targets (only when target was recorded), receptions, yards, TD,
long, yards/reception.

**Defense:** solo tackles, assisted tackles, total tackles, tackles for loss (and
yards), sacks (half-sacks allowed), QB hurries (optional), INT, INT return yards,
pass breakups, passes defended, forced fumbles, fumble recoveries, defensive TDs,
safeties. "Flag pulls" replace tackles in flag profiles.

**Kicking:** FG made/att by distance band (1–19, 20–29, 30–39, 40–49, 50+), long,
PAT made/att, kickoffs, touchbacks, onside attempts/recovered. FG distance =
line of scrimmage distance to goal + end-zone depth (+ 7 by default for the snap
and hold, from the profile).

**Punting:** punts, gross yards, long, net average, inside-20, touchbacks, blocked.

**Returns:** kick returns and punt returns (no., yards, long, TD), fair catches.

**Team:** points by quarter, first downs (rush/pass/penalty), 3rd- and 4th-down
conversions, total plays and yards, rushing/passing split, yards per play,
turnovers, penalties and penalty yards, red-zone trips and scores, drives
(start spot, plays, yards, result), time of possession only when a clock module
exists.

**Participation:** games played (appeared as actor or unit starter), games started
per unit. No minutes.

---

## 9. Optional future modules

Not in the core release; each needs its own plan if the owner wants it.

- Running game clock and time of possession (shared timing work).
- Per-play personnel (who was on the field) and snap counts.
- Formation/personnel groupings (11, 12, 21 ...), shotgun/under center, motion.
- Detailed pass charting (air yards, pressure, drops, YAC split).
- Play-call tagging for coaches (run concept, coverage).
- Opponent roster with player-level opponent stats.
- Standings and league tiebreakers (shared "M1 standings" module idea from Soccer).

---

## 10. Live tracker UX (summary)

Detailed plan: [FBE-3](PLAN_FBE_3_FIELD_AND_LIVE_CAPTURE.md).

- Landscape-friendly field with end zones, yard numbers and hash marks; portrait
  shows the field vertically so the phone can stay one-handed.
- A persistent situation bar: possession arrow, `2nd & 7 at OPP 34`, quarter,
  score, timeouts left.
- Line of scrimmage and first-down line drawn on the field from projection.
- Play entry is a short sheet: choose type -> tap the result spot -> confirm actor
  -> save. Detailed fields are expandable and never block save.
- Recent plays with Undo; a play-by-play Timeline tab with drives; tap any play to
  edit. Editing an earlier play re-derives every later situation.
- Surface-first per the shared decisions: no global player strip; actor defaults
  are Unattributed for the side except where a play type requires an actor.

---

## 11. Settings

Personal and team football settings reuse `user_sport_settings` /
`team_sport_settings` (migration 048) with a strict football validator, revision
CAS writes and metadata-only audit, as Soccer (SOC-6D) and Basketball (BKE-5B) do.
Team settings carry rules profile + overrides + unit starter defaults.
Device-only preferences (field orientation, detailed-by-default toggle) stay out
of fingerprints and cloud payloads.

---

## 12. Cloud, offline and security

No new transport architecture. Football events ride the existing generic
`game_events` storage, the event-platform private cores (migrations 052–059) and a
fixed football binder/readiness/finalization/reopen RPC set, matching how
Basketball was added in BKE-4. Offline-first local play, parking, multi-recorder
independence, primary selection and canonical publication behave as for Soccer and
Basketball. Access follows the access matrix (viewer read-only, scorer tracks,
owner/admin manage).

---

## 13. Legacy football games

Existing football games are aggregate-grid games (`capabilities.ts` allows
legacy aggregate sync for football). They stay readable and syncable. Default
proposal: because football is disabled by default and has no known production
users, **new football games become event-authority only at release**, without a
long-lived Legacy/Event setup choice like Basketball's. Historical grid games keep
their current Summary and aggregates; `fb_*` aggregates read only event games, and
destinations show legacy totals as a separate labelled source (the BKE-4E
pattern). Owner question Q1 confirms this.

---

## 14. Implementation roadmap

| Phase | Purpose | Primary exit condition |
| --- | --- | --- |
| FBE-0 | This product model | Owner answers §16 or accepts defaults |
| FBE-1 | Football position catalog, roster positions, unit starter and specialist defaults, team settings v1, Team Manage editors ([plan](PLAN_FBE_1_ROSTER_POSITIONS_AND_UNITS.md)) | Owners can set positions and unit starters; old football teams unchanged |
| FBE-2 | Rules profiles, `football.*` event definitions, validation, situation projector, stat projector ([plan](PLAN_FBE_2_PLAY_EVENT_MODEL.md)) | Pure library: scripted real-game play logs project to the expected box score, drives and situation, with full tests; no UI |
| FBE-3 | Football setup, field playfield, live play capture, recent plays/undo, local-only behind a dev gate ([plan](PLAN_FBE_3_FIELD_AND_LIVE_CAPTURE.md)) | A full local game can be recorded, parked and resumed on a phone |
| FBE-4 | Play-by-play/drive Timeline, revisioned edit/remove/restore/insert-missed-play, local Summary (overview, team stats, box score, drive chart) | A recorded game can be corrected and reviewed locally |
| FBE-5 | Cloud: football binder/transport adapter, recorders/primary, readiness/finalization/reopen, canonical `fb_*` aggregates and destinations | Two-device matrix passes; season/leaderboard/profile show football event stats |
| FBE-6 | Personal/team settings UI, release policy (`opt_in`), capability handshake, consolidated regression, enablement | Owner-only opt-in production release, then broader rollout decision |

FBE-4 through FBE-6 get detailed plans after FBE-2/FBE-3 land, because their
shape is largely the Soccer/Basketball pattern and will depend on what the
football projection actually emits. Every phase gets owner Q&A before code.

---

## 15. Cross-sport reuse notes

For the Hockey and Baseball programs running in parallel:

- **Roster positions:** Soccer stores `soccer:<group>` in `team_players.position`
  (fixed four groups); Basketball BAR-1 stores plain codes or custom labels
  (`src/lib/basketball/positions.ts`). Football follows Basketball's plain form
  and adds grouping by unit. New sports should follow the plain form plus a
  per-sport ordered catalog with custom and Unassigned buckets. A small shared
  helper (catalog -> picker order, custom handling, parse/serialize) should be
  extracted once a third sport needs it, per the "extract where two real uses
  share semantics" rule.
- **Unit/group starters:** Football needs starters per unit; Baseball needs a
  batting order plus defensive positions; Hockey needs lines. A shared shape is
  "named lineup groups, each an ordered list of player ids, with sport-owned
  validation" inside versioned team sport settings. Do not force it into
  Soccer's single starter list.
- **Compound events with derived game situation:** Football (down/distance/spot/
  possession) and Baseball (count/outs/base runners/batting order) both record one
  compound event per play and derive a "situation" the UI uses to prefill the
  next capture, plus a recorder `situation_set` correction event. The projector
  pattern (pure fold over plays -> per-play situation snapshots) is worth sharing
  as a convention; the payloads are not.
- **Coordinates:** the envelope's `GameEventLocation` (normalized x/y + attacking
  direction) fits Soccer and Hockey directly. Football keeps its authoritative
  spots in yard units in the payload and leaves envelope `location` null (FBE-2
  §4). Baseball will likely do the same for pitch location and batted-ball spots.
- **Rules profiles and settings:** the built-in profile -> personal -> team ->
  match hierarchy, migration 048 tables and revision CAS are sport-neutral and
  should be reused as-is.
- **Cloud and aggregates:** each sport adds fixed RPC wrappers over the shared
  private event-platform cores and its own aggregate prefix.

---

## 16. Open questions for the owner

The plans proceed on the default in brackets until answered.

1. **Legacy grid:** Are there football games you care about in the current grid
   tracker? [Default: keep them readable; new games are event-only at release; no
   Legacy/Event picker.]
2. **Competition level:** Which football do you actually track first: high school
   11-player, youth tackle, flag/7v7, or college/NFL-style? [Default: NFHS
   11-player first; other profiles as data, flag after core.]
3. **Detail level:** Do you want defensive tacklers on most plays, or is quick
   capture (type, spot, ball carrier/passer/receiver) the normal case? [Default:
   quick is normal; detailed fields optional per play.]
4. **Clock:** Is quarter-only enough, or do you need a running game clock / time
   of possession? [Default: quarter-only with optional clock snapshot per play.]
5. **Opponent players:** Do you ever need opponent player stats (e.g., their QB's
   passing), or team-level opponent totals only? [Default: team-level, optional
   jersey number on actors.]
6. **Personnel:** Do you need snap counts or who-was-on-the-field per play?
   [Default: no; unit starters and "appeared" only.]
7. **Unit starters:** Is offense + defense + specialists the right default
   structure, or do you also want kickoff/punt/return units as full lineups?
   [Default: offense and defense elevens plus single-player specialist roles.]
8. **Stat conventions:** NCAA/NFHS conventions (sacks count as rushing yards)
   unless the profile says NFL? [Default: yes.]
9. **Portrait vs landscape:** Will you record holding the phone upright?
   [Default: portrait-first with a vertical field; landscape supported.]

---

## 17. Non-goals

- A rules engine that adjudicates penalties or enforces overtime formats.
- Automatic clock management from play results.
- Every-player-every-snap personnel in core.
- Video tagging, play diagrams, or coaching play-call libraries.
- Opponent roster management in the first release.
- Merging independent recorder streams.
- Changing Soccer, Basketball or their released contracts inside FBE phases.

---

## 18. Research baseline

StatKeeper uses competition-neutral definitions and documents its exact
behavior; references inform defaults only.

- NCAA Football Statisticians' Manual (stat definitions, sacks as rushing,
  tackles/assists, passes defended, FG distance).
- NFHS Football Rules Book (11-player high school; try, overtime by state
  adoption).
- NFL Official Playing Rules and NFL stat-crew conventions (sacks as team passing,
  passer rating formula).
- National 6-man and 8-man rules variants (15-yard first downs, try values).
- USA Football / NFL FLAG rule sets (no-run zones, fixed possessions).
