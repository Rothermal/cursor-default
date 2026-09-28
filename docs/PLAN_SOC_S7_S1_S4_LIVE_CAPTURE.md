# Soccer Live Capture Plan: S7, S1, S4

Status: plan under review. The owner accepted every recommended answer in
[Section 6](#6-owner-questions) on 2026-09-28. Implementation waits for the
plan PR to be approved and merged. Do not implement from `PLAN_SOC_FIELD_TEST_BACKLOG.md`;
this file is the execution plan for `S7`, `S1`, and `S4`.

**Goal:** Make the three most common sideline gestures short: a shot after a
set piece links itself (`S7`), an ordinary shot or goal takes two or three taps
(`S1`), and the last action can be undone without leaving Field (`S4`).

**Architecture:** No new event type, payload field, migration, or cloud RPC.
`S7` defaults the existing `soccer.shot.payload.sourceEventId` and improves how
the link is presented. `S1` adds a live-only compact shot sheet that writes the
same `recordSoccerShot` / `recordSoccerOwnGoal` input and hands off to the
existing full dialog for detail. `S4` adds a Field Undo sheet that removes the
newest user-recorded event through the existing `deleteSoccerHistoryEvent`
checked helper, so Timeline stays the single correction authority.

**Order:** S7 first because S1's compact sheet displays and consumes the S7
default. S4 is independent and can land in parallel after S7.

## 1. Code grounding

| Concern | Current code |
|---|---|
| Shot link field | `SoccerShotPayload.sourceEventId` in `src/lib/soccer/types.ts`; validated by `validateSoccerShotSource` in `src/lib/soccer/soc4.ts` (penalty and direct free kick require the matching foul by the opposite side; corner sequence requires a corner for the shooting side; same period, earlier sequence and time) |
| Candidate list | `soccerShotSourceCandidates` in `src/lib/soccer/capture.ts` (newest first) |
| Shot sheet | `src/components/soccer/SoccerShotCaptureDialog.tsx`: one form for live, historical, and edit. Situation defaults to Open play and the source is empty unless the recorder changes Situation. Shooter silently defaults to the first non-goalkeeper on the field |
| Field entry points | `SoccerGameTracker.tsx`: pitch tap in Shot mode and Quick Goal both call `setCaptureDraft` |
| Link presentation | `SoccerTimeline.tsx` `eventContextDetail` prints `Linked restart: <first 8 id chars>`; Summary Timeline only uses the link for the Restarts filter |
| Removal | `deleteSoccerHistoryEvent` / `restoreSoccerHistoryEvent` in `src/lib/soccer/live.ts`; Timeline row labels live in private `eventTitle` / `eventDetail` in `SoccerTimeline.tsx` |
| Cloud | `sourceEventId` is payload-only; no migration validates it. Removal is an ordinary revision already carried by event transport |

## 2. S7: Restart-to-shot link

### 2.1 Is `sourceEventId` enough?

Yes. Both owner examples are a single link:

- Foul (penalty) -> penalty kick -> goal: the penalty kick *is* the shot, with
  `situation: 'penalty'` and `sourceEventId` = the foul.
- Corner -> header -> goal/save/miss: the header *is* the shot, with
  `situation: 'corner_sequence'`, `bodyPart: 'head'` (S15), and
  `sourceEventId` = the corner.

A corner that produces a saved header and then a rebound shot is two shots
linked to the same corner, which a one-level link already groups. No capture
group, chain id, or schema change is added. Revisit only if a later request
needs chains longer than restart -> shots.

### 2.2 Live default

Add a pure helper `suggestSoccerShotSource(events, { teamSide, period, elapsedMs })`
in `src/lib/soccer/capture.ts` returning `{ situation, sourceEventId } | null`.
It looks at active events in the current period, newest sequence first, and
returns the first eligible restart when all of these hold:

- It is a corner awarded to the shooting side, or a foul committed by the
  opposite side with restart `penalty` or `direct_free_kick`.
- It is within 60 seconds of match clock of the shot moment.
- Every event recorded after it is a card, a non-capture row (clock, role,
  lineup, direction), or, for a corner only, a non-scoring shot by the same
  side. Any other capture (defensive action, a different restart, a foul, an
  opponent shot, a goal by either side) means play has moved on and the
  default is dropped.

Continuation is restart-specific:

- A corner carries through non-scoring same-side shots, so corner -> saved
  header -> rebound still defaults to Corner sequence from that corner.
- A penalty or direct-free-kick foul is consumed by its first shot. Any later
  rebound defaults to Open play with no source, because the projection counts
  every `penalty` / `direct_free_kick` shot as another attempt from that
  restart and capture excludes creators for those situations.
- The scan stops at the newest restart it reaches. A consumed penalty or
  direct free kick returns no default; it never falls back to an older
  eligible restart behind it.

Broader causal linking of a rebound to the set piece that preceded it is not
part of this plan. If it is wanted later, it must stay separate from the
shot's statistical `situation`.

Situation maps from the source: corner -> `corner_sequence`, penalty foul ->
`penalty`, direct-free-kick foul -> `direct_free_kick`. A penalty default also
applies the existing penalty-mark location when the tap had none (Quick Goal),
and clears creators exactly as a manual Situation change does today.

The default applies only to live capture (`mode: 'live'`). Historical add and
edit keep their current behavior; the recorder can still pick a source there.
The recorder clears the default with one tap (Section 3.1), which returns the
shot to Open play with no source.

### 2.3 Penalty prompt

After a live foul with restart `penalty` is saved, Field shows a one-shot
"Log penalty kick" button in the quick-capture area. It opens the shot sheet
for the fouled side with situation Penalty, the foul as source, and the
penalty-mark location. It disappears after any other capture, a tab change,
period end, or dismissal. It is component-local state like the one-shot
Restart mode, never persisted. (Question Q1.)

### 2.4 Presentation

- Extract Timeline labelling into `src/lib/soccer/eventLabels.ts`
  (`soccerEventTitle`, `soccerEventDetail`) so Timeline, Summary, and the S4
  Undo sheet share one vocabulary.
- Replace `Linked restart: <id>` with a readable source line, for example
  `From corner, taker #7 Ava, 23:10` or `From penalty foul on #9 Mia, 41:02`.
  A missing or removed source reads `Linked restart removed` and stays a
  diagnostic, as today.
- On the restart row, add `Led to: Goal (header) #9 Mia, 23:14`, listing every
  active shot linked to it.
- Summary Timeline (oldest first) nests linked shots directly under their
  restart row with a connector, even when other rows share the same minute.
  Live Timeline (newest first) keeps its order and uses the two text lines.
- Field marker detail for a linked shot shows the source line. No new marker
  or connecting line on the pitch.

### 2.5 Tests

- `capture.test.ts`: suggestion eligibility for each source kind, side rules,
  60-second window, intervening-event rules, removed sources, period boundary.
  Discriminating continuation cases: corner -> save -> rebound keeps the
  corner; penalty -> save -> rebound and direct free kick -> block or save ->
  rebound return no default; each consumed case also has an older eligible
  restart behind it that must not be returned.
- `shotCaptureWiring.test.ts`: live Field tap and Quick Goal open with the
  suggested situation and source; clearing returns to Open play; historical and
  edit modes are unaffected.
- `summaryTimeline.test.ts` / Timeline render tests: source and "Led to" lines,
  nesting, removed-source diagnostic.

## 3. S1: Faster shot and goal capture

### 3.1 Live compact sheet

Add `SoccerQuickShotSheet` for `mode: 'live'` only. Historical add, edit, and
Timeline keep the existing full dialog unchanged.

Tracked side flow:

1. Outcome row: Goal, Saved, Blocked, Off target, Woodwork (Quick Goal opens
   with Goal already chosen).
2. Shooter chips: on-field tracked players in the existing S25 actor order
   (Forward, Midfielder, Defender, Goalkeeper, Custom), plus Team. No shooter is
   preselected (Question Q2).
3. For Blocked, Off target, and Woodwork, tapping the shooter saves immediately
   (Question Q3). For Goal and Saved, an optional step shows "Assisted by"
   chips (teammates on the field, excluding the shooter) with Save and Skip.
   Penalty and direct-free-kick shots skip the assist step, matching today's
   creator rule.

Opponent side flow: outcome, then Save. The tracked goalkeeper defaults to the
current on-field goalkeeper, as today, and the shooter is Unknown opponent.

Always visible in the compact sheet:

- The S7 source chip, for example `From corner 23:10`, with a clear (x) button.
- A "More details" button that opens the full dialog pre-filled with
  everything chosen so far (outcome, shooter, assist, situation, source,
  location). Own goal, blocker, goalkeeper labels, secondary assist, body
  part, placement, and location editing stay there.

### 3.2 Remembering the last shooter

Instead of a silent default, the compact sheet marks the last tracked shooter
used in this match (component memory for the tracker session) with a ring so
the recorder can find them quickly. It is still one tap to choose them.

### 3.3 Implementation notes

- Extend `SoccerCaptureDraft` with optional initial fields (`shooter`,
  `primaryCreator`, `situation`, `sourceEventId`) so "More details" hands off
  without loss. The full dialog's initialization effect reads them only when
  no `event` is being edited.
- Build the record input through one shared pure builder so the compact sheet
  and the full dialog cannot drift (move the input assembly out of the dialog's
  `save` into `src/lib/soccer/shotInput.ts`).
- Chips need 44px targets and must fit 390px width without horizontal scroll.

### 3.4 Tests

- Builder unit tests: compact inputs equal the full dialog's inputs for the
  same choices.
- Render tests: tap counts for each outcome, assist step only for Goal and
  Saved outside penalty/direct free kick, opponent flow, More details hand-off,
  S7 chip clear.
- Existing `shotCaptureWiring.test.ts` stays green for historical and edit.

## 4. S4: Recent-events undo on Field

### 4.1 Behaviour

- Add an Undo icon button to the Field match-action row (next to More match
  actions). It is disabled when there is nothing to undo, the game is final in
  the cloud, or the history is unhealthy.
- It opens `SoccerRecentEventsSheet`: the five newest user-recorded events by
  recording order, labelled with the shared S7 labels and match time. Only the
  top row has an "Undo" button, matching basketball F12; older rows are
  context and link to Timeline for out-of-order correction.
- Undo calls `deleteSoccerHistoryEvent` on that event and applies the result
  through the tracker's existing `applyResult`, which already rejects a change
  that leaves the history incomplete. Removed events remain visible and
  restorable in Timeline, exactly as a Timeline removal does.
- After an undo, the sheet offers "Restore" for that event until the next
  capture or until the sheet closes (Question Q5). Restore uses
  `restoreSoccerHistoryEvent`.

### 4.2 What counts as user-recorded

Included: shots, own goals, score adjustments, defensive actions, fouls, cards,
restarts (`team_event`), and substitutions or lineup changes (Question Q4).
Lineup rows obey the same paused-clock rule the lineup manager already
enforces; if the clock is running, the row shows "Pause the clock to undo."

Excluded and shown as a stop line: kickoff, period start/end, clock changes,
match end/reopen, shootout events, and rules or direction changes. Undo never
reaches past such a row; the recorder uses Timeline instead.

Newest means highest `sequence` recorded on this device, so a historical add
made from Timeline is the newest event and is what Undo removes. This matches
basketball and avoids surprising out-of-order removal.

### 4.3 Dependencies

Newest-only undo removes dependents before their sources, so a linked shot is
removed before its corner. If the newest event is a restart that a later
removed-and-restored shot still references, the checked helper's rejection is
shown inline with a Timeline link. No cascade removal is added.

### 4.4 Tests

- Pure selector (`soccerRecentUndoCandidates`) tests: included families, stop
  lines, recording-order newest, removed events skipped.
- Tracker tests: Undo disabled states, undo then restore, lineup row blocked
  while running, rejection surfaced inline.

## 5. Delivery slices

| Slice | Contents | Depends on |
|---|---|---|
| S7A | `suggestSoccerShotSource`, live defaults in the existing dialog, penalty prompt | none |
| S7B | `eventLabels.ts` extraction, source and "Led to" lines, Summary nesting, marker detail | S7A |
| S1 | Shared input builder, compact live sheet, More details hand-off, last-shooter ring | S7A |
| S4 | Recent-events selector, Undo button and sheet, restore | S7B labels |

Each slice is one PR with typecheck, lint, tests, and a 390px browser check in
both themes. No slice needs a Supabase migration.

## 6. Owner questions

Owner decision 2026-09-28: all recommended answers accepted (Q1 yes, Q2 no
preselected shooter with last shooter highlighted, Q3 yes, Q4 yes when paused,
Q5 yes until the next capture).

- **Q1 Penalty prompt.** After a penalty foul, show a one-shot
  "Log penalty kick" button? **Yes (recommended)** / No, just default the
  next shot.
- **Q2 Shooter default.** In the compact sheet, **no preselected shooter,
  last shooter highlighted (recommended)** / preselect the last shooter /
  keep today's first-forward default.
- **Q3 Auto-save misses.** For Blocked, Off target, and Woodwork, save as soon
  as the shooter is tapped? **Yes (recommended)** / No, always press Save.
- **Q4 Undo substitutions.** Include lineup changes in Field Undo?
  **Yes, when paused (recommended)** / No, shots and incidents only.
- **Q5 Restore after undo.** Offer Restore in the Undo sheet?
  **Yes, until the next capture (recommended)** / No, Timeline only.

## 7. Out of scope

- New shot outcomes, xG, or chains longer than restart -> shots.
- Out-of-order undo from Field, or cascade removal of dependent events.
- Changes to historical add or edit dialogs beyond reading S7 labels.
- `S8` lineup live board, `S10` defense without a mode switch, `S5` opponent
  identities.
