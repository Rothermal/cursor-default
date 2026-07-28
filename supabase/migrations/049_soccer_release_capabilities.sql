-- SOC-6E1: authenticated, read-only handshake for the complete Soccer cloud contract.
-- This migration adds no product data and grants no operational authority.

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

  -- Fail closed when 049 was applied without the complete operational boundary.
  -- Return an older contract instead of object names so the client can give safe
  -- backend migration guidance without exposing schema details.
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
      'public.bind_soccer_event_game_v4(uuid,text,uuid,uuid,text,text,text,date,jsonb,jsonb)'
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
    return jsonb_build_object('contractVersion', 0);
  end if;

  return jsonb_build_object(
    'contractVersion', 1,
    'migration', 49,
    'eventTransportVersion', 4,
    'recoveryVersion', 1,
    'recorderResolutionVersion', 1,
    'canonicalFinalizationVersion', 1,
    'aggregateSourceVersion', 1,
    'settingsSchemaVersion', 1
  );
end;
$$;

revoke all on function public.get_soccer_release_capabilities() from public;
grant execute on function public.get_soccer_release_capabilities() to authenticated;

notify pgrst, 'reload schema';
