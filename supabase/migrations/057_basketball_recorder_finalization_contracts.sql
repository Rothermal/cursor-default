-- BKE-4C1: Basketball recorder/readiness wrappers and trusted finalization policy.

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
    select
      event.event_type = 'basketball.match_ended'
      and event.payload->>'reason' in ('completed', 'abandoned')
    from public.game_events event
    where event.game_id = p_game_id
      and event.recorded_by = p_recorded_by
      and event.sport_id = 'basketball'
      and event.deleted_at is null
      and event.event_type in (
        'basketball.match_ended',
        'basketball.match_reopened'
      )
    order by event.stream_sequence desc, event.id desc
    limit 1
  ), false);
$$;

-- Retain the migration-055 return contract while installing Basketball terminal dispatch.
create or replace function public.get_event_finalization_readiness(
  p_sport_id text,
  p_game_id uuid
)
returns table (
  game_status text,
  can_finalize boolean,
  can_reopen boolean,
  primary_recorded_by uuid,
  primary_display_name text,
  primary_ended boolean,
  primary_checkpoint_current boolean,
  primary_conflict_count integer,
  primary_locked boolean,
  active_publication_id uuid,
  finalized_at timestamptz,
  non_primary_attention_count integer
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
  v_publication public.game_event_canonical_publications%rowtype;
  v_can_manage boolean;
  v_primary_ended boolean;
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

  v_primary := public.effective_event_primary_recorder(p_sport_id, p_game_id);
  v_can_manage := public.can_manage_event_game(p_sport_id, p_game_id);
  if p_sport_id = 'soccer' then
    v_primary_ended := public.is_soccer_primary_stream_ended(
      p_game_id,
      v_primary
    );
  elsif p_sport_id = 'basketball' then
    v_primary_ended := public.is_basketball_primary_stream_ended(
      p_game_id,
      v_primary
    );
  else
    v_primary_ended := false;
  end if;

  select * into v_publication
  from public.game_event_canonical_publications publication
  where publication.game_id = p_game_id
    and publication.sport_id = p_sport_id
    and publication.invalidated_at is null;

  return query
  select
    v_game.status,
    v_can_manage and v_game.status <> 'final',
    v_can_manage and v_game.status = 'final' and v_publication.id is not null,
    v_primary,
    case when v_primary is null then null
      else coalesce(nullif(trim(profile.display_name), ''), 'StatKeeper user')
    end::text,
    v_primary_ended,
    case when v_primary is null then false
      else public.is_event_checkpoint_current(
        p_sport_id,
        p_game_id,
        v_primary
      )
    end,
    (
      select count(*)::integer
      from public.game_event_conflicts conflict
      where conflict.game_id = p_game_id
        and conflict.recorded_by = v_primary
        and conflict.status = 'open'
    ),
    coalesce(primary_row.locked_at is not null, false),
    v_publication.id,
    v_publication.finalized_at,
    (
      select count(*)::integer
      from (
        select event.recorded_by
        from public.game_events event
        where event.game_id = p_game_id
          and event.sport_id = p_sport_id
        union
        select checkpoint.recorded_by
        from public.game_event_stream_checkpoints checkpoint
        where checkpoint.game_id = p_game_id
        union
        select conflict.recorded_by
        from public.game_event_conflicts conflict
        where conflict.game_id = p_game_id
      ) recorder
      where recorder.recorded_by is distinct from v_primary
        and (
          not public.is_event_checkpoint_current(
            p_sport_id,
            p_game_id,
            recorder.recorded_by
          )
          or exists (
            select 1
            from public.game_event_conflicts conflict
            where conflict.game_id = p_game_id
              and conflict.recorded_by = recorder.recorded_by
              and conflict.status = 'open'
          )
        )
    )
  from (select 1) seed
  left join public.profiles profile on profile.id = v_primary
  left join public.game_event_primary_recorders primary_row
    on primary_row.game_id = p_game_id;
end;
$$;

create or replace function public.get_basketball_game_recorders(p_game_id uuid)
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
  v_can_manage boolean := public.can_manage_event_game('basketball', p_game_id);
begin
  return query
  select
    recorder.recorder_user_id,
    recorder.display_name,
    case when v_can_manage then recorder.event_count else null::integer end,
    case when v_can_manage then recorder.checkpoint_event_count else null::integer end,
    case when v_can_manage then recorder.checkpoint_synced_at else null::timestamptz end,
    recorder.checkpoint_current,
    case when v_can_manage then recorder.unresolved_conflict_count else null::integer end,
    recorder.is_primary,
    recorder.primary_source,
    recorder.can_select_primary
  from public.get_event_game_recorders('basketball', p_game_id) recorder;
end;
$$;

create or replace function public.get_basketball_primary_recorder_history(
  p_game_id uuid
)
returns table (
  id uuid,
  previous_recorded_by uuid,
  previous_display_name text,
  recorded_by uuid,
  display_name text,
  changed_by uuid,
  changed_by_display_name text,
  changed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_manage_event_game('basketball', p_game_id) then
    raise exception 'Team owner or admin access is required';
  end if;

  return query
  select history.*
  from public.get_event_primary_recorder_history(
    'basketball',
    p_game_id
  ) history;
end;
$$;

create or replace function public.set_basketball_primary_recorder(
  p_game_id uuid,
  p_recorded_by uuid
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.set_event_primary_recorder(
    'basketball',
    p_game_id,
    p_recorded_by
  );
$$;

create or replace function public.get_basketball_finalization_readiness(
  p_game_id uuid
)
returns table (
  game_status text,
  can_finalize boolean,
  can_reopen boolean,
  primary_recorded_by uuid,
  primary_display_name text,
  primary_ended boolean,
  primary_checkpoint_current boolean,
  primary_conflict_count integer,
  primary_locked boolean,
  active_publication_id uuid,
  finalized_at timestamptz,
  non_primary_attention_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.get_event_finalization_readiness(
    'basketball',
    p_game_id
  );
$$;

create or replace function public.get_basketball_canonical_publication(
  p_game_id uuid
)
returns table (
  publication_id uuid,
  publication_number integer,
  primary_recorded_by uuid,
  primary_display_name text,
  canonical_snapshot jsonb,
  snapshot_fingerprint text,
  finalized_by uuid,
  finalized_by_display_name text,
  finalized_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.get_event_canonical_publication(
    'basketball',
    p_game_id
  );
$$;

create or replace function public.get_basketball_primary_conflicts_for_finalization(
  p_game_id uuid
)
returns table (
  conflict_id uuid,
  recorded_by uuid,
  recorder_display_name text,
  event_id uuid,
  local_event jsonb,
  remote_event jsonb,
  detected_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.get_event_primary_conflicts_for_finalization(
    'basketball',
    p_game_id
  );
$$;

create or replace function public.resolve_basketball_primary_conflict_for_finalization(
  p_conflict_id uuid,
  p_resolution text
)
returns timestamptz
language sql
security definer
set search_path = public
as $$
  select public.resolve_event_primary_conflict_for_finalization(
    'basketball',
    p_conflict_id,
    p_resolution
  );
$$;

create or replace function public.confirm_basketball_primary_checkpoint_for_finalization(
  p_game_id uuid,
  p_primary_recorded_by uuid,
  p_stream_version integer,
  p_event_revisions jsonb,
  p_event_count integer,
  p_max_sequence bigint,
  p_stream_fingerprint text
)
returns timestamptz
language sql
security definer
set search_path = public
as $$
  select public.confirm_event_primary_checkpoint_for_finalization(
    'basketball',
    p_game_id,
    p_primary_recorded_by,
    p_stream_version,
    p_event_revisions,
    p_event_count,
    p_max_sequence,
    p_stream_fingerprint
  );
$$;

create or replace function public.validate_basketball_finalization_policy(
  p_game_id uuid,
  p_primary_recorded_by uuid
)
returns table (
  tracked_score integer,
  opponent_score integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_terminal_event_type text;
  v_end_reason text;
  v_terminal_schema_version integer;
  v_terminal_team_side text;
  v_tracked_score bigint;
  v_opponent_score bigint;
begin
  select
    event.event_type,
    event.payload->>'reason',
    event.schema_version,
    event.team_side
  into
    v_terminal_event_type,
    v_end_reason,
    v_terminal_schema_version,
    v_terminal_team_side
  from public.game_events event
  where event.game_id = p_game_id
    and event.recorded_by = p_primary_recorded_by
    and event.sport_id = 'basketball'
    and event.deleted_at is null
    and event.event_type in (
      'basketball.match_ended',
      'basketball.match_reopened'
    )
  order by event.stream_sequence desc, event.id desc
  limit 1;

  if not found
     or v_terminal_event_type <> 'basketball.match_ended'
     or v_end_reason is null
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
        and event.event_type in (
          'basketball.shot',
          'basketball.score_adjustment'
        )
        and (
          event.schema_version <> 1
          or event.team_side not in ('tracked', 'opponent')
          or (
            event.event_type = 'basketball.shot'
            and (
              jsonb_typeof(event.payload->'made') is distinct from 'boolean'
              or jsonb_typeof(event.payload->'value') is distinct from 'number'
              or (event.payload->>'value')::numeric not in (1, 2, 3)
              or event.payload->>'attempt' is null
              or event.payload->>'attempt' not in ('field_goal', 'free_throw')
              or event.payload->>'valueSource' is null
              or event.payload->>'valueSource' not in (
                'court',
                'manual_override',
                'quick_entry',
                'free_throw'
              )
              or (
                event.payload->>'attempt' = 'free_throw'
                and (
                  (event.payload->>'value')::numeric <> 1
                  or event.payload->>'valueSource' <> 'free_throw'
                )
              )
              or (
                event.payload->>'attempt' = 'field_goal'
                and (
                  (event.payload->>'value')::numeric not in (2, 3)
                  or event.payload->>'valueSource' = 'free_throw'
                )
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
              or event.payload->>'reason' is null
              or event.payload->>'reason' not in (
                'scoreboard_control',
                'unattributed_score',
                'official_correction'
              )
            )
          )
        )
    ) then
      raise exception 'Primary cloud events contain invalid Basketball scoring data';
    end if;

    select
      coalesce(sum(case
        when event.team_side = 'tracked'
          and event.event_type = 'basketball.shot'
          and (event.payload->>'made')::boolean
          then (event.payload->>'value')::bigint
        when event.team_side = 'tracked'
          and event.event_type = 'basketball.score_adjustment'
          then (event.payload->>'delta')::bigint
        else 0
      end), 0)::bigint,
      coalesce(sum(case
        when event.team_side = 'opponent'
          and event.event_type = 'basketball.shot'
          and (event.payload->>'made')::boolean
          then (event.payload->>'value')::bigint
        when event.team_side = 'opponent'
          and event.event_type = 'basketball.score_adjustment'
          then (event.payload->>'delta')::bigint
        else 0
      end), 0)::bigint
    into v_tracked_score, v_opponent_score
    from public.game_events event
    where event.game_id = p_game_id
      and event.recorded_by = p_primary_recorded_by
      and event.sport_id = 'basketball'
      and event.deleted_at is null;
  exception when others then
    raise exception 'Primary cloud events contain invalid Basketball scoring data';
  end;

  if v_tracked_score < 0
     or v_opponent_score < 0
     or v_tracked_score > 2147483647
     or v_opponent_score > 2147483647 then
    raise exception 'Canonical Basketball scores are invalid';
  end if;
  if v_end_reason = 'completed' and v_tracked_score = v_opponent_score then
    raise exception 'A tied Basketball game requires another overtime';
  end if;

  return query select v_tracked_score::integer, v_opponent_score::integer;
end;
$$;

-- Reassert private shared/policy functions after replacement and addition.
revoke all on function public.is_basketball_primary_stream_ended(uuid, uuid) from public;
revoke all on function public.get_event_finalization_readiness(text, uuid) from public;
revoke all on function public.validate_basketball_finalization_policy(uuid, uuid) from public;

revoke all on function public.get_basketball_game_recorders(uuid) from public;
grant execute on function public.get_basketball_game_recorders(uuid) to authenticated;
revoke all on function public.get_basketball_primary_recorder_history(uuid) from public;
grant execute on function public.get_basketball_primary_recorder_history(uuid) to authenticated;
revoke all on function public.set_basketball_primary_recorder(uuid, uuid) from public;
grant execute on function public.set_basketball_primary_recorder(uuid, uuid) to authenticated;
revoke all on function public.get_basketball_finalization_readiness(uuid) from public;
grant execute on function public.get_basketball_finalization_readiness(uuid) to authenticated;
revoke all on function public.get_basketball_canonical_publication(uuid) from public;
grant execute on function public.get_basketball_canonical_publication(uuid) to authenticated;
revoke all on function public.get_basketball_primary_conflicts_for_finalization(uuid)
  from public;
grant execute on function public.get_basketball_primary_conflicts_for_finalization(uuid)
  to authenticated;
revoke all on function public.resolve_basketball_primary_conflict_for_finalization(
  uuid, text
) from public;
grant execute on function public.resolve_basketball_primary_conflict_for_finalization(
  uuid, text
) to authenticated;
revoke all on function public.confirm_basketball_primary_checkpoint_for_finalization(
  uuid, uuid, integer, jsonb, integer, bigint, text
) from public;
grant execute on function public.confirm_basketball_primary_checkpoint_for_finalization(
  uuid, uuid, integer, jsonb, integer, bigint, text
) to authenticated;

comment on function public.validate_basketball_finalization_policy(uuid, uuid) is
  'Private Basketball terminal and score policy used by canonical finalization.';
comment on function public.get_basketball_game_recorders(uuid) is
  'Basketball recorder presence with manager-only detail columns.';
