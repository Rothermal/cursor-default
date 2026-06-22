# Feature 2 Plan: Per-Player Shot Tracker + Team Views

> **For agentic workers:** Design + implementation plan. Steps use checkbox (`- [ ]`)
> syntax. See [DESIGN_SHOT_TRACKER_UI_REVAMP.md](DESIGN_SHOT_TRACKER_UI_REVAMP.md) for
> shared context. Depends on **F1** ([PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md](PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md))
> for the inline court (`ShotChartPanel`), the `CourtEventPopup`, and the sticky
> `PlayerSelectorStrip`. After F1 the court lives **inline in the single-page Game
> Tracker** (not a tab); F2's filtering applies to that inline court and to the Game
> Summary chart.

> **Reconciled with the F1 pivot (read this):** Recording now happens through the
> **`CourtEventPopup`**, which **explicitly shows and confirms the attributed player**
> (and F6 will let you switch it). Two consequences for F2:
> 1. **Recording is allowed in every view, including "All"** — a court tap opens the popup
>    for the active player, so there is no "silent mis-attribution" risk. (This **reverses**
>    the earlier "All is review-only / disable taps" idea.)
> 2. The **view filter** (what's displayed) and the **active/recording player** (who the
>    popup logs to) are clearly separable; selecting a chip sets both (coupled), but "All"
>    changes only the display, not the recording target. See §8 D3/D5/D14.

**Goal:** When a player is selected, the inline shot chart shows **only that player's
shots**; when a team (home/opponent) is selected, it shows **all tracked shots for every
player on that side**. A whole-game **"All shots"** view is always available, and recording
remains possible in any view.

**Architecture:** Add one pure helper, `shotsForSelection()`, mapping the current view
selection (individual player id, team side, or "all") to the displayed `ShotRecord[]`.
The inline `ShotChartPanel`, its zone summary, and the Game Summary chart tab all consume
it. No schema change — `ShotRecord.playerId` already exists; team side is derived.

**Tech Stack:** React 18 + TypeScript, Vitest for the helper. No new dependencies.

---

## 1. Problem & current state

`ShotRecord.playerId` is recorded per shot, but **display never filters**:

- `BasketballCourt` (in the inline panel and the `GameSummary` "Shot chart" tab) renders
  the *entire* `shotChart` array, merged across players.
- The player-selector strip controls **which player a new event is attributed to**
  (`SET_ACTIVE_PLAYER` → `activePlayerId`), but selecting a player does **not** change
  what's shown.
- Team pseudo-players (`__team_home__`, `__team_opp__`) can be the active recorder, but
  there's no concept of "show everyone on the home team."

Deferred in the shipped design: [completed/DESIGN_SHOT_CHART.md](completed/DESIGN_SHOT_CHART.md)
§2.2 ("v2: Per-Player Shot Charts") and §8.2 ("Per-Player Filtering (v2)").

## 2. Team model & the side-derivation rule

StatKeeper tracks **one home roster of individuals** plus a **single opponent
pseudo-player** (no opponent roster). Team pseudo-players carry
`teamSide: 'home' | 'opponent'`; individual roster players carry no `teamSide`.

**Rule — `sideOf(player)`** (no migration, no `Player` change):

```ts
function sideOf(player: Player): 'home' | 'opponent' {
  if (isTeamPseudoPlayer(player)) return player.teamSide ?? 'home'
  return 'home'   // individual roster players are always the home side
}
```

So:
- **Home team view** = every shot whose `playerId` is a home-side player (all individual
  roster players **plus** `__team_home__` if shots were recorded against it).
- **Opponent team view** = shots whose `playerId` is `__team_opp__`.
- **Individual view** = exactly that player's shots.

## 3. Design

### 3.1 Selection model

```ts
type ShotChartSelection =
  | { kind: 'all' }
  | { kind: 'player'; playerId: string }   // individual OR a team pseudo-player id
```

`kind: 'player'` with a **team pseudo-player id** → show that whole side; with an
**individual id** → show just that player. The sticky `PlayerSelectorStrip` (team
pseudo-players first, then individuals, plus a leading **"All"** chip) is the control.

```ts
// src/lib/shotChartViews.ts
export function shotsForSelection(
  shots: ShotRecord[],
  players: Player[],
  selection: ShotChartSelection
): ShotRecord[] {
  if (selection.kind === 'all') return shots
  const target = players.find(p => p.id === selection.playerId)
  if (!target) return shots                 // defensive: unknown id → show all
  if (isTeamPseudoPlayer(target)) {
    const side = sideOf(target)
    const sideIds = new Set(players.filter(p => sideOf(p) === side).map(p => p.id))
    return shots.filter(s => sideIds.has(s.playerId))
  }
  return shots.filter(s => s.playerId === selection.playerId)
}
```

Pure and unit-tested. `sideOf` and `ShotChartSelection` live in the same module.

### 3.2 View filter vs. recording target (post-F1)

F1 separates *display* from *recording* cleanly:

- **Recording target** = `activePlayerId` (global, `GameState`). A court tap opens
  `CourtEventPopup`, which shows that player (`#23 Jordan`) and logs the chosen event to
  them. **This works in any view, including "All"** — the popup confirms attribution, so
  there's no silent mis-attribution. (F6 adds in-popup switching.)
- **View filter** = `ShotChartSelection`, controlling which markers the inline court and
  `ShootingSummary` display.
- **Coupling:** selecting an individual/team chip sets **both** the recording target
  (`SET_ACTIVE_PLAYER`) and the view filter to that chip. Selecting **"All"** changes only
  the **display**; `activePlayerId` is unchanged, so a tap in All view still records to the
  last active player (shown in the popup). See §8 D2–D5.

Examples:
- Select **#23** → record to #23, see only #23's shots.
- Select **★ Rebels (home)** → record to the home pseudo-player, see the home side union.
- Select **★ Brawlers (opp)** → record/show opponent shots.
- Select **All** → see every shot; a court tap still logs to whoever was active (popup confirms).

### 3.3 Context label

Above the court, show the current view + its shooting line (always visible on the single page):

```
Shot chart — #23 Michael Jordan        7/15 (47%)
Shot chart — Rebels (team)            22/48 (46%)
Shot chart — All shots                31/70 (44%)
```

`ShootingSummary` aggregates whatever filtered subset it's given, so zone numbers update automatically.

### 3.4 Empty states

- Individual with no shots: court shows the interactive empty hint ("Tap the court to
  record shots"); read-only surfaces show "No shots for {name}."
- Team view with no shots: "No shots recorded for {team} yet."

### 3.5 Marker styling (v1 vs follow-up)

v1 keeps uniform made(green)/missed(red) markers in every view. **Per-player color-coding
+ legend** in team views is a follow-up (umbrella Q3) — adds a color scale + legend, no
data change.

### 3.6 File structure

| File | Change |
|------|--------|
| `src/lib/shotChartViews.ts` | **Create** — `ShotChartSelection`, `sideOf`, `shotsForSelection`. |
| `src/lib/shotChartViews.test.ts` | **Create** — Vitest unit tests (individual, home union, opponent, all, unknown id). |
| `src/components/shot-chart/ShotChartPanel.tsx` | **Modify** — consume the view `selection`; pass `shotsForSelection(...)` to `BasketballCourt` and `ShootingSummary`; add the context label + empty states. (No made/missed toggle — F1 removed it.) |
| `src/components/PlayerSelectorStrip.tsx` | **Modify** — optional leading **"All"** chip (`onSelectAll`, `allActive`). |
| `src/pages/GameTracker.tsx` | **Modify** — owns the view-filter state (`showAll`) and passes the derived `selection` to `ShotChartPanel`; the sticky strip's "All" chip toggles it. |
| `src/pages/GameSummary.tsx` | **Modify** — the "Shot chart" tab gains the same selector + filtering (read-only strip, no recording). |

### 3.7 Why a shared helper (DRY)

F1's inline panel, the Game Summary tab, and F3's cloud review all need identical
filtering. One tested pure function prevents three subtly different implementations
(a classic source of "opponent shots leak into the home view" bugs).

## 4. Implementation tasks (bite-sized)

### Task 1: View helper + tests (TDD)

- [ ] **Create `src/lib/shotChartViews.test.ts`** with cases:
  - `all` → returns the input array unchanged.
  - individual id → only that player's shots.
  - `__team_home__` → union of all individual roster players + home pseudo shots,
    **excluding** opponent shots.
  - `__team_opp__` → only opponent pseudo shots.
  - unknown id → returns all (defensive).
  - `sideOf`: individual → `'home'`; home pseudo → `'home'`; opp pseudo → `'opponent'`.
- [ ] Run `pnpm test src/lib/shotChartViews.test.ts`. Expected: FAIL (module missing).
- [ ] **Create `src/lib/shotChartViews.ts`** implementing `ShotChartSelection`, `sideOf`,
  `shotsForSelection` exactly as in §2/§3.1 (import `isTeamPseudoPlayer` from
  `src/lib/teamPlayers.ts`).
- [ ] Run the test. Expected: PASS.
- [ ] **Commit:** `feat: add shotChartViews helper for per-player/team shot filtering`

### Task 2: "All" chip in the sticky selector strip

- [ ] **Modify `src/components/PlayerSelectorStrip.tsx`**: add optional props
  `onSelectAll?: () => void` and `allActive?: boolean`. When `onSelectAll` is set, render a
  leading "All" chip (active styling when `allActive`). Selecting a player chip clears the
  all state via `onSelect`.
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass; the tracker strip is unaffected when
  `onSelectAll` is omitted.
- [ ] **Commit:** `feat: add optional All chip to PlayerSelectorStrip`

### Task 3: Filter the inline court (F1's `ShotChartPanel`)

- [ ] **Modify `GameTracker.tsx`**: add local `const [showAll, setShowAll] = useState(false)`
  (the view-filter state). Derive `selection = showAll ? { kind: 'all' } :
  { kind: 'player', playerId: activePlayerId }`. Pass `selection` to `ShotChartPanel`.
- [ ] Wire the sticky `PlayerSelectorStrip`: `onSelectAll={() => setShowAll(true)}`,
  `allActive={showAll}`, `onSelect={id => { setShowAll(false); dispatch SET_ACTIVE_PLAYER }}`.
- [ ] **Modify `ShotChartPanel.tsx`**: compute `visibleShots = shotsForSelection(shotChart,
  players, selection)` and pass it to `BasketballCourt` and `ShootingSummary`. **Do not**
  disable court taps in any view — a tap always opens `CourtEventPopup` for `activePlayerId`.
- [ ] Add the context label (§3.3) and empty states (§3.4).
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] **Commit:** `feat: filter inline shot chart by selected player or team`

### Task 4: Filter the Game Summary shot chart tab

- [ ] **Modify `src/pages/GameSummary.tsx`**: in the `summaryTab === 'shot_chart'` block,
  add a read-only `PlayerSelectorStrip` (no `onAddPlayer`) + "All" chip with local
  `selection` state; pass `shotsForSelection(shotChart, players, selection)` to
  `BasketballCourt` and `ShootingSummary`.
- [ ] Default selection = `{ kind: 'all' }` for the summary (whole-game review).
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] Manual: open a game with shots from 2+ players → Summary → Shot chart → switch chips →
  chart + zone numbers filter correctly; "All" shows everything.
- [ ] **Commit:** `feat: per-player/team filtering in Game Summary shot chart`

## 5. Testing

- **Unit:** `pnpm test src/lib/shotChartViews.test.ts`.
- **Build/lint:** `pnpm build`, `pnpm lint`.
- **Manual (GUI, `pnpm dev`, `#/game`):**
  - Record (via the court popup) shots for #23, #11, and the opponent pseudo-player.
  - Select **#23** → only #23's markers + #23 zone summary.
  - Select **#11** → only #11's markers.
  - Select **★ home team** → #23 + #11 (+ home-team) merged; **no** opponent markers.
  - Select **★ opponent** → only opponent markers.
  - Tap **All** → every marker; a court tap still opens the popup for the last active
    player (confirmed in the popup header) and the new shot appears.
  - Empty player → empty-state copy.
  - Repeat the filter checks on the **Game Summary** shot chart tab.

## 6. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Opponent shots leaking into the home view (or vice versa) | Single tested helper with explicit side-union tests; surfaces never filter inline. |
| "What I'm viewing" vs "who I'm recording" confusion | The `CourtEventPopup` header always names the recording player (and F6 lets you switch), so attribution is explicit even in "All" view. |
| Team chip means record-to-team **and** show side union | Intended; documented in the context label/help. Revisit a record-vs-view split only if users ask. |
| Future opponent roster | `sideOf`/`shotsForSelection` already generalize via `teamSide`. |

## 7. Out of scope (other plans / follow-ups)

- Cloud / multi-recorder aggregation (→ **F3**).
- Per-player marker colors + legend (follow-up; data-ready).
- Per-player breakdown panel in team view (follow-up).
- Season/career heatmaps ([completed/DESIGN_SHOT_CHART.md](completed/DESIGN_SHOT_CHART.md) §2.3).

## 8. Pre-handoff design decisions (resolve before build)

Each has a **recommended default** + `Decision:`. Items marked **[CHANGED]** or **[NEW]**
arise from the F1 court-capture pivot. F2 now **owns** the selection/contract decisions
(the rewritten F1 enumerates only its own D1–D10 and no longer carries the old "D12–D14"
component contracts).

### A. Selection model & recording

- **D1 — Default view on page open.** Active player's filtered view vs. "All". The court is
  always visible inline now, so the default determines what you first see.
  - _Recommended:_ default to the **active chip's view** (individual → that player; team
    pseudo → that side); "All" only when there's no active player.
  - _Decision:_ ____

- **D2 — [NEW] View-filter ↔ active-player coupling.** Does selecting a chip set **both**
  the recording target (`activePlayerId`) and the displayed filter?
  - _Recommended:_ **coupled** — one chip controls both (simplest mental model; the popup
    still confirms attribution at log time).
  - _Decision:_ ____

- **D3 — [CHANGED] Recording while "All" is selected.** Previously "review-only / disable
  taps." With the popup confirming the player, recording is now safe in any view.
  - _Recommended:_ **allow recording in "All"** — a court tap opens `CourtEventPopup` for
    `activePlayerId` (shown/confirmable; F6 can switch). "All" changes only the display.
  - _Decision:_ ____

- **D4 — "All" affordance placement.** Leading chip in the sticky `PlayerSelectorStrip` vs.
  a separate control.
  - _Recommended:_ leading **"All"** chip in the sticky strip.
  - _Decision:_ ____

- **D5 — Does selecting "All" change `activePlayerId`?**
  - _Recommended:_ **no** — "All" is a display overlay; the last active player stays the
    recording target so a tap-to-log still works.
  - _Decision:_ ____

- **D6 — Team-chip dual semantics.** A team chip **records to that pseudo-player** and
  **shows that side's union**. (Umbrella Q2.)
  - _Recommended:_ combined.
  - _Decision:_ ____

### B. Visual treatment

- **D7 — Per-player marker colors in team views.** (Umbrella Q3.)
  - _Recommended:_ v1 uniform made/miss; per-player color + legend is a follow-up.
  - _Decision:_ ____

- **D8 — Context label format.** `Shot chart — {label}  made/att (FG%)` as in §3.3.
  - _Recommended:_ as stated.
  - _Decision:_ ____

- **D9 — Per-player breakdown in team view** (small list alongside the merged court).
  - _Recommended:_ v1 no — merged court + aggregate summary only; breakdown is a follow-up.
  - _Decision:_ ____

- **D10 — Empty-state copy** (individual / team / all) per §3.4.
  - _Recommended:_ as stated.
  - _Decision:_ ____

### C. Consistency across surfaces

- **D11 — Any game-level shot-count indicator** (e.g. a small total near the court) reflects
  the **whole-game** total, while `ShootingSummary` reflects the **filtered** view.
  - _Recommended:_ as stated (avoid a count that silently changes with the filter).
  - _Decision:_ ____

- **D12 — Game Summary default selection.** Defaults to "All" for whole-game review.
  - _Recommended:_ "All" in the summary.
  - _Decision:_ ____

### D. Component contract & data edges

- **D13 — `ShotChartSelection` shape.** `{ kind: 'all' } | { kind: 'player'; playerId }`,
  where a team chip is `{ kind: 'player'; playerId: '__team_home__' | '__team_opp__' }`.
  - _Recommended:_ as stated.
  - _Decision:_ ____

- **D14 — [CHANGED] Recording target derivation.** The recording target is **always
  `activePlayerId`** (the popup logs to it), **independent of the view filter** — including
  in "All" (no longer `null`/disabled). Selecting an individual/team chip updates
  `activePlayerId`; selecting "All" leaves it unchanged.
  - _Recommended:_ as stated.
  - _Decision:_ ____

- **D15 — Orphan shots (playerId not on the current roster).** Excluded from individual/team
  views (no id match); appear only under "All". (`rosterAlignment` already strips them
  locally on `SET_PLAYERS`; cloud/summary data may still contain them.)
  - _Recommended:_ accept "orphans show only in All"; no special-casing in v1.
  - _Decision:_ ____

- **D16 — [NEW] State ownership / component contract** (replaces the stale "F1 D12–D14"
  dependency). `activePlayerId` is **global** (`GameState`, via `SET_ACTIVE_PLAYER`); the
  view filter (`showAll` → `selection`) is **local UI state in `GameTracker`**, not
  persisted; `ShotChartPanel` receives the derived `selection` and (for F3) optional
  `shotsOverride` / `readOnly`.
  - _Recommended:_ as stated.
  - _Decision:_ ____

- **D17 — Selection persistence.** View filter is local UI state; not persisted to
  `GameState`/cloud; re-derives from `activePlayerId` on load (no Stats/Chart tab exists —
  the page is single-scroll per F1 D1).
  - _Recommended:_ as stated.
  - _Decision:_ ____

### E. Acceptance criteria & regression

- **D18 — Acceptance criteria.** "Selecting an individual shows only their markers and
  zone%; selecting a team shows that side's union and **never** the other side; 'All' shows
  every shot **and still records** to the active player via the popup; selecting a chip
  updates both the view and the recording target; the Game Summary chart tab filters
  identically."
  - _Decision (add/adjust):_ ____

- **D19 — Unit + manual coverage.** Unit: the `shotsForSelection`/`sideOf` matrix (Task 1).
  Manual: the multi-player matrix in §5 on both the tracker and the summary.
  - _Decision (add/adjust):_ ____

### F. Explicitly out of F2
Cloud/multi-recorder aggregation (**F3**); per-player marker colors + legend; per-player
breakdown panel; season/career heatmaps. D13–D17 must stay consistent with F3's review path
(which supplies a different source array — `shotsOverride` — but the **same** `selection`).
