# THM-4 Scoreboard and Recent-event Verification

## Scope

Scoreboard, RecentEventsPopup, BasketballRecentEventsPopup, PeriodToggle, and
BasketballBonusIndicator use semantic colors. Shared components also affect
their other sport consumers. The scoreboard replaces its sport gradient with
a neutral surface; team branding is a separate feature. PeriodToggle retains
its sportTheme prop contract but uses application accent for selection.

Long team/tournament names and cloud-repair warnings wrap. Both recent-event
dialogs have viewport-bounded height, a scrolling body, and fixed close controls.
Undo, Timeline, Restore, boundary, warning, error, and disabled states retain
their existing meaning. No callbacks, eligibility, score calculations, event
ordering, cloud transport, or persistence changed. No migration.

## Evidence

- Appearance inventory includes all five components. Targeted guards cover both
  score labels, score-control disabled colors, repair warning colors/wrapping,
  recent-event dialog height/scrolling/close dimensions, disabled action colors,
  and the event error paragraph's wrapping/status colors.
- Actual-component Edge fixtures: 32 cases at 390px/1280px widths, 640px height,
  and Light/Dark. Legacy, event, disabled, and read-only scoreboards; eight-period
  selection; approaching bonus, 1-and-1, double bonus; legacy populated/empty
  recent events; event capture and lifecycle-boundary lists with restore/error.
- Browser assertions checked legacy increment dispatch, event increment/official
  correction callbacks, zero-score decrement and all-disabled states, period and
  overtime callbacks, legacy older-action disabling, event boundary disabling,
  dialog bounds, no document horizontal overflow, and no page errors. Undo,
  Timeline, Restore, and Escape callbacks were exercised. Long unbroken labels,
  warnings/errors and eight-entry lists were included. Mobile Dark scoreboard
  and recent-event screenshots were inspected.
- GameContext was mocked and action callbacks were spies. No reducer state was
  mutated, no real game was created, and no cloud writes occurred. Temporary
  fixtures and screenshots were removed. Full suite/build/lint results are in PR.

## Release Follow-up

Validate the real tracker composition, actual score/period state updates,
consequence-aware Undo/Restore/Timeline transitions, sport variants, keyboard
traversal, and PWA/offline behavior. Remaining player/stat controls, court,
Tracker host, Timeline, and Summary are outside this batch. These fixture checks
do not complete THM-4 or the THM-6 production Dark release audit.
