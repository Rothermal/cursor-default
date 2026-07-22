-- SOC-5A: cloud binding, game-scoped participant snapshots, and verified event checkpoints.

alter table public.games alter column team_id drop not null;
alter table public.games
  add column if not exists cloud_scope text not null default 'team',
  add column if not exists client_local_game_id uuid,
  add column if not exists sport_id text,
  add column if not exists tracked_team_name text;

alter table public.games
  add constraint games_cloud_scope_check check (cloud_scope in ('team', 'personal')),
  add constraint games_cloud_scope_team_check check (
    (cloud_scope = 'team' and team_id is not null)
    or (
      cloud_scope = 'personal' and team_id is null and sport_id is not null
      and length(trim(tracked_team_name)) > 0
    )
  );

create unique index if not exists idx_games_creator_local_game
  on public.games (created_by, client_local_game_id)
  where client_local_game_id is not null;

create table public.game_participants (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  client_participant_id text not null check (length(trim(client_participant_id)) > 0),
  client_player_id text,
  source_player_id uuid references public.players (id) on delete set null,
  participant_kind text not null check (participant_kind in ('player', 'anonymous')),
  display_name text not null check (length(trim(display_name)) > 0),
  jersey_number text,
  snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_id, client_participant_id)
);

create unique index idx_game_participants_client_player
  on public.game_participants (game_id, client_player_id)
  where client_player_id is not null;
create index idx_game_participants_source_player
  on public.game_participants (source_player_id)
  where source_player_id is not null;

create table public.game_event_stream_checkpoints (
  game_id uuid not null references public.games (id) on delete cascade,
  recorded_by uuid not null references public.profiles (id),
  stream_version integer not null check (stream_version >= 1),
  event_count integer not null check (event_count >= 0),
  max_sequence bigint not null check (max_sequence >= -1),
  event_revisions jsonb not null check (jsonb_typeof(event_revisions) = 'array'),
  stream_fingerprint text not null check (length(stream_fingerprint) > 0),
  synced_at timestamptz not null default now(),
  primary key (game_id, recorded_by)
);

create or replace function public.can_read_game(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.games g
    where g.id = p_game_id
      and (
        (g.cloud_scope = 'personal' and g.created_by = (select auth.uid()))
        or (g.team_id is not null and public.current_team_role(g.team_id) is not null)
      )
  );
$$;

create or replace function public.can_track_game(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.games g
    where g.id = p_game_id
      and g.status <> 'final'
      and (
        (g.cloud_scope = 'personal' and g.created_by = (select auth.uid()))
        or (g.team_id is not null and public.can_track_team_games(g.team_id))
      )
  );
$$;

revoke all on function public.can_read_game(uuid) from public;
revoke all on function public.can_track_game(uuid) from public;
grant execute on function public.can_read_game(uuid) to authenticated;
grant execute on function public.can_track_game(uuid) to authenticated;

drop policy if exists "games_select_member" on public.games;
create policy "games_select_member" on public.games
  for select using (
    (cloud_scope = 'personal' and created_by = (select auth.uid()))
    or (team_id is not null and public.current_team_role(team_id) is not null)
  );

drop policy if exists "games_update_member" on public.games;
create policy "games_update_member" on public.games
  for update using (
    status <> 'final'
    and (
      (cloud_scope = 'personal' and created_by = (select auth.uid()))
      or (team_id is not null and public.can_track_team_games(team_id))
    )
  )
  with check (
    (cloud_scope = 'personal' and created_by = (select auth.uid()))
    or (team_id is not null and public.can_track_team_games(team_id))
  );

drop policy if exists "games_delete_admin" on public.games;
create policy "games_delete_admin" on public.games
  for delete using (
    (cloud_scope = 'personal' and created_by = (select auth.uid()))
    or (team_id is not null and public.current_team_role(team_id) in ('owner', 'admin'))
  );

alter table public.game_participants enable row level security;
create policy "game_participants_select_game" on public.game_participants
  for select using (public.can_read_game(game_id));
revoke all on table public.game_participants from anon, authenticated;
grant select on table public.game_participants to authenticated;

alter table public.game_event_stream_checkpoints enable row level security;
create policy "event_checkpoints_select_game" on public.game_event_stream_checkpoints
  for select using (public.can_read_game(game_id));
revoke all on table public.game_event_stream_checkpoints from anon, authenticated;
grant select on table public.game_event_stream_checkpoints to authenticated;

drop policy if exists "game_events_select_member" on public.game_events;
create policy "game_events_select_member" on public.game_events
  for select using (public.can_read_game(game_id));
drop policy if exists "game_events_insert_own" on public.game_events;
create policy "game_events_insert_own" on public.game_events
  for insert with check (
    recorded_by = (select auth.uid()) and public.can_track_game(game_id)
  );
drop policy if exists "game_events_update_own" on public.game_events;
create policy "game_events_update_own" on public.game_events
  for update using (
    recorded_by = (select auth.uid()) and public.can_track_game(game_id)
  )
  with check (
    recorded_by = (select auth.uid()) and public.can_track_game(game_id)
  );

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
       or new.created_by is distinct from old.created_by
       or new.cloud_scope is distinct from old.cloud_scope
       or new.client_local_game_id is distinct from old.client_local_game_id
       or new.sport_id is distinct from old.sport_id then
      raise exception 'Game scope, team, season, sport, local binding, and creator cannot be changed';
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

create or replace function public.bind_soccer_event_game(
  p_client_local_game_id uuid,
  p_source_team_id uuid,
  p_source_season_id uuid,
  p_team_name text,
  p_opponent_name text,
  p_competition_name text,
  p_game_date date,
  p_participants jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_game_id uuid;
  v_team_season_id uuid;
  v_item jsonb;
  v_source_player_id uuid;
  v_participant_map jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_client_local_game_id is null then raise exception 'Local game id is required'; end if;
  if length(trim(coalesce(p_team_name, ''))) = 0
     or length(trim(coalesce(p_opponent_name, ''))) = 0 then
    raise exception 'Team and opponent names are required';
  end if;
  if jsonb_typeof(p_participants) <> 'array' then
    raise exception 'Participants must be an array';
  end if;

  if p_source_team_id is not null then
    if not public.can_track_team_games(p_source_team_id) then
      raise exception 'Not authorized to track this team';
    end if;
    select t.season_id into v_team_season_id
    from public.teams t where t.id = p_source_team_id;
    if not found then raise exception 'Source team not found'; end if;
    if p_source_season_id is distinct from v_team_season_id then
      raise exception 'Source season does not match the source team';
    end if;
  elsif p_source_season_id is not null then
    raise exception 'A personal game cannot bind a team season';
  end if;

  select g.id into v_game_id
  from public.games g
  where g.created_by = v_user_id
    and g.client_local_game_id = p_client_local_game_id;

  if found then
    if not exists (
      select 1 from public.games g
      where g.id = v_game_id
        and g.status <> 'final'
        and g.sport_id = 'soccer'
        and g.team_id is not distinct from p_source_team_id
    ) then
      raise exception 'Existing local binding is incompatible or finalized';
    end if;
    update public.games set
      tracked_team_name = trim(p_team_name),
      opponent_name = trim(p_opponent_name),
      tournament_name = nullif(trim(coalesce(p_competition_name, '')), ''),
      game_date = p_game_date
    where id = v_game_id;
  else
    insert into public.games (
      team_id, season_id, opponent_name, tournament_name, game_date,
      status, created_by, cloud_scope, client_local_game_id, sport_id, tracked_team_name
    ) values (
      p_source_team_id, p_source_season_id, trim(p_opponent_name),
      nullif(trim(coalesce(p_competition_name, '')), ''), p_game_date,
      'in_progress', v_user_id,
      case when p_source_team_id is null then 'personal' else 'team' end,
      p_client_local_game_id, 'soccer', trim(p_team_name)
    )
    on conflict do nothing
    returning id into v_game_id;

    if v_game_id is null then
      select g.id into v_game_id
      from public.games g
      where g.created_by = v_user_id
        and g.client_local_game_id = p_client_local_game_id
        and g.status <> 'final'
        and g.sport_id = 'soccer'
        and g.team_id is not distinct from p_source_team_id;
      if not found then
        raise exception 'Local game binding conflicted with an incompatible game';
      end if;
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_participants)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or length(trim(coalesce(v_item->>'client_participant_id', ''))) = 0
       or length(trim(coalesce(v_item->>'display_name', ''))) = 0
       or coalesce(v_item->>'kind', '') not in ('player', 'anonymous')
       or jsonb_typeof(coalesce(v_item->'snapshot', '{}'::jsonb)) <> 'object' then
      raise exception 'Participant snapshot is invalid';
    end if;

    v_source_player_id := nullif(v_item->>'source_player_id', '')::uuid;
    if p_source_team_id is null and v_source_player_id is not null then
      raise exception 'Personal participant snapshots cannot claim a source player';
    end if;
    if v_source_player_id is not null and not exists (
      select 1 from public.team_players tp
      where tp.team_id = p_source_team_id and tp.player_id = v_source_player_id
    ) then
      raise exception 'Participant source player is not on the source team';
    end if;
    if exists (
      select 1 from public.game_participants gp
      where gp.game_id = v_game_id
        and gp.client_participant_id = trim(v_item->>'client_participant_id')
        and gp.client_player_id is distinct from
          nullif(trim(coalesce(v_item->>'client_player_id', '')), '')
    ) then
      raise exception 'Participant identity cannot be remapped';
    end if;

    insert into public.game_participants (
      game_id, client_participant_id, client_player_id, source_player_id,
      participant_kind, display_name, jersey_number, snapshot
    ) values (
      v_game_id,
      trim(v_item->>'client_participant_id'),
      nullif(trim(coalesce(v_item->>'client_player_id', '')), ''),
      v_source_player_id,
      v_item->>'kind',
      trim(v_item->>'display_name'),
      nullif(trim(coalesce(v_item->>'jersey_number', '')), ''),
      coalesce(v_item->'snapshot', '{}'::jsonb)
    )
    on conflict (game_id, client_participant_id) do update set
      source_player_id = excluded.source_player_id,
      participant_kind = excluded.participant_kind,
      display_name = excluded.display_name,
      jersey_number = excluded.jersey_number,
      snapshot = excluded.snapshot,
      updated_at = now();
  end loop;

  select coalesce(jsonb_object_agg(gp.client_player_id, gp.id::text), '{}'::jsonb)
  into v_participant_map
  from public.game_participants gp
  where gp.game_id = v_game_id and gp.client_player_id is not null;

  return jsonb_build_object(
    'game_id', v_game_id,
    'participant_id_map', v_participant_map
  );
end;
$$;

revoke all on function public.bind_soccer_event_game(
  uuid, uuid, uuid, text, text, text, date, jsonb
) from public;
grant execute on function public.bind_soccer_event_game(
  uuid, uuid, uuid, text, text, text, date, jsonb
) to authenticated;

create or replace function public.confirm_game_event_stream_checkpoint(
  p_game_id uuid,
  p_stream_version integer,
  p_event_revisions jsonb,
  p_event_count integer,
  p_max_sequence bigint,
  p_stream_fingerprint text
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_synced_at timestamptz := now();
  v_cloud_count integer;
  v_cloud_max_sequence bigint;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.can_track_game(p_game_id) then raise exception 'Not authorized to track this game'; end if;
  if p_stream_version < 1 or p_event_count < 0 or p_max_sequence < -1
     or length(coalesce(p_stream_fingerprint, '')) = 0
     or jsonb_typeof(p_event_revisions) <> 'array'
     or jsonb_array_length(p_event_revisions) <> p_event_count then
    raise exception 'Checkpoint metadata is invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_event_revisions) item
    group by item->>'id'
    having count(*) > 1
  ) then
    raise exception 'Checkpoint contains duplicate event ids';
  end if;

  select count(*)::integer, coalesce(max(ge.stream_sequence), -1)
  into v_cloud_count, v_cloud_max_sequence
  from public.game_events ge
  where ge.game_id = p_game_id and ge.recorded_by = v_user_id;

  if v_cloud_count <> p_event_count or v_cloud_max_sequence <> p_max_sequence then
    raise exception 'Cloud event stream does not match checkpoint count or sequence';
  end if;
  if exists (
    select 1
    from public.game_events ge
    where ge.game_id = p_game_id
      and ge.recorded_by = v_user_id
      and not exists (
        select 1 from jsonb_array_elements(p_event_revisions) item
        where (item->>'id')::uuid = ge.id
          and (item->>'revision')::integer = ge.revision
      )
  ) then
    raise exception 'Cloud event revisions do not match checkpoint';
  end if;

  insert into public.game_event_stream_checkpoints (
    game_id, recorded_by, stream_version, event_count, max_sequence,
    event_revisions, stream_fingerprint, synced_at
  ) values (
    p_game_id, v_user_id, p_stream_version, p_event_count, p_max_sequence,
    p_event_revisions, p_stream_fingerprint, v_synced_at
  )
  on conflict (game_id, recorded_by) do update set
    stream_version = excluded.stream_version,
    event_count = excluded.event_count,
    max_sequence = excluded.max_sequence,
    event_revisions = excluded.event_revisions,
    stream_fingerprint = excluded.stream_fingerprint,
    synced_at = excluded.synced_at;

  return v_synced_at;
end;
$$;

revoke all on function public.confirm_game_event_stream_checkpoint(
  uuid, integer, jsonb, integer, bigint, text
) from public;
grant execute on function public.confirm_game_event_stream_checkpoint(
  uuid, integer, jsonb, integer, bigint, text
) to authenticated;

-- Replace the SOC-1 writer so personal games use the same recorder-owned revision rules.
create or replace function public.upsert_game_event_revisioned(
  p_id uuid, p_game_id uuid, p_sport_id text, p_event_type text,
  p_schema_version integer, p_stream_sequence bigint, p_revision integer,
  p_period_id text, p_period_order integer, p_elapsed_ms bigint,
  p_occurred_at timestamptz, p_team_side text, p_location jsonb,
  p_actors jsonb, p_payload jsonb, p_event_created_at timestamptz,
  p_event_updated_at timestamptz, p_deleted_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_existing public.game_events%rowtype;
  v_written public.game_events%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.can_track_game(p_game_id) then raise exception 'Not authorized to track this game'; end if;
  if p_revision <> 1 and not exists (
    select 1 from public.game_events ge where ge.id = p_id
  ) then return 'conflict'; end if;

  insert into public.game_events (
    id, game_id, recorded_by, sport_id, event_type, schema_version,
    stream_sequence, revision, period_id, period_order, elapsed_ms,
    occurred_at, team_side, location, actors, payload, event_created_at,
    event_updated_at, deleted_at, stored_at
  ) values (
    p_id, p_game_id, v_user_id, p_sport_id, p_event_type, p_schema_version,
    p_stream_sequence, p_revision, p_period_id, p_period_order, p_elapsed_ms,
    p_occurred_at, p_team_side, p_location, p_actors, p_payload, p_event_created_at,
    p_event_updated_at, p_deleted_at, now()
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

  if found then return 'applied'; end if;
  select * into v_existing from public.game_events where id = p_id;
  if not found or v_existing.game_id <> p_game_id or v_existing.recorded_by <> v_user_id then
    return 'conflict';
  end if;
  if p_revision < v_existing.revision then return 'stale'; end if;
  if p_revision = v_existing.revision then
    if row(
      p_sport_id, p_event_type, p_schema_version, p_stream_sequence,
      p_period_id, p_period_order, p_elapsed_ms, p_occurred_at, p_team_side,
      p_location, p_actors, p_payload, p_event_created_at, p_event_updated_at, p_deleted_at
    ) is not distinct from row(
      v_existing.sport_id, v_existing.event_type, v_existing.schema_version,
      v_existing.stream_sequence, v_existing.period_id, v_existing.period_order,
      v_existing.elapsed_ms, v_existing.occurred_at, v_existing.team_side,
      v_existing.location, v_existing.actors, v_existing.payload,
      v_existing.event_created_at, v_existing.event_updated_at, v_existing.deleted_at
    ) then return 'idempotent'; end if;
    return 'conflict';
  end if;
  return 'conflict';
end;
$$;

comment on table public.game_participants is
  'Immutable-in-scope participant identities snapshotted for one event-driven game.';
comment on table public.game_event_stream_checkpoints is
  'Server-verified latest recorder stream checkpoint; canonical resolution is deferred to SOC-5C/5D.';
