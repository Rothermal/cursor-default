# Implementation Plan: Basketball Shot Chart

Step-by-step implementation plan for the basketball shot chart feature, broken into small work units with test breakpoints, dependency ordering, and agent parallelization guidance.

**Design doc:** [DESIGN_SHOT_CHART.md](DESIGN_SHOT_CHART.md)

**Relationship to team stats work:** This feature is **independent** of the team-level stat tracking feature ([DESIGN_TEAM_STATS_IMPLEMENTATION.md](DESIGN_TEAM_STATS_IMPLEMENTATION.md)). Both can be implemented in parallel. The shot chart stores `playerId` per shot, so when team pseudo-players land later, the shot chart will naturally support team-level vs. per-player views. No team stats work units are prerequisites for any shot chart work unit.

---

## 1. Dependency Graph

```
SC-1  Types, Geometry & Court SVG
  │
  ├─────────────────────┐
  │                     │
  ▼                     ▼
SC-2  Shot Recording   SC-3  GameState &
  │   Page (tap flow)    │   Reducer Integration
  │                      │
  ├──────────────────────┤
  │                      │
  ▼                      ▼
SC-4  Undo &           SC-6  DB Migration &
  │   Stat Sync          │   Cloud Sync
  │                      │
  ▼                      │
SC-5  Game Summary      │
  │   Shot Chart         │
  │                      │
  └───────┬──────────────┘
          │
          ▼
        SC-7  Polish &
              Edge Cases
```

**Critical path:** SC-1 → SC-2 → SC-4 → SC-5

**Backend path:** SC-1 → SC-3 → SC-6

---

## 2. Work Units

---

### SC-1: Court SVG Component + Geometry Utilities

**Design ref:** [SHOT_CHART §3, §6](DESIGN_SHOT_CHART.md) — SC-1 implements a **diagram-oriented** half court (hoop at top, +y toward half court). Some markings from §3.2 are omitted or simplified for MVP; see below.

**Depends on:** Nothing — this is the foundation.

**Blocks:** Everything else.

**What to do:**

1. **New: `src/components/shot-chart/courtGeometry.ts`**:
   - **Coordinate system:** Origin `(0, 0)` = center of the rim. **+y** runs toward the half-court line (down the screen). The baseline (out of bounds behind the hoop) is at **negative** `y` (`BASELINE_Y = -BASKET_CENTER_Y`).
   - **Rim vs baseline (diagram):** NBA uses 5.25′ from baseline to rim center; the SVG uses **half** that offset (`BASKET_CENTER_Y = 5.25 / 2`) so the basket sits closer to the top edge. The backboard `y` is interpolated between baseline and rim using the same ratio as regulation (4′ / 5.25′).
   - **Constants (implemented):** `COURT_WIDTH`, `HALF_COURT_DEPTH`, `BASKET_CENTER_Y`, `BASELINE_Y`, `HALFCOURT_Y`, `BACKBOARD_Y`, `BACKBOARD_WIDTH`, `BASKET_RADIUS`, `PAINT_WIDTH` (16′ NBA lane), `PAINT_DEPTH_FROM_BASELINE`, `FT_LINE_Y`, `FT_CIRCLE_RADIUS`, `RESTRICTED_RADIUS` (used only by `classifyShotZone`, not drawn), `THREE_POINT_RADIUS`, `CORNER_THREE_X`, `CORNER_THREE_ARC_Y` (derived tangent height for corner threes), `LANE_MARKS_FROM_BASELINE`.
   - Export `isThreePointer(x, y)` and `classifyShotZone(x, y)`.
   - **`ShotZone`** lives in **`src/types.ts`** (imported here for `classifyShotZone`).

2. **New: `src/components/shot-chart/BasketballCourt.tsx`**:
   - Props: `shots: ShotRecord[]`, `onCourtTap?: (x: number, y: number) => void`, `className?: string`
   - **`viewBox`** is computed from court bounds + padding (not a fixed literal); `preserveAspectRatio="xMidYMid meet"`.
   - **Court styling:** Fill `#e8d5b7`, lines `#8B6914`, stroke width tuned for foot-space coordinates.
   - **Drawn features:**
     - Court rectangle (fill + stroke = outer boundary including baseline/sidelines for this half).
     - Paint rectangle to the free-throw line; lane hash marks outside the lane.
     - **Free-throw circle:** solid semicircle on the **half-court** side of the FT line; **dashed** semicircle on the **basket** side, bulging into the key. The dashed path is **inset** slightly along the arc so the first/last dashes do not merge with the solid half at the lane marks. The two halves share the same 6′ radius centered on the FT line.
     - **Three-point line:** corner verticals from baseline to arc tangent, then **two** minor circular arcs meeting at `(0, THREE_POINT_RADIUS)` so the outer cup is unambiguous (avoids wrong sweep / “W” shape).
     - Half-court **line** only (no center-court circle — it clipped past the line in early builds).
     - Backboard line, rim circle, connector from backboard to rim.
   - **Not drawn (MVP):** restricted-area arc around the hoop; half-court circle. Zone logic may still return `'restricted'` for analytics.
   - Render shot markers from `shots`:
     - Made: green filled circle, `r = 0.8`, ~80% opacity
     - Missed: red X, total arm span 1.2 (±0.6 from center), ~80% opacity
   - Transparent overlay `<rect>` for taps when `onCourtTap` is set; `touchAction: 'none'` (and pointer styling as needed).
   - Tap → court `(x, y)` via `getScreenCTM().inverse()` (same feet space as geometry).

3. **`src/types.ts`** — Add types (do not add to `GameState` until SC-3):
   - `ShotZone` type
   - `ShotRecord` interface

4. **Dev-only preview (optional but present in repo):** `src/pages/ShotChartPreview.tsx` and route `/#/dev/shot-chart` (dev build) to render sample shots; when Supabase auth would block the app, dev can short-circuit to this preview for the shot-chart hash only.

**Files touched:** `src/components/shot-chart/courtGeometry.ts`, `src/components/shot-chart/BasketballCourt.tsx`, `src/types.ts`, `src/pages/ShotChartPreview.tsx`, `src/App.tsx` (dev route / preview gate only)

**Test breakpoint:**
- `pnpm build` passes
- Open **`/#/dev/shot-chart`** in dev (or embed `<BasketballCourt />` with hardcoded shots). Verify:
  - Three-point line, paint, FT circle halves, half-court line, basket read correctly at ~375px width
  - Shot markers sit at stored `(x, y)` in feet
  - With `onCourtTap`, taps report feet coordinates consistent with the diagram
- **Geometry checks** (feet, origin at rim, +y toward half court) — examples:
  - `isThreePointer(0, 5)` → `false`; `isThreePointer(0, 25)` → `true`; `isThreePointer(23, 5)` → `true` (corner band); `isThreePointer(20, 5)` → `false`
  - `classifyShotZone(0, 2)` → `'restricted'`; `(4, 10)` → `'paint'`; `(10, 15)` → `'mid_range'`; `(0, 25)` → `'three'`
  - (If any example drifts after constant tweaks, align the doc with `courtGeometry.ts` and a quick REPL or unit test.)

**Commit message:** `feat: add basketball court SVG component and shot geometry utilities`

---

### SC-2: Shot Chart Interaction Page

**Design ref:** [SHOT_CHART §5](DESIGN_SHOT_CHART.md)

**Depends on:** SC-1 (court component exists)

**Blocks:** SC-4, SC-5

**What to do:**

1. **New: `src/pages/ShotChart.tsx`** — Full-screen shot chart page:
   - Reads `sport`, `players`, `activePlayerId` from `GameContext`
   - Guard: redirect to `/` if not basketball or no game in progress
   - **Header**: "← Back to Stats" button (navigates to `/game`), optional "Clear All" button
   - **Mode toggle**: "Made" / "Missed" segmented control (local state: `mode: 'made' | 'missed'`)
     - Made: green background when active
     - Missed: red background when active
   - **Player selector**: horizontal strip (same as Game Tracker) so the coach can switch who the shot is attributed to. Active player is highlighted.
   - **Court**: Full-width `<BasketballCourt>` with `onCourtTap` handler
   - **On tap**: Create a `ShotRecord` from coordinates + mode + active player:
     - `id`: generated unique ID
     - `x`, `y`: from court tap
     - `made`: from mode toggle
     - `shotType`: from `isThreePointer(x, y)`
     - `zone`: from `classifyShotZone(x, y)`
     - `playerId`: `activePlayerId`
     - `timestamp`: `Date.now()`
   - For now, store shots in **local component state** (will wire to GameContext in SC-3). This lets us test the UI independently.
   - **Shooting summary**: Below the court, show zone-based stats computed from local shot array (see [SHOT_CHART §5.7](DESIGN_SHOT_CHART.md)):
     - Paint: M/A (pct%) | Mid: M/A (pct%) | 3PT: M/A (pct%) | Total: M/A (pct%)
   - **Undo**: "↩ Undo Last Shot" button removes the last shot from local state

2. **`src/App.tsx`** — Add route:
   ```tsx
   <Route path="/shot-chart" element={<ShotChart />} />
   ```

3. **`src/pages/GameTracker.tsx`** — Add "Shot Chart" button:
   - Only visible when `sport.id === 'basketball'` (or use `sport.hasShotChart` flag once added)
   - Placed below the scoreboard, above the stat grid
   - Navigates to `/shot-chart`
   - Styled prominently: full-width button with basketball icon

4. **`src/config/sports.ts`** — Add `hasShotChart?: boolean` to the basketball sport config (set to `true`). Add the field to `SportConfig` interface in `types.ts`.

**Files touched:** new `src/pages/ShotChart.tsx`, `src/App.tsx`, `src/pages/GameTracker.tsx`, `src/config/sports.ts`, `src/types.ts`

**Test breakpoint:**
- Start a basketball game → see "🏀 Shot Chart" button on Game Tracker
- Tap button → full-screen court loads with mode toggle and player selector
- Toggle to "Made" → tap court → green circle appears at tapped location
- Toggle to "Missed" → tap court → red X appears
- Shooting summary shows correct counts and percentages
- Undo removes the last shot
- "Back to Stats" returns to Game Tracker
- No shot chart button for baseball or other sports
- Court fills the screen width on mobile

**Commit message:** `feat: add interactive shot chart page with made/missed toggle and court tapping`

---

### SC-3: GameState & Reducer Integration

**Design ref:** [SHOT_CHART §4.2, §4.3, §4.4](DESIGN_SHOT_CHART.md)

**Depends on:** SC-1 (types defined)

**Blocks:** SC-4, SC-6

**What to do:**

1. **`src/types.ts`**:
   - Add `shotChart: ShotRecord[]` to `GameState`
   - Add `shotId?: string` to `ActionLogEntry`
   - Add new action types to `GameAction`:
     ```typescript
     | { type: 'ADD_SHOT'; shot: ShotRecord }
     | { type: 'REMOVE_LAST_SHOT' }
     ```

2. **`src/context/GameContext.tsx`**:
   - Initialize `shotChart: []` in `createInitialState()`
   - Handle `ADD_SHOT` in reducer:
     - Append shot to `shotChart`
     - Also increment the corresponding stat (`2pt`, `2pt_miss`, `3pt`, `3pt_miss`) for `shot.playerId`
     - Create an `ActionLogEntry` with `shotId: shot.id` for undo linkage
   - Handle `REMOVE_LAST_SHOT`:
     - Pop the last shot from `shotChart`
     - This is a convenience action for the shot chart page (alternative to full UNDO)
   - Update `UNDO` handler:
     - When the last action has a `shotId`, also remove the matching `ShotRecord` from `shotChart`
   - Include `shotChart` in `loadState()` deserialization (default to `[]` if missing)
   - Include `shotChart` in localStorage persistence
   - Include shot data in `buildSyncFingerprint()` so changes trigger cloud sync

3. **`src/pages/ShotChart.tsx`** — Wire to GameContext:
   - Replace local state with `state.shotChart` from context
   - On court tap: dispatch `ADD_SHOT` instead of updating local state
   - On undo: dispatch `UNDO` (which handles both the shot and the stat)
   - Filter displayed shots by the shot chart's active context (all shots for now; per-player filtering is v2)

**Files touched:** `src/types.ts`, `src/context/GameContext.tsx`, `src/pages/ShotChart.tsx`

**Test breakpoint:**
- Start a basketball game → add players → go to shot chart
- Tap to record shots → return to Game Tracker:
  - **2pt/3pt stat counters show the shots recorded via the chart** (this is the key integration test)
  - Scoreboard score includes chart-recorded points
- Undo on Game Tracker undoes a chart-recorded shot (stat decrements AND shot marker disappears from chart)
- Close browser → reopen → shots are restored from localStorage
- Start a new game → shot chart is empty

**Commit message:** `feat: integrate shot chart with GameState reducer and stat pipeline`

---

### SC-4: Undo Coordination & Stat Sync Polish

**Design ref:** [SHOT_CHART §4.3, §4.4](DESIGN_SHOT_CHART.md)

**Depends on:** SC-2 (shot chart page), SC-3 (GameState integration)

**Blocks:** SC-5

**What to do:**

1. **Undo on shot chart page**:
   - The shot chart page has its own "↩ Undo Last Shot" button
   - This dispatches `UNDO` — the reducer checks if the last action was shot-originated (has `shotId`) and removes both the stat and the shot record
   - Show the undo label: "Last: #23 2PT Made" or "Last: #11 3PT Missed" (derive from the last shot record)

2. **Stat-button-to-chart awareness**:
   - When on the Game Tracker and a coach taps the 2PT stat button directly, no shot marker appears (no location data). This is correct — the stat counter increments but the shot chart only shows location-tagged shots.
   - Document this behavior in a small info tooltip: "Shots recorded via the Shot Chart include location data. Shots recorded via stat buttons do not appear on the chart."

3. **Edge case**: Coach records a shot via the chart, then goes to Game Tracker and undoes it there. The `UNDO` in GameContext handles this correctly because the `ActionLogEntry` has a `shotId`. Verify this flow.

4. **Edge case**: Coach undoes on the shot chart, then goes to Game Tracker. The stat counter should reflect the undo. Verify.

**Files touched:** `src/pages/ShotChart.tsx`, `src/context/GameContext.tsx` (minor tweaks)

**Test breakpoint:**
- Record 3 shots via chart → go to Game Tracker → stat counters show 3 shots
- Undo 1 on Game Tracker → go to chart → only 2 markers visible
- Record 2 shots via chart → undo on chart → 1 marker remains, stat counter shows 4 total
- Record shots on chart AND via stat buttons → counts are additive (expected v1 behavior)
- Clear all shots → stat counters for 2pt/3pt/misses return to values from stat-button-only entries (they won't go to 0 if some were added via buttons)

**Commit message:** `feat: polish shot chart undo coordination and stat sync edge cases`

---

### SC-5: Game Summary Shot Chart View

**Design ref:** [SHOT_CHART §8](DESIGN_SHOT_CHART.md)

**Depends on:** SC-4 (shots are reliably stored and synced with stats)

**Blocks:** Nothing

**What to do:**

1. **New: `src/components/shot-chart/ShootingSummary.tsx`**:
   - Props: `shots: ShotRecord[]`
   - Computes zone-based stats: restricted, paint, mid-range, three-point, total
   - For each zone: made count, attempt count, percentage
   - Renders a compact grid:
     ```
     ┌──────────┬──────────┬──────────┐
     │ Restrict │  Paint   │ Mid-Rng  │
     │  4/6     │  4/8     │  2/5     │
     │  67%     │  50%     │  40%     │
     └──────────┴──────────┴──────────┘
     ┌──────────┬──────────────────────┐
     │  3-Point │      TOTAL          │
     │  3/9     │     13/28           │
     │  33%     │      46%            │
     └──────────┴──────────────────────┘
     ```

2. **`src/pages/GameSummary.tsx`**:
   - Check if `state.shotChart.length > 0`
   - If yes, add a "Shot Chart" tab to the summary tabs (alongside existing "Players" / "Team")
   - The tab renders:
     - `<BasketballCourt shots={state.shotChart} />` (read-only, no `onCourtTap`)
     - `<ShootingSummary shots={state.shotChart} />`

3. **Also add the `ShootingSummary` to the shot chart page** (`ShotChart.tsx`) below the court, replacing the inline summary added in SC-2.

**Files touched:** new `src/components/shot-chart/ShootingSummary.tsx`, `src/pages/GameSummary.tsx`, `src/pages/ShotChart.tsx`

**Test breakpoint:**
- Play a game, record 10+ shots via the chart across all zones
- Navigate to Summary → see "Shot Chart" tab
- Tab shows read-only court with all markers
- Zone breakdown shows correct made/attempt/percentage for each zone
- No "Shot Chart" tab if no shots were recorded
- Zone percentages match manual count of markers on the court

**Commit message:** `feat: add shot chart visualization and zone breakdown to Game Summary`

---

### SC-6: Database Migration & Cloud Sync

**Design ref:** [SHOT_CHART §4.5](DESIGN_SHOT_CHART.md)

**Depends on:** SC-3 (GameState has `shotChart` array)

**Blocks:** SC-7

**What to do:**

1. **New: `supabase/migrations/028_shot_chart.sql`** (or next available number):
   ```sql
   CREATE TABLE shot_chart (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
     player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
     x numeric NOT NULL,
     y numeric NOT NULL,
     made boolean NOT NULL,
     shot_type text NOT NULL CHECK (shot_type IN ('2pt', '3pt')),
     zone text NOT NULL CHECK (zone IN ('restricted', 'paint', 'mid_range', 'three')),
     recorded_by uuid NOT NULL REFERENCES profiles(id),
     created_at timestamptz NOT NULL DEFAULT now()
   );

   CREATE INDEX idx_shot_chart_game ON shot_chart(game_id);
   CREATE INDEX idx_shot_chart_game_player ON shot_chart(game_id, player_id);

   ALTER TABLE shot_chart ENABLE ROW LEVEL SECURITY;

   -- Team members can view shot charts for their team's games
   CREATE POLICY "shot_chart_select" ON shot_chart
     FOR SELECT USING (
       game_id IN (SELECT id FROM games WHERE team_id IN (
         SELECT team_id FROM team_members WHERE user_id = (SELECT auth.uid())
       ))
     );

   -- Users can insert their own shot chart data
   CREATE POLICY "shot_chart_insert" ON shot_chart
     FOR INSERT WITH CHECK (recorded_by = (SELECT auth.uid()));

   -- Users can update/delete their own shot chart data
   CREATE POLICY "shot_chart_update" ON shot_chart
     FOR UPDATE USING (recorded_by = (SELECT auth.uid()));

   CREATE POLICY "shot_chart_delete" ON shot_chart
     FOR DELETE USING (recorded_by = (SELECT auth.uid()));
   ```

2. **`src/lib/cloudSync.ts`** — Add shot chart sync:
   - In `syncGameSnapshotToCloud`: after upserting `game_stats`, also upsert `shot_chart` rows
   - Strategy: delete existing `shot_chart` rows for this `(game_id, recorded_by)` and re-insert all from `state.shotChart`. This is simpler than per-shot diffing and the row count is small (typically <50 per game).
   - Map local player IDs to cloud player IDs using `playerIdMap` for the `player_id` column.

3. **`src/lib/cloudSync.ts`** — Load shot chart on cloud resume:
   - In `loadLatestCloudGame` / `loadCloudGameById`: after loading game stats, also query `shot_chart` for this game
   - Map cloud player IDs back to local IDs
   - Include in hydrated state as `shotChart: [...]`

**Files touched:** new `supabase/migrations/028_shot_chart.sql`, `src/lib/cloudSync.ts`

**Test breakpoint:**
- Apply migration to Supabase
- Start a cloud game → record shots via chart → verify in Supabase DB:
  - `shot_chart` table has rows with correct `game_id`, `player_id`, `x`, `y`, `made`, `shot_type`, `zone`
- Close and reopen the game → shot chart data restored from cloud
- Different user on same game sees shot chart data (via RLS select policy)
- Delete a game → shot chart rows cascade-deleted

**Commit message:** `feat: add shot_chart table migration and cloud sync support`

---

### SC-7: Polish & Edge Cases

**Design ref:** [SHOT_CHART §5.4, §5.5, §9.1](DESIGN_SHOT_CHART.md)

**Depends on:** SC-4 (undo works), SC-5 (summary works), SC-6 (cloud works)

**Blocks:** Nothing — this is the final polish pass.

**What to do:**

1. **Haptic feedback**: On mobile, call `navigator.vibrate?.(10)` when a shot is registered. Gives tactile confirmation.

2. **Visual feedback**: Brief pulse animation on the shot marker when placed (CSS animation on the SVG element).

3. **Court styling polish**:
   - Ensure court lines are visible on all devices (contrast check)
   - Ensure markers are visible on the hardwood background
   - Test on both light and dark backgrounds (if dark mode is ever added)
   - Verify court proportions on various phone sizes (iPhone SE, iPhone 15, Pixel 7, etc.)

4. **Prevent accidental taps**: Add a small debounce (100ms) to prevent double-registering a shot from a bouncy tap.

5. **Shot count badge on Game Tracker**: On the "Shot Chart" button in GameTracker, show a badge with the number of shots recorded: `🏀 Shot Chart (14)`.

6. **Clear All confirmation**: The "Clear All" button on the shot chart should show a `ConfirmDialog` before wiping all shots.

7. **Empty state**: When no shots have been recorded, show a centered message on the court: "Tap the court to record shots."

**Files touched:** `src/pages/ShotChart.tsx`, `src/components/shot-chart/BasketballCourt.tsx`, `src/pages/GameTracker.tsx`

**Test breakpoint:**
- Tap court → feel haptic buzz → see marker pulse animation
- Rapid double-tap → only 1 shot registered (debounce)
- Shot chart button shows count badge
- "Clear All" shows confirmation dialog
- Empty court shows placeholder message
- Court looks good on iPhone SE (375px), iPhone 15 Pro Max (430px), and desktop

**Commit message:** `feat: polish shot chart with haptic feedback, animations, and edge case handling`

---

## 3. Parallel Agent Strategy

### Phase 1: Foundation (1 agent, blocks everything)

| Agent | Work Unit |
|-------|-----------|
| **Agent A** | **SC-1** Court SVG + Geometry |

**Sync point:** Merge SC-1. Verify court renders correctly at multiple viewport sizes.

---

### Phase 2: Core Feature (2 agents in parallel)

| Agent | Work Units |
|-------|------------|
| **Agent A** | **SC-2** Shot Chart Page (UI/interaction, local state initially) |
| **Agent B** | **SC-3** GameState + Reducer Integration |

**Why parallel:** Agent A builds the UI with local state; Agent B builds the reducer/state changes. They share `src/types.ts` additions but can coordinate easily — SC-3 adds to `GameState` and `GameAction`, while SC-2 adds the route and page. The final wiring (SC-2 reading from context) is part of SC-3's scope.

**Sync point:** Merge both. Verify shots recorded on the chart page update stat counters on the Game Tracker.

---

### Phase 3: Integration + Backend (2 agents in parallel)

| Agent | Work Units |
|-------|------------|
| **Agent A** | **SC-4** Undo polish → **SC-5** Game Summary view |
| **Agent B** | **SC-6** DB Migration + Cloud Sync |

**Why parallel:** Agent A works on frontend-only undo/summary changes. Agent B works on backend schema + cloudSync.ts. No file overlap.

**Sync point:** Merge both. Verify full round-trip: record shots → sync to cloud → reload → shots restored → finalize → summary shows chart.

---

### Phase 4: Polish (1 agent)

| Agent | Work Unit |
|-------|-----------|
| **Agent A** | **SC-7** Polish & edge cases |

**Final verification:** End-to-end play through a complete game with shot charting, undo, cloud sync, and summary review.

---

## 4. Phase / WU Quick Reference

| Phase | WU | Name | Depends On | Agent |
|-------|-----|------|------------|-------|
| 1 | SC-1 | Court SVG + Geometry | — | A (solo) |
| 2 | SC-2 | Shot Chart Page | SC-1 | A |
| 2 | SC-3 | GameState & Reducer | SC-1 | B |
| 3 | SC-4 | Undo & Stat Sync | SC-2, SC-3 | A |
| 3 | SC-5 | Game Summary View | SC-4 | A (continued) |
| 3 | SC-6 | DB Migration + Cloud | SC-3 | B |
| 4 | SC-7 | Polish & Edge Cases | SC-4, SC-5, SC-6 | A (solo) |

---

## 5. Testing Strategy

### Phase 1 — SC-1
- [ ] `pnpm build` + `pnpm lint`
- [ ] Court SVG renders at correct proportions on mobile and desktop
- [ ] `isThreePointer()` and `classifyShotZone()` unit logic verified manually or via test script
- [ ] Tap coordinates convert accurately from screen to court space

### Phase 2 — SC-2 + SC-3
- [ ] Shot chart page opens from Game Tracker button (basketball only)
- [ ] Made/missed toggle works; correct marker type appears
- [ ] Player selector works on shot chart page
- [ ] Stat counters on Game Tracker reflect shots from chart
- [ ] Scoreboard score includes chart-recorded points
- [ ] localStorage persistence: close → reopen → shots and stats intact

### Phase 3 — SC-4 + SC-5 + SC-6
- [ ] Undo on Game Tracker reverses chart shots (stat + marker)
- [ ] Undo on shot chart page reverses last shot
- [ ] Game Summary "Shot Chart" tab shows read-only court + zone breakdown
- [ ] Zone percentages are correct
- [ ] Cloud: shots sync to `shot_chart` table
- [ ] Cloud: resume game restores shot chart data
- [ ] No shot chart tab in summary if no shots recorded

### Phase 4 — SC-7
- [ ] Haptic feedback on shot tap (mobile)
- [ ] Marker pulse animation
- [ ] Debounce prevents double-tap
- [ ] Shot count badge on Game Tracker button
- [ ] Clear All confirmation dialog
- [ ] Empty state message on blank court

---

## 6. Relationship to Team Stats Feature

The shot chart and team stats features are **independent work streams** that can be developed in parallel. Here's how they relate:

| Aspect | Shot Chart | Team Stats |
|--------|-----------|------------|
| **Player model** | Records `playerId` per shot (individual player or future team pseudo-player) | Introduces team pseudo-players with `isTeamPlayer` flag |
| **GameState** | Adds `shotChart: ShotRecord[]` | Adds `currentPeriod`, `teamStatsConfig`, team pseudo-players in `players[]` |
| **GameTracker** | Adds "Shot Chart" button | Adds team player injection, stat category switching, period toggle |
| **Cloud sync** | Adds `shot_chart` table sync | Adds team placeholder `players` rows + `game_stats` for team stats |
| **Migration** | `028_shot_chart.sql` | `027_team_stats_schema.sql` |
| **Files in common** | `types.ts`, `GameContext.tsx`, `GameTracker.tsx`, `GameSummary.tsx` | `types.ts`, `GameContext.tsx`, `GameTracker.tsx`, `GameSummary.tsx` |

**Merge strategy:** If both features are in progress simultaneously, coordinate on `types.ts` and `GameContext.tsx` to avoid conflicts. The changes are additive in different areas of these files, so conflicts should be minimal:
- Shot chart adds `shotChart`, `ADD_SHOT`, `REMOVE_LAST_SHOT` to types and reducer
- Team stats adds `currentPeriod`, `teamStatsConfig`, `SET_PERIOD`, `isTeamPlayer`, etc.

**Future integration:** When team pseudo-players exist, the shot chart's player selector will naturally include them. Recording shots "for the team" means shots go to the team pseudo-player. The summary can then show "Team shot chart" (all shots) vs. per-player filtered views.

---

## 7. Notes for Implementing Agents

1. **SVG coordinate system is the foundation.** Get SC-1 right and everything else follows. The `viewBox` approach means the court scales perfectly to any screen size — test on the smallest phone viewport (320px) to verify.

2. **`getScreenCTM().inverse()`** is the correct way to convert touch/pointer coordinates to SVG coordinates. Do not use `getBoundingClientRect()` and manual math — it breaks with CSS transforms, scroll offsets, and zoom.

3. **No external dependencies.** The court SVG is hand-drawn with React JSX. No D3, no canvas libraries. This keeps the bundle small and avoids dependency version issues.

4. **Touch action: none.** The SVG tap target must have `touchAction: 'none'` CSS to prevent the browser from panning/zooming when the user taps the court. Without this, mobile Safari and Chrome will fight for the touch event.

5. **Shot markers in court coordinates.** Markers are positioned using the same coordinate system as the court (feet from basket). The SVG `viewBox` handles all screen-space scaling. Never convert to pixels manually.

6. **Migration numbering.** The team stats migration is `027`. The shot chart migration should be `028`. If another migration lands first, renumber. Check `supabase/migrations/` before creating the file.

7. **Warm hardwood styling.** The court should feel like a real basketball court — warm wood tones, clean lines, orange/brown palette. Not a clinical white grid. But keep the line contrast high enough that markers are clearly visible.

---

*Document version: 0.1*
