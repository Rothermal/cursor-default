-- Read-only contract checks after manually applying migration 081. All should be true.
-- These do not establish that a particular game has finished syncing or is finalized.
with functions as (
  select
    'public.upsert_game_event_revisioned(uuid,uuid,text,text,integer,bigint,integer,text,integer,bigint,timestamptz,text,jsonb,jsonb,jsonb,timestamptz,timestamptz,timestamptz)'::regprocedure as writer,
    'public.get_event_game_recorders(text,uuid)'::regprocedure as reader
), sources as (
  select functions.*,
    (select prosrc from pg_proc where oid = writer) as write_source,
    (select prosrc from pg_proc where oid = reader) as read_source
  from functions
)
select
  position('setup.sport_id = v_game_sport_id' in write_source) > 0
    and position('p_revision > 1' in write_source) > 0
    and position('setup.setup_snapshot->''version'' in (''1''::jsonb, ''2''::jsonb)' in write_source) > 0
    as versioned_first_upload_supported,
  position('coalesce(recorder.recorded_by = v_primary, false)' in read_source) > 0
    and position('when v_primary is null or recorder.recorded_by <> v_primary then null' in read_source) > 0
    as pending_primary_response_valid,
  position('v_can_select := coalesce((' in read_source) > 0 as missing_role_fails_closed,
  has_function_privilege('authenticated', writer, 'execute')
    and not has_function_privilege('anon', writer, 'execute') as writer_authenticated_only,
  not has_function_privilege('authenticated', reader, 'execute')
    and not has_function_privilege('anon', reader, 'execute') as recorder_core_private
from sources;
