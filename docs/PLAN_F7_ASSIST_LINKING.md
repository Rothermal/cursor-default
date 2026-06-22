# Feature 7 Plan: Assist-Linking on a Made Shot

> **For agentic workers:** Design + implementation plan. Steps use checkbox (`- [ ]`)
> syntax. See [DESIGN_SHOT_TRACKER_UI_REVAMP.md](DESIGN_SHOT_TRACKER_UI_REVAMP.md) and the
> [enhancements roadmap](PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md). **Depends on F1**
> ([PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md](PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md)); pairs
> with **F6** (player picker reuse).

**Goal:** After logging a **Made** shot in the court popup, optionally credit the assisting
teammate in the same gesture — assists are almost always tied to a made FG, so this saves a
separate court tap and keeps the two events linked.

**Architecture:** After **Made**, `CourtEventPopup` offers an optional "Assisted by …"
picker (skippable). Choosing a teammate credits `ast` to them **in addition** to the
shooter's made shot. The **undo model is the key design choice** (§2.3): v1 links the shot
and its assist so a single Undo reverts both.

**Tech Stack:** React + TypeScript, reuse `sortTeamPlayersFirst`/F6 picker. A small,
**local** reducer/action change for linked undo (no cloud schema change).

---

## 1. Problem & current state (post-F1)

After F1, a made shot is logged via the court popup → `ADD_SHOT` (which increments the
shooter's `2pt`/`3pt`). Crediting the assist today means a **separate** action: select the
passer in the strip and tap the `AST` grid button. F7 folds the assist into the made-shot
flow: one popup interaction logs the basket and (optionally) its assist.

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

- The assist step appears **only after Made** (never after Missed, rebound, steal, block,
  or a standalone assist).
- It is **optional**: a prominent "No assist" / skip dismisses it; default is **no assist**
  (don't force a choice).
- Picking a teammate credits `ast` to them; the shooter's made shot is unchanged.

### 2.2 Who can be the assister

- The assister list = **same-side players, excluding the shooter** (you can't assist your
  own basket). For a home individual shooter, that's the other home individuals (and,
  optionally, the home team pseudo-player). For an opponent (team pseudo-player) shot,
  assists are rarely tracked; v1 may show just the opponent pseudo-player or omit the step
  for opponent shots (see §7 D5).
- The shooter is never in the list (no self-assist).

### 2.3 Undo model — the key decision

A made shot **with** an assist produces two stat changes: the shooter's `2pt`/`3pt`
(+ marker, via `ADD_SHOT`) and the assister's `ast` (via `INCREMENT_STAT`). How should
**Undo** treat them?

| Option | Behavior | Pros | Cons |
|--------|----------|------|------|
| A. Two independent log entries | one Undo removes the assist, a second removes the shot+marker | No reducer change; matches today's per-action undo | "Undid once, shot's still there without its assist" can confuse |
| **B. Linked (one Undo reverts both)** | the shot and its assist are linked; a single Undo reverts the shot+marker **and** the assist | Intuitive — they were logged as one action | Small **local** reducer/action change |

**Recommended: B (linked undo).** Implement by extending the **`ADD_SHOT`** action with an
optional `assistPlayerId`; the reducer then (a) appends the shot + increments the shooter's
shot stat (as today), (b) increments the assister's `ast`, and (c) records the assist on the
**same** shot-linked log entry (e.g. an optional `assistPlayerId` + `assistPreviousValue` on
the `ActionLogEntry`, or a shared `groupId`) so `applyUndoLastEntry` reverts both together.

> **Cross-cutting note:** The umbrella says "no data-model changes in F1 + F5–F11." F7 is
> the **one exception**, and only **locally**: it adds an optional `assistPlayerId` to the
> `ADD_SHOT` action and an optional field on `ActionLogEntry` for linked undo. **No cloud
> schema change** — the assist is just another `game_stats` `ast` increment, synced exactly
> like any stat.

### 2.4 Does the assist change the active player?

**No.** The shooter remains the active player; crediting the assister does **not** call
`SET_ACTIVE_PLAYER`. (Contrast F6, where switching is explicit.) After logging, the active
player and view filter are unchanged.

### 2.5 File structure

| File | Change |
|------|--------|
| `src/components/shot-chart/CourtEventPopup.tsx` | **Modify** — after Made, show the optional assister picker (reuse F6's picker, filtered to same-side non-shooter players); pass the chosen `assistPlayerId` (or none) into the `ADD_SHOT` dispatch. |
| `src/types.ts` | **Modify** — `ADD_SHOT` action gains optional `assistPlayerId`; `ActionLogEntry` gains optional assist-link fields. |
| `src/context/GameContext.tsx` | **Modify** — `ADD_SHOT` reducer increments the assister's `ast` and links it for undo; `applyUndoLastEntry` reverts the linked assist with the shot. |
| `src/context/GameContext` undo tests (or a new test) | **Create/Modify** — cover linked undo. |

## 3. Implementation tasks (bite-sized)

### Task 1: Linked-undo reducer support (TDD)

- [ ] **Write/extend a reducer test:** dispatch `ADD_SHOT` with `assistPlayerId` →
  shooter's `2pt`/`3pt` +1, assister's `ast` +1, one log entry; `UNDO` reverts **both** and
  removes the marker; `ADD_SHOT` **without** `assistPlayerId` behaves exactly as today.
- [ ] Run the test. Expected: FAIL.
- [ ] **Modify `types.ts`**: add optional `assistPlayerId?: string` to the `ADD_SHOT` action;
  add optional `assistPlayerId?: string` + `assistPreviousValue?: number` to `ActionLogEntry`.
- [ ] **Modify `GameContext.tsx`**: in `ADD_SHOT`, when `assistPlayerId` is set and valid
  (a different player on the roster), increment that player's `ast`, store the link on the
  log entry; in `applyUndoLastEntry`, when the entry has an assist link, restore the
  assister's `ast` alongside the shot revert.
- [ ] Run the test. Expected: PASS.
- [ ] **Commit:** `feat: linked assist on ADD_SHOT with combined undo`

### Task 2: Assister picker after Made

- [ ] **Modify `CourtEventPopup.tsx`**: after the user taps **Made**, show the optional
  "Assisted by?" step — same-side players excluding the shooter (reuse F6's picker), plus a
  prominent **No assist** (default). Missed/secondary actions never show it.
- [ ] On pick: dispatch `ADD_SHOT` with `assistPlayerId`; on skip: dispatch `ADD_SHOT`
  without it (today's behavior).
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] Manual: Made by #23 → "Assisted by?" → pick #11 → #23 gets the made shot + marker, #11
  gets `+1 ast`; Undo reverts both and removes the marker. Skip → only the shot is logged.
- [ ] **Commit:** `feat: optional assist-linking after a made shot in the court popup`

### Task 3 (polish): defaults & recent passers

- [ ] Surface a few **recent passers** first / keep "No assist" as the easy default; ensure
  the step is fast to dismiss (it must not slow down made-shot logging when no assist).
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] **Commit:** `feat: assist picker polish (recent passers, fast skip)`

## 4. Testing

- **Unit:** reducer linked-undo test (Task 1).
- **Build/lint:** `pnpm build`, `pnpm lint`.
- **Manual (GUI, `pnpm dev`, `#/game`):**
  - Made by #23 → assist to #11 → #23 made shot (+marker, +score), #11 `+1 ast`.
  - **One Undo** reverts the shot **and** the assist; the marker disappears; both stats revert.
  - Made → "No assist" → only the shot logged (no `ast`).
  - Missed / rebound / steal / block / standalone assist → **no** assist step appears.
  - Shooter is never offered as their own assister.
  - Active player unchanged after logging (contrast F6).
  - Cloud sync: the assister's `ast` syncs like any stat (no schema change).

## 5. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Confusing partial undo (shot without its assist) | Linked undo (Option B) reverts both as one step (§2.3). |
| Assist step slows down made-shot logging | Optional with a prominent default "No assist"; one tap to skip. |
| Self-assist or wrong-side assist | Picker excludes the shooter and is scoped to same-side players (§2.2). |
| Reducer change ripples to persistence | Only **local** action/log fields; no cloud schema change — assist is a normal `ast` increment. Verify localStorage round-trip and sync. |

## 6. Out of scope

- Multi-assist / hockey-style secondary assists.
- Editing the assist after logging (undo + re-log).
- Assist on free throws or non-shot events.

## 7. Pre-handoff design decisions (resolve before build)

Each has a recommended default + `Decision:`. **D1 (undo model) is the consequential one.**

### A. Behavior

- **D1 — Undo model.** Two independent steps vs. **linked (one Undo reverts shot + assist)**.
  - _Recommended:_ **B, linked undo** — intuitive (they were one action). Accepts a small
    **local** reducer/action change (optional `assistPlayerId` on `ADD_SHOT` + a link field
    on `ActionLogEntry`); **no cloud schema change**.
  - _Alternative:_ A, two independent steps (no reducer change, but partial-undo can confuse).
  - _Decision:_ ____

- **D2 — Assist step is optional, default No-assist.** Shown only after **Made**; a
  prominent "No assist" skip; never forced.
  - _Recommended:_ as stated.
  - _Decision:_ ____

- **D3 — Active player unchanged.** Crediting the assist does **not** change `activePlayerId`
  (the shooter stays active).
  - _Recommended:_ as stated.
  - _Decision:_ ____

- **D4 — Assister list.** Same-side players **excluding the shooter** (no self-assist),
  ordered like the strip.
  - _Recommended:_ as stated.
  - _Decision:_ ____

- **D5 — Opponent shots.** Show the assist step for opponent (team pseudo-player) shots?
  - _Recommended:_ **omit** the assist step for opponent shots in v1 (no opponent roster to
    credit; the lone opponent pseudo-player as "assister" adds little). Revisit if needed.
  - _Decision:_ ____

### B. Acceptance & tests

- **D6 — Acceptance.** Made→assist credits both; single Undo reverts both + marker; skip
  logs only the shot; step appears only after Made; no self-assist; active player unchanged;
  assist syncs as a normal stat.
  - _Decision (add/adjust):_ ____

### C. Explicitly out of F7
Secondary/multi-assists; post-log assist editing; assists on FTs/non-shots. F7 is the **one**
feature in F5–F11 that touches the reducer (locally, for linked undo) — keep that change
minimal and behind the optional `assistPlayerId`.
