# Integration Plan: Supabase

This document lays out the architecture, data model, and phased implementation plan for integrating StatKeeper with **Supabase** (cloud database, auth, real-time sync).

> **Note**: Sports Engine API integration was originally planned but is not currently available (developer API access required). The data model retains fields (`se_*` columns) for future SE integration if access becomes available. In the meantime, all team/roster/schedule data is entered manually through the app.

---

## Vision

A parent opens StatKeeper, signs in, and manages their kids' teams with rosters and schedules. They create a game, the stat tracker loads the roster, and stats are tracked in real time. After the game, stats are saved to the cloud and accumulate across the season. Multiple parents on the same team can each track stats independently, and a checkout system determines whose stats are the official record.

---

## 1. Supabase Integration

### 1.1 Auth

| Aspect | Detail |
|---|---|
| Provider | Supabase Auth (email/password + Google OAuth; provider setup lives in Supabase/Google dashboards) |
| Client | `@supabase/supabase-js` only (no separate auth-helpers package in this repo) |
| Session | JWT stored automatically by Supabase client; refresh handled transparently |
| RLS | Row Level Security on cloud tables; see each `supabase/migrations/*.sql` for policies |

**Env variables** (`.env`); see `.env.example` in repo:
```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
# Legacy fallback still supported in code:
# VITE_SUPABASE_ANON_KEY=<anon-key>
```

### 1.2 Database schema (canonical, migrations 018+)

The **ASCII diagram below is historical (pre–018)** and shows `players.team_id` and sport on `teams` — **that is not the current schema**. Use **`supabase/migrations/`** and the **README** migration list (001–**033**) as the source of truth.

**Current product model (summary):**

| Area | Notes |
|------|--------|
| **Seasons & teams** | `seasons` (sport CHECK, optional `team_stats_config`), `teams` (`season_id` required), `team_members`, `team_invites` |
| **Roster** | `players` (global; `created_by`; optional `is_team_placeholder`); **`team_players`** junction — **no** `players.team_id` |
| **Games** | `games`: `team_id`, **`season_id`** (denormalized, trigger per **019**), `tournament_id`, scores, notes, `last_opened_at`, team placeholder FKs (**030**), `created_by`, status |
| **Stats & chart** | `game_stats`, RPCs **010**, `stat_corrections`, `player_checkouts`, **`shot_chart` (032)** |
| **Debug** | **`client_sync_errors` (033)** — optional client logging of failed snapshot sync |

**Integrity:** **`019_data_integrity_constraints.sql`** — tournament/game team checks, jersey uniqueness (partial index), unique team name per season, etc. See [`completed/DATA_INTEGRITY_AND_CREATION_PLAN.md`](completed/DATA_INTEGRITY_AND_CREATION_PLAN.md).

<details>
<summary>Historical pre-018 ERD (do not use for implementation)</summary>

```
┌─────────────────────────────────────────────────────────────────────────┐
│  (Legacy) teams had sport/season on team; players had team_id — removed  │
│  in migration 018 in favor of seasons + team_players.)                │
└─────────────────────────────────────────────────────────────────────────┘
```

</details>

Migrations **`008`–`010`** implement checkouts, corrections, and resolved-stats RPCs. **`018`** is the seasons / roster junction redesign; **`019`** adds constraints and `games.season_id`.

### 1.3 Row Level Security

Policies are defined **per migration** (not duplicated here). Patterns: team-scoped read on games/stats; recorders write their own `game_stats` / `shot_chart` rows; stricter rules for admin corrections and player merge. See `003`, `004`–`006`, `008`, `009`, `032`, `033`, etc.

### 1.4 Indexes

Created alongside tables in migrations (e.g. `idx_game_stats_*`, `idx_shot_chart_*`, `idx_games_season`). There is **no** `idx_players_team` on a `players.team_id` column in the shipped schema.

---

## 2. Sports Engine Integration (Deferred — API access not currently available)

> **Status**: This section is retained for future reference. The data model includes `se_*` columns so no schema changes will be needed when SE access becomes available. Until then, all team/roster/schedule data is entered manually.

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
| `se-sync-roster` | Fetch roster for a team; in the **current** schema would upsert **`players`** + **`team_players`** (not `players.team_id`) |
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

## 3. Multi-Parent Stat Tracking

### 3.1 Core Principle

The **team** is the source of truth, not any individual parent. Multiple parents on the same team can all track stats for the same game simultaneously. Every stat submission is stored in the database regardless of who recorded it — nothing is ever discarded. The UI decides which record to surface as the "official" view using a lightweight **player checkout** system.

### 3.2 Player Checkout Model

Before a game starts, a parent "checks out" the players they intend to track. This is a soft claim — it tells the system "I'm the designated stat tracker for these players in this game." It is **not enforced in real time**; other parents can still submit stats for the same players. The checkout simply determines whose stats are displayed as the canonical view.

**How it works:**

```
1. Parent opens a game → sees the full roster
2. Parent taps "Track" on one or more players
   → Creates a player_checkout record (game_id, player_id, user_id)
   → Those players highlight as "yours" in the Game Tracker
3. Parent tracks stats normally for their checked-out players
4. Other parents can also track the same players (no block)
5. In the Team View, the checked-out parent's stats are shown as primary
6. All other submissions remain in the DB as secondary records
```

**Key rules:**

| Rule | Detail |
|---|---|
| Not enforced | Any parent can submit stats for any player at any time |
| Soft claim | Checkout is a UI hint, not a lock |
| One primary per player per game | If two parents check out the same player, the first claim wins as primary; second becomes secondary (or team admin can reassign) |
| Changeable | Admin can reassign checkout after the fact to correct the primary source |
| Optional | If no one checks out a player, all submissions are weighted equally |

### 3.3 Database Design

```sql
-- New table: tracks which parent is the designated recorder per player per game
CREATE TABLE player_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id),
  is_primary boolean NOT NULL DEFAULT true,
  checked_out_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(game_id, player_id, user_id)
);

CREATE INDEX idx_checkouts_game ON player_checkouts(game_id);
CREATE INDEX idx_checkouts_game_player ON player_checkouts(game_id, player_id);

ALTER TABLE player_checkouts ENABLE ROW LEVEL SECURITY;

-- Any team member can see checkouts for their team's games
CREATE POLICY "checkouts_read" ON player_checkouts
  FOR SELECT USING (
    game_id IN (SELECT id FROM games WHERE team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    ))
  );

-- Users can create their own checkouts
CREATE POLICY "checkouts_create" ON player_checkouts
  FOR INSERT WITH CHECK (user_id = auth.uid());
```

The existing `game_stats` table already has `recorded_by` — no changes needed there. All stat records from all parents are kept.

### 3.4 Resolution Logic

The primary flag is **not just a UI hint** — it is the single source of truth for all computed totals: game scores, season accumulations, leaderboards, and player profiles. Wherever the app shows a stat total, it uses the resolved value derived from the primary recorder's data.

**Resolution priority (highest to lowest):**

```
For each (game, player, stat):
  1. Admin override exists in stat_corrections?
     → Yes: use the corrected value (highest authority)
  2. Is there a player_checkout with is_primary = true
     and that parent submitted stats?
     → Yes: use the primary recorder's game_stats
  3. Exactly one parent submitted stats (no checkout)?
     → Yes: use their stats (unambiguous)
  4. Multiple parents submitted, no checkout or primary:
     → Average the values and flag as "⚠ needs review"
     → These DO contribute to totals (best-effort) but are
       surfaced in the admin review queue for resolution
```

**Resolved stats RPC:**

```sql
CREATE OR REPLACE FUNCTION get_game_stats_resolved(p_game_id uuid)
RETURNS TABLE (
  player_id uuid,
  stat_id text,
  value int,
  source text,        -- 'correction' | 'primary' | 'sole' | 'averaged'
  recorded_by uuid,
  recorder_count int
) AS $$
  WITH corrections AS (
    SELECT player_id, stat_id, corrected_value AS value,
           corrected_by AS recorded_by, 'correction'::text AS source
    FROM stat_corrections
    WHERE game_id = p_game_id
  ),
  primary_stats AS (
    SELECT gs.player_id, gs.stat_id, gs.value,
           gs.recorded_by, 'primary'::text AS source
    FROM game_stats gs
    JOIN player_checkouts pc
      ON pc.game_id = gs.game_id
      AND pc.player_id = gs.player_id
      AND pc.user_id = gs.recorded_by
      AND pc.is_primary = true
    WHERE gs.game_id = p_game_id
  ),
  sole_stats AS (
    SELECT gs.player_id, gs.stat_id, gs.value,
           gs.recorded_by, 'sole'::text AS source
    FROM game_stats gs
    WHERE gs.game_id = p_game_id
    AND NOT EXISTS (
      SELECT 1 FROM game_stats gs2
      WHERE gs2.game_id = gs.game_id
        AND gs2.player_id = gs.player_id
        AND gs2.stat_id = gs.stat_id
        AND gs2.recorded_by != gs.recorded_by
    )
  ),
  averaged_stats AS (
    SELECT gs.player_id, gs.stat_id,
           ROUND(AVG(gs.value))::int AS value,
           NULL::uuid AS recorded_by, 'averaged'::text AS source
    FROM game_stats gs
    WHERE gs.game_id = p_game_id
    GROUP BY gs.player_id, gs.stat_id
    HAVING COUNT(DISTINCT gs.recorded_by) > 1
  ),
  resolved AS (
    -- Priority: corrections > primary > sole > averaged
    SELECT DISTINCT ON (player_id, stat_id)
      player_id, stat_id, value, source, recorded_by
    FROM (
      SELECT *, 1 AS priority FROM corrections
      UNION ALL
      SELECT *, 2 AS priority FROM primary_stats
      UNION ALL
      SELECT *, 3 AS priority FROM sole_stats
      UNION ALL
      SELECT *, 4 AS priority FROM averaged_stats
    ) all_sources
    ORDER BY player_id, stat_id, priority
  )
  SELECT
    r.player_id, r.stat_id, r.value, r.source, r.recorded_by,
    (SELECT COUNT(DISTINCT gs.recorded_by)
     FROM game_stats gs
     WHERE gs.game_id = p_game_id
       AND gs.player_id = r.player_id
       AND gs.stat_id = r.stat_id
    )::int AS recorder_count
  FROM resolved r
  ORDER BY r.player_id, r.stat_id;
$$ LANGUAGE sql STABLE;
```

The `source` column tells the UI where each value came from, so it can render indicators (e.g., a pencil icon for corrections, a warning for averaged values).

**Current UI:** GameSummary now calls `get_game_stats_resolved` for finalized cloud games, so admins and parents always see the resolved values (after checkout + corrections).

### 3.5 Admin Stat Corrections

Team admins (role = `owner` or `admin` in `team_members`) can review and correct stats after a game. Corrections are stored in a dedicated table — they never overwrite the original parent-submitted records.

**Why a separate table?**
- Full audit trail: you can always see what parents originally submitted
- Admin corrections are clearly attributed (`corrected_by`)
- Reason field captures why the change was made
- Corrections take highest priority in resolution without destroying data

```sql
CREATE TABLE stat_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  stat_id text NOT NULL,
  corrected_value int NOT NULL,
  original_primary_value int,  -- snapshot of what was there before
  corrected_by uuid NOT NULL REFERENCES profiles(id),
  reason text,                 -- e.g., "scorer miscounted 3-pointers"
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(game_id, player_id, stat_id)  -- one correction per stat per player per game
);

CREATE INDEX idx_corrections_game ON stat_corrections(game_id);

ALTER TABLE stat_corrections ENABLE ROW LEVEL SECURITY;

-- Team members can view corrections for their teams
CREATE POLICY "corrections_read" ON stat_corrections
  FOR SELECT USING (
    game_id IN (SELECT id FROM games WHERE team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    ))
  );

-- Only team admins/owners can create or update corrections
CREATE POLICY "corrections_admin_write" ON stat_corrections
  FOR INSERT WITH CHECK (
    corrected_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM games g
      JOIN team_members tm ON tm.team_id = g.team_id
      WHERE g.id = game_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "corrections_admin_update" ON stat_corrections
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM games g
      JOIN team_members tm ON tm.team_id = g.team_id
      WHERE g.id = game_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin')
    )
  );
```

**Admin correction flow (current implementation):**

```
1. Admin opens Game Summary for a finalized game (team owner/admin only).
2. Taps "Review / Correct stats" → enters admin review mode in Game Summary.
3. The summary table shows resolved stats; in review mode each stat cell has a pencil icon.
4. Admin taps the pencil on a stat → modal opens: current value (read-only), new value (number), optional reason.
5. Saves → stat_corrections record created (upsert on game_id, player_id, stat_id).
6. Resolved stats are refetched; game score and table immediately reflect the corrected value.
7. Corrections flow through to future season/leaderboard views when those UIs call get_game_stats_resolved / get_season_stats_resolved.
```

**Shipped on Game Summary:** Primary vs All Submissions toggle, conflict indicators, "Stats needing review," reassign primary recorder (`set_primary_recorder`), and inline per-stat corrections. A dedicated full-page side-by-side review UI (beyond the All Submissions toggle) remains optional polish, not required for Phase 3.

### 3.6 UI Flow

**Implemented screens:** Checkout screen → `GameCheckout.tsx` (route `/checkout`). Game Tracker → `GameTracker.tsx`. Game Summary and admin review → `GameSummary.tsx` (Primary/All toggle, review mode with per-stat corrections, primary-recorder reassignment).

**Before the game — Checkout Screen:**
```
┌─────────────────────────────────────────┐
│  Eagles vs Tigers — Feb 28             │
│  Who are you tracking?                  │
│                                         │
│  [✓] #23 Michael Jordan    ← you       │
│  [✓] #11 Steve Nash        ← you       │
│  [ ] #33 Larry Bird        ← Mom (Jane)│
│  [ ] #5  Magic Johnson     ← unclaimed │
│                                         │
│  [Start Tracking →]                     │
└─────────────────────────────────────────┘
```

- Checked-out players show who claimed them
- Unclaimed players are available for anyone
- Already-claimed players show the other parent's name but can still be tapped (becomes secondary)

**During the game — Game Tracker:**
- Parent sees all players in the roster selector (as today)
- Checked-out players are highlighted / pinned to the front
- Stats for non-checked-out players still work — just won't be primary

**After the game — Game Summary:**
- Shows resolved stats (primary recorder per player, or admin correction if present) for finalized cloud games via `get_game_stats_resolved`.
- Team owner/admin can tap "Review / Correct stats" to enter review mode; pencil icon on each stat opens a correction modal (new value + optional reason).
- **Primary View** vs **All Submissions** toggle is shipped on Game Summary for finalized cloud games; a separate full-page side-by-side review remains optional polish.

### 3.7 Season Stats with Checkout + Corrections

Game totals, season accumulations, leaderboards, and player profiles all use the same resolution chain: **corrections > primary checkout > sole recorder > averaged**. This is implemented as a single reusable function that the season view calls per game:

```sql
CREATE OR REPLACE FUNCTION get_season_stats_resolved(p_team_id uuid)
RETURNS TABLE (
  player_id uuid,
  stat_id text,
  games_played bigint,
  total bigint,
  per_game_avg numeric,
  season_high int
) AS $$
  WITH game_resolved AS (
    -- Reuse the same resolution logic from get_game_stats_resolved
    -- across all finalized games for the team
    SELECT g.id AS game_id, r.*
    FROM games g,
    LATERAL get_game_stats_resolved(g.id) r
    WHERE g.team_id = p_team_id
      AND g.status = 'final'
  )
  SELECT
    player_id,
    stat_id,
    COUNT(DISTINCT game_id) AS games_played,
    SUM(value) AS total,
    ROUND(AVG(value), 1) AS per_game_avg,
    MAX(value) AS season_high
  FROM game_resolved
  GROUP BY player_id, stat_id;
$$ LANGUAGE sql STABLE;
```

This means:
- If an admin corrects a stat for a past game, season totals update immediately
- If a primary checkout is reassigned, season totals recalculate from the new primary
- No separate "recalculate season" step is ever needed — it's always derived

**Current UI:** Season stats UIs **shipped** and consume `get_season_stats_resolved` (and related RPCs): Leaderboard, Player Profile, Career (`get_career_stats_resolved`), Team Stats, Tournament Stats. See [DESIGN_STAT_TRACKING_UI.md](DESIGN_STAT_TRACKING_UI.md). Per-game resolution remains on Game Summary via `get_game_stats_resolved`.

### 3.8 Edge Cases

| Scenario | Behavior |
|---|---|
| No one checks out any players | All submissions treated equally; if multiple, average shown with indicator; flagged for admin review |
| Two parents check out the same player | First checkout is `is_primary = true`; second is `is_primary = false`. Admin can swap. |
| Parent checks out a player but doesn't submit stats | No stats for that player from that parent; system falls back to any other submissions |
| Parent submits stats without checking out | Stats are stored; shown in "All Submissions" but not in primary view unless no checkout exists |
| Admin reassigns primary after game | Update `is_primary` flag; game totals and season stats immediately recalculate |
| Parent tracks a player mid-game without prior checkout | Can create a checkout at any point; prior stats from that parent retroactively become primary for that game |
| Admin corrects a stat | `stat_corrections` record created; overrides all parent submissions for that (game, player, stat); season totals update immediately |
| Admin corrects a stat then changes mind | Admin updates or deletes the correction; resolution falls back to primary checkout or next in chain |
| Discrepancy between two parents, no correction | Averaged value used in totals with warning; appears in admin review queue until resolved |

---

## 4. Nickname / Relabeling System

Players and teams can have a `nickname` field as a display override.

| Field | Primary Name | Override |
|---|---|---|
| `teams.name` | "Spring 2026 U12 Boys Blue" | `teams.nickname`: "Blue Lightning" |
| `players.first_name` / `last_name` | "Michael Jordan" | `players.nickname`: "MJ" |

**Display logic**: Show `nickname` if set, otherwise fall back to the primary name. If SE integration is added in the future, syncs will never overwrite the nickname field.

---

## 5. Pre-Populated Game Flow

When an authenticated user opens StatKeeper:

```
1. Dashboard shows their teams
   → Each team card shows upcoming/today's games

2. User creates a game (or taps an existing scheduled game)
   → Enter opponent name, date, tournament (if creating)
   → Roster loaded from team's players

3. Checkout screen: full roster with checkboxes (multi-parent mode)
   → Players already claimed by other parents show their name
   → User checks out the player(s) they want to track
   → player_checkouts records created

4. User taps "Start Tracking"
   → Game Tracker opens pre-populated with:
     - Team name and opponent (from games table)
     - Full roster (from players table, is_active = true)
     - Checked-out players highlighted / pinned first
     - Sport-specific stat categories (from sport config)

5. User tracks stats → saved to game_stats with recorded_by = auth.uid()
   → Other parents may be tracking simultaneously on their own devices

6. After game: user taps "Finalize" → game.status = 'final'
   → Stats contribute to season totals
   → Resolved view uses checkout primary to determine canonical stats
```

---

## 6. Season Statistics

### 6.1 Computed Views

Season stats use `get_season_stats_resolved()` from section 3.7, which applies the full resolution chain (**corrections > primary checkout > sole recorder > averaged**) across all finalized games. This means admin corrections and primary reassignments are immediately reflected in season totals, leaderboards, and player profiles without any manual recalculation step.

### 6.2 Season Stats UI

- **Player Profile**: season totals, per-game averages, game log
- **Team Leaderboard**: sortable by any stat (top scorer, most assists, etc.)
- **Game Log**: chronological list of all games with individual stat lines
- **Trend Charts** (future): per-game stat trends visualized over the season

---

## 7. Implementation Phases

### Phase 1: Supabase Foundation ← **CURRENT**
> **Goal**: Users can register, create teams manually, and save games to the cloud.

- [x] Set up Supabase project
- [x] Implement auth (sign up, sign in, sign out)
- [x] Create database schema (profiles, teams, players, games, game_stats, team_members)
- [x] Enable RLS policies
- [x] Persistent team management (create team, manage roster manually)
- [x] Cloud-backed game tracking (games + stats saved to Supabase)
- [ ] Migrate local-only GameContext to Supabase-backed persistence (cloud-first hydration and sync-on-reconnect are implemented; fuller cloud-first state management remains)
- [ ] Add offline support: durable queue writes when offline, sync in background/reconnect (in-session snapshot replay and persistent pending-sync flag on reconnect are implemented; background sync when tab closed remains)

Status note: authenticated sessions now support cloud teams/rosters, existing-team game setup, roster preload, game/stat snapshot sync, deterministic active-game hydration on sign-in (cloud-backed by `games.last_opened_at`), cloud game history/finalization, snapshot-based offline reconnect sync replay, and a durable pending-sync flag so reopening the app after going offline triggers sync. Remaining Phase 1 items are fuller cloud-first state management and background offline queueing.
If `001`-`003` were applied before the latest RLS fixes, also apply `004_team_members_rls_fix.sql`, `005_team_members_rls_recursion_cycle_fix.sql`, and `006_teams_insert_policy_fix.sql`.
To enable cross-device deterministic active-game preference, apply `007_games_last_opened_preference.sql` once (no rerun of `001`-`006` needed if they already succeeded).

### Phase 2: Cloud Stat Tracking + Game Management
> **Goal**: Full game lifecycle in the cloud with pre-populated rosters.

- [x] Game creation from team roster
- [x] Save stat actions to `game_stats` in real time (debounced snapshot sync + flush on leave Game Tracker)
- [x] Game finalization flow (status → final)
- [x] Nickname/relabel UI for teams and players (Cloud Teams page: team and player display names)
- [x] Offline stat tracking with **multi-game parking + explicit per-game sync queue** (local parked records can mix sports; dirty records drain when online; cloud sync now resolves roster/player rows before inserting new `games` rows and best-effort rolls back a just-created game if child writes fail — see [PLAN_MULTI_GAME_PARKING.md](PLAN_MULTI_GAME_PARKING.md))

### Phase 3: Season Stats + Multi-Parent Checkout + Admin Review
> **Goal**: Accumulated stats, leaderboards, player checkout, and admin stat corrections.

- [x] Player checkout UI (pre-game roster screen with claim toggles) — `GameCheckout.tsx`, route `/checkout`
- [x] `player_checkouts` table and RLS policies (migration 008)
- [x] `stat_corrections` table and admin-only RLS policies (migration 009)
- [x] Resolved stats RPC (`get_game_stats_resolved`) with full priority chain (migration 010)
- [x] Season stats RPC (`get_season_stats_resolved`) (migration 010)
- [x] Season stats UI — Leaderboard (team selector, sortable by stat), Player Profile (season totals, game log, view game)
- [x] Team invite system — invite by email (owner/admin), accept/decline, roles, member list (migration 011)
- [x] Game Summary: "Primary View" vs "All Submissions" toggle (design: [completed/DESIGN_PHASE3_GAME_SUMMARY_ADMIN.md](completed/DESIGN_PHASE3_GAME_SUMMARY_ADMIN.md))
- [x] Admin: reassign primary checkout after a game (Game Summary "Primary recorder" section; RPC `set_primary_recorder`, migration 014)
- [ ] Admin: dedicated full-page side-by-side parent submissions (optional; All Submissions toggle + review queue already on Game Summary)
- [x] Admin: correct individual stats with reason (audit trail) — inline in Game Summary review mode
- [x] Admin: review queue for unresolved discrepancies (averaged stats) — "Stats needing review" section on Game Summary with Correct / Set primary recorder links
- [x] Player profile page with season totals and game log
- [x] Team leaderboard page (uses resolved totals)
- [x] Conflict indicator when multiple parents tracked same player without checkout
- [x] **Basketball court capture / shot chart** — inline on Game Tracker (`#/game`); legacy `#/shot-chart` redirects; migration **032**; sync in `cloudSync.ts`
- [x] **Basketball team stats** — pseudo-players, `seasons.team_stats_config`, migrations **027–031**, Game Summary team tab
- [x] **Team Info hub** — `/team?teamId=` plus roster/schedule/season/game/player drill-downs and `/team/manage` ([DESIGN_TEAM_INFO_PAGE.md](DESIGN_TEAM_INFO_PAGE.md))
- [x] **Sync diagnostics** — `client_sync_errors` (**033**), `logClientSyncError.ts`, UUID validation for `playerIdMap` (`uuidValidation.ts`)
- [ ] Invite links: shareable URL to join team (design: [archived/DESIGN_MULTI_PARENT_INVITE_LINKS.md](archived/DESIGN_MULTI_PARENT_INVITE_LINKS.md))

### Phase 4: Polish + Capacitor
> **Goal**: Native app distribution and final UX polish.

- [ ] Capacitor integration (Android + iOS builds)
- [ ] Push notifications for upcoming games
- [ ] Export stats (CSV, PDF, share link)
- [ ] Trend charts and visualizations
- [ ] Dark mode

### Phase 5: Sports Engine Integration (Future — requires API access)
> **Goal**: Import teams/rosters/schedules from Sports Engine.

- [ ] Register StatKeeper as an SE OAuth2 app
- [ ] Build Edge Functions for OAuth callback and data sync
- [ ] Auto-import rosters and schedules
- [ ] Schedule sync (daily cron)

> This phase is blocked until Sports Engine developer API access is available. The data model already includes `se_*` columns so no schema changes will be needed.

---

## 8. GitHub Pages Deployment

| Item | Value |
|------|-------|
| **Live URL** | [https://rothermal.github.io/cursor-default/](https://rothermal.github.io/cursor-default/) |
| **Status** | Deployed |
| **Trigger** | Push to `stattracker` branch |
| **Workflow** | `.github/workflows/deploy.yml` |
| **Build** | `pnpm build` with `VITE_SUPABASE_URL` and a Supabase **publishable** or **anon** key from GitHub Actions secrets (workflow currently passes `VITE_SUPABASE_ANON_KEY`; the app prefers `VITE_SUPABASE_PUBLISHABLE_KEY` when set — see `src/lib/supabase.ts`) |

Supabase credentials must be set as [GitHub repository secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets) for cloud features (auth, teams, games, sync) to work in production. See [`GITHUB_PAGES_DEPLOY.md`](../GITHUB_PAGES_DEPLOY.md) for setup steps. **Deploy branch:** `stattracker` (see `.github/workflows/deploy.yml`).

---

## 9. Environment Variables Summary

```env
# Supabase (required for cloud) — see .env.example in repo
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
# Legacy (still read by src/lib/supabase.ts if publishable is unset):
# VITE_SUPABASE_ANON_KEY=<anon-key>
```

The `VITE_` prefix is required by Vite to expose variables to the browser. The publishable/anon key is safe for client-side use because Row Level Security protects data server-side.

---

## 10. Future Enhancements

> **Note:** Many items that historically lived in this backlog are **already shipped** (home score adjustment, tournaments table, minutes, notes, missed shots, deletes, seasons on games, etc.). Treat the **README** “Features / What’s Done” sections as the live checklist. What follows is a **short residual backlog**; older numbered items were archived into README where implemented.

1. **Optional stat descriptions** — Toggle for full stat names vs abbreviations.
2. **Bulk / archive games** — Beyond per-row delete in Games and Settings -> Advanced data management.
3. **Multi-game parking + sync queue** — Multiple in-progress sessions per device, offline-safe; see [PLAN_MULTI_GAME_PARKING.md](PLAN_MULTI_GAME_PARKING.md).
4. *(Add more as we go)*

> **Shipped (removed from residual backlog):** in-progress and final scores on Cloud Games / home resume cards (F4); Team Info hub ([DESIGN_TEAM_INFO_PAGE.md](DESIGN_TEAM_INFO_PAGE.md)).

---

## 11. Known Issues

1. **Verify historical duplicate final/in-progress listing** — Older notes reported that a completed cloud game could appear as both final and in progress after finalization. Re-test this against the current Cloud Games flow before treating it as an active bug; if it still reproduces, fix the finalization/list filtering path.

---

## 12. Performance updates

1. **RLS policy re-evaluates per row** — Supabase warns: Table `public.profiles` has a row level security policy `profiles_select_own` that re-evaluates `current_setting()` or `auth.<function>()` for each row, which hurts query performance at scale. Fix: replace `auth.uid()` (and similar) with `(select auth.uid())` in the policy so the result is cached per statement. See [Call functions with select](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select).

---

## 13. Regression testing

High-level test scripts for all features (offline, auth, teams, games, checkout, corrections, season stats, invites, PWA, deploy) are in [`docs/REGRESSION_TESTING.md`](REGRESSION_TESTING.md).

---

## 14. File structure (reference)

> **Note:** This tree is a **compact index**, not an exhaustive file list. See **README → Project structure** for the canonical layout.

```
src/
├── lib/
│   ├── supabase.ts, cloudSync.ts, logClientSyncError.ts, uuidValidation.ts
│   ├── teamPlayers.ts, gameScore.ts, statDisplay.ts, …
├── context/
│   ├── AuthContext.tsx, GameContext.tsx, SettingsContext.tsx
├── pages/
│   ├── Auth, SportSelect, GameSetup, PlayerSetup, GameCheckout, GameTracker
│   ├── GameSummary, Games, Teams (/teams + /team/manage), Admin
│   ├── TeamInfo, TeamRoster, TeamSchedule, SeasonInfo, GameInfo
│   ├── Leaderboard, PlayerProfile (/player + /player-info)
│   ├── CareerStats (/career), TeamStats (/team-stats), TournamentStats (/tournament-stats)
│   ├── ShotChart (legacy redirect → /game), ShotChartPreview (dev: /dev/shot-chart)
├── App.tsx                  # HashRouter routes
supabase/migrations/
│   └── 001 … 033 (see README for full names: through client_sync_errors)
```

Admin review and stat corrections live in **Game Summary**, not a separate `AdminReview` page. Court capture is **inline on Game Tracker**; see [AGENT_CODEBASE_OVERVIEW.md](AGENT_CODEBASE_OVERVIEW.md) for the full route table and [DESIGN_TEAM_INFO_PAGE.md](DESIGN_TEAM_INFO_PAGE.md) for the Team Info hierarchy.
