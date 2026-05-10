# Design: Team-Level Stat Tracking

Track stats at the **team** level (fouls, timeouts, turnovers, etc.) alongside existing per-player tracking. A coach or assistant can select a "team player" in the same Game Tracker UI and record stats that make sense as aggregate team events — not attributable to any individual.

**Status:** **Implemented** (basketball on `stattracker`). Opponent column is optional; other sports can add `teamCategories` later.

**Related docs:**
- [DESIGN_TEAM_STATS_BASKETBALL.md](DESIGN_TEAM_STATS_BASKETBALL.md) — basketball-specific team stat categories, foul/bonus rules, half tracking
- [DESIGN_TEAM_STATS_SEASON_CONFIG.md](DESIGN_TEAM_STATS_SEASON_CONFIG.md) — season-level configuration for team stat rules (timeout limits, bonus thresholds, etc.)
- [DESIGN_TEAM_STATS_DATA_MODEL.md](DESIGN_TEAM_STATS_DATA_MODEL.md) — database schema changes, cloud sync, migration plan
- [DESIGN_TEAM_STATS_IMPLEMENTATION.md](DESIGN_TEAM_STATS_IMPLEMENTATION.md) — step-by-step implementation plan, work units, parallel agent strategy, test breakpoints
- [DESIGN_SEASONS_DATA_MODEL.md](DESIGN_SEASONS_DATA_MODEL.md) — existing seasons/teams data model
- [INTEGRATION_PLAN.md](../INTEGRATION_PLAN.md) — overall architecture and phase plan

---

## 1. Vision

A coach opens a game in StatKeeper. In the player selector strip at the top of the Game Tracker, two special entries are pinned to the left: **"Champlin Rebels"** (home team) and **"Osseo Brawlers"** (opponent team). These look and feel like the individual player buttons but are visually distinct — they represent team-level stat tracking.

When the coach taps "Champlin Rebels," the stat grid changes to show team-specific stats: **team fouls**, **timeouts**, **technical fouls**, and a prominent **bonus indicator** (e.g., "1-AND-1" or "BONUS"). The coach taps the foul button each time a foul is called. When the 7th foul registers, a banner appears: **⚠️ 1-AND-1**. At the 10th: **🔴 DOUBLE BONUS**.

There's a toggle for **1st Half / 2nd Half** at the top of the team stat view. When the coach switches halves, the foul count display resets contextually (the underlying data is preserved — the toggle just controls which period's fouls are shown and active).

The coach can also tap "Osseo Brawlers" to track the opponent's team fouls, timeouts, etc. — useful for comparing against official paper stat sheets after the game.

After the game, the Game Summary shows a **Team Stats** section alongside the existing per-player tables, with team fouls per half, timeouts used, and bonus events.

---

## 2. Core Concept: Team Pseudo-Players

The key design decision is to represent each team (home and opponent) as a **pseudo-player** in the existing `Player` list. This reuses the entire stat tracking pipeline with minimal changes:

- The `Player` type, `INCREMENT_STAT` / `DECREMENT_STAT` actions, undo log, cloud sync, and `game_stats` table all work as-is.
- The Game Tracker UI switches which stat categories to render based on whether the active "player" is a team pseudo-player.
- Team pseudo-players are excluded from the team score computation (they don't contribute points to the scoreboard).

### 2.1 Pseudo-Player Shape

```typescript
interface Player {
  id: string
  name: string
  number: string
  stats: Record<string, number>
  isTeamPlayer?: boolean       // NEW — distinguishes team pseudo-players
  teamSide?: 'home' | 'opponent' // NEW — which side this team player represents
}
```

When a game starts, two pseudo-players are auto-injected:

| Field | Home Team Player | Opponent Team Player |
|-------|-----------------|---------------------|
| `id` | `'__team_home__'` | `'__team_opp__'` |
| `name` | `gameInfo.teamName` (e.g., "Champlin Rebels") | `gameInfo.opponentName` (e.g., "Osseo Brawlers") |
| `number` | `'★'` | `'★'` |
| `stats` | `{}` | `{}` |
| `isTeamPlayer` | `true` | `true` |
| `teamSide` | `'home'` | `'opponent'` |

### 2.2 Player Selector Behavior

- Team pseudo-players are **always pinned to the left** of the player selector strip, before all individual players.
- They are **visually distinct**: different background color/pattern (e.g., a gradient or team-colored badge instead of a solid circle), a "★" icon instead of a jersey number, and the full team name instead of a first name.
- **Sort order**: Home team → Opponent team → Individual players (in original order).
- The player selector should group these with a subtle visual separator (thin divider or spacing gap) between team players and individual players.

### 2.3 Stat Category Switching

When a team pseudo-player is active, the `GameTracker` renders the sport's **`teamCategories`** instead of `categories`. This is a new field on `SportConfig`:

```typescript
interface SportConfig {
  id: string
  name: string
  icon: string
  theme: SportTheme
  categories: StatCategory[]           // per-player stats (existing)
  teamCategories?: StatCategory[]      // team-level stats (NEW)
  scoreLabel: string
  keyStatIds?: string[]
  teamKeyStatIds?: string[]            // for team stat compact lines (NEW)
}
```

If `teamCategories` is undefined or empty for a sport, the team pseudo-players are not injected and team tracking is not available for that sport.

### 2.4 Score Exclusion

The `Scoreboard` component computes the home score as `sum(computePlayerScore(player))` for all players. Team pseudo-players must be **excluded** from this sum. The filter is simple:

```typescript
const computedTeamScore = players
  .filter(p => !p.isTeamPlayer)
  .reduce((total, player) => total + computePlayerScore(sport, player.stats), 0)
```

Similarly, Game Summary stat tables, leaderboards, season stats, and career stats must filter out team pseudo-players when computing individual player aggregates.

### 2.5 Cloud Sync Considerations

Team pseudo-player stats are synced to `game_stats` like any other player. The `__team_home__` and `__team_opp__` IDs need a mapping strategy for cloud games. See [DESIGN_TEAM_STATS_DATA_MODEL.md](DESIGN_TEAM_STATS_DATA_MODEL.md) for the full cloud sync plan.

---

## 3. Half / Period Tracking

Basketball (and other sports) track some team stats per period (e.g., fouls per half). This requires a lightweight period concept in the game state.

### 3.1 Game State Addition

```typescript
interface GameState {
  // ... existing fields ...
  currentPeriod: number  // NEW — 1-indexed (1 = first half/period, 2 = second, etc.)
}
```

Default value: `1`. A simple toggle in the team stat view switches between periods. The toggle is a UI control — not a separate game state for each period. Instead, team stat IDs are **period-scoped** by convention:

```
team_foul_p1, team_foul_p2    // fouls per period
team_to_used_p1, team_to_used_p2  // timeouts used per period
```

When the coach records a team foul, the stat ID includes the current period: `team_foul_p{currentPeriod}`. This means:

- No special period-aware state management — it's just stat IDs with a naming convention.
- The period toggle controls which stat IDs the buttons increment.
- All periods' stats are stored simultaneously in `player.stats` and synced normally.
- Summary views can aggregate across periods or show per-period breakdowns.

### 3.2 Period Toggle UI

The period toggle appears **only when a team pseudo-player is active** and the sport has period-scoped team stats. It sits between the player selector and the stat grid:

```
┌──────────────────────────────────────────┐
│  [★ Rebels] [★ Brawlers] [#23 MJ] ...   │  ← player selector
├──────────────────────────────────────────┤
│         [ 1st Half ]  [ 2nd Half ]       │  ← period toggle (team only)
├──────────────────────────────────────────┤
│  Team Fouls: 4        ⚠️ 1-AND-1 at 7    │  ← bonus indicator
│  ┌────────┐ ┌────────┐ ┌────────┐       │
│  │ Foul   │ │ T.O.   │ │ Tech   │       │  ← team stat buttons
│  │   4    │ │   2    │ │   0    │       │
│  └────────┘ └────────┘ └────────┘       │
│  ...                                     │
└──────────────────────────────────────────┘
```

### 3.3 Bonus Indicators

Bonus indicators are **derived** from the current period's foul count — never stored as stats. The logic is sport-specific and configurable per season. For basketball:

| Threshold | Indicator | Visual |
|-----------|-----------|--------|
| 7 fouls (configurable) | 1-AND-1 | ⚠️ amber banner |
| 10 fouls (configurable) | DOUBLE BONUS | 🔴 red banner |

These thresholds are **season-configurable** (see [DESIGN_TEAM_STATS_SEASON_CONFIG.md](DESIGN_TEAM_STATS_SEASON_CONFIG.md)). The indicator component reads the foul count for the active period and the season's configured thresholds, then renders the appropriate banner.

---

## 4. Game Flow Changes

### 4.1 Game Start — Auto-inject Team Pseudo-Players

When navigating from `PlayerSetup` → `GameTracker` (or `GameCheckout` → `GameTracker`), the app checks:

1. Does the selected sport have `teamCategories`?
2. Are team pseudo-players not already in the player list?

If both are true, inject the two team pseudo-players at the front of the `players` array via `SET_PLAYERS` or a new `INJECT_TEAM_PLAYERS` action.

**Timing**: This happens at the transition to `GameTracker`, not during `PlayerSetup`. Team pseudo-players should not appear in the roster setup UI — they are implicit.

### 4.2 Checkout Flow — Opt-in

In the `GameCheckout` screen (cloud games), team pseudo-players appear in the checkout list. They are **not auto-checked-out**. A coach opts in to tracking team stats by checking them out, just like individual players.

The checkout entry for a team player looks different:

```
┌─────────────────────────────────────────┐
│  ★  Champlin Rebels (Team Stats)    ○   │  ← team checkout
│  ★  Osseo Brawlers (Team Stats)     ○   │  ← opponent team checkout
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│  🏀 #23 Michael Jordan              ✓   │  ← player checkout
│  🏀 #11 Steve Nash                  ✓   │
│  ...                                     │
└─────────────────────────────────────────┘
```

### 4.3 Game Summary — Team Stats Section

The Game Summary adds a **"Team"** section (or tab) showing:

- **Per-period breakdown**: Fouls, timeouts for each half/period.
- **Totals**: Aggregate team stats across all periods.
- **Bonus events**: Which periods hit 1-and-1 or double bonus.
- **Comparison view**: Home team stats side-by-side with opponent team stats (if both were tracked).

This is separate from the existing "Team tab" in Game Summary (which shows aggregated player stats). The team pseudo-player stats are a new category.

### 4.4 Undo

Undo works identically to individual player stats. The `UNDO` action pops the last action log entry and restores the previous value. Since team stats use the same `INCREMENT_STAT` / `DECREMENT_STAT` actions with the team pseudo-player's ID, undo is free.

---

## 5. Sport Scalability

### 5.1 Sport-Specific Team Categories

Each sport defines its own `teamCategories` independently. Basketball's team categories are very different from baseball's or soccer's. This is by design — team stats are inherently sport-specific.

The `teamCategories` field on `SportConfig` is optional. Sports without team-level tracking simply omit it, and no team pseudo-players are injected.

### 5.2 Per-Sport Design Docs

As team tracking is added to each sport, a dedicated design doc should be created:

| Sport | Design Doc | Status |
|-------|-----------|--------|
| Basketball | [DESIGN_TEAM_STATS_BASKETBALL.md](DESIGN_TEAM_STATS_BASKETBALL.md) | In design |
| Baseball | `DESIGN_TEAM_STATS_BASEBALL.md` | Planned |
| Football | `DESIGN_TEAM_STATS_FOOTBALL.md` | Planned |
| Hockey | `DESIGN_TEAM_STATS_HOCKEY.md` | Planned |
| Soccer | `DESIGN_TEAM_STATS_SOCCER.md` | Planned |

### 5.3 Component Naming and Sport-Specific UI

As team stats evolve, some components may need sport-specific rendering. The current plan uses a single `GameTracker` that renders different `teamCategories` per sport — the stat buttons themselves are sport-agnostic. However, indicator components (like the basketball bonus banner) are sport-specific.

**Naming convention for sport-specific components:**

```
src/components/
  team-stats/
    BasketballBonusIndicator.tsx   ← basketball-specific
    BasketballPeriodToggle.tsx     ← basketball half toggle
    TeamStatHeader.tsx             ← shared across sports
    // future:
    FootballPenaltyTracker.tsx     ← football-specific
    HockeyPowerPlayIndicator.tsx   ← hockey-specific
```

If the visual look-and-feel diverges significantly between sports, the `GameTracker` can delegate to sport-specific sub-components when a team pseudo-player is active:

```typescript
// In GameTracker, when activePlayer.isTeamPlayer:
if (sport.id === 'basketball') {
  return <BasketballTeamTracker player={activePlayer} period={currentPeriod} ... />
}
// default fallback: generic team stat grid
return <GenericTeamTracker player={activePlayer} ... />
```

This keeps the door open for radically different UIs per sport without over-engineering now.

---

## 6. Implementation Phases

| Phase | What | Dependencies | Complexity |
|-------|------|-------------|------------|
| **1. Types & Config** | Add `isTeamPlayer`, `teamSide`, `currentPeriod` to types; add `teamCategories` to `SportConfig`; define basketball team categories | None | Low — type changes, config additions |
| **2. Team Pseudo-Player Injection** | Auto-inject home + opponent team players on game start; pin to left of selector; visual distinction | Phase 1 | Medium — GameTracker + PlayerSetup flow changes |
| **3. Stat Category Switching** | GameTracker renders `teamCategories` when team player is active; period toggle UI | Phase 2 | Medium — conditional rendering in GameTracker |
| **4. Bonus Indicators** | Basketball-specific bonus/1-and-1 banner; derived from foul count + season config thresholds | Phase 3, Phase 6 | Medium — new component, season config reads |
| **5. Game Summary Integration** | Team stats section in GameSummary; per-period breakdown; home vs opponent comparison | Phase 3 | Medium — new summary section |
| **6. Season Configuration** | Season config screen for timeout limits, bonus thresholds, period count | Phase 1 | Medium — new UI, schema changes; see [DESIGN_TEAM_STATS_SEASON_CONFIG.md](DESIGN_TEAM_STATS_SEASON_CONFIG.md) |
| **7. Cloud Sync** | Map team pseudo-player IDs to cloud `players` / `game_stats`; exclude from individual stats | Phase 2 | Medium — cloudSync.ts changes; see [DESIGN_TEAM_STATS_DATA_MODEL.md](DESIGN_TEAM_STATS_DATA_MODEL.md) |
| **8. Checkout Integration** | Team pseudo-players in GameCheckout; opt-in | Phase 2, Phase 7 | Low — filter + visual tweak in GameCheckout |
| **9. Score Exclusion & Filtering** | Exclude team pseudo-players from Scoreboard, Leaderboard, PlayerProfile, CareerStats, season RPCs | Phase 2 | Low — add `isTeamPlayer` filter in key computation paths |
| **10. Additional Sports** | Define `teamCategories` for baseball, football, hockey, soccer | Phase 1 pattern established | Per-sport — see individual design docs |

### Phase Ordering Recommendation

Start with **Phases 1–3** (types, injection, category switching) to get the core flow working locally. Then **Phase 6** (season config) so the bonus thresholds are configurable before building **Phase 4** (bonus indicators). **Phase 5** (summary) and **Phase 7** (cloud sync) can proceed in parallel. **Phase 8–9** are low-effort cleanup. **Phase 10** is ongoing as each sport is designed.

---

## 7. Files Affected (Breadcrumbs)

This section maps each affected file to the changes needed, so an implementing agent can trace the work.

| File | Changes | Phase |
|------|---------|-------|
| `src/types.ts` | Add `isTeamPlayer?`, `teamSide?` to `Player`; add `currentPeriod` to `GameState`; add `SET_PERIOD` to `GameAction` union | 1 |
| `src/config/sports.ts` | Add `teamCategories` and `teamKeyStatIds` to `SportConfig` interface (move to `types.ts` or keep here); add basketball `teamCategories` | 1 |
| `src/context/GameContext.tsx` | Handle `SET_PERIOD` action; initialize `currentPeriod: 1`; include `currentPeriod` in `loadState` / persistence; exclude team players from `buildSyncFingerprint` score if needed | 1, 3 |
| `src/pages/GameTracker.tsx` | Inject team pseudo-players if not present; pin to left of selector; render `teamCategories` when team player is active; show period toggle; show bonus indicator | 2, 3, 4 |
| `src/components/Scoreboard.tsx` | Filter out `isTeamPlayer` from home score computation | 9 |
| `src/components/StatButton.tsx` | No changes needed — reused as-is for team stats | — |
| `src/pages/GameCheckout.tsx` | Show team pseudo-players with distinct visual; opt-in checkout | 8 |
| `src/pages/GameSummary.tsx` | Add team stats section; per-period breakdown; home vs opponent comparison | 5 |
| `src/pages/PlayerSetup.tsx` | No changes — team pseudo-players are injected later, not in roster setup | — |
| `src/lib/cloudSync.ts` | Map `__team_home__` / `__team_opp__` to cloud player records; handle in `syncGameSnapshotToCloud` and `loadLatestCloudGame` | 7 |
| `src/pages/Leaderboard.tsx` | Filter out team pseudo-players from season leaderboard | 9 |
| `src/pages/PlayerProfile.tsx` | Filter out team pseudo-players | 9 |
| `src/pages/CareerStats.tsx` | Filter out team pseudo-players | 9 |
| **New files** | | |
| `src/components/team-stats/BasketballBonusIndicator.tsx` | Bonus/1-and-1 banner component | 4 |
| `src/components/team-stats/PeriodToggle.tsx` | Half/period toggle component | 3 |
| `src/components/team-stats/TeamStatSummary.tsx` | Game Summary team stats section | 5 |

---

## 8. Open Questions

| # | Question | Recommendation | Status |
|---|----------|---------------|--------|
| 1 | Should overtime be a separate period for foul tracking? | Yes — add "OT" as an additional period option. Fouls reset in OT in most basketball rulesets. Make configurable. | Open |
| 2 | Should the team pseudo-player IDs be deterministic (`__team_home__`, `__team_opp__`) or generated? | Deterministic — simplifies cloud sync mapping and avoids duplicates on re-inject. | Decided: deterministic |
| 3 | Should the period toggle be shared across home and opponent team players, or independent? | Shared — when you switch to "2nd Half," it applies to whichever team player you select. The period is a property of the game, not the team. | Decided: shared |
| 4 | How do we handle mid-game period switches when both teams' fouls should reset? | The period toggle changes `currentPeriod` in game state. Both team players' stat buttons use `currentPeriod` to scope their stat IDs. No special reset needed — the stat IDs inherently separate periods. | Decided |
| 5 | Should team stats appear in the "All Submissions" admin comparison view? | Yes — treat them like any other player's stats. An admin can see which coach recorded what team foul counts. | Decided: yes |

---

## 9. Risks

| Risk | Mitigation |
|------|-----------|
| **Cloud sync complexity** — team pseudo-players need cloud `players` rows but shouldn't pollute real roster | Use a `is_team_placeholder` flag on the cloud `players` table; filter from roster views. See [data model doc](DESIGN_TEAM_STATS_DATA_MODEL.md). |
| **Existing game state** — injecting team pseudo-players into a resumed game | Check for their presence before injecting; use deterministic IDs to avoid duplicates. |
| **Season config not set** — user starts a game without configuring bonus thresholds | Fall back to sport-specific defaults (e.g., basketball defaults: 1-and-1 at 7, double bonus at 10). Season config overrides defaults but is never required. |
| **Component naming collisions** — as sport-specific components grow | Use the `team-stats/` directory and sport-prefixed names from the start. |
| **Performance** — filtering `isTeamPlayer` in multiple locations | The check is O(1) per player, and there are only 2 team players per game. Negligible cost. |

---

*Document version: 0.1 (design phase)*
