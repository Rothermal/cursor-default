# Plan: BKE-2 Complete Basketball Event Capture

Detailed plan for restoring the complete Basketball live tracker on top of the authoritative event
model. BKE-2 keeps the internal, local-only creation gate established in BKE-1C while replacing every
remaining live counter mutation with one checked event command.

Status: Approved through the BKE-2 product and delivery Q&A. Implementation is split into BKE-2A
through BKE-2D. BKE-2A, BKE-2B, BKE-2C1, and BKE-2C2 are implemented; BKE-2C3 is next.

Depends on:

- [PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md](PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md)
- [PLAN_BKE_1_EVENT_FOUNDATION_AND_COURT.md](PLAN_BKE_1_EVENT_FOUNDATION_AND_COURT.md)
- [PLAN_BKE_1C_COURT_EVENTS.md](PLAN_BKE_1C_COURT_EVENTS.md)

## 1. Goal

BKE-2 exits when an internally created Basketball event game can complete every normal live-tracking
workflow without using aggregate reducer actions as a second authority. The direct stat grid, score
controls, periods, overtime, late participants, fouls, free throws, ejections, timeouts, manual
minutes, team actions, bonus state, correction confirmations, and Recent Events boundaries must all
round-trip through the checked Basketball event layer.

BKE-2 does not deliver the editable Timeline/F13 detail experience, cloud transport, Summary
authority, canonical aggregates, layered Basketball settings, production opt-in, game clock, or
lineup intervals. Those remain BKE-3 through BKE-6.

## 2. Phase Map

| Phase | Scope | Exit condition |
|---|---|---|
| BKE-2A | **Implemented.** Lifecycle and late-participant commands/UI, sequential period and overtime transitions, local completion, generalized live capture units, and non-undoable lifecycle boundaries | Event games can add valid participants, advance and complete coherently, and never undo an ordinary capture across a lifecycle boundary |
| BKE-2B | **Implemented.** Direct player/team stat commands, unlocated field goals/free throws, score adjustments, manual minutes, optional steal-turnover pairing, standalone decrements, and event-backed grid/score UI | Every ordinary direct stat and score action has exactly one event-backed source of truth |
| BKE-2C | Structured fouls, linked free-throw trips and attempts, one-and-one handling, player/staff ejections, charged and neutral timeouts, and dependency-aware administrative corrections. Delivered as BKE-2C1 through BKE-2C4 below. | Discipline and administration capture preserve rule-derived totals and linked-event integrity |
| BKE-2D | Complete team/period tracker presentation, local suspend/abandon/reopen controls, bonus and inventory state, unavailable-participant behavior, full parity fixtures, regression docs, and BKE-2 exit audit | No live Basketball control is hidden or counter-backed in a healthy event game, every modeled local terminal state is reachable, and legacy Basketball plus Soccer remain unchanged |

Each slice uses its own feature branch and PR. A later slice may use commands from an earlier slice,
but no slice may expose a control before its complete checked transition and correction behavior are
available.

## 3. Guardrails

- Basketball event-game creation remains development-only, local-only, and off by default. BKE-5
  owns the user-visible opt-in.
- No BKE-2 change writes Basketball events to Supabase. Migration 042 continues to reject neutral
  cloud event rows until BKE-4A.
- The event stream is the sole authority. UI actions never dispatch an event command and a legacy
  stat, score, period, or roster mutation for the same fact.
- Every command accepts `GameState` plus explicit recorder/time dependencies and returns either one
  fully projected state or the original state with a typed product-facing error.
- Multi-event capture and correction use one atomic append or mutation. React never coordinates a
  best-effort sequence of dependent writes.
- Projection supplies score, player/team stats, periods, bonus, timeout use, disqualification, and
  shot records. Compatibility fields remain disposable caches.
- Capture preferences and open-sheet drafts are non-authoritative. Persisted participant selection
  may resume; unfinished form input does not enter the event stream.
- Legacy Basketball keeps the existing reducer tracker. Soccer behavior remains unchanged.
- Corrupt or incomplete authoritative state fails closed. BKE-2 does not reveal legacy controls as a
  fallback for a marked game.

## 4. Shared Live-Command Contract

### 4.1 Context and attribution

- Extend the Basketball command layer rather than creating UI-owned event constructors.
- Resolve current period, recorder sequence, timestamp, command id, selected side, actor, and
  relationship targets centrally.
- Persist one selected capture side/player across the court, grid, and structured sheets. Every sheet
  visibly names its target and never silently resets it.
- Use rostered opponent participants when available. Use an `unknown` actor for genuinely
  player-attributed opponent facts without a roster, and a team actor only for team-level facts.
  Never fabricate a participant.
- Append a late individual through the existing validated `basketball.match_roster_added` family
  before making them selectable. BKE-2A wires its checked command and UI; it does not register a
  second participant-addition event. Pseudo-players remain compatibility rows, not match participants.

### 4.2 Failure behavior

- A rejected command leaves the complete state byte-for-byte unchanged.
- A focused sheet remains open with entered values and displays the checked-command error inline.
- Controls derive disabled state from the same command preconditions used on submit where practical.
- A successful unrelated event mutation invalidates the one-level restore receipt. A rejected
  mutation does not.

### 4.3 Capture units and lifecycle boundaries

- Expand Recent Events from court-only units to every live Basketball capture command. Events sharing
  one non-null `captureCommandId` render and undo as one unit; null command ids remain individual.
- Period starts, period ends, every match end, and match reopen render as lifecycle rows and
  non-undoable boundaries. Ordinary Undo cannot search past the newest boundary into an earlier
  period or terminal state.
- Participant identity resolution is an administrative, non-undoable boundary rather than an
  ordinary capture. The quick Undo surface must not rewrite stable identity; BKE-3 owns deliberate
  identity-event editing and its dependent-history review.
- Dedicated lifecycle controls own period correction. BKE-3 later supplies arbitrary event editing.
- Immediate grouped undo/restore remains newest-first and one-level. It never partially restores a
  stale receipt.

## 5. BKE-2A: Lifecycle, Participants, and Boundaries

### 5.1 Late participants

- Restore Add Player for healthy event games through a focused sheet with side, name, and number.
- Default to the selected side. Require a non-empty individual name and preserve number as optional.
- The existing side team actor remains a separate picker target, not a participant option. Selecting
  a team chip never fabricates or appends a participant row.
- Append `basketball.match_roster_added` and select the new individual in one checked transition.
  Reuse its existing participant/destination validation and projector duplicate guards.
- Permit tracked and opponent additions. Opponent rosters remain optional.
- Reject duplicate stable participant ids and additions after local completion.

### 5.2 Period progression

- Replace freely selectable legacy period tabs with a current-period display and explicit End Period.
- End the active period before starting the next sequential stable segment. Never jump directly to an
  arbitrary earlier or later period from the live tracker.
- Regulation labels/count come from the immutable snapshot. Add one overtime segment at a time.
- An open unsaved sheet must be completed or cancelled before transition. A persisted empty or
  partial free-throw trip remains reviewable and does not block the period.
- Reject captures against ended periods and new periods after completion.

### 5.3 Overtime and completion

- Basketball v1 is winner-required and has no configurable draw/tie rule in the immutable snapshot.
  After tied regulation, offer Start Overtime. Ending the game remains a separate action.
- Permit another overtime after a tied overtime. Never pre-create unused overtime segments.
- End Game appends local completion only after the active period is ended with a non-tied score.
- Completion makes ordinary capture read-only. Cloud finalization/reopen remain BKE-4C.

### 5.4 Verification

- Add tracked/opponent participants, reload/park, and confirm stable identity and selection.
- Reject malformed/duplicate participants without changing state.
- Advance regulation and multiple overtimes sequentially; reject jumps and ended-period writes.
- Prove Recent Events cannot undo a stat across a lifecycle boundary.
- Confirm completed local games reject ordinary capture and remain reviewable.

### 5.5 Implemented behavior

- `src/lib/basketball/commands.ts` owns checked late-participant, period-end, next-period, dynamic
  overtime, and local-completion transitions. Successful commands append and reproject once;
  failures return the original state.
- Game Tracker exposes the current segment and only the valid next lifecycle action. Court capture
  and court correction controls are read-only during period breaks and after completion.
- Add Participant supports tracked and opponent individuals without changing the immutable opening
  setup. The projected participant registry, compatibility player rows, and persisted capture target
  update together.
- Recent Events now reads every active Basketball event command. Lifecycle rows are visible
  non-undoable boundaries; a late-roster addition remains an undoable/restorable capture unit.

## 6. BKE-2B: Direct Stats, Score, and Minutes

### 6.1 Direct stat mapping

| Grid action | Event behavior |
|---|---|
| Made/Missed 2PT or 3PT | Unlocated field-goal `basketball.shot` with `valueSource: 'quick_entry'` |
| Made/Missed FT | Unlocated, ungrouped free-throw `basketball.shot`; structured trips are BKE-2C |
| Offensive/Defensive rebound | Standalone `basketball.rebound` with no required shot link |
| Assist | Standalone `basketball.assist` with no required shot link |
| Steal | Standalone `basketball.steal`, or the optional compound flow below |
| Block | Standalone `basketball.block` with no required shot link |
| Player turnover | Player-attributed `basketball.turnover` |
| Team turnover | Team-actor `basketball.turnover`; never charge an individual |
| Minutes +1/-1 | Signed `basketball.minutes_adjustment`; reject subtraction below zero |

- Keep the familiar category grid and compact plus/minus controls. Structured actions open sheets.
- Direct assists, rebounds, blocks, steals, and turnovers stay one-tap standalone facts.
- Offer an optional Steal + Turnover action that atomically records and links both facts with the
  correct opposite-side player, unknown, or team turnover actor.

### 6.2 Score controls

- Quick scoreboard `+1/-1` appends `basketball.score_adjustment` with reason
  `scoreboard_control` and no modal.
- A separate Official Correction sheet accepts a signed delta and requires a note.
- Reject adjustments whose final projected side score would be negative.
- Made-shot points plus signed adjustments remain the sole score authority.

### 6.3 Decrements

- Standalone assist, rebound, steal, block, and turnover decrements tombstone the newest active
  match in the current period. Quick grid correction never crosses a lifecycle boundary;
  earlier-period editing belongs to BKE-3.
- Minutes `-1` appends a negative adjustment only when projected minutes are at least one.
- Field-goal decrement atomically tombstones the shot and linked assists/rebounds while unlinking
  active blocks. Confirm exact effects.
- Free-throw decrement atomically tombstones the attempt and linked rebound. Its trip survives.
- Disable decrement when no matching event exists; never produce a negative total.
- Successful decrements use the same one-level inverse receipt contract as BKE-1C corrections.

### 6.4 Verification

- Replay every ordinary grid action through legacy/event paths and compare approved totals and shots.
- Assert the intentional score-adjustment improvement after later made shots.
- Confirm unlocated field goals affect ordinals/totals but not markers; free throws have no field-goal
  ordinal.
- Cover tracked, rostered opponent, unknown opponent, and team attribution.
- Cover every decrement at zero, with dependents, and through immediate restore.

### 6.5 Implemented behavior

- `src/lib/basketball/directCommands.ts` owns checked direct shots, related stats, player/team
  turnovers, signed minutes, quick/official score adjustments, and atomic Steal + Turnover capture.
  All commands reject cloud-bound or inactive-period event games and return the original state on
  failure.
- Game Tracker restores the familiar player grid for supported event actions and exposes only team
  turnover on team chips. Made and missed shots have independent correction controls; fouls,
  technicals, and timeouts stay hidden until BKE-2C.
- Scoreboard `+1/-1` creates explicit `scoreboard_control` events. Official Correction requires a
  signed whole-number delta and note, preserves its draft on rejection, and cannot make a side
  negative.
- Standalone decrements target the newest matching current-period event. Field goals remove linked
  assists and rebounds while preserving and unlinking blocks; free throws remove linked rebounds.
  Exact consequences require confirmation and use the reload-safe one-level inverse receipt.
- The optional Steal + Turnover sheet records one atomic capture command and supports a rostered
  opposite-side player, an explicit unknown player label, or the opposite team actor.

## 7. BKE-2C: Fouls, Free Throws, Ejections, and Timeouts

### 7.0 Delivery slices

| Slice | Scope | UI exposure |
|---|---|---|
| BKE-2C1 | **Implemented.** Checked foul/free-throw-trip/attempt commands, one-and-one enforcement, dependency-aware foul/trip corrections, inverse receipts, and domain tests | None; establishes the complete foul/free-throw transition and correction contract |
| BKE-2C2 | **Implemented.** Foul sheet, progressive counting overrides, awarded-trip/attempt workspace, player/team grid actions, and correction confirmations | Exposes fouls and structured free throws only after C1 is complete |
| BKE-2C3 | Checked player/staff ejection capture/correction plus focused tracker UI and unavailable-participant enforcement | Exposes official ejections without coupling them to threshold disqualification |
| BKE-2C4 | Checked charged/neutral timeout capture/correction, inventory UI, integration fixtures, and BKE-2C exit audit | Completes administration capture and hands the tracker to BKE-2D |

Each slice uses its own branch and PR. C1 may extend the shared reload-safe inverse receipt, but no
C1 control is exposed. Later slices must reuse these commands rather than constructing events in
React.

### 7.1 Foul sheet

- Prefill the selected side/player and default to Personal + Common.
- Allow class, context, offender, optional drawn-by, and context-appropriate team-control side.
- Use rule-derived personal/team/technical counts by default. Put reason-required counting overrides
  under Advanced.
- A team-level Foul action uses a team actor for unknown/bench attribution. Player/staff fouls derive
  team totals; there is no second editable team-foul counter.

### 7.2 Free-throw trips and attempts

- The foul sheet may start a linked trip. Append foul and trip atomically, then record each attempt as
  it occurs.
- Support one, two, or three maximum attempts; one-and-one is a maximum two-attempt trip.
- Validate one-and-one against the immutable rules and the post-foul one-and-one bonus window; the
  awarding foul must count as a nontechnical team foul, and technical-trip context must match the
  foul's derived or overridden technical count.
- A first-attempt one-and-one miss closes live capture without fabricating a second attempt.
- A removed first one-and-one attempt remains a consumed historical position; attempt 2 requires
  attempt 1 to remain active and made.
- Technical and possession-retained flags belong to the trip. Attempts remain linked shot events.
- Empty/partial trips remain reviewable and do not invent points or attempts.

### 7.3 Ejections and availability

- Threshold disqualification remains derived; do not append an automatic ejection at the limit.
- Provide an Official Ejection sheet for player/staff with required reason and optional foul link.
- Staff use labeled staff actors and are never fabricated as players.
- Disqualified/ejected players remain visible with history but unavailable for new player stats.

### 7.4 Timeouts

- Use a sheet for side and charged class. Enforce immutable regulation/overtime inventory.
- Offer neutral Official/Media timeouts without a team actor or inventory consumption.
- Display snapshot labels while preserving stable catalog kinds.

### 7.5 Administrative corrections

- Foul decrement removes the newest match and atomically clears source links from surviving trips and
  ejections. Confirmation names personal, team, bonus/disqualification, and unlink effects.
- If removing the foul clears disqualification, a related automatic-threshold ejection is removed
  with it; explicit official ejections remain authoritative and survive with their stale link cleared.
- Team foul/technical decrement resolves the newest qualifying current-period foul.
- Charged timeout decrement resolves the newest matching current-period timeout.
- Removing a trip clears surviving attempt links; removing an attempt leaves trip positions intact.
- Consequential corrections use one final-state-validated batch and one inverse receipt.

### 7.6 Verification

- Cover every foul class/context, actor kind, counting rule, control side, and drawn-by actor.
- Verify linked foul/trip creation is atomic and failures preserve the sheet.
- Cover one-, two-, three-attempt and one-and-one sequences, sparse positions, empty trips, and reload.
- Prove threshold disqualification and explicit player/staff ejection remain distinct.
- Exhaust charged timeout inventories and confirm neutral timeouts do not consume them.
- Exercise every dependency-aware administrative decrement and restore.

## 8. BKE-2D: Complete Tracker and Exit Audit

### 8.1 Team and period presentation

- Tracked/opponent team chips show only valid team actions/totals, never player-only controls.
- Bonus/double-bonus indicators are read-only projections from current-period fouls and rules.
- Show timeout inventory/use, period label, completion, and unavailable participants from projection.
- Keep side/participant identity visible on focused sheets where wrong-side capture is costly.

### 8.2 Live surface completion

- Remove BKE-1 event-mode hides only after each replacement control is checked and event-backed.
- Add explicit local Suspend and Abandon actions plus reasoned local Reopen so every terminal reason
  already modeled by the Basketball projector is reachable before cloud cutover. BKE-4C still owns
  recorder-aware finalization, canonical publication, and reopen after cloud finalization.
- Keep court/grid additive: court shots carry location; direct shots do not.
- Preserve compact repeated-use controls and use focused sheets for structured actions.
- Keep capture/lifecycle/correction errors near the initiating control.

### 8.3 Exit verification

- Extend reducer-equivalence fixtures across every legacy action and approved intentional difference.
- Test mixed court/grid games, actor variants, periods/overtime, completion, suspension,
  abandonment, local reopen, links, corrections, restore invalidation, parking, import, and hydration.
- Verify no healthy event game dispatches legacy stat, score, period, or roster mutations.
- Verify all unmarked Basketball behavior and Soccer behavior remain unchanged.
- Update operational docs and regression coverage with shipped ownership and the BKE-3 boundary.
- Pass focused tests, the full suite, lint, and production build.

## 9. Approved Decisions

1. Deliver four slices: 2A lifecycle/participants, 2B direct stats/score/minutes, 2C
   discipline/administration, and 2D complete tracker parity.
2. Preserve the familiar stat grid with checked event internals.
3. Keep standalone decrements immediate and confirm multi-event consequences.
4. Record direct shots as unlocated events; only court taps carry coordinates.
5. Advance periods sequentially through explicit end/start controls.
6. Add overtime one stable segment at a time and keep End Game separate.
7. Add tracked/opponent late participants through a focused event sheet.
8. Keep disqualified/ejected participants visible but unavailable for new player stats.
9. Use quick score adjustments and a reason-required official correction.
10. Reject adjustments that make projected score negative.
11. Keep direct related stats standalone by default.
12. Add an optional atomic Steal + Turnover flow.
13. Use a focused foul sheet with ordinary defaults and progressive disclosure.
14. Keep exceptional foul counting reason-required under Advanced.
15. Append linked foul/trip atomically, then record attempts as they occur.
16. End one-and-one after a first miss without a placeholder.
17. Keep threshold disqualification derived and official ejections separate.
18. Support team/staff technical actors without fabricating players.
19. Enforce charged timeout inventory and preserve neutral timeouts.
20. Keep manual minutes as signed one-minute adjustments until BKE-6.
21. Team chips expose only valid team actions and totals.
22. Team turnovers use team actors; player turnovers remain individual.
23. Derive team fouls from structured events and use team actors for unknown/bench fouls.
24. Derive bonus state from foul history and immutable rules.
25. Complete/cancel open UI drafts before period transition; persisted partial trips survive.
26. Basketball v1 requires a winner: end games explicitly only with a non-tied score and offer
    overtime after tied regulation or overtime.
27. Confirm and atomically apply corrections with linked/derived consequences.
28. Treat lifecycle transitions as visible non-undoable Recent Events boundaries.
29. Prefer rostered opponents, use Unknown Opponent for unrostered individual facts, and reserve team
    actors for team facts.
30. Persist and visibly identify one capture target across live flows.
31. Keep rejected sheets open with inline errors and unchanged state.
32. Expose no slice UI before its checked command and correction path exist.

No product decisions remain open for BKE-2 implementation.
