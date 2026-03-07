# Design: Seasons Data Model + Player Roster Junction + Admin Views

Redesign the data model to make **Season** a first-class entity at the top of the hierarchy, decouple players from teams via a junction table, and add Supabase admin display views for human-readable FK browsing.

**Companion doc (TODO):** `DESIGN_STAT_TRACKING_UI.md` — stat page redesign covering career stats, season stats, game stats (player and team splits).

---

## 1. Goals

1. **Season as top-level entity.** Teams, games, and tournaments all belong to a season. Seasons are per-team-owner (e.g., "Spring League 2026", "Fall League 2026", "Winter League 2027").
2. **Teams are ephemeral per season.** A team like "Rebels b7c gray" exists for one season. Next season it might become "Rebels b8b white" with a different coach and roster. Teams are NOT reused across seasons.
3. **Players are persistent across teams and seasons.** A player (person) can play on many teams across many seasons. When a player moves teams, their career history stays intact.
4. **Junction table for team rosters.** Replace `players.team_id` with a `team_players` many-to-many table. Jersey numbers and active status are per-team, not per-player.
5. **Supabase admin display views.** Create SQL views that JOIN FKs to show human-readable names alongside UUIDs in the Supabase table browser.
6. **Start fresh.** No migration of existing `teams.season` text data into the new structure.

---

## 2. Current Model

```
profiles ──┐
            ├── teams (owner_id, name, sport, season TEXT)
            │     ├── players (team_id, first_name, last_name, jersey_number, is_active)
            │     ├── games (team_id, opponent_name, ...)
            │     ├── tournaments (team_id, name)
            │     └── team_members (team_id, user_id, role)
            │
            └── game_stats (game_id, player_id, recorded_by, stat_id, value)
```

**Problems:**
- `teams.season` is a free-text label, not a relational entity — no way to query "all teams in Season X"
- `players.team_id` locks a player to one team forever; moving teams means creating a new player record and losing stat history
- FK UUIDs in the Supabase table browser are unreadable without manual JOINs

---

## 3. Proposed Model

### 3.1 Entity Relationship Diagram

```
profiles ──┐
            ├── seasons (owner_id, name, sport, start_date, end_date)
            │     └── teams (season_id, owner_id, name, nickname)
            │           ├── team_players (team_id, player_id, jersey_number, is_active)
            │           ├── games (team_id, opponent_name, ...)
            │           ├── tournaments (team_id, name)
            │           └── team_members (team_id, user_id, role)
            │
            ├── players (created_by, first_name, last_name, nickname)
            │     ├── team_players ──→ (links back to teams)
            │     └── player_guardians (player_id, user_id) ──→ (links to profiles)
            │
            └── game_stats (game_id, player_id, recorded_by, stat_id, value)
```

**Key relationships:**
- A **season** owns teams. A **team** exists for exactly one season.
- A **player** is a person record, created by one user but shared across teams/seasons.
- **`player_guardians`** links players to their parents/guardians. Any guardian can manage the player, add them to future teams, and track their stats. The season owner might create all the players, then parents claim their kids as guardians.
- **`team_players`** links players to teams (roster). A player can be on many teams across many seasons.
- **Stat tracking stays fluid** — any team member can track stats for any player on the team (existing `game_stats.recorded_by` + `player_checkouts` system). Guardianship is about player management, not stat tracking lockout.

### 3.2 New Table: `seasons`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `owner_id` | uuid FK → profiles | NOT NULL, ON DELETE CASCADE |
| `name` | text | NOT NULL (e.g., "Spring League 2026") |
| `sport` | text | NOT NULL (e.g., "basketball") |
| `start_date` | date | nullable |
| `end_date` | date | nullable |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

- One season per team grouping. A user might have multiple seasons running concurrently (e.g., two kids in different leagues).
- `sport` on the season level because a season is sport-specific (Spring Basketball League ≠ Spring Soccer League).

### 3.3 Modified Table: `teams`

| Column | Change | Notes |
|--------|--------|-------|
| `season_id` | **ADD** uuid FK → seasons | NOT NULL, ON DELETE CASCADE |
| `season` | **DROP** text | Replaced by `season_id → seasons.name` |
| `sport` | **DROP** text | Inherited from `seasons.sport` — no denormalization needed since teams always load in a season context |

Teams become children of seasons. Deleting a season cascades to all its teams (and through existing FKs, to games, tournaments, stats, etc.).

### 3.4 Modified Table: `players`

| Column | Change | Notes |
|--------|--------|-------|
| `team_id` | **DROP** | Replaced by `team_players` junction |
| `jersey_number` | **MOVE** → `team_players` | Jersey number is per-team |
| `position` | **MOVE** → `team_players` | Position can change per team |
| `is_active` | **MOVE** → `team_players` | Active status is per-team |
| `created_by` | **ADD** uuid FK → profiles | NOT NULL — who created this player record (not exclusive ownership) |

Players become standalone "person" records. A player's identity (name, nickname) is stable; their team membership, jersey number, and active status are tracked per-team in the junction table.

`created_by` tracks who initially created the player record, but does **not** imply exclusive ownership. Guardians (via `player_guardians`) can also manage the player. This supports the common scenario where a season owner/coach creates all the players, and then individual parents claim their own kids as guardians.

### 3.5 New Table: `team_players` (Junction)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `team_id` | uuid FK → teams | NOT NULL, ON DELETE CASCADE |
| `player_id` | uuid FK → players | NOT NULL, ON DELETE CASCADE |
| `jersey_number` | text | nullable |
| `position` | text | nullable |
| `is_active` | boolean | NOT NULL DEFAULT true |
| `joined_at` | timestamptz | NOT NULL DEFAULT now() |

- UNIQUE(`team_id`, `player_id`) — a player appears on a team's roster at most once.
- When a player "moves teams," they get a new row in `team_players` for the new team. The old row stays (historical record).
- `is_active` can be set to false to remove a player from the active roster without losing the link.

### 3.6 New Table: `player_guardians` (Junction)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `player_id` | uuid FK → players | NOT NULL, ON DELETE CASCADE |
| `user_id` | uuid FK → profiles | NOT NULL, ON DELETE CASCADE |
| `relationship` | text | NOT NULL DEFAULT 'parent' — e.g., 'parent', 'guardian', 'self' |
| `created_at` | timestamptz | NOT NULL DEFAULT now() |

- UNIQUE(`player_id`, `user_id`) — a user is linked to a player at most once.
- Links a player to their parent(s)/guardian(s). Any guardian can:
  - Edit the player's name/nickname
  - See the player in their "player pool" when building rosters for new teams
  - Add the player to teams they manage
- The player's `created_by` user is implicitly a guardian (auto-inserted on player creation).
- **Does NOT affect stat tracking.** Any team member can track stats for any player on the team — that's handled by `game_stats.recorded_by` and `player_checkouts`. Guardianship is about player identity management and roster building, not stat access.

**Typical flow:**
1. Coach/season owner creates a team and adds all players → `created_by` = coach for all players
2. Coach shares the team via invites (`team_members`) → parents join as scorers/admins
3. A parent "claims" their child → `player_guardians` row created (parent → player)
4. Next season, that parent creates a new team and can find their child in their player pool (via guardianship)
5. Both the original creator and the guardian can edit the player's name if needed

### 3.7 Unchanged Tables

| Table | Notes |
|-------|-------|
| `games` | `team_id` FK stays. Team implies season. No changes needed. |
| `tournaments` | `team_id` FK stays. Team implies season. No changes needed. |
| `game_stats` | `game_id` + `player_id` FKs stay. Player is now team-independent, but stats are still per-game-per-player. |
| `team_members` | `team_id` FK stays. Collaboration is per-team. |
| `player_checkouts` | `game_id` + `player_id` FKs stay. No changes needed. |
| `stat_corrections` | `game_id` + `player_id` FKs stay. No changes needed. |

---

## 4. Cascade Rules

```
seasons  →  teams              (ON DELETE CASCADE)
teams    →  team_players       (ON DELETE CASCADE)
teams    →  games              (ON DELETE CASCADE) — existing
teams    →  tournaments        (ON DELETE CASCADE) — existing
teams    →  team_members       (ON DELETE CASCADE) — existing
players  →  team_players       (ON DELETE CASCADE)
players  →  player_guardians   (ON DELETE CASCADE)
players  →  game_stats         (ON DELETE CASCADE) — existing
games    →  game_stats         (ON DELETE CASCADE) — existing
```

Deleting a season wipes everything under it. Deleting a player removes them from all rosters, guardian links, and their stats. This matches existing behavior — just adds the new season, junction, and guardian layers.

---

## 5. RLS Policies

### 5.1 Seasons

```sql
-- Members can view seasons they have teams in
CREATE POLICY "seasons_select" ON seasons
  FOR SELECT USING (
    owner_id = (SELECT auth.uid())
    OR id IN (
      SELECT t.season_id FROM teams t
      JOIN team_members tm ON tm.team_id = t.id
      WHERE tm.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "seasons_insert" ON seasons
  FOR INSERT WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "seasons_update" ON seasons
  FOR UPDATE USING (owner_id = (SELECT auth.uid()));

CREATE POLICY "seasons_delete" ON seasons
  FOR DELETE USING (owner_id = (SELECT auth.uid()));
```

### 5.2 Players (modified — creator + guardian + team-member visibility)

```sql
-- Players visible to: creator, guardians, or members of any team the player is on
CREATE POLICY "players_select" ON players
  FOR SELECT USING (
    created_by = (SELECT auth.uid())
    OR id IN (
      SELECT player_id FROM player_guardians WHERE user_id = (SELECT auth.uid())
    )
    OR id IN (
      SELECT tp.player_id FROM team_players tp
      JOIN team_members tm ON tm.team_id = tp.team_id
      WHERE tm.user_id = (SELECT auth.uid())
    )
  );

-- Anyone can create a player (they become the created_by)
CREATE POLICY "players_insert" ON players
  FOR INSERT WITH CHECK (created_by = (SELECT auth.uid()));

-- Creator or any guardian can edit the player's name/nickname
CREATE POLICY "players_update" ON players
  FOR UPDATE USING (
    created_by = (SELECT auth.uid())
    OR id IN (
      SELECT player_id FROM player_guardians WHERE user_id = (SELECT auth.uid())
    )
  );

-- Only the creator can hard-delete a player
CREATE POLICY "players_delete" ON players
  FOR DELETE USING (created_by = (SELECT auth.uid()));
```

### 5.3 Player Guardians

```sql
-- Guardians can see their own guardian links; team admins can see guardians for players on their team
CREATE POLICY "player_guardians_select" ON player_guardians
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR player_id IN (
      SELECT tp.player_id FROM team_players tp
      JOIN team_members tm ON tm.team_id = tp.team_id
      WHERE tm.user_id = (SELECT auth.uid())
    )
  );

-- A user can claim guardianship of a player they can see
CREATE POLICY "player_guardians_insert" ON player_guardians
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

-- A guardian can remove their own guardianship; player creator can remove any guardian
CREATE POLICY "player_guardians_delete" ON player_guardians
  FOR DELETE USING (
    user_id = (SELECT auth.uid())
    OR player_id IN (
      SELECT id FROM players WHERE created_by = (SELECT auth.uid())
    )
  );
```

### 5.4 Team Players (junction)

```sql
-- Team members can view their team's roster
CREATE POLICY "team_players_select" ON team_players
  FOR SELECT USING (
    team_id IN (
      SELECT team_id FROM team_members WHERE user_id = (SELECT auth.uid())
    )
  );

-- Owner/admin can manage roster
CREATE POLICY "team_players_insert" ON team_players
  FOR INSERT WITH CHECK (
    team_id IN (
      SELECT team_id FROM team_members
      WHERE user_id = (SELECT auth.uid()) AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "team_players_update" ON team_players
  FOR UPDATE USING (
    team_id IN (
      SELECT team_id FROM team_members
      WHERE user_id = (SELECT auth.uid()) AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "team_players_delete" ON team_players
  FOR DELETE USING (
    team_id IN (
      SELECT team_id FROM team_members
      WHERE user_id = (SELECT auth.uid()) AND role IN ('owner', 'admin')
    )
  );
```

---

## 6. Supabase Admin Display Views

SQL views that JOIN FK UUIDs to human-readable names. These appear as virtual tables in the Supabase table browser and are read-only.

```sql
-- Human-readable games view
CREATE OR REPLACE VIEW games_display AS
SELECT
  g.id,
  g.team_id,
  t.name AS team_name,
  s.name AS season_name,
  g.opponent_name,
  g.opponent_score,
  g.tournament_id,
  tour.name AS tournament_name,
  g.game_date,
  g.status,
  g.created_by,
  p.display_name AS created_by_name,
  g.home_score_adjustment,
  g.notes,
  g.created_at
FROM games g
LEFT JOIN teams t ON t.id = g.team_id
LEFT JOIN seasons s ON s.id = t.season_id
LEFT JOIN tournaments tour ON tour.id = g.tournament_id
LEFT JOIN profiles p ON p.id = g.created_by;

-- Human-readable teams view
CREATE OR REPLACE VIEW teams_display AS
SELECT
  t.id,
  t.season_id,
  s.name AS season_name,
  t.owner_id,
  p.display_name AS owner_name,
  t.name AS team_name,
  t.nickname,
  s.sport,
  t.created_at
FROM teams t
LEFT JOIN seasons s ON s.id = t.season_id
LEFT JOIN profiles p ON p.id = t.owner_id;

-- Human-readable team_players (roster) view
CREATE OR REPLACE VIEW team_players_display AS
SELECT
  tp.id,
  tp.team_id,
  t.name AS team_name,
  s.name AS season_name,
  tp.player_id,
  pl.first_name || ' ' || COALESCE(pl.last_name, '') AS player_name,
  tp.jersey_number,
  tp.position,
  tp.is_active,
  tp.joined_at
FROM team_players tp
JOIN teams t ON t.id = tp.team_id
LEFT JOIN seasons s ON s.id = t.season_id
JOIN players pl ON pl.id = tp.player_id;

-- Human-readable players view
CREATE OR REPLACE VIEW players_display AS
SELECT
  pl.id,
  pl.first_name,
  pl.last_name,
  pl.first_name || ' ' || COALESCE(pl.last_name, '') AS full_name,
  pl.nickname,
  pl.created_by,
  p.display_name AS created_by_name,
  pl.created_at
FROM players pl
LEFT JOIN profiles p ON p.id = pl.created_by;

-- Human-readable player_guardians view
CREATE OR REPLACE VIEW player_guardians_display AS
SELECT
  pg.id,
  pg.player_id,
  pl.first_name || ' ' || COALESCE(pl.last_name, '') AS player_name,
  pg.user_id,
  p.display_name AS guardian_name,
  pg.relationship,
  pg.created_at
FROM player_guardians pg
JOIN players pl ON pl.id = pg.player_id
LEFT JOIN profiles p ON p.id = pg.user_id;

-- Human-readable game_stats view
CREATE OR REPLACE VIEW game_stats_display AS
SELECT
  gs.id,
  gs.game_id,
  t.name AS team_name,
  g.opponent_name,
  g.game_date,
  gs.player_id,
  pl.first_name || ' ' || COALESCE(pl.last_name, '') AS player_name,
  gs.stat_id,
  gs.value,
  gs.recorded_by,
  p.display_name AS recorded_by_name,
  gs.created_at
FROM game_stats gs
JOIN games g ON g.id = gs.game_id
LEFT JOIN teams t ON t.id = g.team_id
JOIN players pl ON pl.id = gs.player_id
LEFT JOIN profiles p ON p.id = gs.recorded_by;

-- Human-readable tournaments view
CREATE OR REPLACE VIEW tournaments_display AS
SELECT
  tour.id,
  tour.team_id,
  t.name AS team_name,
  s.name AS season_name,
  tour.name AS tournament_name,
  tour.created_at
FROM tournaments tour
JOIN teams t ON t.id = tour.team_id
LEFT JOIN seasons s ON s.id = t.season_id;

-- Human-readable team_members view
CREATE OR REPLACE VIEW team_members_display AS
SELECT
  tm.id,
  tm.team_id,
  t.name AS team_name,
  tm.user_id,
  p.display_name AS member_name,
  tm.role,
  tm.invited_at,
  tm.accepted_at
FROM team_members tm
JOIN teams t ON t.id = tm.team_id
LEFT JOIN profiles p ON p.id = tm.user_id;

-- Human-readable seasons view
CREATE OR REPLACE VIEW seasons_display AS
SELECT
  s.id,
  s.name AS season_name,
  s.sport,
  s.start_date,
  s.end_date,
  s.owner_id,
  p.display_name AS owner_name,
  s.created_at
FROM seasons s
LEFT JOIN profiles p ON p.id = s.owner_id;
```

These views are for **admin browsing only** — the app continues to query base tables directly for performance and RLS.

---

## 7. Stat Tracking Scope Changes

> **Full UI design in separate doc:** `DESIGN_STAT_TRACKING_UI.md` (TODO)

### 7.1 Stat View Categories

| View | Scope | What it shows |
|------|-------|---------------|
| **Career Stats** | All seasons, all teams for a player | Lifetime totals, per-season breakdown, career averages |
| **Season Stats** | One season, one team | Season totals, per-game averages, season highs (current Leaderboard/PlayerProfile) |
| **Game Stats — Player** | One game, per-player | Individual player stat line for a game |
| **Game Stats — Team** | One game, team totals | Aggregated team totals for a game (sum of all player stats) |

### 7.2 Query Patterns

**Career stats** require querying across teams/seasons for a single player:
```sql
SELECT s.name AS season_name, t.name AS team_name, ...
FROM game_stats gs
JOIN games g ON g.id = gs.game_id
JOIN teams t ON t.id = g.team_id
JOIN seasons s ON s.id = t.season_id
JOIN team_players tp ON tp.team_id = t.id AND tp.player_id = gs.player_id
WHERE gs.player_id = $player_id
  AND g.status = 'final'
GROUP BY s.id, t.id
```

**Season stats** stay similar to current `get_season_stats_resolved()` but scope by `season_id` instead of (or in addition to) `team_id`.

### 7.3 Resolved Stats RPCs — Impact

The existing RPCs (`get_game_stats_resolved`, `get_season_stats_resolved`) work on `game_id` and `team_id` respectively. Since `game_stats.player_id` still references `players.id` directly, these RPCs need minimal changes:

- `get_game_stats_resolved(p_game_id)` — no change needed
- `get_season_stats_resolved(p_team_id)` — no change needed (team_id still on games)
- **New:** `get_career_stats_resolved(p_player_id)` — aggregates across all teams/seasons

---

## 8. Cloud Sync Impact

### 8.1 `cloudSync.ts` Changes

| Function | Current | After |
|----------|---------|-------|
| `ensureTeam()` | Looks up/creates team by (owner_id, name, sport) | Needs `season_id` to create a team. Game setup flow must resolve season first. |
| `ensurePlayerId()` | Looks up/creates player by (team_id, first_name, last_name, jersey_number) | Look up player by (created_by, first_name, last_name) OR via `player_guardians`. Create `team_players` junction row for team assignment. Jersey number moves to junction. Auto-create `player_guardians` row for the creating user. |
| `syncGameSnapshotToCloud()` | Calls ensureTeam → ensureGame → ensurePlayers → upsertStats | Same flow, but ensureTeam now requires season context. |

### 8.2 Game Setup Flow

```
1. User selects/creates a Season
2. User selects/creates a Team (within that season)
3. User enters opponent, tournament, date
4. User adds players (from global player pool or create new)
   → team_players junction row created
5. Game proceeds as normal
```

---

## 9. Migration Strategy

### 9.1 Migration File

Single migration (next number, e.g., `018_seasons_and_roster_junction.sql`):

1. Create `seasons` table with RLS
2. Add `teams.season_id` nullable FK (temporarily nullable for migration)
3. Create `team_players` junction table with RLS
4. Create `player_guardians` junction table with RLS
5. Migrate existing data:
   - For each distinct `(owner_id, season, sport)` in `teams`, create a `seasons` row
   - Set `teams.season_id` from the created seasons
   - For each `players` row, create a `team_players` row with the player's current `team_id`, `jersey_number`, `position`, `is_active`
   - Set `players.created_by` from their team's `owner_id`
   - Create a `player_guardians` row linking each player to their `created_by` user (relationship = 'parent')
6. Make `teams.season_id` NOT NULL
7. Drop `teams.season` text column, `teams.sport` column
8. Drop `players.team_id`, `players.jersey_number`, `players.position`, `players.is_active` columns
9. Add `players.created_by` NOT NULL
10. Create display views (including `player_guardians_display`)

### 9.2 Rollback Consideration

The migration is destructive (drops columns). Before running, recommend a Supabase DB backup. The migration should be idempotent where possible (using `IF NOT EXISTS`, `IF EXISTS`).

---

## 10. Implementation Phases

| Phase | What | Depends On |
|-------|------|------------|
| **1. Schema** | Migration: `seasons`, `team_players`, `player_guardians` tables; alter `teams` and `players`; display views; RLS | — |
| **2. Season UI** | Season CRUD in Settings/Admin; season selector in Game Setup; season display on Teams page | Phase 1 |
| **3. Roster Refactor** | Update Teams page to use `team_players` junction; player add/remove goes through junction; support adding existing players from other teams/seasons via player pool | Phase 1 |
| **4. Guardian Claim** | UI for parents to claim guardianship of a player on their team; "My Players" pool visible when building future rosters (players you created + players you're a guardian of) | Phase 1, 3 |
| **5. Cloud Sync** | Update `cloudSync.ts` to handle season context, junction-based player lookup, auto-create guardian link on player creation | Phase 1, 2 |
| **6. Stat Views** | Career stats page, season-scoped stats, game stats (player + team splits) | Phase 1, 3 (separate design doc) |
| **7. Player Transfer** | UI to add an existing player to a new team (pick from player pool); player search/autocomplete | Phase 3, 4 |

---

## 11. Resolved Decisions

1. **`teams.sport`** — **Drop it.** Inherit from `seasons.sport`. Teams always load in a season context; no need for denormalization.

2. **Player ownership model** — **`created_by` + `player_guardians` junction.** The `created_by` field tracks who created the player record but does not imply exclusive ownership. A `player_guardians` junction table links players to their parents/guardians. Any guardian (or creator) can edit the player's name and add them to future teams. This supports the scenario where a coach creates all the players, then individual parents claim their kids. Stat tracking remains fully fluid — any team member can track any player on the team regardless of guardianship.

3. **Season selector UX** — **Both places.** Season CRUD in Settings/Admin; season picker in Game Setup (like the existing team selector). Users manage seasons in one place, pick them in another.

4. **Team member re-invites** — **Re-invite per season is fine.** `team_members` stays per-team. When a new season starts and a new team is created, collaborators are re-invited. Simple and acceptable for now; season-level collaboration could come later.

5. **Existing game_stats FK** — **No change needed.** `game_stats.player_id` references `players.id` directly. After the migration, `players` no longer has `team_id`, but `game_stats` still works because the game's `team_id` provides the team context. The junction table is only needed for roster management, not stat lookups.

---

## 12. File References

| File | Relevance |
|------|-----------|
| `supabase/migrations/002_teams_players.sql` | Current teams + players schema |
| `supabase/migrations/003_games_stats.sql` | Current games + game_stats schema |
| `supabase/migrations/016_tournaments.sql` | Tournaments table (team-scoped, stays as-is) |
| `src/lib/cloudSync.ts` | Cloud sync logic — needs season + junction changes |
| `src/pages/Teams.tsx` | Team + roster management — major refactor |
| `src/pages/GameSetup.tsx` | Game setup — needs season selector |
| `src/pages/Admin.tsx` | Settings — add season management |
| `src/pages/Leaderboard.tsx` | Season stats — scope by season |
| `src/pages/PlayerProfile.tsx` | Player stats — add career view |
| `docs/INTEGRATION_PLAN.md` | Overall architecture — update data model section |
