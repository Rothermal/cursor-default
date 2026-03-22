-- Stat tracking UI (Phase 6): RPCs for player game log and career stats.
-- See docs/DESIGN_STAT_TRACKING_UI.md

-- Per-game resolved stat lines for one player on one team (finalized games).
CREATE OR REPLACE FUNCTION public.get_player_game_log(
  p_player_id uuid,
  p_team_id uuid
)
RETURNS TABLE (
  game_id uuid,
  game_date date,
  opponent_name text,
  stat_id text,
  value int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    g.id AS game_id,
    g.game_date,
    g.opponent_name,
    r.stat_id,
    r.value
  FROM public.games g
  CROSS JOIN LATERAL public.get_game_stats_resolved(g.id) r
  WHERE g.team_id = p_team_id
    AND g.status = 'final'
    AND r.player_id = p_player_id
  ORDER BY g.game_date DESC, r.stat_id;
$$;

COMMENT ON FUNCTION public.get_player_game_log(uuid, uuid) IS
  'Resolved stats per game for player profile game log (DESIGN_STAT_TRACKING_UI).';

-- Career / cross-season aggregates: one row per (season, team, stat).
CREATE OR REPLACE FUNCTION public.get_career_stats_resolved(p_player_id uuid)
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
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
    FROM public.games g
    JOIN public.teams t ON t.id = g.team_id
    JOIN public.seasons s ON s.id = t.season_id
    CROSS JOIN LATERAL public.get_game_stats_resolved(g.id) r
    WHERE r.player_id = p_player_id
      AND g.status = 'final'
  )
  SELECT
    gr.season_id,
    gr.season_name,
    gr.team_id,
    gr.team_name,
    gr.sport,
    gr.stat_id,
    COUNT(DISTINCT gr.game_id) AS games_played,
    SUM(gr.value)::bigint AS total,
    ROUND(AVG(gr.value), 1) AS per_game_avg,
    MAX(gr.value)::int AS season_high
  FROM game_resolved gr
  GROUP BY gr.season_id, gr.season_name, gr.team_id, gr.team_name, gr.sport, gr.stat_id
  ORDER BY gr.season_name, gr.team_name, gr.stat_id;
$$;

COMMENT ON FUNCTION public.get_career_stats_resolved(uuid) IS
  'Resolved career stats by season/team for a player (DESIGN_STAT_TRACKING_UI).';

-- Team-level resolved stat totals per finalized game (for team season summary).
CREATE OR REPLACE FUNCTION public.get_team_game_log(p_team_id uuid)
RETURNS TABLE (
  game_id uuid,
  game_date date,
  opponent_name text,
  opponent_score int,
  home_score_adjustment int,
  stat_id text,
  team_total bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    g.id AS game_id,
    g.game_date,
    g.opponent_name,
    g.opponent_score,
    COALESCE(g.home_score_adjustment, 0)::int AS home_score_adjustment,
    r.stat_id,
    SUM(r.value)::bigint AS team_total
  FROM public.games g
  CROSS JOIN LATERAL public.get_game_stats_resolved(g.id) r
  WHERE g.team_id = p_team_id
    AND g.status = 'final'
  GROUP BY g.id, g.game_date, g.opponent_name, g.opponent_score, g.home_score_adjustment, r.stat_id
  ORDER BY g.game_date DESC, r.stat_id;
$$;

COMMENT ON FUNCTION public.get_team_game_log(uuid) IS
  'Per-game team stat totals from resolved stats (DESIGN_STAT_TRACKING_UI).';
