-- Repair / follow-up for environments where 030 failed on get_game_stats_resolved return-type change.
-- Safe to run if get_game_team_stats already exists (CREATE OR REPLACE).

create or replace function public.get_game_team_stats(p_game_id uuid)
returns table (
  team_side text,
  player_id uuid,
  stat_id text,
  value int,
  source text,
  recorded_by uuid,
  recorder_count int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    case
      when g.home_team_player_id is not null and r.player_id = g.home_team_player_id then 'home'
      when g.opp_team_player_id is not null and r.player_id = g.opp_team_player_id then 'opponent'
      else 'unknown'
    end as team_side,
    r.player_id,
    r.stat_id,
    r.value,
    r.source,
    r.recorded_by,
    r.recorder_count
  from public.games g
  cross join lateral public.get_game_stats_resolved(g.id) r
  where g.id = p_game_id
    and (
      (g.home_team_player_id is not null and r.player_id = g.home_team_player_id)
      or (g.opp_team_player_id is not null and r.player_id = g.opp_team_player_id)
    )
  order by team_side, r.stat_id;
$$;

comment on function public.get_game_team_stats(uuid) is
  'Resolved team-level stats for home/opp placeholder players only (DESIGN_TEAM_STATS_DATA_MODEL).';

grant execute on function public.get_game_team_stats(uuid) to authenticated;
