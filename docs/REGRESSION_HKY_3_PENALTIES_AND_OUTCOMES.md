# Regression: HKY-3 Penalties, Strength and Outcomes

Record for [HKY-3](PLAN_HKY_3_PENALTIES_STRENGTH_AND_OUTCOMES.md). Each slice adds its
section when it lands.

## HKY-3A Penalties, penalty box and strength

Automated (`src/lib/hockey/penalties.test.ts`, 32 cases):

| Case | Result |
|---|---|
| Minor with PIM, penalty taken and drawn; team totals | Pass |
| Rules length, override, Other needs a label, penalty shot has no time | Pass |
| Server required for goalie, bench, staff and match; server differs from offender | Pass |
| Minor runs with the clock, stops while paused, expires | Pass |
| Clock correction moves the timer | Pass |
| Stacked minors: 5v3 with the third waiting, then starting when a slot frees | Pass |
| Never below minimum skaters | Pass |
| Double minor as two consecutive segments | Pass |
| Misconduct off the strength; major for its full length | Pass |
| Empty net adds the extra attacker (6v4) | Pass |
| Remaining time carries across a period end | Pass |
| Clockless: penalties and PIM, no timers, no strength, no release | Pass |
| Coincidental pair cancels under `substitute`, timers and PIM kept | Pass |
| `play_short` at full strength gives 4v4 | Pass |
| `play_short` with a side already short substitutes | Pass |
| Equal minors saved separately are unrelated (4v5 then 4v4) | Pass |
| Two-for-one group leaves one minor counting | Pass |
| One-sided group rejected by the command and by replay | Pass |
| Group id other than its capture id rejected by the registry | Pass |
| One Undo removes the unit; Restore brings it back | Pass |
| Group round-trips through `HYDRATE_STATE` with the same fingerprint | Pass |
| Minor served by a teammate, misconduct starting after it; missing server rejected | Pass |
| Releasing a double minor's waiting half keeps the misconduct waiting until the first half ends (hydration, Undo) | Pass |
| Removed goalie rejected in an on-ice set at capture and on replay | Pass |
| Game misconduct removes the player from shots, on-ice sets and penalties | Pass |
| Match penalty: five minutes served by a teammate, offender removed | Pass |
| Goalie in net cannot be removed until another goalie goes in | Pass |
| Early release: PIM unchanged, survives hydration, Undo lets it run again | Pass |
| Release of a double minor's second half | Pass |
| Release of an ended penalty rejected | Pass |
| Release made inert by a clock correction shows its note | Pass |

HKY-1 and HKY-2 fixtures and suites pass unchanged.

Browser (dev build, 390 x 844, touch):

- Start a game, start the clock, record a tracked minor: the box shows `4v5` with the
  time left and Release.
- Record a coincidental pair in one save: both rows show as coincidental, strength stays
  `4v5` from the earlier minor; Recent Events shows the pair as one undoable row.
- Release the first minor with a reason: strength returns to `5v5`.
- Reload: the box and timers come back.

Checks: `pnpm typecheck`, `pnpm lint` (0 errors), `pnpm test`, `pnpm build`.

## HKY-3B Goal strength, special teams, timeouts, icing and offside

Automated (`src/lib/hockey/specialTeams.test.ts`, 19 cases):

| Case | Result |
|---|---|
| Goal strength prefilled EV, PP and SH from the box | Pass |
| Pulled-goalie extra attacker reads as even strength | Pass |
| Recorder's choice stored and kept through a clock correction | Pass |
| Clockless games default to EV and store the recorder's choice | Pass |
| Strength on a non-goal rejected | Pass |
| PP goal ends the short-handed minor with the least time left | Pass |
| PP goal never releases a major | Pass |
| PP goal releases only the double-minor segment being served | Pass |
| No release when `releaseMinorOnPowerPlayGoal` is false | Pass |
| Undoing the PP goal brings the minor back | Pass |
| PP opportunities skip coincidental and four-on-four minors | Pass |
| PP and SH goals and assists credited | Pass |
| Plus/minus counts EV and SH goals with a complete on-ice set | Pass |
| Plus/minus counts empty-net goals, skips PP goals | Pass |
| Goals without a complete set or strength listed as skipped | Pass |
| Timeout pauses a running clock; counted per side | Pass |
| Stored timeout while the clock runs rejected on replay | Pass |
| Icing and offside counted per side with an optional location | Pass |
| Timeouts and team events round-trip through `HYDRATE_STATE` | Pass |

HKY-1, HKY-2 and HKY-3A suites pass unchanged.

Browser (dev build, 390 x 844, touch):

- Opponent minor: box `5v4`, scoreboard `PP 0/1` for the tracked side.
- Tracked goal: Power play chip preselected with "From the penalty box."; after saving,
  the opponent minor leaves the box and the scoreboard shows `PP 1/1`; Recent Events
  shows `Home goal (PP)`.
- Play dialog Timeout pauses the clock and the scoreboard shows `TO 1`; Icing against
  the opponent records and shows in Recent Events.
- Reload: scoreboard totals come back. No console errors.

Checks: `pnpm typecheck`, `pnpm lint` (0 errors), `pnpm test`, `pnpm build`.
