# Integration Plan: Sports Engine + Supabase

This document lays out the architecture, data model, and phased implementation plan for integrating StatKeeper with **Sports Engine** (team/roster/schedule data) and **Supabase** (cloud database, auth, real-time sync).

---

## Vision

A parent opens StatKeeper, signs in, connects their Sports Engine account, and sees their kids' teams with full rosters and upcoming schedules. They tap today's game and the stat tracker is pre-populated with the correct players and opponent. After the game, stats are saved to the cloud and accumulate across the season. Multiple parents on the same team can each track stats independently, and a merge view combines everyone's data into one consistent team stat sheet.

---

## 1. Supabase Integration

### 1.1 Auth

| Aspect | Detail |
|---|---|
| Provider | Supabase Auth (email/password + OAuth social login) |
| Client | `@supabase/supabase-js` with `@supabase/auth-helpers-react` |
| Session | JWT stored automatically by Supabase client; refresh handled transparently |
| RLS | Every table uses Row Level Security; no data accessible without auth |

**Env variables** (`.env`):
```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

### 1.2 Database Schema

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          CORE TABLES                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  profiles              teams                 players                    │
│  ─────────             ─────                 ───────                    │
│  id (uuid, PK, FK→auth.users)               id (uuid, PK)             │
│  display_name          id (uuid, PK)         team_id (FK→teams)        │
│  avatar_url            owner_id (FK→profiles)se_profile_id (nullable)  │
│  se_access_token       se_team_id (nullable) first_name                │
│  se_refresh_token      name                  last_name                 │
│  se_org_id             nickname (nullable)   jersey_number             │
│  created_at            sport (text)          nickname (nullable)       │
│                        season (text)         position (nullable)       │
│                        created_at            is_active (bool)          │
│                                              created_at                │
│                                                                         │
│  games                           game_stats                            │
│  ─────                           ──────────                            │
│  id (uuid, PK)                   id (uuid, PK)                        │
│  team_id (FK→teams)              game_id (FK→games)                   │
│  se_event_id (nullable)          player_id (FK→players)               │
│  opponent_name                   recorded_by (FK→profiles)            │
│  opponent_score                  stat_id (text)                        │
│  tournament_name                 value (int)                           │
│  game_date (date)                created_at                            │
│  game_time (timestamptz)         updated_at                            │
│  location (text)                                                       │
│  status (scheduled|in_progress|final)                                  │
│  created_at                                                            │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                     COLLABORATION TABLES                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  team_members                                                          │
│  ────────────                                                          │
│  id (uuid, PK)                                                         │
│  team_id (FK→teams)                                                    │
│  user_id (FK→profiles)                                                 │
│  role (owner|admin|scorer)                                             │
│  invited_at                                                            │
│  accepted_at                                                           │
│                                                                         │
│  stat_merge_log                                                        │
│  ──────────────                                                        │
│  id (uuid, PK)                                                         │
│  game_id (FK→games)                                                    │
│  merged_by (FK→profiles)                                               │
│  source_recorder_ids (uuid[])                                          │
│  merge_strategy (text)   -- 'average' | 'max' | 'manual'              │
│  created_at                                                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Row Level Security Policies

```sql
-- Users see their own profile
CREATE POLICY "profiles_own" ON profiles
  FOR ALL USING (id = auth.uid());

-- Users see teams they are a member of
CREATE POLICY "teams_member" ON teams
  FOR SELECT USING (
    id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

-- Team owners/admins can update team
CREATE POLICY "teams_manage" ON teams
  FOR UPDATE USING (
    id IN (SELECT team_id FROM team_members
           WHERE user_id = auth.uid() AND role IN ('owner', 'admin'))
  );

-- Players visible to team members
CREATE POLICY "players_team_member" ON players
  FOR SELECT USING (
    team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

-- Stats: anyone on the team can read; only the recorder can edit their own
CREATE POLICY "stats_read" ON game_stats
  FOR SELECT USING (
    game_id IN (SELECT id FROM games WHERE team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    ))
  );

CREATE POLICY "stats_own_write" ON game_stats
  FOR INSERT WITH CHECK (recorded_by = auth.uid());

CREATE POLICY "stats_own_update" ON game_stats
  FOR UPDATE USING (recorded_by = auth.uid());
```

### 1.4 Key Indexes

```sql
CREATE INDEX idx_team_members_user ON team_members(user_id);
CREATE INDEX idx_team_members_team ON team_members(team_id);
CREATE INDEX idx_game_stats_game ON game_stats(game_id);
CREATE INDEX idx_game_stats_player ON game_stats(player_id);
CREATE INDEX idx_game_stats_recorder ON game_stats(recorded_by);
CREATE INDEX idx_games_team_date ON games(team_id, game_date);
CREATE INDEX idx_players_team ON players(team_id);
```

---

## 2. Sports Engine Integration

### 2.1 API Overview

| Aspect | Detail |
|---|---|
| Primary API | GraphQL — `POST https://api.sportsengine.com/graphql` |
| Legacy REST | `https://api.sportsengine.com/v1/...` (teams, rosters, events) |
| Auth | OAuth2 — authorization code flow |
| Rate Limits | Query complexity scoring; pagination max 100 per page |

### 2.2 OAuth2 Flow

```
User clicks "Connect Sports Engine"
  → Redirect to SE authorization URL
  → User approves access
  → SE redirects back with authorization code
  → Backend exchanges code for access_token + refresh_token
  → Tokens stored in profiles table (encrypted at rest via Supabase)
```

**Important**: The token exchange must happen server-side (Supabase Edge Function) to protect the client secret.

### 2.3 Data Sync Architecture

```
┌──────────────┐     ┌────────────────────┐     ┌──────────────┐
│  StatKeeper  │────▶│  Supabase Edge Fn  │────▶│ Sports Engine│
│  (React)     │◀────│  (Deno / Node)     │◀────│    API       │
└──────────────┘     └────────────────────┘     └──────────────┘
       │                      │
       │                      ▼
       │              ┌──────────────┐
       └─────────────▶│  Supabase DB │
                      └──────────────┘
```

**Edge Functions needed:**

| Function | Purpose |
|---|---|
| `se-auth-callback` | Handle OAuth2 callback, exchange code for tokens, store in DB |
| `se-sync-teams` | Fetch user's teams/orgs from SE, upsert into `teams` table |
| `se-sync-roster` | Fetch roster for a team, upsert into `players` table |
| `se-sync-schedule` | Fetch upcoming events/games, upsert into `games` table |

### 2.4 Key GraphQL Queries

**Fetch user's organizations:**
```graphql
query {
  organizations(page: 1, perPage: 50) {
    results { id name sports acronym }
    pageInformation { pages count }
  }
}
```

**Fetch teams for an organization:**
```graphql
query {
  organization(id: $orgId) {
    teams(page: 1, perPage: 100) {
      results {
        id name
        roster {
          rosterPlayers {
            id
            profile { id firstName lastName }
            jerseyNumber
            position
          }
        }
        season { id name startDate endDate }
      }
    }
  }
}
```

**Fetch events/schedule:**
```graphql
query {
  team(id: $teamId) {
    events(page: 1, perPage: 50) {
      results {
        id name startDatetime endDatetime
        location { name address }
        opponents { name }
        eventType
      }
    }
  }
}
```

### 2.5 Sync Strategy

| Trigger | Action |
|---|---|
| User connects SE account | Full sync: orgs → teams → rosters → schedules |
| User opens a team | Refresh roster + upcoming games (if last sync > 1 hour) |
| Manual refresh button | Force re-sync for selected team |
| Daily cron (future) | Supabase scheduled Edge Function to sync all active teams |

Data is **upserted** using the `se_*_id` foreign keys as the match condition, so re-syncing never creates duplicates.

---

## 3. Multi-Parent / Merge Architecture

### 3.1 Problem

Multiple parents on the same team may each track stats for the same game independently. Their counts may differ. The system needs to:

1. Keep each parent's raw data intact (`recorded_by` on `game_stats`)
2. Provide a **merged view** that combines all recorders' data
3. Support configurable merge strategies

### 3.2 Merge Strategies

| Strategy | How it works | Best for |
|---|---|---|
| **Average** | Average all recorders' values, round to nearest int | Most stats (reduces individual error) |
| **Max** | Take the highest value across recorders | Scoring stats (less likely to over-count) |
| **Sum** | Sum across recorders (for partitioned tracking) | When parents split tracking duties |
| **Manual** | Admin picks the correct value per stat | Disputes or review after the game |
| **Primary** | Designate one recorder as authoritative | One "official" scorekeeper |

### 3.3 Merged View Query

```sql
-- Season totals for a player, merged across recorders
SELECT
  p.first_name,
  p.last_name,
  gs.stat_id,
  -- Per merge strategy:
  ROUND(AVG(gs.value)) AS avg_value,
  MAX(gs.value) AS max_value,
  SUM(gs.value) AS sum_value,
  COUNT(DISTINCT gs.recorded_by) AS recorder_count
FROM game_stats gs
JOIN players p ON p.id = gs.player_id
JOIN games g ON g.id = gs.game_id
WHERE g.team_id = $teamId
  AND g.status = 'final'
GROUP BY p.id, p.first_name, p.last_name, gs.stat_id;
```

This can be exposed as a **Supabase Database View** or an **RPC function** so the client just calls `supabase.rpc('get_season_stats', { team_id })`.

### 3.4 UI Considerations

- Each parent sees their own stats in the Game Tracker (current behavior)
- The Game Summary page gets a toggle: **"My Stats"** vs **"Team View (Merged)"**
- Conflict indicators: highlight stats where recorders disagree by >20%
- Team admin can review and finalize game stats (lock after review)

---

## 4. Nickname / Relabeling System

Players and teams synced from Sports Engine may have official names that differ from what the team uses casually.

| Field | Source | Override |
|---|---|---|
| `teams.name` | From SE: "Spring 2026 U12 Boys Blue" | `teams.nickname`: "Blue Lightning" |
| `players.first_name` / `last_name` | From SE profile | `players.nickname`: "JJ" |

**Display logic**: Show `nickname` if set, otherwise fall back to the official name. Sync from SE never overwrites the nickname field.

---

## 5. Pre-Populated Game Flow

When a user with a connected SE account opens StatKeeper:

```
1. Fetch today's games for their teams
   → SELECT * FROM games WHERE team_id IN (user's teams) AND game_date = today

2. Show "Today's Games" section on home page
   → Card per game with opponent name, time, location

3. User taps a game card
   → Game Tracker opens pre-populated with:
     - Team name and opponent (from games table)
     - Full roster (from players table, is_active = true)
     - Sport-specific stat categories (from sport config)

4. User tracks stats → saved to game_stats with recorded_by = auth.uid()

5. After game: user taps "Finalize" → game.status = 'final'
   → Stats contribute to season totals
```

---

## 6. Season Statistics

### 6.1 Computed Views

```sql
CREATE VIEW season_player_stats AS
SELECT
  g.team_id,
  gs.player_id,
  gs.stat_id,
  COUNT(DISTINCT g.id) AS games_played,
  SUM(gs.value) AS total,
  ROUND(AVG(gs.value), 1) AS per_game_avg,
  MAX(gs.value) AS season_high
FROM game_stats gs
JOIN games g ON g.id = gs.game_id
WHERE g.status = 'final'
GROUP BY g.team_id, gs.player_id, gs.stat_id;
```

### 6.2 Season Stats UI

- **Player Profile**: season totals, per-game averages, game log
- **Team Leaderboard**: sortable by any stat (top scorer, most assists, etc.)
- **Game Log**: chronological list of all games with individual stat lines
- **Trend Charts** (future): per-game stat trends visualized over the season

---

## 7. Implementation Phases

### Phase 1: Supabase Foundation
> **Goal**: Users can register, create teams manually, and save games to the cloud.

- [ ] Set up Supabase project
- [ ] Implement auth (sign up, sign in, sign out)
- [ ] Create database schema (profiles, teams, players, games, game_stats, team_members)
- [ ] Enable RLS policies
- [ ] Migrate local-only GameContext to Supabase-backed persistence
- [ ] Add offline support: queue writes when offline, sync when reconnected

### Phase 2: Sports Engine Connect
> **Goal**: Users can link their SE account and import teams/rosters/schedules.

- [ ] Register StatKeeper as an SE OAuth2 app
- [ ] Build `se-auth-callback` Edge Function
- [ ] Build `se-sync-teams` Edge Function
- [ ] Build `se-sync-roster` Edge Function
- [ ] Build `se-sync-schedule` Edge Function
- [ ] Add "Connect Sports Engine" flow in Settings/Admin
- [ ] Display synced teams, roster, and schedule in the app
- [ ] Implement nickname/relabel UI

### Phase 3: Pre-Populated Games + Cloud Stat Tracking
> **Goal**: Today's games auto-appear; stats save to Supabase.

- [ ] "Today's Games" section on home page
- [ ] Tap-to-start flow that pre-populates Game Tracker from DB
- [ ] Save stat actions to `game_stats` in real time (with optimistic UI)
- [ ] Game finalization flow (status → final)
- [ ] Offline stat tracking with background sync

### Phase 4: Season Stats + Multi-Parent Merge
> **Goal**: Accumulated stats, leaderboards, and merged multi-recorder views.

- [ ] Season stats views/RPCs in Supabase
- [ ] Player profile page with season totals and game log
- [ ] Team leaderboard page
- [ ] Multi-parent: team invite system (team_members)
- [ ] Multi-parent: per-recorder stat views and merged team view
- [ ] Merge strategy selector for team admins
- [ ] Conflict highlighting when recorders disagree

### Phase 5: Polish + Capacitor
> **Goal**: Native app distribution and final UX polish.

- [ ] Capacitor integration (Android + iOS builds)
- [ ] Push notifications for upcoming games
- [ ] Export stats (CSV, PDF, share link)
- [ ] Trend charts and visualizations
- [ ] Dark mode

---

## 8. Environment Variables Summary

```env
# Supabase
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>

# Sports Engine (server-side only — Edge Functions)
SE_CLIENT_ID=<sports-engine-client-id>
SE_CLIENT_SECRET=<sports-engine-client-secret>
SE_REDIRECT_URI=https://<app-url>/auth/se/callback

# Future
DATABASE_URL=<if-direct-postgres-needed>
```

**Note**: `SE_CLIENT_SECRET` must never be exposed to the browser. It lives only in Supabase Edge Function environment variables.

---

## 9. File Structure (Projected)

```
src/
├── lib/
│   ├── supabase.ts           # Supabase client init
│   ├── sportsengine.ts       # SE API helper (calls Edge Functions)
│   └── sync.ts               # Offline queue + sync logic
├── hooks/
│   ├── useAuth.ts            # Auth state, sign in/out
│   ├── useTeams.ts           # Fetch/manage teams
│   ├── usePlayers.ts         # Fetch/manage roster
│   ├── useGames.ts           # Fetch/manage games
│   ├── useStats.ts           # Read/write game_stats
│   └── useSeasonStats.ts    # Aggregated season queries
├── pages/
│   ├── Auth.tsx              # Sign in / sign up
│   ├── Teams.tsx             # Team list + SE import
│   ├── PlayerProfile.tsx     # Individual season stats
│   ├── Leaderboard.tsx       # Team stat leaderboard
│   └── ConnectSE.tsx         # Sports Engine OAuth flow
supabase/
├── migrations/
│   ├── 001_profiles.sql
│   ├── 002_teams_players.sql
│   ├── 003_games_stats.sql
│   ├── 004_team_members.sql
│   └── 005_views_indexes.sql
└── functions/
    ├── se-auth-callback/
    ├── se-sync-teams/
    ├── se-sync-roster/
    └── se-sync-schedule/
```
