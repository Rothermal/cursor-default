-- Tournament-scoped resolved stats (Phase 6 continuation).
-- See docs/DESIGN_STAT_TRACKING_UI.md §3.5

CREATE OR REPLACE FUNCTION public.get_tournament_stats_resolved(p_tournament_id uuid)
RETURNS TABLE (
  player_id uuid,
  stat_id text,
  games_played bigint,
  total bigint,
  per_game_avg numeric,
  tournament_high int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH game_resolved AS (
    SELECT g.id AS game_id, r.player_id, r.stat_id, r.value
    FROM public.games g
    CROSS JOIN LATERAL public.get_game_stats_resolved(g.id) r
    WHERE g.tournament_id = p_tournament_id
      AND g.status = 'final'
  )
  SELECT
    gr.player_id,
    gr.stat_id,
    COUNT(DISTINCT gr.game_id) AS games_played,
    SUM(gr.value)::bigint AS total,
    ROUND(AVG(gr.value), 1) AS per_game_avg,
    MAX(gr.value)::int AS tournament_high
  FROM game_resolved gr
  GROUP BY gr.player_id, gr.stat_id;
$$;

COMMENT ON FUNCTION public.get_tournament_stats_resolved(uuid) IS
  'Per-player resolved stats across finalized games in a tournament (DESIGN_STAT_TRACKING_UI).';
