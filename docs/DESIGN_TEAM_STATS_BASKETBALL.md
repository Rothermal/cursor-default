# Design: Basketball Team Stats

Basketball-specific team stat categories, foul/bonus rules, half tracking, and UI details for the team-level stat tracking feature.

**Parent doc:** [DESIGN_TEAM_STATS_TRACKING.md](DESIGN_TEAM_STATS_TRACKING.md)

**Status:** Design phase.

---

## 1. Basketball Team Stat Categories

These are the stat categories that appear when a team pseudo-player (home or opponent) is selected in the Game Tracker. They replace the per-player stat categories (`scoring`, `rebounds`, `playmaking`, `other`).

### 1.1 Team Fouls (period-scoped)

The most important team stat. Drives bonus indicators.

| Stat ID Pattern | Label | Short Label | Notes |
|----------------|-------|-------------|-------|
| `team_foul_p{N}` | Team Foul | TF | Period-scoped; `N` = current period (1, 2, OT1, etc.) |

- Rendered as a single "Team Foul" button. The stat ID is dynamically constructed: `team_foul_p${currentPeriod}`.
- The button shows the **current period's foul count** (e.g., `5`), not the game total.
- A small subtitle below the button shows the game total across all periods: `(Total: 12)`.

### 1.2 Timeouts (period-scoped initially, configurable later)

| Stat ID Pattern | Label | Short Label | Notes |
|----------------|-------|-------------|-------|
| `team_to_used` | Timeout Used | TO | Counter — not period-scoped in v1 |

- v1: simple increment counter ("Timeouts Used: 3").
- Future: configurable total per game/half (e.g., "3 of 5 remaining"). This requires season config to define the timeout limit. See [DESIGN_TEAM_STATS_SEASON_CONFIG.md](DESIGN_TEAM_STATS_SEASON_CONFIG.md).
- Display: show count. When season config provides a limit, show `{used} / {limit}` and optionally highlight when nearing the limit.

### 1.3 Technical Fouls

| Stat ID | Label | Short Label | Notes |
|---------|-------|-------------|-------|
| `team_tech` | Technical Foul | TECH | Not period-scoped; game-wide count |

- Technical fouls are not subject to bonus rules (separate from team fouls).
- Flagrant fouls could be tracked here or as a sub-stat in the future.

### 1.4 Team Turnovers

| Stat ID | Label | Short Label | Notes |
|---------|-------|-------------|-------|
| `team_turnover` | Team Turnover | TTO | Not attributable to a specific player |

- Covers turnovers that are team-level events (e.g., shot clock violations, 5-second inbound violations). Individual player turnovers are tracked on the player.
- Optional — some coaches prefer tracking all turnovers on individual players. Including it here gives coaches flexibility.

### 1.5 Possession Arrow (toggle-style, future)

| Stat ID | Label | Short Label | Notes |
|---------|-------|-------------|-------|
| `team_poss_arrow` | Possession Arrow | POSS | Binary toggle: 0 or 1 |

- Indicates whether the team has the possession arrow (for jump ball alternation).
- This is a toggle, not a counter. UI should show a toggle switch, not a +/- button.
- **Defer to v2** — toggle-style stats need special UI treatment that isn't worth building for v1.

---

## 2. SportConfig: Basketball `teamCategories`

```typescript
// In src/config/sports.ts, basketball sport config:
{
  id: 'basketball',
  name: 'Basketball',
  icon: '🏀',
  theme: { /* existing */ },
  scoreLabel: 'Points',
  keyStatIds: ['ast', 'stl', 'blk'],
  categories: [ /* existing per-player categories */ ],

  teamCategories: [
    {
      id: 'team_fouls',
      name: 'Fouls',
      color: 'rose',
      actions: [
        {
          id: 'team_foul',  // actual stat ID will be team_foul_p{N} at runtime
          label: 'Team Foul',
          shortLabel: 'TF',
          periodScoped: true,  // NEW flag — tells GameTracker to append _p{N}
        },
      ],
      showTotal: true,
      totalLabel: 'Period Fouls',
    },
    {
      id: 'team_misc',
      name: 'Team',
      color: 'slate',
      columns: 2,
      hideHeader: true,
      actions: [
        { id: 'team_to_used', label: 'Timeout', shortLabel: 'TO' },
        { id: 'team_tech', label: 'Technical', shortLabel: 'TECH' },
        { id: 'team_turnover', label: 'Turnover', shortLabel: 'TTO' },
      ],
    },
  ],
  teamKeyStatIds: ['team_foul', 'team_to_used', 'team_tech'],
}
```

### 2.1 The `periodScoped` Flag

A new optional flag on `StatAction`:

```typescript
interface StatAction {
  // ... existing fields ...
  periodScoped?: boolean  // NEW — if true, stat ID is suffixed with _p{currentPeriod}
}
```

When `periodScoped` is true, the GameTracker:
1. Constructs the actual stat ID as `${action.id}_p${currentPeriod}` (e.g., `team_foul_p1`).
2. Reads/writes `player.stats[actualStatId]` instead of `player.stats[action.id]`.
3. The button value shows the current period's count.
4. A subtitle shows the game-wide total (sum of all `team_foul_p*` values).

This keeps the `StatAction` definition clean while the runtime handles period scoping.

---

## 3. Foul Bonus Rules

### 3.1 Standard Rulesets

| Ruleset | Period Type | 1-and-1 Threshold | Double Bonus Threshold | Notes |
|---------|-------------|-------------------|----------------------|-------|
| **NFHS / High School** | Half (2 halves) | 7th foul | 10th foul | Most common for youth/HS basketball |
| **NCAA / College** | Half (2 halves) | 7th foul | 10th foul | Same as HS |
| **NBA** | Quarter (4 quarters) | — (no 1-and-1) | 5th foul | NBA goes straight to bonus (2 FTs) |
| **FIBA** | Quarter (4 quarters) | — (no 1-and-1) | 5th foul | Similar to NBA |
| **Youth Rec** | Varies | Often 7th foul | Often 10th foul | Varies by league; configurable |

### 3.2 Default Configuration

The app defaults to **NFHS / High School** rules (the most common scenario for StatKeeper's target audience — youth and high school basketball):

```typescript
const DEFAULT_BASKETBALL_BONUS_CONFIG = {
  periodsPerGame: 2,         // halves
  periodLabels: ['1st Half', '2nd Half'],
  bonusThreshold: 7,         // 1-and-1 starts at this foul count
  doubleBonusThreshold: 10,  // double bonus starts at this foul count
  hasOneAndOne: true,        // false for NBA/FIBA (they skip to double bonus)
  overtimeLabel: 'OT',
  overtimeFoulsReset: true,  // fouls reset each OT period
}
```

These defaults can be overridden per season. See [DESIGN_TEAM_STATS_SEASON_CONFIG.md](DESIGN_TEAM_STATS_SEASON_CONFIG.md).

### 3.3 Bonus Indicator Logic

```typescript
function getBonusStatus(
  foulCount: number,
  config: BonusConfig
): 'none' | 'one_and_one' | 'double_bonus' {
  if (foulCount >= config.doubleBonusThreshold) {
    return 'double_bonus'
  }
  if (config.hasOneAndOne && foulCount >= config.bonusThreshold) {
    return 'one_and_one'
  }
  if (!config.hasOneAndOne && foulCount >= config.bonusThreshold) {
    return 'double_bonus'  // NBA/FIBA: no 1-and-1, straight to bonus
  }
  return 'none'
}
```

### 3.4 Bonus Indicator Component

The `BasketballBonusIndicator` component renders based on bonus status:

```
┌──────────────────────────────────────────────┐
│                                              │
│  Foul Status: none                           │
│  (no indicator shown)                        │
│                                              │
├──────────────────────────────────────────────┤
│                                              │
│  ⚠️  1-AND-1 (7th foul)                     │  ← amber background
│  Next foul: opponent shoots 1-and-1          │
│                                              │
├──────────────────────────────────────────────┤
│                                              │
│  🔴 DOUBLE BONUS (10th foul)                │  ← red background
│  Next foul: opponent shoots 2 free throws    │
│                                              │
└──────────────────────────────────────────────┘
```

The indicator appears above the stat buttons when a team pseudo-player is active. It updates instantly as fouls are recorded.

**Approaching bonus hint**: When the foul count is within 2 of a threshold, show a subtle hint:

```
│  Fouls: 5                                    │
│  ℹ️ 2 fouls from 1-and-1                     │  ← small, muted text
```

---

## 4. Period (Half) Toggle

### 4.1 UI

A segmented control showing the available periods:

```
[ 1st Half ]  [ 2nd Half ]  [ + OT ]
     ↑ active (highlighted)
```

- Tapping a period button sets `currentPeriod` in game state.
- The "**+ OT**" button adds a new overtime period (incrementing the period count).
- Active period is highlighted with the sport theme color.
- Period labels come from the season config (defaulting to "1st Half", "2nd Half").

### 4.2 Period and Stat IDs

When the coach is in "1st Half" and taps "Team Foul":
- `INCREMENT_STAT` fires with `statId: 'team_foul_p1'`
- When they switch to "2nd Half" and tap "Team Foul":
- `INCREMENT_STAT` fires with `statId: 'team_foul_p2'`

Both values live in `player.stats`:
```json
{
  "team_foul_p1": 8,
  "team_foul_p2": 4,
  "team_to_used": 3,
  "team_tech": 1
}
```

### 4.3 Game Total Aggregation

For display and summary purposes, the total foul count across all periods is computed by summing all `team_foul_p*` keys:

```typescript
function getTeamFoulTotal(stats: Record<string, number>): number {
  return Object.entries(stats)
    .filter(([key]) => key.startsWith('team_foul_p'))
    .reduce((sum, [, value]) => sum + value, 0)
}
```

---

## 5. Game Tracker Layout (Basketball Team View)

When a basketball team pseudo-player is active, the stat grid area renders:

```
┌──────────────────────────────────────────────┐
│  ← Home        🏀 Basketball        Summary →│
│                                              │
│  ┌─────────────────────────────────────────┐ │
│  │  Champlin Rebels  62   vs   Osseo  54   │ │  ← Scoreboard (unchanged)
│  └─────────────────────────────────────────┘ │
│                                              │
│  [★ Rebels] [★ Osseo] [#23 MJ] [#11 SN] ...│ │  ← Player selector
│                                              │
│  ── Tracking: Champlin Rebels (Team) ──────  │  ← Context label
│                                              │
│  [ 1st Half ]  [ 2nd Half ]  [ + OT ]       │  ← Period toggle
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  ⚠️ 1-AND-1 — 7th team foul          │    │  ← Bonus indicator
│  │  Next foul: opponent shoots 1-and-1  │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  FOULS                   Period Fouls: 8     │
│  ┌──────────────────────────────────┐        │
│  │          Team Foul               │        │  ← single wide button
│  │              8                   │        │
│  │         (Game: 12)               │        │  ← game total subtitle
│  └──────────────────────────────────┘        │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ Timeout  │ │Technical │ │ Turnover │     │
│  │    3     │ │    1     │ │    2     │     │
│  └──────────┘ └──────────┘ └──────────┘     │
│                                              │
│  Game Notes                                  │
│  ┌──────────────────────────────────────┐    │
│  │ Add notes about the game…           │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  ─────────────────────────────────────────── │
│  Last: Rebels TF +          [ ↩ Undo ]       │  ← undo bar
└──────────────────────────────────────────────┘
```

### 5.1 Undo Label for Team Stats

The undo bar currently shows `#${player.number} ${statLabel} ${direction}`. For team pseudo-players, it should show the team name instead:

```
Last: Rebels TF +        ← team foul increment
Last: Brawlers TO +      ← opponent timeout increment
Last: #23 3PT +          ← normal player stat (unchanged)
```

The logic: if `player.isTeamPlayer`, show first word of `player.name` instead of `#${player.number}`.

---

## 6. Game Summary: Basketball Team Stats View

### 6.1 Layout

Within the Game Summary, a new section (or tab) for team stats:

```
┌──────────────────────────────────────────────┐
│  Game Summary                                │
│  Rebels 62  vs  Brawlers 54                  │
│  Spring Invitational · Mar 5, 2026           │
│                                              │
│  [Players] [Team Stats]                      │  ← tabs
│                                              │
│  ──── Team Fouls ────────────────────────── │
│                                              │
│         Rebels    Brawlers                   │
│  1H       8         5                        │
│  2H       4         7                        │
│  Total   12        12                        │
│                                              │
│  Bonus Events:                               │
│  • Rebels: 1-and-1 in 1st Half (7th foul)   │
│  • Rebels: Double Bonus in 1st Half (10th)   │
│  • Brawlers: 1-and-1 in 2nd Half (7th foul) │
│                                              │
│  ──── Timeouts / Other ─────────────────── │
│                                              │
│         Rebels    Brawlers                   │
│  TO       3         4                        │
│  TECH     1         0                        │
│  TTO      2         3                        │
│                                              │
└──────────────────────────────────────────────┘
```

### 6.2 Side-by-Side Comparison

If both home and opponent team stats were tracked, show them side-by-side. If only one was tracked, show that team's stats only.

### 6.3 Bonus Event Log

Bonus events are not stored — they're derived from foul counts and thresholds. The summary iterates through each period's foul count and reports which thresholds were crossed:

```typescript
function getBonusEvents(
  stats: Record<string, number>,
  config: BonusConfig,
  periodCount: number
): BonusEvent[] {
  const events: BonusEvent[] = []
  for (let p = 1; p <= periodCount; p++) {
    const fouls = stats[`team_foul_p${p}`] || 0
    if (config.hasOneAndOne && fouls >= config.bonusThreshold) {
      events.push({ period: p, type: 'one_and_one', foulCount: config.bonusThreshold })
    }
    if (fouls >= config.doubleBonusThreshold) {
      events.push({ period: p, type: 'double_bonus', foulCount: config.doubleBonusThreshold })
    }
  }
  return events
}
```

---

## 7. Edge Cases

| Scenario | Behavior |
|----------|----------|
| **Coach forgets to switch periods** | All fouls go under the wrong period. The period toggle is always visible and the bonus indicator provides indirect feedback (if fouls seem oddly high, the coach may realize). No auto-detection — keep it simple. |
| **Overtime** | Coach taps "+ OT" to add an overtime period. Fouls tracked under `team_foul_p3` (or higher). OT foul reset is configurable (default: yes). |
| **Multiple overtimes** | Each OT gets its own period. Period selector grows: `1st Half`, `2nd Half`, `OT1`, `OT2`, etc. |
| **Game resumed from cloud** | Period state and all period-scoped stats are restored from `player.stats` keys. `currentPeriod` is persisted in `GameState`. |
| **No season config set** | Defaults apply (2 halves, 1-and-1 at 7, double bonus at 10). |
| **NBA-style rules configured** | `hasOneAndOne: false`. Bonus indicator goes straight to "BONUS" at the 5th foul. No 1-and-1 banner. |
| **Only tracking one team** | If the coach only checks out the home team player, opponent team stats are empty. Summary shows "Not tracked" for the opponent column. |

---

## 8. Future Enhancements

1. **Timeout countdown display** — Show "2 of 5 remaining" instead of just "2 used" when season config provides a timeout limit.
2. **Possession arrow toggle** — Binary toggle stat with special UI (switch, not +/- button).
3. **Quarter-based tracking** — For NBA/FIBA rules, 4 quarters instead of 2 halves. The period system already supports this — just change the config.
4. **Live score contribution from team fouls** — Some leagues score technical foul free throws differently. This is an edge case for later.
5. **Foul trouble per player** — Cross-reference individual player fouls (from per-player tracking) with team foul totals. Show which players are in foul trouble.
6. **In-game foul alerts** — Push notification or prominent alert when a key player reaches N personal fouls (e.g., 3 fouls in the 1st half). Separate from team bonus indicators.

---

## 9. File References

| File | Relevance |
|------|-----------|
| `src/config/sports.ts` | Add `teamCategories` to basketball config |
| `src/types.ts` | Add `periodScoped?` to `StatAction`, `isTeamPlayer?` and `teamSide?` to `Player` |
| `src/pages/GameTracker.tsx` | Render team categories, period toggle, bonus indicator when team player active |
| `src/pages/GameSummary.tsx` | Add "Team Stats" tab with per-period foul table, bonus events, side-by-side comparison |
| `src/components/team-stats/BasketballBonusIndicator.tsx` | New component for bonus/1-and-1 banner |
| `src/components/team-stats/PeriodToggle.tsx` | New component for half/period selector |

---

*Document version: 0.1 (design phase)*
