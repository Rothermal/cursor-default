-- SOC-5B: immutable soccer setup snapshots and durable same-recorder conflicts.

create table public.game_event_setup_snapshots (
  game_id uuid primary key references public.games (id) on delete cascade,
  sport_id text not null check (length(trim(sport_id)) > 0),
  setup_snapshot jsonb not null check (jsonb_typeof(setup_snapshot) = 'object'),
  updated_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.game_event_conflicts (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  recorded_by uuid not null references public.profiles (id),
  event_id uuid not null,
  local_event jsonb not null check (jsonb_typeof(local_event) = 'object'),
  remote_event jsonb not null check (jsonb_typeof(remote_event) = 'object'),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text check (resolution in ('local', 'remote')),
  resolved_event jsonb check (resolved_event is null or jsonb_typeof(resolved_event) = 'object'),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id)
);

create unique index idx_game_event_conflicts_open
  on public.game_event_conflicts (game_id, recorded_by, event_id)
  where status = 'open';
create index idx_game_event_conflicts_recorder
  on public.game_event_conflicts (game_id, recorded_by, detected_at desc);

alter table public.game_event_setup_snapshots enable row level security;
alter table public.game_event_conflicts enable row level security;

create policy "event_setup_select_game" on public.game_event_setup_snapshots
  for select using (public.can_read_game(game_id));
create policy "event_conflicts_select_own" on public.game_event_conflicts
  for select using (
    recorded_by = (select auth.uid()) and public.can_read_game(game_id)
  );

revoke all on table public.game_event_setup_snapshots from anon, authenticated;
revoke all on table public.game_event_conflicts from anon, authenticated;
grant select on table public.game_event_setup_snapshots to authenticated;
grant select on table public.game_event_conflicts to authenticated;

create or replace function public.bind_soccer_event_game_v2(
  p_existing_game_id uuid,
  p_client_local_game_id text,
  p_source_team_id uuid,
  p_source_season_id uuid,
  p_team_name text,
  p_opponent_name text,
  p_competition_name text,
  p_game_date date,
  p_participants jsonb,
  p_setup_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_bound_local_id text;
  v_binding jsonb;
  v_game_id uuid;
  v_existing_setup jsonb;
  v_participants jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_setup_snapshot) <> 'object'
     or p_setup_snapshot->>'version' <> '1' then
    raise exception 'Soccer setup snapshot is invalid';
  end if;

  if p_existing_game_id is not null then
    select g.client_local_game_id into v_bound_local_id
    from public.games g
    where g.id = p_existing_game_id
      and g.created_by = v_user_id
      and g.status <> 'final'
      and g.sport_id = 'soccer'
      and g.team_id is not distinct from p_source_team_id;
    if not found or v_bound_local_id is null then
      raise exception 'Existing soccer game binding is unavailable or incompatible';
    end if;
  else
    v_bound_local_id := p_client_local_game_id;
  end if;

  v_binding := public.bind_soccer_event_game(
    v_bound_local_id,
    p_source_team_id,
    p_source_season_id,
    p_team_name,
    p_opponent_name,
    p_competition_name,
    p_game_date,
    p_participants
  );
  v_game_id := (v_binding->>'game_id')::uuid;

  select s.setup_snapshot into v_existing_setup
  from public.game_event_setup_snapshots s where s.game_id = v_game_id;
  if found and v_existing_setup is distinct from p_setup_snapshot then
    raise exception 'Soccer setup snapshot cannot be replaced';
  end if;

  insert into public.game_event_setup_snapshots (
    game_id, sport_id, setup_snapshot, updated_by
  ) values (
    v_game_id, 'soccer', p_setup_snapshot, v_user_id
  )
  on conflict (game_id) do update set
    updated_at = now(),
    updated_by = excluded.updated_by;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', gp.id,
    'client_participant_id', gp.client_participant_id,
    'client_player_id', gp.client_player_id,
    'display_name', gp.display_name,
    'jersey_number', gp.jersey_number
  ) order by gp.created_at, gp.id), '[]'::jsonb)
  into v_participants
  from public.game_participants gp where gp.game_id = v_game_id;

  return v_binding || jsonb_build_object('participants', v_participants);
end;
$$;

revoke all on function public.bind_soccer_event_game_v2(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) from public;
grant execute on function public.bind_soccer_event_game_v2(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) to authenticated;

create or replace function public.record_game_event_conflict(
  p_game_id uuid,
  p_event_id uuid,
  p_local_event jsonb,
  p_remote_event jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_conflict_id uuid;
  v_remote_revision integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.can_track_game(p_game_id) then
    raise exception 'Not authorized to resolve this game';
  end if;
  if jsonb_typeof(p_local_event) <> 'object'
     or jsonb_typeof(p_remote_event) <> 'object'
     or p_local_event->>'id' is distinct from p_event_id::text
     or p_remote_event->>'id' is distinct from p_event_id::text then
    raise exception 'Conflict event snapshots are invalid';
  end if;

  select ge.revision into v_remote_revision
  from public.game_events ge
  where ge.id = p_event_id
    and ge.game_id = p_game_id
    and ge.recorded_by = v_user_id;
  if not found or v_remote_revision is distinct from (p_remote_event->>'revision')::integer then
    raise exception 'Remote conflict revision is no longer current';
  end if;

  update public.game_event_conflicts set
    local_event = p_local_event,
    remote_event = p_remote_event,
    detected_at = now()
  where game_id = p_game_id
    and recorded_by = v_user_id
    and event_id = p_event_id
    and status = 'open'
  returning id into v_conflict_id;

  if v_conflict_id is null then
    insert into public.game_event_conflicts (
      game_id, recorded_by, event_id, local_event, remote_event
    ) values (
      p_game_id, v_user_id, p_event_id, p_local_event, p_remote_event
    )
    on conflict do nothing
    returning id into v_conflict_id;
  end if;

  if v_conflict_id is null then
    select id into v_conflict_id
    from public.game_event_conflicts
    where game_id = p_game_id
      and recorded_by = v_user_id
      and event_id = p_event_id
      and status = 'open';
  end if;
  return v_conflict_id;
end;
$$;

create or replace function public.resolve_game_event_conflict(
  p_conflict_id uuid,
  p_resolution text,
  p_resolved_event jsonb
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_resolved_at timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_resolution not in ('local', 'remote')
     or jsonb_typeof(p_resolved_event) <> 'object' then
    raise exception 'Conflict resolution is invalid';
  end if;

  update public.game_event_conflicts set
    status = 'resolved',
    resolution = p_resolution,
    resolved_event = p_resolved_event,
    resolved_at = now(),
    resolved_by = v_user_id
  where id = p_conflict_id
    and recorded_by = v_user_id
    and status = 'open'
    and event_id::text = p_resolved_event->>'id'
  returning resolved_at into v_resolved_at;

  if v_resolved_at is null then
    select resolved_at into v_resolved_at
    from public.game_event_conflicts
    where id = p_conflict_id
      and recorded_by = v_user_id
      and status = 'resolved'
      and resolution = p_resolution
      and resolved_event is not distinct from p_resolved_event;
  end if;
  if v_resolved_at is null then raise exception 'Conflict was not found'; end if;
  return v_resolved_at;
end;
$$;

revoke all on function public.record_game_event_conflict(uuid, uuid, jsonb, jsonb) from public;
grant execute on function public.record_game_event_conflict(uuid, uuid, jsonb, jsonb) to authenticated;
revoke all on function public.resolve_game_event_conflict(uuid, text, jsonb) from public;
grant execute on function public.resolve_game_event_conflict(uuid, text, jsonb) to authenticated;

comment on table public.game_event_setup_snapshots is
  'Immutable sport setup required to rebuild an event-driven game on another device.';
comment on table public.game_event_conflicts is
  'Durable same-recorder competing revisions and explicit resolution audit.';
