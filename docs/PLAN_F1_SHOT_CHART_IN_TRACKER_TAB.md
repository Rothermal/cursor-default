# Feature 1 Plan: Combine the Shot Tracker into the Main Tab

> **For agentic workers:** This is a design + implementation plan. Steps use checkbox
> (`- [ ]`) syntax. See the umbrella [DESIGN_SHOT_TRACKER_UI_REVAMP.md](DESIGN_SHOT_TRACKER_UI_REVAMP.md)
> for shared context and cross-cutting decisions.

**Goal:** Bring the basketball shot chart into the Game Tracker ("main tab") as an
in-page view, so the coach records shots and stats from one screen without a route change.

**Architecture:** Add a segmented "Stats / Shot Chart" control to `GameTracker`.
Both views share the same scoreboard, player-selector strip, and undo bar. The
existing `/shot-chart` route becomes a thin redirect to `/game` so deep links keep
working. Extract the duplicated player-selector strip into a reusable component.

**Tech Stack:** React 18 + TypeScript, Tailwind, React Router (HashRouter), existing
`GameContext` reducer. No new dependencies.

---

## 1. Problem & current state

Today the shot chart is a **separate full-screen route** (`/shot-chart`,
`src/pages/ShotChart.tsx`) reached by a button in `GameTracker.tsx`
(lines ~260–281). Consequences:

- Recording shots means leaving the stat grid; switching back is a navigation.
- The two pages **duplicate** the scoreboard context, the player-selector strip
  (`sortTeamPlayersFirst` + the mapping JSX is copy-pasted in both files), and the
  undo affordance.
- A coach who wants to mix location shots (chart) with non-location stats (assists,
  fouls, FTs) bounces between two screens during live play.

Both pages already read the same `GameContext` state, so merging them is a UI/
composition change, not a data change.

## 2. Design

### 2.1 Chosen approach — in-tracker segmented control (Recommended)

Add a segmented control near the top of `GameTracker`, below the scoreboard and
shared player strip:

```
┌──────────────────────────────────────────────┐
│  ← Home                         Summary →     │
│  ┌────────────────────────────────────────┐   │
│  │  Rebels  62    vs    Brawlers  54       │   │  Scoreboard (shared)
│  └────────────────────────────────────────┘   │
│  [★ Rebels] [★ Brawlers] | [#23 MJ] [#11 SN]…  │  Player strip (shared)
│  ┌─────────────┬──────────────┐                │
│  │   Stats     │  Shot Chart  │                │  Segmented control (NEW)
│  └─────────────┴──────────────┘                │
│  …body swaps between the stat grid and the      │
│   court + made/missed toggle + zone summary…    │
│  ───────────────────────────────────────────   │
│  Last: #23 2PT Made                  ↩ Undo     │  Undo bar (shared)
└──────────────────────────────────────────────┘
```

- **Stats view** = today's category grid + notes (unchanged).
- **Shot Chart view** = the made/missed mode toggle, `BasketballCourt` (interactive),
  `ShootingSummary`, and the chart-specific "Undo last shot" / "Clear all" actions.
- The **shared bottom undo bar** stays; the chart's own "Undo last shot" remains in
  the Shot Chart body because it has chart-specific semantics (only undoes a
  shot-originated log entry).
- The segmented control only renders for basketball (`sport.id === 'basketball'`);
  for other sports `GameTracker` renders exactly as today (no control, no chart).

### 2.2 Alternatives considered

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **A. Segmented control in Game Tracker** (chosen) | One screen; shares scoreboard/strip/undo; minimal new state (one `useState`) | Court shares vertical space with header (still full-width, acceptable on mobile) | **Recommended** |
| B. Keep separate route, just improve the button | Smallest change | Doesn't satisfy "combine into the main tab"; keeps duplication | Rejected |
| C. Bottom tab bar (app-wide nav) | Scales to more views | Larger redesign; competes with existing back/summary nav; over-scoped | Rejected (YAGNI) |
| D. Inline (chart always below the grid, no tabs) | No mode state | Long scroll; court pushed far down; accidental taps while scrolling | Rejected |

### 2.3 State & persistence

- Active view is **local UI state** in `GameTracker` (`useState<'stats' | 'chart'>`),
  not part of `GameState`. It does **not** persist to `localStorage` or cloud — the
  tracker always opens on **Stats**. (Rationale: avoids polluting the synced
  `GameState`/fingerprint; opening on Stats is the safe default.)
- The player selector continues to dispatch `SET_ACTIVE_PLAYER`; both views read
  `activePlayerId`. Switching view does **not** change the active player.

### 2.4 Component extraction (shared with F2/F3)

Extract the player-selector strip (currently duplicated) into
`src/components/PlayerSelectorStrip.tsx`:

```ts
interface PlayerSelectorStripProps {
  players: Player[]                 // already sorted, or sort inside
  activePlayerId: string | null
  sportTheme: SportTheme
  onSelect: (playerId: string) => void
  onAddPlayer?: () => void          // GameTracker shows "+", ShotChart did not
}
```

Behavior is the exact current strip: team pseudo-players first with a divider,
`line-clamp-2` names, active styling per `isTeamPseudoPlayer`. `GameTracker` passes
`onAddPlayer`; read-only consumers (F3) omit it.

### 2.5 Route handling

- `App.tsx`: change `/shot-chart` to render a redirect component
  (`<Navigate to="/game" replace />`) **or** keep `ShotChart` but have it immediately
  `navigate('/game')`. Recommended: a tiny `ShotChartRedirect` that preserves the
  basketball guard then redirects, so `#/shot-chart` bookmarks land on the merged tab.
- The dev-only `/dev/shot-chart` preview (`ShotChartPreview`) is **unchanged**.
- Update `AGENTS.md` and `docs/REGRESSION_TESTING.md` references to note the chart is
  now a tab in Game Tracker (the "real flow" line).

### 2.6 File structure

| File | Change |
|------|--------|
| `src/components/PlayerSelectorStrip.tsx` | **Create** — extracted shared strip. |
| `src/components/shot-chart/ShotChartPanel.tsx` | **Create** — the chart body (mode toggle, court, summary, undo/clear) lifted out of `ShotChart.tsx`, taking no route responsibilities. |
| `src/pages/GameTracker.tsx` | **Modify** — add segmented control + render `ShotChartPanel` for basketball; use `PlayerSelectorStrip`; remove the "Shot chart" navigation button (replace with the tab). |
| `src/pages/ShotChart.tsx` | **Modify/Reduce** — becomes a redirect to `/game` (logic moved to `ShotChartPanel`). |
| `src/App.tsx` | **Modify** — `/shot-chart` → redirect. |
| `AGENTS.md`, `docs/REGRESSION_TESTING.md` | **Modify** — doc the new location. |

Splitting the chart body into `ShotChartPanel` keeps `GameTracker` from ballooning
and lets F3 reuse the panel in read-only mode.

## 3. Implementation tasks (bite-sized)

### Task 1: Extract `PlayerSelectorStrip`

- [ ] **Create `src/components/PlayerSelectorStrip.tsx`** containing the exact strip
  markup currently in `GameTracker.tsx` (lines ~285–333) including `sortTeamPlayersFirst`,
  the team divider, and the optional `+` add button (rendered only when `onAddPlayer` is set).
- [ ] **Modify `GameTracker.tsx`** to import and use `PlayerSelectorStrip`, passing
  `onAddPlayer={() => setShowAddPlayer(!showAddPlayer)}`. Keep the add-player input block in `GameTracker`.
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass, Game Tracker strip visually unchanged.
- [ ] Manual: start a basketball game, confirm the player strip still selects players and adds players.
- [ ] **Commit:** `refactor: extract shared PlayerSelectorStrip component`

### Task 2: Extract the chart body into `ShotChartPanel`

- [ ] **Create `src/components/shot-chart/ShotChartPanel.tsx`** that renders the
  made/missed toggle, `BasketballCourt` (interactive `onCourtTap`), `ShootingSummary`,
  the "Undo last shot" + subtitle, and "Clear all chart shots" with `ConfirmDialog`.
  Move the tap → `ADD_SHOT` logic (`newShotId`, `isThreePointer`, `classifyShotZone`,
  pulse handling, haptics) from `ShotChart.tsx` into the panel. The panel reads
  `useGame()` directly (no route concerns) and assumes the basketball guard is handled by the parent.
- [ ] The panel must **not** render its own player strip or scoreboard (the parent provides them).
- [ ] Run `pnpm build`. Expected: pass.
- [ ] **Commit:** `refactor: extract ShotChartPanel from ShotChart page`

### Task 3: Add the segmented control to Game Tracker

- [ ] **Modify `GameTracker.tsx`**: add `const [trackerView, setTrackerView] = useState<'stats' | 'chart'>('stats')`.
- [ ] Render a segmented control (Stats / Shot Chart) **only when `sport.id === 'basketball'`**,
  styled like the existing summary tab control (`GameSummary.tsx` lines ~775–817).
- [ ] When `trackerView === 'chart'`, render `<ShotChartPanel />` in place of the
  category grid + notes; when `'stats'`, render the existing grid + notes.
- [ ] Remove the old "Shot chart" navigation button (lines ~260–281); fold its shot-count
  badge into the "Shot Chart" segment label (e.g. `Shot Chart · 12`).
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] **Commit:** `feat: show shot chart as a tab inside Game Tracker`

### Task 4: Redirect the old route

- [ ] **Modify `App.tsx`**: replace `<Route path="/shot-chart" element={<ShotChart />} />`
  with a redirect to `/game` (keep the basketball/`gameInfo` guard behavior so a
  no-game state still lands home, matching the current `ShotChart` guard).
- [ ] **Reduce `src/pages/ShotChart.tsx`** to the redirect (or delete and inline a
  `<Navigate>` in `App.tsx`). Ensure no other imports of `ShotChart` break.
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] Manual: visit `#/shot-chart` → lands on `/game` with the Shot Chart tab available.
- [ ] **Commit:** `feat: redirect legacy /shot-chart route to the Game Tracker tab`

### Task 5: Docs

- [ ] **Modify `AGENTS.md`** Gotchas: change the shot-chart line to "Shot chart is a
  tab within Game Tracker (`#/game`); legacy `#/shot-chart` redirects there. Dev-only
  SVG preview `#/dev/shot-chart` unchanged."
- [ ] **Modify `docs/REGRESSION_TESTING.md`** §4d (shot chart) to reflect the tab flow.
- [ ] **Commit:** `docs: shot chart is now a Game Tracker tab`

## 4. Testing

- **Build/lint:** `pnpm build`, `pnpm lint`.
- **Manual (GUI, `pnpm dev`):**
  - Basketball game → Game Tracker shows Stats/Shot Chart segmented control.
  - Toggle to Shot Chart → tap court records a shot → stat counter on the Stats tab
    reflects it; score updates.
  - "Undo last shot" and "Clear all chart shots" behave as before.
  - Switch players in the shared strip while on the chart → recording attributes to
    the newly selected player.
  - Non-basketball sport (e.g. baseball) → **no** segmented control, tracker identical to today.
  - `#/shot-chart` deep link → redirects to `/game`.
  - Reload mid-game → tracker opens on Stats; shots intact from `localStorage`.
- **Regression:** the dev preview `#/dev/shot-chart` still renders sample shots.

## 5. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Court gets too short under the shared header on small phones | Court is full-width SVG that scales by aspect; verify at 320px. Header is compact; consider collapsing the player strip when on the chart if needed (follow-up, not v1). |
| Duplicated-strip refactor introduces visual drift | Task 1 is a pure extraction with no markup changes; verify against current screenshots. |
| Other code imports `ShotChart` directly | Grep before deleting; only `App.tsx` references it today. |
| `GameTracker.tsx` already large | Extracting `ShotChartPanel` + `PlayerSelectorStrip` *reduces* net complexity in the page. |

## 6. Out of scope (handled by other plans)

- Filtering the court by player / team (→ **F2**).
- Showing charts for cloud-saved games / multi-recorder (→ **F3**).
- Resume-UI scores (→ **F4**).

## 7. Open questions

1. **Q1 (umbrella):** Confirm tabs-inside-tracker over a separate page. Default: yes.
2. Should the tracker **remember** the last view per game (e.g. reopen on Shot Chart)?
   Default: no — always open on Stats.
3. Keep the chart's dedicated "Undo last shot" button, or rely solely on the shared
   bottom Undo bar? Default: keep both (chart undo has shot-only semantics).
