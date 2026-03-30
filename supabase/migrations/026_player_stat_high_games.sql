-- Best single-game value per stat for a player (resolved stats, finalized games only).
-- Used by Career and Player Profile "Best game" links.

CREATE OR REPLACE FUNCTION public.get_player_stat_high_games(p_player_id uuid)
RETURNS TABLE (stat_id text, game_id uuid, value int)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH resolved AS (
    SELECT g.id AS game_id, r.stat_id, r.value::int AS value
    FROM public.games g
    CROSS JOIN LATERAL public.get_game_stats_resolved(g.id) r
    WHERE g.status = 'final'
      AND r.player_id = p_player_id
  ),
  ranked AS (
    SELECT
      game_id,
      stat_id,
      value,
      ROW_NUMBER() OVER (PARTITION BY stat_id ORDER BY value DESC, game_id ASC) AS rn
    FROM resolved
  )
  SELECT ranked.stat_id, ranked.game_id, ranked.value
  FROM ranked
  WHERE ranked.rn = 1;
$$;

COMMENT ON FUNCTION public.get_player_stat_high_games(uuid) IS
  'Per stat_id, the finalized game where the player had the highest resolved value (ties: lowest game_id).';

GRANT EXECUTE ON FUNCTION public.get_player_stat_high_games(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_player_stat_high_games_for_team(p_player_id uuid, p_team_id uuid)
RETURNS TABLE (stat_id text, game_id uuid, value int)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH resolved AS (
    SELECT g.id AS game_id, r.stat_id, r.value::int AS value
    FROM public.games g
    CROSS JOIN LATERAL public.get_game_stats_resolved(g.id) r
    WHERE g.status = 'final'
      AND g.team_id = p_team_id
      AND r.player_id = p_player_id
  ),
  ranked AS (
    SELECT
      game_id,
      stat_id,
      value,
      ROW_NUMBER() OVER (PARTITION BY stat_id ORDER BY value DESC, game_id ASC) AS rn
    FROM resolved
  )
  SELECT ranked.stat_id, ranked.game_id, ranked.value
  FROM ranked
  WHERE ranked.rn = 1;
$$;

COMMENT ON FUNCTION public.get_player_stat_high_games_for_team(uuid, uuid) IS
  'Same as get_player_stat_high_games but only games for p_team_id (season roster scope).';

GRANT EXECUTE ON FUNCTION public.get_player_stat_high_games_for_team(uuid, uuid) TO authenticated;
