-- SOC-1: generic, recorder-owned game event storage.
-- Event orchestration and aggregate publication are intentionally deferred to SOC-5.

create table if not exists public.game_events (
  id uuid primary key,
  game_id uuid not null references public.games (id) on delete cascade,
  recorded_by uuid not null references public.profiles (id),
  sport_id text not null check (length(trim(sport_id)) > 0),
  event_type text not null check (length(trim(event_type)) > 0),
  schema_version integer not null check (schema_version >= 1),
  stream_sequence bigint not null check (stream_sequence >= 0),
  revision integer not null check (revision >= 1),
  period_id text not null check (length(trim(period_id)) > 0),
  period_order integer not null check (period_order >= 0),
  elapsed_ms bigint check (elapsed_ms is null or elapsed_ms >= 0),
  occurred_at timestamptz not null,
  team_side text not null check (team_side in ('tracked', 'opponent')),
  location jsonb,
  actors jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  event_created_at timestamptz not null,
  event_updated_at timestamptz not null,
  deleted_at timestamptz,
  stored_at timestamptz not null default now(),
  constraint game_events_location_object check (
    location is null or jsonb_typeof(location) = 'object'
  ),
  constraint game_events_actors_array check (jsonb_typeof(actors) = 'array'),
  constraint game_events_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint game_events_update_order check (event_updated_at >= event_created_at),
  constraint game_events_delete_order check (
    deleted_at is null or deleted_at >= event_created_at
  )
);

create index if not exists idx_game_events_game_recorder_order
  on public.game_events (
    game_id,
    recorded_by,
    period_order,
    elapsed_ms,
    stream_sequence,
    id
  );
create index if not exists idx_game_events_recorded_by
  on public.game_events (recorded_by);
create index if not exists idx_game_events_active
  on public.game_events (game_id, recorded_by)
  where deleted_at is null;

alter table public.game_events enable row level security;

create policy "game_events_select_member" on public.game_events
  for select using (
    exists (
      select 1
      from public.games g
      where g.id = game_id
        and public.current_team_role(g.team_id) is not null
    )
  );

create policy "game_events_insert_own" on public.game_events
  for insert with check (
    recorded_by = (select auth.uid())
    and exists (
      select 1
      from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.can_track_team_games(g.team_id)
    )
  );

create policy "game_events_update_own" on public.game_events
  for update using (
    recorded_by = (select auth.uid())
    and exists (
      select 1
      from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.can_track_team_games(g.team_id)
    )
  )
  with check (
    recorded_by = (select auth.uid())
    and exists (
      select 1
      from public.games g
      where g.id = game_id
        and g.status <> 'final'
        and public.can_track_team_games(g.team_id)
    )
  );

-- There is intentionally no DELETE policy. Client deletion is a revisioned tombstone update.

-- Supabase grants public-schema table DML to API roles by default. Event writes must pass
-- through the revision-aware RPC, so RLS remains defense in depth rather than a direct path
-- around stale/conflict detection.
revoke all on table public.game_events from anon, authenticated;
grant select on table public.game_events to authenticated;

create or replace function public.upsert_game_event_revisioned(
  p_id uuid,
  p_game_id uuid,
  p_sport_id text,
  p_event_type text,
  p_schema_version integer,
  p_stream_sequence bigint,
  p_revision integer,
  p_period_id text,
  p_period_order integer,
  p_elapsed_ms bigint,
  p_occurred_at timestamptz,
  p_team_side text,
  p_location jsonb,
  p_actors jsonb,
  p_payload jsonb,
  p_event_created_at timestamptz,
  p_event_updated_at timestamptz,
  p_deleted_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_team_id uuid;
  v_game_status text;
  v_existing public.game_events%rowtype;
  v_written public.game_events%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select g.team_id, g.status
  into v_team_id, v_game_status
  from public.games g
  where g.id = p_game_id;

  if not found then
    raise exception 'Game not found';
  end if;
  if v_game_status = 'final' then
    raise exception 'Final games cannot accept event writes';
  end if;
  if not public.can_track_team_games(v_team_id) then
    raise exception 'Not authorized to track this game';
  end if;

  -- Local creation always begins at revision 1. Existing rows may advance by one or more
  -- revisions after offline work, but a new id cannot start midway through a history.
  if p_revision <> 1
     and not exists (select 1 from public.game_events ge where ge.id = p_id) then
    return 'conflict';
  end if;

  insert into public.game_events (
    id,
    game_id,
    recorded_by,
    sport_id,
    event_type,
    schema_version,
    stream_sequence,
    revision,
    period_id,
    period_order,
    elapsed_ms,
    occurred_at,
    team_side,
    location,
    actors,
    payload,
    event_created_at,
    event_updated_at,
    deleted_at,
    stored_at
  ) values (
    p_id,
    p_game_id,
    v_user_id,
    p_sport_id,
    p_event_type,
    p_schema_version,
    p_stream_sequence,
    p_revision,
    p_period_id,
    p_period_order,
    p_elapsed_ms,
    p_occurred_at,
    p_team_side,
    p_location,
    p_actors,
    p_payload,
    p_event_created_at,
    p_event_updated_at,
    p_deleted_at,
    now()
  )
  on conflict (id) do update set
    schema_version = excluded.schema_version,
    revision = excluded.revision,
    period_id = excluded.period_id,
    period_order = excluded.period_order,
    elapsed_ms = excluded.elapsed_ms,
    occurred_at = excluded.occurred_at,
    team_side = excluded.team_side,
    location = excluded.location,
    actors = excluded.actors,
    payload = excluded.payload,
    event_updated_at = excluded.event_updated_at,
    deleted_at = excluded.deleted_at,
    stored_at = now()
  where game_events.game_id = excluded.game_id
    and game_events.recorded_by = excluded.recorded_by
    and game_events.sport_id = excluded.sport_id
    and game_events.event_type = excluded.event_type
    and game_events.stream_sequence = excluded.stream_sequence
    and game_events.event_created_at = excluded.event_created_at
    and game_events.schema_version <= excluded.schema_version
    and game_events.revision < excluded.revision
  returning * into v_written;

  if found then
    return 'applied';
  end if;

  select * into v_existing
  from public.game_events
  where id = p_id;

  if not found
     or v_existing.game_id <> p_game_id
     or v_existing.recorded_by <> v_user_id then
    return 'conflict';
  end if;

  if p_revision < v_existing.revision then
    return 'stale';
  end if;

  if p_revision = v_existing.revision then
    if row(
      p_sport_id,
      p_event_type,
      p_schema_version,
      p_stream_sequence,
      p_period_id,
      p_period_order,
      p_elapsed_ms,
      p_occurred_at,
      p_team_side,
      p_location,
      p_actors,
      p_payload,
      p_event_created_at,
      p_event_updated_at,
      p_deleted_at
    ) is not distinct from row(
      v_existing.sport_id,
      v_existing.event_type,
      v_existing.schema_version,
      v_existing.stream_sequence,
      v_existing.period_id,
      v_existing.period_order,
      v_existing.elapsed_ms,
      v_existing.occurred_at,
      v_existing.team_side,
      v_existing.location,
      v_existing.actors,
      v_existing.payload,
      v_existing.event_created_at,
      v_existing.event_updated_at,
      v_existing.deleted_at
    ) then
      return 'idempotent';
    end if;
    return 'conflict';
  end if;

  -- A higher revision should have been applied above. Reaching this branch means a
  -- concurrent write or policy-visible row changed while this request was evaluated.
  return 'conflict';
end;
$$;

revoke all on function public.upsert_game_event_revisioned(
  uuid, uuid, text, text, integer, bigint, integer, text, integer, bigint,
  timestamptz, text, jsonb, jsonb, jsonb, timestamptz, timestamptz, timestamptz
) from public;
grant execute on function public.upsert_game_event_revisioned(
  uuid, uuid, text, text, integer, bigint, integer, text, integer, bigint,
  timestamptz, text, jsonb, jsonb, jsonb, timestamptz, timestamptz, timestamptz
) to authenticated;

comment on table public.game_events is
  'Versioned raw sport events. Each recorder owns an independent stream; aggregates are projections.';
comment on function public.upsert_game_event_revisioned(
  uuid, uuid, text, text, integer, bigint, integer, text, integer, bigint,
  timestamptz, text, jsonb, jsonb, jsonb, timestamptz, timestamptz, timestamptz
) is
  'Revision-aware own-recorder event write: applied, idempotent, stale, or conflict.';
