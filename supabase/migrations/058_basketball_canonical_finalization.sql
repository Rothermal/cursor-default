-- BKE-4C3: Basketball canonical finalization through the shared event-platform transaction.

-- Retain the migration-055 contract while installing trusted Basketball policy dispatch.
create or replace function public.finalize_event_game(
  p_sport_id text,
  p_game_id uuid,
  p_primary_recorded_by uuid,
  p_event_revisions jsonb,
  p_stream_fingerprint text,
  p_canonical_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_game public.games%rowtype;
  v_checkpoint public.game_event_stream_checkpoints%rowtype;
  v_publication public.game_event_canonical_publications%rowtype;
  v_effective_primary uuid;
  v_publication_number integer;
  v_finalized_at timestamptz := now();
  v_tracked_score integer;
  v_opponent_score integer;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.is_event_platform_sport(p_sport_id) then
    raise exception 'Sport is not supported by the event platform';
  end if;
  if not public.can_manage_event_game(p_sport_id, p_game_id) then
    raise exception 'Team owner or admin access is required';
  end if;

  select * into v_game
  from public.games game
  where game.id = p_game_id
    and game.sport_id = p_sport_id
  for update;
  if not found then raise exception '% game not found', initcap(p_sport_id); end if;

  if jsonb_typeof(p_event_revisions) <> 'array'
     or length(coalesce(p_stream_fingerprint, '')) = 0
     or jsonb_typeof(p_canonical_snapshot) <> 'object' then
    raise exception 'Canonical publication payload is invalid';
  end if;

  select * into v_publication
  from public.game_event_canonical_publications publication
  where publication.game_id = p_game_id
    and publication.sport_id = p_sport_id
    and publication.invalidated_at is null;
  if v_game.status = 'final' then
    if v_publication.id is not null
       and v_publication.primary_recorded_by = p_primary_recorded_by
       and v_publication.event_revisions is not distinct from p_event_revisions
       and v_publication.stream_fingerprint = p_stream_fingerprint
       and v_publication.canonical_snapshot is not distinct from p_canonical_snapshot then
      return jsonb_build_object(
        'publication_id', v_publication.id,
        'publication_number', v_publication.publication_number,
        'primary_recorded_by', v_publication.primary_recorded_by,
        'finalized_at', v_publication.finalized_at
      );
    end if;
    raise exception '% game is already finalized', initcap(p_sport_id);
  end if;

  v_effective_primary := public.effective_event_primary_recorder(
    p_sport_id,
    p_game_id
  );
  if v_effective_primary is null
     or v_effective_primary is distinct from p_primary_recorded_by then
    raise exception 'Primary recorder changed; refresh finalization readiness';
  end if;
  if not public.is_event_checkpoint_current(
    p_sport_id,
    p_game_id,
    p_primary_recorded_by
  ) then
    raise exception 'Primary recorder checkpoint is not current';
  end if;

  select * into v_checkpoint
  from public.game_event_stream_checkpoints checkpoint
  where checkpoint.game_id = p_game_id
    and checkpoint.recorded_by = p_primary_recorded_by
  for update;
  if not found
     or v_checkpoint.event_revisions is distinct from p_event_revisions
     or v_checkpoint.stream_fingerprint <> p_stream_fingerprint then
    raise exception 'Primary recorder changed; reload before finalizing';
  end if;

  if p_canonical_snapshot->>'version' <> '2'
     or p_canonical_snapshot->>'sportId' <> p_sport_id
     or p_canonical_snapshot->>'gameId' <> p_game_id::text
     or p_canonical_snapshot->>'primaryRecorderId' <>
       p_primary_recorded_by::text
     or jsonb_typeof(p_canonical_snapshot->'eventStream') <> 'object'
     or (p_canonical_snapshot#>>'{eventStream,version}')::integer <>
       v_checkpoint.stream_version
     or jsonb_typeof(p_canonical_snapshot#>'{eventStream,events}') <> 'array'
     or jsonb_array_length(p_canonical_snapshot#>'{eventStream,events}') <>
       v_checkpoint.event_count
     or jsonb_typeof(p_canonical_snapshot->'sportGameState') <> 'object'
     or p_canonical_snapshot#>>'{sportGameState,sportId}' <> p_sport_id
     or p_canonical_snapshot#>'{sportGameState,projection}' is not null then
    raise exception 'Canonical % source payload is invalid', lower(p_sport_id);
  end if;

  if exists (
    select 1
    from jsonb_array_elements(
      p_canonical_snapshot#>'{eventStream,events}'
    ) event
    where event->>'recorderUserId' is distinct from p_primary_recorded_by::text
       or event->>'sportId' is distinct from p_sport_id
       or not exists (
         select 1
         from jsonb_array_elements(p_event_revisions) revision
         where revision->>'id' = event->>'id'
           and (revision->>'revision')::integer =
             (event->>'revision')::integer
       )
  ) then
    raise exception 'Canonical event stream does not match the primary checkpoint';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(
      p_canonical_snapshot#>'{eventStream,events}'
    ) event
    group by event->>'id'
    having count(*) > 1
  ) then
    raise exception 'Canonical event stream contains duplicate event ids';
  end if;
  if not exists (
    select 1
    from public.game_event_setup_snapshots setup
    where setup.game_id = p_game_id
      and setup.sport_id = p_sport_id
      and setup.setup_snapshot is not distinct from
        p_canonical_snapshot#>'{sportGameState,setup}'
  ) then
    raise exception 'Canonical setup does not match the cloud game';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(
      p_canonical_snapshot#>'{eventStream,events}'
    ) canonical_event
    left join public.game_events stored_event
      on stored_event.id = (canonical_event->>'id')::uuid
      and stored_event.game_id = p_game_id
      and stored_event.recorded_by = p_primary_recorded_by
      and stored_event.sport_id = p_sport_id
    where stored_event.id is null
      or stored_event.sport_id is distinct from canonical_event->>'sportId'
      or stored_event.event_type is distinct from canonical_event->>'eventType'
      or stored_event.schema_version is distinct from
        (canonical_event->>'schemaVersion')::integer
      or stored_event.stream_sequence is distinct from
        (canonical_event->>'sequence')::bigint
      or stored_event.revision is distinct from
        (canonical_event->>'revision')::integer
      or stored_event.period_id is distinct from
        canonical_event#>>'{period,id}'
      or stored_event.period_order is distinct from
        (canonical_event#>>'{period,order}')::integer
      or stored_event.elapsed_ms is distinct from
        nullif(canonical_event->>'elapsedMs', '')::bigint
      or stored_event.occurred_at is distinct from
        (canonical_event->>'occurredAt')::timestamptz
      or stored_event.team_side is distinct from canonical_event->>'teamSide'
      or stored_event.location is distinct from
        nullif(canonical_event->'location', 'null'::jsonb)
      or stored_event.actors is distinct from (
        select coalesce(
          jsonb_agg(
            case
              when actor.value->>'kind' = 'player' then
                jsonb_set(
                  actor.value,
                  '{playerId}',
                  coalesce(to_jsonb(participant.id::text), 'null'::jsonb)
                )
              else actor.value
            end
            order by actor.ordinality
          ),
          '[]'::jsonb
        )
        from jsonb_array_elements(canonical_event->'actors')
          with ordinality actor(value, ordinality)
        left join public.game_participants participant
          on participant.game_id = p_game_id
          and participant.client_player_id = actor.value->>'playerId'
      )
      or stored_event.payload is distinct from canonical_event->'payload'
      or stored_event.event_created_at is distinct from
        (canonical_event->>'createdAt')::timestamptz
      or stored_event.event_updated_at is distinct from
        (canonical_event->>'updatedAt')::timestamptz
      or stored_event.deleted_at is distinct from
        nullif(canonical_event->>'deletedAt', '')::timestamptz
  ) then
    raise exception 'Canonical event content does not match the primary cloud stream';
  end if;

  if p_sport_id = 'soccer' then
    select policy.tracked_score, policy.opponent_score
    into v_tracked_score, v_opponent_score
    from public.validate_soccer_finalization_policy(
      p_game_id,
      p_primary_recorded_by
    ) policy;
  elsif p_sport_id = 'basketball' then
    select policy.tracked_score, policy.opponent_score
    into v_tracked_score, v_opponent_score
    from public.validate_basketball_finalization_policy(
      p_game_id,
      p_primary_recorded_by
    ) policy;
  else
    raise exception 'Trusted finalization policy is unavailable for %', p_sport_id;
  end if;

  insert into public.game_event_primary_recorders (
    game_id, recorded_by, selected_by, selected_at, selection_source,
    locked_at, locked_by
  ) values (
    p_game_id, p_primary_recorded_by, v_user_id, v_finalized_at,
    'selected', v_finalized_at, v_user_id
  )
  on conflict (game_id) do update set
    recorded_by = excluded.recorded_by,
    selection_source = 'selected',
    locked_at = excluded.locked_at,
    locked_by = excluded.locked_by
  where public.game_event_primary_recorders.recorded_by = excluded.recorded_by
    and public.game_event_primary_recorders.locked_at is null;
  if not found then raise exception 'Primary recorder could not be locked'; end if;

  select coalesce(max(publication.publication_number), 0) + 1
  into v_publication_number
  from public.game_event_canonical_publications publication
  where publication.game_id = p_game_id;

  insert into public.game_event_canonical_publications (
    game_id, publication_number, sport_id, primary_recorded_by,
    stream_version, event_count, max_sequence, event_revisions,
    stream_fingerprint, canonical_snapshot, snapshot_fingerprint,
    finalized_by, finalized_at
  ) values (
    p_game_id, v_publication_number, p_sport_id, p_primary_recorded_by,
    v_checkpoint.stream_version, v_checkpoint.event_count,
    v_checkpoint.max_sequence, v_checkpoint.event_revisions,
    v_checkpoint.stream_fingerprint, p_canonical_snapshot,
    md5(p_canonical_snapshot::text), v_user_id, v_finalized_at
  )
  returning * into v_publication;

  update public.games set
    status = 'final',
    home_team_score = v_tracked_score,
    opponent_score = v_opponent_score,
    home_score_adjustment = 0
  where id = p_game_id;

  perform public.record_access_audit_event(
    p_sport_id || '_game_finalized',
    v_user_id,
    p_primary_recorded_by,
    v_game.team_id,
    null,
    p_game_id,
    jsonb_build_object(
      'publication_id', v_publication.id,
      'publication_number', v_publication.publication_number
    )
  );

  return jsonb_build_object(
    'publication_id', v_publication.id,
    'publication_number', v_publication.publication_number,
    'primary_recorded_by', v_publication.primary_recorded_by,
    'finalized_at', v_publication.finalized_at
  );
end;
$$;

create or replace function public.finalize_basketball_event_game(
  p_game_id uuid,
  p_primary_recorded_by uuid,
  p_event_revisions jsonb,
  p_stream_fingerprint text,
  p_canonical_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if jsonb_typeof(p_canonical_snapshot) is distinct from 'object'
     or p_canonical_snapshot->>'canonicalSchemaVersion' is distinct from '1' then
    raise exception 'Unsupported Basketball canonical payload schema version';
  end if;

  return public.finalize_event_game(
    'basketball',
    p_game_id,
    p_primary_recorded_by,
    p_event_revisions,
    p_stream_fingerprint,
    p_canonical_snapshot
  );
end;
$$;

revoke all on function public.finalize_event_game(
  text, uuid, uuid, jsonb, text, jsonb
) from public;
revoke all on function public.finalize_basketball_event_game(
  uuid, uuid, jsonb, text, jsonb
) from public;
grant execute on function public.finalize_basketball_event_game(
  uuid, uuid, jsonb, text, jsonb
) to authenticated;

comment on function public.finalize_event_game(text, uuid, uuid, jsonb, text, jsonb) is
  'Private sport-neutral transactional canonical finalization with trusted sport policy dispatch.';
comment on function public.finalize_basketball_event_game(uuid, uuid, jsonb, text, jsonb) is
  'Basketball schema-version-1 canonical finalization wrapper.';
