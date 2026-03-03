-- Fix infinite recursion: team_members policies referenced public.teams,
-- and teams policies reference public.team_members. Use a SECURITY DEFINER
-- helper that reads only teams so the policy evaluation doesn't recurse.

create or replace function public.is_team_owner(p_team_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.teams t
    where t.id = p_team_id and t.owner_id = auth.uid()
  );
$$;

-- Recreate team_members SELECT and DELETE to use the helper instead of
-- inline (select id from public.teams ...), which caused recursion.

drop policy if exists "team_members_select" on public.team_members;
create policy "team_members_select" on public.team_members
  for select using (
    user_id = auth.uid()
    or public.is_team_owner(team_id)
  );

drop policy if exists "team_members_delete" on public.team_members;
create policy "team_members_delete" on public.team_members
  for delete using (
    user_id = auth.uid()
    or public.is_team_owner(team_id)
  );
