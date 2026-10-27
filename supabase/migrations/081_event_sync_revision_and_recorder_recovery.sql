-- Preserve offline edits/removals on first upload for every released event sport.
-- Existing-row revision/identity rules and final audit authorization are unchanged.
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
    and exists (
      select 1
      from public.game_event_setup_snapshots setup
      where setup.game_id = p_game_id
        and setup.sport_id = v_game_sport_id
        and (
          (v_game_sport_id in ('soccer', 'basketball')
            and setup.setup_snapshot->'version' in ('1'::jsonb, '2'::jsonb))
          or (v_game_sport_id in ('hockey', 'baseball')
            and setup.setup_snapshot->'version' = '1'::jsonb)
        )
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

-- No primary is a valid pending state, not a nullable boolean/parser failure.
create or replace function public.get_event_game_recorders(
  p_sport_id text,
  p_game_id uuid
)
returns table (
  recorder_user_id uuid,
  display_name text,
  event_count integer,
  checkpoint_event_count integer,
  checkpoint_synced_at timestamptz,
  checkpoint_current boolean,
  unresolved_conflict_count integer,
  is_primary boolean,
  primary_source text,
  can_select_primary boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_game public.games%rowtype;
  v_primary uuid;
  v_selection_source text;
  v_can_select boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.is_event_platform_sport(p_sport_id) then
    raise exception 'Sport is not supported by the event platform';
  end if;
  if not public.can_read_game(p_game_id) then raise exception 'Game is unavailable'; end if;

  select * into v_game
  from public.games game
  where game.id = p_game_id
    and game.sport_id = p_sport_id;
  if not found then raise exception '% game not found', initcap(p_sport_id); end if;

  select primary_recorder.selection_source into v_selection_source
  from public.game_event_primary_recorders primary_recorder
  where primary_recorder.game_id = p_game_id;
  v_primary := public.effective_event_primary_recorder(p_sport_id, p_game_id);
  v_can_select := coalesce((
    (v_game.cloud_scope = 'personal' and v_game.created_by = v_user_id)
    or (
      v_game.team_id is not null
      and public.current_team_role(v_game.team_id) in ('owner', 'admin')
    )
  ), false) and v_game.status <> 'final';

  return query
  with recorder_ids as (
    select event.recorded_by
    from public.game_events event
    where event.game_id = p_game_id
      and event.sport_id = p_sport_id
    union
    select checkpoint.recorded_by
    from public.game_event_stream_checkpoints checkpoint
    where checkpoint.game_id = p_game_id
  ),
  event_totals as (
    select event.recorded_by, count(*)::integer as event_count
    from public.game_events event
    where event.game_id = p_game_id
      and event.sport_id = p_sport_id
    group by event.recorded_by
  ),
  conflict_totals as (
    select conflict.recorded_by, count(*)::integer as conflict_count
    from public.game_event_conflicts conflict
    where conflict.game_id = p_game_id
      and conflict.status = 'open'
    group by conflict.recorded_by
  )
  select
    recorder.recorded_by,
    coalesce(nullif(trim(profile.display_name), ''), 'StatKeeper user')::text,
    coalesce(event_total.event_count, 0),
    checkpoint.event_count,
    checkpoint.synced_at,
    public.is_event_checkpoint_current(
      p_sport_id,
      p_game_id,
      recorder.recorded_by
    ),
    coalesce(conflict_total.conflict_count, 0),
    coalesce(recorder.recorded_by = v_primary, false),
    case
      when v_primary is null or recorder.recorded_by <> v_primary then null
      when v_selection_source is not null then v_selection_source
      else 'default'
    end::text,
    v_can_select
  from recorder_ids recorder
  left join public.profiles profile on profile.id = recorder.recorded_by
  left join event_totals event_total
    on event_total.recorded_by = recorder.recorded_by
  left join conflict_totals conflict_total
    on conflict_total.recorded_by = recorder.recorded_by
  left join public.game_event_stream_checkpoints checkpoint
    on checkpoint.game_id = p_game_id
    and checkpoint.recorded_by = recorder.recorded_by
  order by
    (coalesce(recorder.recorded_by = v_primary, false)) desc,
    public.is_event_checkpoint_current(
      p_sport_id,
      p_game_id,
      recorder.recorded_by
    ) desc,
    checkpoint.synced_at,
    recorder.recorded_by;
end;
$$;

-- PUBLIC revocation alone does not remove direct Supabase-default anon grants.
revoke all on function public.upsert_game_event_revisioned(
  uuid, uuid, text, text, integer, bigint, integer, text, integer, bigint,
  timestamptz, text, jsonb, jsonb, jsonb, timestamptz, timestamptz, timestamptz
) from public, anon;
grant execute on function public.upsert_game_event_revisioned(
  uuid, uuid, text, text, integer, bigint, integer, text, integer, bigint,
  timestamptz, text, jsonb, jsonb, jsonb, timestamptz, timestamptz, timestamptz
) to authenticated;

-- Keep the shared recorder reader private; existing fixed sport wrappers own access.
revoke all on function public.get_event_game_recorders(text, uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
