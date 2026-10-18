-- BSB-6B1: preserve actual local revisions on a Baseball stream's first upload.
-- The migration-055 writer is unchanged except for its absent-row revision gate.

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
    if not public.can_upload_final_event_audit(
      v_game_sport_id,
      p_game_id,
      v_user_id
    ) then
      raise exception 'Not authorized to track this game';
    end if;
    select publication.finalized_at into v_finalized_at
    from public.game_event_canonical_publications publication
    where publication.game_id = p_game_id
      and publication.sport_id = v_game_sport_id
      and publication.invalidated_at is null;
    -- Offline timestamps preserve queue intent but do not prove pre-final authorship. Late
    -- non-primary rows remain audit-only and never enter the canonical publication.
    if p_event_created_at > v_finalized_at
       or p_event_updated_at > v_finalized_at
       or p_occurred_at > v_finalized_at
       or (p_deleted_at is not null and p_deleted_at > v_finalized_at) then
      raise exception 'Only pre-finalization audit events may finish uploading';
    end if;
  end if;
  if p_revision <> 1 and not exists (
    select 1 from public.game_events event where event.id = p_id
  ) and not (
    p_revision > 1
    and v_game_sport_id = 'baseball'
    and exists (
      select 1
      from public.game_event_setup_snapshots setup
      where setup.game_id = p_game_id
        and setup.sport_id = 'baseball'
        and setup.setup_snapshot->'version' = '1'::jsonb
    )
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

-- Contract 2 requires this first-upload repair before any Baseball binding or upload.
create or replace function public.get_baseball_release_capabilities()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;
  if not public.has_active_app_access() then
    raise insufficient_privilege using message = 'APP_ACCESS_UNAVAILABLE';
  end if;

  -- Fail closed without exposing which schema object is unavailable.
  if
    not public.is_event_platform_sport('baseball')
    or to_regclass('public.games') is null
    or to_regclass('public.game_participants') is null
    or to_regclass('public.game_events') is null
    or to_regclass('public.game_event_stream_checkpoints') is null
    or to_regclass('public.game_event_setup_snapshots') is null
    or to_regclass('public.game_event_conflicts') is null
    or to_regclass('public.game_event_primary_recorders') is null
    or to_regclass('public.game_event_primary_recorder_audit') is null
    or to_regclass('public.game_event_canonical_publications') is null
    or to_regprocedure(
      'public.bind_baseball_event_game_v5(uuid,text,uuid,uuid,text,text,text,date,jsonb,jsonb,boolean)'
    ) is null
    or to_regprocedure(
      'public.upsert_game_event_revisioned(uuid,uuid,text,text,integer,bigint,integer,text,integer,bigint,timestamptz,text,jsonb,jsonb,jsonb,timestamptz,timestamptz,timestamptz)'
    ) is null
    or to_regprocedure(
      'public.record_game_event_conflict(uuid,uuid,jsonb,jsonb)'
    ) is null
    or to_regprocedure(
      'public.resolve_game_event_conflict(uuid,text,jsonb)'
    ) is null
    or to_regprocedure(
      'public.confirm_game_event_stream_checkpoint(uuid,integer,jsonb,integer,bigint,text)'
    ) is null
    or to_regprocedure('public.get_baseball_game_recorders(uuid)') is null
    or to_regprocedure('public.get_baseball_primary_recorder_history(uuid)') is null
    or to_regprocedure('public.set_baseball_primary_recorder(uuid,uuid)') is null
    or to_regprocedure('public.get_baseball_finalization_readiness(uuid)') is null
    or to_regprocedure('public.get_baseball_canonical_publication(uuid)') is null
    or to_regprocedure(
      'public.get_baseball_primary_conflicts_for_finalization(uuid)'
    ) is null
    or to_regprocedure(
      'public.resolve_baseball_primary_conflict_for_finalization(uuid,text)'
    ) is null
    or to_regprocedure(
      'public.confirm_baseball_primary_checkpoint_for_finalization(uuid,uuid,integer,jsonb,integer,bigint,text)'
    ) is null
    or to_regprocedure(
      'public.finalize_baseball_event_game(uuid,uuid,jsonb,text,jsonb)'
    ) is null
    or to_regprocedure('public.reopen_baseball_event_game(uuid,text)') is null
    or to_regprocedure(
      'public.get_baseball_canonical_publication_history(uuid)'
    ) is null
    or to_regprocedure(
      'public.save_baseball_team_settings_revisioned(uuid,bigint,jsonb)'
    ) is null
  then
    return jsonb_build_object('contractVersion', 0);
  end if;

  return jsonb_build_object(
    'contractVersion', 2,
    'migration', 78,
    'eventTransportVersion', 4,
    'recoveryVersion', 1,
    'recorderResolutionVersion', 1,
    'canonicalFinalizationVersion', 1,
    'setupSnapshotVersion', 1
  );
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

revoke all on function public.get_baseball_release_capabilities() from public;
grant execute on function public.get_baseball_release_capabilities() to authenticated;

comment on function public.get_baseball_release_capabilities() is
  'Baseball event cloud contract 2: migration 078 preserves actual first-upload revisions.';

notify pgrst, 'reload schema';

