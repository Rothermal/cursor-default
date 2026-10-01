# Regression: HKY-4 Timeline and Corrections

Record for [HKY-4](PLAN_HKY_4_TIMELINE_AND_CORRECTIONS.md). Each slice adds its section
when it lands.

## HKY-4A Timeline review

Automated (`src/lib/hockey/timeline.test.ts`, 8 cases):

| Case | Result |
|---|---|
| Rows for every family by period, oldest first; goal counts as goal and shot; coincidental pair is one two-sided row; lifecycle rows are Game flow; fresh captures carry no badge | Pass |
| Filters by family (several at once), side, period and tracked player; period grouping; active filter count | Pass |
| Undo hides the row by default, Show removed brings it back marked Removed and Revised; Restore keeps Revised | Pass |
| Anchored count-down rules show the time left (1:00 in a 15-minute period shows 14:00) | Pass |
| A stored history that stops replaying marks the failing row with the replay message | Pass |
| Anchored count-down rows after a replay failure keep the time left from the frozen rules (review fix) | Pass |
| Detail fields: opening-lineup goalie, all skaters and opponent goalie by name; a later opponent goalie keeps its label after Undo; goal actors and strength (review fix) | Pass |
| Rows unchanged after `HYDRATE_STATE` | Pass |

Checks: `pnpm typecheck`, `pnpm lint` (no errors), `pnpm test` (253 files, 2338 tests) and
`pnpm build` pass.

Browser (390 x 844, dev server, anchored youth game): goal, opponent save and an undone
goalie pull. The Timeline tab lists opening lineup, period and clock starts, the goal and
the save with count-down times; Show removed adds the pulled goalie struck through with a
Removed badge; the goal's detail sheet names the opponent goalie by label, shows Even
strength and "Not recorded" for the on-ice set. After the review fixes, the opening
lineup's detail lists the goalie and all five skaters by name (number-only players read
"#7", not "#7 #7") and the opponent goalie. No console errors.

Screenshots: `/mnt/project-files/hockey/hky4a-timeline-filters-phone.png`,
`/mnt/project-files/hockey/hky4a-detail-phone.png`,
`/mnt/project-files/hockey/hky4a-lineup-detail-phone.png`.

## HKY-4B Edit, remove and restore

Automated (`src/lib/hockey/corrections.test.ts`, 17 cases):

| Case | Result |
|---|---|
| Prefill round trip for every editable family is "Nothing changed"; lifecycle rows are read-only | Pass |
| Shot edited to a goal keeps id, time and sequence, bumps the revision, stamps the goalie, previews the score; survives `HYDRATE_STATE` | Pass |
| An on-ice set over the limit is refused and nothing changes | Pass |
| A correction clears the quick-Undo Restore receipt | Pass |
| Hit side swap | Pass |
| Penalty with an early release: remove takes the release; restore with and without it | Pass |
| Coincidence group removed and edited together; adding a penalty in an edit is refused; lifecycle removal refused | Pass |
| Shootout start removal takes its attempts and restore brings them back; attempt edit | Pass |
| Removing a goalie change lists goalie mismatches and restamping fixes them | Pass |
| Strength mismatch and a newly removed player (game misconduct) in the preview | Pass |
| Ended game: side swap re-settles the result | Pass |
| Sudden death decided and undecided; refused when a later event exists | Pass |
| Suspended games are refused | Pass |
| Removing a goalie change with "Update the goalie" restamps its shots in the same batch (review fix) | Pass |
| Removing an introduced opponent goalie: refused without the restamp ("not known to this game"), saved with it; the recorder's deliberate stamp stays; restore offers the reverse; hydration round trip (review fix) | Pass |
| Editing an introduced opponent goalie to Empty net drops the introduction (`hockeyGoalieChangeCorrection`), keeps edited label and number while still selected, and with a later shot saves only with the restamp to an empty net (review fix) | Pass |

Checks after the review fixes: `pnpm typecheck`, `pnpm lint` (no errors), `pnpm test` (255 files,
2398 tests) and `pnpm build` pass.

Browser (390 x 844, dev server, clockless game with two goalies): goalie change to #35,
opponent save, home goal. Editing the goal to Saved previews "Home 1-0 Wolves becomes 0-0"
and saves. Removing the goalie change previews "Wolves saved: #35 Ray, in net #31 Gil" with
"Update the goalie on these shots" ticked; after Remove the shot shows Revised. Restoring
it previews the reverse mismatch. No console errors.

Screenshots: `/mnt/project-files/hockey/hky4b-edit-shot-phone.png`,
`/mnt/project-files/hockey/hky4b-preview-score-phone.png`,
`/mnt/project-files/hockey/hky4b-preview-goalie-phone.png`.

Review fixes (browser, same setup): add opponent goalie #1 Backup, record a home saved shot.
Editing the change to Empty net previews "Home saved: #1 Backup, net empty" with the update
ticked and locked ("Needed: these shots name a goalie this change takes out of the game").
Removing the change previews the shot moving back to the starting opponent goalie; Remove
saves, and the shot shows Revised. Screenshot:
`/mnt/project-files/hockey/hky4b-remove-opponent-goalie-phone.png`.
