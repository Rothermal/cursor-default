# Feature 2 Plan: Per-Player Shot Tracker + Team Views

> **For agentic workers:** Design + implementation plan. Steps use checkbox (`- [ ]`)
> syntax. See [DESIGN_SHOT_TRACKER_UI_REVAMP.md](DESIGN_SHOT_TRACKER_UI_REVAMP.md) for
> shared context. Depends on **F1** ([PLAN_F1_SHOT_CHART_IN_TRACKER_TAB.md](PLAN_F1_SHOT_CHART_IN_TRACKER_TAB.md))
> for the extracted `ShotChartPanel` + `PlayerSelectorStrip` and the component/state
> contracts (F1 §7 D12–D14).

**Goal:** When a player is selected, the shot chart shows **only that player's shots**;
when a team (home/opponent) is selected, the chart shows **all tracked shots for every
player on that side**. A whole-game ("All shots") view remains available.

**Architecture:** Add one pure helper, `shotsForSelection()`, that maps the current
selection (individual player id, team side, or "all") to the subset of `ShotRecord[]`
to display. The shot panel, the chart's zone summary, and the Game Summary chart tab all
consume it. No schema change — `ShotRecord.playerId` already exists; team side is derived.

**Tech Stack:** React 18 + TypeScript, Vitest for the helper. No new dependencies.

---

## 1. Problem & current state

`ShotRecord.playerId` is recorded per shot, but **display never filters**:

- `ShotChart.tsx` and the `GameSummary` "Shot chart" tab both render
  `<BasketballCourt shots={shotChart} />` — the entire game's shots, merged.
- The player-selector strip controls **which player a new shot is attributed to**
  (`SET_ACTIVE_PLAYER` → `effectivePlayerId`), but selecting a player does **not**
  change what's shown.
- Team pseudo-players (`__team_home__`, `__team_opp__`) appear in the strip and can be
  the active "shooter," but there's no concept of "show everyone on the home team."

The shipped design explicitly deferred this: see
[completed/DESIGN_SHOT_CHART.md](completed/DESIGN_SHOT_CHART.md) §2.2 ("v2: Per-Player
Shot Charts") and §8.2 ("Per-Player Filtering (v2)").

## 2. Team model & the side-derivation rule

StatKeeper tracks **one home roster of individuals** plus a **single opponent
pseudo-player** (there is no opponent roster). Team pseudo-players carry
`teamSide: 'home' | 'opponent'`; individual roster players carry no `teamSide`.

**Rule — `sideOf(player)`** (no migration, no `Player` change):

```ts
function sideOf(player: Player): 'home' | 'opponent' {
  if (isTeamPseudoPlayer(player)) return player.teamSide ?? 'home'
  return 'home'   // individual roster players are always the home side
}
```

So:
- **Home team view** = every shot whose `playerId` belongs to a home-side player
  (all individual roster players **plus** `__team_home__` if any shots were recorded
  against the home pseudo-player).
- **Opponent team view** = every shot whose `playerId` is the opponent pseudo-player
  (`__team_opp__`). (Could grow if opponent individuals are ever added — the rule
  already generalizes.)
- **Individual view** = exactly that player's shots.

## 3. Design

### 3.1 Selection model

Introduce a `ShotChartSelection`:

```ts
type ShotChartSelection =
  | { kind: 'all' }
  | { kind: 'player'; playerId: string }   // individual OR a team pseudo-player id
```

`kind: 'player'` with a **team pseudo-player id** means "show that whole side."
`kind: 'player'` with an **individual id** means "show just that player." This keeps
the existing strip (which already lists team pseudo-players first, then individuals)
as the primary control — selecting a chip filters the chart.

The view helper:

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
    const sideIds = new Set(
      players.filter(p => sideOf(p) === side).map(p => p.id)
    )
    return shots.filter(s => sideIds.has(s.playerId))
  }
  return shots.filter(s => s.playerId === selection.playerId)
}
```

`sideOf` and `ShotChartSelection` live in the same module. The helper is pure and unit-tested.

### 3.2 How the selection ties to the active player

- **Recording** still uses `activePlayerId` (`effectivePlayerId`) — unchanged. Tapping
  the court attributes the shot to the currently selected chip.
- **Display** uses the same selection: the chart shows the subset for the selected chip.
  - Select **#23** → record shots for #23, see only #23's shots.
  - Select **★ Rebels (home)** → record shots for the home team pseudo-player, see
    **all home players' + home-team** shots (the merged team view).
  - Select **★ Brawlers (opp)** → record/show opponent shots.
- Add a small **"All shots"** toggle/chip (at the start of the strip or as a header
  control) for the whole-game view. This is `selection = { kind: 'all' }` and is the
  current behavior. Default selection when opening the chart = the current
  `activePlayerId` (or "All" if none) — see §8.

### 3.3 Header / context label

Above the court, show what's being displayed and a per-selection record line, e.g.:

```
Shot chart — #23 Michael Jordan        7/15 (47%)
Shot chart — Rebels (team)            22/48 (46%)
Shot chart — All shots                31/70 (44%)
```

`ShootingSummary` already aggregates any `shots` array, so it just receives the
filtered subset and the zone breakdown updates automatically.

### 3.4 Empty states

- Individual with no shots: court shows the interactive empty hint ("Tap the court to
  record shots") when interactive; read-only surfaces show "No shots for {name}."
- Team view with no shots: "No shots recorded for {team} yet."

### 3.5 Marker styling (v1 vs follow-up)

v1 keeps the current uniform made(green)/missed(red) markers in every view. **Per-player
color-coding + legend** in team views is a documented follow-up (Q3 in the umbrella doc);
it adds a color scale and legend but no data change. Not in v1 scope to keep the diff small.

### 3.6 File structure

| File | Change |
|------|--------|
| `src/lib/shotChartViews.ts` | **Create** — `ShotChartSelection`, `sideOf`, `shotsForSelection`. |
| `src/lib/shotChartViews.test.ts` | **Create** — Vitest unit tests (individual, home union, opponent, all, unknown id). |
| `src/components/shot-chart/ShotChartPanel.tsx` | **Modify** — derive `selection` from the active chip + an "All" toggle; pass `shotsForSelection(...)` to `BasketballCourt` and `ShootingSummary`; add the context label. |
| `src/components/PlayerSelectorStrip.tsx` | **Modify** — optional leading **"All shots"** chip (`onSelectAll`, `allActive`) so the strip can express the `all` selection. |
| `src/pages/GameSummary.tsx` | **Modify** — the "Shot chart" tab gains the same selector + filtering (read-only strip, no recording). |

### 3.7 Why a shared helper (DRY)

F1's in-tab panel, the Game Summary tab, and F3's cloud review all need identical
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
- [ ] **Create `src/lib/shotChartViews.ts`** implementing `ShotChartSelection`,
  `sideOf`, `shotsForSelection` exactly as in §2/§3.1 (import `isTeamPseudoPlayer`
  from `src/lib/teamPlayers.ts`).
- [ ] Run `pnpm test src/lib/shotChartViews.test.ts`. Expected: PASS.
- [ ] **Commit:** `feat: add shotChartViews helper for per-player/team shot filtering`

### Task 2: "All shots" affordance in the selector strip

- [ ] **Modify `src/components/PlayerSelectorStrip.tsx`**: add optional props
  `onSelectAll?: () => void` and `allActive?: boolean`. When `onSelectAll` is set,
  render a leading "All" chip (active styling when `allActive`). Selecting a player
  chip clears the all state via the existing `onSelect`.
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass; existing tracker strip unaffected
  when `onSelectAll` is omitted.
- [ ] **Commit:** `feat: add optional All chip to PlayerSelectorStrip`

### Task 3: Filter the in-tracker chart panel (F1's `ShotChartPanel`)

- [ ] **Modify `ShotChartPanel.tsx`**: add local `const [showAll, setShowAll] = useState(false)`.
  Derive `selection`: `showAll ? { kind: 'all' } : { kind: 'player', playerId: effectivePlayerId }`.
- [ ] Compute `visibleShots = shotsForSelection(shotChart, players, selection)` and pass
  it to `BasketballCourt` and `ShootingSummary` (instead of raw `shotChart`).
- [ ] Render `PlayerSelectorStrip` with `onSelectAll={() => setShowAll(true)}`,
  `allActive={showAll}`, and `onSelect={id => { setShowAll(false); dispatch SET_ACTIVE_PLAYER }}`.
  (In F1 the strip is owned by `GameTracker`; coordinate the `showAll` state via a prop
  or lift it — see note below.)
- [ ] Add the context label line above the court (`Shot chart — {label}  M/A (%)`).
- [ ] Add the team/individual **empty states** (§3.4).
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] **Commit:** `feat: filter Game Tracker shot chart by selected player or team`

> **State-ownership note:** In F1, the player strip lives in `GameTracker` (shared by the
> Stats and Chart views). The cleanest wiring is to lift `showAll` into `GameTracker` and
> pass `selection` down to `ShotChartPanel`; the "All" chip then only renders while the
> Chart view is active. Document the chosen ownership in the PR. (See F1 §7 D14.)

### Task 4: Filter the Game Summary shot chart tab

- [ ] **Modify `src/pages/GameSummary.tsx`**: in the `summaryTab === 'shot_chart'` block
  (lines ~860–869), add a read-only `PlayerSelectorStrip` (no `onAddPlayer`) + "All" chip
  with local `selection` state, and pass `shotsForSelection(shotChart, players, selection)`
  to `BasketballCourt` and `ShootingSummary`.
- [ ] Default selection = `{ kind: 'all' }` for the summary (reviewing the whole game).
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] Manual: finalize/open a game with shots from 2+ players → Summary → Shot chart →
  switch chips → chart + zone numbers filter correctly; "All" shows everything.
- [ ] **Commit:** `feat: per-player/team filtering in Game Summary shot chart`

## 5. Testing

- **Unit:** `pnpm test src/lib/shotChartViews.test.ts` (the filtering matrix above).
- **Build/lint:** `pnpm build`, `pnpm lint`.
- **Manual (GUI, `pnpm dev`):**
  - Record shots for #23, #11, and the opponent pseudo-player.
  - Select **#23** → only #23's markers + #23 zone summary.
  - Select **#11** → only #11's markers.
  - Select **★ home team** → #23 + #11 (+ any home-team shots) merged; **no** opponent markers.
  - Select **★ opponent** → only opponent markers.
  - Tap **All** → every marker.
  - Recording while a chip is selected attributes the new shot to that chip and it
    appears immediately in that filtered view.
  - Empty player → empty-state copy.
  - Repeat the filter checks on the **Game Summary** shot chart tab.

## 6. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Opponent shots leaking into the home view (or vice versa) | Single tested helper with explicit side-union tests; surfaces never filter inline. |
| Confusion between "who I'm recording for" vs "what I'm viewing" | They're intentionally the same selection; the context label makes the current view explicit. |
| Selecting a team pseudo-player to *record* vs to *view all* is ambiguous | By design, both: a team chip records to the team pseudo-player **and** shows the side union. Documented in the label/help text. Revisit if users want record-vs-view split (follow-up). |
| Future opponent roster | `sideOf`/`shotsForSelection` already generalize via `teamSide`; no rework needed. |

## 7. Out of scope (other plans / follow-ups)

- Cloud / multi-recorder aggregation of shots (→ **F3**).
- Per-player marker colors + legend in team views (follow-up; data-ready).
- Season/career heatmaps across games ([completed/DESIGN_SHOT_CHART.md](completed/DESIGN_SHOT_CHART.md) §2.3).

## 8. Pre-handoff design decisions (resolve before build)

These are the decisions a build agent needs locked down for F2. Each has a **recommended
default**; fill in `Decision:` to confirm or override. Highest-leverage first: **D2
(recording target in "All" view), D1 (default selection), D3 ("All" affordance), D11–D13
(contract + recording-target derivation)** — they define the interaction model; the rest
are fill-in details. F2 builds on F1 §7 **D12–D14** (component contracts + state
ownership); those must already be decided.

### A. Selection model & recording target

- **D1 — Default selection when the chart opens.** Active player's filtered view vs. "All".
  Note: on a fresh game the active player is often a team pseudo-player (the strip lists
  them first), which would default to a team-side view.
  - _Recommended:_ default to the active chip's view (individual → that player; team
    pseudo → that side). Use "All" only when there is no active player.
  - _Decision:_ ____

- **D2 — Recording target while "All shots" is selected (key interaction).** "All" shows
  both teams, so there is no single shooter. When the court is tapped in All view, who owns
  the shot?
  - _Recommended:_ **All is review-only** — disable court taps in All view and show a hint
    ("Select a player or team to record"). The underlying `activePlayerId` is preserved, so
    re-selecting a chip resumes recording. (Avoids the "I tapped in the overview and it
    silently went to #23" trap.)
  - _Alternative:_ keep taps enabled and record to the still-active `activePlayerId`.
  - _Decision:_ ____

- **D3 — "All shots" affordance placement.** Leading chip in `PlayerSelectorStrip` vs. a
  separate toggle above the court.
  - _Recommended:_ leading **"All"** chip in the strip (one control surface; matches the
    `onSelectAll`/`allActive` props in Task 2).
  - _Decision:_ ____

- **D4 — Does selecting "All" change `activePlayerId`?** It's a view overlay, not a shooter.
  - _Recommended:_ no — leave `activePlayerId` as-is so toggling back resumes recording for
    the same player (pairs with D2).
  - _Decision:_ ____

- **D5 — Team-chip dual semantics.** Selecting a team pseudo-player both **records to that
  pseudo-player** and **shows that side's union**. (Umbrella Q2.)
  - _Recommended:_ combined (record-to-team + show side union). Revisit a record-vs-view
    split only if users ask.
  - _Decision:_ ____

### B. Visual treatment

- **D6 — Marker color-coding per player in team views.** (Umbrella Q3.)
  - _Recommended:_ v1 uniform made(green)/missed(red); per-player color + legend is a
    follow-up (data is already player-tagged).
  - _Decision:_ ____

- **D7 — Context label format above the court.** e.g. `Shot chart — #23 Michael Jordan
  7/15 (47%)` / `… Rebels (team) 22/48 (46%)` / `… All shots 31/70 (44%)`.
  - _Recommended:_ show selection label + made/attempts + FG% inline as above.
  - _Decision:_ ____

- **D8 — Per-player breakdown in team view.** In addition to the merged court +
  aggregate `ShootingSummary`, show a small per-player shot/FG% list?
  - _Recommended:_ v1 no — merged court + aggregate summary only; per-player breakdown is a
    follow-up.
  - _Decision:_ ____

- **D9 — Empty-state copy.** Individual: "No shots for {name}." (read-only) / interactive
  empty hint when recordable. Team: "No shots recorded for {team} yet." All: existing
  empty-court copy.
  - _Recommended:_ as stated.
  - _Decision:_ ____

### C. Consistency across surfaces

- **D10 — Shot-count badge on F1's "Shot Chart" segment label.** Does the badge reflect the
  **whole-game** total or the **currently filtered** count?
  - _Recommended:_ whole-game total (a stable game-level indicator), independent of the
    active filter.
  - _Decision:_ ____

- **D11 — Game Summary default selection.** The summary chart tab defaults to "All" for
  whole-game review (vs. mirroring the tracker's last selection).
  - _Recommended:_ "All" in the summary.
  - _Decision:_ ____

### D. Component contract & data edges (depends on F1 D12–D14)

- **D12 — `ShotChartSelection` shape.** `{ kind: 'all' } | { kind: 'player'; playerId }`,
  where a team chip is `{ kind: 'player'; playerId: '__team_home__' | '__team_opp__' }`.
  - _Recommended:_ as stated (team chips reuse the `'player'` kind with the pseudo id).
  - _Decision:_ ____

- **D13 — Recording-target derivation from selection.** `selection.kind === 'player'
  ? selection.playerId : null` → individual → that player; team pseudo → pseudo id; all →
  `null` (no recording, per D2).
  - _Recommended:_ as stated; the panel disables `onCourtTap` when the target is `null`.
  - _Decision:_ ____

- **D14 — Orphan shots (playerId not on the current roster).** `rosterAlignment` strips
  these locally on `SET_PLAYERS`, but cloud/summary data may still contain them.
  `shotsForSelection` excludes them from individual/team views (no id match) and they only
  appear under "All".
  - _Recommended:_ accept "orphans show only in All"; do not special-case in v1.
  - _Decision:_ ____

- **D15 — Selection persistence.** Local UI state; not persisted to `GameState`/cloud;
  resets per F1 §7 D3 (tracker opens on Stats; selection re-derives from active player).
  - _Recommended:_ as stated.
  - _Decision:_ ____

### E. Acceptance criteria & regression

- **D16 — Acceptance criteria.** e.g. "Selecting an individual shows only their markers and
  zone%; selecting a team shows that side's union and **never** the other side; 'All' shows
  every shot and (per D2) disables recording; recording while a player/team chip is selected
  attributes the new shot to that chip and it appears immediately in the filtered view; the
  Game Summary chart tab filters identically."
  - _Decision (add/adjust):_ ____

- **D17 — Unit + manual coverage.** Unit: the `shotsForSelection`/`sideOf` matrix (Task 1).
  Manual: the multi-player matrix in §5 on both the tracker and the summary.
  - _Decision (add/adjust):_ ____

### F. Explicitly out of F2
Cloud/multi-recorder aggregation (**F3**); per-player marker colors + legend; per-player
breakdown panel; season/career heatmaps. D12–D14 above must stay consistent with F3's
review path (which supplies a different source array but the **same** `selection`).
