# F9 - Rebound-after-miss chained prompt

> Expands the F9 sketch in
> [PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md](PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md).
> Status: implemented.

## Goal

After a court-tap **Missed** shot, optionally prompt for the rebound without requiring a
second court tap. The missed shot remains attributed to the original shooter/side; the
rebound is a separate stat attribution choice.

## Pre-handoff design decisions

- **D1 - Default setting:** off by default. Coaches opt in from Settings because the
  prompt changes live-game rhythm.
- **D2 - Shot attribution:** once **Missed** is chosen, the shot stays locked to the
  player/team selected at that moment.
- **D3 - Rebound side:** offensive rebound belongs to the same side as the missed shot;
  defensive rebound belongs to the opposite side.
- **D4 - Rebound default:** rebound attribution defaults to that side's team
  pseudo-player (`__team_home__` / `__team_opp__`) when present.
- **D5 - Rebound override:** each rebound side exposes candidate chips so the scorer can
  switch from the team default to an individual on that side before logging the rebound.
- **D6 - Undo model:** keep the F7/F12 pattern: `ADD_SHOT` first, then optional
  `INCREMENT_STAT`. Undo is LIFO and recent-events shows the rebound above the missed
  shot.
- **D7 - Data model:** no reducer, storage, or cloud schema changes.

## Scope

- Basketball court popup only.
- Applies only to **Missed** shot events.
- Does not affect Made/assist, stat-only rebound buttons, score buttons, or the stat grid.
- Opponent-side rebound choices default to the opponent team pseudo-player. If individual
  opponent players are ever represented with `teamSide: 'opponent'`, they can appear in the
  same candidate row.

## Implementation tasks

- [x] Add pure rebound-prompt helper for side/default/candidate resolution.
- [x] Add helper tests for home and opponent missed-shot defaults.
- [x] Extend settings with `courtCapture.reboundPromptAfterMiss` defaulting to `false`.
- [x] Expose a Settings toggle under Admin / Settings.
- [x] Extend `CourtEventPopup` with the optional missed-shot rebound step.
- [x] Extend `ShotChartPanel` dispatch flow to record miss first, then optional rebound.
- [x] Update roadmap and regression docs.
- [x] Run `pnpm.cmd test`, `pnpm.cmd build`, `pnpm.cmd lint`, and `git diff --check`.

## Manual QA

- Setting off: Missed closes the popup and records only the miss.
- Setting on: Missed shows Rebound? with Off Reb, Def Reb, No rebound.
- Home/player missed shot:
  - Off Reb defaults to home team; switching to a player credits `oreb` to that player.
  - Def Reb defaults to opponent team and credits `dreb`.
- Opponent-team missed shot:
  - Off Reb defaults to opponent team and credits `oreb`.
  - Def Reb defaults to home team; switching to a home player credits `dreb`.
- No rebound records only the miss.
- Recent events shows rebound above the miss when rebound is recorded; two undos revert
  rebound then shot.
