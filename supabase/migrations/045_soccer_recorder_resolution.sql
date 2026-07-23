-- SOC-5C: independent soccer recorders and provisional primary resolution.

create table public.game_event_primary_recorders (
  game_id uuid primary key references public.games (id) on delete cascade,
  recorded_by uuid not null references public.profiles (id),
  selected_by uuid not null references public.profiles (id),
  selected_at timestamptz not null default now(),
  selection_source text not null default 'selected'
    check (selection_source in ('default', 'selected')),
  locked_at timestamptz,
  locked_by uuid references public.profiles (id),
  check ((locked_at is null) = (locked_by is null)),
  foreign key (game_id, recorded_by)
    references public.game_event_stream_checkpoints (game_id, recorded_by)
);

create table public.game_event_primary_recorder_audit (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  previous_recorded_by uuid references public.profiles (id),
  recorded_by uuid not null references public.profiles (id),
  changed_by uuid not null references public.profiles (id),
  changed_at timestamptz not null default now()
);

create index idx_game_event_primary_audit_game
  on public.game_event_primary_recorder_audit (game_id, changed_at desc);

alter table public.game_event_primary_recorders enable row level security;
alter table public.game_event_primary_recorder_audit enable row level security;

create policy "event_primary_select_game" on public.game_event_primary_recorders
  for select using (public.can_read_game(game_id));
create policy "event_primary_audit_select_game" on public.game_event_primary_recorder_audit
  for select using (public.can_read_game(game_id));

revoke all on table public.game_event_primary_recorders from anon, authenticated;
revoke all on table public.game_event_primary_recorder_audit from anon, authenticated;
grant select on table public.game_event_primary_recorders to authenticated;
grant select on table public.game_event_primary_recorder_audit to authenticated;

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
  select exists (
    select 1
    from public.game_event_stream_checkpoints cp
    where cp.game_id = p_game_id
      and cp.recorded_by = p_recorded_by
      and cp.event_count = (
        select count(*)::integer
        from public.game_events ge
        where ge.game_id = cp.game_id and ge.recorded_by = cp.recorded_by
      )
      and cp.max_sequence = (
        select coalesce(max(ge.stream_sequence), -1)
        from public.game_events ge
        where ge.game_id = cp.game_id and ge.recorded_by = cp.recorded_by
      )
      and not exists (
        select 1
        from public.game_events ge
        where ge.game_id = cp.game_id
          and ge.recorded_by = cp.recorded_by
          and not exists (
            select 1
            from jsonb_array_elements(cp.event_revisions) item
            where item->>'id' = ge.id::text
              and (item->>'revision')::integer = ge.revision
          )
      )
      and not exists (
        select 1
        from public.game_event_conflicts c
        where c.game_id = cp.game_id
          and c.recorded_by = cp.recorded_by
          and c.status = 'open'
      )
  );
$$;

create or replace function public.effective_soccer_primary_recorder(
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
  select pr.recorded_by into v_primary
  from public.game_event_primary_recorders pr
  where pr.game_id = p_game_id;
  if found then return v_primary; end if;

  select g.created_by into v_creator
  from public.games g
  where g.id = p_game_id and g.sport_id = 'soccer';
  if not found then return null; end if;

  if public.is_game_event_checkpoint_current(p_game_id, v_creator) then
    return v_creator;
  end if;

  select cp.recorded_by into v_primary
  from public.game_event_stream_checkpoints cp
  where cp.game_id = p_game_id
    and public.is_game_event_checkpoint_current(cp.game_id, cp.recorded_by)
  order by cp.synced_at, cp.recorded_by
  limit 1;
  return v_primary;
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
  if not public.can_read_game(p_game_id) then raise exception 'Game is unavailable'; end if;

  select * into v_game from public.games g
  where g.id = p_game_id and g.sport_id = 'soccer';
  if not found then raise exception 'Soccer game not found'; end if;

  select pr.selection_source into v_selection_source
  from public.game_event_primary_recorders pr where pr.game_id = p_game_id;
  v_primary := public.effective_soccer_primary_recorder(p_game_id);
  v_can_select := (
    (v_game.cloud_scope = 'personal' and v_game.created_by = v_user_id)
    or (
      v_game.team_id is not null
      and public.current_team_role(v_game.team_id) in ('owner', 'admin')
    )
  ) and v_game.status <> 'final';

  return query
  with recorder_ids as (
    select ge.recorded_by
    from public.game_events ge where ge.game_id = p_game_id
    union
    select cp.recorded_by
    from public.game_event_stream_checkpoints cp where cp.game_id = p_game_id
  ),
  event_totals as (
    select ge.recorded_by, count(*)::integer as event_count
    from public.game_events ge
    where ge.game_id = p_game_id
    group by ge.recorded_by
  ),
  conflict_totals as (
    select c.recorded_by, count(*)::integer as conflict_count
    from public.game_event_conflicts c
    where c.game_id = p_game_id and c.status = 'open'
    group by c.recorded_by
  )
  select
    ids.recorded_by,
    coalesce(nullif(trim(p.display_name), ''), 'StatKeeper user')::text,
    coalesce(et.event_count, 0),
    cp.event_count,
    cp.synced_at,
    public.is_game_event_checkpoint_current(p_game_id, ids.recorded_by),
    coalesce(ct.conflict_count, 0),
    ids.recorded_by = v_primary,
    case
      when ids.recorded_by <> v_primary then null
      when v_selection_source is not null then v_selection_source
      else 'default'
    end::text,
    v_can_select
  from recorder_ids ids
  left join public.profiles p on p.id = ids.recorded_by
  left join event_totals et on et.recorded_by = ids.recorded_by
  left join conflict_totals ct on ct.recorded_by = ids.recorded_by
  left join public.game_event_stream_checkpoints cp
    on cp.game_id = p_game_id and cp.recorded_by = ids.recorded_by
  order by
    (ids.recorded_by = v_primary) desc,
    public.is_game_event_checkpoint_current(p_game_id, ids.recorded_by) desc,
    cp.synced_at,
    ids.recorded_by;
end;
$$;

create or replace function public.get_soccer_primary_recorder_history(p_game_id uuid)
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
  if not public.can_read_game(p_game_id) then raise exception 'Game is unavailable'; end if;

  return query
  select
    a.id,
    a.previous_recorded_by,
    case when a.previous_recorded_by is null then null
      else coalesce(nullif(trim(previous_profile.display_name), ''), 'StatKeeper user')
    end::text,
    a.recorded_by,
    coalesce(nullif(trim(selected_profile.display_name), ''), 'StatKeeper user')::text,
    a.changed_by,
    coalesce(nullif(trim(actor_profile.display_name), ''), 'StatKeeper user')::text,
    a.changed_at
  from public.game_event_primary_recorder_audit a
  left join public.profiles previous_profile on previous_profile.id = a.previous_recorded_by
  left join public.profiles selected_profile on selected_profile.id = a.recorded_by
  left join public.profiles actor_profile on actor_profile.id = a.changed_by
  where a.game_id = p_game_id
  order by a.changed_at desc, a.id desc;
end;
$$;

create or replace function public.set_soccer_primary_recorder(
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
  select * into v_game from public.games g
  where g.id = p_game_id and g.sport_id = 'soccer';
  if not found then raise exception 'Soccer game not found'; end if;
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
  if not public.is_game_event_checkpoint_current(p_game_id, p_recorded_by) then
    raise exception 'Primary recorder must have a current conflict-free checkpoint';
  end if;

  select pr.recorded_by into v_existing
  from public.game_event_primary_recorders pr
  where pr.game_id = p_game_id and pr.locked_at is not null;
  if found then raise exception 'Primary recorder is locked'; end if;

  v_previous := public.effective_soccer_primary_recorder(p_game_id);
  select pr.recorded_by into v_existing
  from public.game_event_primary_recorders pr where pr.game_id = p_game_id;
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
    'soccer_primary_recorder_changed',
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

-- Existing team games can acquire additional recorder-owned streams without changing
-- the game creator or copying another recorder's events.
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
  if length(trim(coalesce(p_team_name, ''))) = 0
     or length(trim(coalesce(p_opponent_name, ''))) = 0
     or p_game_date is null then
    raise exception 'Team, opponent, and game date are required';
  end if;
  if p_existing_game_id is null then
    return public.bind_soccer_event_game_v2(
      null, p_client_local_game_id, p_source_team_id, p_source_season_id,
      p_team_name, p_opponent_name, p_competition_name, p_game_date,
      p_participants, p_setup_snapshot
    );
  end if;

  select * into v_game from public.games g
  where g.id = p_existing_game_id
    and g.sport_id = 'soccer'
    and g.status <> 'final'
    and g.team_id is not distinct from p_source_team_id
    and g.season_id is not distinct from p_source_season_id;
  if not found then raise exception 'Existing soccer game is unavailable or incompatible'; end if;
  if not public.can_track_game(v_game.id) then raise exception 'Not authorized to track this game'; end if;
  if v_game.cloud_scope = 'personal' and v_game.created_by <> v_user_id then
    raise exception 'Personal games cannot add another recorder';
  end if;
  if jsonb_typeof(p_participants) <> 'array' then raise exception 'Participants must be an array'; end if;
  if not exists (
    select 1 from public.game_event_setup_snapshots s
    where s.game_id = v_game.id and s.setup_snapshot is not distinct from p_setup_snapshot
  ) then
    raise exception 'Soccer setup snapshot is incompatible';
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
      select 1 from public.team_players tp
      where tp.team_id = p_source_team_id and tp.player_id = v_source_player_id
    ) then
      raise exception 'Participant source player is not on the source team';
    end if;
    if exists (
      select 1 from public.game_participants gp
      where gp.game_id = v_game.id
        and gp.client_participant_id = trim(v_item->>'client_participant_id')
        and gp.client_player_id is not null
        and nullif(trim(coalesce(v_item->>'client_player_id', '')), '') is not null
        and gp.client_player_id is distinct from nullif(trim(v_item->>'client_player_id'), '')
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
        public.game_participants.client_player_id, excluded.client_player_id
      ),
      source_player_id = coalesce(
        public.game_participants.source_player_id, excluded.source_player_id
      ),
      participant_kind = case
        when coalesce(
          public.game_participants.client_player_id, excluded.client_player_id
        ) is null then excluded.participant_kind else 'player'
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

  select coalesce(jsonb_object_agg(gp.client_player_id, gp.id::text), '{}'::jsonb)
  into v_participant_map
  from public.game_participants gp
  where gp.game_id = v_game.id and gp.client_player_id is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', gp.id,
    'client_participant_id', gp.client_participant_id,
    'client_player_id', gp.client_player_id,
    'display_name', gp.display_name,
    'jersey_number', gp.jersey_number
  ) order by gp.created_at, gp.id), '[]'::jsonb)
  into v_participants
  from public.game_participants gp where gp.game_id = v_game.id;

  return jsonb_build_object(
    'game_id', v_game.id,
    'participant_id_map', v_participant_map,
    'participants', v_participants
  );
end;
$$;

revoke all on function public.is_game_event_checkpoint_current(uuid, uuid) from public;
revoke all on function public.effective_soccer_primary_recorder(uuid) from public;
revoke all on function public.get_soccer_game_recorders(uuid) from public;
revoke all on function public.get_soccer_primary_recorder_history(uuid) from public;
revoke all on function public.set_soccer_primary_recorder(uuid, uuid) from public;
revoke all on function public.bind_soccer_event_game_v3(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) from public;

grant execute on function public.get_soccer_game_recorders(uuid) to authenticated;
grant execute on function public.get_soccer_primary_recorder_history(uuid) to authenticated;
grant execute on function public.set_soccer_primary_recorder(uuid, uuid) to authenticated;
grant execute on function public.bind_soccer_event_game_v3(
  uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) to authenticated;

comment on table public.game_event_primary_recorders is
  'Provisional primary recorder selection; SOC-5D locks it during finalization.';
comment on table public.game_event_primary_recorder_audit is
  'Immutable history of soccer primary-recorder selection changes.';
