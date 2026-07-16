-- SEC-3: expiring, single-use scorer/viewer team invite links.
-- Depends on migrations 035 and 036.

create table if not exists public.team_invite_links (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  role text not null check (role in ('scorer', 'viewer')),
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  redeemed_by uuid references public.profiles(id) on delete set null,
  redeemed_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (redeemed_at is null or revoked_at is null)
);

alter table public.team_invite_links enable row level security;

create index if not exists idx_team_invite_links_team_active
  on public.team_invite_links (team_id, expires_at)
  where redeemed_at is null and revoked_at is null;

create or replace function public.create_team_invite_link(
  p_team_id uuid,
  p_role text,
  p_expires_in_days int default 7
)
returns table (
  id uuid,
  token text,
  role text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := lower(trim(p_role));
  v_token text;
  v_link public.team_invite_links%rowtype;
begin
  if public.current_team_role(p_team_id) not in ('owner', 'admin') then
    raise exception 'Not authorized to create invite links for this team';
  end if;
  if v_role not in ('scorer', 'viewer') then
    raise exception 'Invite links can grant scorer or viewer only';
  end if;
  if p_expires_in_days is null or p_expires_in_days < 1 or p_expires_in_days > 30 then
    raise exception 'Invite link expiry must be between 1 and 30 days';
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '');

  insert into public.team_invite_links (
    team_id,
    role,
    token,
    created_by,
    expires_at
  )
  values (
    p_team_id,
    v_role,
    v_token,
    (select auth.uid()),
    now() + make_interval(days => p_expires_in_days)
  )
  returning * into v_link;

  return query
  select v_link.id, v_link.token, v_link.role, v_link.expires_at, v_link.created_at;
end;
$$;

create or replace function public.get_team_invite_links(p_team_id uuid)
returns table (
  id uuid,
  token text,
  role text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_team_role(p_team_id) not in ('owner', 'admin') then
    raise exception 'Not authorized to view invite links for this team';
  end if;

  return query
  select til.id, til.token, til.role, til.expires_at, til.created_at
  from public.team_invite_links til
  where til.team_id = p_team_id
    and til.redeemed_at is null
    and til.revoked_at is null
    and til.expires_at > now()
  order by til.created_at desc;
end;
$$;

-- Limited token-holder context. This is intentionally callable before authentication.
create or replace function public.get_team_invite_link(p_token text)
returns table (
  team_id uuid,
  team_name text,
  team_nickname text,
  season_name text,
  sport text,
  role text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    til.team_id,
    t.name,
    t.nickname,
    s.name,
    s.sport,
    til.role,
    til.expires_at
  from public.team_invite_links til
  join public.teams t on t.id = til.team_id
  join public.seasons s on s.id = t.season_id
  where til.token = trim(p_token)
    and til.redeemed_at is null
    and til.revoked_at is null
    and til.expires_at > now()
    and char_length(trim(p_token)) = 64
  limit 1;
$$;

create or replace function public.redeem_team_invite_link(p_token text)
returns table (
  team_id uuid,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_link public.team_invite_links%rowtype;
  v_member public.team_members%rowtype;
begin
  if v_user_id is null then
    raise exception 'Sign in before joining this team';
  end if;

  select til.* into v_link
  from public.team_invite_links til
  where til.token = trim(p_token)
  for update;

  if not found
     or v_link.redeemed_at is not null
     or v_link.revoked_at is not null
     or v_link.expires_at <= now() then
    raise exception 'Invite link is invalid or no longer active';
  end if;
  if exists (
    select 1 from public.teams t
    where t.id = v_link.team_id and t.owner_id = v_user_id
  ) then
    raise exception 'You are already the owner of this team';
  end if;

  select tm.* into v_member
  from public.team_members tm
  where tm.team_id = v_link.team_id and tm.user_id = v_user_id
  for update;

  if found then
    if v_member.accepted_at is not null then
      raise exception 'You are already an accepted member of this team';
    end if;
    raise exception 'Resolve your pending email invite before using an invite link';
  end if;

  insert into public.team_members (team_id, user_id, role, accepted_at)
  values (v_link.team_id, v_user_id, v_link.role, now());

  update public.team_invite_links
  set redeemed_by = v_user_id, redeemed_at = now()
  where id = v_link.id;

  return query select v_link.team_id, v_link.role;
end;
$$;

create or replace function public.revoke_team_invite_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  select til.team_id into v_team_id
  from public.team_invite_links til
  where til.id = p_link_id;

  if v_team_id is null then
    raise exception 'Invite link not found';
  end if;
  if public.current_team_role(v_team_id) not in ('owner', 'admin') then
    raise exception 'Not authorized to revoke this invite link';
  end if;

  update public.team_invite_links
  set revoked_by = (select auth.uid()), revoked_at = now()
  where id = p_link_id
    and redeemed_at is null
    and revoked_at is null
    and expires_at > now();

  if not found then
    raise exception 'Invite link is no longer active';
  end if;
end;
$$;

revoke all on table public.team_invite_links from anon, authenticated;
revoke all on function public.create_team_invite_link(uuid, text, int) from public;
revoke all on function public.get_team_invite_links(uuid) from public;
revoke all on function public.get_team_invite_link(text) from public;
revoke all on function public.redeem_team_invite_link(text) from public;
revoke all on function public.revoke_team_invite_link(uuid) from public;

grant execute on function public.create_team_invite_link(uuid, text, int) to authenticated;
grant execute on function public.get_team_invite_links(uuid) to authenticated;
grant execute on function public.get_team_invite_link(text) to anon, authenticated;
grant execute on function public.redeem_team_invite_link(text) to authenticated;
grant execute on function public.revoke_team_invite_link(uuid) to authenticated;

comment on table public.team_invite_links is
  'SEC-3 single-use scorer/viewer invite links; direct table access is denied.';
comment on function public.get_team_invite_link(text) is
  'Limited active-link context available to a token holder before authentication.';
