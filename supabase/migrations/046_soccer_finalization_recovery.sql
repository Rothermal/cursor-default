-- SOC-5D: transactional soccer finalization, canonical publication, and audited reopen.

create table public.game_event_canonical_publications (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  publication_number integer not null check (publication_number >= 1),
  sport_id text not null check (sport_id = 'soccer'),
  primary_recorded_by uuid not null references public.profiles (id),
  stream_version integer not null check (stream_version >= 1),
  event_count integer not null check (event_count >= 0),
  max_sequence bigint not null check (max_sequence >= -1),
  event_revisions jsonb not null check (jsonb_typeof(event_revisions) = 'array'),
  stream_fingerprint text not null check (length(stream_fingerprint) > 0),
  canonical_snapshot jsonb not null check (jsonb_typeof(canonical_snapshot) = 'object'),
  snapshot_fingerprint text not null check (length(snapshot_fingerprint) > 0),
  finalized_by uuid not null references public.profiles (id),
  finalized_at timestamptz not null default now(),
  invalidated_by uuid references public.profiles (id),
  invalidated_at timestamptz,
  invalidation_reason text,
  unique (game_id, publication_number),
  check (
    (invalidated_by is null and invalidated_at is null and invalidation_reason is null)
    or (
      invalidated_by is not null
      and invalidated_at is not null
      and length(trim(invalidation_reason)) > 0
    )
  ),
  foreign key (game_id, primary_recorded_by)
    references public.game_event_stream_checkpoints (game_id, recorded_by)
);

create unique index idx_game_event_canonical_publication_active
  on public.game_event_canonical_publications (game_id)
  where invalidated_at is null;
create index idx_game_event_canonical_publication_history
  on public.game_event_canonical_publications (game_id, publication_number desc);

alter table public.game_event_canonical_publications enable row level security;
create policy "event_canonical_publications_select_game"
  on public.game_event_canonical_publications
  for select using (public.can_read_game(game_id));
revoke all on table public.game_event_canonical_publications from anon, authenticated;
grant select on table public.game_event_canonical_publications to authenticated;

create or replace function public.can_manage_soccer_game(p_game_id uuid)
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
      and g.sport_id = 'soccer'
      and (
        (g.cloud_scope = 'personal' and g.created_by = (select auth.uid()))
        or (
          g.team_id is not null
          and public.current_team_role(g.team_id) in ('owner', 'admin')
        )
      )
  );
$$;

create or replace function public.can_upload_final_soccer_audit(
  p_game_id uuid,
  p_recorded_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.games g
    join public.game_event_canonical_publications publication
      on publication.game_id = g.id and publication.invalidated_at is null
    where g.id = p_game_id
      and g.status = 'final'
      and g.sport_id = 'soccer'
      and p_recorded_by = (select auth.uid())
      and p_recorded_by <> publication.primary_recorded_by
      and g.team_id is not null
      and public.can_track_team_games(g.team_id)
  );
$$;

create or replace function public.get_soccer_finalization_readiness(p_game_id uuid)
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
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.can_read_game(p_game_id) then raise exception 'Game is unavailable'; end if;

  select * into v_game
  from public.games g
  where g.id = p_game_id and g.sport_id = 'soccer';
  if not found then raise exception 'Soccer game not found'; end if;

  v_primary := public.effective_soccer_primary_recorder(p_game_id);
  v_can_manage := public.can_manage_soccer_game(p_game_id);
  select * into v_publication
  from public.game_event_canonical_publications publication
  where publication.game_id = p_game_id and publication.invalidated_at is null;

  return query
  select
    v_game.status,
    v_can_manage and v_game.status <> 'final',
    v_can_manage and v_game.status = 'final' and v_publication.id is not null,
    v_primary,
    case when v_primary is null then null
      else coalesce(nullif(trim(profile.display_name), ''), 'StatKeeper user')
    end::text,
    coalesce((
      select
        event.event_type = 'soccer.match_ended'
        and event.payload->>'reason' in ('completed', 'abandoned')
      from public.game_events event
      where event.game_id = p_game_id
        and event.recorded_by = v_primary
        and event.deleted_at is null
        and event.event_type in ('soccer.match_ended', 'soccer.match_reopened')
      order by event.stream_sequence desc, event.id desc
      limit 1
    ), false),
    case when v_primary is null then false
      else public.is_game_event_checkpoint_current(p_game_id, v_primary)
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
          not public.is_game_event_checkpoint_current(
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

create or replace function public.get_soccer_canonical_publication(p_game_id uuid)
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
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not public.can_read_game(p_game_id) then raise exception 'Game is unavailable'; end if;

  return query
  select
    publication.id,
    publication.publication_number,
    publication.primary_recorded_by,
    coalesce(nullif(trim(primary_profile.display_name), ''), 'StatKeeper user')::text,
    publication.canonical_snapshot,
    publication.snapshot_fingerprint,
    publication.finalized_by,
    coalesce(nullif(trim(actor_profile.display_name), ''), 'StatKeeper user')::text,
    publication.finalized_at
  from public.game_event_canonical_publications publication
  left join public.profiles primary_profile
    on primary_profile.id = publication.primary_recorded_by
  left join public.profiles actor_profile
    on actor_profile.id = publication.finalized_by
  where publication.game_id = p_game_id
    and publication.invalidated_at is null
  limit 1;
end;
$$;

create or replace function public.finalize_soccer_event_game(
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
  v_terminal_event_type text;
  v_end_reason text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.can_manage_soccer_game(p_game_id) then
    raise exception 'Team owner or admin access is required';
  end if;

  select * into v_game
  from public.games g
  where g.id = p_game_id and g.sport_id = 'soccer'
  for update;
  if not found then raise exception 'Soccer game not found'; end if;

  if jsonb_typeof(p_event_revisions) <> 'array'
     or length(coalesce(p_stream_fingerprint, '')) = 0
     or jsonb_typeof(p_canonical_snapshot) <> 'object' then
    raise exception 'Canonical publication payload is invalid';
  end if;

  select * into v_publication
  from public.game_event_canonical_publications publication
  where publication.game_id = p_game_id and publication.invalidated_at is null;
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
    raise exception 'Soccer game is already finalized';
  end if;

  v_effective_primary := public.effective_soccer_primary_recorder(p_game_id);
  if v_effective_primary is null
     or v_effective_primary is distinct from p_primary_recorded_by then
    raise exception 'Primary recorder changed; refresh finalization readiness';
  end if;
  if not public.is_game_event_checkpoint_current(p_game_id, p_primary_recorded_by) then
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
     or p_canonical_snapshot->>'sportId' <> 'soccer'
     or p_canonical_snapshot->>'gameId' <> p_game_id::text
     or p_canonical_snapshot->>'primaryRecorderId' <> p_primary_recorded_by::text
     or jsonb_typeof(p_canonical_snapshot->'eventStream') <> 'object'
     or (p_canonical_snapshot#>>'{eventStream,version}')::integer
          <> v_checkpoint.stream_version
     or jsonb_typeof(p_canonical_snapshot#>'{eventStream,events}') <> 'array'
     or jsonb_array_length(p_canonical_snapshot#>'{eventStream,events}')
          <> v_checkpoint.event_count
     or jsonb_typeof(p_canonical_snapshot->'sportGameState') <> 'object'
     or p_canonical_snapshot#>>'{sportGameState,sportId}' <> 'soccer'
     or p_canonical_snapshot#>'{sportGameState,projection}' is not null then
    raise exception 'Canonical soccer source payload is invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_canonical_snapshot#>'{eventStream,events}') event
    where event->>'recorderUserId' is distinct from p_primary_recorded_by::text
       or not exists (
         select 1
         from jsonb_array_elements(p_event_revisions) revision
         where revision->>'id' = event->>'id'
           and (revision->>'revision')::integer = (event->>'revision')::integer
       )
  ) then
    raise exception 'Canonical event stream does not match the primary checkpoint';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_canonical_snapshot#>'{eventStream,events}') event
    group by event->>'id'
    having count(*) > 1
  ) then
    raise exception 'Canonical event stream contains duplicate event ids';
  end if;
  if not exists (
    select 1
    from public.game_event_setup_snapshots setup
    where setup.game_id = p_game_id
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

  select event.event_type, event.payload->>'reason'
  into v_terminal_event_type, v_end_reason
  from public.game_events event
  where event.game_id = p_game_id
    and event.recorded_by = p_primary_recorded_by
    and event.deleted_at is null
    and event.event_type in ('soccer.match_ended', 'soccer.match_reopened')
  order by event.stream_sequence desc, event.id desc
  limit 1;
  if not found
     or v_terminal_event_type <> 'soccer.match_ended'
     or v_end_reason not in ('completed', 'abandoned') then
    raise exception 'Primary cloud events do not end in a final soccer outcome';
  end if;

  begin
    select
      coalesce(sum(case
        when event.team_side = 'tracked'
          and event.event_type = 'soccer.shot'
          and event.payload->>'outcome' = 'goal' then 1
        when event.team_side = 'tracked'
          and event.event_type = 'soccer.own_goal' then 1
        when event.team_side = 'tracked'
          and event.event_type = 'soccer.score_adjustment'
          then (event.payload->>'delta')::integer
        else 0
      end), 0)::integer,
      coalesce(sum(case
        when event.team_side = 'opponent'
          and event.event_type = 'soccer.shot'
          and event.payload->>'outcome' = 'goal' then 1
        when event.team_side = 'opponent'
          and event.event_type = 'soccer.own_goal' then 1
        when event.team_side = 'opponent'
          and event.event_type = 'soccer.score_adjustment'
          then (event.payload->>'delta')::integer
        else 0
      end), 0)::integer
    into v_tracked_score, v_opponent_score
    from public.game_events event
    where event.game_id = p_game_id
      and event.recorded_by = p_primary_recorded_by
      and event.deleted_at is null;
  exception when others then
    raise exception 'Primary cloud events contain invalid soccer scoring data';
  end;
  if v_tracked_score is null
     or v_opponent_score is null
     or v_tracked_score < 0
     or v_opponent_score < 0 then
    raise exception 'Canonical soccer scores are invalid';
  end if;

  insert into public.game_event_primary_recorders (
    game_id, recorded_by, selected_by, selected_at, selection_source, locked_at, locked_by
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
    p_game_id, v_publication_number, 'soccer', p_primary_recorded_by,
    v_checkpoint.stream_version, v_checkpoint.event_count, v_checkpoint.max_sequence,
    v_checkpoint.event_revisions, v_checkpoint.stream_fingerprint,
    p_canonical_snapshot, md5(p_canonical_snapshot::text),
    v_user_id, v_finalized_at
  )
  returning * into v_publication;

  update public.games set
    status = 'final',
    home_team_score = v_tracked_score,
    opponent_score = v_opponent_score,
    home_score_adjustment = 0
  where id = p_game_id;

  perform public.record_access_audit_event(
    'soccer_game_finalized',
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

create or replace function public.reopen_soccer_event_game(
  p_game_id uuid,
  p_reason text
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
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if length(v_reason) < 3 then raise exception 'A reopen reason is required'; end if;
  if not public.can_manage_soccer_game(p_game_id) then
    raise exception 'Team owner or admin access is required';
  end if;

  select * into v_game
  from public.games g
  where g.id = p_game_id and g.sport_id = 'soccer'
  for update;
  if not found then raise exception 'Soccer game not found'; end if;
  if v_game.status <> 'final' then raise exception 'Soccer game is not finalized'; end if;

  select * into v_publication
  from public.game_event_canonical_publications publication
  where publication.game_id = p_game_id and publication.invalidated_at is null
  for update;
  if not found then raise exception 'Canonical publication is unavailable'; end if;

  update public.game_event_canonical_publications set
    invalidated_by = v_user_id,
    invalidated_at = v_reopened_at,
    invalidation_reason = v_reason
  where id = v_publication.id;

  update public.game_event_primary_recorders set
    locked_at = null,
    locked_by = null
  where game_id = p_game_id
    and recorded_by = v_publication.primary_recorded_by;

  update public.games set
    status = 'in_progress',
    home_team_score = null,
    opponent_score = 0,
    home_score_adjustment = 0
  where id = p_game_id;

  perform public.record_access_audit_event(
    'soccer_game_reopened',
    v_user_id,
    v_publication.primary_recorded_by,
    v_game.team_id,
    null,
    p_game_id,
    jsonb_build_object(
      'publication_id', v_publication.id,
      'publication_number', v_publication.publication_number,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'game_id', p_game_id,
    'publication_id', v_publication.id,
    'reopened_at', v_reopened_at
  );
end;
$$;

-- The game trigger recognizes only publication-backed soccer finalization and
-- invalidation-backed soccer reopen. Other sports keep the existing immutable-final rule.
create or replace function public.enforce_game_identity_and_final_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'final' then
      if not (
        old.sport_id = 'soccer'
        and new.status = 'in_progress'
        and not exists (
          select 1
          from public.game_event_canonical_publications publication
          where publication.game_id = old.id and publication.invalidated_at is null
        )
      ) then
        raise exception 'Final games are immutable; use correction/admin actions';
      end if;
    end if;
    if old.sport_id = 'soccer'
       and old.status <> 'final'
       and new.status = 'final'
       and not exists (
         select 1
         from public.game_event_canonical_publications publication
         where publication.game_id = old.id and publication.invalidated_at is null
       ) then
      raise exception 'Soccer games must use canonical finalization';
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

-- Existing non-final bindings keep SOC-5C behavior. A finalized team game accepts
-- only missing participant identities needed by a queued non-primary audit stream.
create or replace function public.bind_soccer_event_game_v4(
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
  v_game public.games%rowtype;
  v_item jsonb;
  v_source_player_id uuid;
  v_participant_map jsonb;
  v_participants jsonb;
  v_binding jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_existing_game_id is null then
    v_binding := public.bind_soccer_event_game_v3(
      null, p_client_local_game_id, p_source_team_id, p_source_season_id,
      p_team_name, p_opponent_name, p_competition_name, p_game_date,
      p_participants, p_setup_snapshot
    );
    return v_binding || jsonb_build_object('game_status', 'in_progress');
  end if;

  select * into v_game
  from public.games g
  where g.id = p_existing_game_id and g.sport_id = 'soccer'
  for share;
  if not found then raise exception 'Soccer game is unavailable'; end if;
  if v_game.status <> 'final' then
    v_binding := public.bind_soccer_event_game_v3(
      p_existing_game_id, p_client_local_game_id, p_source_team_id, p_source_season_id,
      p_team_name, p_opponent_name, p_competition_name, p_game_date,
      p_participants, p_setup_snapshot
    );
    return v_binding || jsonb_build_object('game_status', v_game.status);
  end if;

  if not public.can_upload_final_soccer_audit(v_game.id, v_user_id) then
    raise exception 'Finalized primary streams cannot accept event writes';
  end if;
  if v_game.team_id is distinct from p_source_team_id
     or v_game.season_id is distinct from p_source_season_id then
    raise exception 'Finalized soccer game binding is incompatible';
  end if;
  if jsonb_typeof(p_participants) <> 'array' then
    raise exception 'Participants must be an array';
  end if;
  if not exists (
    select 1
    from public.game_event_setup_snapshots setup
    where setup.game_id = v_game.id
      and setup.setup_snapshot is not distinct from p_setup_snapshot
  ) then
    raise exception 'Soccer setup snapshot is incompatible';
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
      where participant.game_id = v_game.id
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
      v_game.id,
      trim(v_item->>'client_participant_id'),
      nullif(trim(coalesce(v_item->>'client_player_id', '')), ''),
      v_source_player_id,
      v_item->>'kind',
      trim(v_item->>'display_name'),
      nullif(trim(coalesce(v_item->>'jersey_number', '')), ''),
      coalesce(v_item->'snapshot', '{}'::jsonb)
    )
    on conflict (game_id, client_participant_id) do nothing;
  end loop;

  select coalesce(
    jsonb_object_agg(participant.client_player_id, participant.id::text),
    '{}'::jsonb
  )
  into v_participant_map
  from public.game_participants participant
  where participant.game_id = v_game.id and participant.client_player_id is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', participant.id,
    'client_participant_id', participant.client_participant_id,
    'client_player_id', participant.client_player_id,
    'display_name', participant.display_name,
    'jersey_number', participant.jersey_number
  ) order by participant.created_at, participant.id), '[]'::jsonb)
  into v_participants
  from public.game_participants participant
  where participant.game_id = v_game.id;

  return jsonb_build_object(
    'game_id', v_game.id,
    'game_status', v_game.status,
    'participant_id_map', v_participant_map,
    'participants', v_participants
  );
end;
$$;

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
  v_finalized_at timestamptz;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  perform 1 from public.games game where game.id = p_game_id for share;
  if not found then raise exception 'Game not found'; end if;
  if not public.can_track_game(p_game_id) then
    if not public.can_upload_final_soccer_audit(p_game_id, v_user_id) then
      raise exception 'Not authorized to track this game';
    end if;
    select publication.finalized_at into v_finalized_at
    from public.game_event_canonical_publications publication
    where publication.game_id = p_game_id and publication.invalidated_at is null;
    -- Offline events have client-authored occurrence timestamps, so these checks preserve
    -- queue intent rather than prove pre-final authorship. stored_at records actual receipt;
    -- late non-primary rows remain audit-only and never enter the canonical publication.
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
  select * into v_existing from public.game_events event where event.id = p_id;
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
  perform 1 from public.games game where game.id = p_game_id for share;
  if not found then raise exception 'Game not found'; end if;
  if not public.can_track_game(p_game_id)
     and not public.can_upload_final_soccer_audit(p_game_id, v_user_id) then
    raise exception 'Not authorized to resolve this game';
  end if;
  if jsonb_typeof(p_local_event) <> 'object'
     or jsonb_typeof(p_remote_event) <> 'object'
     or p_local_event->>'id' is distinct from p_event_id::text
     or p_remote_event->>'id' is distinct from p_event_id::text then
    raise exception 'Conflict event snapshots are invalid';
  end if;

  select event.revision into v_remote_revision
  from public.game_events event
  where event.id = p_event_id
    and event.game_id = p_game_id
    and event.recorded_by = v_user_id;
  if not found or v_remote_revision is distinct from
      (p_remote_event->>'revision')::integer then
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
    select conflict.id into v_conflict_id
    from public.game_event_conflicts conflict
    where conflict.game_id = p_game_id
      and conflict.recorded_by = v_user_id
      and conflict.event_id = p_event_id
      and conflict.status = 'open';
  end if;
  return v_conflict_id;
end;
$$;

create or replace function public.get_soccer_primary_conflicts_for_finalization(
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
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_primary uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not public.can_manage_soccer_game(p_game_id) then
    raise exception 'Team owner or admin access is required';
  end if;
  v_primary := public.effective_soccer_primary_recorder(p_game_id);
  return query
  select
    conflict.id,
    conflict.recorded_by,
    coalesce(nullif(trim(profile.display_name), ''), 'StatKeeper user')::text,
    conflict.event_id,
    conflict.local_event,
    conflict.remote_event,
    conflict.detected_at
  from public.game_event_conflicts conflict
  left join public.profiles profile on profile.id = conflict.recorded_by
  where conflict.game_id = p_game_id
    and conflict.recorded_by = v_primary
    and conflict.status = 'open'
  order by conflict.detected_at, conflict.id;
end;
$$;

create or replace function public.resolve_soccer_primary_conflict_for_finalization(
  p_conflict_id uuid,
  p_resolution text
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_conflict public.game_event_conflicts%rowtype;
  v_game public.games%rowtype;
  v_event public.game_events%rowtype;
  v_selected jsonb;
  v_actors jsonb;
  v_next_revision integer;
  v_resolved_at timestamptz := now();
  v_resolved_event jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_resolution not in ('local', 'remote') then
    raise exception 'Conflict resolution is invalid';
  end if;

  select * into v_conflict
  from public.game_event_conflicts conflict
  where conflict.id = p_conflict_id and conflict.status = 'open'
  for update;
  if not found then raise exception 'Conflict was not found'; end if;
  if not public.can_manage_soccer_game(v_conflict.game_id) then
    raise exception 'Team owner or admin access is required';
  end if;

  select * into v_game
  from public.games game
  where game.id = v_conflict.game_id
    and game.sport_id = 'soccer'
    and game.status <> 'final'
  for share;
  if not found then raise exception 'Soccer game is unavailable for conflict resolution'; end if;
  if v_conflict.recorded_by is distinct from
      public.effective_soccer_primary_recorder(v_conflict.game_id) then
    raise exception 'Conflict no longer belongs to the primary recorder';
  end if;

  select * into v_event
  from public.game_events event
  where event.id = v_conflict.event_id
    and event.game_id = v_conflict.game_id
    and event.recorded_by = v_conflict.recorded_by
  for update;
  if not found then raise exception 'Primary conflict event is unavailable'; end if;

  v_selected := case
    when p_resolution = 'local' then v_conflict.local_event
    else v_conflict.remote_event
  end;
  if jsonb_typeof(v_selected) <> 'object'
     or v_selected->>'id' is distinct from v_event.id::text
     or v_selected->>'sportId' is distinct from v_event.sport_id
     or v_selected->>'eventType' is distinct from v_event.event_type
     or (v_selected->>'sequence')::bigint is distinct from v_event.stream_sequence
     or (v_selected->>'createdAt')::timestamptz is distinct from v_event.event_created_at
     or jsonb_typeof(v_selected->'actors') <> 'array'
     or jsonb_typeof(v_selected->'payload') <> 'object' then
    raise exception 'Conflict event identity is invalid';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_selected->'actors') actor
    where actor->>'kind' = 'player'
      and not exists (
        select 1
        from public.game_participants participant
        where participant.game_id = v_conflict.game_id
          and (
            participant.client_player_id = actor->>'playerId'
            or participant.id::text = actor->>'playerId'
          )
      )
  ) then
    raise exception 'Conflict event contains an unmapped player actor';
  end if;

  select coalesce(jsonb_agg(
    case
      when actor.value->>'kind' = 'player' then
        jsonb_set(
          actor.value,
          '{playerId}',
          to_jsonb((
            select participant.id::text
            from public.game_participants participant
            where participant.game_id = v_conflict.game_id
              and (
                participant.client_player_id = actor.value->>'playerId'
                or participant.id::text = actor.value->>'playerId'
              )
            limit 1
          ))
        )
      else actor.value
    end
    order by actor.ordinality
  ), '[]'::jsonb)
  into v_actors
  from jsonb_array_elements(v_selected->'actors') with ordinality actor(value, ordinality);

  v_next_revision := greatest(
    v_event.revision,
    coalesce((v_conflict.local_event->>'revision')::integer, 0),
    coalesce((v_conflict.remote_event->>'revision')::integer, 0)
  ) + 1;
  v_resolved_event := v_selected || jsonb_build_object(
    'recorderUserId', v_conflict.recorded_by,
    'revision', v_next_revision,
    'updatedAt', v_resolved_at
  );

  update public.game_events set
    schema_version = (v_selected->>'schemaVersion')::integer,
    revision = v_next_revision,
    period_id = v_selected#>>'{period,id}',
    period_order = (v_selected#>>'{period,order}')::integer,
    elapsed_ms = nullif(v_selected->>'elapsedMs', '')::bigint,
    occurred_at = (v_selected->>'occurredAt')::timestamptz,
    team_side = v_selected->>'teamSide',
    location = nullif(v_selected->'location', 'null'::jsonb),
    actors = v_actors,
    payload = v_selected->'payload',
    event_updated_at = v_resolved_at,
    deleted_at = nullif(v_selected->>'deletedAt', '')::timestamptz,
    stored_at = v_resolved_at
  where id = v_event.id;

  update public.game_event_conflicts set
    status = 'resolved',
    resolution = p_resolution,
    resolved_event = v_resolved_event,
    resolved_at = v_resolved_at,
    resolved_by = v_user_id
  where id = v_conflict.id;

  perform public.record_access_audit_event(
    'soccer_primary_conflict_resolved',
    v_user_id,
    v_conflict.recorded_by,
    v_game.team_id,
    null,
    v_game.id,
    jsonb_build_object(
      'conflict_id', v_conflict.id,
      'event_id', v_conflict.event_id,
      'resolution', p_resolution
    )
  );
  return v_resolved_at;
end;
$$;

create or replace function public.confirm_soccer_primary_checkpoint_for_finalization(
  p_game_id uuid,
  p_primary_recorded_by uuid,
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
  v_synced_at timestamptz := now();
  v_cloud_count integer;
  v_cloud_max_sequence bigint;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not public.can_manage_soccer_game(p_game_id) then
    raise exception 'Team owner or admin access is required';
  end if;
  perform 1
  from public.games game
  where game.id = p_game_id
    and game.sport_id = 'soccer'
    and game.status <> 'final'
  for share;
  if not found then
    raise exception 'Soccer game is unavailable for checkpoint confirmation';
  end if;
  if p_primary_recorded_by is distinct from
      public.effective_soccer_primary_recorder(p_game_id) then
    raise exception 'Primary recorder changed';
  end if;
  if exists (
    select 1
    from public.game_event_conflicts conflict
    where conflict.game_id = p_game_id
      and conflict.recorded_by = p_primary_recorded_by
      and conflict.status = 'open'
  ) then
    raise exception 'Primary recorder conflicts must be resolved first';
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
    and event.recorded_by = p_primary_recorded_by;
  if v_cloud_count <> p_event_count or v_cloud_max_sequence <> p_max_sequence then
    raise exception 'Cloud event stream does not match checkpoint count or sequence';
  end if;
  if exists (
    select 1
    from public.game_events event
    where event.game_id = p_game_id
      and event.recorded_by = p_primary_recorded_by
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
    p_game_id, p_primary_recorded_by, p_stream_version, p_event_count,
    p_max_sequence, p_event_revisions, p_stream_fingerprint, v_synced_at
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
  perform 1 from public.games game where game.id = p_game_id for share;
  if not found then raise exception 'Game not found'; end if;
  if not public.can_track_game(p_game_id)
     and not public.can_upload_final_soccer_audit(p_game_id, v_user_id) then
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
  where event.game_id = p_game_id and event.recorded_by = v_user_id;
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

revoke all on function public.can_manage_soccer_game(uuid) from public;
revoke all on function public.can_upload_final_soccer_audit(uuid, uuid) from public;
revoke all on function public.get_soccer_finalization_readiness(uuid) from public;
revoke all on function public.get_soccer_canonical_publication(uuid) from public;
revoke all on function public.finalize_soccer_event_game(
  uuid, uuid, jsonb, text, jsonb
) from public;
revoke all on function public.reopen_soccer_event_game(uuid, text) from public;
revoke all on function public.bind_soccer_event_game_v4(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) from public;
revoke all on function public.get_soccer_primary_conflicts_for_finalization(uuid)
  from public;
revoke all on function public.resolve_soccer_primary_conflict_for_finalization(
  uuid, text
) from public;
revoke all on function public.confirm_soccer_primary_checkpoint_for_finalization(
  uuid, uuid, integer, jsonb, integer, bigint, text
) from public;
revoke all on function public.upsert_game_event_revisioned(
  uuid, uuid, text, text, integer, bigint, integer, text, integer, bigint,
  timestamptz, text, jsonb, jsonb, jsonb, timestamptz, timestamptz, timestamptz
) from public;
revoke all on function public.record_game_event_conflict(
  uuid, uuid, jsonb, jsonb
) from public;
revoke all on function public.confirm_game_event_stream_checkpoint(
  uuid, integer, jsonb, integer, bigint, text
) from public;

grant execute on function public.get_soccer_finalization_readiness(uuid) to authenticated;
grant execute on function public.get_soccer_canonical_publication(uuid) to authenticated;
grant execute on function public.finalize_soccer_event_game(
  uuid, uuid, jsonb, text, jsonb
) to authenticated;
grant execute on function public.reopen_soccer_event_game(uuid, text) to authenticated;
grant execute on function public.bind_soccer_event_game_v4(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) to authenticated;
grant execute on function public.get_soccer_primary_conflicts_for_finalization(uuid)
  to authenticated;
grant execute on function public.resolve_soccer_primary_conflict_for_finalization(
  uuid, text
) to authenticated;
grant execute on function public.confirm_soccer_primary_checkpoint_for_finalization(
  uuid, uuid, integer, jsonb, integer, bigint, text
) to authenticated;
grant execute on function public.upsert_game_event_revisioned(
  uuid, uuid, text, text, integer, bigint, integer, text, integer, bigint,
  timestamptz, text, jsonb, jsonb, jsonb, timestamptz, timestamptz, timestamptz
) to authenticated;
grant execute on function public.record_game_event_conflict(
  uuid, uuid, jsonb, jsonb
) to authenticated;
grant execute on function public.confirm_game_event_stream_checkpoint(
  uuid, integer, jsonb, integer, bigint, text
) to authenticated;

comment on table public.game_event_canonical_publications is
  'Append-only soccer canonical publications; reopen invalidates but never deletes history.';
