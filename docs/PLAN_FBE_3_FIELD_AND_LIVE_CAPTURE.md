# Plan: FBE-3 Football Field Playfield and Live Play Capture

Execution plan for football game setup, the field surface and play-by-play live
capture on a phone. Local-only, behind a development/device gate until FBE-6.
Parent: [FBE-0](PLAN_FBE_0_FOOTBALL_PRODUCT_MODEL.md). Depends on FBE-1 (positions
and unit starters) and FBE-2 (events and projection).

Status: proposed; awaiting owner Q&A.

---

## 1. Goal

A single recorder can record a full football game on a phone, keep pace with the
snap cadence, and end with correct score, down/distance history, drives and box
score. Quick capture of a normal play takes three taps: play type, result spot,
Save (actor prefilled only where the shared decisions allow, see §5).

---

## 2. Routes and gating

Follow the Soccer pattern (`SoccerGameSetup`, `SoccerPlayerSetup`,
`SoccerGameTracker`): an active football event game routes `/setup`, `/players`,
`/game` to `FootballGameSetup`, `FootballPlayerSetup`, `FootballGameTracker`.
Existing aggregate football games keep the generic grid routes. Creation of event
games is gated by a football release policy in `src/lib/sportAvailability.ts`
(`internal` until FBE-6). No cloud writes: football event games are local-only in
FBE-3 (`cloudSync.eventCloudPolicy` local-only, the BKE-5C3 pattern).

---

## 3. Setup

1. **Game info:** opponent display name/nickname (existing side nicknames),
   tracked side home/away/neutral, date, team/season if cloud team.
2. **Rules:** pick profile; show a compact review of the fields the projection
   uses (field length, first-down distance, try values, sack accounting,
   quarters). Custom overrides are sparse. Frozen into the setup snapshot at start.
3. **Players:** dressed players from the roster (local or cloud snapshot), each
   with position; Offense and Defense starter columns and specialist roles
   prefilled from FBE-1 defaults; late players can be added during the game.
4. **Coin toss:** who won, their choice, which goal the tracked team defends first
   (sets display direction), who kicks off. Appends `football.coin_toss` and the
   q1 `period_start`, then presents the opening kickoff as the pending play.

---

## 4. The field surface

### Geometry

- Field drawn from rules: `fieldLength` + two end zones; yard lines every 5, yard
  numbers every 10, hash marks every yard, goal posts. 80-yard, 6-player (40 wide)
  and flag fields render from the same geometry.
- Portrait (default): the field runs vertically; the tracked team's attacking
  direction is **up** for the current period by default so "forward" is always up
  for the recorder's own offense. A display-only flip is available and persists
  per device like Basketball's court orientation.
- Landscape: horizontal field, same rules.
- The tap target maps to a spot in the tracked frame (FBE-2 §4): the long axis
  snaps to the nearest yard; the short axis maps to `left | middle | right` using
  the hash marks.

### Overlays from projection

- Line of scrimmage (blue) and line to gain (yellow), or "& Goal".
- Ball marker at the current spot; possession arrow.
- During play entry: a ghost line from snap to the tapped end spot with the gain
  (`+7`, `-3`) and "1st down" when it crosses the line to gain.
- Current drive's plays as a thin chain of segments (toggle).

### Precision controls

Tapping is fast but coarse on a phone. After a tap, a spot chip shows
`OPP 34 (+7)` with `-1` / `+1` steppers and a numeric keypad option ("gain of 7"
or "ball on opp 34"). The recorder can skip the field entirely and type the gain.

---

## 5. Play entry flow

A bottom sheet with the situation header: `2nd & 7 · OPP 34 · Q2`.

1. **Type row** (context-adaptive from projection):
   - Tracked or opponent offense normal down: Run, Pass, Sack, Punt, Field goal,
     Penalty, More (scramble, kneel, spike).
   - `tryPending`: Kick try, 2-pt run, 2-pt pass.
   - `kickoffPending`: Kickoff, Onside, (Free kick after safety).
   - 4th down reorders Punt/Field goal first.
2. **Result:** tap the field for the end spot (or keypad). Pass asks Complete /
   Incomplete / Intercepted first; incomplete defaults the end to the snap.
   Kicks ask the kick result, then the return end spot when returned.
3. **Actors:** one primary actor picker per play type (rusher, passer + target,
   kicker/punter + returner). Per the shared decisions, pickers default to
   **Unattributed** for the side; the unit's starters are listed first by
   position, then the rest of the dressed roster, then Unattributed. Specialists
   are prefilled only for kick plays where the team set one (a kicker kicking is
   not a hidden capture target; it is the specialist role for that play type).
   *Owner question Q3.*
4. **Details (collapsed):** tacklers (multi-select, solo vs assisted), pass
   defended, sack credit (full/half), fumble (fumbler, forced by, recovered by
   side and player, recovery spot), lateral, penalty (below), first-down override,
   note, optional game-clock snapshot.
5. **Save** appends one `football.play` through a checked command
   (`src/lib/football/live.ts`), exactly like `soccer/live.ts`. The projection
   updates the situation; the sheet closes; a toast shows the result
   ("Run +7 · 1st down") with Undo.

Scoring is proposed, not asked: an end spot in the end zone offers
"Touchdown?" (default yes); a sack/run ending in own end zone offers "Safety?".

### Penalties

- A Penalty chip opens a catalog list (false start, offside/encroachment,
  holding, pass interference, personal foul, roughing the passer, facemask,
  illegal block, delay of game, unsportsmanlike, custom) filtered by side.
- Each catalog entry carries default yards and flags (auto first down, loss of
  down, spot foul). The recorder picks accepted/declined/offsetting and confirms
  the resulting spot; the app suggests the enforced spot from the catalog.
- Penalty-only (pre-snap) is a `no_play` kind with no other fields.

### Timeouts, quarters, overtime

- Situation bar buttons: Timeout (tracked / opponent), End quarter.
  End of q2 proposes halftime and the second-half kickoff; End of q4 with a tie
  offers Overtime (start spot from profile via `situation_set`) or End game.
- A "Fix situation" action opens the `situation_set` form (possession, spot,
  down, distance, reason) for missed plays.

---

## 6. Tracker layout

- Sticky top: score (tracked vs opponent display names), quarter, timeouts,
  situation (`3rd & 4 · OWN 46`).
- Main: field (Track tab) / Plays tab (drive-grouped play-by-play, FBE-4 adds
  editing) / Box tab (live team and player totals, read-only).
- Bottom: primary "Record play" button plus the three most likely play types as
  shortcuts; Undo opens Recent Events (shared `RecentEventsPopup` pattern).
- No global player strip (shared decisions).

---

## 7. Parking, persistence, fingerprints

- Uses local multi-game parking unchanged; football state joins the
  `sportGameState` union with fingerprinting of setup and events.
- Device-only preferences (field orientation, details expanded by default) stay
  out of fingerprints and cloud payloads.
- Park/resume/reload preserve events, pending sheet drafts are discarded with a
  confirmation.

---

## 8. Slices

| Slice | Content | Exit |
| --- | --- | --- |
| FBE-3A | Field geometry + SVG component, tap -> spot mapping, orientation, dev preview route (`#/dev/football-field`, like the shot-chart preview) | Visual checks at 390/1280, both themes |
| FBE-3B | Setup (info, rules review, players/units, coin toss) and atomic game start | Setup snapshot round-trips park/resume |
| FBE-3C | Play entry for scrimmage plays (run, pass, sack, misc) with checked command, situation bar, overlays, Undo | Full offensive drive recordable |
| FBE-3D | Kicks, returns, tries, scoring prompts, penalties, fumbles/turnovers, timeouts, quarters, OT, situation fix | Full game recordable end to end |

Regression matrices `docs/REGRESSION_FBE_3*.md` per slice, including: one-handed
portrait capture of a 60-play game, park/resume mid-drive, missed-play recovery
with `situation_set`, flag profile hides kicks, basketball/soccer unchanged.

---

## 9. Questions to confirm in FBE-3 Q&A

1. Portrait with the tracked offense always going up, or a true-to-life field that
   flips each quarter? [Default: tracked offense up; flip is a device preference.]
2. Should saving a play require the result spot, or allow "gain unknown"?
   [Default: required for scrimmage plays; kicks can save without a return spot.]
3. Prefill the team's kicker/punter on kick plays? [Default: yes, as the
   specialist role; everything else starts Unattributed.]
4. Is a live Box tab useful during the game, or only at the end? [Default: yes,
   read-only.]
