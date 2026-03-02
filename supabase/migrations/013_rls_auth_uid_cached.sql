-- RLS performance: use (select auth.uid()) so the result is cached per statement
-- instead of re-evaluated per row. See Supabase docs:
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

-- 1. Helper used by team_members policies
create or replace function public.is_team_owner(p_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.teams t
    where t.id = p_team_id and t.owner_id = (select auth.uid())
  );
$$;

-- 2. Profiles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (
    id = (select auth.uid())
    or id in (
      select tm2.user_id from public.team_members tm1
      join public.team_members tm2 on tm2.team_id = tm1.team_id
      where tm1.user_id = (select auth.uid())
    )
  );

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (id = (select auth.uid()));

-- 3. Teams
drop policy if exists "teams_select_member" on public.teams;
create policy "teams_select_member" on public.teams
  for select using (
    owner_id = (select auth.uid())
    or id in (select team_id from public.team_members where user_id = (select auth.uid()))
  );

drop policy if exists "teams_insert_own" on public.teams;
create policy "teams_insert_own" on public.teams
  for insert with check (owner_id = (select auth.uid()));

drop policy if exists "teams_update_admin" on public.teams;
create policy "teams_update_admin" on public.teams
  for update using (
    owner_id = (select auth.uid())
    or id in (select team_id from public.team_members
              where user_id = (select auth.uid()) and role in ('owner', 'admin'))
  );

drop policy if exists "teams_delete_owner" on public.teams;
create policy "teams_delete_owner" on public.teams
  for delete using (owner_id = (select auth.uid()));

-- 4. Team members
drop policy if exists "team_members_select" on public.team_members;
create policy "team_members_select" on public.team_members
  for select using (
    user_id = (select auth.uid())
    or public.is_team_owner(team_id)
  );

drop policy if exists "team_members_insert_self" on public.team_members;
create policy "team_members_insert_self" on public.team_members
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "team_members_update_accept" on public.team_members;
create policy "team_members_update_accept" on public.team_members
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "team_members_delete" on public.team_members;
create policy "team_members_delete" on public.team_members
  for delete using (
    user_id = (select auth.uid())
    or public.is_team_owner(team_id)
  );

-- 5. Players
drop policy if exists "players_select_member" on public.players;
create policy "players_select_member" on public.players
  for select using (
    team_id in (select team_id from public.team_members where user_id = (select auth.uid()))
  );

drop policy if exists "players_insert_admin" on public.players;
create policy "players_insert_admin" on public.players
  for insert with check (
    team_id in (select team_id from public.team_members
                where user_id = (select auth.uid()) and role in ('owner', 'admin'))
  );

drop policy if exists "players_update_admin" on public.players;
create policy "players_update_admin" on public.players
  for update using (
    team_id in (select team_id from public.team_members
                where user_id = (select auth.uid()) and role in ('owner', 'admin'))
  );

drop policy if exists "players_delete_admin" on public.players;
create policy "players_delete_admin" on public.players
  for delete using (
    team_id in (select team_id from public.team_members
                where user_id = (select auth.uid()) and role in ('owner', 'admin'))
  );

-- 6. Games
drop policy if exists "games_select_member" on public.games;
create policy "games_select_member" on public.games
  for select using (
    team_id in (select team_id from public.team_members where user_id = (select auth.uid()))
  );

drop policy if exists "games_insert_member" on public.games;
create policy "games_insert_member" on public.games
  for insert with check (
    team_id in (select team_id from public.team_members where user_id = (select auth.uid()))
    and created_by = (select auth.uid())
  );

drop policy if exists "games_update_member" on public.games;
create policy "games_update_member" on public.games
  for update using (
    team_id in (select team_id from public.team_members where user_id = (select auth.uid()))
  );

drop policy if exists "games_delete_admin" on public.games;
create policy "games_delete_admin" on public.games
  for delete using (
    team_id in (select team_id from public.team_members
                where user_id = (select auth.uid()) and role in ('owner', 'admin'))
  );

-- 7. Game stats
drop policy if exists "stats_select_member" on public.game_stats;
create policy "stats_select_member" on public.game_stats
  for select using (
    game_id in (select id from public.games where team_id in (
      select team_id from public.team_members where user_id = (select auth.uid())
    ))
  );

drop policy if exists "stats_insert_own" on public.game_stats;
create policy "stats_insert_own" on public.game_stats
  for insert with check (recorded_by = (select auth.uid()));

drop policy if exists "stats_update_own" on public.game_stats;
create policy "stats_update_own" on public.game_stats
  for update using (recorded_by = (select auth.uid()));

-- 8. Player checkouts
drop policy if exists "checkouts_select_member" on public.player_checkouts;
create policy "checkouts_select_member" on public.player_checkouts
  for select using (
    game_id in (
      select g.id from public.games g
      where g.team_id in (
        select tm.team_id from public.team_members tm where tm.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "checkouts_insert_own" on public.player_checkouts;
create policy "checkouts_insert_own" on public.player_checkouts
  for insert with check (user_id = (select auth.uid()));

drop policy if exists "checkouts_update_own" on public.player_checkouts;
create policy "checkouts_update_own" on public.player_checkouts
  for update using (user_id = (select auth.uid()));

drop policy if exists "checkouts_delete_own" on public.player_checkouts;
create policy "checkouts_delete_own" on public.player_checkouts
  for delete using (user_id = (select auth.uid()));

-- 9. Stat corrections
drop policy if exists "corrections_select_member" on public.stat_corrections;
create policy "corrections_select_member" on public.stat_corrections
  for select using (
    game_id in (
      select g.id from public.games g
      where g.team_id in (
        select tm.team_id from public.team_members tm where tm.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "corrections_insert_admin" on public.stat_corrections;
create policy "corrections_insert_admin" on public.stat_corrections
  for insert with check (
    corrected_by = (select auth.uid())
    and exists (
      select 1 from public.games g
      join public.team_members tm on tm.team_id = g.team_id
      where g.id = game_id
        and tm.user_id = (select auth.uid())
        and tm.role in ('owner', 'admin')
    )
  );

drop policy if exists "corrections_update_admin" on public.stat_corrections;
create policy "corrections_update_admin" on public.stat_corrections
  for update using (
    exists (
      select 1 from public.games g
      join public.team_members tm on tm.team_id = g.team_id
      where g.id = game_id
        and tm.user_id = (select auth.uid())
        and tm.role in ('owner', 'admin')
    )
  );

drop policy if exists "corrections_delete_admin" on public.stat_corrections;
create policy "corrections_delete_admin" on public.stat_corrections
  for delete using (
    exists (
      select 1 from public.games g
      join public.team_members tm on tm.team_id = g.team_id
      where g.id = game_id
        and tm.user_id = (select auth.uid())
        and tm.role in ('owner', 'admin')
    )
  );
