# Feature 1 Plan: Single-Page Game Tracker + Court Event Capture (Option A)

> **For agentic workers:** Design + implementation plan. Steps use checkbox (`- [ ]`)
> syntax. See the umbrella [DESIGN_SHOT_TRACKER_UI_REVAMP.md](DESIGN_SHOT_TRACKER_UI_REVAMP.md)
> for shared context. Follow-on enhancements live in
> [PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md](PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md)
> (F5–F11).
>
> **Supersedes** the earlier "shot chart as a tab" design. After live-use feedback we
> chose a **single scrollable Game Tracker** where the **court is the primary input**:
> tapping the court opens an event popup that records the most common in-play events for
> the selected player. No tabs, standard scrolling (no visible scrollbar).

**Goal:** One scrollable Game Tracker page (`/game`) where a coach records the frequent
in-play basketball events by tapping the court — a popup resolves the event and updates
the selected player's stats (and stores location only for shots) — while the stat-button
grid shrinks to the administrative stats (free throws, fouls, turnovers, minutes).

**Architecture:** Game Tracker becomes a single vertical scroll: **Score → Player select
(sticky) → Court (primary input) → reduced stat grid → notes**. A new `CourtEventPopup`
maps each event to **existing** dispatches (`ADD_SHOT` for shots; `INCREMENT_STAT` for
rebounds/steals/blocks/assists), so there is **no data-model change**. The legacy
`/shot-chart` route redirects to `/game`.

**Tech Stack:** React 18 + TypeScript, Tailwind, React Router (HashRouter), existing
`GameContext` reducer + `BasketballCourt`/`ShootingSummary`. No new dependencies.

---

## 1. Problem & motivation

During a live game the current UX has two pain points:
- The shot chart is a **separate route** (`/shot-chart`); flipping between it and the
  stat grid means the player-selector strip leaves the screen and **the coach loses track
  of which player is selected** (user's words).
- The stat grid is long; finding the right button mid-play is slow.

The chosen fix (validated with the user) is **not** tabs and **not** a long passive
scroll, but to make the **court the primary input**: most live events (shot, rebound,
block, steal, assist) start with a court tap → a small popup resolves the specifics and
updates the **currently selected player**. Attribution is confirmed at the moment of the
event, and the grid shrinks to the events that aren't court-driven.

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
│  │            Half-court (tap to log)        │ │  Court = primary input
│  │  ● ✕  ●     tap → CourtEventPopup          │ │
│  └──────────────────────────────────────────┘ │
│  Shooting by zone:  Paint 6/10 · Mid 2/5 · …   │  ShootingSummary (selected view)
│  ↩ Undo last        Clear chart                │
│  ────────────────────────────────────────────  │
│  FREE THROWS   FT  FT-miss                      │  Reduced stat grid:
│  OTHER         TO  PF       MIN                 │  FT / fouls / TO / minutes only
│  ────────────────────────────────────────────  │
│  Game notes …                                   │
└──────────────────────────────────────────────┘
```

- **Sticky player strip:** the selector is pinned so the active player is always visible
  while scrolling (directly addresses the "lose track of who's selected" pain). Score
  scrolls away above it. (See §7 D2 for the exact sticky scope.)
- **Court** sits high on the page as the main input surface.
- **Reduced stat grid** holds only the events the court popup does *not* own — see §2.4.

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

Mapping to **existing** dispatches (no reducer/data changes needed beyond wiring):

| Popup choice | Dispatch | Location stored? |
|---|---|---|
| Made | `ADD_SHOT` (made; `shotType` from `isThreePointer`; `zone` from `classifyShotZone`) | **Yes** (marker) |
| Missed | `ADD_SHOT` (missed; same classification) | **Yes** (marker) |
| Off Reb / Def Reb | `INCREMENT_STAT(playerId, 'oreb' \| 'dreb')` | No |
| Steal | `INCREMENT_STAT(playerId, 'stl')` | No |
| Block | `INCREMENT_STAT(playerId, 'blk')` | No |
| Assist | `INCREMENT_STAT(playerId, 'ast')` | No |

- `ADD_SHOT` already increments the matching `2pt`/`2pt_miss`/`3pt`/`3pt_miss` stat and
  links a `shotId` for undo (`GameContext.tsx`), so made shots still drive the score via
  `pointValue`. **No new reducer actions.**
- The current **made/missed mode toggle disappears** — the popup asks Made vs Missed.
- The popup works for **team pseudo-players** too (`__team_opp__` / `__team_home__`):
  selecting the opponent and logging records opponent shots/rebounds/etc.
- A court tap that opens the popup logs **nothing** until a choice is made; **Cancel**
  (or tap-outside) dismisses with no change — so an accidental court tap is harmless.

### 2.3 Phantom-tap discrimination (required)

With the court in a scroll view, a finger that *starts a scroll on the court* must not
open the popup. `BasketballCourt`'s tap overlay currently fires on `pointerDown`. Change
it to fire on `pointerUp` **only if** the pointer didn't move past a small threshold
(~10px) and wasn't a scroll gesture; otherwise treat it as a scroll and ignore. Keep the
existing 120 ms debounce.

### 2.4 Reduced stat grid

The court popup now owns `2pt(_miss)`, `3pt(_miss)`, `oreb`, `dreb`, `stl`, `blk`, `ast`.
The grid keeps only the **non-court** basketball stats:

- **Free throws:** `ft`, `ft_miss`
- **Other:** `to`, `pf`
- **Minutes:** `min`

Mark court-owned actions so the grid can hide them. Recommended: add an optional
`capturedViaCourt?: boolean` flag to the relevant `StatAction`s in
`src/config/sports.ts` (basketball), and have `GameTracker`'s grid filter out actions
with that flag. Config-driven so it generalizes if another sport adds a court later.
(The team-stat grid for team pseudo-players — fouls/timeouts — is unaffected.)

### 2.5 Route handling

- `/shot-chart` → redirect to `/game` (keep the basketball/`gameInfo` guard). Dev-only
  `/dev/shot-chart` preview unchanged.
- Remove the "Shot chart" navigation button from `GameTracker` (the court is now inline).

### 2.6 File structure

| File | Change |
|------|--------|
| `src/components/PlayerSelectorStrip.tsx` | **Create** — extracted shared strip (was duplicated in `GameTracker`/`ShotChart`); supports sticky usage. |
| `src/components/shot-chart/ShotChartPanel.tsx` | **Create** — inline court section (court + `ShootingSummary` + undo/clear), no route concerns; opens `CourtEventPopup` on tap. |
| `src/components/shot-chart/CourtEventPopup.tsx` | **Create** — the event popup (Made/Miss + Off/Def Reb + Steal/Block/Assist). |
| `src/components/shot-chart/BasketballCourt.tsx` | **Modify** — tap-vs-scroll discrimination; tap returns `(x,y)` to open the popup instead of recording directly. |
| `src/pages/GameTracker.tsx` | **Modify** — single-page layout, sticky strip, inline `ShotChartPanel`, reduced grid, remove the shot-chart nav button. |
| `src/config/sports.ts` | **Modify** — `capturedViaCourt` on basketball shot/reb/stl/blk/ast actions. |
| `src/types.ts` | **Modify** — add `capturedViaCourt?: boolean` to `StatAction`. |
| `src/pages/ShotChart.tsx` / `src/App.tsx` | **Modify** — `/shot-chart` redirects to `/game`. |
| `AGENTS.md`, `docs/REGRESSION_TESTING.md`, `README.md` | **Modify** — document the new flow. |

## 3. Implementation phases & tasks

Three shippable phases. Each phase ends green (`pnpm build`/`lint`) and is independently testable.

### Phase 1 — Single-page layout (no behavior change to recording yet)

Goal: collapse the two pages into one scroll, with a sticky player strip; the court keeps
its **current** made/missed toggle recording for now (de-risk layout before the popup).

- [ ] **Create `PlayerSelectorStrip.tsx`** from the existing `GameTracker` strip markup
  (`sortTeamPlayersFirst`, team divider, optional `+`); add a `sticky?` prop.
- [ ] **Create `ShotChartPanel.tsx`** by lifting the court body out of `ShotChart.tsx`
  (court, `ShootingSummary`, undo last shot / clear), reading `useGame()`; keep the
  made/missed toggle for Phase 1.
- [ ] **Modify `GameTracker.tsx`**: render Score → sticky `PlayerSelectorStrip` →
  `ShotChartPanel` (basketball only) → existing stat grid → notes, all in one scroll;
  remove the "Shot chart" nav button.
- [ ] **Redirect `/shot-chart` → `/game`** (`App.tsx` / reduce `ShotChart.tsx`).
- [ ] **Phantom-tap discrimination** in `BasketballCourt` (pointer-move threshold).
- [ ] `pnpm build` + `pnpm lint`; manual: basketball game scrolls as one page; sticky
  strip keeps the active player visible; scrolling over the court records no shots.
- [ ] **Commits:** `refactor: extract PlayerSelectorStrip`; `refactor: extract ShotChartPanel`;
  `feat: single-page Game Tracker with inline court + sticky player strip`;
  `feat: redirect legacy /shot-chart to /game`; `fix: ignore court scroll gestures as taps`.

### Phase 2 — Court Event Capture popup (Option A)

Goal: replace direct court recording with the event popup.

- [ ] **Create `CourtEventPopup.tsx`**: props `{ playerId, playerLabel, x, y, shotType,
  onPick(event), onCancel }`. Renders Made/Miss (primary) + Off Reb/Def Reb/Steal/Block/
  Assist (secondary) + Cancel; shows the detected `shotType`.
- [ ] **Modify `ShotChartPanel`/`BasketballCourt`**: a confirmed tap opens the popup with
  the tapped `(x,y)` and the active `playerId`; remove the made/missed mode toggle.
- [ ] **Wire dispatches** per §2.2: Made/Miss → `ADD_SHOT`; Off/Def Reb, Steal, Block,
  Assist → `INCREMENT_STAT`. Verify undo (shot `shotId` link; stat increments) works.
- [ ] `pnpm build` + `pnpm lint`; manual: tap court → popup → each branch updates the
  selected player's stats; only Made/Miss leave a marker; Cancel logs nothing; undo
  reverts the last event.
- [ ] **Commit:** `feat: court event capture popup (shot/rebound/steal/block/assist)`.

### Phase 3 — Reduced stat grid + polish

Goal: shrink the grid to non-court stats and finalize.

- [ ] **Modify `types.ts` + `sports.ts`**: add `capturedViaCourt?: boolean`; set it on
  basketball `2pt(_miss)`, `3pt(_miss)`, `oreb`, `dreb`, `stl`, `blk`, `ast`.
- [ ] **Modify `GameTracker.tsx`**: the basketball player stat grid filters out
  `capturedViaCourt` actions, leaving `ft`/`ft_miss`, `to`, `pf`, `min`. (Team-stat grid
  unchanged.)
- [ ] **Docs:** `AGENTS.md`, `docs/REGRESSION_TESTING.md` §4d, `README.md`.
- [ ] `pnpm build` + `pnpm lint`; manual: grid shows only FT/foul/TO/min for individuals;
  the court popup is the only way to log shots/reb/blk/stl/ast; counts still match.
- [ ] **Commits:** `feat: shrink player stat grid to non-court stats`; `docs: court capture flow`.

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
  - Reduced grid shows only FT/foul/TO/min; FT still recorded via buttons.
  - Non-basketball sport: page unchanged, no court.
  - `#/shot-chart` redirects to `/game`; `#/dev/shot-chart` preview still works.
- **Regression:** reload mid-game restores shots/stats from `localStorage`; cloud sync of
  shots/stats unchanged; Game Summary shot chart tab still renders.

## 5. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Court tap during scroll logs a phantom event | Tap-vs-scroll discrimination (§2.3); popup also requires an explicit choice, so a stray tap is harmless. |
| Extra tap for blk/stl/ast vs today's 1-tap button | Accepted for Option A (one input surface); **F11 (Option B)** adds optional 1-tap quick buttons if testing shows it's needed. |
| Popup latency slows fast play | Big thumb targets; Made/Miss are the two largest; 2 taps total per event. |
| Hiding grid actions hides a stat someone still wants on the grid | `capturedViaCourt` is config-driven and reversible; FT/foul/TO/min remain on the grid. |
| `GameTracker.tsx` grows | Extracting `PlayerSelectorStrip`, `ShotChartPanel`, `CourtEventPopup` keeps it focused. |

## 6. Out of scope (other plans)

- Filtering the court by player/team (→ **F2**).
- 2/3 override chip (→ **F5**), in-popup player switch (→ **F6**), assist-linking
  (→ **F7**), per-player line (→ **F8**), rebound-after-miss prompt (→ **F9**), sequence
  numbers (→ **F10**), 1-tap quick buttons / Option B (→ **F11**).
- Cloud/multi-recorder review (→ **F3**); resume-UI scores (→ **F4**).

## 7. Pre-handoff design decisions (resolve before build)

Several were settled in discussion (marked **Decided**). Open ones have a recommended
default + `Decision:`.

- **D1 — Page model. Decided:** single scrollable page, **no tabs**, **standard scrolling
  (no visible scrollbar)**.

- **D2 — Sticky scope.** What stays pinned while scrolling?
  - _Recommended:_ pin the **player-select strip only** (slim); score scrolls away. (Best
    serves "always know who's selected" without eating height.)
  - _Decision:_ ____

- **D3 — Primary input. Decided:** the **court popup (Option A)** owns shot / rebound /
  steal / block / assist for the selected player; FT, fouls, turnovers, minutes stay as
  buttons; non-shot events store **no** location.

- **D4 — Reduced grid contents.** Confirm the individual-player grid keeps exactly
  `ft`, `ft_miss`, `to`, `pf`, `min`.
  - _Recommended:_ as listed.
  - _Decision:_ ____

- **D5 — How to hide court-owned actions.** `capturedViaCourt?: boolean` on `StatAction`
  (config-driven) vs. a hard-coded basketball id set in `GameTracker`.
  - _Recommended:_ the config flag (generalizes; keeps `GameTracker` dumb).
  - _Decision:_ ____

- **D6 — Missed shots store location. Decided (recommend yes):** both made and missed
  shots drop a marker (current behavior); confirm if you'd prefer misses without markers.
  - _Decision (confirm):_ ____

- **D7 — 2/3 detection in F1 core.** Auto-detect via `isThreePointer`; manual override is
  **F5**.
  - _Recommended:_ auto-detect only in F1; override lands in F5.
  - _Decision:_ ____

- **D8 — Popup dismissal.** Cancel button + tap-outside both dismiss with no change.
  - _Recommended:_ both.
  - _Decision:_ ____

- **D9 — Phantom-tap threshold.** Pointer move > ~10px (or a scroll gesture) cancels the tap.
  - _Recommended:_ ~10px; tune during manual testing.
  - _Decision:_ ____

- **D10 — Acceptance criteria.** e.g. "Each popup branch updates the selected player's
  correct stat; only shots leave a marker; scrolling over the court logs nothing; the grid
  shows only FT/foul/TO/min; `#/shot-chart` redirects; non-basketball unchanged."
  - _Decision (add/adjust):_ ____

### Explicitly out of F1
Everything in §6. Component boundaries (`PlayerSelectorStrip`, `ShotChartPanel`,
`CourtEventPopup`) are designed so F2/F5–F11 are thin additions.
