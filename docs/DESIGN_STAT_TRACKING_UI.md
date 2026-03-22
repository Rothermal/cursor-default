# Design: Stat Tracking UI Redesign

Redesign the stat viewing pages to support **career stats**, **season-scoped stats**, and **game stats split into player and team views**. Builds on the seasons data model from [DESIGN_SEASONS_DATA_MODEL.md](DESIGN_SEASONS_DATA_MODEL.md).

### Progress (live)

| Item | Status |
|------|--------|
| Migration `020_stat_tracking_ui_rpcs.sql` (`get_player_game_log`, `get_career_stats_resolved`, `get_team_game_log`) | Done in repo — apply in Supabase |
| Leaderboard season selector + `seasonId` URL + GP + Team Stats link | Done |
| Player Profile season label + Career link + inline game log (RPC + fallback) | Done |
| Career page `/career` | Done |
| Team Season Summary `/team-stats` | Done (MVP: record, totals, game list) |
| Tournament stats page + `get_tournament_stats_resolved` RPC | Done (`021_tournament_stats_rpc.sql`, `/tournament-stats`) |
| Game Summary Players / Team tab | Done (toggle on summary) |
| `SportConfig.keyStats` + shared compact line helper | Done (`keyStatIds` on all sports + `statDisplay.ts`) |

Detailed checklist: [STAT_TRACKING_UI_PROGRESS.md](STAT_TRACKING_UI_PROGRESS.md).

---

## 1. Current State

### 1.1 Existing Pages

| Page | Route | What it shows | Data source |
|------|-------|---------------|-------------|
| **Game Summary** | `/summary` | Per-player stat table + team totals for one game; M/A shooting; admin corrections | Local state or `get_game_stats_resolved` RPC |
| **Leaderboard** | `/leaderboard` | Team-scoped season totals; ranked by score or any stat; click → Player Profile | `get_season_stats_resolved` RPC |
| **Player Profile** | `/player?teamId=&playerId=` | One player's season totals (grid of stat cards) + game log (list of games with "View" button) | `get_season_stats_resolved` RPC filtered to one player; `game_stats` for game log |

### 1.2 Gaps

- **No career view.** A player who played on multiple teams across seasons has no way to see lifetime totals or a per-season breakdown.
- **No season scoping.** Leaderboard and Player Profile are scoped to a team, which currently IS a season. After the seasons redesign, we need explicit season selectors.
- **Game Summary is combined.** Player stats and team totals are in the same table. No dedicated team stats view or standalone per-player game stat line.
- **No per-game stat detail on Player Profile.** The game log shows the game list but no inline stat lines — you have to click "View" to load the full Game Summary.
- **No team summary page.** No single page showing aggregated team stats across a season (total points scored, total rebounds, etc. as a team).

---

## 2. Proposed Stat View Hierarchy

```
Stats
├── Career Stats (/career?playerId=)
│     All-time stats across every season and team
│     Per-season breakdown table
│     Career totals and averages
│
├── Season Stats
│     ├── Leaderboard (/leaderboard?seasonId=&teamId=)
│     │     Team roster ranked by stat; season-scoped
│     │
│     ├── Player Season Profile (/player?teamId=&playerId=)
│     │     Season totals + game log with inline stat lines
│     │
│     └── Team Season Summary (/team-stats?teamId=)
│           Aggregated team totals for a season
│           Per-game team stat lines
│           Tournament list with W/L and placement
│
├── Tournament Stats (/tournament-stats?tournamentId=&teamId=)
│     W/L record and placement (user-entered: 1st, 2nd, etc.)
│     Tournament-scoped team totals
│     Tournament leaderboard (per-player)
│     Game list within the tournament
│
└── Game Stats
      ├── Player Game Stats (within Game Summary)
      │     Per-player stat table (existing)
      │
      └── Team Game Stats (within Game Summary)
            Team totals row (existing, but elevated)
```

---

## 3. Page Designs

### 3.1 Career Stats — NEW PAGE

**Route:** `/career?playerId=`

**Purpose:** Show a player's all-time stats across every team and season they've played on. This is the "baseball card" view.

**Data source:** New RPC `get_career_stats_resolved(p_player_id)` that aggregates resolved stats across all finalized games the player has participated in, grouped by season/team.

#### Layout

```
┌──────────────────────────────────────────────┐
│  ← Career Stats                              │
│  #23 Michael Jordan                          │
├──────────────────────────────────────────────┤
│                                              │
│  Career Totals                               │
│  ┌────────┐ ┌────────┐ ┌────────┐           │
│  │ PTS    │ │ REB    │ │ AST    │           │
│  │ 1,247  │ │ 432    │ │ 198    │           │
│  │ 15.6/g │ │ 5.4/g  │ │ 2.5/g  │           │
│  └────────┘ └────────┘ └────────┘           │
│  ... (all stats in grid)                     │
│                                              │
│  80 games across 4 seasons                   │
│                                              │
│  ──────────────────────────────────────────  │
│                                              │
│  Season Breakdown                            │
│                                              │
│  ▸ Spring League 2026 — Rebels b7c gray     │
│    20 games · 312 PTS (15.6/g) · 108 REB    │
│                                              │
│  ▸ Fall League 2026 — Rebels b8b white      │
│    18 games · 285 PTS (15.8/g) · 97 REB     │
│                                              │
│  ▸ Winter League 2027 — Eagles Blue         │
│    22 games · 340 PTS (15.5/g) · 121 REB    │
│                                              │
│  ▸ Spring League 2027 — Eagles Blue         │
│    20 games · 310 PTS (15.5/g) · 106 REB    │
│                                              │
│  (tap to expand → shows full stat grid)      │
│                                              │
└──────────────────────────────────────────────┘
```

#### Entry Points

- Player Profile page → "View Career Stats" link
- Leaderboard → long-press or secondary action on a player row
- Teams page → roster player → career stats link

#### RPC

```sql
CREATE OR REPLACE FUNCTION get_career_stats_resolved(p_player_id uuid)
RETURNS TABLE (
  season_id uuid,
  season_name text,
  team_id uuid,
  team_name text,
  sport text,
  stat_id text,
  games_played bigint,
  total bigint,
  per_game_avg numeric,
  season_high int
) AS $$
  WITH game_resolved AS (
    SELECT
      s.id AS season_id,
      s.name AS season_name,
      t.id AS team_id,
      t.name AS team_name,
      s.sport,
      g.id AS game_id,
      r.stat_id,
      r.value
    FROM games g
    JOIN teams t ON t.id = g.team_id
    JOIN seasons s ON s.id = t.season_id
    CROSS JOIN LATERAL get_game_stats_resolved(g.id) r
    WHERE r.player_id = p_player_id
      AND g.status = 'final'
  )
  SELECT
    season_id,
    season_name,
    team_id,
    team_name,
    sport,
    stat_id,
    COUNT(DISTINCT game_id) AS games_played,
    SUM(value) AS total,
    ROUND(AVG(value), 1) AS per_game_avg,
    MAX(value)::int AS season_high
  FROM game_resolved
  GROUP BY season_id, season_name, team_id, team_name, sport, stat_id
  ORDER BY MIN(g.game_date);
$$ LANGUAGE sql STABLE SECURITY INVOKER;
```

> **Note:** The `CROSS JOIN LATERAL` on `get_game_stats_resolved` may be slow for players with many games. If performance is a concern, we can create a materialized approach or a dedicated career stats cache. Start with the RPC and optimize if needed.

---

### 3.2 Season Stats — Leaderboard (UPDATED)

**Route:** `/leaderboard?seasonId=&teamId=`

**Changes from current:**

1. **Season selector.** Add a season dropdown above the team selector. When a season is selected, the team list filters to teams in that season. Default: most recent season.
2. **Team Season Summary link.** Add a "Team Stats" button/link that navigates to the Team Season Summary page for the selected team.
3. **Inline score in player rows.** Already exists (score + sort).
4. **Games played count** next to each player's score.

#### Updated Layout

```
┌──────────────────────────────────────────────┐
│  ← Season Leaderboard                        │
│  Resolved stats across finalized games       │
├──────────────────────────────────────────────┤
│                                              │
│  Season                                      │
│  ┌──────────────────────────────────────┐   │
│  │ Spring League 2026              ▾    │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  Team            [Team Stats →]              │
│  ● Rebels b7c gray                           │
│  ○ Eagles Blue                               │
│                                              │
│  Sort by: [Points ▾]                         │
│                                              │
│  1. #23 Michael Jordan    312 PTS  20 GP     │
│  2. #11 Steve Nash        287 PTS  20 GP     │
│  3. #33 Larry Bird        245 PTS  18 GP     │
│  ...                                         │
│                                              │
└──────────────────────────────────────────────┘
```

---

### 3.3 Player Season Profile (UPDATED)

**Route:** `/player?teamId=&playerId=`

**Changes from current:**

1. **Inline game stat lines.** Each game in the game log shows a compact stat line (key stats) instead of just the date and opponent. Tapping still opens full Game Summary.
2. **Career Stats link.** "View Career Stats →" button at the top navigates to `/career?playerId=`.
3. **Season context label.** Show the season name in the header (derived from team → season).

#### Updated Layout

```
┌──────────────────────────────────────────────┐
│  ← Player Profile                            │
│  #23 Michael Jordan                          │
│  Rebels b7c gray · Spring League 2026        │
│                                     [Career →]│
├──────────────────────────────────────────────┤
│                                              │
│  Season Totals                               │
│  ┌────────┐ ┌────────┐ ┌────────┐           │
│  │ PTS    │ │ REB    │ │ AST    │           │
│  │ 312    │ │ 108    │ │ 52     │           │
│  │ 15.6/g │ │ 5.4/g  │ │ 2.6/g  │           │
│  │ high 28│ │ high 12│ │ high 7 │           │
│  └────────┘ └────────┘ └────────┘           │
│  20 games played                             │
│                                              │
│  ──────────────────────────────────────────  │
│                                              │
│  Game Log                                    │
│                                              │
│  Mar 5 vs Tigers                     [View]  │
│  18 PTS · 6 REB · 3 AST · 2 STL             │
│                                              │
│  Mar 1 vs Lions                      [View]  │
│  22 PTS · 4 REB · 5 AST · 1 BLK             │
│                                              │
│  Feb 26 vs Bears                     [View]  │
│  14 PTS · 8 REB · 2 AST · 3 STL             │
│                                              │
└──────────────────────────────────────────────┘
```

#### Game Log Stat Lines — Data Source

The current game log loads game IDs from `game_stats` then fetches game metadata. To show inline stat lines, we also need the resolved stat values per game. Options:

- **Option A:** Call `get_game_stats_resolved` for each game in the log. Simple but N+1 queries.
- **Option B:** New RPC `get_player_game_log(p_player_id, p_team_id)` that returns per-game stat lines in one query.
- **Recommendation:** Option B for performance.

```sql
CREATE OR REPLACE FUNCTION get_player_game_log(
  p_player_id uuid,
  p_team_id uuid
)
RETURNS TABLE (
  game_id uuid,
  game_date date,
  opponent_name text,
  stat_id text,
  value int
) AS $$
  SELECT
    g.id AS game_id,
    g.game_date,
    g.opponent_name,
    r.stat_id,
    r.value
  FROM games g
  CROSS JOIN LATERAL get_game_stats_resolved(g.id) r
  WHERE g.team_id = p_team_id
    AND g.status = 'final'
    AND r.player_id = p_player_id
  ORDER BY g.game_date DESC, r.stat_id;
$$ LANGUAGE sql STABLE SECURITY INVOKER;
```

---

### 3.4 Team Season Summary — NEW PAGE

**Route:** `/team-stats?teamId=`

**Purpose:** Aggregated team-level stats for a season. "How did the team perform as a whole?"

#### Layout

```
┌──────────────────────────────────────────────┐
│  ← Team Stats                                │
│  🏀 Rebels b7c gray                          │
│  Spring League 2026                          │
├──────────────────────────────────────────────┤
│                                              │
│  Season Record                               │
│  ┌──────────┐ ┌──────────┐                  │
│  │ 15 W     │ │ 5 L      │                  │
│  │ .750     │ │ 20 games │                  │
│  └──────────┘ └──────────┘                  │
│                                              │
│  Team Season Totals                          │
│  ┌────────┐ ┌────────┐ ┌────────┐           │
│  │ PTS    │ │ REB    │ │ AST    │           │
│  │ 1,120  │ │ 540    │ │ 220    │           │
│  │ 56.0/g │ │ 27.0/g │ │ 11.0/g │           │
│  └────────┘ └────────┘ └────────┘           │
│                                              │
│  Team Per-Opponent (optional — show if >0)   │
│  │ Opponent │ PTS │ OPP │ +/- │  W/L │      │
│  │ Tigers   │ 62  │ 54  │ +8  │  2-0 │      │
│  │ Lions    │ 55  │ 58  │ -3  │  1-1 │      │
│  │ Bears    │ 48  │ 45  │ +3  │  1-0 │      │
│                                              │
│  ──────────────────────────────────────────  │
│                                              │
│  Tournaments                                 │
│                                              │
│  🏆 Spring Invitational        4-1  🥈 2nd   │
│  🏆 March Madness Qualifier    3-0  🥇 1st   │
│                                              │
│  ──────────────────────────────────────────  │
│                                              │
│  Game-by-Game                                │
│                                              │
│  Mar 5 vs Tigers           W 62-54           │
│  56 PTS · 28 REB · 12 AST                   │
│                                              │
│  Mar 1 vs Lions            L 55-58           │
│  55 PTS · 24 REB · 10 AST                   │
│                                              │
└──────────────────────────────────────────────┘
```

#### Data Sources

- **Win/Loss record:** Computed client-side from games where `status = 'final'`. Compare team score (sum of player scoring stats + home_score_adjustment) vs opponent_score.
- **Team season totals:** Sum all players' resolved stats across all finalized games. Can reuse `get_season_stats_resolved` and aggregate across players.
- **Per-opponent breakdown:** Group finalized games by `opponent_name`, compute W/L and total PTS/OPP.
- **Tournament list:** Query `tournaments` for the team; compute per-tournament W/L from games where `tournament_id` matches; show `tournaments.placement` (if set). Each row links to Tournament Stats page.
- **Game-by-game:** List of finalized games with team totals per game.

#### New RPC (optional)

If computing team totals client-side from `get_season_stats_resolved` is sufficient, no new RPC is needed. The existing RPC returns per-player stats; the page sums them across players.

For the game-by-game team stat lines, we can reuse `get_game_stats_resolved` per game, or create:

```sql
CREATE OR REPLACE FUNCTION get_team_game_log(p_team_id uuid)
RETURNS TABLE (
  game_id uuid,
  game_date date,
  opponent_name text,
  opponent_score int,
  home_score_adjustment int,
  stat_id text,
  team_total bigint
) AS $$
  SELECT
    g.id AS game_id,
    g.game_date,
    g.opponent_name,
    g.opponent_score,
    COALESCE(g.home_score_adjustment, 0) AS home_score_adjustment,
    r.stat_id,
    SUM(r.value) AS team_total
  FROM games g
  CROSS JOIN LATERAL get_game_stats_resolved(g.id) r
  WHERE g.team_id = p_team_id
    AND g.status = 'final'
  GROUP BY g.id, g.game_date, g.opponent_name, g.opponent_score, g.home_score_adjustment, r.stat_id
  ORDER BY g.game_date DESC, r.stat_id;
$$ LANGUAGE sql STABLE SECURITY INVOKER;
```

---

### 3.5 Tournament Stats — NEW PAGE

**Route:** `/tournament-stats?tournamentId=&teamId=`

**Purpose:** W/L record and placement for a specific tournament. Shows how the team performed within that tournament, independent of the broader season.

#### Layout

```
┌──────────────────────────────────────────────┐
│  ← Tournament Stats                         │
│  🏆 Spring Invitational                      │
│  Rebels b7c gray · Spring League 2026        │
├──────────────────────────────────────────────┤
│                                              │
│  Record & Placement                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ 4 W      │ │ 1 L      │ │ 🥈 2nd   │    │
│  │ .800     │ │ 5 games  │ │ Placement │    │
│  └──────────┘ └──────────┘ └──────────┘    │
│                                              │
│  Tournament Team Totals                      │
│  ┌────────┐ ┌────────┐ ┌────────┐           │
│  │ PTS    │ │ REB    │ │ AST    │           │
│  │ 310    │ │ 135    │ │ 58     │           │
│  │ 62.0/g │ │ 27.0/g │ │ 11.6/g │           │
│  └────────┘ └────────┘ └────────┘           │
│                                              │
│  ──────────────────────────────────────────  │
│                                              │
│  Tournament Leaderboard                      │
│  1. #23 Michael Jordan   82 PTS  5 GP        │
│  2. #11 Steve Nash       71 PTS  5 GP        │
│  3. #33 Larry Bird       63 PTS  4 GP        │
│                                              │
│  ──────────────────────────────────────────  │
│                                              │
│  Games                                       │
│                                              │
│  Mar 8 vs Tigers (Final)       W 62-54       │
│  Mar 8 vs Bears (Semi)         W 58-50       │
│  Mar 7 vs Lions (Pool)         W 55-48       │
│  Mar 7 vs Hawks (Pool)         L 49-52       │
│  Mar 7 vs Wolves (Pool)        W 64-51       │
│                                              │
└──────────────────────────────────────────────┘
```

#### Placement

Placement (1st, 2nd, 3rd, etc.) is **user-entered**, not auto-computed. Tournaments have varied bracket formats that can't be reliably inferred from game results alone.

**Schema change:** Add `placement` column to `tournaments` table:

```sql
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS placement int;
```

- Nullable. NULL = no placement recorded yet.
- The user sets placement from the Tournament Stats page or from a tournament management section.
- Display: medal emoji for top 3 (🥇 1st, 🥈 2nd, 🥉 3rd), plain ordinal for 4th+.

#### Data Sources

- **W/L record:** Filter games by `tournament_id`, compute team score vs opponent score for each finalized game (same logic as Team Season Summary).
- **Tournament team totals:** Sum all players' resolved stats across tournament games.
- **Tournament leaderboard:** Per-player totals scoped to tournament games, ranked by score.
- **Placement:** `tournaments.placement` column.

#### RPC

```sql
CREATE OR REPLACE FUNCTION get_tournament_stats_resolved(p_tournament_id uuid)
RETURNS TABLE (
  player_id uuid,
  stat_id text,
  games_played bigint,
  total bigint,
  per_game_avg numeric,
  tournament_high int
) AS $$
  WITH game_resolved AS (
    SELECT g.id AS game_id, r.player_id, r.stat_id, r.value
    FROM games g
    CROSS JOIN LATERAL get_game_stats_resolved(g.id) r
    WHERE g.tournament_id = p_tournament_id
      AND g.status = 'final'
  )
  SELECT
    player_id,
    stat_id,
    COUNT(DISTINCT game_id) AS games_played,
    SUM(value) AS total,
    ROUND(AVG(value), 1) AS per_game_avg,
    MAX(value)::int AS tournament_high
  FROM game_resolved
  GROUP BY player_id, stat_id;
$$ LANGUAGE sql STABLE SECURITY INVOKER;
```

#### Entry Points

- Team Season Summary → tournament list with "View" links
- Games page → tournament filter → "Tournament Stats" link
- Game Setup → tournament dropdown → secondary action

---

### 3.6 Game Summary — Player vs Team Split (UPDATED)

**Route:** `/summary` (existing)

**Changes from current:**

The current Game Summary already has both per-player rows and a "Team" totals row at the bottom of each stat category table. The proposed change is **presentational**, not structural:

1. **Tab toggle: "Players" / "Team"**
   - **Players tab** (default): Current per-player stat table. Unchanged.
   - **Team tab**: Shows only the team totals row for each category, plus a score comparison card (Team Score vs Opponent Score) and high-level game indicators (total rebounds, total assists, etc. in a stat grid similar to the career/season totals grid).

2. **No new data needed.** Team totals are already computed client-side by summing player stats. This is purely a UI split for readability.

#### Team Tab Layout

```
┌──────────────────────────────────────────────┐
│  Game Summary                                │
│  Rebels 62  vs  Tigers 54                    │
│  Spring Invitational · Mar 5, 2026           │
│                                              │
│  [Players] [Team]                            │
│                                              │
│  Team Totals                                 │
│  ┌────────┐ ┌────────┐ ┌────────┐           │
│  │ PTS    │ │ REB    │ │ AST    │           │
│  │ 62     │ │ 28     │ │ 12     │           │
│  └────────┘ └────────┘ └────────┘           │
│  ┌────────┐ ┌────────┐ ┌────────┐           │
│  │ STL    │ │ BLK    │ │ TO     │           │
│  │ 8      │ │ 3      │ │ 11     │           │
│  └────────┘ └────────┘ └────────┘           │
│                                              │
│  Shooting                                    │
│  FT: 12/15 (80%) · 2PT: 14/28 (50%)        │
│  3PT: 6/18 (33%)                             │
│                                              │
└──────────────────────────────────────────────┘
```

---

## 4. Navigation Flow

```
Home (SportSelect)
  ├── Season Leaderboard (/leaderboard)
  │     ├── Player Season Profile (/player)
  │     │     ├── Career Stats (/career)
  │     │     └── View Game → Game Summary (/summary)
  │     └── Team Season Summary (/team-stats)
  │           └── Tournament Stats (/tournament-stats)
  │
  ├── Game Tracker (/game) → Game Summary (/summary)
  │     └── Players / Team tab toggle
  │
  └── Cloud Games (/games) → Game Summary (/summary)
```

New navigation links to add:

| From | To | Trigger |
|------|----|---------|
| Leaderboard | Team Season Summary | "Team Stats →" button |
| Player Profile | Career Stats | "Career →" button in header |
| Teams page (roster) | Career Stats | Career link per player |
| Team Season Summary | Tournament Stats | Tournament row in tournament list |
| Game Summary | (existing) Players/Team toggle | Tab buttons |
| Home (SportSelect) | Leaderboard | Existing "Season Stats" link |

---

## 5. Routing

| Route | Page | New? |
|-------|------|------|
| `/leaderboard` | Season Leaderboard | Updated |
| `/player` | Player Season Profile | Updated |
| `/career` | Career Stats | **New** |
| `/team-stats` | Team Season Summary | **New** |
| `/tournament-stats` | Tournament Stats | **New** |
| `/summary` | Game Summary | Updated |

---

## 6. New RPCs Summary

| RPC | Purpose | Params |
|-----|---------|--------|
| `get_career_stats_resolved` | Career stats grouped by season/team | `p_player_id` |
| `get_player_game_log` | Per-game stat lines for one player on a team | `p_player_id`, `p_team_id` |
| `get_team_game_log` | Per-game team totals for a team's season | `p_team_id` |
| `get_tournament_stats_resolved` | Per-player stats scoped to a tournament | `p_tournament_id` |

Existing RPCs unchanged:
- `get_game_stats_resolved(p_game_id)` — per-game resolved stats
- `get_season_stats_resolved(p_team_id)` — season aggregates per player

---

## 7. Implementation Phases

| Phase | What | Depends On |
|-------|------|------------|
| **1. RPCs** | Create `get_career_stats_resolved`, `get_player_game_log`, `get_team_game_log`, `get_tournament_stats_resolved` migration; add `tournaments.placement` column | Seasons schema (DESIGN_SEASONS_DATA_MODEL Phase 1) |
| **2. Season Scoping** | Add season selector to Leaderboard; filter teams by season | Seasons schema |
| **3. Player Profile Update** | Inline game stat lines in game log; "Career →" link; season context label | Phase 1 RPCs |
| **4. Career Stats Page** | New `/career` route and page; career totals + per-season breakdown; sport selector | Phase 1 RPCs |
| **5. Team Season Summary** | New `/team-stats` route and page; W/L record, team totals, game-by-game, tournament list with W/L and placement | Phase 1 RPCs |
| **6. Tournament Stats Page** | New `/tournament-stats` route and page; tournament W/L, placement badge, tournament leaderboard, game list | **Done** (migration `021` + page; link from Team stats) |
| **7. Game Summary Split** | Players/Team tab toggle on Game Summary | **Done** (no backend deps) |

Phase 7 (Game Summary split) has no backend dependencies and can be done in parallel with other phases.

---

## 8. Stat Display Conventions

Consistent stat display patterns across all pages:

| Pattern | Format | Example |
|---------|--------|---------|
| Total | plain number | `312` |
| Per-game average | number with 1 decimal + `/g` | `15.6/g` |
| Season/career high | `high` + number | `high 28` |
| Games played | number + `GP` or `games` | `20 GP` |
| Shooting | `M/A (pct%)` | `12/15 (80%)` |
| Win/Loss | `W` or `L` + scores | `W 62-54` |
| Plus/minus | signed number | `+8` |
| Placement | medal emoji for top 3, ordinal for 4th+ | `🥇 1st`, `🥈 2nd`, `🥉 3rd`, `4th` |
| Compact stat line | `stat value` joined by ` · ` | `18 PTS · 6 REB · 3 AST` |

### Key Stats for Compact Lines

Each sport should define a "key stats" list (3-5 stats shown in compact game log lines). For basketball:

```typescript
const BASKETBALL_KEY_STATS = ['score', 'reb_total', 'ast', 'stl', 'blk']
```

This could be configured per sport in `sports.ts` as a new `SportConfig.keyStats` field.

---

## 9. Resolved Decisions

1. **Career stats across sports** — **Sport selector.** When a player has stats in multiple sports, the career page shows a sport picker at the top. One sport at a time; each sport gets its own stat grid and per-season breakdown.

2. **Performance of `LATERAL` joins** — **Monitor and optimize.** Start with the RPC approach. If performance degrades at scale (100+ games per player), introduce a materialized stats cache or pre-computed career_stats table.

3. **Offline career stats** — **"Cloud required" message.** Career stats page shows a clear message that cloud is needed. Season/game stats for the current local game continue to work offline.

4. **Team Season Summary — W/L computation.** Reuse existing `computePlayerScore` logic. Team score = sum of all player scoring stats + `home_score_adjustment` per game.

---

## 10. File References

| File | Relevance |
|------|-----------|
| `src/pages/Leaderboard.tsx` | Season leaderboard — update with season selector |
| `src/pages/PlayerProfile.tsx` | Player profile — add inline stat lines, career link |
| `src/pages/GameSummary.tsx` | Game summary — add Players/Team tab toggle |
| `src/config/sports.ts` | Sport config — add `keyStats` field for compact lines |
| `src/types.ts` | TypeScript types — may need new interfaces for career/game-log data |
| `src/App.tsx` | Router — add `/career` and `/team-stats` routes |
| `supabase/migrations/010_resolved_stats_rpcs.sql` | Current resolved RPCs — new RPCs extend this |
| `docs/DESIGN_SEASONS_DATA_MODEL.md` | Seasons schema — prerequisite for season scoping |
