-- Shot chart: location-tagged attempts per game (per recorder). Replaced wholesale on sync.

create table if not exists public.shot_chart (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  recorded_by uuid not null references public.profiles (id),
  client_shot_id text not null,
  x numeric not null,
  y numeric not null,
  made boolean not null,
  shot_type text not null check (shot_type in ('2pt', '3pt')),
  zone text not null check (zone in ('restricted', 'paint', 'mid_range', 'three')),
  created_at timestamptz not null default now(),
  unique (game_id, recorded_by, client_shot_id)
);

create index if not exists idx_shot_chart_game on public.shot_chart (game_id);
create index if not exists idx_shot_chart_game_player on public.shot_chart (game_id, player_id);
create index if not exists idx_shot_chart_recorded_by on public.shot_chart (recorded_by);

alter table public.shot_chart enable row level security;

create policy "shot_chart_select_member" on public.shot_chart
  for select using (
    game_id in (
      select id from public.games
      where team_id in (
        select team_id from public.team_members where user_id = auth.uid()
      )
    )
  );

create policy "shot_chart_insert_own" on public.shot_chart
  for insert with check (recorded_by = auth.uid());

create policy "shot_chart_update_own" on public.shot_chart
  for update using (recorded_by = auth.uid());

create policy "shot_chart_delete_own" on public.shot_chart
  for delete using (recorded_by = auth.uid());
