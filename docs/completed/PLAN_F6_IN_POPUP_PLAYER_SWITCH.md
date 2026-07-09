# Feature 6 Plan: In-Popup Player Confirm / Switch

> **Status:** Implemented.
>
> **For agentic workers:** Design + implementation plan. Steps use checkbox (`- [ ]`)
> syntax. See [DESIGN_SHOT_TRACKER_UI_REVAMP.md](../DESIGN_SHOT_TRACKER_UI_REVAMP.md) and the
> [enhancements roadmap](../PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md). **Depends on F1**
> ([PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md](PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md)) for the
> popup, and reuses **F2**'s player ordering / selection model.

**Goal:** Let the user **confirm or change the attributed player inside `CourtEventPopup`**
before logging an event — the strongest guard against logging to the wrong player, and the
direct fix for the original "I lose track of who's selected" pain.

**Architecture:** F1 already shows the selected player's name in the popup header. F6 makes
that header a **control**: tapping it opens a compact player picker (same ordering as the
sticky strip — team pseudo-players first, then individuals). Choosing a player updates the
**active player** (`SET_ACTIVE_PLAYER`); the popup stays open so the user then picks the
event. No data-model change.

**Tech Stack:** React + TypeScript, reuse `sortTeamPlayersFirst` / `PlayerSelectorStrip`
data. No new dependencies.

---

## 1. Problem & current state (post-F1/F2)

After F1, a court tap opens `CourtEventPopup` for the **currently active player** and shows
their name in the header. After F2, selecting a chip in the sticky strip sets the active
player (and the view filter). But within the popup there's **no way to fix attribution** —
if the wrong player was active when you tapped, you must Cancel, re-select the chip in the
strip, and tap the court again. F6 lets you switch right there.

This is the user's top-priority pain ("I lose track of which player is selected") addressed
at the exact moment it matters: when committing an event.

## 2. Design

### 2.1 Header becomes a switcher

```
┌─────────────────────────────┐
│  #23 Jordan            ▾     │  ← tap to open the player picker
│  Shot value:  [2PT] 3PT      │  (F5)
│  ┌──────────┐ ┌──────────┐   │
│  │   MADE   │ │  MISSED  │   │
│  └──────────┘ └──────────┘   │
│  Off Reb · Def Reb · …       │
└─────────────────────────────┘
```

Tapping the header (name + ▾) reveals a compact picker:

```
┌─────────────────────────────┐
│  Log for:                    │
│  ★ Rebels   ★ Brawlers       │  team pseudo-players first
│  #23 MJ  #11 SN  #33 LB  …    │  then individuals (scroll if needed)
└─────────────────────────────┘
```

- Picker order = `sortTeamPlayersFirst(players)` (same as the strip), incl. team
  pseudo-players.
- Choosing a player dispatches `SET_ACTIVE_PLAYER` and **keeps the popup open** with the new
  player shown; the user then taps Made/Missed/etc.
- The picker is a lightweight inline panel/menu within the popup (not a separate route).

### 2.2 Switch scope = global (updates the active player)

Choosing a player in the popup updates the **global** `activePlayerId` — exactly as if you'd
tapped that chip in the sticky strip. Consequences (intended):
- The sticky strip highlight follows.
- Per **F2's coupling (F2 §8 D2/D3)**, the **view filter** follows too, so after logging,
  the inline court shows the now-active player's shots.
- Subsequent court taps default to the newly chosen player (you usually keep tracking the
  player who just did something).

This keeps **one source of truth** (`activePlayerId`) instead of a separate per-event
attribution override. (A one-off "this event only" mode is considered and rejected for v1 —
see §7 D1.)

### 2.3 Interaction with F5 and the secondary actions

- The player switch applies to **all** popup outcomes (Made/Missed shot, or rebound / steal
  / block / assist) — whatever you pick next is attributed to the chosen player.
- It composes with F5 (the 2/3 chip) independently: switch player, optionally adjust 2/3,
  then Made/Missed.

### 2.4 File structure

| File | Change |
|------|--------|
| `src/components/shot-chart/CourtEventPopup.tsx` | **Modify** — header becomes a button that toggles an inline player picker; selecting dispatches `SET_ACTIVE_PLAYER` and updates the popup's player without closing it. |
| `src/components/PlayerSelectorStrip.tsx` or a small `PlayerPickerMenu` | **Reuse/Create** — share `sortTeamPlayersFirst` ordering; either reuse the strip in a compact mode or add a tiny menu component to avoid overloading the strip. |

No `types.ts`/reducer change — `SET_ACTIVE_PLAYER` already exists.

## 3. Implementation tasks (bite-sized)

### Task 1: Player picker UI in the popup

- [x] **Modify `CourtEventPopup.tsx`**: make the header (player name) a button with a `▾`
  affordance; add local `const [pickerOpen, setPickerOpen] = useState(false)`.
- [x] Render an inline picker when `pickerOpen`: list `sortTeamPlayersFirst(players)` (team
  pseudo-players first, then individuals), highlighting the current player.
- [x] Decide reuse vs. new: if `PlayerSelectorStrip` can render compactly without an "All"
  chip / add button, reuse it; otherwise add a minimal `PlayerPickerMenu`.
- [x] Run `pnpm build` + `pnpm lint`. Expected: pass. Build passed; lint passed with existing fast-refresh warnings.
- [x] **Commit:** `feat: player picker affordance in court event popup`

### Task 2: Wire the switch (global active player)

- [x] On pick: `dispatch({ type: 'SET_ACTIVE_PLAYER', playerId })`, close the picker, keep
  the popup open showing the new player; the popup's pending `(x,y)`/shot-value are preserved.
- [x] Ensure the next event (shot or secondary action) is attributed to the new active player.
- [x] Run `pnpm build` + `pnpm lint`. Expected: pass. Build passed; lint passed with existing fast-refresh warnings.
- [ ] Manual: open popup for #23 → switch to #11 → Made → `2pt`/`3pt` credited to **#11**;
  sticky strip now highlights #11; after closing, the inline court shows #11's shots
  (F2 coupling).
- [x] **Commit:** `feat: switch attributed player inside the court event popup`

## 4. Testing

- **Build/lint:** `pnpm build`, `pnpm lint`.
- **Manual (GUI, `pnpm dev`, `#/game`):**
  - Tap court while #23 active → popup header shows #23; open picker → choose #11 → header
    shows #11; tap Made → the made shot (and its location) credits **#11**.
  - Switch then choose a **rebound/steal/block/assist** → credited to the switched player.
  - After logging, the sticky strip highlights the switched player and the inline court
    filters to them (F2 coupling).
  - Switch to a **team pseudo-player** (opponent) and log → opponent shot recorded.
  - Cancel after switching but before choosing an event → nothing logged, **but** the active
    player has changed (see §7 D4 for whether that's acceptable).
  - Undo reverts the logged event for the correct player.

## 5. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Switching changes the global active player even if the user only wanted a one-off | Documented (§2.2); v1 chooses global for a single source of truth. Revisit a one-off mode only if requested (§7 D1). |
| Picker crowds the popup on small phones | Compact, scrollable row; team pseudo-players first; reuse the strip's proven layout. |
| "Cancel" after a switch leaves a new active player | Acceptable default (the switch is an explicit user action); confirm via §7 D4. |
| Confusion with F2's strip selection | They're the same action (`SET_ACTIVE_PLAYER`); the picker is just a second entry point at log time. |

## 6. Out of scope

- A true per-event "log to X without changing my selection" one-off mode (deferred; §7 D1).
- Multi-player events beyond assist-linking (that's **F7**).
- Adding new players from inside the popup (use the strip's `+`).

## 7. Pre-handoff design decisions — RESOLVED

All F6 decisions are settled (signed off; every one confirmed as recommended).

### A. Behavior

- **D1 — Switch scope.** **Global** — choosing a player updates `activePlayerId` (single
  source of truth); the sticky strip and the F2 view filter follow; subsequent taps default
  to the chosen player. (One-off "this event only" mode deferred.)
- **D2 — Popup stays open after switching.** Choosing a player updates the header and keeps
  the popup open (preserving the pending tap location and F5 2/3 value); the user then picks
  the event.
- **D3 — Picker contents/order.** `sortTeamPlayersFirst(players)` — team pseudo-players
  first, then individuals (same as the sticky strip).
- **D4 — Cancel-after-switch.** The active-player change **persists** — switching is an
  explicit action; only the event is skipped on Cancel.

### B. UI / reuse

- **D5 — Reuse vs. new menu.** Reuse `PlayerSelectorStrip` in a compact "picker" mode if it
  renders cleanly without the "All"/`+` affordances; otherwise add a minimal
  `PlayerPickerMenu` (build-agent's call based on the component's shape).

### C. Acceptance & tests

- **D6 — Acceptance.** Switching credits the chosen player for shots and secondary actions;
  the sticky strip + inline court (F2) follow; team pseudo-players selectable; undo correct;
  Cancel logs nothing.

### D. Explicitly out of F6
One-off attribution mode; assist-linking (**F7**); adding players from the popup.
