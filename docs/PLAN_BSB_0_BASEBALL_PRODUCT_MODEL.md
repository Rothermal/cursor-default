# Plan: BSB-0 Baseball Product Model

High-level product and technical plan for bringing Baseball in line with Soccer and
Basketball: sport-specific rosters and positions, batting order and defensive lineup,
a diamond playfield with runners on base, pitch-by-pitch balls and strikes with pitch
location, and an authoritative event model. BSB-0 sets the stable direction; each
implementation phase below receives its own detailed execution plan and Q&A review
before code work begins, as SOC-0 and BKE-0 did.

Status: approved direction (owner answers recorded in section 16, 2026-09-26). BSB-1
implementation is in progress; build-and-test-as-we-go was approved in place of a
diamond prototype. No runtime behavior changes in this document.

Companion document: [BSB-1 execution plan](PLAN_BSB_1_EVENT_FOUNDATION.md).

---

## 1. Goal

Build a baseball-native scorekeeping experience that feels like a digital scorebook,
not a counter grid, while reusing the shared event platform proven by Soccer and
Basketball.

The Baseball program should:

- make the **diamond** the primary live workspace, with the current runners shown on
  their bases and the batter at the plate,
- record **every pitch** (ball, called strike, swinging strike, foul, in play, hit by
  pitch) with an optional **pitch location** tapped on a strike-zone pad, in the same
  spirit as Soccer's goal-mouth placement (S16),
- record the result of each plate appearance with an optional **batted-ball location**
  (spray chart) and fielder sequence (for example 6-4-3),
- **advance runners** explicitly on the diamond, with the app proposing the standard
  movement and the recorder confirming or correcting it,
- derive balls, strikes, outs, base state, half-innings, score, line score and every
  batting, pitching and fielding total from events rather than mutable counters,
- support youth, high school, college and adult rule variations through rule profiles,
- work offline, park/resume like other sports, and later sync through the shared
  event cloud platform with independent recorder streams and canonical finalization.

The current Baseball entry in `src/config/sports.ts` (hitting, plate discipline,
baserunning and fielding counters on the generic stat grid) is a legacy baseline.
Its stat ids and categories are not requirements for the event model.

---

## 2. Why Baseball Is Different

Soccer and Basketball are continuous-clock sports where most events are independent
"something happened at this spot" facts. Baseball is a **discrete state machine**:

| Concern | Soccer / Basketball | Baseball |
| --- | --- | --- |
| Time | Game clock, periods, elapsed time | No game clock. Innings split into top/bottom halves; ordering is capture sequence |
| Unit of play | Shot, foul, substitution | Pitch, inside a plate appearance, inside a half-inning |
| State between events | Score, lineup, clock | Count (balls/strikes), outs, runners on each base, batting-order position, defensive alignment, pitcher of record |
| Event validity | Mostly local (actor eligible, period started) | Depends on prior state: a runner can only leave a base he occupies; a strikeout only on strike three; a half ends on the third out |
| Both teams | Tracked team detailed, opponent lightweight | Tracked pitchers' and fielders' stats come from **opponent** plate appearances, so opponent batters need identity (at least batting-order slots) |
| Surface | One location per event | Two spatial facts: batted-ball landing spot on the field, and pitch location in the strike zone |
| Corrections | Usually local | Changing one out or one runner movement can cascade through the rest of the half-inning |

Consequences for the design:

- The projection engine is the heart of the sport. Base/out/count state must be
  replayed deterministically and every command validated against it.
- Capture must be fast enough to keep up with pitches. The pitch pad and "ball in
  play" sheet are the two hot paths.
- Timeline correction needs dependency-aware reprojection that can explain which later
  events a change invalidates, as Basketball's Timeline corrections do.
- Clock work (BKE-6, Soccer anchored clock) is mostly irrelevant. Baseball is the
  first **clockless-by-design** event sport; `elapsedMs` stays `null`.

---

## 3. Product Boundaries

### Detailed tracked team, lightweight-but-ordered opponent

The tracked team receives full player attribution for batting, running, pitching and
fielding. The opponent is represented by **batting-order slots** (1..N) with optional
jersey number and name labels, plus an opponent pitcher identity (label and optional
number) that changes on pitching changes. No opponent `players` rows are created.

Rationale: a tracked pitcher's line (batters faced, hits, walks, strikeouts, runs) and
the diamond's "runners in position" both need to know *which* opponent batter or
runner is involved. A slot identity is enough for that without inventing a roster.
Opponent per-batter review is available in the game only; opponent identities never
enter season aggregates or the permanent player pool. (Open question Q1 asks whether
Mark wants full opponent scorebook detail instead.)

### Shared management, baseball-specific live experience

Reuse: sport dashboard, teams, rosters, seasons, invites/roles, local parking,
Cloud Games, Game Info, settings shell, setup draft storage, `ActorSelect`, dialog
framing, read-only notices, and the shared event platform (`src/lib/gameEvents/`).

Specialize: rules profiles, lineup/batting-order setup, diamond tracker, pitch pad,
plate-appearance and runner commands, Timeline, Summary (box score, line score,
spray chart, pitch plots), aggregates, and settings.

### Scope of the first release

Core scorekeeping (what a careful parent or team scorer records in a paper
scorebook, plus pitch location) is in scope. Pitch type, velocity, exit velocity,
win probability, and video are later modules or excluded (section 11).

---

## 4. Target Mental Model

```text
Baseball game setup
  -> tracked team Home or Away, opponent name, rules profile
  -> tracked batting order + defensive positions (from roster defaults)
  -> opponent batting-order slots (count only, optional labels)
  -> starting pitchers
  -> Play Ball (top of 1st)
  -> baseball tracker
       scoreboard strip: inning/half, score, count, outs, pitch count
       diamond: batter + runners on bases, fielders by position
       pitch pad: tap strike-zone location, choose Ball / Strike (called|swinging)
                  / Foul / In play / HBP
         -> ball 4 / strike 3 / HBP resolve the plate appearance automatically
         -> In play opens the play sheet:
              tap landing spot on field (optional)
              choose result (1B 2B 3B HR, ground/fly/line/pop out, error, FC, sac...)
              tap fielders for the sequence (6-3)
              confirm runner movements on the diamond (app proposes defaults)
       tap a runner between pitches: steal, caught stealing, pickoff, advance on
         wild pitch / passed ball / balk / error, pinch runner
       Manage Lineup: pinch hitter, pinch runner, defensive switch, pitching change
       third out -> half-inning ends automatically -> next half opens
       game end: regulation complete, walk-off, run rule, time limit, suspended
  -> Timeline (play-by-play, grouped by half-inning) with corrections
  -> Summary: line score, box score, batting/pitching/fielding, spray chart,
     pitch location plots, play-by-play
```

Events, not counters, are the source of truth.

---

## 5. Match Model

### 5.1 Innings and halves

- A game has `scheduledInnings` (profile default: MLB/NCAA 9, NFHS 7, Little League
  Majors 6). Each inning has a top (away bats) and bottom (home bats) half.
- Period id format: `inning-{n}-top` / `inning-{n}-bottom`, with `order = 2n - 1`
  and `2n`. Extra innings continue the same scheme.
- Tracked team side is **Home or Away** and is required at setup (a neutral-site game
  still designates who bats last). This fixes which halves the tracked team bats.
- A half-inning ends automatically when the projection reaches three outs, or through
  an explicit `half_inning_end` event with a reason for non-out endings (max runs per
  half in youth rules, run rule, time limit, walk-off).
- The bottom of the final scheduled inning is skipped (not played) when the home team
  leads after the top. Walk-off ends the game as soon as the home team takes the lead
  in the bottom of the final or an extra inning; the recorder confirms the end.
- Extra-inning placed runner ("ghost runner", MLB and NFHS tiebreaker variants) is a
  rules option: the half opens with the previous-order batter placed on second (or
  profile-defined base). The placed runner's run is unearned.

### 5.2 Count, outs and plate appearance

- The count resets at each plate appearance. Balls to walk and strikes to strikeout
  default to 4 and 3; profiles may change them (coach-pitch/machine-pitch variants).
- A foul with two strikes does not add a strike; a foul bunt with two strikes is a
  strikeout (profile option); a foul tip caught with two strikes is a strikeout.
- The plate appearance ends on walk, strikeout, hit by pitch, ball in play, catcher's
  interference, or an out/advance that ends the half before the batter finishes
  (the batter then leads off the next inning with a fresh count).
- Batting order is enforced: the next batter is derived from the lineup. Batting out
  of order is recorded as a correction/appeal event rather than silently allowed.
- Dropped third strike: strikeout credited to the pitcher, batter-runner may reach on
  wild pitch, passed ball, error or fielder's choice (profile option; off for young
  youth levels).

### 5.3 Base state and runners

Projection maintains, after every event:

```text
bases: { first, second, third } -> RunnerRef | null
RunnerRef
  identity        tracked participantId or opponent slot id
  responsiblePitcher   pitcher charged if this runner scores (inherited runners)
  reachedBy       hit | walk | hbp | error | fielders_choice | dropped_third_strike
                  | catcher_interference | placed_runner | ...
  earnedEligible  whether a run by this runner can be earned (before recorder override)
```

Every runner movement is explicit in the event that caused it:

```text
RunnerMovement
  runner          batter or RunnerRef identity
  from            batter | first | second | third
  to              first | second | third | home | out
  reason          on_play | forced | stolen_base | wild_pitch | passed_ball | balk
                  | error | throw | defensive_indifference | pickoff | caught_stealing
                  | appeal | interference | obstruction | awarded | placed ...
  outNumber?      1..3 when to = out
  fielders?       position sequence for the putout/assists (e.g. [2, 6])
  errorBy?        fielder position when the movement came from an error
  earned?         recorder override for runs; default derived
  rbi?            recorder override; default derived
```

Validation rejects a movement from an empty base, two runners ending on one base,
passing a preceding runner, more than three outs, or a half-inning that continues
after the third out. Runners never "teleport": a missing movement means the runner
stayed put.

### 5.4 Lineups, positions and substitutions

- Positions: P(1), C(2), 1B(3), 2B(4), 3B(5), SS(6), LF(7), CF(8), RF(9), plus DH and
  profile-dependent EH (extra hitter), and custom labels (for example "Rover" or
  "Short fielder" in youth play). Defensive notation uses the 1–9 numbers.
- Batting order length is 9 by default; profiles allow DH (10 players, pitcher does
  not bat), EH (10–11 batters), or a **continuous batting order** (every rostered
  player bats; defensive substitutions are free). Youth leagues commonly use the
  continuous order.
- Substitution kinds: pinch hitter, pinch runner, defensive replacement, position
  switch (no roster change), pitching change, DH forfeiture (pitcher/DH moves),
  courtesy runner (NFHS: for pitcher/catcher, does not count as a substitution).
- Re-entry is a rules option: none (MLB/NCAA), starters may re-enter once in their
  original batting slot (NFHS), or unlimited (continuous youth).
- Opponent substitutions change slot labels only, plus opponent pitching changes.
- Team roster defaults follow the app-wide rule: one default position and Starter/
  Bench per player on the team roster (`team_players.position`, namespaced like
  Soccer's `soccer:*` values), plus a **default batting order** in team settings.
  New games snapshot defaults; in-game changes never write back.

### 5.5 Outcomes

Regulation win/loss; extra-inning win/loss; tie (profile-allowed, for time limits or
darkness); run-rule win/loss with the inning it applied; forfeit; suspended (resume
later from exact state); abandoned. Final score is derived; a reasoned score
adjustment event exists for recorder error recovery and forfeits.

---

## 6. Event Catalog

All events use the shared `GameEvent` envelope with `sportId: 'baseball'`.
`teamSide` is the **batting** side for offensive events (`tracked` when the tracked
team bats) and `neutral` for lifecycle events. `elapsedMs` is `null`. The envelope
`location` is the batted-ball landing spot in the fixed diamond frame (section 8).
Pitch location lives in the payload.

| Event type | Purpose | Key payload |
| --- | --- | --- |
| `baseball.game_start` / `baseball.game_end` | Lifecycle; end carries structured outcome and reason | outcome, reason |
| `baseball.half_inning_end` | Only for non-three-out endings; three-out endings are derived | reason |
| `baseball.pitch` | One pitch and anything that happened on it | result, pitchLocation?, runner movements (steals, WP/PB during the pitch), inPlay? |
| `baseball.plate_appearance` | Quick path when pitches were not tracked: records the PA result with optional final count | result, battedBall?, movements |
| `baseball.baserunning` | Between-pitch running: pickoff, balk, stolen base recorded separately, advance on error, appeal out | movements |
| `baseball.substitution` | Pinch hitter/runner, defensive change, position switch, pitching change, courtesy runner, re-entry | changes[] |
| `baseball.lineup_correction` | Batting out of order, fixing a lineup mistake without rewriting history | details |
| `baseball.score_adjustment` | Reasoned adjustment, forfeit | delta, reason |

### 6.1 Pitch results

`ball`, `called_strike`, `swinging_strike`, `foul`, `foul_tip` (caught),
`foul_bunt`, `missed_bunt`, `in_play`, `hit_by_pitch`, `intentional_ball`,
`pitchout`, `balk_pitch` (balk on the delivery), `no_pitch` (for record only), plus
the non-pitch plate appearance endings `intentional_walk` (automatic) and
`catcher_interference`. Pitch-clock/illegal-pitch violations (MLB 2023+) are an
optional profile rule, not core.

Terminal results resolve automatically: fourth ball = walk (BB), third strike =
strikeout (K swinging or looking), HBP. On `in_play` the same event carries the
batted-ball result:

```text
inPlay
  battedBallType   ground | line | fly | popup | bunt | unknown
  result           single | double | triple | home_run | ground_rule_double
                   | out | error | fielders_choice | sacrifice_bunt | sacrifice_fly
                   | double_play | triple_play | inside_the_park_home_run | interference
  fielders         position sequence for the putout/assists; first fielder to touch
  errorBy?         position(s) charged
  hitDecision      recorder's hit/error judgement is explicit, never inferred
```

The envelope `location` carries the landing or fielding spot when tapped.

### 6.2 Pitch location

`pitchLocation` is optional and stored in a **strike-zone frame from the catcher's /
umpire's view**: `x` 0..1 spans the plate width from the catcher's left to right, `y`
0..1 spans the zone from top to bottom, and values in `-0.75..1.75` represent pitches
outside the zone so balls can still be placed. Batter handedness is stored on the
plate appearance so inside/outside can be derived for either side. The pad suggests
Ball or Strike from location but the **umpire's call is the recorded result**; the
location never overrides it. Precedent: Soccer's S16 goal-mouth placement.

### 6.3 Derived, not captured

Outs, count, base state, runs, RBI, earned/unearned, left on base, half-inning
changes, batting-order position, pitcher of record, pitch counts, and all rate stats
are projection outputs. RBI and earned-run defaults follow the scoring rules in
section 7 with explicit per-movement overrides for scorer judgement.

---

## 7. Derived Stat Catalog

Aggregate ids use the `bsb_*` namespace (Soccer uses `soc_*`, Basketball `bk_*`).

### Batting
PA, AB, H, 1B, 2B, 3B, HR, R, RBI, BB, IBB, HBP, K (swinging/looking split), SH (sac
bunt), SF, ROE (reached on error), FC, GIDP, TB, LOB, pitches seen; AVG, OBP, SLG, OPS.
Spray chart and batted-ball type mix where locations exist.

### Baserunning
SB, CS, picked off, advanced on WP/PB/error (review only).

### Pitching
Outs recorded (IP displayed as `6.2`), BF, pitches, strikes, balls, first-pitch
strikes, H, R, ER, BB, IBB, K, HBP, WP, BK, HR allowed, inherited runners and
inherited runners scored; ERA (profile innings), WHIP, K/9 or K/7, strike %,
first-pitch-strike %. Pitch-location plots by result and batter handedness.

Pitcher decisions (W, L, SV, HLD) follow official scoring rules that need game-
context judgement. First release: **manual assignment at finalization with a
suggested default** derived from pitcher of record and lead changes. (Q7.)

### Fielding
PO, A, E, DP participated, TC, FPCT; catcher PB, SB allowed, CS; pitcher pickoffs.

### Team / game
Line score (R per inning, R/H/E), LOB, team pitching/batting totals, pitch counts per
pitcher for both sides (opponent pitchers by label, for pitch-count rules).

### Earned runs

A run is unearned by default when the scoring runner reached on an error, catcher's
interference or as a placed runner, or advanced to score only because of an error or
passed ball. Full official reconstruction ("replay the inning without errors") is
**not** automated in the first release; every scoring movement carries an `earned`
override the recorder can set. A later module may add reconstruction.

---

## 8. Playfield and Interaction

### 8.1 Diamond surface (primary workspace)

- Fixed frame, no direction flip: home plate at bottom center, second base above it,
  outfield fan to the top. Normalized coordinates with home at `(0.5, 0.95)`; the
  frame covers foul territory so foul pops and fair/foul lines can be placed.
- Always shows: batter (name, slot, handedness), runners on first/second/third as
  chips on the bases, the nine defensive positions as small markers (tracked defense
  shows players; opponent defense shows position numbers).
- Tap a **runner chip** between pitches to act on that runner (steal, caught stealing,
  pickoff, advance on WP/PB/balk/error, pinch runner, out on appeal).
- After In play: tap the **field** to place the batted ball (optional; "Location
  unknown" always available), then tap **fielder markers** to build the sequence.
- Runner resolution step: the diamond shows every runner's proposed destination
  (forced advances plus the result's default, e.g. single moves each runner one base,
  double two, home run all). The recorder taps a runner to cycle its destination
  (stay / next base / ... / home / out), marks outs with a fielder sequence, then
  confirms. One confirm writes one atomic event.
- Envelope `location.attackingDirection` is `'unknown'` for baseball (fixed frame).
  See cross-sport notes; Hockey/Football may want the same neutral value.

### 8.2 Pitch pad

- Strike-zone rectangle with a surrounding ball region, oriented from the catcher's
  view, labeled for batter handedness.
- One-handed flow: tap location (optional) then a result button, or tap a result
  button directly to skip location. A persistent "Track pitch location" preference
  hides the zone for faster entry.
- Count, outs, pitch count for the current pitcher, and the mini-diamond stay visible.
- Undo removes the most recent pitch (grouped capture), like Basketball's quick Undo.

### 8.3 Other controls

- Scoreboard strip with line score, current half, count and outs.
- Manage Lineup: batting order card list (current batter highlighted), defensive
  diagram, bench, substitution flows. Tapping a lineup card opens game details for
  that participant (shared product decision), not a substitution.
- Quick PA mode for untracked pitches and catching up.
- Opponent batter labeling inline ("#12 Garcia") without leaving the pitch flow.

### 8.4 Summary views

Overview (line score, result, decisions), Box score (batting, pitching, fielding for
the tracked team; opponent batting by slot), Play-by-play (half-inning groups),
Spray chart (filters: batter, result, batted-ball type, side), Pitch plots (filters:
pitcher, result, batter hand, count), Pitch counts.

---

## 9. Rules Profiles and Settings

Profiles follow Basketball's immutable source-linked profile records (BKE-5A) and
the personal -> team -> match layering used by both sports. Candidate profiles:

| Profile | Innings | Batting | Re-entry | Notable options |
| --- | --- | --- | --- | --- |
| MLB | 9 | 9 + DH | None | Placed runner in extra innings, pitch clock (optional), no ties |
| NCAA | 9 | 9 + DH | None (DH rules) | Run rule optional, 7-inning doubleheaders |
| NFHS (US High School) | 7 | 9 + DH, optional EH | Starters once | Courtesy runners, run rule 10 after 5 / 15 after 3, international tiebreaker |
| Little League Majors | 6 | Continuous or 9 | Mandatory play / re-entry | Pitch count limits and rest days, no leading off, 10-run rule after 4 |
| Youth coach/machine pitch | 4–6 | Continuous | Free | Max runs per half, no stealing, no walks/strikeouts variants, no dropped third strike, time limit |
| Softball fastpitch (NFHS) | 7 | 9 + DP/FLEX, optional extra player | Starters once | No leading off, courtesy runners, dropped third strike, international tiebreaker |
| Softball slowpitch (USA/ASA-style) | 7 | 10 + extra hitters | Starters once | Starts at 1-1 count, no stealing/leading off, foul with two strikes is out (option), max runs per half, home-run limit (option) |
| Custom | any | any | any | All options editable |

Settings groups (not per-stat toggles): innings and extra innings, batting order
format (9 / DH / EH / continuous), substitution and re-entry, counts (balls/strikes
to walk/strikeout, two-strike foul-bunt), running (stealing, leading off, dropped
third strike, balks), game-ending rules (run rule, max runs per half, time limit,
ties), pitch-count tracking and warnings, and capture preferences (track pitch
location, track batted-ball location, quick PA default). Pitch-count and rest-day
**warnings** are advisory; enforcement is out of scope (Q9).

---

## 10. Cloud, Offline and Security Direction

Same invariants as SOC-0 section 11 and BKE-4:

- Works without Supabase; the event stream lives inside the parked local game.
- Baseball, Basketball and Soccer games park and resume independently.
- Cloud transport reuses the BKE-4A private event-platform cores. New work is
  sport-bounded: add `baseball` to the canonical-publication allow-list (migration
  054 hard-codes `('soccer', 'basketball')`), fixed Baseball binder/readiness/
  finalization/reopen wrappers, and a Baseball finalization policy (terminal outcome
  required, exact checkpoint, primary recorder).
- Independent recorder streams, primary resolution and canonical publication work as
  for Basketball. No shared live stream.
- Legacy aggregate Baseball games (generic grid, `game_stats`) remain readable and
  keep snapshot sync (production holds one such game as of 2026-09-26); event games never dual-write legacy stats.
- Existing access model: owner/admin finalize and reopen, scorers track, viewers read.

---

## 11. Optional Future Modules and Non-Goals

Later modules (reserve payload room, do not build in core): pitch type and velocity;
batted-ball exit velocity/launch angle; catcher framing; defensive shifts and custom
fielder positioning; full earned-run reconstruction; automated pitcher decisions;
pitch-count rest-day enforcement across games; standings; spray-chart based shift
suggestions; softball-specific rules (see Q2); collaborative two-recorder scoring.

Non-goals: video tagging, radar integration, WAR-style advanced metrics, inferred
pitch location, and full opponent rosters in the permanent player pool.

---

## 12. Implementation Roadmap

Each phase gets its own `docs/PLAN_BSB_*` execution plan and Q&A before code.
Phases follow the SOC/BKE pattern: pure engine first, then local UI, then cloud,
then summary/aggregates/release. Baseball stays behind a development-only gate
until BSB-7, and existing legacy Baseball games stay untouched throughout.

| Phase | Purpose | Exit condition |
| --- | --- | --- |
| BSB-1 | Event foundation ([plan](PLAN_BSB_1_EVENT_FOUNDATION.md)): rules v1/profiles, setup snapshot, participants and opponent slots, event definitions, base/out/count/half-inning projection, derived box stats, checked commands | A complete game can be built and replayed from commands in tests with deterministic projection; no UI |
| BSB-2 | Roster positions, team defaults and game setup: baseball position catalog on Team Manage, default batting order in team settings (migration), setup flow with Home/Away, profile review, batting order and defensive editor, opponent slots, dev-gated event game start | A local event game starts from team defaults and reloads/parks safely |
| BSB-3 | Live tracker: diamond surface, scoreboard, pitch pad with location, ball-in-play sheet with spray location and fielder sequence, runner resolution, between-pitch runner actions, half-inning/game end | A full local game can be scored pitch by pitch on a phone |
| BSB-4 | Lineup management and corrections: substitutions (PH/PR/defense/pitching/courtesy/re-entry), quick Undo, play-by-play Timeline, dependency-aware edit/remove/restore with cascade preview, quick PA catch-up | Any recorded mistake can be corrected without corrupting later state |
| BSB-5 | Summary: line score, box score, play-by-play, spray chart, pitch plots, pitch counts, decisions assignment | A finished local game has a complete reviewable Summary |
| BSB-6 | Cloud: sport-bounded migrations for binder/allow-list/readiness/finalization/reopen, transport routing, recorders and primary, canonical publication | Two-device live matrix passes; finalized canonical games review read-only |
| BSB-7 | Aggregates, settings sync and release: `bsb_*` aggregate engine and destinations (Leaderboard, Team/Tournament stats, Player Profile, Career), personal/team settings sync, release capability handshake, opt-in production stage | Baseball can be enabled as an owner-only opt-in without regressing other sports |

Likely slicing inside large phases: BSB-3A pitches and plate appearances, BSB-3B
runner resolution and between-pitch running; BSB-4A substitutions, BSB-4B Timeline
corrections. BSB-3 is the riskiest UX phase and should include an early browser
prototype of the diamond and pitch pad before command wiring (Q10).

---

## 13. Cross-Sport Notes (for Hockey and Football planning)

Shared abstractions that appeared while planning Baseball. Extract only when two real
uses share semantics (product decisions rule). The Hockey plan
(`PLAN_HKY_0_HOCKEY_PRODUCT_MODEL.md`, section "Shared cross-sport work") numbers these
items XS-1..XS-11; the matching id is given in brackets so all three programs reference
the same item. Migration numbers are left unassigned because they will collide across
the three programs.

1. **[XS-4, XS-9] Roster positions and Starter/Bench defaults** are already the app-wide rule.
   Each sport needs a namespaced `team_players.position` catalog, a team-settings
   schema bump, and setup snapshotting. Baseball adds a *batting order* default;
   Football may add depth-chart units; Hockey matches Soccer (lines are the analog).
2. **[XS-2] Event platform allow-list.** Adding a sport means editing
   `is_event_platform_sport` (051), the publication `sport_id` check (054, currently
   `('soccer', 'basketball')`), the aggregate guard (060) and the setup version gate
   (069), and each sport added fixed wrappers (binder, readiness,
   finalization, reopen, aggregates). Three new sports would triple that pattern.
   Propose one shared decision before any of BSB-6 / Hockey / Football cloud phases:
   either keep fixed per-sport wrappers (auditable, more migrations) or add a
   sport-policy table driving the private cores. Recommended: keep fixed wrappers but
   widen the allow-list in a single migration when the first new sport reaches cloud.
3. **[XS-3, XS-6] Clockless periods.** Baseball needs no anchored clock (XS-6), but
   must register its state normalizer so event games fail closed out of legacy
   aggregate sync (`LEGACY_AGGREGATE_CLOUD_SPORT_IDS` includes baseball, XS-3).
   Baseball uses `elapsedMs: null` and sequence ordering with
   derived period advancement. Football has a clock but down/distance state; its
   projection may share Baseball's "state machine validated per event" pattern.
4. **[XS-5] Location frame.** `GameEventLocation.attackingDirection` is `left_to_right |
   right_to_left | unknown`. Baseball uses `unknown` with a documented fixed frame.
   Football (yard-line field with direction) fits the existing enum; Hockey fits it
   like Soccer.
5. **Secondary placement in payload.** Soccer goal-mouth placement and Baseball pitch
   location are both "second spatial fact in a sport-defined frame". A shared
   presentational placement pad (frame, tap, clear, keyboard alternative) could be
   extracted once both exist; semantics stay sport-owned.
6. **[XS-8] Opponent identities.** Baseball's opponent batting-order slots overlap
   with reusable opponent identities (Soccer S5); a saved opponent lineup would
   prefill slot labels.
7. **Surface-first workspace.** Diamond, rink and gridiron all fit the approved
   "surface is primary, compact controls for unlocated facts" model and shared
   workspace/side-selection/lineup-card framing.
8. **[XS-11] Aggregates.** `bsb_*` follows the `soc_*` / `bk_*`
   aggregate pattern through the same private paging core.
9. **Rules profiles.** BKE-5A immutable source-linked profiles plus personal/team/
   match layering fit every sport; the settings tables (`user_sport_settings`,
   `team_sport_settings`) need per-sport validators.
10. **[XS-1] Release gating.** `src/lib/sportAvailability.ts` separates release stage from
   device permission and existing-record access; each new event sport needs its own
   creation policy plus the release-entry guard tests used by Soccer and Basketball.

---

## 14. Regression Themes

Every BSB implementation plan covers: legacy Baseball grid games unchanged; Soccer and
Basketball unchanged; parking with mixed sports; local-only Baseball; deterministic
replay of base/out/count state; cascade correction integrity; opponent slot identities
never entering the player pool; access roles; recorder isolation; mobile layout of the
diamond, pitch pad and sheets at 390px in both themes.

---

## 15. Research Baseline

StatKeeper documents its own competition-neutral definitions; references inform them.

- MLB Official Baseball Rules, including Rule 9 (Official Scorer):
  `https://www.mlb.com/glossary/rules` and the annual OBR PDF.
- NFHS Baseball Rules (US high school): re-entry, courtesy runners, run rule, tiebreaker.
- NCAA Baseball Rules Book.
- Little League Baseball Rules and Pitch Smart / pitch-count regulations.
- Retrosheet event file and scoring conventions (play notation, fielder numbers):
  `https://www.retrosheet.org/eventfile.htm`

---

## 16. Owner Decisions and Remaining Defaults

Mark answered on 2026-09-26 (he is currently the only app user):

1. **Opponent detail: batting-order slots**, each with optional position, name and
   number. No full opponent scorebook, no opponent season stats.
2. **Softball: a Baseball rule profile** (fastpitch and slowpitch), not its own sport.
   Rules therefore need softball-relevant options (7 innings, no-leading-off, courtesy
   runners, DP/FLEX and extra-player batting slots, slowpitch start counts). BSB-1 ships
   the profiles; softball-only field geometry is a later BSB-3 option.
3. **Primary level: youth and high school.** NFHS and youth profiles are the defaults
   and ship first; MLB/NCAA remain available.
10. **No prototype.** Build and test as we go.

Remaining questions proceed on the recommended default unless Mark changes them:

4. Pitch tracking on by default, Quick PA path for untracked pitches.
5. Pitch location optional per pitch on a catcher's-view zone; no pitch type yet.
6. Batted-ball location optional; fielder sequence required for outs, optional for hits.
7. Pitcher decisions suggested and recorder-assigned at finalization.
8. Derived unearned flags plus manual override; no full earned-run reconstruction.
9. Per-pitcher pitch counts with advisory profile limits; no cross-game rest enforcement.
11. Continuous batting order ships in BSB-1 (youth levels need it).
12. Keep the generic grid as Legacy mode alongside the event tracker.
