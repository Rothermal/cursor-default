-- Player checkouts: which parent is the designated recorder per player per game (Phase 3 multi-parent).
-- Soft claim only; all parents can still submit stats. Checkout determines whose stats show as primary.

create table if not exists public.player_checkouts (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_primary boolean not null default true,
  checked_out_at timestamptz not null default now(),

  unique(game_id, player_id, user_id)
);

create index if not exists idx_checkouts_game on public.player_checkouts(game_id);
create index if not exists idx_checkouts_game_player on public.player_checkouts(game_id, player_id);

alter table public.player_checkouts enable row level security;

-- Team members can read checkouts for their team's games
create policy "checkouts_select_member" on public.player_checkouts
  for select using (
    game_id in (
      select g.id from public.games g
      where g.team_id in (
        select tm.team_id from public.team_members tm where tm.user_id = auth.uid()
      )
    )
  );

-- Users can create their own checkouts
create policy "checkouts_insert_own" on public.player_checkouts
  for insert with check (user_id = auth.uid());

-- Users can update their own checkouts (e.g. set is_primary = false)
create policy "checkouts_update_own" on public.player_checkouts
  for update using (user_id = auth.uid());

-- Users can delete their own checkouts
create policy "checkouts_delete_own" on public.player_checkouts
  for delete using (user_id = auth.uid());
