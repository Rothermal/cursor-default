-- ============================================================================
-- Migration 018: Seasons as first-class entity + roster junction table
-- ============================================================================
-- Introduces:
--   1. seasons          – top-level entity; teams belong to a season
--   2. team_players     – many-to-many junction replacing players.team_id
--   3. player_guardians – links players to parent/guardian users
--   4. tournaments.placement – tournament finish position
--   5. Display views    – human-readable JOINs for Supabase admin browsing
--
-- Design doc: docs/DESIGN_SEASONS_DATA_MODEL.md
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. seasons table
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  sport text NOT NULL,
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seasons_owner ON public.seasons(owner_id);

ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seasons_select" ON public.seasons
  FOR SELECT USING (
    owner_id = (SELECT auth.uid())
    OR id IN (
      SELECT t.season_id FROM public.teams t
      JOIN public.team_members tm ON tm.team_id = t.id
      WHERE tm.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "seasons_insert" ON public.seasons
  FOR INSERT WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "seasons_update" ON public.seasons
  FOR UPDATE USING (owner_id = (SELECT auth.uid()));

CREATE POLICY "seasons_delete" ON public.seasons
  FOR DELETE USING (owner_id = (SELECT auth.uid()));

-- --------------------------------------------------------------------------
-- 2. Add season_id to teams (nullable initially for data migration)
-- --------------------------------------------------------------------------

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS season_id uuid REFERENCES public.seasons(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_teams_season ON public.teams(season_id);

-- --------------------------------------------------------------------------
-- 3. team_players junction table
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.team_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  jersey_number text,
  position text,
  is_active boolean NOT NULL DEFAULT true,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_team_players_team ON public.team_players(team_id);
CREATE INDEX IF NOT EXISTS idx_team_players_player ON public.team_players(player_id);

ALTER TABLE public.team_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_players_select" ON public.team_players
  FOR SELECT USING (
    team_id IN (
      SELECT team_id FROM public.team_members WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "team_players_insert" ON public.team_players
  FOR INSERT WITH CHECK (
    team_id IN (
      SELECT team_id FROM public.team_members
      WHERE user_id = (SELECT auth.uid()) AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "team_players_update" ON public.team_players
  FOR UPDATE USING (
    team_id IN (
      SELECT team_id FROM public.team_members
      WHERE user_id = (SELECT auth.uid()) AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "team_players_delete" ON public.team_players
  FOR DELETE USING (
    team_id IN (
      SELECT team_id FROM public.team_members
      WHERE user_id = (SELECT auth.uid()) AND role IN ('owner', 'admin')
    )
  );

-- --------------------------------------------------------------------------
-- 4. player_guardians junction table
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.player_guardians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'parent',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(player_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_player_guardians_player ON public.player_guardians(player_id);
CREATE INDEX IF NOT EXISTS idx_player_guardians_user ON public.player_guardians(user_id);

ALTER TABLE public.player_guardians ENABLE ROW LEVEL SECURITY;

CREATE POLICY "player_guardians_select" ON public.player_guardians
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    OR player_id IN (
      SELECT tp.player_id FROM public.team_players tp
      JOIN public.team_members tm ON tm.team_id = tp.team_id
      WHERE tm.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "player_guardians_insert" ON public.player_guardians
  FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "player_guardians_delete" ON public.player_guardians
  FOR DELETE USING (
    user_id = (SELECT auth.uid())
    OR player_id IN (
      SELECT id FROM public.players WHERE created_by = (SELECT auth.uid())
    )
  );

-- --------------------------------------------------------------------------
-- 5. Add created_by to players (nullable initially for data migration)
-- --------------------------------------------------------------------------

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

-- --------------------------------------------------------------------------
-- 6. Add placement to tournaments
-- --------------------------------------------------------------------------

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS placement int;

-- --------------------------------------------------------------------------
-- 7. Migrate existing data
-- --------------------------------------------------------------------------

-- 7a. Create a season for each existing team that lacks one
INSERT INTO public.seasons (id, owner_id, name, sport, created_at)
SELECT
  gen_random_uuid(),
  t.owner_id,
  COALESCE(NULLIF(t.season, ''), t.name || ' Season'),
  t.sport,
  t.created_at
FROM public.teams t
WHERE t.season_id IS NULL
ON CONFLICT DO NOTHING;

-- 7b. Link existing teams to their newly created seasons
UPDATE public.teams t
SET season_id = s.id
FROM public.seasons s
WHERE t.season_id IS NULL
  AND s.owner_id = t.owner_id
  AND s.sport = t.sport
  AND s.name = COALESCE(NULLIF(t.season, ''), t.name || ' Season');

-- 7c. Populate team_players from existing players.team_id
INSERT INTO public.team_players (team_id, player_id, jersey_number, position, is_active, joined_at)
SELECT
  p.team_id,
  p.id,
  p.jersey_number,
  p.position,
  p.is_active,
  p.created_at
FROM public.players p
WHERE p.team_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.team_players tp
    WHERE tp.team_id = p.team_id AND tp.player_id = p.id
  );

-- 7d. Set created_by on players from their team's owner
UPDATE public.players p
SET created_by = t.owner_id
FROM public.teams t
WHERE p.created_by IS NULL
  AND p.team_id = t.id;

-- 7e. Create guardian links for player creators
INSERT INTO public.player_guardians (player_id, user_id, relationship)
SELECT p.id, p.created_by, 'parent'
FROM public.players p
WHERE p.created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.player_guardians pg
    WHERE pg.player_id = p.id AND pg.user_id = p.created_by
  );

-- --------------------------------------------------------------------------
-- 8. Update RLS policies on players for new ownership model
-- --------------------------------------------------------------------------

-- Drop old policies that reference team_id
DROP POLICY IF EXISTS "players_select_member" ON public.players;
DROP POLICY IF EXISTS "players_insert_admin" ON public.players;
DROP POLICY IF EXISTS "players_update_admin" ON public.players;
DROP POLICY IF EXISTS "players_delete_admin" ON public.players;

-- New policies: creator + guardian + team-member visibility
CREATE POLICY "players_select" ON public.players
  FOR SELECT USING (
    created_by = (SELECT auth.uid())
    OR id IN (
      SELECT player_id FROM public.player_guardians WHERE user_id = (SELECT auth.uid())
    )
    OR id IN (
      SELECT tp.player_id FROM public.team_players tp
      JOIN public.team_members tm ON tm.team_id = tp.team_id
      WHERE tm.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "players_insert" ON public.players
  FOR INSERT WITH CHECK (created_by = (SELECT auth.uid()));

CREATE POLICY "players_update" ON public.players
  FOR UPDATE USING (
    created_by = (SELECT auth.uid())
    OR id IN (
      SELECT player_id FROM public.player_guardians WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "players_delete" ON public.players
  FOR DELETE USING (created_by = (SELECT auth.uid()));

-- --------------------------------------------------------------------------
-- 9. Schema cleanup: make new columns NOT NULL, drop old columns
-- --------------------------------------------------------------------------

-- teams.season_id NOT NULL (all rows should have been populated by migration step 7b)
-- NOTE: if any teams still have NULL season_id, create a fallback season
INSERT INTO public.seasons (id, owner_id, name, sport, created_at)
SELECT
  gen_random_uuid(),
  t.owner_id,
  t.name || ' (auto)',
  COALESCE(t.sport, 'basketball'),
  t.created_at
FROM public.teams t
WHERE t.season_id IS NULL;

UPDATE public.teams t
SET season_id = s.id
FROM public.seasons s
WHERE t.season_id IS NULL
  AND s.owner_id = t.owner_id
  AND s.name = t.name || ' (auto)';

ALTER TABLE public.teams ALTER COLUMN season_id SET NOT NULL;

-- players.created_by NOT NULL (fallback for any orphaned players)
UPDATE public.players
SET created_by = (SELECT id FROM public.profiles LIMIT 1)
WHERE created_by IS NULL
  AND EXISTS (SELECT 1 FROM public.profiles LIMIT 1);

-- Only set NOT NULL if all rows have created_by
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE created_by IS NULL) THEN
    ALTER TABLE public.players ALTER COLUMN created_by SET NOT NULL;
  END IF;
END $$;

-- Drop old columns (safe: app code updated to use new tables)
ALTER TABLE public.teams DROP COLUMN IF EXISTS season;
ALTER TABLE public.teams DROP COLUMN IF EXISTS sport;
ALTER TABLE public.players DROP COLUMN IF EXISTS team_id;
ALTER TABLE public.players DROP COLUMN IF EXISTS jersey_number;
ALTER TABLE public.players DROP COLUMN IF EXISTS position;
ALTER TABLE public.players DROP COLUMN IF EXISTS is_active;

-- --------------------------------------------------------------------------
-- 10. Display views for Supabase admin browsing
-- --------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.seasons_display AS
SELECT
  s.id,
  s.name AS season_name,
  s.sport,
  s.start_date,
  s.end_date,
  s.owner_id,
  p.display_name AS owner_name,
  s.created_at
FROM public.seasons s
LEFT JOIN public.profiles p ON p.id = s.owner_id;

CREATE OR REPLACE VIEW public.teams_display AS
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
FROM public.teams t
LEFT JOIN public.seasons s ON s.id = t.season_id
LEFT JOIN public.profiles p ON p.id = t.owner_id;

CREATE OR REPLACE VIEW public.players_display AS
SELECT
  pl.id,
  pl.first_name,
  pl.last_name,
  pl.first_name || ' ' || COALESCE(pl.last_name, '') AS full_name,
  pl.nickname,
  pl.created_by,
  p.display_name AS created_by_name,
  pl.created_at
FROM public.players pl
LEFT JOIN public.profiles p ON p.id = pl.created_by;

CREATE OR REPLACE VIEW public.team_players_display AS
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
FROM public.team_players tp
JOIN public.teams t ON t.id = tp.team_id
LEFT JOIN public.seasons s ON s.id = t.season_id
JOIN public.players pl ON pl.id = tp.player_id;

CREATE OR REPLACE VIEW public.player_guardians_display AS
SELECT
  pg.id,
  pg.player_id,
  pl.first_name || ' ' || COALESCE(pl.last_name, '') AS player_name,
  pg.user_id,
  p.display_name AS guardian_name,
  pg.relationship,
  pg.created_at
FROM public.player_guardians pg
JOIN public.players pl ON pl.id = pg.player_id
LEFT JOIN public.profiles p ON p.id = pg.user_id;

CREATE OR REPLACE VIEW public.games_display AS
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
FROM public.games g
LEFT JOIN public.teams t ON t.id = g.team_id
LEFT JOIN public.seasons s ON s.id = t.season_id
LEFT JOIN public.tournaments tour ON tour.id = g.tournament_id
LEFT JOIN public.profiles p ON p.id = g.created_by;

CREATE OR REPLACE VIEW public.game_stats_display AS
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
FROM public.game_stats gs
JOIN public.games g ON g.id = gs.game_id
LEFT JOIN public.teams t ON t.id = g.team_id
JOIN public.players pl ON pl.id = gs.player_id
LEFT JOIN public.profiles p ON p.id = gs.recorded_by;

CREATE OR REPLACE VIEW public.tournaments_display AS
SELECT
  tour.id,
  tour.team_id,
  t.name AS team_name,
  s.name AS season_name,
  tour.name AS tournament_name,
  tour.placement,
  tour.created_at
FROM public.tournaments tour
JOIN public.teams t ON t.id = tour.team_id
LEFT JOIN public.seasons s ON s.id = t.season_id;

CREATE OR REPLACE VIEW public.team_members_display AS
SELECT
  tm.id,
  tm.team_id,
  t.name AS team_name,
  tm.user_id,
  p.display_name AS member_name,
  tm.role,
  tm.invited_at,
  tm.accepted_at
FROM public.team_members tm
JOIN public.teams t ON t.id = tm.team_id
LEFT JOIN public.profiles p ON p.id = tm.user_id;

COMMENT ON TABLE public.seasons IS 'Top-level entity. Teams belong to a season. One season per league/period.';
COMMENT ON TABLE public.team_players IS 'Junction: links players to teams. A player can be on many teams across seasons.';
COMMENT ON TABLE public.player_guardians IS 'Junction: links players to parent/guardian users for management and player pool.';
COMMENT ON COLUMN public.tournaments.placement IS 'Tournament finish position (1=1st, 2=2nd, etc.). User-entered.';
