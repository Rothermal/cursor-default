# Regression: BKE-7 Full Court

Record for [BKE-7](PLAN_BKE_7_FULL_COURT.md). Unit tests, builds and local browser runs do
not establish live Supabase, installed PWA or owner sign-off; those are listed separately.

No migration, no event schema bump and no setup or rules change in any slice.

## Automated

| Slice | Area | Cases | Result |
|---|---|---|---|
| 7A | Frame and projection (`fullCourt.test.ts`) | Frame equivalence at both baskets, backcourt value, halves with overtime, quarters, the eight-segment youth profile, odd counts, Switch ends forward only and its removal, frame mixing, second or late tip-off, Switch ends in a break, half-court games unchanged, Timeline labels | Pass (PR #485) |
| 7B | Live full court (`fullCourtLive.test.ts`) | Start with and without a tip-off, direction stamping and value, side choice through Switch ends and halftime, Undo and removal of Switch ends with the tip-off read only, edit keeps the basket, added-shot preselection, flip-aware text | Pass (PR #486) |
| 7C | Located plays (`fullCourtPlays.test.ts`) | Stamping per side and after Switch ends, unlocated assists, grid entries and half-court games, located fouls, rejection of half-court-frame plays and frame mixing, Undo, edit move and clear keeping the direction, recorded-later fouls, flip-aware spot text | 9 pass (PR #487) |
| 7D | Summary court (`fullCourtSummary.test.ts`) | Tracked attacks right and the opponent left with half turns for the other halves; older half-court shots at their side's end; full-court and half-court markers; a heave beyond half court counted, drawn on the full court and left off the half court; the Plays map with side and play filters, assists and unlocated plays left off; no plays in a half-court game | 5 pass |
| 7D | Orientation guard (`releaseEntryGuards.test.ts`) | Full court, Half court and the Plays map read the game's flip | Pass |
| All | Full suite | `pnpm test` | 290 files, 2722 tests pass |
| All | `pnpm typecheck`, `pnpm lint`, `pnpm build` | | Pass (lint: the 3 existing fast-refresh warnings) |

## Browser

Playwright with Chromium at 375 px against `pnpm dev`, a fresh local Event game with the
tip-off at the right basket: two shots each way, a steal, a defensive rebound and a
turnover from court taps. Screenshots are in the project files under
`basketball-full-court/bke-7b`, `bke-7c` and `bke-7d`.

| Check | Result |
|---|---|
| Live court, popup, backcourt prompt, flip, Court ends, Switch ends (7B) | Pass |
| Popup Turnover, play detail Court spot, editor Move and Remove (7C) | Pass |
| Summary Shots opens on Full court with team labels; tracked shots at the right end, opponent at the left | Pass |
| Half court folds all four shots onto one basket | Pass |
| Plays tab shows the steal, rebound and turnover with letters and spot text | Pass |

## Owner checks (plan §6, not yet run)

- A full local game on a phone with quarters: tip-off, shots at both ends, the halftime
  switch, overtime, a backcourt heave, Switch ends and its Undo.
- The same with halves, the eight-segment youth profile, and a clockless game.
- Clockless: attack right, Switch ends, then add an earlier missed layup at the right
  basket from the Timeline; the sheet asks for the basket.
- Anchored: set the clock back so a time repeats across a Switch ends; a recorded-later
  shot at that time asks for the basket.
- Editing a located shot's position, side and period keeps its basket.
- Both teams' backcourt heaves: Full court draws them, Half court lists them under
  Beyond half court, totals include them.
- Stored coordinates identical with the flip on and off.
- A pre-BKE-7 game still tracks on the half court and its Summary opens on Half court.
- A cloud game syncs, finalizes and shows the full-court Summary and Plays on a second
  device.
- Installed PWA updated on every device before recording a full-court game (plan §5).
