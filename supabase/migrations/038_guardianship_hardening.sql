-- SEC-4: bounded guardian claims/removal and identity-only player editing.
-- Depends on migrations 035 and 036.

-- Guardian and player updates now use the narrow RPCs below. Keeping direct SELECT
-- access preserves player-pool lookups without allowing arbitrary relationship writes.
drop policy if exists "player_guardians_insert" on public.player_guardians;
drop policy if exists "player_guardians_delete" on public.player_guardians;
drop policy if exists "players_update" on public.players;

revoke insert, update, delete on table public.player_guardians from anon, authenticated;
revoke update on table public.players from anon, authenticated;

create or replace function public.can_manage_player_guardians(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select auth.uid()) is not null
    and (
      exists (
        select 1 from public.players p
        where p.id = p_player_id and p.created_by = (select auth.uid())
      )
      or exists (
        select 1 from public.team_players tp
        where tp.player_id = p_player_id
          and public.is_accepted_team_admin(tp.team_id)
      )
    );
$$;

revoke all on function public.can_manage_player_guardians(uuid) from public;
grant execute on function public.can_manage_player_guardians(uuid) to authenticated;

drop policy if exists "player_guardians_select" on public.player_guardians;
create policy "player_guardians_select" on public.player_guardians
  for select using (
    user_id = (select auth.uid())
    or public.can_manage_player_guardians(player_id)
  );

-- Creator guardian links are a consistent creation default, not a client-side follow-up.
insert into public.player_guardians (player_id, user_id, relationship)
select p.id, p.created_by, 'parent'
from public.players p
where p.created_by is not null
  and not p.is_team_placeholder
on conflict (player_id, user_id) do nothing;

create or replace function public.add_player_creator_guardian()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null and not new.is_team_placeholder then
    insert into public.player_guardians (player_id, user_id, relationship)
    values (new.id, new.created_by, 'parent')
    on conflict (player_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_player_created_add_guardian on public.players;
create trigger on_player_created_add_guardian
  after insert on public.players
  for each row execute function public.add_player_creator_guardian();

create or replace function public.claim_player_guardianship(
  p_player_id uuid,
  p_team_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
begin
  if v_user_id is null then
    raise exception 'Sign in before claiming guardianship';
  end if;

  v_role := public.current_team_role(p_team_id);
  if not coalesce(v_role in ('owner', 'admin', 'scorer'), false) then
    raise exception 'An accepted owner, admin, or scorer role is required to claim guardianship';
  end if;
  if not exists (
    select 1
    from public.team_players tp
    join public.players p on p.id = tp.player_id
    where tp.team_id = p_team_id
      and tp.player_id = p_player_id
      and tp.is_active
      and not p.is_team_placeholder
  ) then
    raise exception 'Player is not available in this team context';
  end if;

  insert into public.player_guardians (player_id, user_id, relationship)
  values (p_player_id, v_user_id, 'parent')
  on conflict (player_id, user_id) do nothing;
end;
$$;

create or replace function public.get_player_guardians(
  p_player_id uuid,
  p_team_id uuid
)
returns table (
  user_id uuid,
  display_name text,
  relationship text,
  created_at timestamptz,
  is_creator boolean,
  is_current_user boolean,
  can_remove boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_created_by uuid;
  v_role text;
begin
  if v_user_id is null then
    raise exception 'Sign in before viewing guardians';
  end if;
  if not exists (
    select 1 from public.team_players tp
    where tp.team_id = p_team_id and tp.player_id = p_player_id
  ) then
    raise exception 'Player is not available in this team context';
  end if;

  select p.created_by into v_created_by
  from public.players p
  where p.id = p_player_id and not p.is_team_placeholder;
  if not found then
    raise exception 'Player not found';
  end if;

  v_role := public.current_team_role(p_team_id);
  if not coalesce(v_role in ('owner', 'admin'), false)
     and v_created_by is distinct from v_user_id
     and not exists (
       select 1 from public.player_guardians pg
       where pg.player_id = p_player_id and pg.user_id = v_user_id
     ) then
    raise exception 'Not authorized to view this player''s guardians';
  end if;

  return query
  select
    pg.user_id,
    coalesce(nullif(trim(pr.display_name), ''), 'Guardian')::text,
    pg.relationship,
    pg.created_at,
    pg.user_id = v_created_by,
    pg.user_id = v_user_id,
    (
      pg.user_id = v_user_id
      or v_created_by = v_user_id
      or v_role in ('owner', 'admin')
    )
  from public.player_guardians pg
  left join public.profiles pr on pr.id = pg.user_id
  where pg.player_id = p_player_id
  order by (pg.user_id = v_created_by) desc, pg.created_at asc;
end;
$$;

create or replace function public.remove_player_guardian(
  p_player_id uuid,
  p_guardian_user_id uuid,
  p_team_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_created_by uuid;
  v_manager_authorized boolean := false;
begin
  if v_user_id is null then
    raise exception 'Sign in before removing guardianship';
  end if;

  select p.created_by into v_created_by
  from public.players p
  where p.id = p_player_id and not p.is_team_placeholder;
  if not found then
    raise exception 'Player not found';
  end if;

  if p_team_id is not null then
    v_manager_authorized :=
      coalesce(public.current_team_role(p_team_id) in ('owner', 'admin'), false)
      and exists (
        select 1 from public.team_players tp
        where tp.team_id = p_team_id and tp.player_id = p_player_id
      );
  end if;

  if p_guardian_user_id is distinct from v_user_id
     and v_created_by is distinct from v_user_id
     and not v_manager_authorized then
    raise exception 'Not authorized to remove this guardian';
  end if;

  delete from public.player_guardians pg
  where pg.player_id = p_player_id and pg.user_id = p_guardian_user_id;

  if not found then
    raise exception 'Guardian relationship not found';
  end if;
end;
$$;

create or replace function public.update_player_identity(
  p_player_id uuid,
  p_first_name text,
  p_last_name text,
  p_nickname text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_first_name text := trim(p_first_name);
begin
  if v_user_id is null then
    raise exception 'Sign in before editing a player';
  end if;
  if v_first_name is null or v_first_name = '' then
    raise exception 'First name is required';
  end if;
  if char_length(v_first_name) > 100
     or char_length(coalesce(p_last_name, '')) > 100
     or char_length(coalesce(p_nickname, '')) > 100 then
    raise exception 'Player identity fields must be 100 characters or fewer';
  end if;
  if not exists (
    select 1
    from public.players p
    where p.id = p_player_id
      and not p.is_team_placeholder
      and (
        p.created_by = v_user_id
        or exists (
          select 1 from public.player_guardians pg
          where pg.player_id = p.id and pg.user_id = v_user_id
        )
      )
  ) then
    raise exception 'Not authorized to edit this player''s identity';
  end if;

  update public.players
  set
    first_name = v_first_name,
    last_name = nullif(trim(p_last_name), ''),
    nickname = nullif(trim(p_nickname), '')
  where id = p_player_id;
end;
$$;

revoke all on function public.claim_player_guardianship(uuid, uuid) from public;
revoke all on function public.get_player_guardians(uuid, uuid) from public;
revoke all on function public.remove_player_guardian(uuid, uuid, uuid) from public;
revoke all on function public.update_player_identity(uuid, text, text, text) from public;
revoke all on function public.add_player_creator_guardian() from public;

grant execute on function public.claim_player_guardianship(uuid, uuid) to authenticated;
grant execute on function public.get_player_guardians(uuid, uuid) to authenticated;
grant execute on function public.remove_player_guardian(uuid, uuid, uuid) to authenticated;
grant execute on function public.update_player_identity(uuid, text, text, text) to authenticated;

comment on function public.claim_player_guardianship(uuid, uuid) is
  'SEC-4 self-service claim from a real accepted non-viewer team/player context.';
comment on function public.get_player_guardians(uuid, uuid) is
  'SEC-4 guardian names and removal capabilities for managers, creators, and guardians.';
comment on function public.remove_player_guardian(uuid, uuid, uuid) is
  'SEC-4 removal by self, player creator, or owner/admin of a team containing the player.';
comment on function public.update_player_identity(uuid, text, text, text) is
  'SEC-4 identity-only player update for the player creator or a current guardian.';
comment on function public.add_player_creator_guardian() is
  'Ensures every new non-placeholder player creator has a guardian relationship.';
comment on function public.can_manage_player_guardians(uuid) is
  'True for the player creator or an accepted owner/admin of a team containing the player.';
