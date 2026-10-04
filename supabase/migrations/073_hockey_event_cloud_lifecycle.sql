-- HKY-5A: register Hockey on the shared event cloud platform, with a trusted Hockey score
-- policy and fixed Hockey wrappers. Baseball and Football stay off the platform until their
-- own cloud phases, and the aggregate-source guard (060) is not widened.

alter table public.game_event_canonical_publications
  validate constraint game_event_canonical_publications_sport_id_hockey_check;

alter table public.game_event_canonical_publications
  drop constraint game_event_canonical_publications_sport_id_check;

alter table public.game_event_canonical_publications
  rename constraint game_event_canonical_publications_sport_id_hockey_check
  to game_event_canonical_publications_sport_id_check;

comment on constraint game_event_canonical_publications_sport_id_check
  on public.game_event_canonical_publications is
  'Event-platform publication sport allow-list: Soccer, Basketball and Hockey.';

create or replace function public.is_event_platform_sport(p_sport_id text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_sport_id in ('soccer', 'basketball', 'hockey'), false);
$$;

-- Retain the migration-069 contract while admitting Hockey setup version 1. The server still
-- stores the snapshot without parsing it.
create or replace function public.bind_event_game_v2(
  p_sport_id text,
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
  v_participants jsonb;
  v_setup_written boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.is_event_platform_sport(p_sport_id) then
    raise exception 'Sport is not supported by the event platform';
  end if;
  if jsonb_typeof(p_setup_snapshot) <> 'object'
     or not (
       (p_sport_id = 'soccer' and p_setup_snapshot->>'version' in ('1', '2'))
       or (p_sport_id = 'basketball' and p_setup_snapshot->>'version' in ('1', '2'))
       or (p_sport_id = 'hockey' and p_setup_snapshot->>'version' = '1')
     ) then
    raise exception '% setup snapshot is invalid', initcap(p_sport_id);
  end if;

  if p_existing_game_id is not null then
    select game.client_local_game_id into v_bound_local_id
    from public.games game
    where game.id = p_existing_game_id
      and game.created_by = v_user_id
      and game.status <> 'final'
      and game.sport_id = p_sport_id
      and game.team_id is not distinct from p_source_team_id;
    if not found or v_bound_local_id is null then
      raise exception 'Existing % game binding is unavailable or incompatible',
        lower(p_sport_id);
    end if;
  else
    v_bound_local_id := p_client_local_game_id;
  end if;

  v_binding := public.bind_event_game(
    p_sport_id,
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

  if not exists (
    select 1
    from public.games game
    where game.id = v_game_id
      and game.sport_id = p_sport_id
  ) then
    raise exception 'Bound game sport is incompatible with the setup snapshot';
  end if;

  insert into public.game_event_setup_snapshots (
    game_id, sport_id, setup_snapshot, updated_by
  ) values (
    v_game_id, p_sport_id, p_setup_snapshot, v_user_id
  )
  on conflict (game_id) do update set
    updated_at = now(),
    updated_by = excluded.updated_by
  where game_event_setup_snapshots.sport_id = excluded.sport_id
    and game_event_setup_snapshots.setup_snapshot is not distinct from
      excluded.setup_snapshot
  returning true into v_setup_written;

  if not coalesce(v_setup_written, false) then
    raise exception '% setup snapshot cannot be replaced', initcap(p_sport_id);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', participant.id,
    'client_participant_id', participant.client_participant_id,
    'client_player_id', participant.client_player_id,
    'display_name', participant.display_name,
    'jersey_number', participant.jersey_number
  ) order by participant.created_at, participant.id), '[]'::jsonb)
  into v_participants
  from public.game_participants participant
  where participant.game_id = v_game_id;

  return v_binding || jsonb_build_object('participants', v_participants);
end;
$$;

-- Trusted Hockey policy. A stream is ended when its latest lifecycle boundary is an end (with or
-- without a reason) or an abandon; a suspended stream is not ended until it is reopened and ended.
create or replace function public.is_hockey_primary_stream_ended(
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
    select event.event_type in ('hockey.match_ended', 'hockey.match_abandoned')
    from public.game_events event
    where event.game_id = p_game_id
      and event.recorded_by = p_recorded_by
      and event.sport_id = 'hockey'
      and event.deleted_at is null
      and event.event_type in (
        'hockey.match_ended',
        'hockey.match_abandoned',
        'hockey.match_suspended',
        'hockey.match_reopened'
      )
    order by event.stream_sequence desc, event.id desc
    limit 1
  ), false);
$$;

-- Goals are shots with outcome goal plus score adjustments, per side. A decided shootout adds one
-- goal for its winner (the HKY-3C final score). The shootout is decided by the client rule in
-- refreshHockeyShootout: within the rules' rounds a side wins once the other side's remaining
-- attempts cannot catch up; in sudden death a side wins only after a complete round. Unequal
-- shootout goals alone never decide it, so an end or abandon before a decision publishes the
-- recorded score. Ties without a shootout are accepted: the tracker decides whether a game may
-- end tied.
create or replace function public.validate_hockey_finalization_policy(
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
  v_terminal_schema_version integer;
  v_terminal_team_side text;
  v_tracked_score bigint;
  v_opponent_score bigint;
  v_shootout_starts integer;
  v_rounds_value jsonb;
  v_rounds integer;
  v_taken_tracked integer;
  v_taken_opponent integer;
  v_goals_tracked integer;
  v_goals_opponent integer;
  v_shootout_winner text;
begin
  select event.event_type, event.schema_version, event.team_side
  into v_terminal_event_type, v_terminal_schema_version, v_terminal_team_side
  from public.game_events event
  where event.game_id = p_game_id
    and event.recorded_by = p_primary_recorded_by
    and event.sport_id = 'hockey'
    and event.deleted_at is null
    and event.event_type in (
      'hockey.match_ended',
      'hockey.match_abandoned',
      'hockey.match_suspended',
      'hockey.match_reopened'
    )
  order by event.stream_sequence desc, event.id desc
  limit 1;

  if not found
     or v_terminal_event_type not in ('hockey.match_ended', 'hockey.match_abandoned')
     or v_terminal_schema_version <> 1
     or v_terminal_team_side <> 'neutral' then
    raise exception 'Primary cloud events do not end in a final Hockey outcome';
  end if;

  begin
    if exists (
      select 1
      from public.game_events event
      where event.game_id = p_game_id
        and event.recorded_by = p_primary_recorded_by
        and event.sport_id = 'hockey'
        and event.deleted_at is null
        and event.event_type in (
          'hockey.shot',
          'hockey.score_adjustment',
          'hockey.shootout_started',
          'hockey.shootout_attempt'
        )
        and (
          event.schema_version <> 1
          or (
            event.event_type = 'hockey.shootout_started'
            and (
              event.team_side <> 'neutral'
              or event.payload->>'firstSide' is null
              or event.payload->>'firstSide' not in ('tracked', 'opponent')
            )
          )
          or (
            event.event_type <> 'hockey.shootout_started'
            and event.team_side not in ('tracked', 'opponent')
          )
          or (
            event.event_type = 'hockey.shot'
            and (
              jsonb_typeof(event.payload->'outcome') is distinct from 'string'
              or event.payload->>'outcome' not in ('goal', 'saved', 'missed', 'blocked')
            )
          )
          or (
            event.event_type = 'hockey.score_adjustment'
            and (
              jsonb_typeof(event.payload->'delta') is distinct from 'number'
              or (event.payload->>'delta')::numeric not in (1, -1)
            )
          )
          or (
            event.event_type = 'hockey.shootout_attempt'
            and (
              jsonb_typeof(event.payload->'outcome') is distinct from 'string'
              or event.payload->>'outcome' not in ('goal', 'saved', 'missed')
            )
          )
        )
    ) then
      raise exception 'Primary cloud events contain invalid Hockey scoring data';
    end if;

    select
      coalesce(sum(case
        when event.team_side = 'tracked'
          and event.event_type = 'hockey.shot'
          and event.payload->>'outcome' = 'goal' then 1
        when event.team_side = 'tracked'
          and event.event_type = 'hockey.score_adjustment'
          then (event.payload->>'delta')::bigint
        else 0
      end), 0)::bigint,
      coalesce(sum(case
        when event.team_side = 'opponent'
          and event.event_type = 'hockey.shot'
          and event.payload->>'outcome' = 'goal' then 1
        when event.team_side = 'opponent'
          and event.event_type = 'hockey.score_adjustment'
          then (event.payload->>'delta')::bigint
        else 0
      end), 0)::bigint,
      count(*) filter (where event.event_type = 'hockey.shootout_started')::integer,
      count(*) filter (
        where event.event_type = 'hockey.shootout_attempt'
          and event.team_side = 'tracked'
      )::integer,
      count(*) filter (
        where event.event_type = 'hockey.shootout_attempt'
          and event.team_side = 'opponent'
      )::integer,
      count(*) filter (
        where event.event_type = 'hockey.shootout_attempt'
          and event.team_side = 'tracked'
          and event.payload->>'outcome' = 'goal'
      )::integer,
      count(*) filter (
        where event.event_type = 'hockey.shootout_attempt'
          and event.team_side = 'opponent'
          and event.payload->>'outcome' = 'goal'
      )::integer
    into
      v_tracked_score,
      v_opponent_score,
      v_shootout_starts,
      v_taken_tracked,
      v_taken_opponent,
      v_goals_tracked,
      v_goals_opponent
    from public.game_events event
    where event.game_id = p_game_id
      and event.recorded_by = p_primary_recorded_by
      and event.sport_id = 'hockey'
      and event.deleted_at is null;
  exception when others then
    raise exception 'Primary cloud events contain invalid Hockey scoring data';
  end;

  if v_tracked_score < 0
     or v_opponent_score < 0
     or v_tracked_score >= 2147483647
     or v_opponent_score >= 2147483647 then
    raise exception 'Canonical Hockey scores are invalid';
  end if;

  -- Alternating attempts never differ by more than one per side, and attempts need a start.
  if v_shootout_starts > 1
     or (v_shootout_starts = 0 and v_taken_tracked + v_taken_opponent > 0)
     or abs(v_taken_tracked - v_taken_opponent) > 1 then
    raise exception 'Primary cloud events contain invalid Hockey shootout data';
  end if;

  if v_shootout_starts = 1 then
    select setup.setup_snapshot #> '{rulesSnapshot,shootout,rounds}'
    into v_rounds_value
    from public.game_event_setup_snapshots setup
    where setup.game_id = p_game_id
      and setup.sport_id = 'hockey';
    if v_rounds_value is null
       or jsonb_typeof(v_rounds_value) <> 'number'
       or v_rounds_value::text !~ '^[0-9]{1,2}$' then
      raise exception 'Hockey shootout rules are unavailable for finalization';
    end if;
    v_rounds := v_rounds_value::text::integer;
    if v_rounds not between 1 and 10 then
      raise exception 'Hockey shootout rules are unavailable for finalization';
    end if;

    v_shootout_winner := null;
    if v_taken_tracked <= v_rounds and v_taken_opponent <= v_rounds then
      if v_goals_tracked > v_goals_opponent + (v_rounds - v_taken_opponent) then
        v_shootout_winner := 'tracked';
      elsif v_goals_opponent > v_goals_tracked + (v_rounds - v_taken_tracked) then
        v_shootout_winner := 'opponent';
      end if;
    elsif v_taken_tracked = v_taken_opponent
       and v_goals_tracked <> v_goals_opponent then
      v_shootout_winner := case
        when v_goals_tracked > v_goals_opponent then 'tracked'
        else 'opponent'
      end;
    end if;

    if v_shootout_winner = 'tracked' then
      v_tracked_score := v_tracked_score + 1;
    elsif v_shootout_winner = 'opponent' then
      v_opponent_score := v_opponent_score + 1;
    end if;
  end if;

  return query select v_tracked_score::integer, v_opponent_score::integer;
end;
$$;

-- Retain the migration-057 return contract while installing Hockey terminal dispatch.
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
  elsif p_sport_id = 'hockey' then
    v_primary_ended := public.is_hockey_primary_stream_ended(
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

-- Retain the migration-058 contract while installing trusted Hockey policy dispatch.
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
  elsif p_sport_id = 'hockey' then
    select policy.tracked_score, policy.opponent_score
    into v_tracked_score, v_opponent_score
    from public.validate_hockey_finalization_policy(
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

-- Fixed Hockey wrappers over the private event-platform cores.

create or replace function public.bind_hockey_event_game_v5(
  p_existing_game_id uuid,
  p_client_local_game_id text,
  p_source_team_id uuid,
  p_source_season_id uuid,
  p_team_name text,
  p_opponent_name text,
  p_competition_name text,
  p_game_date date,
  p_participants jsonb,
  p_setup_snapshot jsonb,
  p_allow_deleted_source_players boolean
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.bind_event_game_v5(
    'hockey',
    p_existing_game_id,
    p_client_local_game_id,
    p_source_team_id,
    p_source_season_id,
    p_team_name,
    p_opponent_name,
    p_competition_name,
    p_game_date,
    p_participants,
    p_setup_snapshot,
    p_allow_deleted_source_players
  );
$$;

create or replace function public.get_hockey_game_recorders(p_game_id uuid)
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
  v_can_manage boolean := public.can_manage_event_game('hockey', p_game_id);
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
  from public.get_event_game_recorders('hockey', p_game_id) recorder;
end;
$$;

create or replace function public.get_hockey_primary_recorder_history(
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
  if not public.can_manage_event_game('hockey', p_game_id) then
    raise exception 'Team owner or admin access is required';
  end if;

  return query
  select history.*
  from public.get_event_primary_recorder_history(
    'hockey',
    p_game_id
  ) history;
end;
$$;

create or replace function public.set_hockey_primary_recorder(
  p_game_id uuid,
  p_recorded_by uuid
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.set_event_primary_recorder(
    'hockey',
    p_game_id,
    p_recorded_by
  );
$$;

create or replace function public.get_hockey_finalization_readiness(
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
    'hockey',
    p_game_id
  );
$$;

create or replace function public.get_hockey_canonical_publication(
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
    'hockey',
    p_game_id
  );
$$;

create or replace function public.get_hockey_primary_conflicts_for_finalization(
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
    'hockey',
    p_game_id
  );
$$;

create or replace function public.resolve_hockey_primary_conflict_for_finalization(
  p_conflict_id uuid,
  p_resolution text
)
returns timestamptz
language sql
security definer
set search_path = public
as $$
  select public.resolve_event_primary_conflict_for_finalization(
    'hockey',
    p_conflict_id,
    p_resolution
  );
$$;

create or replace function public.confirm_hockey_primary_checkpoint_for_finalization(
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
    'hockey',
    p_game_id,
    p_primary_recorded_by,
    p_stream_version,
    p_event_revisions,
    p_event_count,
    p_max_sequence,
    p_stream_fingerprint
  );
$$;

create or replace function public.finalize_hockey_event_game(
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
    raise exception 'Unsupported Hockey canonical payload schema version';
  end if;

  return public.finalize_event_game(
    'hockey',
    p_game_id,
    p_primary_recorded_by,
    p_event_revisions,
    p_stream_fingerprint,
    p_canonical_snapshot
  );
end;
$$;

create or replace function public.reopen_hockey_event_game(
  p_game_id uuid,
  p_reason text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.reopen_event_game('hockey', p_game_id, p_reason);
$$;

create or replace function public.get_hockey_canonical_publication_history(
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
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not public.can_manage_event_game('hockey', p_game_id) then
    raise exception 'Team owner or admin access is required';
  end if;
  if not exists (
    select 1
    from public.games game
    where game.id = p_game_id
      and game.sport_id = 'hockey'
  ) then
    raise exception 'Hockey game not found';
  end if;

  return query
  select
    publication.id,
    publication.publication_number,
    publication.primary_recorded_by,
    coalesce(nullif(trim(primary_profile.display_name), ''), 'StatKeeper user')::text,
    publication.finalized_by,
    coalesce(nullif(trim(finalizer_profile.display_name), ''), 'StatKeeper user')::text,
    publication.finalized_at,
    publication.invalidated_by,
    case when publication.invalidated_by is null then null
      else coalesce(nullif(trim(invalidator_profile.display_name), ''), 'StatKeeper user')
    end::text,
    publication.invalidated_at,
    publication.invalidation_reason,
    publication.invalidated_at is null
  from public.game_event_canonical_publications publication
  left join public.profiles primary_profile
    on primary_profile.id = publication.primary_recorded_by
  left join public.profiles finalizer_profile
    on finalizer_profile.id = publication.finalized_by
  left join public.profiles invalidator_profile
    on invalidator_profile.id = publication.invalidated_by
  where publication.game_id = p_game_id
    and publication.sport_id = 'hockey'
  order by publication.publication_number desc;
end;
$$;

-- Authenticated, read-only handshake for the complete HKY-5A contract. It adds no product data
-- and grants no operational authority.
create or replace function public.get_hockey_release_capabilities()
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
    not public.is_event_platform_sport('hockey')
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
      'public.bind_hockey_event_game_v5(uuid,text,uuid,uuid,text,text,text,date,jsonb,jsonb,boolean)'
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
    or to_regprocedure('public.get_hockey_game_recorders(uuid)') is null
    or to_regprocedure('public.get_hockey_primary_recorder_history(uuid)') is null
    or to_regprocedure('public.set_hockey_primary_recorder(uuid,uuid)') is null
    or to_regprocedure('public.get_hockey_finalization_readiness(uuid)') is null
    or to_regprocedure('public.get_hockey_canonical_publication(uuid)') is null
    or to_regprocedure(
      'public.get_hockey_primary_conflicts_for_finalization(uuid)'
    ) is null
    or to_regprocedure(
      'public.resolve_hockey_primary_conflict_for_finalization(uuid,text)'
    ) is null
    or to_regprocedure(
      'public.confirm_hockey_primary_checkpoint_for_finalization(uuid,uuid,integer,jsonb,integer,bigint,text)'
    ) is null
    or to_regprocedure(
      'public.finalize_hockey_event_game(uuid,uuid,jsonb,text,jsonb)'
    ) is null
    or to_regprocedure('public.reopen_hockey_event_game(uuid,text)') is null
    or to_regprocedure(
      'public.get_hockey_canonical_publication_history(uuid)'
    ) is null
  then
    return jsonb_build_object('contractVersion', 0);
  end if;

  return jsonb_build_object(
    'contractVersion', 1,
    'migration', 73,
    'eventTransportVersion', 4,
    'recoveryVersion', 1,
    'recorderResolutionVersion', 1,
    'canonicalFinalizationVersion', 1,
    'setupSnapshotVersion', 1
  );
end;
$$;

-- Reassert private shared/policy functions after replacement and addition.
revoke all on function public.is_event_platform_sport(text) from public;
revoke all on function public.bind_event_game_v2(
  text, uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) from public;
revoke all on function public.is_hockey_primary_stream_ended(uuid, uuid) from public;
revoke all on function public.validate_hockey_finalization_policy(uuid, uuid) from public;
revoke all on function public.get_event_finalization_readiness(text, uuid) from public;
revoke all on function public.finalize_event_game(
  text, uuid, uuid, jsonb, text, jsonb
) from public;

revoke all on function public.bind_hockey_event_game_v5(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb, boolean
) from public;
grant execute on function public.bind_hockey_event_game_v5(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb, boolean
) to authenticated;
revoke all on function public.get_hockey_game_recorders(uuid) from public;
grant execute on function public.get_hockey_game_recorders(uuid) to authenticated;
revoke all on function public.get_hockey_primary_recorder_history(uuid) from public;
grant execute on function public.get_hockey_primary_recorder_history(uuid) to authenticated;
revoke all on function public.set_hockey_primary_recorder(uuid, uuid) from public;
grant execute on function public.set_hockey_primary_recorder(uuid, uuid) to authenticated;
revoke all on function public.get_hockey_finalization_readiness(uuid) from public;
grant execute on function public.get_hockey_finalization_readiness(uuid) to authenticated;
revoke all on function public.get_hockey_canonical_publication(uuid) from public;
grant execute on function public.get_hockey_canonical_publication(uuid) to authenticated;
revoke all on function public.get_hockey_primary_conflicts_for_finalization(uuid)
  from public;
grant execute on function public.get_hockey_primary_conflicts_for_finalization(uuid)
  to authenticated;
revoke all on function public.resolve_hockey_primary_conflict_for_finalization(
  uuid, text
) from public;
grant execute on function public.resolve_hockey_primary_conflict_for_finalization(
  uuid, text
) to authenticated;
revoke all on function public.confirm_hockey_primary_checkpoint_for_finalization(
  uuid, uuid, integer, jsonb, integer, bigint, text
) from public;
grant execute on function public.confirm_hockey_primary_checkpoint_for_finalization(
  uuid, uuid, integer, jsonb, integer, bigint, text
) to authenticated;
revoke all on function public.finalize_hockey_event_game(
  uuid, uuid, jsonb, text, jsonb
) from public;
grant execute on function public.finalize_hockey_event_game(
  uuid, uuid, jsonb, text, jsonb
) to authenticated;
revoke all on function public.reopen_hockey_event_game(uuid, text) from public;
grant execute on function public.reopen_hockey_event_game(uuid, text) to authenticated;
revoke all on function public.get_hockey_canonical_publication_history(uuid) from public;
grant execute on function public.get_hockey_canonical_publication_history(uuid)
  to authenticated;
revoke all on function public.get_hockey_release_capabilities() from public;
grant execute on function public.get_hockey_release_capabilities() to authenticated;

comment on function public.is_event_platform_sport(text) is
  'Private allow-list predicate for sports supported by the shared event cloud platform.';
comment on function public.validate_hockey_finalization_policy(uuid, uuid) is
  'Private Hockey terminal and score policy used by canonical finalization.';
comment on function public.is_hockey_primary_stream_ended(uuid, uuid) is
  'Private Hockey terminal predicate: the latest lifecycle boundary is an end or an abandon.';
comment on function public.bind_hockey_event_game_v5(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb, boolean
) is 'Fixed Hockey binding with explicit deleted-source recovery.';
comment on function public.get_hockey_game_recorders(uuid) is
  'Hockey recorder presence with manager-only detail columns.';
comment on function public.finalize_hockey_event_game(uuid, uuid, jsonb, text, jsonb) is
  'Hockey schema-version-1 canonical finalization wrapper.';
comment on function public.reopen_hockey_event_game(uuid, text) is
  'Reason-required Hockey reopen wrapper preserving append-only canonical publication history.';
comment on function public.get_hockey_canonical_publication_history(uuid) is
  'Manager-only Hockey canonical publication and invalidation metadata in newest-first order.';
comment on function public.get_hockey_release_capabilities() is
  'Read-only exact-version preflight for the complete Hockey HKY-5A cloud contract.';

notify pgrst, 'reload schema';
