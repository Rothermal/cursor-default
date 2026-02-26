-- Hotfix for team_members RLS recursion.
-- Older policy definitions queried team_members from within team_members
-- policies, which causes infinite recursion.

drop policy if exists "team_members_select" on public.team_members;
drop policy if exists "team_members_insert_admin" on public.team_members;
drop policy if exists "team_members_delete_admin" on public.team_members;

create policy "team_members_select" on public.team_members
  for select using (
    user_id = auth.uid()
    or team_id in (select id from public.teams where owner_id = auth.uid())
  );

create policy "team_members_insert_admin" on public.team_members
  for insert with check (
    team_id in (select id from public.teams where owner_id = auth.uid())
  );

create policy "team_members_delete_admin" on public.team_members
  for delete using (
    user_id = auth.uid()
    or team_id in (select id from public.teams where owner_id = auth.uid())
  );
