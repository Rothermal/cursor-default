-- SEC-2: read-only viewer team role.
-- Target contract: docs/ACCESS_MATRIX.md

-- --------------------------------------------------------------------------
-- 1. Role and shared tracking authorization
-- --------------------------------------------------------------------------

alter table public.team_members
  drop constraint if exists team_members_role_check;

alter table public.team_members
  add constraint team_members_role_check
  check (role in ('owner', 'admin', 'scorer', 'viewer'));

create or replace function public.can_track_team_games(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_team_role(p_team_id) in ('owner', 'admin', 'scorer');
$$;

revoke all on function public.can_track_team_games(uuid) from public;
grant execute on function public.can_track_team_games(uuid) to authenticated;

-- --------------------------------------------------------------------------
-- 2. Viewer-aware invite and member operations
-- --------------------------------------------------------------------------

create or replace function public.accept_team_invite(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.team_members tm
  set accepted_at = now()
  where tm.team_id = p_team_id
    and tm.user_id = (select auth.uid())
    and tm.accepted_at is null
    and tm.role in ('admin', 'scorer', 'viewer');

  if not found then
    raise exception 'Pending team invite not found';
  end if;
end;
$$;

create or replace function public.decline_team_invite(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.team_members tm
  where tm.team_id = p_team_id
    and tm.user_id = (select auth.uid())
    and tm.accepted_at is null
    and tm.role in ('admin', 'scorer', 'viewer');

  if not found then
    raise exception 'Pending team invite not found';
  end if;
end;
$$;

create or replace function public.remove_team_member(
  p_team_id uuid,
  p_member_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text := public.current_team_role(p_team_id);
  v_target public.team_members%rowtype;
begin
  if v_actor_role not in ('owner', 'admin') then
    raise exception 'Not authorized to remove team members';
  end if;

  select tm.* into v_target
  from public.team_members tm
  where tm.id = p_member_id and tm.team_id = p_team_id
  for update;

  if not found then
    raise exception 'Team member not found';
  end if;
  if v_target.role = 'owner'
     or exists (
       select 1 from public.teams t
       where t.id = p_team_id and t.owner_id = v_target.user_id
     ) then
    raise exception 'Team owner cannot be removed';
  end if;
  if v_target.user_id = (select auth.uid()) then
    raise exception 'Use leave_team to remove your own membership';
  end if;
  if v_actor_role = 'admin' and v_target.role not in ('scorer', 'viewer') then
    raise exception 'Admins can remove scorers and viewers only';
  end if;

  delete from public.team_members where id = v_target.id;
end;
$$;

create or replace function public.set_team_member_role(
  p_team_id uuid,
  p_member_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text := public.current_team_role(p_team_id);
  v_target public.team_members%rowtype;
  v_role text := lower(trim(p_role));
begin
  if v_actor_role not in ('owner', 'admin') then
    raise exception 'Not authorized to change team roles';
  end if;
  if v_role not in ('admin', 'scorer', 'viewer') then
    raise exception 'Invalid team role';
  end if;

  select tm.* into v_target
  from public.team_members tm
  where tm.id = p_member_id and tm.team_id = p_team_id
  for update;

  if not found then
    raise exception 'Team member not found';
  end if;
  if v_target.role = 'owner'
     or exists (
       select 1 from public.teams t
       where t.id = p_team_id and t.owner_id = v_target.user_id
     ) then
    raise exception 'Team owner role cannot be changed';
  end if;
  if v_actor_role = 'admin'
     and (v_target.role not in ('scorer', 'viewer') or v_role not in ('scorer', 'viewer')) then
    raise exception 'Admins can change scorer and viewer roles only';
  end if;

  update public.team_members
  set role = v_role
  where id = v_target.id;
end;
$$;

create or replace function public.invite_team_member(
  p_team_id uuid,
  p_user_id uuid,
  p_role text default 'scorer'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text := public.current_team_role(p_team_id);
  v_role text := lower(coalesce(nullif(trim(p_role), ''), 'scorer'));
  v_existing public.team_members%rowtype;
begin
  if v_actor_role not in ('owner', 'admin') then
    raise exception 'Not authorized to invite to this team';
  end if;
  if v_role not in ('admin', 'scorer', 'viewer') then
    raise exception 'Invalid team role';
  end if;
  if v_actor_role = 'admin' and v_role not in ('scorer', 'viewer') then
    raise exception 'Admins can invite scorers and viewers only';
  end if;
  if exists (
    select 1 from public.teams t
    where t.id = p_team_id and t.owner_id = p_user_id
  ) then
    raise exception 'Team owner cannot be invited or changed';
  end if;

  select tm.* into v_existing
  from public.team_members tm
  where tm.team_id = p_team_id and tm.user_id = p_user_id
  for update;

  if found then
    if v_existing.role = 'owner' then
      raise exception 'Team owner cannot be invited or changed';
    end if;
    if v_existing.accepted_at is not null then
      raise exception 'User is already an accepted team member';
    end if;
    if v_actor_role = 'admin' and v_existing.role not in ('scorer', 'viewer') then
      raise exception 'Admins cannot change pending admin invites';
    end if;

    update public.team_members
    set role = v_role, invited_at = now(), accepted_at = null
    where id = v_existing.id;
    return;
  end if;

  insert into public.team_members (team_id, user_id, role, accepted_at)
  values (p_team_id, p_user_id, v_role, null);
end;
$$;

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
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.current_team_role(p_team_id);
begin
  if v_role is null then
    raise exception 'Not authorized to view team members';
  end if;

  return query
  select
    tm.id,
    tm.team_id,
    tm.user_id,
    tm.role,
    tm.accepted_at,
    case
      when nullif(trim(p.display_name), '') is not null then trim(p.display_name)
      when v_role in ('owner', 'admin') then u.email::text
      else 'Unnamed team member'::text
    end,
    case when v_role in ('owner', 'admin') then u.email::text else null end
  from public.team_members tm
  left join public.profiles p on p.id = tm.user_id
  left join auth.users u on u.id = tm.user_id
  where tm.team_id = p_team_id
  order by
    case tm.role
      when 'owner' then 0
      when 'admin' then 1
      when 'scorer' then 2
      when 'viewer' then 3
      else 4
    end,
    tm.invited_at;
end;
$$;

-- --------------------------------------------------------------------------
-- 3. Viewer reads remain accepted-member reads; tracking writes do not.
-- --------------------------------------------------------------------------

drop policy if exists "games_insert_member" on public.games;
create policy "games_insert_member" on public.games
  for insert with check (
    created_by = (select auth.uid())
    and status <> 'final'
    and public.can_track_team_games(team_id)
  );

drop policy if exists "games_update_member" on public.games;
create policy "games_update_member" on public.games
  for update using (
    status <> 'final'
    and public.can_track_team_games(team_id)
  )
  with check (public.can_track_team_games(team_id));

drop policy if exists "stats_insert_own" on public.game_stats;
create policy "stats_insert_own" on public.game_stats
  for insert with check (
    recorded_by = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.can_track_team_games(g.team_id)
        and (
          exists (
            select 1 from public.team_players tp
            where tp.team_id = g.team_id and tp.player_id = player_id
          )
          or player_id = g.home_team_player_id
          or player_id = g.opp_team_player_id
        )
    )
  );

drop policy if exists "stats_update_own" on public.game_stats;
create policy "stats_update_own" on public.game_stats
  for update using (
    recorded_by = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.can_track_team_games(g.team_id)
    )
  )
  with check (
    recorded_by = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.can_track_team_games(g.team_id)
        and (
          exists (
            select 1 from public.team_players tp
            where tp.team_id = g.team_id and tp.player_id = player_id
          )
          or player_id = g.home_team_player_id
          or player_id = g.opp_team_player_id
        )
    )
  );

drop policy if exists "checkouts_insert_own" on public.player_checkouts;
create policy "checkouts_insert_own" on public.player_checkouts
  for insert with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.can_track_team_games(g.team_id)
        and (
          exists (
            select 1 from public.team_players tp
            where tp.team_id = g.team_id and tp.player_id = player_id
          )
          or player_id = g.home_team_player_id
          or player_id = g.opp_team_player_id
        )
    )
  );

drop policy if exists "checkouts_update_own" on public.player_checkouts;
create policy "checkouts_update_own" on public.player_checkouts
  for update using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.can_track_team_games(g.team_id)
        and (
          exists (
            select 1 from public.team_players tp
            where tp.team_id = g.team_id and tp.player_id = player_id
          )
          or player_id = g.home_team_player_id
          or player_id = g.opp_team_player_id
        )
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.can_track_team_games(g.team_id)
        and (
          exists (
            select 1 from public.team_players tp
            where tp.team_id = g.team_id and tp.player_id = player_id
          )
          or player_id = g.home_team_player_id
          or player_id = g.opp_team_player_id
        )
    )
  );

drop policy if exists "checkouts_delete_own" on public.player_checkouts;
create policy "checkouts_delete_own" on public.player_checkouts
  for delete using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.can_track_team_games(g.team_id)
    )
  );

drop policy if exists "shot_chart_insert_own" on public.shot_chart;
create policy "shot_chart_insert_own" on public.shot_chart
  for insert with check (
    recorded_by = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.can_track_team_games(g.team_id)
        and (
          exists (
            select 1 from public.team_players tp
            where tp.team_id = g.team_id and tp.player_id = player_id
          )
          or player_id = g.home_team_player_id
          or player_id = g.opp_team_player_id
        )
    )
  );

drop policy if exists "shot_chart_update_own" on public.shot_chart;
create policy "shot_chart_update_own" on public.shot_chart
  for update using (
    recorded_by = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.can_track_team_games(g.team_id)
    )
  )
  with check (
    recorded_by = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.can_track_team_games(g.team_id)
        and (
          exists (
            select 1 from public.team_players tp
            where tp.team_id = g.team_id and tp.player_id = player_id
          )
          or player_id = g.home_team_player_id
          or player_id = g.opp_team_player_id
        )
    )
  );

drop policy if exists "shot_chart_delete_own" on public.shot_chart;
create policy "shot_chart_delete_own" on public.shot_chart
  for delete using (
    recorded_by = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.can_track_team_games(g.team_id)
    )
  );

drop policy if exists "tournaments_insert" on public.tournaments;
create policy "tournaments_insert" on public.tournaments
  for insert with check (public.can_track_team_games(team_id));

-- Viewer cannot turn read-only roster visibility into a self-service guardian link.
-- SEC-4 will replace this with the complete authorized-claim workflow.
drop policy if exists "player_guardians_insert" on public.player_guardians;
create policy "player_guardians_insert" on public.player_guardians
  for insert with check (
    user_id = (select auth.uid())
    and not exists (
      select 1
      from public.team_players tp
      where tp.player_id = player_id
        and public.current_team_role(tp.team_id) = 'viewer'
    )
  );

comment on function public.can_track_team_games(uuid) is
  'True for accepted owner/admin/scorer roles; viewer is read-only.';
comment on function public.remove_team_member(uuid, uuid) is
  'Role-safe member removal: owner removes admin/scorer/viewer; admin removes scorer/viewer only.';
