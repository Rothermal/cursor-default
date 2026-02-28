-- Resolved stats RPCs: single source of truth for game and season totals (Phase 3).
-- Priority: correction > primary checkout > sole recorder > averaged.

create or replace function public.get_game_stats_resolved(p_game_id uuid)
returns table (
  player_id uuid,
  stat_id text,
  value int,
  source text,
  recorded_by uuid,
  recorder_count int
) as $$
  with corrections as (
    select sc.player_id, sc.stat_id, sc.corrected_value as value,
           sc.corrected_by as recorded_by, 'correction'::text as source
    from public.stat_corrections sc
    where sc.game_id = p_game_id
  ),
  primary_stats as (
    select gs.player_id, gs.stat_id, gs.value,
           gs.recorded_by, 'primary'::text as source
    from public.game_stats gs
    join public.player_checkouts pc
      on pc.game_id = gs.game_id
      and pc.player_id = gs.player_id
      and pc.user_id = gs.recorded_by
      and pc.is_primary = true
    where gs.game_id = p_game_id
  ),
  sole_stats as (
    select gs.player_id, gs.stat_id, gs.value,
           gs.recorded_by, 'sole'::text as source
    from public.game_stats gs
    where gs.game_id = p_game_id
    and not exists (
      select 1 from public.game_stats gs2
      where gs2.game_id = gs.game_id
        and gs2.player_id = gs.player_id
        and gs2.stat_id = gs.stat_id
        and gs2.recorded_by <> gs.recorded_by
    )
  ),
  averaged_stats as (
    select gs.player_id, gs.stat_id,
           round(avg(gs.value))::int as value,
           null::uuid as recorded_by, 'averaged'::text as source
    from public.game_stats gs
    where gs.game_id = p_game_id
    group by gs.player_id, gs.stat_id
    having count(distinct gs.recorded_by) > 1
  ),
  resolved as (
    select distinct on (player_id, stat_id)
      player_id, stat_id, value, source, recorded_by
    from (
      select *, 1 as priority from corrections
      union all
      select *, 2 as priority from primary_stats
      union all
      select *, 3 as priority from sole_stats
      union all
      select *, 4 as priority from averaged_stats
    ) all_sources
    order by player_id, stat_id, priority
  )
  select
    r.player_id, r.stat_id, r.value, r.source, r.recorded_by,
    (select count(distinct gs.recorded_by)
     from public.game_stats gs
     where gs.game_id = p_game_id
       and gs.player_id = r.player_id
       and gs.stat_id = r.stat_id
    )::int as recorder_count
  from resolved r
  order by r.player_id, r.stat_id;
$$ language sql stable security invoker;

-- Season aggregates over finalized games using same resolution chain
create or replace function public.get_season_stats_resolved(p_team_id uuid)
returns table (
  player_id uuid,
  stat_id text,
  games_played bigint,
  total bigint,
  per_game_avg numeric,
  season_high int
) as $$
  with game_resolved as (
    select g.id as game_id, r.player_id, r.stat_id, r.value
    from public.games g,
    lateral public.get_game_stats_resolved(g.id) r
    where g.team_id = p_team_id
      and g.status = 'final'
  )
  select
    player_id,
    stat_id,
    count(distinct game_id) as games_played,
    sum(value) as total,
    round(avg(value), 1) as per_game_avg,
    max(value)::int as season_high
  from game_resolved
  group by player_id, stat_id;
$$ language sql stable security invoker;
