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

## HKY-4C Game order, re-time and recorded-later additions

Automated (`src/lib/hockey/placement.test.ts`, 11 cases; `placementForm.test.ts`, 4 cases):

| Case | Result |
|---|---|
| Literal pre-HKY-4 fixtures keep capture order and replay, Timeline and fingerprint are unchanged after reload | Pass |
| A Period 1 goal added while Period 3 runs sits at its game time, changes the score and period totals, Undo/Restore work, survives `HYDRATE_STATE` | Pass |
| An addition at 0:00 goes after shots captured at 0:00 and before the first later shot | Pass |
| After a backward clock set the first strictly later live event wins | Pass |
| A penalty added in Period 2 changes the box after it while stored goal strength stays | Pass |
| A period-start goalie change replays before every shot of the period (anchored and clockless) and restamps them with "Update the goalie" | Pass |
| Clockless additions go at the end of their period, or after the last event of the running one; a clock time is refused | Pass |
| Refused: a time not yet played, an unstarted period, a score adjustment, a period-start shot | Pass |
| A placed timeout counts without touching the clock; re-timing a live timeout leaves its pause | Pass |
| A live shot re-timed to Period 2 and back moves the period totals and shows Re-timed | Pass |
| Placement fields are accepted only on placeable families with a reason to be placed | Pass |
| Form helpers: played time per period, clock text parsing, count-down conversion, faceoff dot names | Pass |

Checks: `pnpm typecheck`, `pnpm lint` (no errors), `pnpm test` (257 files, 2413 tests) and
`pnpm build` pass.

Browser (390 x 844, dev server, anchored youth game with goalies #35 Ray in net and #31 Gil
on the bench): clock started, Wolves saved shot at 14:57. "Add a missed event", Shot,
Period 1, 14:59, Goal previews "Home 0-0 Wolves becomes 1-0" and saves; the goal sits above
the Wolves shot with Recorded later. Change time to 10:00 is refused ("That time has not been
played yet in this period", with the played limit shown); 15:00 saves and the row shows
Revised. Adding a Goalie change with "At the start of the period" to #31 previews "Wolves
saved: #35 Ray, in net #31 Gil" and saves; the change sits right after period started.
Reload keeps the same order. No console errors.

Screenshots: `/mnt/project-files/hockey/hky4c-add-when-phone.png`,
`/mnt/project-files/hockey/hky4c-add-preview-phone.png`,
`/mnt/project-files/hockey/hky4c-timeline-phone.png`,
`/mnt/project-files/hockey/hky4c-change-time-phone.png`,
`/mnt/project-files/hockey/hky4c-goalie-start-phone.png`,
`/mnt/project-files/hockey/hky4c-goalie-preview-phone.png`.

