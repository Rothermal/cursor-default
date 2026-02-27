-- Games table
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  se_event_id text,
  opponent_name text not null,
  opponent_score int not null default 0,
  tournament_name text,
  game_date date not null default current_date,
  game_time timestamptz,
  location text,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'final')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.games enable row level security;

create policy "games_select_member" on public.games
  for select using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  );

create policy "games_insert_member" on public.games
  for insert with check (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
    and created_by = auth.uid()
  );

create policy "games_update_member" on public.games
  for update using (
    team_id in (select team_id from public.team_members where user_id = auth.uid())
  );

create policy "games_delete_admin" on public.games
  for delete using (
    team_id in (select team_id from public.team_members
                where user_id = auth.uid() and role in ('owner', 'admin'))
  );

-- Game stats table
create table if not exists public.game_stats (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  recorded_by uuid not null references public.profiles(id),
  stat_id text not null,
  value int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(game_id, player_id, recorded_by, stat_id)
);

alter table public.game_stats enable row level security;

create policy "stats_select_member" on public.game_stats
  for select using (
    game_id in (select id from public.games where team_id in (
      select team_id from public.team_members where user_id = auth.uid()
    ))
  );

create policy "stats_insert_own" on public.game_stats
  for insert with check (recorded_by = auth.uid());

create policy "stats_update_own" on public.game_stats
  for update using (recorded_by = auth.uid());

-- Indexes
create index if not exists idx_games_team_date on public.games(team_id, game_date);
create index if not exists idx_games_status on public.games(status);
create index if not exists idx_game_stats_game on public.game_stats(game_id);
create index if not exists idx_game_stats_player on public.game_stats(player_id);
create index if not exists idx_game_stats_recorder on public.game_stats(recorded_by);
create index if not exists idx_game_stats_lookup on public.game_stats(game_id, player_id, recorded_by);
