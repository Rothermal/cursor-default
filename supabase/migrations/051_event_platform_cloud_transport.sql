-- BKE-4A1: sport-neutral event transport foundation with permanent Soccer wrappers.

-- Migration 050 committed the replacement check without scanning existing rows. Validate it
-- while the old, stricter check still protects writes, then retire the old constraint only after
-- the scan completes.
alter table public.game_events
  validate constraint game_events_team_side_event_platform_check;

alter table public.game_events
  drop constraint game_events_team_side_check;

alter table public.game_events
  rename constraint game_events_team_side_event_platform_check
  to game_events_team_side_check;

create or replace function public.is_event_platform_sport(p_sport_id text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_sport_id in ('soccer', 'basketball'), false);
$$;

revoke all on function public.is_event_platform_sport(text) from public;

comment on function public.is_event_platform_sport(text) is
  'Private allow-list predicate for sports supported by the shared event cloud platform.';

comment on function public.can_read_game(uuid) is
  'Sport-neutral game read authorization for personal owners and accepted team members.';

comment on function public.can_track_game(uuid) is
  'Sport-neutral non-final game tracking authorization for personal owners and accepted team recorders.';

create or replace function public.bind_event_game(
  p_sport_id text,
  p_client_local_game_id text,
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
  if not public.is_event_platform_sport(p_sport_id) then
    raise exception 'Sport is not supported by the event platform';
  end if;
  if length(trim(coalesce(p_client_local_game_id, ''))) = 0 then
    raise exception 'Local game id is required';
  end if;
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
    select team.season_id into v_team_season_id
    from public.teams team
    where team.id = p_source_team_id;
    if not found then raise exception 'Source team not found'; end if;
    if p_source_season_id is distinct from v_team_season_id then
      raise exception 'Source season does not match the source team';
    end if;
  elsif p_source_season_id is not null then
    raise exception 'A personal game cannot bind a team season';
  end if;

  select game.id into v_game_id
  from public.games game
  where game.created_by = v_user_id
    and game.client_local_game_id = trim(p_client_local_game_id);

  if found then
    if not exists (
      select 1
      from public.games game
      where game.id = v_game_id
        and game.status <> 'final'
        and game.sport_id = p_sport_id
        and game.team_id is not distinct from p_source_team_id
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
      trim(p_client_local_game_id), p_sport_id, trim(p_team_name)
    )
    on conflict do nothing
    returning id into v_game_id;

    if v_game_id is null then
      select game.id into v_game_id
      from public.games game
      where game.created_by = v_user_id
        and game.client_local_game_id = trim(p_client_local_game_id)
        and game.status <> 'final'
        and game.sport_id = p_sport_id
        and game.team_id is not distinct from p_source_team_id;
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
      select 1
      from public.team_players team_player
      where team_player.team_id = p_source_team_id
        and team_player.player_id = v_source_player_id
    ) then
      raise exception 'Participant source player is not on the source team';
    end if;
    if exists (
      select 1
      from public.game_participants participant
      where participant.game_id = v_game_id
        and participant.client_participant_id = trim(v_item->>'client_participant_id')
        and participant.client_player_id is not null
        and nullif(trim(coalesce(v_item->>'client_player_id', '')), '') is not null
        and participant.client_player_id is distinct from
          nullif(trim(v_item->>'client_player_id'), '')
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
      client_player_id = coalesce(
        public.game_participants.client_player_id,
        excluded.client_player_id
      ),
      source_player_id = coalesce(
        public.game_participants.source_player_id,
        excluded.source_player_id
      ),
      participant_kind = case
        when coalesce(
          public.game_participants.client_player_id,
          excluded.client_player_id
        ) is null then excluded.participant_kind
        else 'player'
      end,
      display_name = excluded.display_name,
      jersey_number = excluded.jersey_number,
      snapshot = excluded.snapshot,
      updated_at = now();
  end loop;

  select coalesce(
    jsonb_object_agg(participant.client_player_id, participant.id::text),
    '{}'::jsonb
  )
  into v_participant_map
  from public.game_participants participant
  where participant.game_id = v_game_id
    and participant.client_player_id is not null;

  return jsonb_build_object(
    'game_id', v_game_id,
    'participant_id_map', v_participant_map
  );
end;
$$;

revoke all on function public.bind_event_game(
  text, text, uuid, uuid, text, text, text, date, jsonb
) from public;

comment on function public.bind_event_game(
  text, text, uuid, uuid, text, text, text, date, jsonb
) is
  'Private sport-neutral base binding for event-platform games. Public sport wrappers retain client contracts.';

create or replace function public.bind_soccer_event_game(
  p_client_local_game_id text,
  p_source_team_id uuid,
  p_source_season_id uuid,
  p_team_name text,
  p_opponent_name text,
  p_competition_name text,
  p_game_date date,
  p_participants jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.bind_event_game(
    'soccer',
    p_client_local_game_id,
    p_source_team_id,
    p_source_season_id,
    p_team_name,
    p_opponent_name,
    p_competition_name,
    p_game_date,
    p_participants
  );
$$;

revoke all on function public.bind_soccer_event_game(
  text, uuid, uuid, text, text, text, date, jsonb
) from public;
grant execute on function public.bind_soccer_event_game(
  text, uuid, uuid, text, text, text, date, jsonb
) to authenticated;

comment on function public.bind_soccer_event_game(
  text, uuid, uuid, text, text, text, date, jsonb
) is
  'Permanent Soccer compatibility wrapper over the private event-platform base binding.';

-- Preserve the final migration-046 writer, including late non-primary Soccer audit uploads,
-- while adding explicit event-platform and stored-game sport validation.
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
  v_game_sport_id text;
  v_existing public.game_events%rowtype;
  v_written public.game_events%rowtype;
  v_finalized_at timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select game.sport_id into v_game_sport_id
  from public.games game
  where game.id = p_game_id
  for share;
  if not found then raise exception 'Game not found'; end if;
  if not public.is_event_platform_sport(v_game_sport_id)
     or p_sport_id is distinct from v_game_sport_id then
    raise exception 'Event sport is unavailable or incompatible with the game';
  end if;
  if not public.can_track_game(p_game_id) then
    if v_game_sport_id <> 'soccer'
       or not public.can_upload_final_soccer_audit(p_game_id, v_user_id) then
      raise exception 'Not authorized to track this game';
    end if;
    select publication.finalized_at into v_finalized_at
    from public.game_event_canonical_publications publication
    where publication.game_id = p_game_id
      and publication.invalidated_at is null;
    -- Offline timestamps preserve queue intent but do not prove pre-final authorship. Late
    -- non-primary rows remain audit-only and never enter the canonical publication.
    if p_sport_id <> 'soccer'
       or p_event_created_at > v_finalized_at
       or p_event_updated_at > v_finalized_at
       or p_occurred_at > v_finalized_at
       or (p_deleted_at is not null and p_deleted_at > v_finalized_at) then
      raise exception 'Only pre-finalization audit events may finish uploading';
    end if;
  end if;
  if p_revision <> 1 and not exists (
    select 1 from public.game_events event where event.id = p_id
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
  select * into v_existing
  from public.game_events event
  where event.id = p_id;
  if not found
     or v_existing.game_id <> p_game_id
     or v_existing.recorded_by <> v_user_id then
    return 'conflict';
  end if;
  if p_revision < v_existing.revision then return 'stale'; end if;
  if p_revision = v_existing.revision then
    if row(
      p_sport_id, p_event_type, p_schema_version, p_stream_sequence,
      p_period_id, p_period_order, p_elapsed_ms, p_occurred_at, p_team_side,
      p_location, p_actors, p_payload, p_event_created_at, p_event_updated_at,
      p_deleted_at
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

revoke all on function public.upsert_game_event_revisioned(
  uuid, uuid, text, text, integer, bigint, integer, text, integer, bigint,
  timestamptz, text, jsonb, jsonb, jsonb, timestamptz, timestamptz, timestamptz
) from public;
grant execute on function public.upsert_game_event_revisioned(
  uuid, uuid, text, text, integer, bigint, integer, text, integer, bigint,
  timestamptz, text, jsonb, jsonb, jsonb, timestamptz, timestamptz, timestamptz
) to authenticated;

-- Preserve the final migration-046 checkpoint body and its finalized Soccer audit exception.
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
  v_game_sport_id text;
  v_synced_at timestamptz := now();
  v_cloud_count integer;
  v_cloud_max_sequence bigint;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select game.sport_id into v_game_sport_id
  from public.games game
  where game.id = p_game_id
  for share;
  if not found then raise exception 'Game not found'; end if;
  if not public.is_event_platform_sport(v_game_sport_id) then
    raise exception 'Game sport is not supported by the event platform';
  end if;
  if not public.can_track_game(p_game_id)
     and not (
       v_game_sport_id = 'soccer'
       and public.can_upload_final_soccer_audit(p_game_id, v_user_id)
     ) then
    raise exception 'Not authorized to track this game';
  end if;
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

  select count(*)::integer, coalesce(max(event.stream_sequence), -1)
  into v_cloud_count, v_cloud_max_sequence
  from public.game_events event
  where event.game_id = p_game_id
    and event.recorded_by = v_user_id;
  if v_cloud_count <> p_event_count or v_cloud_max_sequence <> p_max_sequence then
    raise exception 'Cloud event stream does not match checkpoint count or sequence';
  end if;
  if exists (
    select 1
    from public.game_events event
    where event.game_id = p_game_id
      and event.recorded_by = v_user_id
      and not exists (
        select 1
        from jsonb_array_elements(p_event_revisions) item
        where (item->>'id')::uuid = event.id
          and (item->>'revision')::integer = event.revision
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

comment on table public.game_events is
  'Recorder-owned revisioned event rows for event-platform sports; sport definitions remain stricter than the shared side allow-list.';
