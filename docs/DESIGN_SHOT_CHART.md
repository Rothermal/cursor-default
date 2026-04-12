# Design: Basketball Shot Chart

An interactive half-court basketball diagram where a coach taps the court to record shot locations. Shots are marked as **made** (filled circle) or **missed** (X), auto-classified by zone (paint, mid-range, three-point), and integrated with the existing stat tracking pipeline so the same data drives both the shot chart visualization and the stat counters (`2pt`, `2pt_miss`, `3pt`, `3pt_miss`, `ft`).

**Status:** **MVP shipped** in app (court, shot chart page, GameState + cloud sync after migration `032_shot_chart.sql`, Game Summary tab, polish). This document still describes the full vision; some diagram details differ from the shipped court — see [DESIGN_SHOT_CHART_IMPLEMENTATION.md](DESIGN_SHOT_CHART_IMPLEMENTATION.md) **Status** for work-unit notes and intentional MVP deltas.

**Related docs:**
- [DESIGN_TEAM_STATS_TRACKING.md](DESIGN_TEAM_STATS_TRACKING.md) — team pseudo-player architecture (shot chart will support team-level tracking first)
- [DESIGN_TEAM_STATS_BASKETBALL.md](DESIGN_TEAM_STATS_BASKETBALL.md) — basketball-specific stat categories
- [DESIGN_SHOT_CHART_IMPLEMENTATION.md](DESIGN_SHOT_CHART_IMPLEMENTATION.md) — step-by-step implementation plan

---

## 1. Vision

A coach opens the Game Tracker during a basketball game. Below the scoreboard, alongside the existing stat button grid, there's a **"Shot Chart"** button. Tapping it opens a full-screen half-court view rendered as an SVG.

The half court shows standard markings: three-point arc, free throw lane, free throw circle, restricted area, and the basket. The court uses clean, minimalist lines on a light hardwood-textured background that matches the app's orange basketball theme.

The coach is in **"Made Shot"** mode (toggle at the top). They tap the spot on the court where a player shot from. A **green filled circle** appears at that location. The app auto-detects whether the shot was inside or outside the three-point arc and records it as a `2pt` or `3pt` stat accordingly. The existing stat counters in the Game Tracker update automatically.

The coach switches to **"Missed Shot"** mode. They tap the court again. A **red X** appears. The app records a `2pt_miss` or `3pt_miss`.

Free throws are handled separately — they're not location-based, so the coach uses the existing FT stat buttons for those (the shot chart doesn't replace the FT buttons).

At the end of the game, the Game Summary shows a shot chart visualization: all shots plotted on the half court with made/missed markers, plus zone-based shooting percentages (e.g., "Paint: 8/14 (57%)", "Mid-range: 3/8 (38%)", "Three: 4/12 (33%)").

---

## 2. Scope & Scaling Strategy

### 2.1 v1: Team-Level Shot Chart

The initial implementation tracks shots at the **team level** — all shots go into a single chart regardless of which player took them. This aligns with the team pseudo-player concept from [DESIGN_TEAM_STATS_TRACKING.md](DESIGN_TEAM_STATS_TRACKING.md).

- The shot chart is accessible from the Game Tracker when the sport is basketball.
- Shots are attributed to the currently active player (or the team pseudo-player if team tracking is active).
- The shot chart data stores x/y coordinates + metadata per shot, not just aggregate counts.

### 2.2 v2: Per-Player Shot Charts

Scale to individual players:
- Player selector on the shot chart lets you switch whose shots are displayed.
- Each shot records the player ID, so charts can be filtered per player.
- Season/career shot chart aggregation: heatmap of all shots across games.

### 2.3 v3: Advanced Visualization

- Heatmaps (hexbin aggregation across games)
- Zone-based efficiency overlays
- Shot chart comparisons between players or between halves
- Opponent shot chart (track where the opposing team shoots from)

### 2.4 What This Doc Covers

This design covers **v1 + the v2 data model** (store player ID from the start even if the UI is team-only at first). v3 is future work not detailed here.

---

## 3. Court Geometry

### 3.1 Coordinate System

The SVG half court uses a coordinate system based on **feet**, matching real court dimensions. The basket (center of the hoop) is the origin.

| Dimension | Value | Notes |
|-----------|-------|-------|
| Court width | 50 ft | Full width, symmetric left/right |
| Half court depth | 47 ft | From baseline to half-court line |
| SVG viewBox | `"-25 0 50 47"` | Origin at basket center (0,0 = basket); x: -25 to +25; y: 0 to 47 |

Using real-foot coordinates means shot locations are meaningful and portable — they could be compared across games, exported, or analyzed with standard basketball analytics tools.

### 3.2 Key Court Features (SVG Elements)

All measurements in feet from the basket center:

| Feature | Geometry | SVG Element |
|---------|----------|-------------|
| **Basket** | Circle, center (0, 0), radius 0.75 ft | `<circle>` |
| **Backboard** | Line, y = -0.5, x: -3 to +3 | `<line>` |
| **Paint / Lane** | Rectangle, 12 ft wide × 19 ft deep, centered | `<rect>` x=-6, y=0, w=12, h=19 |
| **Free throw line** | Line at y = 19, x: -6 to +6 | `<line>` |
| **Free throw circle** | Circle, center (0, 19), radius 6 ft | `<circle>` (top half solid, bottom half dashed) |
| **Restricted area** | Arc, center (0, 0), radius 4 ft, 0° to 180° | `<path>` semicircle |
| **Three-point arc** | Arc, center (0, 0), radius 23.75 ft | `<path>` from corner to corner |
| **Three-point corners** | Vertical lines, x = ±22, y = 0 to ~14 ft | `<line>` (corners are 22 ft from center, not following the arc) |
| **Half-court line** | Line at y = 47, x: -25 to +25 | `<line>` |
| **Half-court circle** | Circle at (0, 47), radius 6 ft, bottom half only | `<path>` |
| **Baseline** | Line at y = 0, x: -25 to +25 | `<line>` |
| **Sidelines** | Lines at x = -25 and x = +25, y: 0 to 47 | `<line>` |

### 3.3 Three-Point Line Classification

A shot is a three-pointer if it originates beyond the three-point arc. The classification logic:

```typescript
function isThreePointer(x: number, y: number): boolean {
  const distFromBasket = Math.sqrt(x * x + y * y)
  // Corner three: x beyond 22ft from center AND within the straight-line zone
  if (Math.abs(x) >= 22 && y <= 14) {
    return true
  }
  // Arc three: distance > 23.75ft from basket
  return distFromBasket > 23.75
}
```

Shots at or behind the half-court line (y >= 47) are still classified as three-pointers (half-court shots are 3s).

### 3.4 Zone Classification (for Summary Stats)

Beyond the binary 2pt/3pt classification, shots are grouped into zones for the summary:

| Zone | Criteria | Color |
|------|----------|-------|
| **Restricted area** | Distance from basket ≤ 4 ft | Deep paint |
| **Paint (non-restricted)** | Inside paint rectangle AND distance > 4 ft | Light paint |
| **Mid-range** | Outside paint but inside three-point line | Mid |
| **Three-point** | Beyond three-point arc or corner lines | Perimeter |

```typescript
type ShotZone = 'restricted' | 'paint' | 'mid_range' | 'three'

function classifyShotZone(x: number, y: number): ShotZone {
  const dist = Math.sqrt(x * x + y * y)
  if (dist <= 4) return 'restricted'
  if (Math.abs(x) <= 6 && y <= 19) return 'paint'
  if (isThreePointer(x, y)) return 'three'
  return 'mid_range'
}
```

---

## 4. Data Model

### 4.1 Shot Record

Each tap on the court creates a shot record:

```typescript
interface ShotRecord {
  id: string                    // unique ID (generated)
  x: number                    // court x coordinate (feet from basket center, -25 to +25)
  y: number                    // court y coordinate (feet from basket, 0 to 47)
  made: boolean                // true = made, false = missed
  shotType: '2pt' | '3pt'     // auto-classified from (x, y)
  zone: ShotZone               // auto-classified zone
  playerId: string             // who took the shot (player ID or team pseudo-player ID)
  timestamp: number            // when the shot was recorded (Date.now())
}
```

### 4.2 Storage in GameState

Shot records are stored as an array in `GameState`:

```typescript
interface GameState {
  // ... existing fields ...
  shotChart: ShotRecord[]      // NEW — all shots in the current game
}
```

Default: `[]`. Persisted to localStorage with the rest of the game state.

### 4.3 Relationship to Existing Stats

Each shot record **also dispatches** the corresponding `INCREMENT_STAT` action:

| Shot | Made | Dispatched Stat |
|------|------|----------------|
| Inside 3pt line | Made | `INCREMENT_STAT(playerId, '2pt')` |
| Inside 3pt line | Missed | `INCREMENT_STAT(playerId, '2pt_miss')` |
| Beyond 3pt line | Made | `INCREMENT_STAT(playerId, '3pt')` |
| Beyond 3pt line | Missed | `INCREMENT_STAT(playerId, '3pt_miss')` |

This means:
- The shot chart and the stat buttons are **two ways to record the same data**. The coach can use whichever they prefer (or both).
- The scoreboard, game summary, leaderboard, etc. all continue to work off the existing stat counters.
- The shot chart adds **location data** on top of the existing stat counts.

**Important caveat for v1:** If a coach records shots via both the stat buttons AND the shot chart, the counts could double. Two approaches to handle this:

- **Option A (recommended for v1):** Treat them as independent. The coach uses one or the other — the shot chart OR the stat buttons for scoring. The undo log handles corrections. Document this in the UI ("Shots recorded here also update your stat counters").
- **Option B (v2):** When the shot chart is active, disable the scoring stat buttons (or show them as read-only, driven by shot chart data). More polished but more complex.

### 4.4 Undo

When a shot is recorded via the shot chart, two things happen:
1. A `ShotRecord` is appended to `shotChart`.
2. An `INCREMENT_STAT` is dispatched (creating an `ActionLogEntry`).

Undo should reverse both:
- A new action type `ADD_SHOT` is added to `GameAction`, which handles adding the shot record. The corresponding `UNDO` logic pops the last shot from `shotChart` when the last action was a shot-chart-originated stat increment.
- Alternative: Store a `shotId` on the `ActionLogEntry` so undo knows to also remove the shot record.

```typescript
// Extended ActionLogEntry:
interface ActionLogEntry {
  // ... existing fields ...
  shotId?: string   // NEW — if this stat was recorded via shot chart, link to the ShotRecord
}
```

When `UNDO` processes an action with `shotId`, it also removes the corresponding `ShotRecord` from `shotChart`.

### 4.5 Cloud Sync

Shot chart data needs a cloud storage strategy. Two options:

**Option A: Separate `shot_chart` table (recommended)**

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
CREATE INDEX idx_shot_chart_player ON shot_chart(game_id, player_id);
```

**Option B: JSONB column on `games`** — Store the entire shot array as a JSONB blob. Simpler but less queryable.

**Recommendation:** Option A — a separate table allows per-shot RLS, per-player queries, and future analytics across games/seasons. The shot chart data is fundamentally relational (each shot belongs to a game + player + recorder).

---

## 5. UI Design

### 5.1 Entry Point: Shot Chart Button

In the Game Tracker, a floating action button (FAB) or a prominent button in the header opens the shot chart:

```
┌──────────────────────────────────────────────┐
│  ← Home        🏀 Basketball        Summary →│
│  ┌─────────────────────────────────────────┐ │
│  │  Rebels  62   vs   Brawlers  54         │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  [#23 MJ] [#11 SN] [#33 LB] ...             │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │       🏀 Shot Chart                    │  │  ← prominent button
│  └────────────────────────────────────────┘  │
│                                              │
│  SCORING             Total Points: 62        │
│  ┌────────┐ ┌────────┐ ┌────────┐           │
│  │   FT   │ │  2PT   │ │  3PT   │           │
│  ...                                         │
```

Alternatively, the shot chart could be a **tab** alongside the stat grid (not a separate route), or a **full-screen overlay/modal**. For mobile-first UX on a phone, a full-screen view is best — the court needs to be as large as possible for accurate tap targeting.

**Recommendation:** Full-screen overlay (`/shot-chart` route or a modal). The coach taps the button, gets the full-screen court, records shots, then taps "Back" to return to the stat grid.

### 5.2 Shot Chart Screen Layout

```
┌──────────────────────────────────────────────┐
│  ← Back to Stats          [Clear All]        │
│                                              │
│  [ ● Made ]  [ ✕ Missed ]                   │  ← mode toggle
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │                                      │    │
│  │            Half Court SVG            │    │
│  │                                      │    │
│  │       ╭─────────────────╮            │    │
│  │      ╱                   ╲           │    │
│  │     │    ● ●              │          │    │
│  │     │       ✕  ●         │          │    │
│  │      ╲     ●  ✕        ╱           │    │
│  │       ╰───┤     ├───╯              │    │
│  │           │  ◯  │                   │    │
│  │    ✕     │     │    ●              │    │
│  │           └─────┘                   │    │
│  │                                      │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ──── Shooting Summary ──────────────────── │
│  Paint: 6/10 (60%)  Mid: 2/5 (40%)          │
│  Three: 3/9 (33%)   Total: 11/24 (46%)      │
│                                              │
│  ↩ Undo Last Shot                            │
└──────────────────────────────────────────────┘
```

### 5.3 Interaction Flow

1. **Select mode**: Coach taps "Made" or "Missed" at the top. Active mode is highlighted. Default: "Made."
2. **Tap the court**: Coach taps approximately where the shot was taken.
3. **Marker appears**: A green circle (made) or red X (missed) appears at the tapped location.
4. **Auto-classify**: The app determines 2pt vs 3pt from the coordinates and dispatches the stat.
5. **Summary updates**: The shooting summary below the court updates in real time.
6. **Undo**: "Undo Last Shot" removes the most recent marker and decrements the corresponding stat.
7. **Back**: Coach taps "Back to Stats" to return to the normal Game Tracker.

### 5.4 Touch Target Considerations

On a mobile phone (320–430px wide), the half court SVG will be roughly 300–400px wide and 280–375px tall. At this scale:

- Each foot on the court ≈ 7–8 pixels
- Touch targets for shots are fine — the coach isn't trying to tap a button, they're tapping a location. Precision to within ~2 feet is sufficient for shot charting.
- Shot markers should be large enough to see (radius ≈ 6–8px in screen space, which is roughly 1 foot in court space).
- Markers should not obscure the court lines. Use semi-transparent fills.

### 5.5 Shot Markers

| Marker | Shape | Color | Size |
|--------|-------|-------|------|
| Made shot | Filled circle | `#22c55e` (green-500) with 80% opacity | radius 0.8 ft |
| Missed shot | X | `#ef4444` (red-500) with 80% opacity | 1.2 ft arm span |

Markers use SVG `<circle>` and `<line>` elements positioned in court coordinates. The SVG `viewBox` handles all scaling.

### 5.6 Mode Toggle

A segmented control at the top:

```
┌───────────────────────────────┐
│  [ ● Made ]  [ ✕ Missed ]    │
└───────────────────────────────┘
```

- **Made** active: green background, white text
- **Missed** active: red background, white text
- Inactive: white background, slate text

The toggle is large and easy to hit — mode switching happens frequently during fast play.

### 5.7 Shooting Summary Bar

Below the court, a compact summary shows shooting percentages by zone:

```
Paint: 6/10 (60%)  |  Mid: 2/5 (40%)  |  3PT: 3/9 (33%)  |  Total: 11/24 (46%)
```

This updates in real time as shots are added/removed.

---

## 6. Court SVG Component

### 6.1 Component API

```typescript
interface BasketballCourtProps {
  shots: ShotRecord[]
  onCourtTap: (x: number, y: number) => void
  width?: number       // CSS width (default: 100%)
  interactive?: boolean // false = view-only (for summary)
}
```

The court component is **reusable** — it renders both in the interactive shot chart (with `onCourtTap`) and in the read-only Game Summary visualization (without tap handler).

### 6.2 SVG Structure

```tsx
<svg viewBox="-25 -2 50 51" preserveAspectRatio="xMidYMid meet">
  {/* Court background */}
  <rect x="-25" y="-2" width="50" height="51" fill="#f5e6c8" />

  {/* Court lines (all in white or dark lines on hardwood) */}
  <g stroke="#c0956e" strokeWidth="0.15" fill="none">
    {/* Baseline, sidelines, half-court */}
    {/* Paint rectangle */}
    {/* Free throw line + circle */}
    {/* Three-point arc + corners */}
    {/* Restricted area arc */}
    {/* Basket + backboard */}
    {/* Half-court line + circle */}
  </g>

  {/* Shot markers */}
  {shots.map(shot => (
    shot.made
      ? <circle key={shot.id} cx={shot.x} cy={shot.y} r="0.8" fill="rgba(34,197,94,0.8)" />
      : <g key={shot.id}>
          <line x1={shot.x-0.6} y1={shot.y-0.6} x2={shot.x+0.6} y2={shot.y+0.6}
                stroke="rgba(239,68,68,0.8)" strokeWidth="0.3" />
          <line x1={shot.x+0.6} y1={shot.y-0.6} x2={shot.x-0.6} y2={shot.y+0.6}
                stroke="rgba(239,68,68,0.8)" strokeWidth="0.3" />
        </g>
  ))}

  {/* Transparent tap target overlay */}
  {interactive && (
    <rect x="-25" y="-2" width="50" height="51" fill="transparent"
          onPointerDown={handleTap} style={{ touchAction: 'none' }} />
  )}
</svg>
```

### 6.3 Tap-to-Coordinate Conversion

The SVG `viewBox` maps court coordinates directly. The tap handler converts screen coordinates to SVG coordinates:

```typescript
function handleTap(e: React.PointerEvent<SVGRectElement>) {
  const svg = e.currentTarget.ownerSVGElement!
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const ctm = svg.getScreenCTM()!.inverse()
  const svgPt = pt.matrixTransform(ctm)
  onCourtTap(svgPt.x, svgPt.y)
}
```

This gives accurate court coordinates regardless of screen size, rotation, or zoom.

### 6.4 Court Orientation

The court is drawn with the **basket at the bottom** — this matches how a coach sitting across from the court sees it, and how most shot chart tools orient the half court (the player shoots "up" toward the viewer).

```
         Half-court line (y=47)
              ___
             /   \
            | mid  |         ← half-court circle
             \___/
                              ← open court
        _______________
       /               \
      /    3PT ARC      \    ← three-point line
     /                   \
    |  ┌───────────────┐  |
    |  │               │  |  ← paint / lane
    |  │    (FT line)  │  |
    |  │               │  |
    |  │   ┌───────┐   │  |
    |  │   │ BASKET│   │  |  ← basket at bottom
    |  └───┴───────┴───┘  |
    ========================  ← baseline (y=0)
```

---

## 7. Game Flow Integration

### 7.1 Accessing the Shot Chart

The shot chart is accessible **only for basketball** (the only sport with shot charting in v1). Access is controlled by the sport config — a new flag `hasShotChart?: boolean` on `SportConfig`.

Two entry points:
1. **Game Tracker** — a prominent "Shot Chart" button below the scoreboard or as a floating action button.
2. **Game Summary** — read-only shot chart visualization in the summary stats.

### 7.2 Shot Chart as a Route vs. Modal

| Approach | Pros | Cons |
|----------|------|------|
| **Route** (`/shot-chart`) | Clean URL, can resume independently, back button works naturally | Leaves Game Tracker page; needs to reconstruct context on return |
| **Modal / overlay** | Stays within Game Tracker context; no route change | More complex state management for fullscreen on mobile |
| **Tab** within GameTracker | No navigation; can switch quickly | Court is smaller (shared space with stat grid) |

**Recommendation:** **Route** (`/shot-chart`). On mobile, the court needs maximum screen real estate. The GameState context (from `GameContext`) persists across routes, so no data is lost when navigating. The "Back to Stats" button navigates back to `/game`.

### 7.3 Checkout Flow — Opt-in

Similar to team stat checkout, the shot chart can be a **checkout-level feature**. In the `GameCheckout` screen, add an option:

```
┌─────────────────────────────────────────┐
│  📋 What are you tracking?              │
│                                          │
│  ✓  Player Stats                        │  ← always on
│  ○  Shot Chart                          │  ← opt-in
│  ○  Team Stats (Fouls, TO, etc.)        │  ← from team stats feature
│                                          │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│  Select players to track:               │
│  ✓  #23 Michael Jordan                  │
│  ✓  #11 Steve Nash                      │
│  ...                                     │
└─────────────────────────────────────────┘
```

For **v1**, skip the checkout integration — the shot chart is always available during a basketball game. Checkout-based toggling is a v2 refinement.

---

## 8. Game Summary Integration

### 8.1 Shot Chart in Summary

The Game Summary gains a "Shot Chart" section (or tab) that shows a read-only court with all shots plotted:

```
┌──────────────────────────────────────────────┐
│  [Players] [Team] [Shot Chart]               │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │         (read-only court SVG)          │  │
│  │      with all shots plotted            │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Shooting by Zone                            │
│  ┌──────────┬──────────┬──────────┐         │
│  │ Restrict │  Paint   │ Mid-Rng  │         │
│  │  4/6     │  4/8     │  2/5     │         │
│  │  67%     │  50%     │  40%     │         │
│  └──────────┴──────────┴──────────┘         │
│  ┌──────────┬──────────────────────┐         │
│  │  3-Point │      TOTAL          │         │
│  │  3/9     │     13/28           │         │
│  │  33%     │      46%            │         │
│  └──────────┴──────────────────────┘         │
│                                              │
└──────────────────────────────────────────────┘
```

### 8.2 Per-Player Filtering (v2)

In v2, the summary shot chart includes a player filter:

```
Filter: [All Players ▾]  [#23 MJ]  [#11 SN]  ...
```

Selecting a player filters the chart to only their shots.

---

## 9. Suggestions and Clarifying Questions

### 9.1 Suggestions You May Not Have Considered

1. **Quick-mode toggle via tap duration**: Instead of a separate Made/Missed toggle, a **short tap = made** and **long press = missed** (or vice versa). This eliminates a toggle step during fast play. The trade-off is discoverability — not obvious to new users. Could be an advanced option.

2. **Shot trail / sequence numbers**: Number each shot marker (1, 2, 3, ...) to show the chronological order. Helps coaches reconstruct game flow. Could be toggled on/off.

3. **Half-by-half view**: In the Game Summary, show separate shot charts for 1st half and 2nd half (reuses the period concept from team stats). Helps identify if shooting patterns changed over the course of the game.

4. **Opponent shot chart**: Just like opponent team stats, a coach could track where the opponent shoots from. Uses the same court component, separate shot array. Useful for game film review.

5. **Court orientation flip**: Some coaches sit on the opposite side. A setting to flip the court (mirror the x-axis) so the baseline is at the top. Configurable per user or per session.

6. **Audio/haptic feedback on tap**: A subtle vibration or click sound on shot registration so the coach knows the tap was registered without looking at the screen. Important during live game situations.

7. **Drag-to-correct**: Allow dragging a shot marker to adjust its position if the coach tapped the wrong spot. Simpler than undo + re-record.

### 9.2 Clarifying Questions

| # | Question | My Recommendation | For You to Decide |
|---|----------|-------------------|-------------------|
| 1 | **Should shot chart data replace or supplement stat button tracking?** The chart dispatches `INCREMENT_STAT` for 2pt/3pt — if the coach also taps the stat button, it double-counts. | v1: document that they're two input methods for the same stats. Coach should use one or the other for scoring. v2: disable scoring stat buttons when shot chart is active. | Is the dual-input caveat acceptable for v1, or do you want mutual exclusion from the start? |
| 2 | **Should the shot chart be a full-screen route or a slide-up panel within Game Tracker?** | Full-screen route — needs max screen real estate on mobile for accurate tapping. | Full screen preferred? Or would you like it to coexist with the stat grid? |
| 3 | **Free throws on the shot chart?** FTs aren't location-based. Should the shot chart have a dedicated FT button (quick-record without tapping the court), or should FTs remain exclusively on the stat buttons? | Include a small "FT Made / FT Missed" button pair on the shot chart screen so coaches don't have to switch back. But no court location for FTs. | Include FT buttons on the shot chart screen? |
| 4 | **Player selector on the shot chart in v1?** Even though v1 is team-level, should there be a player selector so shots can be attributed to individuals from the start (even if the summary view is team-only)? | Yes — record `playerId` on each shot now. Show the player selector on the shot chart. The summary can show all shots regardless, but the data is per-player from day one. | Per-player recording from the start, or truly team-only for v1? |
| 5 | **Cloud persistence format?** Separate `shot_chart` table (relational, queryable) vs. JSONB blob on the `games` row (simpler). | Separate table — enables future per-player, per-season, cross-game analytics. | Relational table, or JSONB to start? |
| 6 | **Court skin / theme?** Plain white court with black lines (clinical), or warm hardwood texture with basketball theme colors? | Warm hardwood — matches the app's basketball orange theme and feels more premium. But must ensure markers are visible on the texture. | Preference on court styling? |

---

## 10. Risks

| Risk | Mitigation |
|------|-----------|
| **Double-counting** — shots recorded via chart AND stat buttons | Document in UI; disable scoring buttons when chart is active (v2) |
| **Tap accuracy on small phones** | Court fills full width; markers are large; undo is one tap away |
| **SVG performance with many shots** — 50+ markers per game | SVG handles hundreds of elements easily; use `key` for React diffing |
| **Court orientation confusion** — which end is which? | Label baseline as "Baseline" or show basket icon; add orientation flip option |
| **Cloud sync of shot array** — large payload | Separate table with individual rows; sync in batches if needed |
| **Undo complexity** — coordinating shot removal + stat decrement | Link via `shotId` on `ActionLogEntry`; single UNDO handles both |

---

## 11. File References

| File | Relevance |
|------|-----------|
| `src/types.ts` | Add `ShotRecord`, `ShotZone`, `shotChart` to `GameState`, `shotId` to `ActionLogEntry` |
| `src/config/sports.ts` | Add `hasShotChart: true` to basketball |
| `src/context/GameContext.tsx` | Handle `ADD_SHOT` / shot-undo logic; persist `shotChart` |
| `src/pages/GameTracker.tsx` | Add "Shot Chart" button; navigate to `/shot-chart` |
| `src/App.tsx` | Add `/shot-chart` route |
| **New files** | |
| `src/components/shot-chart/BasketballCourt.tsx` | Reusable SVG half-court component |
| `src/components/shot-chart/ShotChartPage.tsx` | Full-screen shot chart interaction page |
| `src/components/shot-chart/ShootingSummary.tsx` | Zone-based shooting percentages bar |
| `src/components/shot-chart/courtGeometry.ts` | Court dimensions, `isThreePointer()`, `classifyShotZone()` |

---

*Document version: 0.1 (design phase)*
