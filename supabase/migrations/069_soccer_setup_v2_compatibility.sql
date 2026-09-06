-- SOC-S24A: widen immutable event setup binding to reviewed sport/version pairs.

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

revoke all on function public.bind_event_game_v2(
  text, uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) from public;

comment on function public.bind_event_game_v2(
  text, uuid, text, uuid, uuid, text, text, text, date, jsonb, jsonb
) is
  'Private sport-neutral event-game adoption with immutable, sport-versioned setup binding.';

create or replace function public.get_soccer_release_capabilities()
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

  if
    to_regclass('public.game_participants') is null
    or to_regclass('public.game_event_stream_checkpoints') is null
    or to_regclass('public.game_event_setup_snapshots') is null
    or to_regclass('public.game_event_conflicts') is null
    or to_regclass('public.game_event_primary_recorders') is null
    or to_regclass('public.game_event_primary_recorder_audit') is null
    or to_regclass('public.game_event_canonical_publications') is null
    or to_regclass('public.user_sport_settings') is null
    or to_regclass('public.team_sport_settings') is null
    or to_regprocedure(
      'public.bind_soccer_event_game_v5(uuid,text,uuid,uuid,text,text,text,date,jsonb,jsonb,boolean)'
    ) is null
    or to_regprocedure(
      'public.get_soccer_scope_aggregate_publications(text,uuid,timestamptz,uuid,integer)'
    ) is null
    or to_regprocedure(
      'public.get_soccer_player_aggregate_publications(uuid,uuid,uuid,timestamptz,uuid,integer)'
    ) is null
    or to_regprocedure(
      'public.save_user_sport_settings_revisioned(text,integer,bigint,jsonb)'
    ) is null
    or to_regprocedure(
      'public.save_team_sport_settings_revisioned(uuid,text,integer,bigint,jsonb)'
    ) is null
  then
    return jsonb_build_object('contractVersion', 1);
  end if;

  return jsonb_build_object(
    'contractVersion', 2,
    'migration', 69,
    'eventTransportVersion', 4,
    'recoveryVersion', 1,
    'recorderResolutionVersion', 1,
    'canonicalFinalizationVersion', 1,
    'aggregateSourceVersion', 1,
    'settingsSchemaVersion', 1,
    'setupSnapshotVersion', 2
  );
end;
$$;

revoke all on function public.get_soccer_release_capabilities() from public;
grant execute on function public.get_soccer_release_capabilities() to authenticated;

notify pgrst, 'reload schema';
