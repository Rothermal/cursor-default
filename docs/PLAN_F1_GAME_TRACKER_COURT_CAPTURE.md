# Feature 1 Plan: Single-Page Game Tracker + Court Event Capture (Option A)

> **For agentic workers:** Design + implementation plan. Steps use checkbox (`- [ ]`)
> syntax. See the umbrella [DESIGN_SHOT_TRACKER_UI_REVAMP.md](DESIGN_SHOT_TRACKER_UI_REVAMP.md)
> for shared context. Follow-on enhancements live in
> [PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md](PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md)
> (F5–F11).
>
> **Supersedes** the earlier "shot chart as a tab" design. After live-use feedback we
> chose a **single scrollable Game Tracker** where the **court is a primary, fast input**:
> tapping the court opens an event popup that records the most common in-play events for
> the selected player. No tabs, standard scrolling (no visible scrollbar). **The full stat
> grid is retained** — the popup is an *additional* input path, not a replacement, so every
> stat stays adjustable via its button.

**Goal:** One scrollable Game Tracker page (`/game`) where a coach can record the frequent
in-play basketball events by tapping the court — a popup resolves the event and updates the
selected player's stats (storing location only for shots) — while **keeping the complete
stat-button grid** so any stat can still be entered, edited, or adjusted directly.

**Architecture:** Game Tracker becomes a single vertical scroll: **Score → Player select
(sticky) → Court (primary input) → full stat grid → notes**. A new `CourtEventPopup` maps
each event to **existing** dispatches (`ADD_SHOT` for shots; `INCREMENT_STAT` for
rebounds/steals/blocks/assists), so there is **no data-model change**. The court popup and
the grid buttons are two input paths to the same stats (like today's chart-vs-buttons
model). The legacy `/shot-chart` route redirects to `/game`.

**Tech Stack:** React 18 + TypeScript, Tailwind, React Router (HashRouter), existing
`GameContext` reducer + `BasketballCourt`/`ShootingSummary`. No new dependencies.

---

## 1. Problem & motivation

During a live game the current UX has two pain points:
- The shot chart is a **separate route** (`/shot-chart`); flipping between it and the
  stat grid means the player-selector strip leaves the screen and **the coach loses track
  of which player is selected** (user's words).
- Hunting for the right button mid-play is slow.

The chosen fix (validated with the user) is **not** tabs: it's a single scroll page where
the **court is a fast primary input**. Most live events (shot, rebound, block, steal,
assist) start with a court tap → a small popup resolves the specifics and updates the
**currently selected player**, with attribution confirmed at the moment of the event. The
**full stat grid stays on the page** below the court so every stat remains directly
editable/adjustable (fixing miscounts, logging FTs, edge cases). A sticky player strip
keeps the active player visible the whole time.

## 2. Design

### 2.1 Single-page layout

`/game`, top → bottom, one standard scroll (no tabs, no visible scrollbar):

```
┌──────────────────────────────────────────────┐
│  ← Home                         Summary →      │
│  ┌──────────────────────────────────────────┐ │
│  │  Rebels  62      vs      Brawlers  54     │ │  Score (Scoreboard)
│  └──────────────────────────────────────────┘ │
├───────── sticky ──────────────────────────────┤
│  [★Rebels][★Brawlers] | [#23 MJ][#11 SN] … [+] │  Player select (STICKY)
├────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────┐ │
│  │            Half-court (tap to log)        │ │  Court = primary fast input
│  │  ● ✕  ●     tap → CourtEventPopup          │ │
│  └──────────────────────────────────────────┘ │
│  Shooting by zone:  Paint 6/10 · Mid 2/5 · …   │  ShootingSummary (selected view)
│  ↩ Undo last        Clear chart                │
│  ────────────────────────────────────────────  │
│  SCORING     FT  FT-miss   2PT  3PT  (…)        │  FULL stat grid (all stats,
│  REBOUNDS    OFF  DEF                            │  still editable/adjustable)
│  PLAYMAKING  AST  STL  BLK  MIN                  │
│  OTHER       TO  PF                              │
│  ────────────────────────────────────────────  │
│  Game notes …                                   │
└──────────────────────────────────────────────┘
```

- **Sticky player strip (D2):** the selector is pinned so the active player is always
  visible while scrolling the long grid. Score scrolls away above it.
- **Court** sits high on the page as the main fast-input surface.
- **Full stat grid (D4):** the complete grid stays below the court. The court popup is a
  *faster* way to enter shot/reb/stl/blk/ast, but the buttons remain for direct entry and
  for **editing/adjusting** any stat (increment/decrement). Nothing is hidden.

For **non-basketball** sports the page is unchanged from today (no court, full grid).

### 2.2 Court Event Capture popup (Option A)

A court tap opens `CourtEventPopup` for the **currently selected player**:

```
┌─────────────────────────────┐
│  #23 Jordan                  │   selected player (switch is F6, later)
│  Detected: 2-pointer         │   from isThreePointer(x,y) (override is F5, later)
│  ┌──────────┐ ┌──────────┐   │
│  │   MADE   │ │  MISSED  │   │   shot → ADD_SHOT (stores location + 2pt/3pt[_miss])
│  └──────────┘ └──────────┘   │
│  Off Reb · Def Reb · Steal · │   stat-only (NO location):
│  Block · Assist              │   INCREMENT_STAT(oreb/dreb/stl/blk/ast)
│            [Cancel]          │
└─────────────────────────────┘
```

Mapping to **existing** dispatches (no reducer/data changes beyond wiring):

| Popup choice | Dispatch | Location stored? |
|---|---|---|
| Made | `ADD_SHOT` (made; `shotType` from `isThreePointer`; `zone` from `classifyShotZone`) | **Yes** (marker) |
| Missed | `ADD_SHOT` (missed; same classification) | **Yes** (marker — D6) |
| Off Reb / Def Reb | `INCREMENT_STAT(playerId, 'oreb' \| 'dreb')` | No |
| Steal | `INCREMENT_STAT(playerId, 'stl')` | No |
| Block | `INCREMENT_STAT(playerId, 'blk')` | No |
| Assist | `INCREMENT_STAT(playerId, 'ast')` | No |

- `ADD_SHOT` already increments the matching `2pt`/`2pt_miss`/`3pt`/`3pt_miss` stat and
  links a `shotId` for undo (`GameContext.tsx`), so made shots still drive the score via
  `pointValue`. **No new reducer actions.**
- The current **made/missed mode toggle disappears** — the popup asks Made vs Missed.
- Works for **team pseudo-players** (`__team_opp__` / `__team_home__`): selecting the
  opponent and logging records opponent shots/rebounds/etc.
- A court tap that opens the popup logs **nothing** until a choice is made; **Cancel** or
  **tap-outside** (D8) dismisses with no change — so an accidental court tap is harmless.

### 2.3 Dual input: court popup + grid buttons (no hiding)

The court popup and the grid buttons are **two paths to the same stats** (mirrors today's
shot-chart-vs-buttons model). Implications to handle:
- **Both increment the same `INCREMENT_STAT`/`ADD_SHOT`.** A coach who logs a made 2 on
  the court **and** also taps the 2PT button will double-count — same caveat as the
  existing chart. **Undo** and the button's **decrement** are the correction mechanism, and
  the grid is exactly what makes "edit/adjust all stats" (D4) possible.
- **Tooltips / help copy:** keep/extend the existing "chart-aware" tooltips on the
  scoring tiles (`GameTracker` currently explains chart vs grid for FG). Add a short note
  that the court popup and the buttons below both adjust the same player stats; the buttons
  are for direct entry and corrections.
- **Only shots carry location.** Logging a rebound/steal/block/assist via the popup is
  identical to tapping its grid button (it just saves a scroll); shots additionally store
  the marker.

### 2.4 Phantom-tap discrimination (required, D9)

With the court in a scroll view, a finger that *starts a scroll on the court* must not
open the popup. `BasketballCourt`'s tap overlay currently fires on `pointerDown`. Change it
to fire on `pointerUp` **only if** the pointer didn't move past ~**10px** (and wasn't a
scroll gesture); otherwise treat it as a scroll and ignore. Keep the existing 120 ms
debounce. Tune the threshold during manual testing on a real phone.

### 2.5 Route handling

- `/shot-chart` → redirect to `/game` (keep the basketball/`gameInfo` guard). Dev-only
  `/dev/shot-chart` preview unchanged.
- Remove the "Shot chart" navigation button from `GameTracker` (the court is now inline).

### 2.6 File structure

| File | Change |
|------|--------|
| `src/components/PlayerSelectorStrip.tsx` | **Create** — extracted shared strip (was duplicated in `GameTracker`/`ShotChart`); supports a `sticky` prop. |
| `src/components/shot-chart/ShotChartPanel.tsx` | **Create** — inline court section (court + `ShootingSummary` + undo/clear), no route concerns; opens `CourtEventPopup` on tap. |
| `src/components/shot-chart/CourtEventPopup.tsx` | **Create** — the event popup (Made/Miss + Off/Def Reb + Steal/Block/Assist). |
| `src/components/shot-chart/BasketballCourt.tsx` | **Modify** — tap-vs-scroll discrimination; tap returns `(x,y)` to open the popup instead of recording directly. |
| `src/pages/GameTracker.tsx` | **Modify** — single-page layout, sticky strip, inline `ShotChartPanel`; **keep the full stat grid**; remove the shot-chart nav button. |
| `src/pages/ShotChart.tsx` / `src/App.tsx` | **Modify** — `/shot-chart` redirects to `/game`. |
| `AGENTS.md`, `docs/REGRESSION_TESTING.md`, `README.md` | **Modify** — document the new flow. |

(No `types.ts` / `sports.ts` change — D4 keeps the full grid, so there is no
`capturedViaCourt` hiding.)

## 3. Implementation phases & tasks

Three shippable phases. Each phase ends green (`pnpm build`/`lint`) and is independently testable.

### Phase 1 — Single-page layout (no recording-behavior change yet)

Goal: collapse the two pages into one scroll, with a sticky player strip; the court keeps
its **current** made/missed toggle recording for now (de-risk layout before the popup).

- [x] **Create `PlayerSelectorStrip.tsx`** from the existing `GameTracker` strip markup
  (`sortTeamPlayersFirst`, team divider, optional `+`); add a `sticky?` prop.
- [x] **Create `ShotChartPanel.tsx`** by lifting the court body out of `ShotChart.tsx`
  (court, `ShootingSummary`, undo last shot / clear), reading `useGame()`; keep the
  made/missed toggle for Phase 1.
- [x] **Modify `GameTracker.tsx`**: render Score → sticky `PlayerSelectorStrip` →
  `ShotChartPanel` (basketball only) → existing **full** stat grid → notes, all in one
  scroll; remove the "Shot chart" nav button.
- [x] **Redirect `/shot-chart` → `/game`** (`App.tsx` / reduce `ShotChart.tsx`).
- [x] **Phantom-tap discrimination** in `BasketballCourt` (~10px pointer-move threshold).
- [x] `pnpm build` + `pnpm lint` green; manual (pending user QA): basketball game scrolls as one page; sticky
  strip keeps the active player visible; scrolling over the court records no shots.
- [x] **Commits:** `refactor: extract PlayerSelectorStrip`; `refactor: extract ShotChartPanel`;
  `feat: single-page Game Tracker with inline court + sticky player strip`;
  `feat: redirect legacy /shot-chart to /game`; `fix: ignore court scroll gestures as taps`.

### Phase 2 — Court Event Capture popup (Option A)

Goal: add the event popup as the court's input; the grid stays full.

- [x] **Create `CourtEventPopup.tsx`**: props `{ playerId, playerLabel, x, y, shotType,
  onPick(event), onCancel }`. Renders Made/Miss (primary) + Off Reb/Def Reb/Steal/Block/
  Assist (secondary) + Cancel; shows the detected `shotType`; dismiss on Cancel or
  tap-outside.
- [x] **Modify `ShotChartPanel`/`BasketballCourt`**: a confirmed tap opens the popup with
  the tapped `(x,y)` and the active `playerId`; remove the made/missed mode toggle.
- [x] **Wire dispatches** per §2.2: Made/Miss → `ADD_SHOT`; Off/Def Reb, Steal, Block,
  Assist → `INCREMENT_STAT`. Verify undo (shot `shotId` link; stat increments) works.
- [x] `pnpm build` + `pnpm lint` green; manual (pending user QA): tap court → popup → each branch updates the
  selected player's stats; only Made/Miss leave a marker; Cancel logs nothing; undo
  reverts the last event; the grid buttons still adjust the same stats.
- [x] **Commit:** `feat: court event capture popup (shot/rebound/steal/block/assist)`.

### Phase 3 — Dual-input clarity + docs

Goal: make the two input paths understandable and document the flow (no grid shrink).

- [x] **Modify `GameTracker.tsx`**: update the scoring-tile tooltips and add a short note
  that the court popup and the grid both adjust the same player stats (popup = fast entry +
  location for shots; buttons = direct entry/corrections).
- [x] **Docs:** `AGENTS.md`, `docs/REGRESSION_TESTING.md` §4d, `README.md`.
- [x] `pnpm build` + `pnpm lint` green; manual (pending user QA): tooltips read correctly; entering a stat via the
  popup and adjusting it via its button behaves additively as documented.
- [x] **Commit:** `docs+ux: clarify court popup vs grid dual input; document court capture flow`.

## 4. Testing

- **Build/lint:** `pnpm build`, `pnpm lint`.
- **Manual (GUI, `pnpm dev`, `#/game`):**
  - Single scroll page; sticky player strip keeps the active player visible while scrolling.
  - Tap court → popup → **Made** (2 in paint) increments `2pt` + score + marker; **Missed**
    beyond arc increments `3pt_miss` + marker; **Off/Def Reb**, **Steal**, **Block**,
    **Assist** increment the right stat with **no** marker.
  - Scrolling with a finger starting on the court records nothing (phantom-tap guard).
  - Selected-player attribution is correct for individuals and for the opponent pseudo-player.
  - Undo reverts the most recent event (marker + stat for shots).
  - **Full grid present:** every stat (incl. shot/reb/stl/blk/ast) is still entered/adjusted
    via its button; popup + button on the same stat behave additively (and can be corrected
    via undo/decrement).
  - Non-basketball sport: page unchanged, no court.
  - `#/shot-chart` redirects to `/game`; `#/dev/shot-chart` preview still works.
- **Regression:** reload mid-game restores shots/stats from `localStorage`; cloud sync of
  shots/stats unchanged; Game Summary shot chart tab still renders.

## 5. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Court tap during scroll logs a phantom event | Tap-vs-scroll discrimination (§2.4); popup also requires an explicit choice, so a stray tap is harmless. |
| Double-count: popup **and** grid both increment the same stat | Documented dual-input model (§2.3); undo + button decrement are the correction path; this is what enables "edit/adjust all stats" (D4). Tooltips explain it. |
| Extra tap for blk/stl/ast via popup vs the grid's 1-tap button | The grid button is still there for 1-tap; the popup is an optional faster-in-context path. **F11 (Option B)** can add court-adjacent quick buttons if desired. |
| Popup latency slows fast play | Big thumb targets; Made/Miss are the two largest; 2 taps total per event. |
| `GameTracker.tsx` grows | Extracting `PlayerSelectorStrip`, `ShotChartPanel`, `CourtEventPopup` keeps it focused. |

## 6. Out of scope (other plans)

- Filtering the court by player/team (→ **F2**).
- 2/3 override chip (→ **F5**), in-popup player switch (→ **F6**), assist-linking
  (→ **F7**), per-player line (→ **F8**), rebound-after-miss prompt (→ **F9**), sequence
  numbers (→ **F10**), 1-tap court-adjacent quick buttons / Option B (→ **F11**).
- Cloud/multi-recorder review (→ **F3**); resume-UI scores (→ **F4**).

## 7. Pre-handoff design decisions — RESOLVED

All F1 decisions are settled (signed off in discussion). Recorded here for the build agent.

- **D1 — Page model.** Single scrollable page, **no tabs**, **standard scrolling (no
  visible scrollbar)**.
- **D2 — Sticky scope.** Pin the **player-select strip only** (slim); score scrolls away.
- **D3 — Primary input.** **Court Event Capture (Option A)** — court popup records shot /
  rebound / steal / block / assist for the selected player; non-shot events store **no**
  location.
- **D4 — Stat grid.** **Keep the FULL grid.** The popup is an *additive* fast-input path,
  **not** a replacement — every stat (including shot/reb/stl/blk/ast) stays directly
  enterable, editable, and adjustable via its button. (Supersedes the earlier
  "shrink the grid" idea.)
- **D5 — Hiding court-owned actions.** **N/A** — nothing is hidden (follows from D4); no
  `capturedViaCourt` flag, no `types.ts`/`sports.ts` change.
- **D6 — Shot markers.** **Both** made and missed shots drop a marker.
- **D7 — 2/3 detection.** Auto-detect via `isThreePointer` in F1; manual override is **F5**.
- **D8 — Popup dismissal.** **Cancel** button **and** tap-outside both dismiss with no change.
- **D9 — Phantom-tap threshold.** Pointer move > ~**10px** (or a scroll gesture) cancels
  the tap; tune during manual testing.
- **D10 — Acceptance criteria.** Each popup branch updates the **selected** player's correct
  stat; only Made/Missed leave a marker; scrolling over the court logs nothing; **the full
  stat grid remains and every stat is editable/adjustable**; made shots still drive the
  score; popup + grid entries are additive and correctable via undo/decrement;
  `#/shot-chart` redirects to `/game`; non-basketball sports are unchanged.

### Explicitly out of F1
Everything in §6. Component boundaries (`PlayerSelectorStrip`, `ShotChartPanel`,
`CourtEventPopup`) are designed so F2/F5–F11 are thin additions.
