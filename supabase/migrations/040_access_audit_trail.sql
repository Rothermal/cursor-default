-- SEC-6: immutable audit history for access and membership changes.
-- Depends on migrations 035-039.

create table public.access_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_]{2,79}$'),
  actor_user_id uuid references public.profiles(id) on delete set null,
  target_user_id uuid references public.profiles(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  player_id uuid references public.players(id) on delete set null,
  game_id uuid references public.games(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.access_audit_events enable row level security;

create index idx_access_audit_events_created
  on public.access_audit_events (created_at desc);
create index idx_access_audit_events_team_created
  on public.access_audit_events (team_id, created_at desc)
  where team_id is not null;

create policy "access_audit_events_select" on public.access_audit_events
  for select using (
    public.is_app_admin()
    or (
      team_id is not null
      and public.current_team_role(team_id) in ('owner', 'admin')
    )
  );

revoke all on table public.access_audit_events from anon, authenticated;
grant select on table public.access_audit_events to authenticated;

create or replace function public.record_access_audit_event(
  p_event_type text,
  p_actor_user_id uuid default null,
  p_target_user_id uuid default null,
  p_team_id uuid default null,
  p_player_id uuid default null,
  p_game_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if p_event_type is null or p_event_type !~ '^[a-z][a-z0-9_]{2,79}$' then
    raise exception 'Invalid audit event type';
  end if;
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'Audit metadata must be an object';
  end if;
  if v_metadata ?| array['token', 'invite_token', 'access_token', 'refresh_token'] then
    raise exception 'Audit metadata cannot contain token fields';
  end if;

  insert into public.access_audit_events (
    event_type,
    actor_user_id,
    target_user_id,
    team_id,
    player_id,
    game_id,
    metadata
  ) values (
    p_event_type,
    p_actor_user_id,
    p_target_user_id,
    p_team_id,
    p_player_id,
    p_game_id,
    v_metadata
  );
end;
$$;

create or replace function public.audit_team_member_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if new.accepted_at is null then
      perform public.record_access_audit_event(
        p_event_type => 'team_member_invited',
        p_actor_user_id => v_actor_id,
        p_target_user_id => new.user_id,
        p_team_id => new.team_id,
        p_metadata => jsonb_build_object(
          'membership_id', new.id,
          'role', new.role
        )
      );
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.accepted_at is null and new.accepted_at is not null then
      perform public.record_access_audit_event(
        p_event_type => 'team_invite_accepted',
        p_actor_user_id => v_actor_id,
        p_target_user_id => new.user_id,
        p_team_id => new.team_id,
        p_metadata => jsonb_build_object(
          'membership_id', new.id,
          'role', new.role
        )
      );
    elsif new.accepted_at is null and old.invited_at is distinct from new.invited_at then
      perform public.record_access_audit_event(
        p_event_type => 'team_member_invited',
        p_actor_user_id => v_actor_id,
        p_target_user_id => new.user_id,
        p_team_id => new.team_id,
        p_metadata => jsonb_build_object(
          'membership_id', new.id,
          'role', new.role,
          'previous_role', old.role,
          'reinvited', true
        )
      );
    elsif old.accepted_at is not null
       and new.accepted_at is not null
       and old.role is distinct from new.role then
      perform public.record_access_audit_event(
        p_event_type => 'team_member_role_changed',
        p_actor_user_id => v_actor_id,
        p_target_user_id => new.user_id,
        p_team_id => new.team_id,
        p_metadata => jsonb_build_object(
          'membership_id', new.id,
          'previous_role', old.role,
          'role', new.role
        )
      );
    end if;
    return new;
  end if;

  -- Cascades from deleting the parent team/profile are not member-removal actions.
  if not exists (select 1 from public.teams t where t.id = old.team_id)
     or not exists (select 1 from public.profiles p where p.id = old.user_id) then
    return old;
  end if;

  if old.accepted_at is null then
    perform public.record_access_audit_event(
      p_event_type => case
        when v_actor_id = old.user_id then 'team_invite_declined'
        else 'team_invite_canceled'
      end,
      p_actor_user_id => v_actor_id,
      p_target_user_id => old.user_id,
      p_team_id => old.team_id,
      p_metadata => jsonb_build_object(
        'membership_id', old.id,
        'role', old.role
      )
    );
  else
    perform public.record_access_audit_event(
      p_event_type => case
        when v_actor_id = old.user_id then 'team_member_left'
        else 'team_member_removed'
      end,
      p_actor_user_id => v_actor_id,
      p_target_user_id => old.user_id,
      p_team_id => old.team_id,
      p_metadata => jsonb_build_object(
        'membership_id', old.id,
        'role', old.role
      )
    );
  end if;
  return old;
end;
$$;

drop trigger if exists on_team_member_audit on public.team_members;
create trigger on_team_member_audit
  after insert or update or delete on public.team_members
  for each row execute function public.audit_team_member_change();

create or replace function public.audit_team_invite_link_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.record_access_audit_event(
      p_event_type => 'invite_link_created',
      p_actor_user_id => new.created_by,
      p_team_id => new.team_id,
      p_metadata => jsonb_build_object(
        'invite_link_id', new.id,
        'role', new.role,
        'expires_at', new.expires_at
      )
    );
    return new;
  end if;

  if old.redeemed_at is null and new.redeemed_at is not null then
    perform public.record_access_audit_event(
      p_event_type => 'invite_link_redeemed',
      p_actor_user_id => new.redeemed_by,
      p_target_user_id => new.redeemed_by,
      p_team_id => new.team_id,
      p_metadata => jsonb_build_object(
        'invite_link_id', new.id,
        'role', new.role
      )
    );
  elsif old.revoked_at is null and new.revoked_at is not null then
    perform public.record_access_audit_event(
      p_event_type => 'invite_link_revoked',
      p_actor_user_id => new.revoked_by,
      p_team_id => new.team_id,
      p_metadata => jsonb_build_object(
        'invite_link_id', new.id,
        'role', new.role
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_team_invite_link_audit on public.team_invite_links;
create trigger on_team_invite_link_audit
  after insert or update on public.team_invite_links
  for each row execute function public.audit_team_invite_link_change();

create or replace function public.audit_account_access_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status
     or old.app_role is distinct from new.app_role then
    perform public.record_access_audit_event(
      p_event_type => 'app_access_changed',
      p_actor_user_id => (select auth.uid()),
      p_target_user_id => new.user_id,
      p_metadata => jsonb_build_object(
        'previous_status', old.status,
        'status', new.status,
        'previous_app_role', old.app_role,
        'app_role', new.app_role
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_account_access_audit on public.account_access;
create trigger on_account_access_audit
  after update on public.account_access
  for each row execute function public.audit_account_access_change();

create or replace function public.get_access_audit_events(
  p_team_id uuid default null,
  p_limit int default 50
)
returns table (
  id uuid,
  event_type text,
  actor_user_id uuid,
  actor_display_name text,
  target_user_id uuid,
  target_display_name text,
  team_id uuid,
  team_name text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_is_app_admin boolean := public.is_app_admin();
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before viewing audit history';
  end if;
  if p_team_id is null and not v_is_app_admin then
    raise exception 'App administrator access is required for global audit history';
  end if;
  if p_team_id is not null
     and not v_is_app_admin
     and not coalesce(public.current_team_role(p_team_id) in ('owner', 'admin'), false) then
    raise exception 'Team owner or admin access is required for audit history';
  end if;

  return query
  select
    e.id,
    e.event_type,
    e.actor_user_id,
    case
      when e.actor_user_id is null then 'System'::text
      else coalesce(nullif(trim(actor.display_name), ''), 'StatKeeper user')::text
    end,
    e.target_user_id,
    case
      when e.target_user_id is null then null
      else coalesce(nullif(trim(target.display_name), ''), 'StatKeeper user')::text
    end,
    e.team_id,
    case
      when e.team_id is null then null
      else coalesce(nullif(trim(t.nickname), ''), t.name)::text
    end,
    e.metadata,
    e.created_at
  from public.access_audit_events e
  left join public.profiles actor on actor.id = e.actor_user_id
  left join public.profiles target on target.id = e.target_user_id
  left join public.teams t on t.id = e.team_id
  where p_team_id is null or e.team_id = p_team_id
  order by e.created_at desc, e.id desc
  limit v_limit;
end;
$$;

revoke all on function public.record_access_audit_event(text, uuid, uuid, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.audit_team_member_change() from public;
revoke all on function public.audit_team_invite_link_change() from public;
revoke all on function public.audit_account_access_change() from public;
revoke all on function public.get_access_audit_events(uuid, int) from public;
grant execute on function public.get_access_audit_events(uuid, int) to authenticated;

comment on table public.access_audit_events is
  'SEC-6 immutable access audit history; direct writes are denied.';
comment on function public.get_access_audit_events(uuid, int) is
  'Returns global history to app admins or team-scoped history to accepted team owners/admins.';
