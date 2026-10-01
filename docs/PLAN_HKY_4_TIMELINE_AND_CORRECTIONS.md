# Plan: HKY-4 Timeline and Corrections

Execution plan for the fourth hockey phase defined in
[HKY-0](PLAN_HKY_0_HOCKEY_PRODUCT_MODEL.md) §12. It builds on HKY-1 (rules, setup,
lifecycle and clock), [HKY-2](PLAN_HKY_2_RINK_AND_CORE_CAPTURE.md) (rink, shots, goalies,
faceoffs, plays, Recent Events Undo) and
[HKY-3](PLAN_HKY_3_PENALTIES_STRENGTH_AND_OUTCOMES.md) (penalties, strength, timeouts,
icing and offside, shootout, result).

Status: approved (plan PR #453 merged 2026-09-30) with the §7 recommendations. HKY-4A
implemented; HKY-4B and HKY-4C follow in their own PRs. §8 is the delivery record.

---

## 1. Goal

HKY-4 exits when every event of a local hockey event game can be reviewed and corrected:

- a Timeline tab next to Track that lists the whole game oldest-first by period, with
  family, side, period and player filters, and shows removed, edited and recorded-later
  events,
- edit, remove and restore for every recorded family, including goal scorer, assists,
  strength and on-ice set, penalty details, goalie changes and shootout attempts,
- recorded-later additions: a goal, shot, penalty, faceoff, play, goalie change,
  timeout, icing or offside that was missed live can be added at its period and clock
  time,
- time corrections for the same families,
- corrections that respect what depends on them: a penalty's early release, the
  shootout's attempts, the goalie stamped on later shots, and the stored strength of
  later goals,
- a history that always replays cleanly: a correction that would break replay is
  refused with the reason, and nothing is saved.

Quick Undo and Restore in Recent Events stay as they are (HKY-2C).

Not in HKY-4: cloud sync and finalization locks (HKY-5), the Summary Timeline and maps
(HKY-6A), editing the setup or opening lineup (§2 HKY-4C covers the starting goalie
another way), line changes and skater time on ice (module HKY-M3).

---

## 2. Slices

### HKY-4A Timeline review

A read-only Timeline, so the recorder can see the whole game before anything becomes
editable.

- `src/lib/hockey/timeline.ts` (pure) derives rows from the full stream, active and
  removed, and never from the cached projection:
  - one row per capture unit (the events that share a `captureCommandId`, as in Recent
    Events), plus lifecycle and clock rows for context,
  - grouped by period, oldest first, in game order (§2 HKY-4C). Until HKY-4C lands, game
    order equals capture order,
  - each row: period, clock time (anchored games only), side, label (the existing
    `hockeyEventLabel`), strength for goals, and badges for Removed, Revised and
    Recorded later. The shared engine appends events at revision 1, so Revised means
    `revision > 1` (the Basketball baseline). It covers any change after capture:
    an edit, a removal or a restore, which revision alone cannot tell apart. A
    freshly captured event shows no badge,
  - families, matching HKY-0 §9: Goals, Shots, Faceoffs, Physical (hits, takeaways,
    giveaways), Penalties (penalties and early releases), Goalies, Team (timeouts,
    icing, offside, score adjustments), Shootout, and Game flow (lifecycle and clock),
  - filters: families (several at once), side, period, and one tracked player (any
    role on the event),
  - removed rows are hidden by default behind a "Show removed" toggle,
  - replay diagnostics: when a stored history fails to replay, the failing row is
    marked with the replay message. Today the tracker only says the history needs
    repair; the Timeline shows where.
- `HockeyTimeline` component and a Track / Timeline tab switch in `HockeyGameTracker`.
  The scoreboard stays on top, so the clock keeps running while the recorder reviews.
- Tapping a row opens a read-only detail sheet: every field of the event, its actors,
  the stamped goalie, the on-ice set, revision and recorded time.

### HKY-4B Edit, remove and restore

Corrections to events that are already in the right period and time.

- Every correction is one atomic batch of `update`, `delete` and `restore` mutations
  through `applyGameEventMutations`, followed by a full replay (`replayHockeyEvents`).
  If the replay fails, nothing is saved and the dialog shows the replay's message, as
  live capture does today.
- A correction clears the Restore receipt of quick Undo (the Basketball rule).
- Edit reuses the capture dialogs in an edit mode (shot, penalty, play, faceoff, goalie,
  shootout panel row), prefilled from the event. Editable fields:

| Family | Editable in HKY-4B |
|---|---|
| Shot / goal | Outcome, miss type, shooter, assists, blocker, goalie faced, empty net, penalty shot, strength, on-ice set, location, side (§7 Q3) |
| Faceoff | Winner, tracked taker, opponent taker label |
| Hit / takeaway / giveaway | Hitter and player hit, or the player; location; side (§7 Q3) |
| Penalty | Offender or bench/staff, server, infraction, class, length, coincidence; a coincidence group is edited together |
| Penalty release | Removed or restored only |
| Goalie change | Goalie in net, reason, a new opponent goalie's label and number |
| Timeout, icing, offside | Side, kind |
| Score adjustment | Side, delta, reason |
| Shootout start | First side |
| Shootout attempt | Shooter, outcome |
| Lifecycle and clock | Read-only; the clock is corrected with the existing Set clock |

- Remove and restore work on whole capture units, like Undo. Dependents follow their
  source in the same batch:
  - removing a penalty removes its early releases, and restoring the penalty offers to
    restore them,
  - removing the shootout start removes its attempts, and restoring the start restores
    them,
  - removing one penalty of a coincidence group removes the group.
- Before saving, a consequence preview lists what changes. Nothing listed here is
  changed silently:
  - score and the result, when the game has ended,
  - goals whose stored strength no longer matches the derived strength. Stored strength
    still wins (HKY-0 §6); the preview links each goal so the recorder can edit it,
  - shots whose stamped goalie no longer matches the goalie in net. The preview offers
    "Update the goalie on these shots" as part of the same batch (§7 Q4),
  - players who become removed from the game, or no longer are, after a penalty change,
  - a sudden-death overtime lead appearing or disappearing.
- Corrections are allowed while the game is in progress and after it has ended (§7 Q2).
  After the end, the result re-settles in the same replay. Suspended and abandoned
  games are corrected after Reopen, which the tracker already offers.

### HKY-4C Game order, time corrections and recorded-later additions

Events that belong earlier in the game than when they were recorded.

- **Game-order replay.** Replay today follows capture order. HKY-4C keeps live captures
  in capture order and places each recorded-later or re-timed event at its game time:
  - anchored games: scan the period's live events in capture order and insert before
    the first one whose clock time is strictly later; if none is, insert before the
    period's end. Live events at the same clock time that come earlier in that scan stay
    before the addition, so an addition at 0:00 still goes after shots already captured
    at 0:00 while the opening clock was paused. With a clock set backwards, the first
    strictly later event wins even if earlier-time events follow it: live shots at 10,
    20, then a clock set to 5 and a shot at 6 put an addition at 15 before the 20 shot.
    Placed events at the same insertion point are ordered by clock time, then capture
    order. Timeline and replay use this same rule,
  - clockless games: at the end of its period, just before the period ends (§7 Q1),
  - period start (goalie changes only, see Starting goalie below): right after the
    period's start boundary (the opening lineup and period start for Period 1, the
    period start otherwise) and before every other event of that period. Several
    period-start events keep their capture order,
  - live captures are already checked in game order, so a stream with no placed events
    replays exactly as before. Literal pre-HKY-4 fixtures prove it.
  With placed events in game order, everything the projector derives in order stays
  right without special cases: goalie in net, players removed by a penalty, the penalty
  box and strength, power-play opportunities, goal order for the goalie of record,
  sudden death, and the result.
- **Payload fields.** Placeable payloads gain optional fields, stored with the event so
  replay places it the same way after a reload:
  - `placement: 'game_time' | 'period_start'` says how replay places the event. Without
    it, the event is a live capture and keeps its capture order,
  - `recordedLater: true` marks an added event, and `retimed: true` marks a live event
    whose period or time was corrected. Both drive the Timeline badges, and either one
    requires `placement`,
  - `period_start` is accepted only on goalie changes. It means elapsed zero on
    anchored games, whatever the count-down or count-up display, and null elapsed on
    clockless games.
  A placed event's clock time is checked against its period's bounds (from zero to the
  period's end, or to the current clock for the running period), not against the live
  clock at its recorded moment. Old payloads without these fields stay valid.
- **Timeouts are statistical when placed.** A live timeout keeps today's behavior:
  capture pauses a running clock first, and replay rejects a live timeout while the
  clock runs. A placed timeout (added or re-timed) only counts the timeout. It pauses
  nothing, and replay skips the stopped-clock check for it, so clock anchors and every
  later clock check stay as they were. Re-timing a live timeout leaves its original
  clock pause where it is: that pause is a clock row, and clock rows stay read-only.
- **Families that can be placed:** shots and goals, faceoffs, hits, takeaways,
  giveaways, penalties, goalie changes, timeouts, icing and offside. Penalty releases,
  score adjustments, the shootout and lifecycle events cannot be placed: releases
  follow their penalty, score adjustments have no game time, the shootout has no clock,
  and lifecycle is the frame the others are placed in.
- **Add.** An Add button on the Timeline opens the family's capture dialog with a time
  field: a started period and, on anchored games, a clock time in the rules' display
  (count down or up). The command builds the event from the game state at that time: the
  goalie in net, the prefilled strength and the on-ice limits. A goal's location and
  on-ice set work as in live capture.
- **Re-time.** The edit dialog of a placeable family gains the same time field. Moving
  an event to another period or time sets `retimed`.
- **Starting goalie.** The setup and opening lineup stay immutable. A wrong starting
  goalie is fixed by adding a goalie change with "At the start of the period" ticked.
  It is stored with `placement: 'period_start'`, so it replays before any shot of the
  period, including shots captured at 0:00 and every shot of a clockless period. The
  same option fixes the goalie who started a later period. The preview then offers to
  update the goalie on the shots that follow.
- **Quick Undo** is unchanged. It still removes the newest capture unit by capture
  order, so an addition just made can be undone from Recent Events.

---

## 3. Data and compatibility rules

- No migration and no cloud route; event hockey stays local-only.
- No setup or rules change. The opening lineup and setup stay immutable.
- No new event types. Optional payload fields (`placement`, `recordedLater`,
  `retimed`) are added to the placeable families; payloads without them are unchanged
  and still valid.
- Revisions use the shared engine: `update` raises `revision`, and `delete` and `restore`
  keep the event in the stream. Prior values are not kept (the Basketball engine rule).
- HKY-1 to HKY-3 games load and replay unchanged, with the same fingerprint. Literal
  pre-HKY-4 fixtures prove it for capture order and game order.
- Every accepted correction round-trips through `HYDRATE_STATE`.
- The Restore receipt stays outside fingerprints (HKY-2C).
- Legacy hockey stat-grid games, Soccer, Basketball, Baseball and Football are
  untouched.

---

## 4. Cross-sport items touched

No XS item is extracted. The Soccer and Basketball Timelines are sport-specific, and the
hockey one follows them.

Game-order placement of recorded-later events is a candidate for a shared helper once a
second sport needs it (Baseball and Football both replay in capture order today). It
stays in `src/lib/hockey/` until then, and HKY-0 §13 gains a note (XS-12) only if the
owner wants it tracked.

---

## 5. Regression

`docs/REGRESSION_HKY_4_TIMELINE_AND_CORRECTIONS.md` when implementation lands:

- Timeline rows for every family, in period order, with filters by family, side, period
  and player, the Removed / Revised / Recorded later badges (a fresh capture showing
  none), and a failing history marked on its row,
- edit of each family in the §2 HKY-4B table, each round-tripping through
  `HYDRATE_STATE`,
- remove and restore of a capture unit, a coincidence group, a penalty with an early
  release, and the shootout start with its attempts,
- a correction refused because replay fails (a goal making a lead before a later
  sudden-death event, an on-ice set over the limit), with nothing saved,
- the preview: score and result change, stored strength differing, stamped goalie
  differing and updated on request, a player removed and no longer removed,
- corrections after the game ended re-settling the result and goalie of record,
- anchored game: a goal added in Period 1 while Period 3 runs, placed correctly; a
  penalty added in Period 2 changing the box and strength after it; an addition at 0:00
  going after shots already captured at 0:00; a backward clock set (shots at 10 and
  20, clock set to 5, shot at 6) placing an addition at 15 before the 20 shot, with the
  Timeline showing it in the same position,
- starting goalie: a period-start goalie change in Period 1 supplying the goalie for
  every later shot, including shots captured at 0:00 (anchored) and all Period 1 shots
  (clockless), after reload and `HYDRATE_STATE`,
- clockless game: an ordinary addition placed at the end of its period,
- timeouts: a timeout added inside an interval where the clock ran, and a live timeout
  re-timed away from its pause, both leaving the clock, later clock checks and the
  current clock state unchanged after replay and hydration; a live timeout still
  pausing a running clock,
- re-timing a live event to another period and back,
- quick Undo removing a just-added event, and Restore after it,
- HKY-1 to HKY-3 fixtures replaying unchanged; park and resume with Soccer and Basketball
  games,
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and a phone-sized browser
  check of the Timeline tab.

---

## 6. Risks

- **Game-order placement** changes what replay sees for placed events. The fixtures in
  §5 and the rule that live captures keep capture order limit the change to events that
  carry the new flags.
- **A clock set backwards** mid-period makes clock times non-monotonic. Placement uses
  the first strictly later live event in capture order (§2 HKY-4C), which is
  deterministic but may place an addition before a clock correction. The Timeline shows the placed row, and the recorder can re-time it.
- **Refused corrections** can frustrate: a goal that cannot be added because a later
  event contradicts it. The refusal names the conflicting event so it can be corrected
  first.
- **Screen space:** the Timeline shares the tracker with the rink. Filters stay collapsed
  behind a one-line summary (Soccer S3/S11 lesson).

---

## 7. Owner Questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | Clockless games have no clock time. Where does an added event go? | At the end of its period. Picking "after this row" is more precise but adds a step to every addition |
| Q2 | Can an ended game be corrected directly, without Reopen? | Yes for local games: the result re-settles on replay. HKY-5 adds the lock for finalized cloud games |
| Q3 | Can a shot, goal or play be moved to the other side by an edit? | Yes. Actors that do not belong to the new side are cleared and must be picked again |
| Q4 | When a goalie correction changes who was in net, update the goalie stamped on later shots? | Offer it in the preview, checked by default, in the same save. Unticked, the shots keep their stamp and the existing mismatch warning shows |
| Q5 | A wrong starting goalie: fix it with a goalie change added at the start of Period 1, keeping the setup immutable? | Yes |
| Q6 | Slices: HKY-4A review, HKY-4B edit/remove/restore, HKY-4C game order and additions, each its own PR? | Yes |

---

## 8. Delivery Record

### HKY-4A Timeline review (implemented)

- `src/lib/hockey/timeline.ts`: `hockeyTimeline(state, sideLabels)` builds rows from the
  inspected stream (active and removed events), grouped into capture units with the
  exported `groupHockeyCaptureUnits` from `recentEvents.ts`. A unit whose events differ in
  removal splits into an active and a removed row. Rows are stable-sorted by period
  order, capture order within a period. Clock time uses the projection's period
  durations, so count-down rules show the time left; a period missing from a replay that
  stopped early takes its length from the frozen rules, and an unresolvable count-down time
  shows no clock. The first replay diagnostic marks
  the row holding its event; a diagnostic without a row, or unreadable stored events,
  becomes the Timeline's history message. Helpers: `filterHockeyTimelineRows`,
  `groupHockeyTimelineByPeriod`, `hockeyTimelinePeriods`,
  `activeHockeyTimelineFilterCount`.
- `HockeyTimeline` component: collapsed filters (family chips, side, period, tracked
  player, Show removed, Clear) with a one-line summary, period groups, badges (PP, SH,
  Removed, Revised, Recorded later) and a "Stops the replay" line on the failing row.
  Tapping a row opens a read-only detail sheet built from the pure
  `hockeyTimelineEventFields` (`timelineDetail.ts`): actors and every recorded payload
  field, with participant and opponent goalie ids named through `hockeyTimelineNames`
  (setup plus every goalie change in the stream, removed ones included), on-ice set,
  recorded time, revision and removal time. A value it does not recognize is shown as
  stored, never dropped. `hockeyParticipantLabel` no longer repeats the number of a
  number-only player.
- `HockeyGameTracker`: a Track / Timeline tab switch below the sticky scoreboard. Timeline
  replaces the rink, quick row and Recent Events; the clock and scoreboard stay.
- No event, schema, fingerprint or migration change.
- Record: `docs/REGRESSION_HKY_4_TIMELINE_AND_CORRECTIONS.md`.
