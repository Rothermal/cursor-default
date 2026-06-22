# Feature 12 Plan: Recent-Events Undo Popup

> **For agentic workers:** Design + implementation plan. Steps use checkbox (`- [ ]`)
> syntax. See [DESIGN_SHOT_TRACKER_UI_REVAMP.md](DESIGN_SHOT_TRACKER_UI_REVAMP.md) and the
> [enhancements roadmap](PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md). **Enhances F1**
> ([PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md](PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md))'s undo
> bar. **Build F12 before F7** — F7's two-step assist undo relies on F12 for transparency.

**Goal:** Replace the tracker's silent single-Undo with a **Recent-events popup** that lists
the last ~5 events in plain language (`<player> — <event>`), so the user can see what
happened and undo from the most recent. Works for every sport; no data-model change.

**Architecture:** Render the tail of the existing `actionLog` through a label helper; the
popup undoes via the existing **LIFO** `UNDO` action (top entry first). Optional
cascade-to-row (undo everything newer than a tapped row). Arbitrary out-of-order undo is
**explicitly deferred** (§6 — needs a bigger refactor).

**Tech Stack:** React + TypeScript, existing `GameState.actionLog` + `UNDO`, sport config
for labels. No new dependencies, no migration.

---

## 1. Problem & current state

The Game Tracker's undo is a single button that silently pops the last `actionLog` entry;
the bottom bar shows only a one-line "Last: #23 2PT" (`GameTracker.tsx` `lastActionLabel`).
You can't see the recent sequence, so corrections are guesswork — especially with the F1
court popup (where shots, rebounds, steals, blocks, assists all flow in quickly) and F7
(a made shot + its assist are two entries).

The data already exists: `actionLog: ActionLogEntry[]` records every event with `playerId`,
`statId`, `previousValue`, `shotId`, and score-event types. F12 surfaces it.

## 2. Design

### 2.1 The popup

The Undo control opens a popup listing the **last ~5 events**, most recent first:

```
Recent events
  #23 Player B — 2PT made        ↩
  #11 Player A — Assist           ↩
  #11 Player A — Def. rebound     ↩
  Opponent — +1                   ↩
  #5  Player C — Steal            ↩
        (scroll for more)
```

- Each row: a readable label + an undo affordance.
- The list reads the tail of `actionLog`; it updates live as events are logged/undone.

### 2.2 Undo behavior — LIFO with visibility (v1)

The undo log is built for **strict last-in-first-out**: each entry stores the *previous
value*, valid only when unwound in order. So v1:

- **A (chosen): LIFO / top-only.** You undo from the **top** (most recent); the list
  updates; repeat to walk back. The list is for *context* — you always see what the next
  undo will remove.
- **B (optional): cascade-to-row.** Tapping row N undoes rows 1..N (everything newer, in
  order) via N sequential `UNDO` dispatches. Still LIFO-safe.
- **C: arbitrary single-event undo — DEFERRED** (see §6). Removing a middle entry is unsafe
  with the current stored-`previousValue` model.

### 2.3 Event labels

Generalize the existing `GameTracker` label logic (`lastActionLabel` + `findStatShortLabel`)
into a reusable helper:

```ts
// src/lib/actionLogLabels.ts
export function describeActionLogEntry(
  entry: ActionLogEntry, players: Player[], sport: SportConfig
): { who: string; what: string }
```

Covers: player stat increments/decrements (player # + name + stat short label, made/miss),
opponent/home score events (`Opponent +1`, `Home −1`), and shot-originated increments
(`shotId` → "2PT/3PT made/miss"). Reused by the bottom bar's one-liner and the popup rows.

### 2.4 Entry point

The bottom **Undo** control opens the Recent-events popup. Undoing the top row is identical
to today's single Undo. (No separate button — the existing Undo becomes "review & undo".)
The chart-specific "Undo last shot" on the court (F1) is unchanged.

### 2.5 Scope

- **All sports** (the log + labels are sport-agnostic via `SportConfig`).
- **Tracker only** (live game). Not the Game Summary (which is review, not correction).
- No data-model change — reads `actionLog`, undoes via existing `UNDO`.

### 2.6 File structure

| File | Change |
|------|--------|
| `src/lib/actionLogLabels.ts` | **Create** — `describeActionLogEntry(...)` (+ unit test). |
| `src/components/RecentEventsPopup.tsx` | **Create** — renders the last N entries + per-row undo (LIFO; optional cascade). |
| `src/pages/GameTracker.tsx` | **Modify** — the bottom Undo control opens `RecentEventsPopup`; reuse `describeActionLogEntry` for the existing one-liner. |

## 3. Implementation tasks (bite-sized)

### Task 1: Label helper + tests (TDD)

- [ ] **Create `src/lib/actionLogLabels.test.ts`**: a player stat increment →
  `{ who: '#23 Player B', what: '2PT made' }`-style; a decrement; opponent/home score
  events; a shot-originated increment (via `shotId`). Use a sample `SportConfig` + players.
- [ ] Run the test. Expected: FAIL (module missing).
- [ ] **Create `src/lib/actionLogLabels.ts`** by extracting/generalizing `GameTracker`'s
  `lastActionLabel`/`findStatShortLabel`.
- [ ] Run the test. Expected: PASS.
- [ ] **Commit:** `feat: add actionLogLabels helper for readable event descriptions`

### Task 2: RecentEventsPopup (LIFO/top-only)

- [ ] **Create `RecentEventsPopup.tsx`**: props `{ entries, players, sport, onUndoTop, onClose }`.
  Render the last ~5 `actionLog` entries (most recent first) via `describeActionLogEntry`,
  each with an undo affordance; the top row's undo calls `onUndoTop` (→ dispatch `UNDO`).
  Empty state when the log is empty.
- [ ] **Modify `GameTracker.tsx`**: the bottom Undo opens the popup; wire `onUndoTop` →
  `dispatch({ type: 'UNDO' })`; reuse `describeActionLogEntry` for the bar one-liner.
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] Manual: log several events → open popup → see the readable list → undo top → list
  updates and the stat reverts; repeat to walk back.
- [ ] **Commit:** `feat: recent-events undo popup on the Game Tracker`

### Task 3 (optional): cascade-to-row (B)

- [ ] If adopting B: tapping row N dispatches `UNDO` N times (newest→that row), with a brief
  confirm if N is large. Otherwise skip.
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] **Commit:** `feat: cascade undo to a chosen recent event`

## 4. Testing

- **Unit:** `pnpm test src/lib/actionLogLabels.test.ts`.
- **Build/lint:** `pnpm build`, `pnpm lint`.
- **Manual (GUI, `pnpm dev`, `#/game`):**
  - Log a mix (court popup shots/reb/stl/blk/ast + opponent/home score) → open Undo → the
    last ~5 show as readable rows, most recent first.
  - Undo the top row → correct stat reverts (and marker disappears for a shot); list updates.
  - With F7: a made shot + assist appear as two adjacent rows; two undos revert each.
  - Works in a non-basketball sport (e.g. baseball) with that sport's labels.
  - Empty log → empty-state, no crash.

## 5. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Out-of-order undo corrupts stored `previousValue` | v1 is **LIFO-only** (A) / cascade (B); arbitrary (C) is deferred (§6). |
| Label gaps for some action types | The helper covers every `ActionLogEntry.type`; unit-tested; falls back to the raw stat id. |
| Popup clutter on small phones | Cap at ~5 visible (scroll for more); compact rows. |

## 6. Out of scope / FUTURE NOTE

- **C — arbitrary out-of-order single-event undo (FUTURE, larger refactor).** Undoing a
  *middle* event (not just from the top) is **not** safe with today's model, because each
  `ActionLogEntry` stores an absolute `previousValue` that's only valid for LIFO unwinding
  (e.g. two increments of the same stat: removing the older one first restores a stale
  value). Supporting it would require reworking the undo model — e.g. storing **inverse
  deltas** instead of absolute previous values, or recomputing state from an event-sourced
  log. **Note for a potential future update:** gather usage data first (do users actually
  want to undo non-tail events?) before committing to that refactor; it's significantly more
  work and risk than F12's LIFO popup.
- Editing an event's value in place (vs undo + re-log).
- A full game-event timeline / play-by-play export.

## 7. Pre-handoff design decisions — RESOLVED

Settled in discussion (A confirmed; B optional; C deferred).

### A. Behavior

- **D1 — Undo behavior.** **A: LIFO / top-only** for v1 (undo from the most recent; the list
  gives context). **B (cascade-to-row)** is an optional add (Task 3). **C (arbitrary
  out-of-order)** is **deferred** to a future refactor (§6).
- **D2 — How many events shown.** ~**5** visible, scrollable to more.
- **D3 — Label format.** `<player> — <event>` (player # + first name + stat short label,
  made/miss); score events as `Opponent +1` / `Home −1`. Via `describeActionLogEntry`.
- **D4 — Entry point.** The existing bottom **Undo** control opens the popup; undoing the top
  row equals today's single Undo. The court's "Undo last shot" (F1) is unchanged.

### B. Scope & data

- **D5 — Surfaces.** **Tracker only** (live correction); not the read-only Game Summary.
- **D6 — Sports.** All sports (sport-agnostic via `SportConfig`/`actionLog`).
- **D7 — No data-model change.** Reads `actionLog`; undoes via existing `UNDO`.

### C. Acceptance & tests

- **D8 — Acceptance.** Popup shows the last ~5 readable events; top-row undo reverts the
  correct stat/marker; updates live; works with F7's two-entry assist; works across sports;
  empty-state safe.

### D. Explicitly out of F12 (now)
Arbitrary out-of-order undo (**C**, future refactor — §6), in-place event editing, full
play-by-play/timeline export.
