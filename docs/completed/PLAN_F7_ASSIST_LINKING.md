# Feature 7 Plan: Assist-Linking on a Made Shot

> **Status:** Implemented. Recent-passers ordering remains future polish; v1 uses same-side
> candidate ordering from the player strip.

> **For agentic workers:** Design + implementation plan. Steps use checkbox (`- [ ]`)
> syntax. See [DESIGN_SHOT_TRACKER_UI_REVAMP.md](../DESIGN_SHOT_TRACKER_UI_REVAMP.md) and the
> [enhancements roadmap](../PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md). **Depends on F1**
> ([PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md](PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md)); pairs
> with **F6** (player picker reuse) and **F12** (recent-events undo popup, which makes the
> two-step undo transparent).

**Goal:** After logging a **Made** shot in the court popup, optionally credit the assisting
teammate in the same gesture — assists are almost always tied to a made FG, so this saves a
separate court tap.

**Architecture:** After **Made**, `CourtEventPopup` offers an optional "Assisted by …"
picker (skippable). Choosing a teammate dispatches a **separate** `INCREMENT_STAT(ast)` in
addition to the shooter's `ADD_SHOT`. **No reducer / data-model change** — these are two
ordinary actions in the existing log. Undo is the normal LIFO, made transparent by **F12's
recent-events popup** (you see "2PT — B" and "Assist — A" as adjacent rows).

**Tech Stack:** React + TypeScript, reuse `sortTeamPlayersFirst`/F6 picker, existing
`ADD_SHOT` + `INCREMENT_STAT`. No new dependencies.

---

## 1. Problem & current state (post-F1)

After F1, a made shot is logged via the court popup → `ADD_SHOT` (which increments the
shooter's `2pt`/`3pt`). Crediting the assist today means a **separate** action: select the
passer in the strip and tap the `AST` grid button. F7 folds the assist into the made-shot
flow.

## 2. Design

### 2.1 Flow

```
tap court → popup → [F5 2/3] → MADE
                                  │
                                  ▼
                    ┌───────────────────────────┐
                    │  Assisted by? (optional)   │
                    │  #11 SN  #33 LB  #5 KL  …   │  same-side teammates (not the shooter)
                    │  [ No assist ]             │
                    └───────────────────────────┘
```

- Appears **only after Made** (never after Missed, rebound, steal, block, or a standalone
  assist).
- **Optional**: a prominent "No assist" / skip dismisses it; default is **no assist**.
- Picking a teammate credits `ast` to them; the shooter's made shot is unchanged.

### 2.2 Who can be the assister

- Same-side players **excluding the shooter** (no self-assist), ordered like the strip. For
  a home individual shooter, the other home individuals. For an opponent (team
  pseudo-player) shot, the step is **omitted** in v1 (§7 D5).

### 2.3 Undo model — two independent steps, made transparent by F12

A made shot **with** an assist is two ordinary log entries: the shooter's `ADD_SHOT`
(shot + marker + shot stat) followed by the assister's `INCREMENT_STAT(ast)`. We **do not**
link them in the reducer. Instead:

- Undo stays the normal LIFO: one Undo reverts the assist, the next reverts the shot+marker.
- **F12's recent-events popup** ([PLAN_F12_RECENT_EVENTS_UNDO.md](PLAN_F12_RECENT_EVENTS_UNDO.md))
  shows both as adjacent rows ("2PT — B", "Assist — A"), so the two-step unwind is **visible
  and unambiguous** — which is exactly why we no longer need linked-undo machinery.
- **No reducer / `types.ts` change.** (Earlier drafts proposed a linked `ADD_SHOT`
  + `assistPlayerId`; that's dropped in favor of F12's visibility. F5–F11 remain
  reducer-free.)
- *Optional cosmetic:* F12 may **display** a shot+assist pair grouped (e.g. "2PT — B
  (assist: A)") while still undoing per-row; this is an F12 presentation choice, not an F7
  data change.

### 2.4 Does the assist change the active player?

**No.** The shooter remains active; crediting the assister does **not** call
`SET_ACTIVE_PLAYER`.

### 2.5 File structure

| File | Change |
|------|--------|
| `src/components/shot-chart/CourtEventPopup.tsx` | **Modify** — after Made, show the optional assister picker (reuse F6's picker, filtered to same-side non-shooter players). On pick, dispatch `ADD_SHOT` (shooter) then `INCREMENT_STAT(assistPlayerId, 'ast')`; on skip, just `ADD_SHOT`. |
| `src/components/shot-chart/ShotChartPanel.tsx` | **Modify** — after receiving a made-shot event with `assistPlayerId`, dispatch `ADD_SHOT` then `INCREMENT_STAT(ast)`. |
| `src/lib/assistCandidates.ts` | **Create** — pure same-side, non-shooter assist candidate helper (+ unit test). |

No `types.ts` / `GameContext` reducer change.

## 3. Implementation tasks (bite-sized)

### Task 1: Assister picker after Made

- [x] **Modify `CourtEventPopup.tsx`**: after the user taps **Made**, show the optional
  "Assisted by?" step — same-side players excluding the shooter (reuse F6's picker) plus a
  prominent **No assist** (default). Missed/secondary actions never show it.
- [x] On pick: dispatch `ADD_SHOT` (shooter) **then** `INCREMENT_STAT(assistPlayerId, 'ast')`.
  On skip: dispatch `ADD_SHOT` only (today's behavior).
- [x] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] Manual: Made by #23 → "Assisted by?" → pick #11 → #23 gets the made shot + marker, #11
  gets `+1 ast`; the recent-events list (F12) shows both rows; two undos revert assist then
  shot. Skip → only the shot is logged.

### Task 2 (polish): defaults & recent passers

- [ ] Surface a few **recent passers** first; keep "No assist" the easy default; ensure the
  step is fast to dismiss so it never slows made-shot logging when there's no assist.
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] **Commit:** `feat: assist picker polish (recent passers, fast skip)`

## 4. Testing

- **Build/lint:** `pnpm build`, `pnpm lint`.
- **Manual (GUI, `pnpm dev`, `#/game`):**
  - Made by #23 → assist to #11 → #23 made shot (+marker, +score), #11 `+1 ast`.
  - Recent-events popup (F12) shows "2PT — #23" and "Assist — #11"; undoing twice reverts
    both (assist first, then shot + marker).
  - Made → "No assist" → only the shot logged (no `ast`).
  - Missed / rebound / steal / block / standalone assist → **no** assist step appears.
  - Shooter never offered as their own assister.
  - Active player unchanged after logging.
  - Cloud sync: the assister's `ast` syncs like any stat.

## 5. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| "Undid once, shot's still there without its assist" confusion | **F12's recent-events popup** makes both rows visible, so the two-step unwind is clear; this is why linked undo is unnecessary. |
| Assist step slows made-shot logging | Optional with a prominent default "No assist"; one tap to skip. |
| Self-assist or wrong-side assist | Picker excludes the shooter and is scoped to same-side players (§2.2). |

## 6. Out of scope

- Multi-assist / hockey-style secondary assists.
- Editing the assist after logging (undo + re-log; F12 makes this visible).
- Assist on free throws or non-shot events.

## 7. Pre-handoff design decisions — RESOLVED

All F7 decisions are settled (signed off). **D1 changed**: F7 no longer alters the reducer —
it relies on **F12** for transparent two-step undo.

### A. Behavior

- **D1 — [CHANGED] Undo model.** **Two independent entries** (no reducer change): `ADD_SHOT`
  then `INCREMENT_STAT(ast)`. Transparency comes from **F12's recent-events popup**, not from
  linked-undo machinery. (Supersedes the earlier "linked `ADD_SHOT` + `assistPlayerId`"
  proposal; F5–F11 stay reducer-free.)
- **D2 — Optional, default No-assist.** Shown only after **Made**; a prominent "No assist"
  skip; never forced.
- **D3 — Active player unchanged.** Crediting the assist does **not** change `activePlayerId`.
- **D4 — Assister list.** Same-side players **excluding the shooter** (no self-assist),
  ordered like the strip.
- **D5 — Opponent shots.** **Omit** the assist step for opponent (team pseudo-player) shots
  in v1.
- **D6 — Acceptance.** Made→assist credits both; F12 shows both rows; two-step undo reverts
  each; skip logs only the shot; step appears only after Made; no self-assist; active player
  unchanged; assist syncs as a normal stat.

### B. Explicitly out of F7
Secondary/multi-assists; post-log assist editing; assists on FTs/non-shots. **F7 no longer
touches the reducer** — assist is a plain `INCREMENT_STAT`.
