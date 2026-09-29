# Plan: BSB-3 Baseball Diamond Tracker and Pitch Pad

Status: draft for owner review. No code starts until Mark approves or merges this plan.
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
| BSB-3B | Pitches and plate appearances: pitch results, automatic walk/HBP/strikeout completion, in-play sheet (result, batted-ball type, spray location, fielder sequence), Quick PA | A plate appearance of every result type can be recorded and the count, outs, bases and score update |
| BSB-3C | Runner resolution and between-pitch running | Every runner outcome in the BSB-1 fixtures can be entered by taps |
| BSB-3D | Endings, pitching changes, opponent slot labels, Recent plays and Undo, release toggle (Q1) | A full seven-inning local game, with a pitching change and a walk-off, can be scored and survives reload |

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
- A wild pitch or passed ball on ball four or strike three is entered from the pitch:
  resolution offers "Advance on WP/PB" per runner. The engine already stores a reason
  per movement.

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

- For the tracked team, the recorder picks the incoming pitcher from dressed players
  who are not in the game, or from fielders, which is a position change.
- For the opponent, a new pitcher gets a label or number.
- The count carries over and inherited runners are recorded by the engine.
- Pinch hitters, pinch runners, defensive switches, courtesy runners and re-entry stay
  in BSB-4.

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

- If approved, production gets an owner-only, default-off device toggle for Baseball
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
- XS-1 release gating, if Q1 is approved.
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

## 9. Questions for Mark

Each has a recommended default. Work proceeds on the recommendation for any question
left unanswered once the plan itself is approved.

| # | Question | Recommendation |
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

Empty until implementation starts.
