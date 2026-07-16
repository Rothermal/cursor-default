-- SEC-5: platform-level account status and app administration.
-- Team roles remain independent; app admins do not bypass team authorization.

create table if not exists public.account_access (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'pending', 'suspended')),
  app_role text not null default 'user'
    check (app_role in ('user', 'app_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.account_access enable row level security;
revoke all on table public.account_access from anon, authenticated;

insert into public.account_access (user_id)
select p.id
from public.profiles p
on conflict (user_id) do nothing;

create or replace function public.add_default_account_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.account_access (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_created_add_account_access on public.profiles;
create trigger on_profile_created_add_account_access
  after insert on public.profiles
  for each row execute function public.add_default_account_access();

create or replace function public.has_active_app_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.account_access aa
    where aa.user_id = (select auth.uid())
      and aa.status = 'active'
  );
$$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.account_access aa
    where aa.user_id = (select auth.uid())
      and aa.status = 'active'
      and aa.app_role = 'app_admin'
  );
$$;

create or replace function public.get_my_app_access()
returns table (
  status text,
  app_role text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in before loading account access';
  end if;

  return query
  select aa.status, aa.app_role, aa.updated_at
  from public.account_access aa
  where aa.user_id = (select auth.uid());

  if not found then
    raise exception 'Account access record is missing';
  end if;
end;
$$;

create or replace function public.list_account_access(p_search text default null)
returns table (
  user_id uuid,
  display_name text,
  email text,
  status text,
  app_role text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'App administrator access is required';
  end if;

  return query
  select
    aa.user_id,
    coalesce(nullif(trim(p.display_name), ''), 'StatKeeper user')::text,
    p.email,
    aa.status,
    aa.app_role,
    aa.updated_at
  from public.account_access aa
  join public.profiles p on p.id = aa.user_id
  where nullif(trim(p_search), '') is null
     or p.display_name ilike '%' || trim(p_search) || '%'
     or p.email ilike '%' || trim(p_search) || '%'
  order by p.display_name nulls last, p.email nulls last, aa.user_id
  limit 200;
end;
$$;

create or replace function public.set_account_access(
  p_user_id uuid,
  p_status text,
  p_app_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := (select auth.uid());
begin
  if not public.is_app_admin() then
    raise exception 'App administrator access is required';
  end if;
  if p_status not in ('active', 'pending', 'suspended') then
    raise exception 'Invalid account status';
  end if;
  if p_app_role not in ('user', 'app_admin') then
    raise exception 'Invalid app role';
  end if;
  if p_user_id = v_actor_id
     and (p_status <> 'active' or p_app_role <> 'app_admin') then
    raise exception 'App administrators cannot remove their own active administrator access';
  end if;

  update public.account_access aa
  set
    status = p_status,
    app_role = p_app_role,
    updated_at = now(),
    updated_by = v_actor_id
  where aa.user_id = p_user_id;

  if not found then
    raise exception 'Account access record not found';
  end if;
end;
$$;

-- PostgREST invokes this once per Data API request. This also gates existing
-- security-definer RPCs, which table RLS policies alone cannot reliably cover.
create or replace function public.enforce_app_access_request()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_path text := ltrim(coalesce(current_setting('request.path', true), ''), '/');
  v_status text;
begin
  if v_user_id is null then
    return;
  end if;

  -- This RPC must remain available so the client can render the access gate.
  if v_path = 'rpc/get_my_app_access' then
    return;
  end if;

  select aa.status into v_status
  from public.account_access aa
  where aa.user_id = v_user_id;

  if v_status = 'active' then
    return;
  end if;
  if v_status = 'pending' then
    raise insufficient_privilege using message = 'APP_ACCESS_PENDING';
  end if;
  if v_status = 'suspended' then
    raise insufficient_privilege using message = 'APP_ACCESS_SUSPENDED';
  end if;

  raise insufficient_privilege using message = 'APP_ACCESS_UNAVAILABLE';
end;
$$;

revoke all on function public.add_default_account_access() from public;
revoke all on function public.has_active_app_access() from public;
revoke all on function public.is_app_admin() from public;
revoke all on function public.get_my_app_access() from public;
revoke all on function public.list_account_access(text) from public;
revoke all on function public.set_account_access(uuid, text, text) from public;
revoke all on function public.enforce_app_access_request() from public;

grant execute on function public.has_active_app_access() to authenticated;
grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.get_my_app_access() to authenticated;
grant execute on function public.list_account_access(text) to authenticated;
grant execute on function public.set_account_access(uuid, text, text) to authenticated;
grant execute on function public.enforce_app_access_request() to anon, authenticated;

alter role authenticator set pgrst.db_pre_request = 'public.enforce_app_access_request';
notify pgrst, 'reload config';
