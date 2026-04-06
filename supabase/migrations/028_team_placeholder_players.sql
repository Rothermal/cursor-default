-- Team stat placeholder rows on public.players (see DESIGN_TEAM_STATS_DATA_MODEL).
-- Excluded from season/career/leaderboard aggregates (via RPCs below).
-- get_game_stats_resolved is unchanged so per-game views can still include team rows;
-- use get_game_team_stats or client filters when adding a dedicated Team Stats summary.

alter table public.players
  add column if not exists is_team_placeholder boolean not null default false;

comment on column public.players.is_team_placeholder is
  'True for synthetic players used only for per-game team-level stats (fouls, timeouts). Excluded from roster aggregates and merge.';

create index if not exists idx_players_team_placeholder
  on public.players (is_team_placeholder)
  where is_team_placeholder = true;

-- Season leaderboard: exclude team placeholders (still uses get_game_stats_resolved per game).
create or replace function public.get_season_stats_resolved(p_team_id uuid)
returns table (
  player_id uuid,
  stat_id text,
  games_played bigint,
  total bigint,
  per_game_avg numeric,
  season_high int
)
language sql
stable
security invoker
set search_path = public
as $$
  with game_resolved as (
    select g.id as game_id, r.player_id, r.stat_id, r.value
    from public.games g
    cross join lateral public.get_game_stats_resolved(g.id) r
    join public.players pl on pl.id = r.player_id
    where g.team_id = p_team_id
      and g.status = 'final'
      and not pl.is_team_placeholder
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
$$;

-- Tournament aggregates: same exclusion.
create or replace function public.get_tournament_stats_resolved(p_tournament_id uuid)
returns table (
  player_id uuid,
  stat_id text,
  games_played bigint,
  total bigint,
  per_game_avg numeric,
  tournament_high int
)
language sql
stable
security invoker
set search_path = public
as $$
  with game_resolved as (
    select g.id as game_id, r.player_id, r.stat_id, r.value
    from public.games g
    cross join lateral public.get_game_stats_resolved(g.id) r
    join public.players pl on pl.id = r.player_id
    where g.tournament_id = p_tournament_id
      and g.status = 'final'
      and not pl.is_team_placeholder
  )
  select
    gr.player_id,
    gr.stat_id,
    count(distinct gr.game_id) as games_played,
    sum(gr.value)::bigint as total,
    round(avg(gr.value), 1) as per_game_avg,
    max(gr.value)::int as tournament_high
  from game_resolved gr
  group by gr.player_id, gr.stat_id;
$$;

-- Career RPC: exclude placeholders.
create or replace function public.get_career_stats_resolved(p_player_id uuid)
returns table (
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
language sql
stable
security invoker
set search_path = public
as $$
  with game_resolved as (
    select
      s.id as season_id,
      s.name as season_name,
      t.id as team_id,
      t.name as team_name,
      s.sport,
      g.id as game_id,
      r.stat_id,
      r.value
    from public.games g
    join public.teams t on t.id = g.team_id
    join public.seasons s on s.id = t.season_id
    cross join lateral public.get_game_stats_resolved(g.id) r
    join public.players pl on pl.id = r.player_id
    where r.player_id = p_player_id
      and g.status = 'final'
      and not pl.is_team_placeholder
  )
  select
    gr.season_id,
    gr.season_name,
    gr.team_id,
    gr.team_name,
    gr.sport,
    gr.stat_id,
    count(distinct gr.game_id) as games_played,
    sum(gr.value)::bigint as total,
    round(avg(gr.value), 1) as per_game_avg,
    max(gr.value)::int as season_high
  from game_resolved gr
  group by gr.season_id, gr.season_name, gr.team_id, gr.team_name, gr.sport, gr.stat_id
  order by gr.season_name, gr.team_name, gr.stat_id;
$$;

-- Player game log: real roster player only (same player_id param).
create or replace function public.get_player_game_log(
  p_player_id uuid,
  p_team_id uuid
)
returns table (
  game_id uuid,
  game_date date,
  opponent_name text,
  stat_id text,
  value int
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
    r.stat_id,
    r.value
  from public.games g
  cross join lateral public.get_game_stats_resolved(g.id) r
  join public.players pl on pl.id = r.player_id
  where g.team_id = p_team_id
    and g.status = 'final'
    and r.player_id = p_player_id
    and not pl.is_team_placeholder
  order by g.game_date desc, r.stat_id;
$$;

-- Team season summary rows: per-stat totals exclude placeholder players (individual roster stats only).
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
  join public.players pl on pl.id = r.player_id
  where g.team_id = p_team_id
    and g.status = 'final'
    and not pl.is_team_placeholder
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
  'Per-game roster stat totals (excludes is_team_placeholder); includes home_team_score.';

-- Best-game helpers: never attribute placeholder rows to a real player_id query.
create or replace function public.get_player_stat_high_games(p_player_id uuid)
returns table (stat_id text, game_id uuid, value int)
language sql
stable
security invoker
set search_path = public
as $$
  with resolved as (
    select g.id as game_id, r.stat_id, r.value::int as value
    from public.games g
    cross join lateral public.get_game_stats_resolved(g.id) r
    join public.players pl on pl.id = r.player_id
    where g.status = 'final'
      and r.player_id = p_player_id
      and not pl.is_team_placeholder
  ),
  ranked as (
    select
      game_id,
      stat_id,
      value,
      row_number() over (partition by stat_id order by value desc, game_id asc) as rn
    from resolved
  )
  select ranked.stat_id, ranked.game_id, ranked.value
  from ranked
  where ranked.rn = 1;
$$;

create or replace function public.get_player_stat_high_games_for_team(p_player_id uuid, p_team_id uuid)
returns table (stat_id text, game_id uuid, value int)
language sql
stable
security invoker
set search_path = public
as $$
  with resolved as (
    select g.id as game_id, r.stat_id, r.value::int as value
    from public.games g
    cross join lateral public.get_game_stats_resolved(g.id) r
    join public.players pl on pl.id = r.player_id
    where g.status = 'final'
      and g.team_id = p_team_id
      and r.player_id = p_player_id
      and not pl.is_team_placeholder
  ),
  ranked as (
    select
      game_id,
      stat_id,
      value,
      row_number() over (partition by stat_id order by value desc, game_id asc) as rn
    from resolved
  )
  select ranked.stat_id, ranked.game_id, ranked.value
  from ranked
  where ranked.rn = 1;
$$;
