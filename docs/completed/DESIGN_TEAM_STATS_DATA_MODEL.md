# Design: Team Stats Data Model & Cloud Sync

Database schema changes, cloud sync strategy, and migration plan for team-level stat tracking. Covers how team pseudo-players are represented in Supabase, how their stats flow through existing RPCs, and what filtering is needed to keep them separate from individual player data.

**Parent doc:** [DESIGN_TEAM_STATS_TRACKING.md](DESIGN_TEAM_STATS_TRACKING.md)

**Related:** [DESIGN_SEASONS_DATA_MODEL.md](DESIGN_SEASONS_DATA_MODEL.md), [INTEGRATION_PLAN.md](../INTEGRATION_PLAN.md)

**Status:** **Implemented** — migrations `027`–`031` (see repo `supabase/migrations/`). `get_game_stats_resolved` return type was not extended for `is_team_placeholder`; filtering uses `players.is_team_placeholder` in RPCs and `get_game_team_stats` for game-level team rows.

---

## 1. Design Constraints

1. **Reuse existing tables wherever possible.** Team pseudo-player stats should flow through `game_stats` like individual player stats. No new stat tables.
2. **Team pseudo-players must not pollute individual player data.** Leaderboards, career stats, season stats, and player profiles must exclude team pseudo-players. This filtering must be reliable at both the app and database levels.
3. **Cloud sync should work with minimal changes.** The existing `syncGameSnapshotToCloud` pipeline handles stat upserts via `game_stats`; team stats should piggyback on this.
4. **Support both home and opponent team tracking.** Both teams are pseudo-players with stats in `game_stats`.
5. **Season config stored alongside season.** The `seasons` table gets a JSONB column for team stat rules.

---

## 2. Schema Changes

### 2.1 `players` Table — Team Placeholder Flag

Add a boolean column to distinguish team pseudo-players from real players:

```sql
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS is_team_placeholder boolean NOT NULL DEFAULT false;
```

Team placeholder players are system-created rows that represent "the team" in `game_stats`. They have:
- `first_name` = team name (e.g., "Champlin Rebels")
- `last_name` = `NULL`
- `is_team_placeholder` = `true`
- `created_by` = the user who created the game (or season owner)

**Why a column instead of a naming convention?** A column is queryable, indexable, and unambiguous. It allows RPCs and RLS policies to reliably filter team placeholders without pattern-matching on names.

### 2.2 `game_stats` Table — No Changes

Team pseudo-player stats are stored in `game_stats` exactly like individual player stats:

```
game_id | player_id (→ team placeholder) | recorded_by | stat_id       | value
--------+-------------------------------+-------------+---------------+------
abc123  | team_home_uuid                | user1       | team_foul_p1  | 8
abc123  | team_home_uuid                | user1       | team_foul_p2  | 4
abc123  | team_home_uuid                | user1       | team_to_used  | 3
abc123  | team_opp_uuid                 | user1       | team_foul_p1  | 5
```

No schema changes to `game_stats`. The `stat_id` values (`team_foul_p1`, `team_to_used`, etc.) are just strings — the table doesn't care what they represent.

### 2.3 `games` Table — Team Placeholder References

Add optional columns to link a game to its team placeholder player records:

```sql
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS home_team_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS opp_team_player_id uuid REFERENCES players(id) ON DELETE SET NULL;
```

These columns let the app and RPCs quickly find the team pseudo-players for a game without scanning `game_stats` or relying on naming conventions. They are set during cloud sync when the team pseudo-players are created/mapped.

### 2.4 `seasons` Table — Team Stats Config

```sql
ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS team_stats_config jsonb DEFAULT '{}'::jsonb;
```

Stores the season-level configuration for team stats (bonus thresholds, period count, timeout limits, etc.). See [DESIGN_TEAM_STATS_SEASON_CONFIG.md](DESIGN_TEAM_STATS_SEASON_CONFIG.md) for the JSON shape.

### 2.5 `team_players` Table — Exclude Team Placeholders

Team placeholder players should **not** appear in team rosters (`team_players`). They are per-game entities, not roster members. The app simply does not create `team_players` rows for them.

If defensive enforcement is desired, a CHECK constraint could be added:

```sql
-- Optional: prevent team placeholders from being added to rosters
-- (app-level enforcement is sufficient for v1)
ALTER TABLE team_players
  ADD CONSTRAINT team_players_no_placeholders
  CHECK (player_id NOT IN (SELECT id FROM players WHERE is_team_placeholder = true));
```

**Recommendation:** Skip the CHECK constraint for v1. App-level enforcement is simpler, and the constraint creates a cross-table dependency that complicates migrations. Revisit if data integrity issues emerge.

---

## 3. Cloud Sync Strategy

### 3.1 Team Pseudo-Player Cloud Mapping

The local app uses deterministic IDs (`__team_home__`, `__team_opp__`) for team pseudo-players. In the cloud, these map to actual `players` rows with `is_team_placeholder = true`.

**Mapping flow in `cloudSync.ts`:**

1. During `syncGameSnapshotToCloud`, check if the game state has team pseudo-players (`player.isTeamPlayer === true`).
2. For each team pseudo-player:
   a. Look up an existing team placeholder player for this team + game by checking `games.home_team_player_id` / `games.opp_team_player_id`.
   b. If none exists, create a new `players` row:
      ```sql
      INSERT INTO players (first_name, last_name, is_team_placeholder, created_by)
      VALUES ('Champlin Rebels', NULL, true, $userId)
      RETURNING id;
      ```
   c. Store the mapping: `cloudSync.playerIdMap['__team_home__'] = cloudPlayerId`.
   d. Update `games.home_team_player_id` (or `opp_team_player_id`) to reference the cloud player.
3. Stats are then upserted into `game_stats` using the cloud player ID, identical to individual player stats.

### 3.2 Loading Cloud Games with Team Stats

When `loadLatestCloudGame` or `loadCloudGameById` loads a game:

1. Check `games.home_team_player_id` and `games.opp_team_player_id`.
2. If set, load those players and their stats from `game_stats`.
3. Map them back to local pseudo-player IDs (`__team_home__`, `__team_opp__`).
4. Include them in the hydrated `players` array with `isTeamPlayer: true` and `teamSide: 'home' | 'opponent'`.

### 3.3 Existing Sync Functions — Changes

| Function | Change |
|----------|--------|
| `syncGameSnapshotToCloud` | Add team pseudo-player creation/lookup; set `games.home_team_player_id` / `opp_team_player_id`; upsert team stats to `game_stats` |
| `loadLatestCloudGame` | Load team placeholder players from `games.*_team_player_id`; include in hydrated state |
| `loadCloudGameById` | Same as above |
| `ensurePlayerId` | Skip or special-case team pseudo-players (don't create `team_players` roster entries) |

### 3.4 Team Pseudo-Player Lifecycle

| Event | Action |
|-------|--------|
| **Game created** | No team pseudo-players in cloud yet (created on first sync with team stats) |
| **First stat recorded** | Team placeholder `players` row created if needed; `games.*_team_player_id` set |
| **Game finalized** | Team stats are preserved in `game_stats` like individual stats |
| **Game deleted** | `ON DELETE CASCADE` on `game_stats` cleans up team stats; `ON DELETE SET NULL` on `games.*_team_player_id` nulls the reference; the placeholder `players` row persists (harmless) |
| **Season deleted** | Cascades to teams → games → `game_stats`. Placeholder players may persist as orphans. A cleanup job can remove `is_team_placeholder = true` players with no `game_stats` references. |

---

## 4. RPC Filtering

Existing RPCs aggregate stats per player. Team pseudo-players must be excluded from individual stat views but included in team stat views.

### 4.1 `get_game_stats_resolved(p_game_id)`

**Current behavior:** Returns all `(player_id, stat_id, value)` tuples for a game.

**Change:** Add a `is_team_placeholder` boolean column to the output (joined from `players`). The app filters client-side. Alternatively, add an optional `p_exclude_team_placeholders` parameter:

```sql
-- Option A: Add output column (preferred — no signature change)
-- The existing CTE already joins on player_id; add the flag.

-- Option B: Parameter-based filtering
CREATE OR REPLACE FUNCTION get_game_stats_resolved(
  p_game_id uuid,
  p_exclude_team_placeholders boolean DEFAULT true
)
```

**Recommendation: Option A** for backward compatibility. Add `is_team_placeholder` to the output. Let the caller filter.

For the **Game Summary "Team Stats" tab**, the caller explicitly requests only team placeholder stats by filtering on `is_team_placeholder = true`.

### 4.2 `get_season_stats_resolved(p_team_id)`

**Current behavior:** Aggregates stats across all finalized games for a team, grouped by player.

**Change:** Exclude `is_team_placeholder = true` players from the aggregation. Team stats vary per game (different opponents, different foul counts) and don't aggregate meaningfully into season totals.

```sql
-- Add WHERE clause to exclude team placeholders:
WHERE pl.is_team_placeholder IS NOT TRUE
```

### 4.3 `get_career_stats_resolved(p_player_id)`

**No change needed.** Career stats are called with a specific `player_id`. A team placeholder's ID would never be passed here.

### 4.4 `get_player_game_log` / `get_team_game_log`

**`get_player_game_log`:** No change — called with a specific `player_id`.

**`get_team_game_log`:** Should exclude team placeholder stats from the team total aggregation (which sums individual player stats):

```sql
-- In the JOIN or WHERE clause:
WHERE pl.is_team_placeholder IS NOT TRUE
```

### 4.5 New RPC: `get_game_team_stats(p_game_id)`

A dedicated RPC for fetching team pseudo-player stats for a game:

```sql
CREATE OR REPLACE FUNCTION get_game_team_stats(p_game_id uuid)
RETURNS TABLE (
  team_side text,           -- 'home' or 'opponent'
  player_id uuid,
  stat_id text,
  value int,
  source text
) AS $$
  SELECT
    CASE
      WHEN g.home_team_player_id = r.player_id THEN 'home'
      WHEN g.opp_team_player_id = r.player_id THEN 'opponent'
      ELSE 'unknown'
    END AS team_side,
    r.player_id,
    r.stat_id,
    r.value,
    r.source
  FROM games g
  CROSS JOIN LATERAL get_game_stats_resolved(g.id) r
  WHERE g.id = p_game_id
    AND r.player_id IN (g.home_team_player_id, g.opp_team_player_id)
  ORDER BY team_side, r.stat_id;
$$ LANGUAGE sql STABLE SECURITY INVOKER;
```

This RPC returns only team-level stats, pre-labeled with the team side. The Game Summary "Team Stats" tab uses this.

---

## 5. App-Level Filtering

Beyond RPCs, the client app must filter team pseudo-players in several locations:

| Location | Filter | Why |
|----------|--------|-----|
| `Scoreboard.tsx` — home score | `players.filter(p => !p.isTeamPlayer)` | Team pseudo-player stats shouldn't contribute to the team score |
| `GameSummary.tsx` — player stats table | `players.filter(p => !p.isTeamPlayer)` | Individual stat table excludes team rows |
| `Leaderboard.tsx` | Filter from RPC results or exclude client-side | Team placeholders shouldn't appear in leaderboards |
| `PlayerProfile.tsx` | N/A — called with specific player ID | Won't be called for team placeholders |
| `CareerStats.tsx` | N/A — called with specific player ID | Won't be called for team placeholders |
| `PlayerSetup.tsx` | Don't show team pseudo-players in roster setup | They're injected later at game start |
| `GameCheckout.tsx` | Show team pseudo-players but visually distinct | Opt-in checkout for team stats |
| `cloudSync.ts` — `buildSyncFingerprint` | Include team pseudo-players in fingerprint | Their stats should trigger sync |
| `cloudSync.ts` — player creation | Skip `team_players` roster entry for team placeholders | They're not roster members |
| `MergePlayerWizard.tsx` | Exclude `is_team_placeholder` from merge candidates | Can't merge a team placeholder with a real player |

---

## 6. Migration Plan

### 6.1 Single Migration File

Migration `027_team_stats_schema.sql` (next available number after `026`):

```sql
-- 1. Add is_team_placeholder flag to players
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS is_team_placeholder boolean NOT NULL DEFAULT false;

-- 2. Add team player references to games
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS home_team_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS opp_team_player_id uuid REFERENCES players(id) ON DELETE SET NULL;

-- 3. Add team stats config to seasons
ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS team_stats_config jsonb DEFAULT '{}'::jsonb;

-- 4. Index for quickly finding team placeholders
CREATE INDEX IF NOT EXISTS idx_players_team_placeholder
  ON players (is_team_placeholder)
  WHERE is_team_placeholder = true;

-- 5. Update display views to include new columns
CREATE OR REPLACE VIEW players_display AS
SELECT
  pl.id,
  pl.first_name,
  pl.last_name,
  pl.first_name || ' ' || COALESCE(pl.last_name, '') AS full_name,
  pl.nickname,
  pl.is_team_placeholder,
  pl.created_by,
  p.display_name AS created_by_name,
  pl.created_at
FROM players pl
LEFT JOIN profiles p ON p.id = pl.created_by;

-- 6. RPC for fetching team-level stats for a game
CREATE OR REPLACE FUNCTION get_game_team_stats(p_game_id uuid)
RETURNS TABLE (
  team_side text,
  player_id uuid,
  stat_id text,
  value int,
  source text,
  recorded_by uuid,
  recorder_count int
) AS $$
  SELECT
    CASE
      WHEN g.home_team_player_id = r.player_id THEN 'home'
      WHEN g.opp_team_player_id = r.player_id THEN 'opponent'
      ELSE 'unknown'
    END AS team_side,
    r.player_id,
    r.stat_id,
    r.value,
    r.source,
    r.recorded_by,
    r.recorder_count
  FROM games g
  CROSS JOIN LATERAL get_game_stats_resolved(g.id) r
  WHERE g.id = p_game_id
    AND r.player_id IN (g.home_team_player_id, g.opp_team_player_id)
  ORDER BY team_side, r.stat_id;
$$ LANGUAGE sql STABLE SECURITY INVOKER;

-- 7. Update get_season_stats_resolved to exclude team placeholders
-- (Only if the current implementation doesn't already filter)
-- Note: This should be validated against the current RPC definition.
-- If the RPC uses CROSS JOIN LATERAL on game_stats, the filter needs
-- to be added to the CTE or final SELECT.
```

### 6.2 Rollback Consideration

All changes are additive (new columns with defaults, new index, new RPC). No destructive changes. Rollback: drop columns, index, and RPC in reverse order.

### 6.3 Existing Data

No backfill needed — existing games have no team pseudo-players. The new columns default to `false` / `NULL` / `'{}'`, which correctly indicates "no team stats" for historical games.

---

## 7. Data Flow Diagram

```
                          LOCAL (GameContext)
                          ──────────────────
Game Start
  │
  ├── Inject team pseudo-players (if sport has teamCategories)
  │     __team_home__  { isTeamPlayer: true, teamSide: 'home' }
  │     __team_opp__   { isTeamPlayer: true, teamSide: 'opponent' }
  │
  ├── Coach taps stats → INCREMENT_STAT for team pseudo-player
  │     statId: 'team_foul_p1' (period-scoped)
  │     playerId: '__team_home__'
  │
  └── Debounced cloud sync
        │
        ▼
                          CLOUD (Supabase)
                          ────────────────
syncGameSnapshotToCloud
  │
  ├── For __team_home__:
  │     1. Find/create players row (is_team_placeholder=true)
  │     2. Set games.home_team_player_id
  │     3. playerIdMap['__team_home__'] = cloud_uuid
  │
  ├── For __team_opp__:
  │     1. Find/create players row (is_team_placeholder=true)
  │     2. Set games.opp_team_player_id
  │     3. playerIdMap['__team_opp__'] = cloud_uuid
  │
  └── Upsert game_stats for all players (including team pseudo-players)
        │
        ▼
game_stats rows:
  (game_id, cloud_home_uuid, user1, 'team_foul_p1', 8)
  (game_id, cloud_home_uuid, user1, 'team_to_used',  3)
  (game_id, cloud_opp_uuid,  user1, 'team_foul_p1', 5)
  (game_id, player_uuid_23,  user1, 'ft',           4)
  ... (regular player stats)
```

---

## 8. Checkout and Multi-Parent Considerations

Team pseudo-players participate in the checkout system just like individual players:

- A coach can "check out" the home team and/or opponent team pseudo-player.
- `player_checkouts` rows are created for the team placeholder `player_id`.
- If multiple coaches are tracking, one is "primary" for team stats (same resolution chain: corrections > primary > sole > averaged).
- In practice, usually only one person tracks team fouls. But the system supports multiple recorders out of the box.

**Stat corrections** also work for team stats. An admin can correct a team foul count via the same `stat_corrections` table and flow.

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| **Orphaned team placeholder `players` rows** | These are harmless (tiny footprint). A periodic cleanup can remove placeholders with no `game_stats` references. |
| **Team placeholder appears in player search / merge wizard** | Filter `is_team_placeholder = true` in all player list queries. |
| **RPC performance with additional join on `is_team_placeholder`** | The boolean column is indexed (partial index on `true`). Filter is O(1) per row. |
| **Migration conflicts with in-flight work** | Migration is purely additive — no column drops, no data transforms. Low conflict risk. |
| **Cloud sync creates duplicate team placeholders** | Use `games.home_team_player_id` / `opp_team_player_id` as the canonical reference. If set, reuse; if not, create. Deterministic — no duplicates per game. |
| **Team placeholder name changes** (opponent name edited) | Update the `players.first_name` for the team placeholder when the opponent name changes. Or regenerate on next sync. |

---

## 10. Summary of All Schema Changes

| Table | Column / Object | Type | Change |
|-------|----------------|------|--------|
| `players` | `is_team_placeholder` | boolean NOT NULL DEFAULT false | ADD |
| `games` | `home_team_player_id` | uuid FK → players, ON DELETE SET NULL | ADD |
| `games` | `opp_team_player_id` | uuid FK → players, ON DELETE SET NULL | ADD |
| `seasons` | `team_stats_config` | jsonb DEFAULT '{}' | ADD |
| (index) | `idx_players_team_placeholder` | partial index | ADD |
| (view) | `players_display` | view | UPDATE — include `is_team_placeholder` |
| (function) | `get_game_team_stats` | RPC | ADD |
| (function) | `get_season_stats_resolved` | RPC | UPDATE — exclude team placeholders |

**Migration file:** `027_team_stats_schema.sql` (next after `026_player_stat_high_games.sql`)

---

*Document version: 0.1 (design phase)*
