# Regression: HKY-4 Timeline and Corrections

Record for [HKY-4](PLAN_HKY_4_TIMELINE_AND_CORRECTIONS.md). Each slice adds its section
when it lands.

## HKY-4A Timeline review

Automated (`src/lib/hockey/timeline.test.ts`, 6 cases):

| Case | Result |
|---|---|
| Rows for every family by period, oldest first; goal counts as goal and shot; coincidental pair is one two-sided row; lifecycle rows are Game flow; fresh captures carry no badge | Pass |
| Filters by family (several at once), side, period and tracked player; period grouping; active filter count | Pass |
| Undo hides the row by default, Show removed brings it back marked Removed and Revised; Restore keeps Revised | Pass |
| Anchored count-down rules show the time left (1:00 in a 15-minute period shows 14:00) | Pass |
| A stored history that stops replaying marks the failing row with the replay message | Pass |
| Rows unchanged after `HYDRATE_STATE` | Pass |

Checks: `pnpm typecheck`, `pnpm lint` (no errors), `pnpm test` (253 files, 2336 tests) and
`pnpm build` pass.

Browser (390 x 844, dev server, anchored youth game): goal, opponent save and an undone
goalie pull. The Timeline tab lists opening lineup, period and clock starts, the goal and
the save with count-down times; Show removed adds the pulled goalie struck through with a
Removed badge; the goal's detail sheet names the opponent goalie by label, shows Even
strength and "Not recorded" for the on-ice set. No console errors.

Screenshots: `/mnt/project-files/hockey/hky4a-timeline-filters-phone.png`,
`/mnt/project-files/hockey/hky4a-detail-phone.png`.
