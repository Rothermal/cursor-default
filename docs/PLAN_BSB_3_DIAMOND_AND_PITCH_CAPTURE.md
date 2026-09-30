# Plan: BSB-3 Baseball Diamond Tracker and Pitch Pad

Status: approved and merged 2026-09-29 (PR #448; owner answers in section 9). BSB-3A
(PR #450) and BSB-3B are implemented (section 10); BSB-3C and BSB-3D follow.
Builds on the BSB-1 engine ([plan](PLAN_BSB_1_EVENT_FOUNDATION.md)) and BSB-2 roster,
defaults and setup ([plan](PLAN_BSB_2_ROSTER_SETTINGS_AND_SETUP.md)). Product model:
[BSB-0](PLAN_BSB_0_BASEBALL_PRODUCT_MODEL.md) sections 4, 8 and 12.

Exit condition (BSB-0 roadmap): a full local game can be scored pitch by pitch on a
phone.

---

## 1. Goal

Replace the BSB-2 `/game` holding page with the live Baseball tracker:

- a scoreboard strip;
- the diamond, showing the batter, runners on base and fielders;
- a pitch pad with optional strike-zone location;
- a ball-in-play sheet with an optional spray location and a fielder sequence;
- runner resolution, which the app proposes and the recorder confirms;
- between-pitch runner plays;
- half-inning and game endings.

Everything writes through the existing BSB-1 checked commands. BSB-3 adds no new event
types and no migration.

Out of scope, unchanged from BSB-0:
- substitutions other than pitching changes (Q2), the Timeline, and edit, remove or
  restore of older plays (BSB-4);
- Summary views (BSB-5);
- cloud (BSB-6);
- aggregates, settings sync and the release capability (BSB-7).

Legacy Baseball stat-grid games, Soccer, Basketball, Hockey and Football are unchanged.

---

## 2. Phone Layout (390px, portrait)

Top to bottom:

1. **Scoreboard strip** (sticky):
   - away and home runs, with the tracked team named;
   - the half and inning ("Top 3");
   - balls, strikes and outs as dots;
   - the current pitcher's pitch count, with an advisory warning once a profile
     pitch-count limit or warning threshold is reached (BSB-0 default 9).
   - Tapping the strip opens the line score (R per inning, R/H/E).
2. **Diamond**, a fixed frame with home plate at the bottom (section 3.1):
   - runner chips on first, second and third;
   - a batter card at home (slot number, name or opponent label, number);
   - small fielder markers. The tracked defense shows player numbers; the opponent
     defense shows position numbers only.
3. **Pitch pad** (section 3.2):
   - the zone, which "Track pitch location" can hide;
   - result buttons: Ball, Called strike, Swinging strike, Foul, In play and HBP;
   - "More", which holds Foul tip, Foul bunt, Missed bunt, Intentional ball and Pitchout.
4. **Action row**:
   - Quick PA (section 4, BSB-3B);
   - Pitching change (Q2);
   - Undo (Q3);
   - a Game menu with end half-inning, end game, suspend, abandon and reopen.
5. **Recent plays**: the last ten capture units, newest first, in plain words ("Garcia
   singled to CF, Lee to 3rd"). Tapping a row shows its detail read-only. Correcting
   older plays is BSB-4.

The diamond and pitch pad stay on screen together (Q5). The in-play sheet and runner
resolution open over the pitch pad and reuse the diamond above them, so taps land on
the same drawing.

---

## 3. Surfaces

### 3.1 Diamond (`src/lib/baseball/diamondGeometry.ts`, `src/components/baseball/BaseballDiamond.tsx`)

- **Coordinates:** normalized 0..1 in BSB-0's fixed frame. Home plate is at
  `(0.5, 0.95)`, second base is above it, and the frame includes foul territory.
- **Stored locations:** batted-ball locations are stored in the event envelope with
  `attackingDirection: 'unknown'`, through the shared `src/lib/surface/location.ts`
  helper with `flipped = false`. The field is never flipped.
- **Geometry constants:** base and plate points, foul lines, the infield arc, the
  outfield fence arc and fielder home spots for positions 1 to 10 (10 is the slowpitch
  short fielder).
- **Scale:** the drawing is proportional, not to scale per profile. One drawing serves
  every profile, softball included (Q6).
- **Read-time helpers** for later spray charts:
  - fair or foul, and infield or outfield;
  - a direction bucket (pull, center, opposite needs batter handedness, so BSB-3 stores
    only the point).
- **Interaction:**
  - Tapping a runner chip opens runner plays (BSB-3C).
  - Tapping a fielder marker opens nothing while the pad is idle. During play entry it
    adds that fielder to the sequence.
  - Tapping the field places the batted ball, and only during play entry.
- **Accessibility:** every chip, marker and base has a button role and a label. A
  "Location unknown" button always sits beside the tap target. Light and dark tokens
  come from `public/appearance.css`.

### 3.2 Pitch pad (`src/components/baseball/BaseballPitchPad.tsx`)

- **The zone:** a catcher's-view strike-zone rectangle with a ball region around it,
  matching the engine's `pitchLocation` frame. Across the plate, 0..1 runs from the
  catcher's left to right; down the zone, 0..1 runs from top to bottom; values outside
  0..1 are balls. The drawing has no batter-handedness labels in BSB-3 (Q7).
- **The flow:** tap a location (optional), then a result. Or tap a result straight away
  to skip location. A location without a result shows a pending marker; it is not
  written until a result is chosen.
- **Location preferences:** `trackPitchLocation` and `trackBattedBallLocation` already
  exist in `BaseballCapturePreferences`. They are persisted and kept out of
  fingerprints, following the Hockey rink-flip and Basketball actor-selection rule.
  They show as two switches in the Game menu.

---

## 4. Slices

| Slice | Content | Exit |
| --- | --- | --- |
| BSB-3A | Diamond geometry and component, pitch pad component, scoreboard strip, tracker page shell replacing the holding page (Start game stays), preferences | The tracker shows the live projection of a started game at 390px in both themes; no capture yet |
| BSB-3B | Pitches and plate appearances: pitch results, automatic walk/HBP/strikeout completion, the "Runners moved" exception path, in-play sheet (result, batted-ball type, spray location, fielder sequence), Quick PA | A plate appearance of every result type can be recorded, a terminal pitch with its runner outcomes is one event, and the count, outs, bases and score update |
| BSB-3C | Runner resolution and between-pitch running | Every runner outcome in the BSB-1 fixtures can be entered by taps |
| BSB-3D | Endings, pitching changes (bench pitcher or fielder swap), opponent slot labels, Recent plays and Undo, owner-only release toggle (Q1) | A full seven-inning local game, with a pitching change and a walk-off, can be scored and survives reload |

### BSB-3B Pitches and plate appearances

The command is `recordBaseballPitch`, with the movements proposed by
`proposeBaseballMovements`.

- **Non-terminal pitches:** Ball, Called strike, Swinging strike, Foul, Foul tip, Foul
  bunt, Missed bunt, Intentional ball and Pitchout that do not end the plate appearance
  write one event with no movements.
- **Ball four and HBP:** the pad writes the pitch together with the proposed walk or HBP
  movements, which are the batter to first plus every forced runner. There is no
  confirmation step because forced advances are unambiguous (Q4). An intentional walk
  with four intentional balls works the same way.
- **Strike three:**
  - Normally the pad writes the strikeout movement (the batter is out; fielder 2 gets
    the putout).
  - When the rules allow a dropped third strike and first base is open or there are two
    outs, a small choice appears first: "Strikeout" or "Dropped third strike". The
    dropped-third-strike choice opens runner resolution with the batter's destination
    and fielder sequence.
- **Runners moved on this pitch (the exception path):** one-tap saving stays the
  default, but the recorder must be able to add runner outcomes to the same pitch
  before it is written.
  - A "Runners moved" chip sits on the pad whenever a runner is on base or a dropped
    third strike is possible. Tapping it arms the next pitch; tapping again disarms it.
  - When armed, the next result, terminal or not, opens runner resolution (BSB-3C)
    instead of saving. The sheet starts from the proposal for that result: forced
    advances for ball four or HBP, the batter out for strike three, the batter to first
    for a dropped third strike, and every runner staying for a non-terminal pitch.
  - Each runner row has a reason chip: Wild pitch, Passed ball, Steal, Caught stealing,
    Error, Throw or Forced. A forced runner defaults to Forced (`awarded`); others
    default to Wild pitch. Only engine running reasons are offered for a non-terminal
    pitch.
  - Confirm writes one `baseball.pitch` event with the pitch result and every movement.
    Cancel writes nothing and keeps the chip armed. The chip disarms after the write.
  - Examples it covers: ball four with a wild pitch that moves another runner two bases;
    a caught strikeout with the runner caught stealing ("strike 'em out, throw 'em
    out"); a dropped third strike on a wild pitch that also moves a runner up; and a
    forced winning run on ball four plus a wild-pitch advance.
  - Why it must be atomic: the engine applies movements, completes the plate appearance
    and then runs the half-inning and game-ending checks for the one event
    (`projector.ts` `applyPitch`). A third out moves play to the next half, and a
    winning run sets `pendingEnd`, which blocks every later play event. A separate
    baserunning event after the pitch is therefore not an equivalent correction, and
    BSB-3 does not rely on one or on later Timeline editing.
  - The BSB-1 engine already accepts all of these as one pitch event (checked against
    the current `projector.ts` while revising this plan), so no engine change is
    expected.
- **In play** opens the in-play sheet:
  1. **Result chips:** 1B, 2B, 3B, HR, Out, Error, Fielder's choice, Sac bunt, Sac fly,
     DP, TP and Ground-rule 2B. HR also offers "Inside the park".
  2. **Batted-ball type:** Ground, Line, Fly, Popup, Bunt, Unknown. It defaults to
     Unknown.
  3. **Spray location:** tap the diamond, or Location unknown. This step is skipped when
     `trackBattedBallLocation` is off.
  4. **Fielders:** tap fielder markers in order ("6, 3"), with a Clear chip. Outs need
     at least one fielder (BSB-0 default 6); hits accept none. Error also asks which
     fielder erred.
  5. **Runner resolution** (BSB-3C) opens with the proposal already applied. Confirm
     writes one atomic pitch event.
- **Quick PA** (untracked pitches, `recordBaseballPlateAppearance`):
  - The recorder picks Walk, Intentional walk, HBP, Strikeout swinging, Strikeout
    looking, Catcher's interference or In play.
  - An optional final count follows. In play reuses the same sheet.
  - The engine counts pitches as a lower bound, as BSB-1 documents.
- **Opponent batters:** the batter card shows the slot label. A pencil on the card sets
  a label or number for the slot through the existing `opponent_slot` substitution.
  This is labeling, not a lineup change, and it is recorded without leaving the pitch
  flow (BSB-0 section 8.3).

### BSB-3C Runner resolution and between-pitch running

**Runner resolution (one shared component, `BaseballRunnerResolution.tsx`):**

- **Rows:** one row for the batter and one for each runner, showing the start base and
  a destination.
- **Destinations:** tapping a row cycles through stay, the next bases, home and out.
  - Destinations that would pass another runner or leave two runners on one base are
    flagged inline.
  - The engine still rejects them if confirmed.
- **Outs:** an Out row asks for its fielder sequence (tap markers). The last fielder in
  the sequence gets the putout, the others get assists.
- **Advanced, per row** (collapsed by default): error by, earned override, RBI override,
  and "Run counts" override for third-out timing. These map to the movement's
  `errorBy`, `earned`, `rbi` and `runCounts` fields. They default to null, so the
  documented engine rules apply.
- **Confirm:** Confirm writes the event. An engine rejection keeps the sheet open, shows
  the engine's message, and leaves the recorder's choices in place.

**Between pitches:**

- Tapping a runner chip offers:
  - Steal
  - Caught stealing
  - Pickoff
  - Wild pitch
  - Passed ball
  - Balk
  - Error
  - Defensive indifference
  - Appeal out
  - Other advance
- Each opens runner resolution preset for that play:
  - for a steal, the runner moves up one base;
  - for a wild pitch, passed ball or balk, every runner moves up one base;
  - for caught stealing or a pickoff, the runner is out with a fielder sequence.
- A double steal is one play, with both runners edited in the same sheet.
- Confirm writes `recordBaseballBaserunning`.
- A wild pitch, passed ball, steal or caught stealing that happens on a pitch should be
  recorded with the pad's "Runners moved" chip (BSB-3B), so the pitch and the running
  are one capture unit. This is required when the pitch ends the plate appearance. The
  runner menu is for plays with no pitch (pickoff, balk, appeal) and for games where
  pitches are not tracked.

### BSB-3D Endings, pitching changes, Recent plays and Undo

**Endings:**

- **Pending end:** when the projection reports `pendingEnd` (regulation, walk-off or run
  rule), play is blocked and a banner says why, with an "End game" button. Nothing ends
  automatically, so a mistaken final play can still be undone (Hockey Q4 rule).
- **The Game menu:**
  - end half-inning, with a time limit, mercy or other reason and an optional note;
  - end game: completed, time limit or forfeit (with a winner);
  - suspend and abandon, which need a reason;
  - reopen, which needs a reason.
- **Half-innings:** the third out closes the half automatically (engine behavior). A
  short "Middle 3" or "End 3" divider appears in Recent plays.

**Pitching changes (Q2):** these use the engine's substitution command.

- **Tracked team, two choices only.** The sheet asks who pitches now and shows exactly
  what happens before Confirm:
  1. **A bench player.** One `defensive` substitution at position 1 with the current
     pitcher as the player leaving. The new pitcher takes the old pitcher's batting
     slot, and the old pitcher leaves the game (re-entry follows the rules profile).
     When the old pitcher does not bat (DH formats), the new pitcher does not bat
     either. The sheet says "#12 Smith replaces #7 Jones, batting 5th. Jones leaves the
     game."
  2. **A fielder, swapping with the pitcher.** One `position_change` with two
     assignments: the fielder to position 1 and the old pitcher to the fielder's
     position. The sheet shows "Jones moves to 3B" and Confirm is the explicit
     confirmation of the swap. Both keep their batting slots.
  - The engine requires every displaced fielder to get a new position
    (`applyPositionChange`), so choosing a fielder without a destination for the old
    pitcher is not offered. The two-player swap always leaves a complete defense.
  - Anything else, such as the old pitcher moving to a third position, a bench player
    taking the fielder's spot, or a double switch, is a defensive switch and stays in
    BSB-4. The sheet says so and points to it rather than offering a partial change.
- For the opponent, a new pitcher gets a label or number (`opponent_pitcher`).
- The count carries over and inherited runners are recorded by the engine.
- Pinch hitters, pinch runners, other defensive switches, courtesy runners and re-entry
  stay in BSB-4.

**Recent plays and Undo (Q3):** this follows the Hockey HKY-2C and Basketball
`courtCorrections` rules.

- A capture unit is the events that share a `captureCommandId`.
- Undo removes only the newest unit, and only when no later active event exists.
  Lifecycle rows (game start and end, half-inning ends) are shown but cannot be undone.
  The one exception is a game end, which is undone through reopen.
- Undo soft-deletes through `applyGameEventAppendsAndMutations`, and the candidate must
  replay completely.
- One reload-safe restore receipt, kept out of fingerprints, lets the recorder Restore
  what they just undid until the next capture.

**Release toggle (Q1):**

- Production gets an owner-only, default-off device toggle for Baseball
  event tracking, like Hockey HKY-2E. It adds a per-sport stage in
  `sportAvailability.ts`, so `isBaseballEventPreviewAvailable` becomes the audited
  policy.
- Games stay local-only: there is no cloud route until BSB-6.
- Development keeps the preview without the toggle.

---

## 5. Data and Compatibility

- There are no new event types, payload fields or setup versions. If an engine defect
  shows up, it is fixed in `src/lib/baseball/` with a regression test and recorded in
  the delivery record.
- Capture preferences and the restore receipt stay out of fingerprints and events.
- Opponent slot labels and pitching changes use the existing substitution events. The
  setup snapshot stays immutable.
- Parking, export/import and reload behave as they do in BSB-2. A game can be parked
  between any two captures, and there is no clock to pause.
- Legacy Baseball games still open the stat grid. Only games with Baseball sport state
  route to the tracker.

---

## 6. Cross-Sport Items Touched

- XS-5 location frame: first use of `attackingDirection: 'unknown'` through the shared
  surface helper.
- BSB-0 cross-sport note 5, secondary placement: the pitch pad is the second "placement
  in a sport frame" after the Soccer goal mouth. No shared component is extracted yet.
  It is noted for when a third use appears.
- XS-1 release gating (Q1).
- The Recent plays and Undo rules match Hockey HKY-2C and Basketball. The components stay
  sport-owned under the shared product decisions.

---

## 7. Tests and Regression

- **Geometry:**
  - base and fielder points stay inside the frame;
  - the location helper stores unflipped points;
  - fair/foul and infield/outfield read-time helpers.
- **Pitch flow:**
  - each pitch result writes the right payload;
  - location is optional;
  - ball four, HBP and strike three complete the plate appearance with the proposed
    movements;
  - the dropped-third-strike choice appears only when the rules and bases allow it.
- **Terminal pitches with runner outcomes ("Runners moved"), each written as one event:**
  - ball four plus a wild-pitch or passed-ball advance by another runner;
  - HBP plus a passed-ball advance;
  - a caught strikeout plus a runner caught stealing, including when that makes the
    third out and play moves to the next half;
  - a dropped third strike plus a wild-pitch advance by another runner;
  - a forced winning run on ball four plus a wild-pitch advance, which sets
    `pendingEnd` only after the whole pitch is recorded;
  - a non-terminal pitch with a steal or wild pitch;
  - Cancel writes nothing and an engine rejection keeps the sheet open.
- **In-play sheet:**
  - every result chip produces a valid event from a fresh count;
  - an out without fielders is blocked;
  - an error needs the erring fielder;
  - skipping the spray location stores a null location.
- **Runner resolution:**
  - destinations cycle and flag passing runners;
  - an engine rejection keeps the sheet state;
  - overrides map to movement fields.
- **Running plays:**
  - steal, caught stealing, pickoff, wild pitch, passed ball, balk and a double steal
    each produce the BSB-1 fixture state.
- **Endings:**
  - pendingEnd blocks play and End game writes the ending;
  - time-limit and mercy half-inning endings;
  - suspend, abandon and reopen.
- **Pitching changes:**
  - a bench pitcher takes the old pitcher's batting slot, the old pitcher leaves, and
    the count and inherited runners carry over;
  - a fielder-to-pitcher swap moves the old pitcher to the fielder's position, keeps
    both batting slots, and the next pitch records with a complete defense;
  - a DH-format bench pitcher does not enter the batting order;
  - options outside these two are not offered.
- **Undo:**
  - each capture family can be undone;
  - Undo is refused behind a lifecycle event;
  - the restore receipt survives reload and clears on the next capture.
- **Integration:** a scripted seven-inning game through the UI helpers. It includes a
  pitching change, an opponent label, a double steal, a double play and a walk-off, and
  must produce the same projection as the BSB-1 full-game fixture pattern, survive
  reload, park, export and import, and stay on the `unsupported` cloud route.
- **Browser smoke at 390px, light and dark:** set up from team defaults, score a half
  inning by pitches, record a hit with a runner, a steal, an undo and a restore, then
  reload.
- **Release guards:** the preview gate or new policy consumers stay audited, and legacy
  Baseball still opens the grid.

---

## 8. Risks

- **Screen space.** The diamond, pitch pad and scoreboard compete at 390px. The layout
  keeps the pad compact (six primary buttons), and the in-play sheet reuses the
  diamond. A browser check at the end of BSB-3A comes before capture wiring.
- **Runner resolution complexity.** Most mistakes will happen here. The proposal
  defaults cover the common cases; the advanced overrides stay collapsed. The engine
  remains the final validator, and its messages are shown as written.
- **Undo depth.** With only newest-unit Undo, an earlier mistake needs BSB-4. A score
  adjustment remains available as a stopgap (existing command).

---

## 9. Owner Decisions (2026-09-29)

Mark accepted every recommendation ("yes to all recommendations"). Recording these
answers does not approve the plan; implementation starts after the plan PR is approved
or merged.

| # | Question | Decision |
| --- | --- | --- |
| Q1 | Should you be able to try Baseball on your phone before the full release? | Yes: an owner-only, default-off device toggle in production at the end of BSB-3, local-only, like Hockey |
| Q2 | Include pitching changes (both teams) in BSB-3, leaving other substitutions for BSB-4? | Yes: a real game needs pitching changes to be scored |
| Q3 | Move "undo the last play" from BSB-4 into BSB-3? | Yes: newest-play Undo and Restore only; editing older plays stays in BSB-4 |
| Q4 | Write walks and hit-by-pitch runner advances without a confirm step? | Yes: forced advances are unambiguous; any runner play afterwards can fix odd cases |
| Q5 | Keep the diamond and pitch pad on one screen rather than switching tabs? | Yes: stacked, with the in-play sheet opening over the pad |
| Q6 | One diamond drawing for baseball and softball, not drawn to scale? | Yes: softball geometry stays a later option (BSB-0 decision 2) |
| Q7 | Leave batter handedness out of BSB-3? | Yes: no L/R capture yet; the zone is the catcher's view, and handedness arrives with lineup management in BSB-4 |

---

## 10. Delivery Record

### BSB-3A Surfaces and shell

- `src/lib/baseball/diamondGeometry.ts`: the fixed frame (home at `(0.5, 0.95)`, 0.2
  between bases, rubber at 60.5 of 90 ft), fence points and curve control, infield arc,
  fielder spots 1 to 10, `baseballDiamondLocation` (shared surface helper, never
  flipped, `attackingDirection: 'unknown'`, rounded to 0.001), read-time
  `isBaseballFair` and `baseballFieldArea`, and the pitch pad frame (`-0.75..1.75`,
  matching the engine's accepted range) with `baseballPitchPadLocation`,
  `baseballPitchPadDisplay` and `isBaseballPitchInZone`.
- `src/lib/baseball/trackerView.ts`: read-only scoreboard, line score (R per inning,
  R/H/E with errors charged to the fielding side) and diamond models, person labels for
  participants, opponent slots and opponent pitchers, the pitch result lists, and
  `setBaseballCapturePreferences` (kept out of fingerprints and events).
- `src/components/baseball/`: `BaseballScoreboard` (sticky strip, count and outs as
  dots only while play is live, pitch count with the profile warning or limit, tap for
  the line score), `BaseballDiamond` (grass, dirt, chalk, bases, runner chips on the
  bases, the batter chip and card, fielder markers; buttons with labels only when a
  handler is passed, plus Location unknown) and `BaseballPitchPad` (catcher's-view zone,
  pending marker and Clear, the six main results and More; results disabled until
  BSB-3B).
- `src/pages/BaseballGameTracker.tsx` replaces the BSB-2 holding page: pregame keeps
  the rules line, Start game and lineup review; after the start it shows the
  scoreboard, diamond and pitch pad. The Game menu holds the two location switches.
- Theme tokens `--diamond-grass`, `-dirt`, `-line`, `-ink`, `-tracked` and `-opponent`
  in both palettes, with contrast checks in `appearance.test.ts`.
- Tests: `diamondGeometry.test.ts` (frame, spots inside the frame and in fair territory,
  stored taps, fair/foul/infield/outfield, pad mapping, idle versus play-entry
  rendering, the hidden zone) and `trackerView.test.ts` (home/away order, count,
  pitch-count warning and limit, line score and errors, runners and batter slot,
  opponent position numbers, ten fielders for slowpitch, preferences outside the
  fingerprint and surviving reload). The preview gate test follows the page rename.
- Browser check at 390 px (development build, light and dark): a local game set up from
  ten players, Start game, then scripted engine play (a strikeout half, a single, a walk
  and a 1-1 count) after reload shows runners on first and second, the batter card, the
  count dots, the pitch count and the line score; turning off pitch location hides the
  zone and survives reload; no horizontal scroll and no console errors.

### BSB-3B Pitches and plate appearances

- `src/lib/baseball/capture.ts` (pure): `baseballPitchTerminal` mirrors the projector's
  walk, strikeout (including the two-strike foul and foul-bunt rules), HBP and in-play
  endings; `proposeBaseballCaptureMovements` gives the standard movements (a dropped
  third strike reuses the walk proposal with the batter reason `dropped_third_strike`);
  `commitBaseballCapture` writes one `recordBaseballPitch` or
  `recordBaseballPlateAppearance` event. The in-play draft (`buildBaseballBattedBall`)
  needs fielders for Out, Fielder's choice, Sac bunt, Sac fly, DP and TP and the erring
  fielder for Error; an untapped spray location is stored as null. Resolution rows
  (`createBaseballResolutionRows`, lead runner first, then the batter) carry destination,
  reason and fielders; `baseballResolutionIssues` flags the trailing runner on a shared
  base, a runner passing the one ahead and an out without fielders, and the engine still
  decides on Confirm.
- **Runner resolution pulled forward from BSB-3C.** The in-play sheet, the dropped third
  strike and the "Runners moved" chip all need it, so `BaseballRunnerResolution` ships
  here with destinations, reasons (running reasons only on a pitch that continues the
  plate appearance) and fielder sequences for outs (number buttons, or taps on the
  diamond markers; tapping a runner chip cycles that runner). BSB-3C keeps the
  between-pitch runner menu and the Advanced per-row overrides (error by, earned, RBI,
  run counts).
- Tracker: pad results write at once when the proposal is unambiguous (non-terminal
  pitches, ball four, HBP, a caught strike three). In play opens the in-play sheet, then
  runner resolution; strike three with a dropped third strike possible asks Strikeout or
  Dropped third strike first. The "Runners moved" chip shows when a runner is on base or
  a dropped third strike is possible, sends the next result through resolution, stays
  armed on Cancel and disarms after the write. Quick PA (results plus an optional final
  count, both or neither) is disabled once a pitch was tracked for the batter. Pad
  results and Quick PA are disabled while `pendingEnd` is set. Each capture gets its own
  `captureCommandId` for BSB-3D Undo. An engine rejection keeps the sheet open with the
  message and every choice.
- The opponent batter card has a pencil that sets the slot's label and number through the
  `opponent_slot` substitution; position and bats are kept.
- Tests: `capture.test.ts` covers terminal detection for every pitch result, one-tap
  captures, the dropped third strike, the four "Runners moved" examples from this plan
  as single events (including a third out moving to the next half and a forced winning
  run setting `pendingEnd` only after the whole pitch), a rejected draft staying intact,
  every in-play result chip, every Quick PA result, the refusal after a tracked pitch,
  resolution rows and issues, and static renders of the pad chip, in-play sheet,
  resolution, Quick PA and batter pencil.
- Browser check at 390 px (development build, light and dark), driven through the UI:
  ball four with a pitch location, a double to center with fielder 8, a Quick PA
  strikeout, an armed ball with the runner from third scoring on a wild pitch, an
  opponent slot relabelled "#21 Tall lefty", a dropped third strike with the batter to
  first, and DP blocked until fielders are tapped. Score, count, outs and bases matched
  the projection after each step; no horizontal scroll and no console errors.
