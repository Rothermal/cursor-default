-- WU-6: Team stats schema — game placeholder FKs, season JSON config, RPC helpers.
-- is_team_placeholder + related RPC filters live in 028.

-- --------------------------------------------------------------------------
-- 1. games: link to cloud team placeholder player rows (WU-10 sets these)
-- --------------------------------------------------------------------------
alter table public.games
  add column if not exists home_team_player_id uuid references public.players(id) on delete set null,
  add column if not exists opp_team_player_id uuid references public.players(id) on delete set null;

comment on column public.games.home_team_player_id is
  'Cloud players.id for home team stat pseudo-player; local __team_home__ maps here.';

comment on column public.games.opp_team_player_id is
  'Cloud players.id for opponent team stat pseudo-player; local __team_opp__ maps here.';

create index if not exists idx_games_home_team_player on public.games (home_team_player_id)
  where home_team_player_id is not null;

create index if not exists idx_games_opp_team_player on public.games (opp_team_player_id)
  where opp_team_player_id is not null;

-- --------------------------------------------------------------------------
-- 2. seasons: team stat rules JSON (bonus, periods, timeouts — see season config doc)
-- --------------------------------------------------------------------------
alter table public.seasons
  add column if not exists team_stats_config jsonb not null default '{}'::jsonb;

comment on column public.seasons.team_stats_config is
  'Basketball team-stat rules (periods, bonus thresholds, timeouts per period, etc.).';

-- --------------------------------------------------------------------------
-- 3. Admin browse: players_display includes placeholder flag
-- --------------------------------------------------------------------------
drop view if exists public.players_display;
create view public.players_display with (security_invoker = true) as
select
  pl.id,
  pl.first_name,
  pl.last_name,
  pl.first_name || ' ' || coalesce(pl.last_name, '') as full_name,
  pl.nickname,
  pl.is_team_placeholder,
  pl.created_by,
  p.display_name as created_by_name,
  pl.created_at
from public.players pl
left join public.profiles p on p.id = pl.created_by;

-- --------------------------------------------------------------------------
-- 4. games_display: team player FKs + home_team_score (027) for browsing
-- --------------------------------------------------------------------------
drop view if exists public.games_display;
create view public.games_display with (security_invoker = true) as
select
  g.id,
  g.team_id,
  t.name as team_name,
  g.season_id,
  s.name as season_name,
  g.opponent_name,
  g.opponent_score,
  g.home_team_score,
  g.tournament_id,
  tour.name as tournament_name,
  g.game_date,
  g.status,
  g.created_by,
  p.display_name as created_by_name,
  g.home_score_adjustment,
  g.home_team_player_id,
  g.opp_team_player_id,
  g.notes,
  g.created_at
from public.games g
left join public.teams t on t.id = g.team_id
left join public.seasons s on s.id = g.season_id
left join public.tournaments tour on tour.id = g.tournament_id
left join public.profiles p on p.id = g.created_by;

-- --------------------------------------------------------------------------
-- 5. get_game_stats_resolved: optional is_team_placeholder for callers (DESIGN_TEAM_STATS_DATA_MODEL §4.1)
-- --------------------------------------------------------------------------
create or replace function public.get_game_stats_resolved(p_game_id uuid)
returns table (
  player_id uuid,
  stat_id text,
  value int,
  source text,
  recorded_by uuid,
  recorder_count int,
  is_team_placeholder boolean
)
language sql
stable
security invoker
set search_path = public
as $$
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
    r.player_id,
    r.stat_id,
    r.value,
    r.source,
    r.recorded_by,
    (select count(distinct gs.recorded_by)
     from public.game_stats gs
     where gs.game_id = p_game_id
       and gs.player_id = r.player_id
       and gs.stat_id = r.stat_id
    )::int as recorder_count,
    coalesce(pl.is_team_placeholder, false) as is_team_placeholder
  from resolved r
  left join public.players pl on pl.id = r.player_id
  order by r.player_id, r.stat_id;
$$;

comment on function public.get_game_stats_resolved(uuid) is
  'Resolved stats per (player, stat); includes is_team_placeholder for team stat rows (migration 030).';

-- --------------------------------------------------------------------------
-- 6. get_game_team_stats: only home/opp placeholder players for a game (WU-12)
-- --------------------------------------------------------------------------
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
