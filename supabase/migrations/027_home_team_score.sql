-- Standalone scoreboard home total: not derived from player scoring stats.
-- When null, clients use legacy: sum(scoring stats) + home_score_adjustment.

alter table public.games
  add column if not exists home_team_score int null;

comment on column public.games.home_team_score is
  'Manual home team score for the scoreboard. When null, displayed home score = sum of player scoring stats from game_stats + COALESCE(home_score_adjustment, 0).';

-- Team game log: expose home_team_score for W/L and summaries (DESIGN_STAT_TRACKING_UI).
drop function if exists public.get_team_game_log(uuid);

create function public.get_team_game_log(p_team_id uuid)
returns table (
  game_id uuid,
  game_date date,
  opponent_name text,
  opponent_score int,
  home_team_score int,
  home_score_adjustment int,
  stat_id text,
  team_total bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    g.id as game_id,
    g.game_date,
    g.opponent_name,
    g.opponent_score,
    g.home_team_score,
    coalesce(g.home_score_adjustment, 0)::int as home_score_adjustment,
    r.stat_id,
    sum(r.value)::bigint as team_total
  from public.games g
  cross join lateral public.get_game_stats_resolved(g.id) r
  where g.team_id = p_team_id
    and g.status = 'final'
  group by
    g.id,
    g.game_date,
    g.opponent_name,
    g.opponent_score,
    g.home_team_score,
    g.home_score_adjustment,
    r.stat_id
  order by g.game_date desc, r.stat_id;
$$;

comment on function public.get_team_game_log(uuid) is
  'Per-game team stat totals from resolved stats; includes home_team_score for scoreboard (migration 027).';
