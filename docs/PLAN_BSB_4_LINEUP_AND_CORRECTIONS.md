# Plan: BSB-4 Baseball Lineup Management, Timeline and Corrections

Status: draft for owner review (2026-10-01). Implementation starts only after this plan
PR is approved or merged. Builds on BSB-1 ([engine](PLAN_BSB_1_EVENT_FOUNDATION.md)),
BSB-2 ([setup](PLAN_BSB_2_ROSTER_SETTINGS_AND_SETUP.md)) and BSB-3
([tracker](PLAN_BSB_3_DIAMOND_AND_PITCH_CAPTURE.md)). Product model:
[BSB-0](PLAN_BSB_0_BASEBALL_PRODUCT_MODEL.md) sections 5.4, 8.3 and 12.

Exit condition (BSB-0 roadmap): any recorded mistake can be corrected without
corrupting later state.

---

## 1. Goal

Finish the in-game work a scorer needs beyond pitch-by-pitch capture:

- **Lineup:** see the batting order, defense and bench at any time, and make every
  substitution the rules allow (pinch hitter, pinch runner, courtesy runner, defensive
  replacement, position switch, double switch, re-entry).
- **Timeline:** the whole game as play-by-play, grouped by half-inning, with the
  read-only details BSB-3D added.
- **Corrections:** edit, remove and restore any play, not only the newest one, with a
  preview of what the change does to the rest of the game.
- **Handedness:** batter and pitcher hands, so the pitch pad can label the zone (BSB-3
  Q7 deferred this here).

Still out of scope:
- Summary views (BSB-5);
- cloud (BSB-6);
- aggregates, settings sync and the wider release (BSB-7).

BSB-3 already shipped Quick PA (the BSB-0 "quick PA catch-up" item), newest-play Undo
and Restore, and pitching changes; BSB-4 reuses them.

Legacy Baseball stat-grid games, Soccer, Basketball, Hockey and Football are unchanged.
Games stay local-only and behind the BSB-3D device toggle.

---

## 2. What the Engine Already Does

The BSB-1 engine already validates single substitutions:
- pinch hitter (current batter only, while batting);
- pinch runner and courtesy runner (rules flag; for the pitcher or catcher);
- defensive replacement (the incoming player takes the outgoing player's batting slot);
- position change (every displaced fielder must move);
- re-entry under `none`, `starters_once` (original slot, once) and `unlimited`;
- opponent pitcher and opponent slot labels.

The event layer already supports revisioned `update`, `delete` and `restore`
mutations. A batch is accepted only if the full candidate history still projects
(`incomplete_projection` otherwise). Events keep their capture `sequence`; it cannot be
changed.

Gaps BSB-4 must close:
1. **One change per event.** A double switch, or a DH forfeiture, needs two or more
   changes validated together. Applied one at a time, the middle state is illegal
   (two players at one position, or a pitcher who does not bat).
2. **No mid-game insertion.** Capture order is the integer `sequence`, so a pitch that
   was missed cannot be slotted in between two recorded ones.
3. **No lineup correction event.** Batting out of order is not representable (BSB-0
   listed `baseball.lineup_correction`; BSB-1 did not build it).
4. **Handedness is always null.** Setup writes `bats: null` and `throws: null`.

---

## 3. Phone Layout

The tracker gains three tabs under the scoreboard: **Track** (today's diamond and pad),
**Lineup** and **Timeline**. The Game menu keeps lifecycle actions and the capture
switches. Switching tabs never writes anything, and any open sheet on Track stays open.

### 3.1 Lineup tab

- **Our team:**
  - batting order cards, one per slot, the current or next batter highlighted;
  - each card shows the player, number, fielding position or "DH/EH", and hand;
  - a compact defense list by fielding number;
  - the bench, with a note on each removed player saying whether they may re-enter.
- **Their team:** batting slots with label, number and hand, and the current pitcher.
- Tapping a card opens that player's game details (shared product decision), not a
  substitution.
- A **Substitute** button opens the substitution sheet. Its choices are the kinds that
  are legal right now:
  - pinch hitter;
  - pinch runner;
  - courtesy runner;
  - defensive replacement;
  - position switch;
  - double switch;
  - pitching change (the BSB-3D sheet).
- Every sheet ends with the same plain-language summary as the BSB-3D pitching change
  before Confirm. Engine rejections stay in the sheet, word for word.
- The runner menu (tap a runner chip) gains Pinch runner and Courtesy runner entries.

### 3.2 Timeline tab

- Newest first, grouped by half-inning, with each half's line ("Top 3: 2 R, 3 H, 1 E,
  2 LOB").
- Each play row opens the BSB-3D read-only details, which gain **Edit** and **Remove**.
  Removed plays stay listed, collapsed under the half, with **Restore**.
- Filters: half-inning, our team or theirs, and plays with a correction.
- Game-flow rows (start, half end, game end, reopen) stay read-only. A game end is still
  taken back with Reopen.

---

## 4. Slices

| Slice | Content | Done when |
| --- | --- | --- |
| BSB-4A | Lineup tab and every single-change substitution, plus handedness | Each substitution kind can be made from the Lineup tab and survives reload |
| BSB-4B | Multi-change substitutions: double switch and DH forfeiture (Q2) | A double switch is one capture unit with a legal defense after it |
| BSB-4C | Timeline tab, Remove and Restore of any play with a consequence preview | Any play can be removed and restored, and a removal that would break later plays is explained before it happens |
| BSB-4D | Edit any play (pitch result, batted ball, runners, overrides, substitutions) | A wrong result early in an inning can be fixed and the rest of the inning replays |

### BSB-4A Lineup and single-change substitutions

- New `src/lib/baseball/lineupView.ts` (pure): batting cards, defense and bench, with
  each player's re-entry status from the rules and the projection.
- New `src/lib/baseball/substitutionOptions.ts` (pure). It lists the legal choices per
  kind for the current projection, with the same summary lines style as
  `pitchingChange.ts`. Examples:
  - "#14 Ruiz pinch-hits for #7 Lee, batting 4th. Lee leaves the game and may re-enter
    once, in the 4th slot."
  - "#22 Ortiz runs for #2 Garcia (courtesy runner). Garcia stays in the game."
- Each substitution is one `substituteBaseball` event with its own `captureCommandId`,
  so newest-play Undo and Recent plays already cover it.
- **Handedness:**
  - Setup gains optional Bats (L/R/S) and Throws (L/R) per tracked player, pre-start
    only, because setup is frozen once the stream exists.
  - The opponent batter sheet gains a Bats choice, saved through the existing
    `opponent_slot` change.
  - The opponent pitcher sheet gains Throws.
  - The pitch pad labels the batter's box ("Bats L") from the current batter.
- No engine changes are expected. Any defect found is fixed in `src/lib/baseball/` with
  a regression test.

### BSB-4B Multi-change substitutions (needs Q2)

- New payload shape for `baseball.substitution`: `changes: BaseballSubstitution[]`,
  applied in order and validated as a whole. Only the final state must have one player
  per position, a pitcher, and a legal batting order.
- Single-change events keep their current shape and replay unchanged. The new shape is
  a schema-version bump for that event type with a migration that wraps old payloads,
  matching the event registry's migration pattern.
- **Double switch:** pick the new pitcher and the new fielder, then the batting slots
  each one takes. The summary shows both slot moves.
- **DH forfeiture:** the DH or pitcher moves to the field or into the order, and the DH
  slot ends for the game, under each profile's rule.
- Opponent changes stay single (label, number, hand, pitcher).

### BSB-4C Timeline, Remove and Restore

- New `src/lib/baseball/timeline.ts` (pure). It builds:
  - half-inning groups;
  - per-half lines;
  - capture units from `captureCommandId`, as Recent plays does;
  - removed units with their removal time;
  - filter state.
- New `src/lib/baseball/corrections.ts`:
  - `previewBaseballRemoval(state, unitId)` replays the history without the unit and
    reports one of three outcomes:
    - **clean:** the score and outs change as listed;
    - **breaks later plays:** it names the first later play the engine would reject,
      and why;
    - **new warnings:** fielding credit now disagrees with the lineup (`actor_mismatch`).
  - `removeBaseballPlay` applies a removal only when the preview is clean, or when the
    recorder confirms Q1's cascade.
  - `restoreBaseballPlay` brings back a removed unit or cascade group under the same
    check.
- The Recent plays restore receipt stays separate: any Timeline change clears it, as
  Basketball does.
- Removing a pitching change or substitution follows the same preview. For example,
  removing a pinch hitter whose plate appearance is recorded breaks that plate
  appearance, and the preview says so.

### BSB-4D Edit any play

- Edit reopens the same capture sheet the play was recorded with:
  - the pitch result;
  - the in-play sheet;
  - runner resolution (with Advanced overrides);
  - the runner-play menu;
  - the substitution sheet.
- Each sheet is seeded from the stored event and the projection just before it (a
  prefix replay), so proposals, legal reasons and RBI rules match capture time.
- Save writes one `update` mutation per changed event in the unit, after the same
  preview as removal. Some fields are recomputed rather than edited:
  - the period, which only changes through the Q1 cascade;
  - stamped actors, which are re-resolved from the prefix projection.
- What can change on a play:
  - the pitch result and pitch location;
  - the batted-ball result, type, spot and fielders;
  - each runner's destination, reason, fielders, error and overrides;
  - a substitution's players or position.
- What cannot change in place: an event's type or its place in the order. Turning a
  pitch into a runner play means Remove plus a new capture at the end.

---

## 5. Data and Compatibility

- Only BSB-4B adds a payload shape (Q2). It is versioned and migrated on read, so older
  local games replay unchanged.
- No setup version change: handedness fields already exist in setup v1 and stay null
  for games set up before BSB-4A.
- No new event types unless Q3 changes (lineup correction).
- Corrections use the shared revisioned mutations. Every saved history must project
  completely, as today.
- Capture preferences and the restore receipt stay out of fingerprints.
- Games stay on the `unsupported` cloud route. Parking, export, import and reload behave
  as in BSB-3.

---

## 6. Cross-Sport Items Touched

- Timeline and correction rules mirror Basketball BKE-3:
  - consequence preview;
  - capture groups removed together;
  - lifecycle rows read-only;
  - a successful Timeline mutation clears quick Undo.

  Hockey has newest-play Undo only today. Components stay sport-owned.
- The multi-change substitution (Q2) is Baseball-only. Soccer's lineup manager is the
  closest analog, but the semantics differ (batting slots), so nothing is shared.
- Shared files touched: the tracker route stays as it is; the per-sport marker
  convention applies to AGENTS.md and docs/README.md.

---

## 7. Tests and Regression

- **Substitutions:** each kind writes the right event and produces the BSB-1 fixture
  lineup. Re-entry is offered only where the rules allow it, and illegal choices are
  never listed. Courtesy runners are offered only when the rules have them, and only
  for the pitcher or catcher.
- **Double switch and DH forfeiture:** the final state is legal, middle states are not
  checked, and old single-change payloads replay unchanged.
- **Timeline:** half-inning grouping, per-half lines, capture units, removed plays,
  filters.
- **Remove and restore:**
  - a clean removal;
  - a removal that breaks a later play (the preview names it, and nothing is saved
    without confirming);
  - the Q1 cascade and its restore as one group;
  - removing the third out reopens the half, with later plays handled by the cascade;
  - a removal that changes fielding credit raises the warning.
- **Edit:**
  - a ball changed to a strike changes the count, and a later walk becomes invalid and
    is explained;
  - a single changed to a double moves the runner;
  - an out changed to an error removes the out and keeps the batter on;
  - each edit's prefix seeding matches capture-time proposals.
- **Integration:** a seven-inning scripted game with a pinch hitter, a double switch, a
  removed early play with cascade, an edited hit, reload, park, export and import.
- **Browser smoke at 390px, light and dark:** Lineup tab, a pinch runner from the
  runner menu, a Timeline removal with its preview, a restore and an edit.

---

## 8. Risks

- **Cascades.** One changed out can invalidate every later play in the inning. Q1
  decides how much the app does automatically. The recommendation keeps the engine as
  the only judge and never silently rewrites later plays.
- **Edit sheets reused out of context.** Capture sheets assume "now". Seeding from a
  prefix replay keeps proposals honest, and tests compare edit seeding with capture.
- **Screen space.** The Lineup tab must fit 10 to 15 batting cards at 390px. Cards stay
  one line each, with details on tap.

---

## 9. Owner Questions

Each has a recommendation; one word answers are enough.

| # | Question | Options | Recommended |
| --- | --- | --- | --- |
| Q1 | When an edit or removal would break later plays, what happens? | **Remove-later**: the preview lists them and you may remove them too (restorable together), then re-enter / **Block**: refuse until you remove them yourself, newest first | Remove-later |
| Q2 | Support double switches and DH forfeiture now? | **Yes** (BSB-4B, new versioned payload) / **Later** (single changes only in BSB-4) | Yes |
| Q3 | Add a batting-out-of-order correction event? | **Later** (after BSB-5; rare at youth levels) / **Now** | Later |
| Q4 | Where does the lineup live? | **Tab** (Track / Lineup / Timeline) / **Menu** (a sheet from the Game menu) | Tab |
| Q5 | A missed pitch can't be inserted mid-game (capture order is fixed). Is fixing it by editing the next pitch or using Quick PA enough? | **Yes** / **No** (needs an ordering change to the shared event layer) | Yes |
| Q6 | After a correction, if fielding credit no longer matches the lineup, should it save? | **Warn** (save with a visible warning) / **Block** | Warn |
| Q7 | Capture batter and pitcher handedness? | **Yes** (setup for our team, label sheets for theirs) / **No** | Yes |
