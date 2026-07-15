-- SEC-1: accepted membership, role-safe member operations, and bounded game writes.
-- Target contract: docs/ACCESS_MATRIX.md

-- --------------------------------------------------------------------------
-- 1. Shared authorization helpers
-- --------------------------------------------------------------------------

create or replace function public.current_team_role(p_team_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from public.teams t
      where t.id = p_team_id
        and t.owner_id = (select auth.uid())
    ) then 'owner'::text
    else (
      select tm.role
      from public.team_members tm
      where tm.team_id = p_team_id
        and tm.user_id = (select auth.uid())
        and tm.accepted_at is not null
      limit 1
    )
  end;
$$;

create or replace function public.is_accepted_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_team_role(p_team_id) is not null;
$$;

create or replace function public.is_accepted_team_admin(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_team_role(p_team_id) in ('owner', 'admin');
$$;

revoke all on function public.current_team_role(uuid) from public;
revoke all on function public.is_accepted_team_member(uuid) from public;
revoke all on function public.is_accepted_team_admin(uuid) from public;
grant execute on function public.current_team_role(uuid) to authenticated;
grant execute on function public.is_accepted_team_member(uuid) to authenticated;
grant execute on function public.is_accepted_team_admin(uuid) to authenticated;

create index if not exists idx_team_members_user_accepted
  on public.team_members (user_id, team_id, role)
  where accepted_at is not null;

-- --------------------------------------------------------------------------
-- 2. Membership reads and narrow member-management RPCs
-- --------------------------------------------------------------------------

drop policy if exists "team_members_select" on public.team_members;
drop policy if exists "team_members_insert_self" on public.team_members;
drop policy if exists "team_members_update_accept" on public.team_members;
drop policy if exists "team_members_delete" on public.team_members;
drop policy if exists "team_members_insert_admin" on public.team_members;
drop policy if exists "team_members_delete_admin" on public.team_members;

-- Direct table access is self-read only. All writes use the RPCs below.
create policy "team_members_select_own" on public.team_members
  for select using (user_id = (select auth.uid()));

create or replace function public.get_my_pending_team_invites()
returns table (
  id uuid,
  team_id uuid,
  role text,
  invited_at timestamptz,
  team_name text,
  team_nickname text,
  season_name text,
  sport text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    tm.id,
    tm.team_id,
    tm.role,
    tm.invited_at,
    t.name,
    t.nickname,
    s.name,
    s.sport
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  join public.seasons s on s.id = t.season_id
  where tm.user_id = (select auth.uid())
    and tm.accepted_at is null
    and t.owner_id <> (select auth.uid())
  order by tm.invited_at desc;
$$;

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
    and tm.role in ('admin', 'scorer');

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
    and tm.role in ('admin', 'scorer');

  if not found then
    raise exception 'Pending team invite not found';
  end if;
end;
$$;

create or replace function public.leave_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_team_role(p_team_id);
begin
  if v_role is null then
    raise exception 'Accepted team membership not found';
  end if;
  if v_role = 'owner'
     or exists (
       select 1 from public.teams t
       where t.id = p_team_id and t.owner_id = (select auth.uid())
     ) then
    raise exception 'Team owner cannot leave before ownership is transferred';
  end if;

  delete from public.team_members tm
  where tm.team_id = p_team_id
    and tm.user_id = (select auth.uid())
    and tm.accepted_at is not null
    and tm.role <> 'owner';

  if not found then
    raise exception 'Accepted team membership not found';
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
  if v_actor_role = 'admin' and v_target.role <> 'scorer' then
    raise exception 'Admins can remove scorers only';
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
  if v_actor_role <> 'owner' then
    raise exception 'Only the team owner can change admin/scorer roles';
  end if;
  if v_role not in ('admin', 'scorer') then
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

  update public.team_members
  set role = v_role
  where id = v_target.id;
end;
$$;

-- Exact-email lookup remains manager-only and never exposes a searchable user directory.
create or replace function public.lookup_user_by_email(p_team_id uuid, p_email text)
returns table (id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, coalesce(p.display_name, u.email)::text
  from auth.users u
  left join public.profiles p on p.id = u.id
  where lower(trim(u.email)) = lower(trim(p_email))
    and public.is_accepted_team_admin(p_team_id)
  limit 1;
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
  if v_role not in ('admin', 'scorer') then
    raise exception 'Invalid team role';
  end if;
  if v_actor_role = 'admin' and v_role <> 'scorer' then
    raise exception 'Admins can invite scorers only';
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
    if v_actor_role = 'admin' and v_existing.role <> 'scorer' then
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

-- Accepted members see names/roles. Email is returned only to accepted managers.
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
    case tm.role when 'owner' then 0 when 'admin' then 1 else 2 end,
    tm.invited_at;
end;
$$;

revoke all on function public.get_my_pending_team_invites() from public;
revoke all on function public.accept_team_invite(uuid) from public;
revoke all on function public.decline_team_invite(uuid) from public;
revoke all on function public.leave_team(uuid) from public;
revoke all on function public.remove_team_member(uuid, uuid) from public;
revoke all on function public.set_team_member_role(uuid, uuid, text) from public;
revoke all on function public.lookup_user_by_email(uuid, text) from public;
revoke all on function public.invite_team_member(uuid, uuid, text) from public;
revoke all on function public.get_team_members_with_profiles(uuid) from public;
grant execute on function public.get_my_pending_team_invites() to authenticated;
grant execute on function public.accept_team_invite(uuid) to authenticated;
grant execute on function public.decline_team_invite(uuid) to authenticated;
grant execute on function public.leave_team(uuid) to authenticated;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated;
grant execute on function public.set_team_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.lookup_user_by_email(uuid, text) to authenticated;
grant execute on function public.invite_team_member(uuid, uuid, text) to authenticated;
grant execute on function public.get_team_members_with_profiles(uuid) to authenticated;

-- Profiles are private rows. Team/member display names use the limited RPC above.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (id = (select auth.uid()));

-- --------------------------------------------------------------------------
-- 3. Accepted team/season/roster/player visibility and management
-- --------------------------------------------------------------------------

drop policy if exists "teams_select_member" on public.teams;
create policy "teams_select_member" on public.teams
  for select using (
    owner_id = (select auth.uid())
    or public.is_accepted_team_member(id)
  );

drop policy if exists "teams_update_admin" on public.teams;
create policy "teams_update_admin" on public.teams
  for update using (public.is_accepted_team_admin(id))
  with check (public.is_accepted_team_admin(id));

create or replace function public.enforce_team_identity_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'Team ownership transfer requires a dedicated operation';
  end if;
  if new.season_id is distinct from old.season_id then
    raise exception 'Moving a team between seasons is not supported';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_team_identity_immutable on public.teams;
create trigger enforce_team_identity_immutable
  before update on public.teams
  for each row execute function public.enforce_team_identity_immutable();

drop policy if exists "seasons_select" on public.seasons;
create policy "seasons_select" on public.seasons
  for select using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.teams t
      where t.season_id = id
        and public.is_accepted_team_member(t.id)
    )
  );

drop policy if exists "team_players_select" on public.team_players;
create policy "team_players_select" on public.team_players
  for select using (public.is_accepted_team_member(team_id));

drop policy if exists "team_players_insert" on public.team_players;
create policy "team_players_insert" on public.team_players
  for insert with check (public.is_accepted_team_admin(team_id));

drop policy if exists "team_players_update" on public.team_players;
create policy "team_players_update" on public.team_players
  for update using (public.is_accepted_team_admin(team_id))
  with check (public.is_accepted_team_admin(team_id));

drop policy if exists "team_players_delete" on public.team_players;
create policy "team_players_delete" on public.team_players
  for delete using (public.is_accepted_team_admin(team_id));

drop policy if exists "players_select" on public.players;
create policy "players_select" on public.players
  for select using (
    created_by = (select auth.uid())
    or id in (
      select pg.player_id from public.player_guardians pg
      where pg.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.team_players tp
      where tp.player_id = id
        and public.is_accepted_team_member(tp.team_id)
    )
  );

drop policy if exists "player_guardians_select" on public.player_guardians;
create policy "player_guardians_select" on public.player_guardians
  for select using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.team_players tp
      where tp.player_id = player_id
        and public.is_accepted_team_member(tp.team_id)
    )
  );

-- --------------------------------------------------------------------------
-- 4. Accepted game access and final-game immutability
-- --------------------------------------------------------------------------

drop policy if exists "games_select_member" on public.games;
create policy "games_select_member" on public.games
  for select using (public.is_accepted_team_member(team_id));

drop policy if exists "games_insert_member" on public.games;
create policy "games_insert_member" on public.games
  for insert with check (
    created_by = (select auth.uid())
    and status <> 'final'
    and public.is_accepted_team_member(team_id)
  );

drop policy if exists "games_update_member" on public.games;
create policy "games_update_member" on public.games
  for update using (
    status <> 'final'
    and public.is_accepted_team_member(team_id)
  )
  with check (public.is_accepted_team_member(team_id));

drop policy if exists "games_delete_admin" on public.games;
create policy "games_delete_admin" on public.games
  for delete using (public.is_accepted_team_admin(team_id));

create or replace function public.enforce_game_identity_and_final_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'final' then
      raise exception 'Final games are immutable; use correction/admin actions';
    end if;
    if new.team_id is distinct from old.team_id
       or new.season_id is distinct from old.season_id
       or new.created_by is distinct from old.created_by then
      raise exception 'Game team, season, and creator cannot be changed';
    end if;
    if old.status = 'in_progress' and new.status = 'scheduled' then
      raise exception 'An in-progress game cannot return to scheduled';
    end if;
  end if;
  if new.home_team_player_id is not null
     and not exists (
       select 1 from public.players p
       where p.id = new.home_team_player_id and p.is_team_placeholder
     ) then
    raise exception 'Home team stat player must be a placeholder';
  end if;
  if new.opp_team_player_id is not null
     and not exists (
       select 1 from public.players p
       where p.id = new.opp_team_player_id and p.is_team_placeholder
     ) then
    raise exception 'Opponent team stat player must be a placeholder';
  end if;
  if new.home_team_player_id is not null
     and new.home_team_player_id = new.opp_team_player_id then
    raise exception 'Home and opponent team stat players must differ';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_game_identity_and_final_state on public.games;
create trigger enforce_game_identity_and_final_state
  before insert or update on public.games
  for each row execute function public.enforce_game_identity_and_final_state();

-- --------------------------------------------------------------------------
-- 5. Recorder-owned stats, checkouts, and shot chart rows
-- --------------------------------------------------------------------------

drop policy if exists "stats_select_member" on public.game_stats;
create policy "stats_select_member" on public.game_stats
  for select using (
    exists (
      select 1 from public.games g
      where g.id = game_id
        and public.is_accepted_team_member(g.team_id)
    )
  );

drop policy if exists "stats_insert_own" on public.game_stats;
create policy "stats_insert_own" on public.game_stats
  for insert with check (
    recorded_by = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.is_accepted_team_member(g.team_id)
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
        and public.is_accepted_team_member(g.team_id)
    )
  )
  with check (
    recorded_by = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.is_accepted_team_member(g.team_id)
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

drop policy if exists "checkouts_select_member" on public.player_checkouts;
create policy "checkouts_select_member" on public.player_checkouts
  for select using (
    exists (
      select 1 from public.games g
      where g.id = game_id
        and public.is_accepted_team_member(g.team_id)
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
        and public.is_accepted_team_member(g.team_id)
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
        and public.is_accepted_team_member(g.team_id)
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
        and public.is_accepted_team_member(g.team_id)
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
        and public.is_accepted_team_member(g.team_id)
    )
  );

drop policy if exists "shot_chart_select_member" on public.shot_chart;
create policy "shot_chart_select_member" on public.shot_chart
  for select using (
    exists (
      select 1 from public.games g
      where g.id = game_id
        and public.is_accepted_team_member(g.team_id)
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
        and public.is_accepted_team_member(g.team_id)
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
        and public.is_accepted_team_member(g.team_id)
    )
  )
  with check (
    recorded_by = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.is_accepted_team_member(g.team_id)
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
        and public.is_accepted_team_member(g.team_id)
    )
  );

-- --------------------------------------------------------------------------
-- 6. Corrections, tournaments, and privileged RPCs
-- --------------------------------------------------------------------------

drop policy if exists "corrections_select_member" on public.stat_corrections;
create policy "corrections_select_member" on public.stat_corrections
  for select using (
    exists (
      select 1 from public.games g
      where g.id = game_id
        and public.is_accepted_team_member(g.team_id)
    )
  );

drop policy if exists "corrections_insert_admin" on public.stat_corrections;
create policy "corrections_insert_admin" on public.stat_corrections
  for insert with check (
    corrected_by = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status = 'final'
        and public.is_accepted_team_admin(g.team_id)
    )
  );

drop policy if exists "corrections_update_admin" on public.stat_corrections;
create policy "corrections_update_admin" on public.stat_corrections
  for update using (
    exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status = 'final'
        and public.is_accepted_team_admin(g.team_id)
    )
  )
  with check (
    corrected_by = (select auth.uid())
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status = 'final'
        and public.is_accepted_team_admin(g.team_id)
    )
  );

drop policy if exists "corrections_delete_admin" on public.stat_corrections;
create policy "corrections_delete_admin" on public.stat_corrections
  for delete using (
    exists (
      select 1 from public.games g
      where g.id = game_id
        and g.status = 'final'
        and public.is_accepted_team_admin(g.team_id)
    )
  );

drop policy if exists "tournaments_read" on public.tournaments;
create policy "tournaments_read" on public.tournaments
  for select using (public.is_accepted_team_member(team_id));

drop policy if exists "tournaments_insert" on public.tournaments;
create policy "tournaments_insert" on public.tournaments
  for insert with check (public.is_accepted_team_member(team_id));

drop policy if exists "tournaments_update" on public.tournaments;
create policy "tournaments_update" on public.tournaments
  for update using (public.is_accepted_team_admin(team_id))
  with check (public.is_accepted_team_admin(team_id));

drop policy if exists "tournaments_delete" on public.tournaments;
create policy "tournaments_delete" on public.tournaments
  for delete using (public.is_accepted_team_admin(team_id));

create or replace function public.set_primary_recorder(
  p_game_id uuid,
  p_player_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  select g.team_id into v_team_id
  from public.games g
  where g.id = p_game_id and g.status = 'final';

  if v_team_id is null or not public.is_accepted_team_admin(v_team_id) then
    raise exception 'Not authorized to set primary recorder for this game';
  end if;

  update public.player_checkouts
  set is_primary = false
  where game_id = p_game_id and player_id = p_player_id;

  update public.player_checkouts
  set is_primary = true
  where game_id = p_game_id
    and player_id = p_player_id
    and user_id = p_user_id;

  if not found then
    raise exception 'No checkout found for this player and user';
  end if;
end;
$$;

create or replace function public.merge_players_can_merge(
  p_user_id uuid,
  p_duplicate_id uuid,
  p_survivor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id = (select auth.uid())
    and exists (
      select 1 from public.team_players tp
      where tp.player_id = p_duplicate_id
    )
    and exists (
      select 1 from public.team_players tp
      where tp.player_id = p_survivor_id
    )
    and not exists (
      select 1
      from (
        select distinct tp.team_id
        from public.team_players tp
        where tp.player_id in (p_duplicate_id, p_survivor_id)
      ) teams_involved
      where not exists (
        select 1
        from public.teams t
        where t.id = teams_involved.team_id
          and (
            t.owner_id = p_user_id
            or exists (
              select 1 from public.team_members tm
              where tm.team_id = teams_involved.team_id
                and tm.user_id = p_user_id
                and tm.role in ('owner', 'admin')
                and tm.accepted_at is not null
            )
          )
      )
    );
$$;

revoke all on function public.set_primary_recorder(uuid, uuid, uuid) from public;
grant execute on function public.set_primary_recorder(uuid, uuid, uuid) to authenticated;

comment on function public.current_team_role(uuid) is
  'Current caller accepted role for a team; canonical teams.owner_id resolves as owner.';
comment on function public.get_my_pending_team_invites() is
  'Limited invite summaries for the current user before acceptance.';
comment on function public.remove_team_member(uuid, uuid) is
  'Role-safe member removal: owner removes admin/scorer; admin removes scorer only.';
