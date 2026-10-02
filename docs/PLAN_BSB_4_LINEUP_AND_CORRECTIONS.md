# Plan: BSB-4 Baseball Lineup Management, Timeline and Corrections

Status: approved and merged (PR #459, 2026-10-01). Owner answers (2026-10-01): Q1–Q7
follow the recommendations, for now (section 9). BSB-4A to BSB-4C are implemented; section 10
is the delivery record. Builds on BSB-1 ([engine](PLAN_BSB_1_EVENT_FOUNDATION.md)),
BSB-2 ([setup](PLAN_BSB_2_ROSTER_SETTINGS_AND_SETUP.md)) and BSB-3
([tracker](PLAN_BSB_3_DIAMOND_AND_PITCH_CAPTURE.md)). Product model:
[BSB-0](PLAN_BSB_0_BASEBALL_PRODUCT_MODEL.md) sections 5.4, 8.3 and 12.

Exit condition (BSB-0 roadmap): any recorded mistake can be corrected without
corrupting later state. Here that means: any play can be edited, or removed together
with every later row it invalidates (including explicitly confirmed lifecycle rows,
section 4.1), and the saved history always replays completely. Plays removed by a
correction can then be re-entered at the end.

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
- Game-flow rows (start, half end, game end, reopen) cannot be edited or removed on
  their own. A game end is still taken back with Reopen. A correction may remove a half
  end, game end or reopen only as a listed, confirmed dependency of a play it
  invalidates (section 4.1); the game start is never removed.

---

## 4. Slices

| Slice | Content | Done when |
| --- | --- | --- |
| BSB-4A | Lineup tab and every single-change substitution, plus handedness | Each substitution kind can be made from the Lineup tab and survives reload |
| BSB-4B | Multi-change substitutions: double switch and DH forfeiture (Q2) | A double switch is one capture unit with a legal defense after it |
| BSB-4C | Timeline tab, Remove and Restore of any play with a consequence preview | Any play can be removed and restored, and a removal that would break later plays is explained before it happens |
| BSB-4D | Edit any play (pitch result, batted ball, runners, overrides, substitutions) | A wrong result early in an inning can be fixed and the rest of the inning replays |

### 4.1 Correction contract (applies to BSB-4C and BSB-4D)

Every correction (remove, restore, edit) is checked by replaying the full candidate
history before anything is saved. The preview reports four kinds of consequence:

1. **Changes:** score, outs, half-inning and runner differences the recorder should
   expect.
2. **Dependents:** later rows the engine would reject. The engine stops at the first
   one, so the preview repeats the check with that row removed until the rest replays,
   and lists every dependent found.
   - No automatic period retagging and no automatic rewriting of later plays, ever.
     Plays after a removed third out are dependents, because their stamped half is now
     wrong (`expectCurrentPeriod`).
   - **Lifecycle rows** are dependents like any other row, but they are listed
     separately and by name ("Half-inning ended: time limit", "Final", "Game reopened
     (rain)"). A cascade may remove a manual half end, a game end and any reopen that
     follows it. It never removes the game start. Appending a new Reopen cannot repair
     an earlier game end the change invalidated, because replay fails before reaching
     it. So a game end the correction invalidates is always a dependent, together with
     its later reopen.
   - Under Q1 **Block**, any dependent refuses the correction. Under Q1
     **Remove-later**, the recorder sees the full list and confirms it.
3. **Attribution changes**, found by comparing resolved credit before and after, not
   from the warning list alone. The preview replays the current history and the
   candidate and compares, for every surviving event, the batter, pitcher and fielders
   each one is credited to. They are shown in two groups:
   - **Batting or pitching credit moved:** batter and pitcher lines follow the replayed
     lineup, so any event whose credited batter or pitcher differs is listed with the
     previous and the new credited player, for example "Top 5 plate appearance: moves
     from #14 Ruiz to #7 Lee". This holds whether the candidate adds, changes or
     clears an `actor_mismatch` warning, so both directions need the same confirmation:
     - removing a pinch-hitter substitution credits the later plate appearance to the
       original batter (a mismatch warning appears);
     - restoring that substitution moves it back to the pinch hitter (the warning
       clears, and the move is still listed);
     - removing or restoring a pitching change moves pitching credit the same way.
   - **Fielding credit kept:** fielders keep the credit of the player stamped at
     capture (BSB-1 contract), so fielding credit only moves when the recorder changes
     the fielders or uses Repair attribution (section 4D), and those moves are listed
     like batting moves. A new or changed fielder mismatch is listed as "lineup now
     shows #9 Diaz at shortstop; credit stays with #3 Park".
   - A mismatch warning that clears with no credit transfer is shown as information
     ("now matches the lineup"), is never described as a transfer, and on its own needs
     no confirmation.
4. **Unchanged:** a correction with no dependents and no credit moved saves without a
   prompt.

How a correction saves:
- **Clean:** it saves immediately.
- **Credit moved, no dependents:** under Q6 **Warn**, the preview lists every move
  and needs an explicit "Save with these changes"; under Q6 **Block**, it is refused.
  Restores use exactly the same rule.
- **Dependents:** follows Q1 as above. Warnings found after dependents are removed are
  shown in the same preview.

**Correction receipts.** Each saved correction stores a receipt in Baseball sport state:
`{ id, createdAt, kind: 'remove' | 'edit', primaryEventIds, entries: [{ eventId,
expectedRevision }] }`.
- The receipts are bounded (newest 20), kept outside fingerprints like
  `capturePreferences`, and survive reload, park, export and import as part of the game
  state.
- **Restore together** brings back a removal or cascade as one group, only when every
  entry is still deleted at its expected revision. Otherwise the group is stale; the
  Timeline says which rows changed, and only individual restore is offered.
- **Individual restore** of any removed row works with or without a receipt, through
  the same preview. A row restored on its own drops out of its group.
- Receipts never grant anything the preview would not: restore is always re-checked
  against the current history.
- Edit receipts record which events an edit touched, so the Timeline can show
  "Revised". Edits are not revertible from the receipt, because the engine keeps
  revision metadata but not prior values. A wrong edit is fixed by editing again.
- The quick-Undo `lastUndo` receipt stays separate, and any Timeline correction clears
  it, as Basketball does.

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
- New `src/lib/baseball/corrections.ts`, implementing section 4.1:
  - `previewBaseballRemoval(state, unitId)` returns the changes, dependents (play and
    lifecycle rows separately), and attribution changes by role from a before/after
    credit comparison;
  - `removeBaseballPlay(state, preview, confirmation)` re-runs the preview, rejects a
    stale one, and applies the unit plus confirmed dependents as one atomic mutation
    batch with a correction receipt;
  - `previewBaseballRestore` and `restoreBaseballCorrection` handle group and individual
    restore under the same checks, including credit moved back.
- `projector.ts` gains `replayBaseballCreditByEvent(setup, events)` next to
  `replayBaseballRunsByEvent`: the credited batter, pitcher and fielders per event from
  the same replay that builds the lines, so the preview compares real credit, not
  warnings.
- Removing a substitution or pitching change follows the same preview. Its later plays
  usually still replay, with batting or pitching credit moved, so the preview lists
  them as attribution changes rather than dependents.

### BSB-4D Edit any play

- Edit reopens the same capture sheet the play was recorded with:
  - the pitch result;
  - the in-play sheet;
  - runner resolution (with Advanced overrides);
  - the runner-play menu;
  - the substitution sheet.
- Each sheet is seeded from the stored event and the projection just before it (a
  prefix replay), so proposals, legal reasons and RBI rules match capture time.
- Save writes one `update` mutation per changed event in the unit, plus any confirmed
  dependents' removals, after the section 4.1 preview.
- The period is never edited. A change that makes later rows land in the wrong half
  makes them dependents.
- **Stamped actors are preserved.** An actor role is restamped only when the edit
  changes it:
  - a changed fielder list restamps the `fielder_{n}` roles it adds, and drops the ones
    it removes;
  - the batter and pitcher stamps stay as recorded;
  - every untouched role keeps its original participant, even when the prefix lineup
    now shows someone else.

  A location-only or result-only edit therefore leaves `actors` unchanged, and a
  putout credited before an earlier lineup correction stays with its stamped fielder.
- **Repair attribution** is a separate, explicit action on a row that has an
  `actor_mismatch` warning. It restamps the chosen roles to the replayed lineup and
  shows each role's before and after credit before Confirm.
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
- Correction receipts (section 4.1) live in Baseball sport state, are bounded and stay
  out of fingerprints, like capture preferences and the quick-Undo receipt. Older games
  read with an empty list. BSB-6 decides whether receipts sync.
- Games stay on the `unsupported` cloud route. Parking, export, import and reload behave
  as in BSB-3.

---

## 6. Cross-Sport Items Touched

- Timeline and correction rules mirror Basketball BKE-3:
  - consequence preview;
  - capture groups removed together;
  - lifecycle rows are never edited directly; they are removed only as listed,
    confirmed dependents (section 4.1), and the game start never;
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
- **Attribution:**
  - removing a pinch-hitter substitution replays the later plate appearance, credited
    to the original batter, with a batter attribution change in the preview;
  - restoring that substitution moves the plate appearance back to the pinch hitter;
    the warning clears, yet the preview still lists the move from the original batter
    to the pinch hitter and needs the same confirmation;
  - removing a pitching change moves pitching credit, with a pitcher attribution
    change, and restoring it moves the credit back with the same confirmation;
  - a correction that only clears a fielder mismatch, with no credit moved, saves
    without confirmation and shows the cleared warning as information;
  - an earlier defensive correction keeps the stamped putout and lists it as fielding
    credit kept;
  - a correction whose only consequence is moved credit needs the explicit
    confirmation (or is refused under Q6 Block).
- **Stamped actors:** a location-only edit after an earlier lineup correction leaves
  `actors` and fielding credit unchanged. A fielder-list edit restamps only the changed
  roles. Repair attribution shows before/after and restamps only the chosen roles.
- **Lifecycle boundaries:**
  - removing a third out before a manual half end lists the half end and the later
    half's plays as dependents, and no period is retagged;
  - removing a walk-off play in a completed game with a later Reopen lists the game end
    and the Reopen as dependents; the cascade replays, and restore together brings all
    of them back;
  - the game start is never a dependent;
  - under Block, both are refused.
- **Receipts:** group restore after reload and after export/import; a group made stale
  by an independent restore or edit falls back to individual restore; the bounded list
  drops the oldest receipt.
- **Remove and restore:**
  - a clean removal;
  - a removal that breaks a later play (the preview names it, and nothing is saved
    without confirming);
  - the Q1 cascade and its restore as one group;
  - removing the third out reopens the half, with later plays handled by the cascade;
  - a removal that changes fielding credit raises a fielding-credit-kept warning.
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

- **Cascades.** One changed out can invalidate every later play in the inning, and the
  half ends and game end after it. Q1 decides whether those are removed after
  confirmation or block the correction. Either way the engine is the only judge,
  lifecycle rows are named in the preview, and later plays are never silently
  rewritten or retagged.
- **Attribution drift.** Batting and pitching credit follow the replayed lineup, so a
  lineup correction can move credit without any replay failure. The preview makes every
  such move visible before saving, in both directions, because it compares credited
  players rather than warnings.
- **Edit sheets reused out of context.** Capture sheets assume "now". Seeding from a
  prefix replay keeps proposals honest, and tests compare edit seeding with capture.
- **Screen space.** The Lineup tab must fit 10 to 15 batting cards at 390px. Cards stay
  one line each, with details on tap.

---

## 9. Owner Questions

Answered 2026-10-01: Mark chose the recommendation for every question "for now"
(Remove-later, Yes, Later, Tab, Yes, Warn, Yes). The slices above already assume
these answers; a later change of mind lands as its own plan revision.

| # | Question | Options | Recommended (chosen) |
| --- | --- | --- | --- |
| Q1 | When an edit or removal would break later plays, what happens? | **Remove-later**: the preview lists them, including any half end, game end or reopen they depend on, and you may remove them too (restorable together), then re-enter / **Block**: refuse until you remove them yourself, newest first | Remove-later |
| Q2 | Support double switches and DH forfeiture now? | **Yes** (BSB-4B, new versioned payload) / **Later** (single changes only in BSB-4) | Yes |
| Q3 | Add a batting-out-of-order correction event? | **Later** (after BSB-5; rare at youth levels) / **Now** | Later |
| Q4 | Where does the lineup live? | **Tab** (Track / Lineup / Timeline) / **Menu** (a sheet from the Game menu) | Tab |
| Q5 | A missed pitch can't be inserted mid-game (capture order is fixed). Is fixing it by editing the next pitch or using Quick PA enough? | **Yes** / **No** (needs an ordering change to the shared event layer) | Yes |
| Q6 | After a correction, if credit moves (batting or pitching) or no longer matches the lineup (fielding), should it save? | **Warn** (the preview lists every change and you confirm) / **Block** | Warn |
| Q7 | Capture batter and pitcher handedness? | **Yes** (setup for our team, label sheets for theirs) / **No** | Yes |

---

## 10. Delivery Record

### BSB-4A Lineup tab, single-change substitutions and handedness

- `lineupView.ts` (pure): batting cards (slot, position or DH/EH/"No position", hands,
  Batting/Up next, the starter replaced, shown in the player details), defense rows, open positions, the bench with
  each player's re-entry note, the opponent slots and pitcher, the current batter's hand,
  and a read-only player game detail. `baseballCanEnter` mirrors the projector's
  admission rule: nobody already in the game, and a returning starter only once, into
  the original slot under `starters_once`.
- `substitutionOptions.ts` (pure): pinch hitter, pinch runner, courtesy runner,
  defensive replacement and position switch, grouped by target, each with a summary
  line in the BSB-3D style. Deliberate limits, all multi-player changes for BSB-4B:
  a DH or EH taking a filled position, and a fielder leaving from another position to
  fill an open one. Courtesy runners are offered only from players who have not
  appeared, which is stricter than the engine.
- `substitutions.test.ts` checks, in seven game states, that every listed option is
  accepted by the engine and every engine-accepted single change is listed apart from
  the deliberate limits above.
- Fix found on the way: the BSB-3D pitching change listed a returning starter for the
  pitcher's slot even when it was not that starter's original slot; it now uses
  `baseballCanEnter`.
- Tracker: Track / Lineup tabs (switching writes nothing and keeps open sheets), the
  Lineup tab with Substitute, player details, opponent slot edits (label, number, Bats)
  and the opponent pitching change (now with Throws). The runner menu offers Pinch
  runner and Courtesy runner, opening the Lineup tab with that runner chosen. An open
  position shows a banner on Track while the opponent bats, because the engine refuses
  the next pitch until the defense is complete.
- Handedness: setup takes optional Bats (L/R/S) and Throws (L/R) per dressed player,
  Bats per opponent slot and Throws for the opponent starter. The pitch pad labels the
  batter's box from the current batter. No setup version change; older games read
  null hands.
- No new event types, payloads or migrations. Each substitution is one
  `baseball.substitution` event with its own `captureCommandId`, so Undo and Recent
  plays cover it. Browser smoke at 390px: setup hands, Bats S/L on the pad, pinch runner
  from the runner menu, pinch hitter, both open positions filled, a position switch,
  player details, reload unchanged, no horizontal scroll, dark theme.

### BSB-4B Double switch and DH forfeiture

- `baseball.substitution` moved to schema 2: `{ captureCommandId, changes }`, one to six
  changes applied in order. Only the result has to be a legal lineup. Opponent changes
  stay one per event. Schema 1 events migrate on read through the registry, and
  `baseballSubstitutionChanges` reads both shapes because Restore replays stored events
  directly. Older games replay unchanged: the migration marks the event
  `legacyLineupRules: true` (raw schema 1 payloads count too), and such events replay
  under exactly the BSB-4A checks, skipping the whole-event checks below. The marker is
  accepted only on one BSB-4A change, and new writes never carry it. A DH already in the
  field from such a history does not block later, unrelated changes.
- Rules checked once per event: a fielder moved off a position must hold a new one or
  have left the game (extra-hitter and continuous batters may stay in as batters); a
  non-batting pitcher who loses the position leaves the game. In a DH game, the DH slot
  is the one whose setup starter had no position; while the pitcher does not bat, its
  occupant may not take the field, and once every fielder bats the DH cannot return.
  This is stricter than BSB-4A in two cases: a DH taking a filled position on its own,
  and a position change that drops a fielder, are now rejected unless the event also
  places that fielder.
- New change `batting_slot`: a fielder who does not bat (the pitcher in a DH game) takes
  a player's batting slot, and that player leaves.
- Lineup sheet: **Double switch** picks the position, the new pitcher, the new fielder and
  the batting slots (switched by default, or unchanged); **End the DH** offers the DH to
  any position (the fielder there leaves and the pitcher bats in that slot; the DH
  pitching sends the pitcher out) or the pitcher batting for the DH. Summaries name every
  slot and who leaves. Recent plays read "Double switch: ..." and "...; the DH role ends".
- `multiSubstitutions.test.ts` covers the migration (inspection, raw replay, Undo and
  Restore of a schema 1 event), a literal pre-BSB-4B fixture for the DH filling an open
  catcher spot after a pinch hitter (hydration, reload, review, Undo/Restore, legal options
  and continued play, while the same new write is rejected), BSB-4A checks still applied
  to saved events, a forged marker rejected, whole-event checks, the double switch pickers and result,
  each forfeiture path and its rejections, and the rendered pickers. The BSB-4A engine
  cross-check now also replays every multi-change option. Browser smoke at 390px: a
  double switch at LF and the DH taking LF, reload unchanged, no horizontal scroll, dark
  theme.

### BSB-4C Timeline, Remove and Restore

- `units.ts` now holds the capture-unit helpers (active and removed events, grouping by
  `captureCommandId`, capture types) that Recent plays, the Timeline and corrections share.
- `timeline.ts` (pure): units by half-inning, newest first, each half with its batting
  team and line ("0 R, 0 H, 0 E, 0 LOB"). Removed rows stay under their half with their
  removal time and saved group. Rows carry Revised (`revision > 1`), the first lineup
  warning, and the team they concern. Filters: half-inning, team and corrected only.
- `projector.ts` gains `replayBaseballCreditByEvent`: the batter, pitcher and tracked
  fielders each pitch, quick plate appearance and runner play credits, from the same
  replay. A half-inning mismatch now reads "Recorded in Bottom 1, but play is now in
  Top 1." instead of the period id.
- `corrections.ts`:
  - `previewBaseballRemoval` and `previewBaseballRestore` (one removed unit, or a saved
    group while every entry is still removed at its expected revision) replay the
    candidate history. Each rejected later row is a dependent, removed with its whole unit
    and replayed again, listed as plays or game flow with the engine's reason. The game
    start and the rows being restored are never dropped; that refuses the correction.
  - Changes compare score, status, half-inning, outs, count and runners. Credit compares
    batter, pitcher and fielders per surviving event, grouped by half and role ("Bottom 1
    batting: moves from #10 to #1 (2 plays)"). New fielder mismatches are "credit
    stays with ..."; cleared ones with no move are information only.
  - Dependents, credit moves or kept fielding credit need "Save with these changes"
    (Q1 Remove-later, Q6 Warn). `removeBaseballPlay` and `restoreBaseballCorrection`
    re-run the preview, reject a stale one, and save one atomic mutation batch. The
    preview key binds every stored event's id, revision and removal state, so any change
    to the history since (even an Undo then Restore) makes it stale.
  - Receipts (`capturePreferences.corrections`, newest 20, outside fingerprints, `[]` for
    older games) record each removal's rows and dependents. Group restore consumes its
    receipt; a row restored alone drops out of its group; dependents removed by a restore
    get their own receipt. Every correction clears quick Undo's receipt.
- UI: a Timeline tab with collapsed filters, rows that open the play details with
  **Remove…**, collapsed Removed lists with Restore and Restore together, and a preview
  sheet listing changes, later rows (plays and game flow), credit moves, fielding credit
  kept and information.
- `corrections.test.ts` covers a clean removal, flow rows refused, a broken later play
  needing confirmation, a stale preview (including a history change whose consequences
  read the same, for remove, individual restore and group restore), the third-out cascade and group restore, game
  end and reopen as lifecycle dependents, quick Restore cleared, pinch-hitter and
  pitching-change credit moving both ways, fielding credit kept and then cleared, receipt
  round trip and bound, group fallback, Timeline grouping and filters, and the rendered
  Timeline and preview. Browser smoke at 390px: the third-out cascade removed and restored
  together, a clean removal and individual restore after reload, dark theme, no
  horizontal scroll.
