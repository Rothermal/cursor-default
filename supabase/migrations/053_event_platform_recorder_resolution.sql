-- BKE-4A3: sport-neutral recorder presence, primary resolution, and v3 binding.

create or replace function public.is_event_checkpoint_current(
  p_sport_id text,
  p_game_id uuid,
  p_recorded_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_event_platform_sport(p_sport_id) and exists (
    select 1
    from public.game_event_stream_checkpoints checkpoint
    join public.games game on game.id = checkpoint.game_id
    where checkpoint.game_id = p_game_id
      and checkpoint.recorded_by = p_recorded_by
      and game.sport_id = p_sport_id
      and checkpoint.event_count = (
        select count(*)::integer
        from public.game_events event
        where event.game_id = checkpoint.game_id
          and event.recorded_by = checkpoint.recorded_by
          and event.sport_id = p_sport_id
      )
      and checkpoint.max_sequence = (
        select coalesce(max(event.stream_sequence), -1)
        from public.game_events event
        where event.game_id = checkpoint.game_id
          and event.recorded_by = checkpoint.recorded_by
          and event.sport_id = p_sport_id
      )
      and not exists (
        select 1
        from public.game_events event
        where event.game_id = checkpoint.game_id
          and event.recorded_by = checkpoint.recorded_by
          and event.sport_id = p_sport_id
          and not exists (
            select 1
            from jsonb_array_elements(checkpoint.event_revisions) item
            where item->>'id' = event.id::text
              and (item->>'revision')::integer = event.revision
          )
      )
      and not exists (
        select 1
        from public.game_event_conflicts conflict
        where conflict.game_id = checkpoint.game_id
          and conflict.recorded_by = checkpoint.recorded_by
          and conflict.status = 'open'
      )
  );
$$;

-- Keep the existing generic internal signature for migration-046 finalization callers.
create or replace function public.is_game_event_checkpoint_current(
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
    select public.is_event_checkpoint_current(
      game.sport_id,
      p_game_id,
      p_recorded_by
    )
    from public.games game
    where game.id = p_game_id
      and public.is_event_platform_sport(game.sport_id)
  ), false);
$$;

create or replace function public.effective_event_primary_recorder(
  p_sport_id text,
  p_game_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_primary uuid;
  v_creator uuid;
begin
  if not public.is_event_platform_sport(p_sport_id) then return null; end if;

  select game.created_by into v_creator
  from public.games game
  where game.id = p_game_id
    and game.sport_id = p_sport_id;
  if not found then return null; end if;

  select primary_recorder.recorded_by into v_primary
  from public.game_event_primary_recorders primary_recorder
  where primary_recorder.game_id = p_game_id;
  if found then return v_primary; end if;

  if public.is_event_checkpoint_current(p_sport_id, p_game_id, v_creator) then
    return v_creator;
  end if;

  select checkpoint.recorded_by into v_primary
  from public.game_event_stream_checkpoints checkpoint
  where checkpoint.game_id = p_game_id
    and public.is_event_checkpoint_current(
      p_sport_id,
      checkpoint.game_id,
      checkpoint.recorded_by
    )
  order by checkpoint.synced_at, checkpoint.recorded_by
  limit 1;
  return v_primary;
end;
$$;

create or replace function public.effective_soccer_primary_recorder(
  p_game_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.effective_event_primary_recorder('soccer', p_game_id);
$$;

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
  v_can_select := (
    (v_game.cloud_scope = 'personal' and v_game.created_by = v_user_id)
    or (
      v_game.team_id is not null
      and public.current_team_role(v_game.team_id) in ('owner', 'admin')
    )
  ) and v_game.status <> 'final';

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
    recorder.recorded_by = v_primary,
    case
      when recorder.recorded_by <> v_primary then null
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
    (recorder.recorded_by = v_primary) desc,
    public.is_event_checkpoint_current(
      p_sport_id,
      p_game_id,
      recorder.recorded_by
    ) desc,
    checkpoint.synced_at,
    recorder.recorded_by;
end;
$$;

create or replace function public.get_soccer_game_recorders(p_game_id uuid)
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
language sql
stable
security definer
set search_path = public
as $$
  select * from public.get_event_game_recorders('soccer', p_game_id);
$$;

create or replace function public.get_event_primary_recorder_history(
  p_sport_id text,
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
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not public.is_event_platform_sport(p_sport_id) then
    raise exception 'Sport is not supported by the event platform';
  end if;
  if not public.can_read_game(p_game_id) then raise exception 'Game is unavailable'; end if;
  if not exists (
    select 1
    from public.games game
    where game.id = p_game_id
      and game.sport_id = p_sport_id
  ) then
    raise exception '% game not found', initcap(p_sport_id);
  end if;

  return query
  select
    audit.id,
    audit.previous_recorded_by,
    case when audit.previous_recorded_by is null then null
      else coalesce(
        nullif(trim(previous_profile.display_name), ''),
        'StatKeeper user'
      )
    end::text,
    audit.recorded_by,
    coalesce(
      nullif(trim(selected_profile.display_name), ''),
      'StatKeeper user'
    )::text,
    audit.changed_by,
    coalesce(
      nullif(trim(actor_profile.display_name), ''),
      'StatKeeper user'
    )::text,
    audit.changed_at
  from public.game_event_primary_recorder_audit audit
  left join public.profiles previous_profile
    on previous_profile.id = audit.previous_recorded_by
  left join public.profiles selected_profile
    on selected_profile.id = audit.recorded_by
  left join public.profiles actor_profile
    on actor_profile.id = audit.changed_by
  where audit.game_id = p_game_id
  order by audit.changed_at desc, audit.id desc;
end;
$$;

create or replace function public.get_soccer_primary_recorder_history(
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
language sql
stable
security definer
set search_path = public
as $$
  select * from public.get_event_primary_recorder_history('soccer', p_game_id);
$$;

create or replace function public.set_event_primary_recorder(
  p_sport_id text,
  p_game_id uuid,
  p_recorded_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_game public.games%rowtype;
  v_previous uuid;
  v_existing uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.is_event_platform_sport(p_sport_id) then
    raise exception 'Sport is not supported by the event platform';
  end if;

  select * into v_game
  from public.games game
  where game.id = p_game_id
    and game.sport_id = p_sport_id;
  if not found then raise exception '% game not found', initcap(p_sport_id); end if;
  if v_game.status = 'final' then raise exception 'Finalized primary selection is locked'; end if;
  if not (
    (v_game.cloud_scope = 'personal' and v_game.created_by = v_user_id)
    or (
      v_game.team_id is not null
      and public.current_team_role(v_game.team_id) in ('owner', 'admin')
    )
  ) then
    raise exception 'Team owner or admin access is required';
  end if;
  if not public.is_event_checkpoint_current(
    p_sport_id,
    p_game_id,
    p_recorded_by
  ) then
    raise exception 'Primary recorder must have a current conflict-free checkpoint';
  end if;

  select primary_recorder.recorded_by into v_existing
  from public.game_event_primary_recorders primary_recorder
  where primary_recorder.game_id = p_game_id
    and primary_recorder.locked_at is not null;
  if found then raise exception 'Primary recorder is locked'; end if;

  v_previous := public.effective_event_primary_recorder(p_sport_id, p_game_id);
  select primary_recorder.recorded_by into v_existing
  from public.game_event_primary_recorders primary_recorder
  where primary_recorder.game_id = p_game_id;
  if found and v_existing = p_recorded_by then return p_recorded_by; end if;

  insert into public.game_event_primary_recorders (
    game_id, recorded_by, selected_by, selected_at, selection_source
  ) values (
    p_game_id, p_recorded_by, v_user_id, now(), 'selected'
  )
  on conflict (game_id) do update set
    recorded_by = excluded.recorded_by,
    selected_by = excluded.selected_by,
    selected_at = excluded.selected_at,
    selection_source = excluded.selection_source;

  insert into public.game_event_primary_recorder_audit (
    game_id, previous_recorded_by, recorded_by, changed_by
  ) values (
    p_game_id, v_previous, p_recorded_by, v_user_id
  );

  perform public.record_access_audit_event(
    p_sport_id || '_primary_recorder_changed',
    v_user_id,
    p_recorded_by,
    v_game.team_id,
    null,
    p_game_id,
    jsonb_build_object('previous_recorded_by', v_previous)
  );
  return p_recorded_by;
end;
$$;

create or replace function public.set_soccer_primary_recorder(
  p_game_id uuid,
  p_recorded_by uuid
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.set_event_primary_recorder('soccer', p_game_id, p_recorded_by);
$$;

-- Existing team games can acquire additional recorder-owned streams without changing
-- the game creator or copying another recorder's events.
create or replace function public.bind_event_game_v3(
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
  v_game public.games%rowtype;
  v_item jsonb;
  v_source_player_id uuid;
  v_participant_map jsonb;
  v_participants jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.is_event_platform_sport(p_sport_id) then
    raise exception 'Sport is not supported by the event platform';
  end if;
  if length(trim(coalesce(p_team_name, ''))) = 0
     or length(trim(coalesce(p_opponent_name, ''))) = 0
     or p_game_date is null then
    raise exception 'Team, opponent, and game date are required';
  end if;
  if p_existing_game_id is null then
    return public.bind_event_game_v2(
      p_sport_id,
      null,
      p_client_local_game_id,
      p_source_team_id,
      p_source_season_id,
      p_team_name,
      p_opponent_name,
      p_competition_name,
      p_game_date,
      p_participants,
      p_setup_snapshot
    );
  end if;

  select * into v_game
  from public.games game
  where game.id = p_existing_game_id
    and game.sport_id = p_sport_id
    and game.status <> 'final'
    and game.team_id is not distinct from p_source_team_id
    and game.season_id is not distinct from p_source_season_id;
  if not found then
    raise exception 'Existing % game is unavailable or incompatible', lower(p_sport_id);
  end if;
  if not public.can_track_game(v_game.id) then
    raise exception 'Not authorized to track this game';
  end if;
  if v_game.cloud_scope = 'personal' and v_game.created_by <> v_user_id then
    raise exception 'Personal games cannot add another recorder';
  end if;
  if jsonb_typeof(p_participants) <> 'array' then
    raise exception 'Participants must be an array';
  end if;
  if not exists (
    select 1
    from public.game_event_setup_snapshots setup
    where setup.game_id = v_game.id
      and setup.sport_id = p_sport_id
      and setup.setup_snapshot is not distinct from p_setup_snapshot
  ) then
    raise exception '% setup snapshot is incompatible', initcap(p_sport_id);
  end if;

  -- Shared game headers remain creator-owned even when another recorder binds or syncs.
  if v_game.created_by = v_user_id then
    update public.games set
      tracked_team_name = trim(p_team_name),
      opponent_name = trim(p_opponent_name),
      tournament_name = nullif(trim(coalesce(p_competition_name, '')), ''),
      game_date = p_game_date
    where id = v_game.id;
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
        and participant.client_participant_id =
          trim(v_item->>'client_participant_id')
        and participant.client_player_id is not null
        and nullif(
          trim(coalesce(v_item->>'client_player_id', '')),
          ''
        ) is not null
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
      display_name = case
        when v_user_id = v_game.created_by then excluded.display_name
        else public.game_participants.display_name
      end,
      jersey_number = case
        when v_user_id = v_game.created_by then excluded.jersey_number
        else public.game_participants.jersey_number
      end,
      -- Match participant snapshots are first-write identity/setup metadata. Recorder-specific
      -- live status and role remain derived exclusively from that recorder's event stream.
      snapshot = public.game_participants.snapshot,
      updated_at = now();
  end loop;

  select coalesce(
    jsonb_object_agg(participant.client_player_id, participant.id::text),
    '{}'::jsonb
  )
  into v_participant_map
  from public.game_participants participant
  where participant.game_id = v_game.id
    and participant.client_player_id is not null;

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
    'participant_id_map', v_participant_map,
    'participants', v_participants
  );
end;
$$;

create or replace function public.bind_soccer_event_game_v3(
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
language sql
security definer
set search_path = public
as $$
  select public.bind_event_game_v3(
    'soccer',
    p_existing_game_id,
    p_client_local_game_id,
    p_source_team_id,
    p_source_season_id,
    p_team_name,
    p_opponent_name,
    p_competition_name,
    p_game_date,
    p_participants,
    p_setup_snapshot
  );
$$;

revoke all on function public.is_event_checkpoint_current(text, uuid, uuid)
  from public;
revoke all on function public.is_game_event_checkpoint_current(uuid, uuid)
  from public;
revoke all on function public.effective_event_primary_recorder(text, uuid)
  from public;
revoke all on function public.effective_soccer_primary_recorder(uuid)
  from public;
revoke all on function public.get_event_game_recorders(text, uuid)
  from public;
revoke all on function public.get_soccer_game_recorders(uuid)
  from public;
revoke all on function public.get_event_primary_recorder_history(text, uuid)
  from public;
revoke all on function public.get_soccer_primary_recorder_history(uuid)
  from public;
revoke all on function public.set_event_primary_recorder(text, uuid, uuid)
  from public;
revoke all on function public.set_soccer_primary_recorder(uuid, uuid)
  from public;
revoke all on function public.bind_event_game_v3(
  text, uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) from public;
revoke all on function public.bind_soccer_event_game_v3(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) from public;

grant execute on function public.get_soccer_game_recorders(uuid)
  to authenticated;
grant execute on function public.get_soccer_primary_recorder_history(uuid)
  to authenticated;
grant execute on function public.set_soccer_primary_recorder(uuid, uuid)
  to authenticated;
grant execute on function public.bind_soccer_event_game_v3(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) to authenticated;

comment on function public.is_event_checkpoint_current(text, uuid, uuid) is
  'Private sport-neutral exact checkpoint and conflict-health predicate.';
comment on function public.effective_event_primary_recorder(text, uuid) is
  'Private sport-neutral selected-or-deterministic primary recorder resolver.';
comment on function public.get_event_game_recorders(text, uuid) is
  'Private sport-neutral recorder presence and primary-selection projection.';
comment on function public.get_event_primary_recorder_history(text, uuid) is
  'Private sport-neutral immutable primary-recorder selection history.';
comment on function public.set_event_primary_recorder(text, uuid, uuid) is
  'Private sport-neutral authorized primary recorder selection.';
comment on function public.bind_event_game_v3(
  text, uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) is
  'Private sport-neutral independent-recorder binding.';

comment on table public.game_event_primary_recorders is
  'Provisional event-platform primary recorder selection; finalization locks it.';
comment on table public.game_event_primary_recorder_audit is
  'Immutable event-platform primary-recorder selection history.';
