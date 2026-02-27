-- Ensure teams insert/update policies are present and non-recursive.
-- This is a follow-up for environments where earlier migrations were only
-- partially applied and team creation is blocked by RLS.

alter table public.teams enable row level security;

drop policy if exists "teams_select_member" on public.teams;
drop policy if exists "teams_insert_own" on public.teams;
drop policy if exists "teams_update_admin" on public.teams;
drop policy if exists "teams_delete_owner" on public.teams;

create policy "teams_select_member" on public.teams
  for select using (
    owner_id = auth.uid()
    or id in (select team_id from public.team_members where user_id = auth.uid())
  );

create policy "teams_insert_own" on public.teams
  for insert with check (owner_id = auth.uid());

create policy "teams_update_admin" on public.teams
  for update using (
    owner_id = auth.uid()
    or id in (select team_id from public.team_members
              where user_id = auth.uid() and role in ('owner', 'admin'))
  );

create policy "teams_delete_owner" on public.teams
  for delete using (owner_id = auth.uid());
