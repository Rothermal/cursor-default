# Feature 8 Plan: Live Per-Player Line in Popup

> **Status:** Implemented.

> **For agentic workers:** Design + implementation plan. Steps use checkbox (`- [ ]`)
> syntax. See [DESIGN_SHOT_TRACKER_UI_REVAMP.md](DESIGN_SHOT_TRACKER_UI_REVAMP.md) and the
> [enhancements roadmap](PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md). Depends on F1 and
> builds naturally on F6's in-popup player switch.

**Goal:** Show the selected player's compact live stat line in `CourtEventPopup`, directly
under the **Log for** player name, so the scorer has immediate context while choosing a
shot/stat event.

**Architecture:** Reuse `formatCompactGameStatLine(sport, player.stats)` from
`src/lib/statDisplay.ts`. `ShotChartPanel` already knows the effective player and game
sport, so it computes the display string and passes it to `CourtEventPopup` as a
display-only prop. No reducer, sync, schema, or undo changes.

---

## 1. Scope

- Basketball court popup only (because `CourtEventPopup` only renders from the basketball
  `ShotChartPanel` today).
- Display-only; no stat mutations or persistence changes.
- Reuse the existing compact game stat line format: points, basketball rebounds, then
  sport `keyStatIds` such as `AST`, `STL`, `BLK`.
- The line updates when F6 changes the selected player because the popup rerenders from
  game state.

## 2. Implementation Tasks

- [x] **Modify `ShotChartPanel.tsx`**: pull `sport` from game state, compute
  `playerStatLine = formatCompactGameStatLine(sport, effectivePlayer.stats)` when both
  exist, and pass it to `CourtEventPopup`.
- [x] **Modify `CourtEventPopup.tsx`**: accept optional `playerStatLine` and render it under
  the selected player label in the Log for control. Keep the text compact and truncated.
- [x] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] Manual: open the court popup for a player with stats; line appears under their name.
  Switch players via **Log for**; line updates. Team/opponent pseudo-player labels do not
  crash and can omit or show a valid line.

## 3. Testing

- **Build/lint:** `pnpm build`, `pnpm lint`.
- **Manual GUI (`pnpm dev`, `#/game`):**
  - Player with no stats shows a sensible compact line.
  - Player with points/rebounds/assists shows e.g. `12 PTS - 5 REB - 3 AST` or equivalent
    existing separator formatting.
  - F6 player switch updates the line before logging.
  - F7 assisted made-shot flow still works; the line is context only.

## 4. Pre-Handoff Design Decisions

- **D1 — Source of truth.** Use existing `formatCompactGameStatLine`; do not introduce a
  popup-specific formatter unless the helper proves insufficient.
- **D2 — Stats shown.** Accept the existing helper output: score + basketball rebounds +
  `sport.keyStatIds`.
- **D3 — Data model.** No reducer, `types.ts`, sync, or migration changes.
- **D4 — Team pseudo-players.** Defensive handling only; no special team stat line work in
  F8.
