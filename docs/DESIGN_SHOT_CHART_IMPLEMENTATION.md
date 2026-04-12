# Implementation Plan: Basketball Shot Chart

Step-by-step implementation plan for the basketball shot chart feature, broken into small work units with test breakpoints, dependency ordering, and agent parallelization guidance.

**Design doc:** [DESIGN_SHOT_CHART.md](DESIGN_SHOT_CHART.md)

**Relationship to team stats work:** This feature is **independent** of the team-level stat tracking feature ([DESIGN_TEAM_STATS_IMPLEMENTATION.md](DESIGN_TEAM_STATS_IMPLEMENTATION.md)). Both can be implemented in parallel. The shot chart stores `playerId` per shot, so when team pseudo-players land later, the shot chart will naturally support team-level vs. per-player views. No team stats work units are prerequisites for any shot chart work unit.

---

## Status (as of 2026-04)

| Work unit | Status | Notes |
|-----------|--------|--------|
| **SC-1** | **Shipped** | Court SVG, `courtGeometry`, types, dev preview `/#/dev/shot-chart` |
| **SC-2** | **Shipped** | `#/shot-chart` page: made/miss, player strip, tap → `ADD_SHOT`, `ShootingSummary` on page |
| **SC-3** | **Shipped** | `GameState.shotChart`, reducer, persistence fingerprint, hydrate from cloud |
| **SC-4** | **Shipped** | `UNDO_LAST_SHOT`, `CLEAR_SHOT_CHART`, `ConfirmDialog` clear-all (SC-7), stat-grid tooltips |
| **SC-5** | **Shipped** | `ShootingSummary`, Game Summary **Shot chart** tab |
| **SC-6** | **Shipped** (apply DB) | Migration `032_shot_chart.sql`; sync + load in `cloudSync.ts`. **Run migration on Supabase** for production cloud round-trip. |
| **SC-7** | **Shipped** | Haptics, marker pulse, tap debounce, tracker badge, empty-court hint |

### Shipped product behavior (summary)

- **Game Tracker (basketball):** Shot chart button with **count badge**; stat tiles for FG/FT have **tooltips** explaining chart vs grid taps.
- **Shot chart route** `/#/shot-chart`: mode toggle, player selector, court tap records shots into **`shotChart`** and **scoring stats**; zone summary; **undo last shot** (chart-only); **clear all** with confirmation; haptic + pulse + debounce + empty hint.
- **Game Summary:** **Shot chart** tab when there are chart shots: read-only court + zone summary.
- **Persistence:** `shotChart` in **localStorage** with game state; **cloud** replace-sync per `(game_id, recorded_by)` after migration **032** is applied.
- **Dev QA:** `/#/dev/shot-chart` + optional auth bypass (remove when no longer needed).

### Follow-ups / backlog (not in MVP scope)

- Remove or gate **`/dev/shot-chart`** and preview-only auth bypass when QA is done.
- Optional **`hasShotChart`** on `SportConfig` instead of hard-coded basketball id.
- **Unit tests** for `isThreePointer` / `classifyShotZone` (and optionally sync mapping).
- **Multi-recorder:** chart rows are per `recorded_by`; merging or “primary recorder” view for shots is a future product decision.
- **Design doc** [DESIGN_SHOT_CHART.md](DESIGN_SHOT_CHART.md): vision still describes restricted arc / some colors differently from the shipped diagram — see SC-1 notes for intentional MVP deltas.

### Process / quality suggestions (for future features)

1. **Keep a short “Status” block** at the top of implementation plans once work lands — avoids scanning every SC section for done vs todo.
2. **PR template checklist:** migration applied? smoke path (record → sync → reload)? Especially when schema and client ship together.
3. **Single contract doc** — shot chart already points at `shotChartCoordinates.ts`; for new surfaces, link that file from any new entry points.
4. **Optional CI:** `pnpm test` with Vitest for pure functions (`courtGeometry`) is cheap insurance when geometry or sync mapping changes.
5. **Feature flag or version gate** if the client must tolerate missing DB tables briefly (SC-6 already no-ops when `shot_chart` is missing; document that for support).

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

**Already done (SC-2 prep, before interaction work):**

- **`src/App.tsx`:** `<Route path="/shot-chart" element={<ShotChart />} />` — in production this is **`#/shot-chart`** (HashRouter).
- **`src/pages/ShotChart.tsx`:** Shell page: guard (basketball + `gameInfo`), "← Back to Stats" → `/game`, empty court placeholder. SC-2 fills in recording UI.
- **`src/pages/GameTracker.tsx`:** Full-width **Shot chart** button when `sport.id === 'basketball'`, below scoreboard, `navigate('/shot-chart')`.
- **Coordinate contract:** `src/lib/shotChartCoordinates.ts` documents feet-from-rim space; `ShotRecord` in `types.ts` references it; `BasketballCourt.tsx` header points to the same. Taps must feed `isThreePointer` / `classifyShotZone` without transforming `x`/`y`.
- **QA:** `/#/dev/shot-chart` preview and dev auth bypass unchanged; remove in a later cleanup SC.

**Implemented (combined SC-2 + SC-3 wiring):** Full `ShotChart` page uses **`GameState.shotChart`** and **`ADD_SHOT`** (not local-only state). Mode toggle, player strip, `ShootingSummary` below court, undo/clear flows per SC-4/SC-7. Route and tracker entry were added in prep; see **Status** section above.

**Optional later:** `hasShotChart` on `SportConfig` — skipped for MVP.

**Files touched:** `ShotChart.tsx`, `App.tsx`, `GameTracker.tsx` (and SC-3/4/5/7 files as listed in those sections).

**Test breakpoint:**
- Basketball game → **Shot chart** → record made/miss → stats and summary tab update → back to tracker shows badge

**Commit message:** `feat: add interactive shot chart page with made/missed toggle and court tapping`

---

### SC-3: GameState & Reducer Integration

**Design ref:** [SHOT_CHART §4.2, §4.3, §4.4](DESIGN_SHOT_CHART.md)

**Depends on:** SC-1 (types defined)

**Blocks:** SC-4, SC-6

**Implemented:**

1. **`src/types.ts`** — `GameState.shotChart`, `ActionLogEntry.shotId`, `ADD_SHOT` / `REMOVE_LAST_SHOT` on `GameAction`.

2. **`src/context/GameContext.tsx`** — `shotChart: []` in `createInitialState`, cloud hydrate, `loadState` default; `ADD_SHOT` appends shot, increments `2pt` / `2pt_miss` / `3pt` / `3pt_miss`, logs `increment` with `shotId`; `UNDO` on `increment` with `shotId` filters that shot from `shotChart`; `REMOVE_LAST_SHOT` pops last shot and reverts stat when the last log entry matches that shot; `buildSyncFingerprint` includes `shotChart`.

3. **`src/pages/ShotChart.tsx`** — Renders `state.shotChart`, `onCourtTap` → `ADD_SHOT` (uses `isThreePointer` / `classifyShotZone` on tap `x,y`), made/missed toggle + player strip; **Undo** dispatches `UNDO` (same as Game Tracker for shot-originated increments).

4. **Cloud open-game hydrates** (`Games.tsx`, `PlayerProfile.tsx`, `CareerStats.tsx`) — `shotChart` from `HydratedCloudGame` when migration **032** is applied.

**Files touched:** `src/types.ts`, `src/context/GameContext.tsx`, `src/pages/ShotChart.tsx`, `Games.tsx`, `PlayerProfile.tsx`, `CareerStats.tsx`

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

**Implemented:**

1. **`UNDO_LAST_SHOT`** — Only undoes when the last `actionLog` entry has `shotId` (chart-originated increment). **`UNDO`** still reverses any last action (Game Tracker bar).

2. **`applyUndoLastEntry`** — Shared helper used by `UNDO`, `UNDO_LAST_SHOT`, `REMOVE_LAST_SHOT`, and **`CLEAR_SHOT_CHART`**.

3. **`CLEAR_SHOT_CHART`** — Confirmed on the shot chart page; repeatedly undoes tail log entries while they still match the tail of `shotChart` (reverts chart-shot stats; leaves stat-button-only history intact).

4. **`REMOVE_LAST_SHOT`** — If the last log line does not match the last shot, only pops `shotChart` (no stat change).

5. **Shot chart UI** — "Undo last shot" + subtitle from last shot log (`Last: #12 2PT Made`, etc.); hint when last action was not chart-originated; **Clear all chart shots** with confirm.

6. **Game Tracker** — `title` tooltip on basketball **2PT / 2PT Miss / 3PT / 3PT Miss / FT / FT Miss** stat tiles: chart records location; grid taps are stats-only.

**Files touched:** `src/types.ts`, `src/context/GameContext.tsx`, `src/pages/ShotChart.tsx`, `src/pages/GameTracker.tsx`

**Test breakpoint:**
- Chart shots + stat-button shots → additive counts; undo last shot only when chart was last; clear chart restores stat-button-only totals for chart-backed stats
- Undo chart shot from Game Tracker → marker removed (unchanged from SC-3)

**Commit message:** `feat: polish shot chart undo coordination and stat sync edge cases`

---

### SC-5: Game Summary Shot Chart View

**Design ref:** [SHOT_CHART §8](DESIGN_SHOT_CHART.md)

**Depends on:** SC-4 (shots are reliably stored and synced with stats)

**Blocks:** Nothing

**Implemented:**

1. **`src/components/shot-chart/ShootingSummary.tsx`** — `shots: ShotRecord[]`; aggregates by `shot.zone` (restricted, paint, mid_range, three) plus total; compact 3+2 grid (row 2: 3PT + Total).

2. **`src/pages/GameSummary.tsx`** — **Shot chart** tab when `sport.id === 'basketball'` and `shotChart.length > 0`; read-only `<BasketballCourt shots={shotChart} />` and `<ShootingSummary />`. Tab hidden if no chart shots (including non-basketball).

3. **`src/pages/ShotChart.tsx`** — `ShootingSummary` below the court.

**Files touched:** `ShootingSummary.tsx`, `GameSummary.tsx`, `ShotChart.tsx`

**Test breakpoint:**
- Record chart shots → Summary → Shot chart tab → court + zone grid
- No tab when `shotChart` is empty

**Commit message:** `feat: add shot chart visualization and zone breakdown to Game Summary`

---

### SC-6: Database Migration & Cloud Sync

**Design ref:** [SHOT_CHART §4.5](DESIGN_SHOT_CHART.md)

**Depends on:** SC-3 (GameState has `shotChart` array)

**Blocks:** SC-7

**Implemented:**

1. **`supabase/migrations/032_shot_chart.sql`** — Table `shot_chart` with `game_id`, `player_id`, `recorded_by`, **`client_shot_id`** (stable `ShotRecord.id` for idempotent replace), `x`, `y`, `made`, `shot_type`, `zone`, `created_at`. Unique `(game_id, recorded_by, client_shot_id)`. RLS: team members **select** on games in their teams; **insert/update/delete own** rows (`recorded_by = auth.uid()`), aligned with `game_stats`.

2. **`syncGameSnapshotToCloud`** — After `upsertGameStats`, **`syncShotChartToCloud`**: for basketball only, **delete** `shot_chart` where `(game_id, recorded_by) = (…, userId)`, then **insert** all `state.shotChart` rows with mapped `player_id`. If the table is missing (old DB), delete/insert errors are ignored so sync still succeeds.

3. **`hydrateCloudGameFromRow`** — For `sportId === 'basketball'`, **select** `shot_chart` for `(game_id, recorded_by)`; map remote `player_id` → local via `playerIdMap`; build `HydratedCloudGame.shotChart`. **`buildHydratedStateFromCloudGame`** / **Games** / **PlayerProfile** / **CareerStats** use `cloudGame.shotChart`.

**Files touched:** `032_shot_chart.sql`, `cloudSync.ts`, `GameContext.tsx`, `Games.tsx`, `PlayerProfile.tsx`, `CareerStats.tsx`

**Test breakpoint:**
- Apply migration → record chart shots → sync → rows in `shot_chart`
- Resume game → markers restored
- Game delete cascades rows

**Commit message:** `feat: add shot_chart table migration and cloud sync support`

---

### SC-7: Polish & Edge Cases

**Design ref:** [SHOT_CHART §5.4, §5.5, §9.1](DESIGN_SHOT_CHART.md)

**Depends on:** SC-4 (undo works), SC-5 (summary works), SC-6 (cloud works)

**Blocks:** Nothing — this is the final polish pass.

**Implemented:**

1. **Haptic** — `navigator.vibrate?.(10)` when a chart shot is recorded (`ShotChart` tap handler).

2. **Marker pulse** — `@keyframes shot-marker-pulse` in `index.css`; newest shot id passed to `BasketballCourt` as `newlyPlacedShotId` briefly after `ADD_SHOT` lands in state.

3. **Markers** — Slightly stronger green/red fills and strokes for contrast on hardwood.

4. **Tap debounce** — `BasketballCourt` overlay ignores taps within **120ms** (`TAP_DEBOUNCE_MS`).

5. **Game Tracker badge** — 🏀 **Shot chart** + numeric badge when `shotChart.length > 0` (cap display `99+`).

6. **Clear all** — `ConfirmDialog` (same component as Games/Teams) instead of `window.confirm`.

7. **Empty state** — Two-line centered SVG text on the court when interactive and `shots.length === 0`.

**Files touched:** `ShotChart.tsx`, `BasketballCourt.tsx`, `GameTracker.tsx`, `index.css`

**Completion checklist (human):**

- [ ] **Apply Supabase migration `032_shot_chart.sql`** if not already run (required for shot chart cloud sync — see SC-6 / README migration list).
- Smoke: record shots, debounce, clear confirm, badge, summary tab, cloud round-trip after migration.

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
