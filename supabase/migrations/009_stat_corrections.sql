-- Admin stat corrections: override official value per (game, player, stat). Audit trail; never overwrites game_stats.

create table if not exists public.stat_corrections (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  stat_id text not null,
  corrected_value int not null,
  original_primary_value int,
  corrected_by uuid not null references public.profiles(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),

  unique(game_id, player_id, stat_id)
);

create index if not exists idx_corrections_game on public.stat_corrections(game_id);

alter table public.stat_corrections enable row level security;

-- Team members can read corrections for their team's games
create policy "corrections_select_member" on public.stat_corrections
  for select using (
    game_id in (
      select g.id from public.games g
      where g.team_id in (
        select tm.team_id from public.team_members tm where tm.user_id = auth.uid()
      )
    )
  );

-- Only team owner/admin can insert corrections
create policy "corrections_insert_admin" on public.stat_corrections
  for insert with check (
    corrected_by = auth.uid()
    and exists (
      select 1 from public.games g
      join public.team_members tm on tm.team_id = g.team_id
      where g.id = game_id
        and tm.user_id = auth.uid()
        and tm.role in ('owner', 'admin')
    )
  );

-- Only team owner/admin can update corrections
create policy "corrections_update_admin" on public.stat_corrections
  for update using (
    exists (
      select 1 from public.games g
      join public.team_members tm on tm.team_id = g.team_id
      where g.id = game_id
        and tm.user_id = auth.uid()
        and tm.role in ('owner', 'admin')
    )
  );

-- Only team owner/admin can delete corrections
create policy "corrections_delete_admin" on public.stat_corrections
  for delete using (
    exists (
      select 1 from public.games g
      join public.team_members tm on tm.team_id = g.team_id
      where g.id = game_id
        and tm.user_id = auth.uid()
        and tm.role in ('owner', 'admin')
    )
  );
