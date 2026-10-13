# Plan: BKE-7 Full Court and Attacking Direction

Moves the Basketball Event tracker from a half-court drawing to a horizontal full court,
the way Soccer's pitch and Hockey's rink work: each team attacks one basket, the ends
switch at halftime, and the basket you tap tells the app which team shot.

Status: approved (merged 2026-10-11, PR #483); built with the §7 recommendations. BKE-7A through
BKE-7D are implemented; see §8.

---

## 1. Goal

BKE-7 exits when a new Basketball Event game is tracked and reviewed on a full court:

- a horizontal full court with both baskets, team names on the half each team attacks,
  an attacking arrow, and a display-only 180-degree flip,
- the tracked team's attacking direction chosen at tip-off, switched automatically at
  halftime, kept for overtime, and changeable with **Switch ends**,
- a tap on a half preselects the team attacking that basket; the shot's value and zone are
  measured from that team's basket, so a backcourt heave is a real three,
- shots stored with the shooting side's attacking direction, and old half-court shots
  still replaying with identical totals,
- rebounds, steals, blocks, turnovers and fouls entered from a court tap keep their spot
  (§7 Q3),
- the Summary shot chart shows the full court with each team at one end, plus a half-court
  view that folds every shown shot onto one basket (§7 Q2).

Not in BKE-7: the legacy aggregate tracker (§7 Q1), youth/high-school three-point
distances (§7 Q4), possession arrow, a vertical court.

---

## 2. Current state (read before building)

- `src/lib/basketball/courtGeometry.ts` is a 50 x 47 ft half court in rim-centered feet
  (rim at a shortened 2.625 ft from the baseline, NBA arc 23.75 ft, corner 22 ft).
  Event locations are the same half court normalized to 0..1 (`y` 0 = baseline) with
  `attackingDirection: 'unknown'`.
- `statEvents.ts` rejects any `basketball.shot` whose direction is not `'unknown'` and
  checks a court shot's `value` against `isThreePointer` on the half-court point.
  `statProjection.ts`, `timeline.ts`, `summaryShots.ts`, `shotEditCommands.ts` and
  `BasketballShotReview.tsx` all call `normalizedCourtLocationToFeet` directly.
- Only `basketball.shot` may carry a location. The court popup's Off/Def Reb, Steal,
  Block and Assist drop the tap position.
- `BasketballCourt.tsx` draws the half court for both the legacy and Event trackers.
  The flip (`capturePreferences.courtOrientation`, seeded from the personal
  `display.defaultCourtFlipped`) is a 180-degree turn that never changes stored points.
- Team-name buttons and the popup's team attribution choose the capture side
  ([workspace modernization](PLAN_BASKETBALL_WORKSPACE_MODERNIZATION.md)).
- The server never reads Basketball locations. Readiness and finalization (057, 064)
  check scoring payloads and a fixed list of lifecycle types and ignore others, so a new
  neutral event type and located plays need no migration. Slice A re-reads 057, 064 and
  the BKE-4E aggregate transport to confirm before code relies on it.
- Hockey's patterns to reuse: `src/lib/surface/location.ts` (`surfaceLocation`, display
  flip undone before storing), `HockeyRink` (horizontal SVG), `hockeySummaryPoint`
  (half turn for the side played the other way) and summary clustering.

---

## 3. Model

### 3.1 Full-court frame

Canonical full-court coordinates, like the rink: `x` along the length (0 = left
baseline, 1 = right baseline), `y` across (0 = top sideline). The court is 94 x 50 ft
and each end is the existing half-court drawing mirrored, so a shot classifies exactly
as it would have on the half court.

`attackingDirection` becomes the frame marker, with no event schema change:

| Stored direction | Frame | Target basket |
|---|---|---|
| `'unknown'` | Half court (every shot recorded before BKE-7) | The half court's only basket |
| `'left_to_right'` | Full court | Right basket |
| `'right_to_left'` | Full court | Left basket |

Every location is stamped with the acting side's direction (the shooting team for a
shot, the stealing team for a steal), as Hockey does. A shot's value and zone come from
its own stamp and point, never from the current period, so an event is always
self-describing and later direction changes never invalidate it.

One helper, `basketballShotFeet(location)`, returns rim-centered feet relative to the
target basket for either frame (a half turn for the left basket). Every current
`normalizedCourtLocationToFeet` caller moves to it. Event schema stays 1, because the
server's finalization rejects shots with any other schema version.

### 3.2 Attacking direction over a game

- New neutral event `basketball.attacking_direction_set`, payload
  `{ trackedDirection: 'left_to_right' | 'right_to_left', reason: 'tip_off' | 'switch_ends' }`.
- The tip-off event is appended in the same command as the Period 1 start for new games.
  A game with no direction event is a half-court game and stays one (§5).
- Halftime: when the period starting is the first one past the midpoint of an even
  regulation-segment list (4 quarters, 2 halves), the projection flips the direction.
  Odd segment counts never flip on their own. Overtime keeps the second-half direction
  (NFHS, NCAA, FIBA and NBA all do this).
- **Switch ends** (Actions menu, and the backcourt prompt in §3.3) appends a
  `switch_ends` event. It applies from that point forward. It is one capture unit, so
  quick Undo and Timeline Remove/Restore handle it, and removing it changes no stored
  shot.
- The projection exposes `trackedAttackingDirection` (nullable) for the current period.

### 3.3 Capture

- Tapping a half preselects the team attacking that basket in the popup. The recorder can
  still switch teams. The tapped point is never moved.
- A shot whose point is in its own team's backcourt gets a one-line prompt in the popup:
  "Backcourt shot. Are the ends right?" with **Switch ends** or **Keep as a backcourt
  shot**. This catches a wrong tip-off direction on the first shot.
- The 2PT/3PT chip still defaults from the point, measured from that team's basket.
- Live capture always uses the current direction, which is never ambiguous. Shots
  added or edited afterwards follow §3.4.

### 3.4 Target basket for added and edited shots

A shot's time cannot always tell which way its team was attacking: clockless games
have no elapsed time, a recorded-later shot is appended at the time of entry, and an
anchored clock can be set back so a period and time repeat. So the app infers the
basket only when the shot's period leaves no doubt, and otherwise asks.

- The shot editor and the recorded-later shot sheet on a full-court game show a
  **Shot at: Left basket / Right basket** control with the full court.
- **Unambiguous period:** the period has one direction throughout (no active Switch
  ends event between its start and its end, or now for the current period). The
  control is preselected to the shooting side's basket for that period and can be
  changed.
- **Ambiguous period** (a Switch ends inside it, or a period whose direction the
  projection cannot give): nothing is preselected and Save stays disabled until the
  recorder picks a basket. The app never falls back to the current direction.
- **Editing a located shot** keeps its stored direction. Moving the marker never
  changes it; only an explicit change of the Shot at control re-stamps it, and the
  value is then re-checked against the new target basket.
- **Adding a location to an unlocated shot** follows the same unambiguous or ambiguous
  rule for the shot's period.
- **Changing a shot's side or period** keeps the stored direction, because it records
  which basket the ball went to. The editor shows the Shot at control so the recorder
  can change it on purpose. Removing a location clears the direction with it.
- Half-court games (no direction event) keep today's half-court editor and `'unknown'`
  frame; a shot never moves between frames.
- Located plays (BKE-7C) follow the same rules, with the acting side in place of the
  shooting side.

### 3.5 Half-court view and shots beyond half court

Folding a full-court shot onto its target basket keeps its distance, so a heave from
beyond the midcourt line does not fit on the 47 ft half-court drawing.

- The Half court view draws only shots whose rim-relative point lies on the half court
  (`y <= HALFCOURT_Y`). Points are rotated, never clamped or moved.
- Shots beyond half court are listed under the chart as **Beyond half court: N**, with
  each row opening the shot detail and its full-court spot. The row respects the same
  filters as the chart.
- Totals, percentages, values and stored coordinates always include these shots. The
  Full court view draws every shot where it was taken.

---

## 4. Slices

### BKE-7A Frame, direction event and projection (no UI change)

- `fullCourtGeometry.ts`: 94 x 50 frame, both baskets, conversions, `basketballShotFeet`,
  backcourt test. Existing half-court constants are unchanged.
- Validation accepts a known direction for full-court locations and checks `value`
  against the frame-aware point. `'unknown'` keeps today's exact check.
- `basketball.attacking_direction_set` definition, projection of the tracked direction
  with the halftime and overtime rules, Timeline/Recent Events labels.
- All current callers move to `basketballShotFeet`.
- Tests: literal pre-BKE-7 streams replay with identical projections and fingerprints; a
  full-court shot and the same half-court shot get the same value and zone; halftime for
  4 quarters, 2 halves, the eight-segment youth profile (switch at segment 5), odd counts
  and overtime; Switch ends forward-only; the §3.4 period-direction query (unambiguous,
  Switch ends inside the period, current period); the §3.5 half-court membership test.

### BKE-7B Live full court

- `BasketballFullCourt` (horizontal SVG, both ends, team labels and arrow, flip,
  markers, tap-vs-scroll handling from `BasketballCourt`). The legacy tracker and
  half-court Event games keep `BasketballCourt`.
- Tip-off direction choice ("<Team> shoots first at: Left basket / Right basket") on the
  opening-lineup step and every other Event start path, default right.
- Tapped half preselects the team, backcourt prompt, Switch ends in Actions, shot
  commands stamp the direction.
- Shot detail, Timeline shot edit and recorded-later shot add on the full court, with
  the §3.4 Shot at control, preselection only for unambiguous periods, and stamp
  preservation on edit.
- Phone screenshots: 375 px wide, both directions, flip on and off.

### BKE-7C Located plays (§7 Q3)

- Rebound, steal, block, turnover and foul events may carry a location stamped with
  the acting side's direction, only when entered from a court tap. Grid, Lineup and
  dialog entries stay unlocated.
- Timeline detail shows the spot; editing a located play can move or clear it.

### BKE-7D Summary and release

- Summary shot chart: **Full court** (tracked team attacks right, opponent left; a half
  turn for halves played the other way, as `hockeySummaryPoint` does) and
  **Half court** (shown shots folded onto one basket, today's view, with shots beyond half
  court listed per §3.5). Default per §7 Q2.
  Half-court-frame shots from older games show on their side's summary end.
- A Plays map of located plays with the existing side, player and period filters.
- Local, cloud-primary, alternate and canonical sources all read the same way.
- `BASKETBALL_FULL_COURT_FOR_NEW_GAMES` is the rollback switch: false makes new games
  half court again (no tip-off event); full-court games already recorded still open.
- `docs/REGRESSION_BKE_7_FULL_COURT.md` and the AGENTS.md Basketball note.

---

## 5. Data and compatibility rules

- No migration and no event schema bump (§2). No setup version change; the direction
  lives in the stream, so the setup v1/v2 cloud binder is untouched.
- Games recorded before BKE-7, including ones in progress when it deploys, stay half
  court, replay unchanged, and keep their fingerprints.
- A full-court game opened by an older app version fails closed on the unknown event
  type, as any new Basketball event does. The PWA update prompt (BKE-6E2) is the guard;
  update every device before recording a full-court game.
- Aggregates (`bk_*`) do not use location and are unchanged.
- The display flip stays outside events and fingerprints.
- Soccer, Hockey, Baseball and legacy Basketball are untouched.

---

## 6. Regression

`docs/REGRESSION_BKE_7_FULL_COURT.md` when implementation lands:

- a full local game on a phone with quarters: tip-off direction, shots at both ends,
  halftime switch, an overtime period, a backcourt heave, Switch ends and its Undo,
- the same with halves, with the eight-segment youth profile (ends switch at segment 5),
  and a clockless game,
- clockless: attack right, Switch ends, then add an earlier missed layup at the right
  basket from the Timeline; the sheet asks for the basket, and choosing Right keeps it a
  two at the right end in Summary,
- anchored: set the clock back so a time repeats across a Switch ends; a recorded-later
  shot at that time asks for the basket,
- editing a located shot's position, side and period keeps its basket; adding a location
  to an unlocated shot in an unambiguous period preselects the basket,
- both teams' backcourt heaves: the Full court view draws them where taken, the Half
  court view lists them under Beyond half court, and totals include them,
- stored coordinates identical with the flip on and off,
- a pre-BKE-7 game in progress still tracks on the half court and its Summary is
  unchanged,
- a cloud game syncs, finalizes and shows the full-court Summary on a second device,
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

---

## 7. Owner questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | Should the legacy (stat-grid) Basketball tracker also get the full court? | No. Only Event games. Legacy shots are stored as half-court feet in the cloud `shot_chart` table and have no direction; changing them is a separate project |
| Q2 | Summary shot chart default view? | Full court, with a Half court toggle, because the full court is what you asked for and the half court remains for player shot charts |
| Q3 | Keep the spot of rebounds, steals, blocks, turnovers and fouls entered from a court tap? | Yes (BKE-7C). It is cheap now and gives a Plays map like Hockey's |
| Q4 | Youth/high-school three-point distance (19 ft 9 in) instead of the NBA arc? | Separate plan. It changes the rules schema and how shot values are checked, and applies to half-court games too |
| Q5 | Default tip-off direction? | Tracked team shoots right first, matching Hockey |

---

## 8. Delivery record

### BKE-7A (implemented)

- `fullCourtGeometry.ts`: `FULL_COURT_LENGTH` (94 ft), `basketballShotFeet` (frame-aware,
  target-relative feet; the right basket is a half turn of the left), its inverse
  `basketballFullCourtLocation`, `isBasketballBeyondHalfCourt`, and direction helpers.
- `courtDirectionEvents.ts`: `basketball.attacking_direction_set` (neutral, no location,
  payload `{ captureCommandId, trackedDirection, reason }`), its projection into the optional
  `projection.court` (`trackedAttackingDirection`, `periodDirections`, `tipOffEventId`), the
  halftime rule on period start, and the §3.4 queries `basketballPeriodDirection` (a
  direction only when the period used one) and `basketballCurrentDirection`.
- The tip-off is accepted only directly after the first period's start, before any
  other event in capture order, so a game has one frame throughout. Capture order, not
  replay order: a recorded-later lineup correction at elapsed zero replays ahead of the
  tip-off and stays valid. Switch ends is accepted only during a
  period, never in a break, so an ended period's direction history never changes.
- Shot validation reads every court shot through `basketballShotFeet`; the projection
  rejects a full-court location in a half-court game and a half-court location in a
  full-court game. Timeline, Summary shots, the shot chart record and shot edit value checks
  use the helper.
- Direction rows are Timeline match control and read-only for now (Switch ends removal
  arrives with its button in BKE-7B). The half-court shot editor refuses full-court shots.
- Slice A re-check of §2: migrations 057 and 064 read only scoring payloads, schema version
  and a fixed list of lifecycle types, and the BKE-4E aggregate projection does not read
  locations, so neither the new event nor full-court locations need server changes.
- Tests (`fullCourt.test.ts`): frame equivalence at both baskets, backcourt membership and
  value, halves with overtime, quarters, the eight-segment youth profile (switch at segment
  5), odd counts, Switch ends forward-only and its removal, frame mixing, a second or late
  tip-off, a tip-off after play, Switch ends in a break, no-op switches, half-court games unchanged, Timeline labels.

### BKE-7B (implemented)

- `fullCourtPolicy.ts`: `BASKETBALL_FULL_COURT_FOR_NEW_GAMES` (true) is the rollback
  switch, pulled forward from BKE-7D so every new start path reads one place; false
  starts new Event games on the half court again. Existing games keep their frame.
- Start paths: `prepareBasketballGameStart` takes `tipOffDirection` and appends the period
  start and the tip-off in one command (same period and elapsed time). Player Setup shows
  `BasketballTipOffChoice` ("Tip-off basket for <Team>", Left/Right in the court's opening
  view, default right) on the anchored opening-lineup step and on the clockless roster
  step. An independent cloud recorder stream starts with the default right tip-off; the
  recorder fixes it with Switch ends. Games started before BKE-7B stay half court.
- Live court: `BasketballFullCourt` (horizontal 94 x 50 drawing, both ends from the shared
  `courtDrawing.tsx`, team labels with arrows, flip as a half turn, tap-vs-scroll from the
  shared `courtTap.ts`). `ShotChartPanel` uses it only for full-court games; the legacy
  tracker and half-court Event games keep `BasketballCourt`.
- Capture: the tapped half picks the team attacking that basket (the active player stays
  when on that team, else the team row). The popup's Team control can change it; choosing
  the team whose basket is far from the tap shows "Backcourt shot. Are the ends right?"
  with Switch ends or Keep as a backcourt shot. `captureBasketballCourtEvent` takes a
  0..1 `fullCourtPoint` in full-court games, stamps the shooting side's current direction
  and measures value from that basket.
- Switch ends: `switchBasketballEnds` appends one direction event during a period (fails
  in half-court games and final cloud games) and clears the quick-Undo receipt. The Actions
  tab has a Court ends section. Switch ends is an ordinary capture unit (Undo, Timeline
  remove and restore); the tip-off stays a read-only boundary.
- Shots: detail reads "Paint at the right basket (11.4 ft)". The shot editor and
  recorded-later shot add place on the full court and show the §3.4 Shot at control
  (`BasketballShotCourtDraft`: `stored`, `period` or `recorder`); a period that used one
  direction preselects it, otherwise Review stays disabled until a basket is chosen. Edit
  keeps the stored basket when the marker moves or the team or period changes; removing the
  location clears it; value checks re-run against the chosen basket.
- Left and right in text follow the shown court (`basketballShownBasket`): Court ends,
  Timeline direction rows, shot detail and the editor's location text name the basket as
  the recorder sees it, matching the court labels, tip-off choice and Shot at control. A
  flip never reads as switched ends; stored directions are canonical.
- Tests (`fullCourtLive.test.ts`): start with and without a tip-off, direction stamping and
  value, side selection through Switch ends and halftime, Undo/remove of Switch ends with the
  tip-off read-only, edit basket preservation and re-check, added-shot preselection, location
  text. Independent cloud stream tests now expect the tip-off.
- Phone screenshots (375 px, Chromium): setup choice, tracker court with both directions,
  popup, backcourt prompt, flip on and off, Court ends, after Switch ends, shot detail,
  editor and full-court placement; shared in the project files under
  `basketball-full-court/bke-7b/`.

### BKE-7C (implemented)

- `playLocations.ts`: rebounds, steals, blocks, turnovers and fouls entered from a
  full-court tap keep the tap, stamped with the acting side's current direction
  (`basketballPlayCaptureLocation`). Half-court games, grid, Lineup and dialog entries,
  recorded-later additions and assists stay unlocated. The rebound picked in the missed-shot
  prompt stays unlocated too: the tap marks the shot, not the rebound.
- Validation: stat definitions take a `locationRule` (`none`, `shot`, `play`); a play may
  carry only a known-direction location, and a foul is the one administrative event that
  may carry one. The frame check (`basketballLocationFrameError`) now runs for every stat
  and administrative event, so a full-court play in a half-court game is rejected.
- Capture: the court popup adds Turnover in Event games (team or player turnover by the
  chosen actor). Foul from the court popup carries the tap into the foul dialog.
- Review: the Timeline detail shows "Court spot: 2.1 ft from the right basket" (the
  nearer basket as the court is shown). The related-event and foul editors show a Court
  spot section with Move (full-court placement) and Remove for located plays. Moving the
  spot or changing the team keeps the stored direction; Remove clears the location. The
  review lists the spot change.
- No migration, no schema bump; the server ignores event locations.
- Tests (`fullCourtPlays.test.ts`): stamping per side and after Switch ends, unlocated
  assists, grid entries and half-court games, located fouls, rejection of half-court-frame
  plays and frame mixing, Undo, edit move/clear with direction kept, recorded-later fouls,
  flip-aware spot text.
- Phone screenshots (375 px, Chromium): popup with Turnover, steal detail with its spot,
  editor and Move placement; in the project files under `basketball-full-court/bke-7c/`.

### BKE-7D (implemented)

- `summaryCourt.ts`: the Summary court frame puts the tracked team attacking right and
  the opponent left (`BASKETBALL_SUMMARY_DIRECTIONS`); a location aimed the other way turns
  half a turn, and half-court-frame shots from older games sit at their side's summary
  basket. Nothing stored changes.
- Shot Chart tab: a **Full court / Half court** control. Full court is the default for
  full-court games (§7 Q2); games recorded before BKE-7 open on Half court, so their
  Summary looks as before. Full court draws every shot where it was taken with the team
  labels; Half court folds shots onto one basket and lists shots beyond half court under
  **Beyond half court** (§3.5). Totals, filters and the shot lists always include them.
- Plays tab, shown once the game has a located play: the BKE-7C plays on the summary full
  court as lettered marks (R, S, B, T, F) with side, player, period and play filters, and a
  list with the spot text. Marks and rows open the read-only event detail; corrections
  stay on the Timeline.
- Every Summary source (this device, cloud primary, another recording, the published
  game) reads the same way: locations travel in the event rows as before.
- `BASKETBALL_FULL_COURT_FOR_NEW_GAMES` (`fullCourtPolicy.ts`, from BKE-7B) stays the
  rollback switch.
- Tests (`fullCourtSummary.test.ts`): frame turns for both sides, older half-court shots,
  full-court and half-court markers, a heave beyond half court counted but not drawn on the
  half court, plays with filters, assists and unlocated plays left off, half-court games
  without plays. `releaseEntryGuards.test.ts` checks both views and the Plays map follow
  the flip.
- Regression record: `docs/REGRESSION_BKE_7_FULL_COURT.md`.
