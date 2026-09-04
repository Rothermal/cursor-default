# Soccer S25 Actor Selection Regression

Use a Soccer event game with tracked on-field players in each broad role. For
tie-break coverage, include jersey numbers `2` and `10`, two players with the
same number, one player without a number, and a player whose role changes during
the match.

## Automated checks

```powershell
pnpm.cmd test
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd build
```

## Mobile field layout

1. Open the live Soccer Field tab on a phone-width viewport.
2. Confirm Tracked/Opponent and Shot/Defense/Foul remain available.
3. Confirm there is no Team/player chip row or empty reserved gap above the
   pitch.
4. Confirm the pitch, quick capture, substitution, and overflow controls remain
   usable.

## Live actor selection

1. Tap the pitch in Shot mode and inspect every tracked-player selector.
2. Repeat for Defense, Foul, Card, and Offside actor capture.
3. Confirm roles appear Forward, Midfielder, Defender, Goalkeeper, Custom.
4. Within a role, confirm jersey `2` precedes `10`, numbered players precede
   players without a number, then display name and stable identity break ties.
5. Select a non-default player, save or cancel, and open a different event.
6. Confirm the prior draft's actor is not inherited. Team, Unknown, and Staff
   choices remain available where that event supports them.

## Historical correction

1. Record a role change for one player, then record events before and after it.
2. Open each event from Timeline and from a field marker where available.
3. Confirm the existing actor remains selected.
4. Confirm the dropdown order uses roles at that event's recorded moment, not
   only the player's current role.
5. Correct and save one event; confirm projection, score, and event identity
   remain valid.

## Compatibility

1. Resume or import a Soccer game whose capture preferences contain a legacy
   `selectedParticipantId` and `selectionInitialized` value.
2. Confirm the game loads without quarantine.
3. Confirm the stored participant is not silently selected in a new event.
4. Verify Basketball's chart/stat-context selector still performs its existing
   visible filtering/context job; broader sport-specific S25 work is deferred.
