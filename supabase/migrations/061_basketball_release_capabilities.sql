-- BKE-4E5: authenticated, read-only handshake for the complete Basketball BKE-4 contract.
-- This migration adds no product data and grants no operational authority.

create or replace function public.get_basketball_release_capabilities()
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
    to_regclass('public.games') is null
    or to_regclass('public.game_participants') is null
    or to_regclass('public.game_events') is null
    or to_regclass('public.game_event_stream_checkpoints') is null
    or to_regclass('public.game_event_setup_snapshots') is null
    or to_regclass('public.game_event_conflicts') is null
    or to_regclass('public.game_event_primary_recorders') is null
    or to_regclass('public.game_event_primary_recorder_audit') is null
    or to_regclass('public.game_event_canonical_publications') is null
    or to_regprocedure(
      'public.bind_basketball_event_game_v4(uuid,text,uuid,uuid,text,text,text,date,jsonb,jsonb)'
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
    or to_regprocedure('public.get_basketball_game_recorders(uuid)') is null
    or to_regprocedure(
      'public.get_basketball_primary_recorder_history(uuid)'
    ) is null
    or to_regprocedure('public.set_basketball_primary_recorder(uuid,uuid)') is null
    or to_regprocedure('public.get_basketball_finalization_readiness(uuid)') is null
    or to_regprocedure('public.get_basketball_canonical_publication(uuid)') is null
    or to_regprocedure(
      'public.get_basketball_primary_conflicts_for_finalization(uuid)'
    ) is null
    or to_regprocedure(
      'public.resolve_basketball_primary_conflict_for_finalization(uuid,text)'
    ) is null
    or to_regprocedure(
      'public.confirm_basketball_primary_checkpoint_for_finalization(uuid,uuid,integer,jsonb,integer,bigint,text)'
    ) is null
    or to_regprocedure(
      'public.finalize_basketball_event_game(uuid,uuid,jsonb,text,jsonb)'
    ) is null
    or to_regprocedure(
      'public.get_basketball_canonical_publication_history(uuid)'
    ) is null
    or to_regprocedure('public.reopen_basketball_event_game(uuid,text)') is null
    or to_regprocedure(
      'public.get_basketball_scope_aggregate_publications(text,uuid,timestamptz,uuid,integer)'
    ) is null
    or to_regprocedure(
      'public.get_basketball_player_aggregate_publications(uuid,uuid,uuid,timestamptz,uuid,integer)'
    ) is null
    or to_regprocedure(
      'public.get_basketball_scope_aggregate_legacy_games(text,uuid,date,uuid,integer)'
    ) is null
    or to_regprocedure(
      'public.get_basketball_player_aggregate_legacy_games(uuid,uuid,uuid,date,uuid,integer)'
    ) is null
  then
    return jsonb_build_object('contractVersion', 0);
  end if;

  return jsonb_build_object(
    'contractVersion', 1,
    'migration', 61,
    'eventTransportVersion', 4,
    'recoveryVersion', 1,
    'recorderResolutionVersion', 1,
    'canonicalFinalizationVersion', 1,
    'summaryAuthorityVersion', 1,
    'aggregateSourceVersion', 1
  );
end;
$$;

revoke all on function public.get_basketball_release_capabilities() from public;
grant execute on function public.get_basketball_release_capabilities() to authenticated;

comment on function public.get_basketball_release_capabilities() is
  'Read-only exact-version preflight for the complete Basketball BKE-4 cloud contract.';

notify pgrst, 'reload schema';
