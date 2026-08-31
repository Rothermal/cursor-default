-- BKE-6D4: anchored Basketball finalization readiness and mode-aware reopen.

alter table public.game_event_canonical_publications
  add column if not exists invalidation_mode text;

alter table public.game_event_canonical_publications
  drop constraint if exists game_event_canonical_publications_invalidation_mode_check;

alter table public.game_event_canonical_publications
  add constraint game_event_canonical_publications_invalidation_mode_check
  check (invalidation_mode is null or invalidation_mode in ('correct_records', 'resume_game'));

create or replace function public._basketball_anchored_finalization_blockers_v1(
  p_game_id uuid,
  p_primary_recorded_by uuid
)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_setup jsonb;
  v_rules jsonb;
  v_blockers text[] := array[]::text[];
  v_terminal_type text;
  v_terminal_payload jsonb;
  v_terminal_sequence bigint;
  v_end_reason text;
  v_last_start bigint;
  v_last_pause bigint;
  v_current_tracked_lineup jsonb;
  v_tracked_score bigint;
  v_opponent_score bigint;
begin
  select setup.setup_snapshot into v_setup
  from public.game_event_setup_snapshots setup
  where setup.game_id = p_game_id
    and setup.sport_id = 'basketball';

  v_rules := v_setup->'rulesSnapshot';
  if v_setup is null
     or v_setup->>'version' is distinct from '2'
     or jsonb_typeof(v_rules) is distinct from 'object'
     or v_rules->>'version' is distinct from '3'
     or v_rules->>'clockModel' is distinct from 'anchored'
     or jsonb_typeof(v_rules->'regulationSegments') is distinct from 'array'
     or jsonb_typeof(v_setup#>'{openingLineups,tracked,participantIds}') is distinct from 'array'
     or jsonb_array_length(v_setup#>'{openingLineups,tracked,participantIds}') = 0 then
    return array['source_invalid']::text[];
  end if;

  if exists (
    select 1
    from public.game_events event
    where event.game_id = p_game_id
      and event.recorded_by = p_primary_recorded_by
      and event.sport_id = 'basketball'
      and event.deleted_at is null
      and event.event_type in (
        'basketball.period_started', 'basketball.period_ended',
        'basketball.match_ended', 'basketball.match_reopened',
        'basketball.clock_started', 'basketball.clock_paused',
        'basketball.clock_adjusted', 'basketball.lineup_confirmed',
        'basketball.substitution', 'basketball.equal_play_override'
      )
      and (
        event.schema_version <> 1
        or event.elapsed_ms is null
        or event.elapsed_ms < 0
        or event.team_side not in ('tracked', 'opponent', 'neutral')
        or jsonb_typeof(event.payload) is distinct from 'object'
      )
  ) then
    v_blockers := array_append(v_blockers, 'source_invalid');
  end if;

  select event.event_type, event.payload, event.stream_sequence
  into v_terminal_type, v_terminal_payload, v_terminal_sequence
  from public.game_events event
  where event.game_id = p_game_id
    and event.recorded_by = p_primary_recorded_by
    and event.sport_id = 'basketball'
    and event.deleted_at is null
    and event.event_type in ('basketball.match_ended', 'basketball.match_reopened')
  order by event.stream_sequence desc, event.id desc
  limit 1;

  if v_terminal_type = 'basketball.match_ended' then
    v_end_reason := v_terminal_payload->>'reason';
  elsif v_terminal_type = 'basketball.match_reopened'
        and v_terminal_payload->>'mode' = 'correct_records' then
    select event.payload->>'reason' into v_end_reason
    from public.game_events event
    where event.game_id = p_game_id
      and event.recorded_by = p_primary_recorded_by
      and event.sport_id = 'basketball'
      and event.deleted_at is null
      and event.event_type = 'basketball.match_ended'
      and event.stream_sequence < v_terminal_sequence
    order by event.stream_sequence desc, event.id desc
    limit 1;
  end if;

  if v_end_reason is null or v_end_reason not in ('completed', 'abandoned') then
    v_blockers := array_append(v_blockers, 'terminal_outcome_required');
  end if;

  if v_end_reason = 'completed' and exists (
    select 1
    from (
      select segment->>'id' as period_id
      from jsonb_array_elements(v_rules->'regulationSegments') segment
      union
      select event.payload->>'periodId'
      from public.game_events event
      where event.game_id = p_game_id
        and event.recorded_by = p_primary_recorded_by
        and event.sport_id = 'basketball'
        and event.deleted_at is null
        and event.event_type = 'basketball.period_started'
    ) expected
    where nullif(trim(expected.period_id), '') is null
       or not exists (
         select 1
         from public.game_events ended
         where ended.game_id = p_game_id
           and ended.recorded_by = p_primary_recorded_by
           and ended.sport_id = 'basketball'
           and ended.deleted_at is null
           and ended.event_type = 'basketball.period_ended'
           and ended.payload->>'periodId' = expected.period_id
       )
  ) then
    v_blockers := array_append(v_blockers, 'periods_incomplete');
  end if;

  select max(event.stream_sequence) filter (
    where event.event_type = 'basketball.clock_started'
  ), max(event.stream_sequence) filter (
    where event.event_type = 'basketball.clock_paused'
  ) into v_last_start, v_last_pause
  from public.game_events event
  where event.game_id = p_game_id
    and event.recorded_by = p_primary_recorded_by
    and event.sport_id = 'basketball'
    and event.deleted_at is null;

  if v_last_start is not null and (v_last_pause is null or v_last_start > v_last_pause) then
    v_blockers := array_append(v_blockers, 'clock_not_paused');
    v_blockers := array_append(v_blockers, 'clock_anchor_unsafe');
  end if;

  if exists (
    select 1
    from public.game_events event
    where event.game_id = p_game_id
      and event.recorded_by = p_primary_recorded_by
      and event.sport_id = 'basketball'
      and event.deleted_at is null
      and (
        (event.event_type = 'basketball.clock_started' and (
          jsonb_typeof(event.payload->'anchorElapsedMs') is distinct from 'number'
          or (event.payload->>'anchorElapsedMs')::numeric <> event.elapsed_ms
        ))
        or (event.event_type = 'basketball.clock_paused' and (
          jsonb_typeof(event.payload->'elapsedMs') is distinct from 'number'
          or (event.payload->>'elapsedMs')::numeric <> event.elapsed_ms
        ))
        or (event.event_type = 'basketball.clock_adjusted' and (
          jsonb_typeof(event.payload->'toElapsedMs') is distinct from 'number'
          or (event.payload->>'toElapsedMs')::numeric <> event.elapsed_ms
        ))
      )
  ) and not ('clock_anchor_unsafe' = any(v_blockers)) then
    v_blockers := array_append(v_blockers, 'clock_anchor_unsafe');
  end if;

  if exists (
    select 1 from public.game_events recovery
    where recovery.game_id = p_game_id
      and recovery.recorded_by = p_primary_recorded_by
      and recovery.sport_id = 'basketball'
      and recovery.deleted_at is null
      and recovery.event_type = 'basketball.substitution'
      and recovery.team_side = 'tracked'
      and recovery.payload->>'mode' = 'current_lineup_recovery'
  ) then
    v_blockers := array_append(v_blockers, 'tracked_lineup_incomplete');
  end if;

  select event.payload->'participantIds' into v_current_tracked_lineup
  from public.game_events event
  where event.game_id = p_game_id
    and event.recorded_by = p_primary_recorded_by
    and event.sport_id = 'basketball'
    and event.deleted_at is null
    and event.team_side = 'tracked'
    and event.event_type in ('basketball.substitution', 'basketball.lineup_confirmed')
  order by event.stream_sequence desc, event.id desc
  limit 1;
  v_current_tracked_lineup := coalesce(
    v_current_tracked_lineup,
    v_setup#>'{openingLineups,tracked,participantIds}'
  );

  if exists (
    select 1 from jsonb_array_elements_text(v_current_tracked_lineup) participant(participant_id)
    where exists (
      select 1 from public.game_events ejection
      cross join lateral jsonb_array_elements(ejection.actors) actor
      where ejection.game_id = p_game_id
        and ejection.recorded_by = p_primary_recorded_by
        and ejection.sport_id = 'basketball'
        and ejection.deleted_at is null
        and ejection.event_type = 'basketball.ejection'
        and ejection.team_side = 'tracked'
        and actor->>'role' = 'subject'
        and actor->>'kind' = 'player'
        and actor->>'participantId' = participant.participant_id
    ) or (
      select count(*)
      from public.game_events foul
      cross join lateral jsonb_array_elements(foul.actors) actor
      where foul.game_id = p_game_id
        and foul.recorded_by = p_primary_recorded_by
        and foul.sport_id = 'basketball'
        and foul.deleted_at is null
        and foul.event_type = 'basketball.foul'
        and foul.team_side = 'tracked'
        and actor->>'role' = 'committed_by'
        and actor->>'kind' = 'player'
        and actor->>'participantId' = participant.participant_id
      )
      >= (v_rules->>'personalFoulLimit')::integer
  ) then
    v_blockers := array_append(v_blockers, 'replacement_required');
  end if;

  if exists (
    select 1
    from public.game_events started
    where started.game_id = p_game_id
      and started.recorded_by = p_primary_recorded_by
      and started.sport_id = 'basketball'
      and started.deleted_at is null
      and started.event_type = 'basketball.period_started'
      and started.period_order > 1
      and not exists (
        select 1
        from public.game_events confirmation
        where confirmation.game_id = started.game_id
          and confirmation.recorded_by = started.recorded_by
          and confirmation.sport_id = 'basketball'
          and confirmation.deleted_at is null
          and confirmation.event_type = 'basketball.lineup_confirmed'
          and confirmation.team_side = 'tracked'
          and confirmation.payload->>'boundaryPeriodId' = started.payload->>'periodId'
      )
  ) then
    v_blockers := array_append(v_blockers, 'boundary_review_required');
  end if;

  if exists (
    select 1
    from public.game_events override_event
    where override_event.game_id = p_game_id
      and override_event.recorded_by = p_primary_recorded_by
      and override_event.sport_id = 'basketball'
      and override_event.deleted_at is null
      and override_event.event_type = 'basketball.equal_play_override'
      and not exists (
        select 1
        from public.game_events confirmation
        where confirmation.game_id = override_event.game_id
          and confirmation.recorded_by = override_event.recorded_by
          and confirmation.sport_id = 'basketball'
          and confirmation.deleted_at is null
          and confirmation.event_type = 'basketball.lineup_confirmed'
          and confirmation.payload->>'captureCommandId' =
            override_event.payload->>'captureCommandId'
      )
  ) then
    v_blockers := array_append(v_blockers, 'equal_play_override_incomplete');
  end if;

  begin
    select coalesce(sum(case
      when event.team_side = 'tracked'
        and event.event_type = 'basketball.shot'
        and (event.payload->>'made')::boolean
        then (event.payload->>'value')::bigint
      when event.team_side = 'tracked'
        and event.event_type = 'basketball.score_adjustment'
        then (event.payload->>'delta')::bigint
      else 0 end), 0)::bigint,
      coalesce(sum(case
      when event.team_side = 'opponent'
        and event.event_type = 'basketball.shot'
        and (event.payload->>'made')::boolean
        then (event.payload->>'value')::bigint
      when event.team_side = 'opponent'
        and event.event_type = 'basketball.score_adjustment'
        then (event.payload->>'delta')::bigint
      else 0 end), 0)::bigint
    into v_tracked_score, v_opponent_score
    from public.game_events event
    where event.game_id = p_game_id
      and event.recorded_by = p_primary_recorded_by
      and event.sport_id = 'basketball'
      and event.deleted_at is null;
    if v_end_reason = 'completed' and v_tracked_score = v_opponent_score then
      v_blockers := array_append(v_blockers, 'completed_game_tied');
    end if;
  exception when others then
    if not ('source_invalid' = any(v_blockers)) then
      v_blockers := array_append(v_blockers, 'source_invalid');
    end if;
  end;

  return v_blockers;
end;
$$;

-- Mode-aware correction reopen remains terminal for readiness while legacy mode-less reopen keeps
-- its prior resume semantics.
create or replace function public.is_basketball_primary_stream_ended(
  p_game_id uuid,
  p_recorded_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select event.event_type = 'basketball.match_ended'
      or (
        event.event_type = 'basketball.match_reopened'
        and event.payload->>'mode' = 'correct_records'
        and exists (
          select 1 from public.game_events ended
          where ended.game_id = p_game_id
            and ended.recorded_by = p_recorded_by
            and ended.sport_id = 'basketball'
            and ended.deleted_at is null
            and ended.event_type = 'basketball.match_ended'
            and ended.stream_sequence < event.stream_sequence
        )
      )
    from public.game_events event
    where event.game_id = p_game_id
      and event.recorded_by = p_recorded_by
      and event.sport_id = 'basketball'
      and event.deleted_at is null
      and event.event_type in ('basketball.match_ended', 'basketball.match_reopened')
    order by event.stream_sequence desc, event.id desc
    limit 1
  ), false);
$$;

create or replace function public.get_basketball_anchored_finalization_readiness_v1(
  p_game_id uuid,
  p_primary_recorded_by uuid
)
returns table (applicable boolean, blocker_codes text[])
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_setup jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not public.can_manage_event_game('basketball', p_game_id) then
    raise exception 'Team owner or admin access is required';
  end if;
  if public.effective_event_primary_recorder('basketball', p_game_id)
      is distinct from p_primary_recorded_by then
    raise exception 'Primary recorder changed; refresh finalization readiness';
  end if;

  select setup.setup_snapshot into v_setup
  from public.game_event_setup_snapshots setup
  where setup.game_id = p_game_id and setup.sport_id = 'basketball';

  return query select
    coalesce(
      v_setup->>'version' = '2'
      and v_setup#>>'{rulesSnapshot,version}' = '3'
      and v_setup#>>'{rulesSnapshot,clockModel}' = 'anchored',
      false
    ),
    public._basketball_anchored_finalization_blockers_v1(
      p_game_id,
      p_primary_recorded_by
    );
end;
$$;

create or replace function public.finalize_basketball_anchored_event_game_v1(
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
  v_blockers text[];
begin
  perform public.get_basketball_release_capabilities();
  perform public.get_basketball_clock_lineup_capabilities_v1();

  v_blockers := public._basketball_anchored_finalization_blockers_v1(
    p_game_id,
    p_primary_recorded_by
  );
  if cardinality(v_blockers) > 0 then
    raise exception 'BASKETBALL_ANCHORED_FINALIZATION_BLOCKED: %', array_to_string(v_blockers, ',');
  end if;
  if p_canonical_snapshot#>>'{sportGameState,setup,version}' is distinct from '2'
     or p_canonical_snapshot#>>'{sportGameState,setup,rulesSnapshot,version}' is distinct from '3'
     or p_canonical_snapshot#>>'{sportGameState,setup,rulesSnapshot,clockModel}'
       is distinct from 'anchored' then
    raise exception 'Anchored Basketball canonical setup is invalid';
  end if;

  return public.finalize_event_game(
    'basketball', p_game_id, p_primary_recorded_by, p_event_revisions,
    p_stream_fingerprint, p_canonical_snapshot
  );
end;
$$;

create or replace function public.reopen_basketball_anchored_event_game_v1(
  p_game_id uuid,
  p_reason text,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_game public.games%rowtype;
  v_publication public.game_event_canonical_publications%rowtype;
  v_reason text := trim(coalesce(p_reason, ''));
  v_reopened_at timestamptz := now();
  v_setup jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if length(v_reason) < 3 then raise exception 'A reopen reason is required'; end if;
  if p_mode not in ('correct_records', 'resume_game') then
    raise exception 'A valid anchored Basketball reopen mode is required';
  end if;
  perform public.get_basketball_release_capabilities();
  perform public.get_basketball_clock_lineup_capabilities_v1();
  if not public.can_manage_event_game('basketball', p_game_id) then
    raise exception 'Team owner or admin access is required';
  end if;

  select * into v_game from public.games game
  where game.id = p_game_id and game.sport_id = 'basketball'
  for update;
  if not found then raise exception 'Basketball game not found'; end if;
  if v_game.status <> 'final' then raise exception 'Basketball game is not finalized'; end if;

  select setup.setup_snapshot into v_setup
  from public.game_event_setup_snapshots setup
  where setup.game_id = p_game_id and setup.sport_id = 'basketball';
  if v_setup->>'version' is distinct from '2'
     or v_setup#>>'{rulesSnapshot,version}' is distinct from '3'
     or v_setup#>>'{rulesSnapshot,clockModel}' is distinct from 'anchored' then
    raise exception 'Anchored Basketball authority is required';
  end if;

  select * into v_publication
  from public.game_event_canonical_publications publication
  where publication.game_id = p_game_id
    and publication.sport_id = 'basketball'
    and publication.invalidated_at is null
  for update;
  if not found then raise exception 'Canonical publication is unavailable'; end if;

  update public.game_event_canonical_publications set
    invalidated_by = v_user_id,
    invalidated_at = v_reopened_at,
    invalidation_reason = v_reason,
    invalidation_mode = p_mode
  where id = v_publication.id;

  update public.game_event_primary_recorders set
    recorded_by = v_publication.primary_recorded_by,
    locked_at = null,
    locked_by = null
  where game_id = p_game_id;

  update public.games set
    status = 'in_progress', home_team_score = null,
    opponent_score = 0, home_score_adjustment = 0
  where id = p_game_id;

  perform public.record_access_audit_event(
    'basketball_game_reopened', v_user_id, v_publication.primary_recorded_by,
    v_game.team_id, null, p_game_id,
    jsonb_build_object(
      'publication_id', v_publication.id,
      'publication_number', v_publication.publication_number,
      'reason', v_reason,
      'mode', p_mode
    )
  );

  return jsonb_build_object(
    'game_id', p_game_id,
    'publication_id', v_publication.id,
    'primary_recorded_by', v_publication.primary_recorded_by,
    'reason', v_reason,
    'mode', p_mode,
    'reopened_at', v_reopened_at
  );
end;
$$;

create or replace function public.get_basketball_canonical_publication_history_v1(
  p_game_id uuid
)
returns table (
  publication_id uuid,
  publication_number integer,
  primary_recorded_by uuid,
  primary_display_name text,
  finalized_by uuid,
  finalized_by_display_name text,
  finalized_at timestamptz,
  invalidated_by uuid,
  invalidated_by_display_name text,
  invalidated_at timestamptz,
  invalidation_reason text,
  invalidation_mode text,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not public.can_manage_event_game('basketball', p_game_id) then
    raise exception 'Team owner or admin access is required';
  end if;

  return query
  select publication.id, publication.publication_number,
    publication.primary_recorded_by,
    coalesce(nullif(trim(primary_profile.display_name), ''), 'StatKeeper user')::text,
    publication.finalized_by,
    coalesce(nullif(trim(finalizer_profile.display_name), ''), 'StatKeeper user')::text,
    publication.finalized_at, publication.invalidated_by,
    case when publication.invalidated_by is null then null
      else coalesce(nullif(trim(invalidator_profile.display_name), ''), 'StatKeeper user')
    end::text,
    publication.invalidated_at, publication.invalidation_reason,
    publication.invalidation_mode, publication.invalidated_at is null
  from public.game_event_canonical_publications publication
  left join public.profiles primary_profile on primary_profile.id = publication.primary_recorded_by
  left join public.profiles finalizer_profile on finalizer_profile.id = publication.finalized_by
  left join public.profiles invalidator_profile on invalidator_profile.id = publication.invalidated_by
  where publication.game_id = p_game_id and publication.sport_id = 'basketball'
  order by publication.publication_number desc;
end;
$$;

create or replace function public.get_basketball_reopen_handoff_v1(p_game_id uuid)
returns table (
  publication_id uuid,
  primary_recorded_by uuid,
  reason text,
  mode text,
  reopened_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.can_read_game(p_game_id) then raise exception 'Game is unavailable'; end if;

  return query
  select publication.id, publication.primary_recorded_by,
    publication.invalidation_reason, publication.invalidation_mode,
    publication.invalidated_at
  from public.game_event_canonical_publications publication
  join public.games game on game.id = publication.game_id
  where publication.game_id = p_game_id
    and publication.sport_id = 'basketball'
    and game.status = 'in_progress'
    and publication.invalidated_at is not null
    and publication.invalidation_mode in ('correct_records', 'resume_game')
    and publication.primary_recorded_by = v_user_id
  order by publication.publication_number desc
  limit 1;
end;
$$;

-- Preserve the BKE-4C score policy while allowing an anchored correction reopen to retain the
-- preceding terminal outcome. A mode-less reopen and resume_game still require a new Match End.
create or replace function public.validate_basketball_finalization_policy(
  p_game_id uuid,
  p_primary_recorded_by uuid
)
returns table (tracked_score integer, opponent_score integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_terminal_event_type text;
  v_terminal_payload jsonb;
  v_terminal_sequence bigint;
  v_end_reason text;
  v_terminal_schema_version integer;
  v_terminal_team_side text;
  v_tracked_score bigint;
  v_opponent_score bigint;
begin
  select event.event_type, event.payload, event.stream_sequence,
    event.schema_version, event.team_side
  into v_terminal_event_type, v_terminal_payload, v_terminal_sequence,
    v_terminal_schema_version, v_terminal_team_side
  from public.game_events event
  where event.game_id = p_game_id
    and event.recorded_by = p_primary_recorded_by
    and event.sport_id = 'basketball'
    and event.deleted_at is null
    and event.event_type in ('basketball.match_ended', 'basketball.match_reopened')
  order by event.stream_sequence desc, event.id desc
  limit 1;

  if v_terminal_event_type = 'basketball.match_ended' then
    v_end_reason := v_terminal_payload->>'reason';
  elsif v_terminal_event_type = 'basketball.match_reopened'
        and v_terminal_payload->>'mode' = 'correct_records' then
    select event.payload->>'reason', event.schema_version, event.team_side
    into v_end_reason, v_terminal_schema_version, v_terminal_team_side
    from public.game_events event
    where event.game_id = p_game_id
      and event.recorded_by = p_primary_recorded_by
      and event.sport_id = 'basketball'
      and event.deleted_at is null
      and event.event_type = 'basketball.match_ended'
      and event.stream_sequence < v_terminal_sequence
    order by event.stream_sequence desc, event.id desc
    limit 1;
  end if;

  if v_end_reason is null
     or v_end_reason not in ('completed', 'abandoned')
     or v_terminal_schema_version <> 1
     or v_terminal_team_side <> 'neutral' then
    raise exception 'Primary cloud events do not end in a final Basketball outcome';
  end if;

  begin
    if exists (
      select 1
      from public.game_events event
      where event.game_id = p_game_id
        and event.recorded_by = p_primary_recorded_by
        and event.sport_id = 'basketball'
        and event.deleted_at is null
        and event.event_type in ('basketball.shot', 'basketball.score_adjustment')
        and (
          event.schema_version <> 1
          or event.team_side not in ('tracked', 'opponent')
          or (
            event.event_type = 'basketball.shot'
            and (
              jsonb_typeof(event.payload->'made') is distinct from 'boolean'
              or jsonb_typeof(event.payload->'value') is distinct from 'number'
              or (event.payload->>'value')::numeric not in (1, 2, 3)
              or event.payload->>'attempt' not in ('field_goal', 'free_throw')
              or event.payload->>'valueSource' not in (
                'court', 'manual_override', 'quick_entry', 'free_throw'
              )
              or (
                event.payload->>'attempt' = 'free_throw'
                and ((event.payload->>'value')::numeric <> 1
                  or event.payload->>'valueSource' <> 'free_throw')
              )
              or (
                event.payload->>'attempt' = 'field_goal'
                and ((event.payload->>'value')::numeric not in (2, 3)
                  or event.payload->>'valueSource' = 'free_throw')
              )
            )
          )
          or (
            event.event_type = 'basketball.score_adjustment'
            and (
              jsonb_typeof(event.payload->'delta') is distinct from 'number'
              or (event.payload->>'delta')::numeric < -2147483648
              or (event.payload->>'delta')::numeric > 2147483647
              or trunc((event.payload->>'delta')::numeric) <>
                (event.payload->>'delta')::numeric
              or (event.payload->>'delta')::numeric = 0
              or event.payload->>'reason' not in (
                'scoreboard_control', 'unattributed_score', 'official_correction'
              )
            )
          )
        )
    ) then
      raise exception 'Primary cloud events contain invalid Basketball scoring data';
    end if;

    select coalesce(sum(case
      when event.team_side = 'tracked'
        and event.event_type = 'basketball.shot'
        and (event.payload->>'made')::boolean
        then (event.payload->>'value')::bigint
      when event.team_side = 'tracked'
        and event.event_type = 'basketball.score_adjustment'
        then (event.payload->>'delta')::bigint
      else 0 end), 0)::bigint,
      coalesce(sum(case
      when event.team_side = 'opponent'
        and event.event_type = 'basketball.shot'
        and (event.payload->>'made')::boolean
        then (event.payload->>'value')::bigint
      when event.team_side = 'opponent'
        and event.event_type = 'basketball.score_adjustment'
        then (event.payload->>'delta')::bigint
      else 0 end), 0)::bigint
    into v_tracked_score, v_opponent_score
    from public.game_events event
    where event.game_id = p_game_id
      and event.recorded_by = p_primary_recorded_by
      and event.sport_id = 'basketball'
      and event.deleted_at is null;
  exception when others then
    raise exception 'Primary cloud events contain invalid Basketball scoring data';
  end;

  if v_tracked_score < 0 or v_opponent_score < 0
     or v_tracked_score > 2147483647 or v_opponent_score > 2147483647 then
    raise exception 'Canonical Basketball scores are invalid';
  end if;
  if v_end_reason = 'completed' and v_tracked_score = v_opponent_score then
    raise exception 'A tied Basketball game requires another overtime';
  end if;

  return query select v_tracked_score::integer, v_opponent_score::integer;
end;
$$;

revoke all on function public._basketball_anchored_finalization_blockers_v1(uuid, uuid) from public;
revoke all on function public.is_basketball_primary_stream_ended(uuid, uuid) from public;
revoke all on function public.validate_basketball_finalization_policy(uuid, uuid) from public;
revoke all on function public.get_basketball_anchored_finalization_readiness_v1(uuid, uuid) from public;
revoke all on function public.finalize_basketball_anchored_event_game_v1(uuid, uuid, jsonb, text, jsonb) from public;
revoke all on function public.reopen_basketball_anchored_event_game_v1(uuid, text, text) from public;
revoke all on function public.get_basketball_canonical_publication_history_v1(uuid) from public;
revoke all on function public.get_basketball_reopen_handoff_v1(uuid) from public;

grant execute on function public.get_basketball_anchored_finalization_readiness_v1(uuid, uuid) to authenticated;
grant execute on function public.finalize_basketball_anchored_event_game_v1(uuid, uuid, jsonb, text, jsonb) to authenticated;
grant execute on function public.reopen_basketball_anchored_event_game_v1(uuid, text, text) to authenticated;
grant execute on function public.get_basketball_canonical_publication_history_v1(uuid) to authenticated;
grant execute on function public.get_basketball_reopen_handoff_v1(uuid) to authenticated;

comment on function public.get_basketball_anchored_finalization_readiness_v1(uuid, uuid) is
  'Manager-only ordered blockers for exact setup-v2 anchored Basketball finalization.';
comment on function public.reopen_basketball_anchored_event_game_v1(uuid, text, text) is
  'Mode-aware anchored Basketball publication invalidation; recorder mutation remains a separate handoff.';

notify pgrst, 'reload schema';
