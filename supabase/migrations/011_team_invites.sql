-- Team invite system: allow owners to invite by email, members to accept.
-- Uses teams.owner_id for policies to avoid team_members RLS recursion.

-- 1. Add email to profiles (for lookup during invite)
alter table public.profiles add column if not exists email text;

-- Sync email from auth on profile create
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.email),
    new.email
  );
  return new;
end;
$$ language plpgsql security definer;

-- Backfill email for existing profiles
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and (p.email is null or p.email = '');

-- 2. RPC: lookup user by email (owner/admin only, for invite flow)
create or replace function public.lookup_user_by_email(p_team_id uuid, p_email text)
returns table (id uuid, display_name text)
language sql security definer
set search_path = public
as $$
  select u.id, coalesce(p.display_name, u.email)::text
  from auth.users u
  left join public.profiles p on p.id = u.id
  where lower(trim(u.email)) = lower(trim(p_email))
  and (
    exists (select 1 from public.teams t where t.id = p_team_id and t.owner_id = auth.uid())
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = p_team_id and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
    )
  )
  limit 1;
$$;

-- 3. RPC: invite team member by email (owner/admin only; bypasses RLS for insert)
create or replace function public.invite_team_member(p_team_id uuid, p_user_id uuid, p_role text default 'scorer')
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_role text := coalesce(nullif(trim(p_role), ''), 'scorer');
begin
  if v_role not in ('scorer', 'admin') then
    v_role := 'scorer';
  end if;
  if not (
    exists (select 1 from public.teams t where t.id = p_team_id and t.owner_id = auth.uid())
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = p_team_id and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
    )
  ) then
    raise exception 'Not authorized to invite to this team';
  end if;
  insert into public.team_members (team_id, user_id, role, accepted_at)
  values (p_team_id, p_user_id, v_role, null)
  on conflict (team_id, user_id) do update set role = excluded.role, accepted_at = null;
end;
$$;

-- 4. RPC: get team members with display names (for owner/admin; bypasses RLS for profiles)
create or replace function public.get_team_members_with_profiles(p_team_id uuid)
returns table (
  id uuid,
  team_id uuid,
  user_id uuid,
  role text,
  accepted_at timestamptz,
  display_name text,
  email text
)
language sql security definer
set search_path = public
as $$
  select tm.id, tm.team_id, tm.user_id, tm.role, tm.accepted_at,
         coalesce(p.display_name, u.email)::text,
         u.email
  from public.team_members tm
  left join public.profiles p on p.id = tm.user_id
  left join auth.users u on u.id = tm.user_id
  where tm.team_id = p_team_id
  and (
    exists (select 1 from public.teams t where t.id = p_team_id and t.owner_id = auth.uid())
    or exists (
      select 1 from public.team_members tm2
      where tm2.team_id = p_team_id and tm2.user_id = auth.uid()
      and tm2.role in ('owner', 'admin')
    )
  );
$$;

-- 5. Team members: allow owner to see all members, remove members
--    Allow members to accept (update accepted_at) and remove themselves

drop policy if exists "team_members_select" on public.team_members;
drop policy if exists "team_members_insert_admin" on public.team_members;
drop policy if exists "team_members_delete_admin" on public.team_members;

-- Select: own rows OR owner of team (see all members)
create policy "team_members_select" on public.team_members
  for select using (
    user_id = auth.uid()
    or team_id in (select id from public.teams where owner_id = auth.uid())
  );

-- Insert: only via invite_team_member RPC (service role / definer); no direct client insert for invites
-- Keep policy for backwards compat: user can add self (e.g. future "request to join")
create policy "team_members_insert_self" on public.team_members
  for insert with check (user_id = auth.uid());

-- Update: only own row (for accepting invite)
create policy "team_members_update_accept" on public.team_members
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Delete: own row OR owner of team (remove member)
create policy "team_members_delete" on public.team_members
  for delete using (
    user_id = auth.uid()
    or team_id in (select id from public.teams where owner_id = auth.uid())
  );

-- 6. Profiles: allow reading own profile + profiles of team mates (for member list display)
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (
    id = auth.uid()
    or id in (
      select tm2.user_id from public.team_members tm1
      join public.team_members tm2 on tm2.team_id = tm1.team_id
      where tm1.user_id = auth.uid()
    )
  );
