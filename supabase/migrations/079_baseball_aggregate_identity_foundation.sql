-- BSB-7A server foundation only. Canonical schema 1 and contract 2 / 078 stay unchanged.
-- Run this migration as one transaction. No legacy backfill or settings/rollout change.
begin;

create table public.baseball_personal_publication_pins (
  publication_id uuid primary key references public.game_event_canonical_publications(id) on delete cascade,
  schema_version integer not null check (schema_version = 1),
  primary_recorded_by uuid not null,
  participant_source_map jsonb not null check (jsonb_typeof(participant_source_map) = 'object'),
  map_fingerprint text not null check (map_fingerprint = md5(participant_source_map::text)),
  created_at timestamptz not null default now()
);
alter table public.baseball_personal_publication_pins enable row level security;
revoke all on table public.baseball_personal_publication_pins from public, anon, authenticated;

create table public.baseball_personal_link_receipts (
  user_id uuid not null references public.profiles(id),
  operation_id uuid not null,
  game_id uuid not null references public.games(id) on delete cascade,
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);
create index idx_baseball_personal_link_receipts_game on public.baseball_personal_link_receipts(game_id);
alter table public.baseball_personal_link_receipts enable row level security;
revoke all on table public.baseball_personal_link_receipts from public, anon, authenticated;

create or replace function public._baseball_personal_player_authorized(p_player_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.players player
    where player.id = p_player_id and not player.is_team_placeholder
      and (player.created_by = p_user_id or exists (
        select 1 from public.player_guardians guardian
        where guardian.player_id = player.id and guardian.user_id = p_user_id
      ))
  );
$$;

-- Shared only by the new link command and the existing merge entry point. Publication
-- hooks must NOT acquire these locks: finalization already holds the game row lock.
create or replace function public._baseball_personal_lock_player(p_player_id uuid)
returns void
language sql volatile security definer set search_path = public
as $$
  select pg_advisory_xact_lock(hashtextextended('baseball-personal-player:' || p_player_id::text, 0));
$$;

-- Keep the established merge implementation and its authorization byte-for-byte; the
-- fixed public entry adds only sorted player/participant locks. No identity inference.
alter function public.merge_players_execute(uuid, uuid, jsonb) rename to _merge_players_execute_before_baseball_identity;
revoke all on function public._merge_players_execute_before_baseball_identity(uuid, uuid, jsonb)
  from public, anon, authenticated;
create or replace function public.merge_players_execute(
  p_duplicate_id uuid, p_survivor_id uuid, p_resolutions jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_player_id uuid;
begin
  if auth.uid() is null then raise exception 'merge_players_execute: not authenticated'; end if;
  for v_player_id in select distinct id from unnest(array[p_duplicate_id, p_survivor_id]) id order by id
  loop
    perform public._baseball_personal_lock_player(v_player_id);
  end loop;
  perform participant.id from public.game_participants participant
  where participant.source_player_id in (p_duplicate_id, p_survivor_id)
  order by participant.id for update;
  perform public._merge_players_execute_before_baseball_identity(p_duplicate_id, p_survivor_id, p_resolutions);
end;
$$;
revoke all on function public.merge_players_execute(uuid, uuid, jsonb) from public, anon;
grant execute on function public.merge_players_execute(uuid, uuid, jsonb) to authenticated;

-- Exact tracked identity keys come only from immutable setup, never UUID-shaped names.
-- This helper also accepts old immutable canonical setups for historical null bootstrap.
create or replace function public._baseball_personal_raw_map(p_game_id uuid, p_setup jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_owner uuid;
  v_item jsonb;
  v_participant public.game_participants%rowtype;
  v_map jsonb := '{}'::jsonb;
begin
  select game.created_by into v_owner from public.games game
  where game.id = p_game_id and game.sport_id = 'baseball' and game.cloud_scope = 'personal'
    and game.team_id is null and game.season_id is null;
  if not found then raise exception 'Baseball personal game is unavailable'; end if;
  if jsonb_typeof(p_setup) is distinct from 'object' or p_setup->>'version' is distinct from '1'
     or p_setup->'sourceTeamId' is distinct from 'null'::jsonb
     or p_setup->'sourceSeasonId' is distinct from 'null'::jsonb
     or jsonb_typeof(p_setup->'participants') is distinct from 'array' then
    raise exception 'Baseball personal setup is invalid';
  end if;
  for v_item in select value from jsonb_array_elements(p_setup->'participants') loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or jsonb_typeof(v_item->'id') is distinct from 'string'
       or length(trim(v_item->>'id')) = 0 or v_map ? (v_item->>'id')
       or jsonb_typeof(v_item->'playerId') is null
       or jsonb_typeof(v_item->'playerId') not in ('string', 'null')
       or (jsonb_typeof(v_item->'playerId') = 'string' and length(trim(v_item->>'playerId')) = 0) then
      raise exception 'Baseball tracked participant identity is invalid';
    end if;
    select * into v_participant from public.game_participants participant
    where participant.game_id = p_game_id and participant.client_participant_id = v_item->>'id';
    if not found
       or v_participant.client_player_id is distinct from v_item->>'playerId'
       or v_participant.participant_kind is distinct from
          (case when v_item->>'playerId' is null then 'anonymous' else 'player' end) then
      raise exception 'Baseball tracked participant does not match immutable setup';
    end if;
    if v_participant.source_player_id is not null and
       not public._baseball_personal_player_authorized(v_participant.source_player_id, v_owner) then
      raise exception 'Baseball personal source identity is invalid';
    end if;
    if v_participant.source_player_id is null and exists (
      select 1 from public.baseball_personal_link_receipts receipt
      where receipt.game_id = p_game_id
        and receipt.request_payload->>'participantId' = v_item->>'id'
    ) then
      raise exception 'Confirmed Baseball personal source identity is missing';
    end if;
    v_map := v_map || jsonb_build_object(v_item->>'id', v_participant.source_player_id);
  end loop;
  if exists (
    select 1 from public.game_participants participant
    where participant.game_id = p_game_id and participant.source_player_id is not null
      and not (v_map ? participant.client_participant_id)
  ) then raise exception 'Baseball personal source identity is ambiguous'; end if;
  return v_map;
end;
$$;

create or replace function public._baseball_personal_pin_publication()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_map jsonb;
begin
  if new.sport_id = 'baseball' and exists (
    select 1 from public.games game where game.id = new.game_id and game.cloud_scope = 'personal'
  ) then
    if new.canonical_snapshot->>'canonicalSchemaVersion' is distinct from '1'
       or new.canonical_snapshot->>'primaryRecorderId' is distinct from new.primary_recorded_by::text then
      raise exception 'Baseball personal canonical identity is invalid';
    end if;
    v_map := public._baseball_personal_raw_map(new.game_id, new.canonical_snapshot#>'{sportGameState,setup}');
    insert into public.baseball_personal_publication_pins
      (publication_id, schema_version, primary_recorded_by, participant_source_map, map_fingerprint)
    values (new.id, 1, new.primary_recorded_by, v_map, md5(v_map::text));
  end if;
  return new;
end;
$$;
create trigger baseball_personal_pin_publication
  after insert on public.game_event_canonical_publications
  for each row execute function public._baseball_personal_pin_publication();

-- The table DDL/trigger lock and explicit transaction exclude concurrent publication inserts.
-- Prior supported personal binders rejected every non-null source. Prove the current
-- rows are still all-null too; anomalous history deliberately receives NO pin.
do $$
declare v_publication record; v_map jsonb;
begin
  for v_publication in
    select publication.* from public.game_event_canonical_publications publication
    join public.games game on game.id = publication.game_id
    where publication.sport_id = 'baseball' and game.sport_id = 'baseball'
      and game.cloud_scope = 'personal' and game.team_id is null and game.season_id is null
      and not exists (select 1 from public.game_participants participant
        where participant.game_id = game.id and participant.source_player_id is not null)
  loop
    begin
      if v_publication.canonical_snapshot->>'canonicalSchemaVersion' is distinct from '1'
         or v_publication.canonical_snapshot->>'primaryRecorderId' is distinct from v_publication.primary_recorded_by::text then
        continue;
      end if;
      v_map := public._baseball_personal_raw_map(v_publication.game_id,
        v_publication.canonical_snapshot#>'{sportGameState,setup}');
      insert into public.baseball_personal_publication_pins
        (publication_id, schema_version, primary_recorded_by, participant_source_map, map_fingerprint)
      values (v_publication.id, 1, v_publication.primary_recorded_by, v_map, md5(v_map::text));
    exception when raise_exception then
      raise notice 'Baseball personal publication % needs identity review', v_publication.id;
    end;
  end loop;
end;
$$;

-- A pin stores historical UUIDs without a player FK. Follow only an unambiguous audited
-- chain whose deleted intermediate identities lead to a currently authorized survivor.
create or replace function public._baseball_personal_resolve_source(p_source_id uuid, p_owner_id uuid)
returns uuid
language plpgsql stable security definer set search_path = public
as $$
declare v_current uuid := p_source_id; v_next uuid; v_count integer; v_path uuid[] := '{}';
begin
  loop
    if v_current is null or v_current = any(v_path) or cardinality(v_path) >= 64 then return null; end if;
    v_path := v_path || v_current;
    select count(*), min(audit.survivor_player_id::text)::uuid into v_count, v_next
    from public.player_merge_audit audit where audit.duplicate_player_id = v_current;
    if v_count = 0 then
      if public._baseball_personal_player_authorized(v_current, p_owner_id) then return v_current; end if;
      return null;
    end if;
    if v_count <> 1 or exists (select 1 from public.players player where player.id = v_current) then return null; end if;
    v_current := v_next;
  end loop;
end;
$$;

create or replace function public._baseball_personal_publication_identity(p_publication_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_publication public.game_event_canonical_publications%rowtype;
  v_pin public.baseball_personal_publication_pins%rowtype;
  v_owner uuid; v_item jsonb; v_entry record; v_source uuid;
  v_keys jsonb := '{}'::jsonb; v_map jsonb := '{}'::jsonb;
begin
  select publication.* into v_publication from public.game_event_canonical_publications publication
  join public.games game on game.id = publication.game_id
  where publication.id = p_publication_id and publication.sport_id = 'baseball'
    and game.sport_id = 'baseball' and game.cloud_scope = 'personal'
    and game.team_id is null and game.season_id is null;
  if not found then raise exception 'Baseball personal publication is unavailable'; end if;
  select game.created_by into v_owner from public.games game where game.id = v_publication.game_id;
  select * into v_pin from public.baseball_personal_publication_pins where publication_id = p_publication_id;
  if not found then
    return jsonb_build_object('status', 'invalid', 'participantSourceMap', null, 'mapFingerprint', null, 'diagnostic', 'missing_pin');
  end if;
  if v_pin.schema_version <> 1 or v_pin.primary_recorded_by is distinct from v_publication.primary_recorded_by
     or v_pin.map_fingerprint is distinct from md5(v_pin.participant_source_map::text)
     or v_publication.canonical_snapshot->>'canonicalSchemaVersion' is distinct from '1'
     or v_publication.canonical_snapshot#>>'{sportGameState,setup,version}' is distinct from '1'
     or jsonb_typeof(v_publication.canonical_snapshot#>'{sportGameState,setup,participants}') is distinct from 'array' then
    raise exception 'Invalid pin';
  end if;
  for v_item in select value from jsonb_array_elements(v_publication.canonical_snapshot#>'{sportGameState,setup,participants}') loop
    if jsonb_typeof(v_item->'id') is distinct from 'string' or length(trim(v_item->>'id')) = 0
       or v_keys ? (v_item->>'id') then raise exception 'Invalid participant keys'; end if;
    v_keys := v_keys || jsonb_build_object(v_item->>'id', null);
  end loop;
  if (select array_agg(key order by key) from jsonb_object_keys(v_keys) key)
     is distinct from (select array_agg(key order by key) from jsonb_object_keys(v_pin.participant_source_map) key) then
    raise exception 'Incomplete pin';
  end if;
  for v_entry in select * from jsonb_each(v_pin.participant_source_map) loop
    if v_entry.value = 'null'::jsonb then
      v_map := v_map || jsonb_build_object(v_entry.key, null);
    else
      if jsonb_typeof(v_entry.value) <> 'string' then raise exception 'Invalid source'; end if;
      v_source := public._baseball_personal_resolve_source((v_entry.value #>> '{}')::uuid, v_owner);
      if v_source is null then raise exception 'Invalid source lineage'; end if;
      v_map := v_map || jsonb_build_object(v_entry.key, v_source);
    end if;
  end loop;
  -- Legitimate merges may converge. Keep every historical participant key; the
  -- consumer pools each participant's contribution once under the survivor.
  return jsonb_build_object('status', 'valid', 'participantSourceMap', v_map,
    'mapFingerprint', v_pin.map_fingerprint, 'diagnostic', null);
exception when raise_exception or invalid_text_representation then
  return jsonb_build_object('status', 'invalid', 'participantSourceMap', null,
    'mapFingerprint', v_pin.map_fingerprint, 'diagnostic', 'invalid_pin_or_source');
end;
$$;

create or replace function public.get_baseball_personal_participant_links(p_game_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v_map jsonb; v_publication_id uuid; v_setup jsonb;
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  if not public.has_active_app_access() then raise insufficient_privilege using message = 'APP_ACCESS_UNAVAILABLE'; end if;
  if not exists (select 1 from public.games game where game.id = p_game_id
    and game.created_by = auth.uid() and game.cloud_scope = 'personal' and game.sport_id = 'baseball'
    and game.team_id is null and game.season_id is null) then
    raise insufficient_privilege using message = 'Baseball personal creator access is required';
  end if;
  select setup_snapshot into v_setup from public.game_event_setup_snapshots
  where game_id = p_game_id and sport_id = 'baseball';
  v_map := public._baseball_personal_raw_map(p_game_id, v_setup);
  select id into v_publication_id from public.game_event_canonical_publications
  where game_id = p_game_id and sport_id = 'baseball' and invalidated_at is null;
  return jsonb_build_object('contractVersion', 1, 'sportId', 'baseball', 'gameId', p_game_id,
    'participantSourceMap', v_map, 'mapFingerprint', md5(v_map::text), 'activePublicationId', v_publication_id);
end;
$$;

create or replace function public.link_baseball_personal_participant(
  p_game_id uuid, p_client_participant_id text, p_target_player_id uuid,
  p_expected_map_fingerprint text, p_expected_publication_id uuid, p_reason text, p_operation_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid(); v_game public.games%rowtype;
  v_receipt public.baseball_personal_link_receipts%rowtype;
  v_participant public.game_participants%rowtype;
  v_publication public.game_event_canonical_publications%rowtype;
  v_payload jsonb; v_result jsonb; v_reopen jsonb := null; v_setup jsonb; v_map jsonb;
begin
  if v_user is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  if not public.has_active_app_access() then raise insufficient_privilege using message = 'APP_ACCESS_UNAVAILABLE'; end if;
  if p_operation_id is null or p_target_player_id is null or p_client_participant_id is null
     or length(trim(p_client_participant_id)) = 0 or p_expected_map_fingerprint is null then
    raise exception 'Baseball link request is invalid';
  end if;
  -- Target before game: merge locks players then participants, and never locks games.
  perform public._baseball_personal_lock_player(p_target_player_id);
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.sport_id is distinct from 'baseball' or v_game.cloud_scope <> 'personal'
     or v_game.created_by is distinct from v_user or v_game.team_id is not null or v_game.season_id is not null then
    raise insufficient_privilege using message = 'Baseball personal creator access is required';
  end if;
  perform participant.id from public.game_participants participant where participant.game_id = p_game_id
  order by participant.id for update;
  if not public.has_active_app_access() or not public._baseball_personal_player_authorized(p_target_player_id, v_user) then
    raise insufficient_privilege using message = 'Authorized personal player is required';
  end if;
  v_payload := jsonb_build_object('gameId', p_game_id, 'participantId', p_client_participant_id,
    'targetPlayerId', p_target_player_id, 'expectedMapFingerprint', p_expected_map_fingerprint,
    'expectedPublicationId', p_expected_publication_id, 'reason', trim(coalesce(p_reason, '')));
  select * into v_receipt from public.baseball_personal_link_receipts
  where user_id = v_user and operation_id = p_operation_id;
  if found then
    if v_receipt.request_payload is distinct from v_payload then raise exception 'Baseball link operation id was reused'; end if;
    return v_receipt.result;
  end if;
  select setup_snapshot into v_setup from public.game_event_setup_snapshots
  where game_id = p_game_id and sport_id = 'baseball';
  v_map := public._baseball_personal_raw_map(p_game_id, v_setup);
  if md5(v_map::text) is distinct from p_expected_map_fingerprint then raise exception 'Baseball participant map changed; refresh links'; end if;
  select * into v_publication from public.game_event_canonical_publications
  where game_id = p_game_id and sport_id = 'baseball' and invalidated_at is null;
  if v_publication.id is distinct from p_expected_publication_id
     or (v_game.status = 'final') is distinct from (v_publication.id is not null) then
    raise exception 'Baseball publication changed; refresh links';
  end if;
  if not (v_map ? p_client_participant_id) then raise exception 'Tracked Baseball participant is required'; end if;
  select * into v_participant from public.game_participants
  where game_id = p_game_id and client_participant_id = p_client_participant_id;
  if v_participant.source_player_id is not null and v_participant.source_player_id <> p_target_player_id then
    raise exception 'Replacing a confirmed Baseball player link is not supported';
  end if;
  if v_participant.source_player_id is null and exists (select 1 from public.game_participants participant
    where participant.game_id = p_game_id and participant.id <> v_participant.id
      and participant.source_player_id = p_target_player_id) then
    raise exception 'Baseball target is already linked in this game';
  end if;
  if v_participant.source_player_id is null then
    if v_game.status = 'final' then
      if v_publication.primary_recorded_by is distinct from v_user then
        raise exception 'Only the owned Baseball recording can receive a reopen handoff';
      end if;
      v_reopen := public.reopen_baseball_event_game(p_game_id, p_reason);
    end if;
    update public.game_participants set source_player_id = p_target_player_id, updated_at = now()
    where id = v_participant.id;
    v_map := public._baseball_personal_raw_map(p_game_id, v_setup);
  end if;
  v_result := jsonb_build_object('contractVersion', 1, 'gameId', p_game_id, 'operationId', p_operation_id,
    'participantId', p_client_participant_id, 'targetPlayerId', p_target_player_id,
    'participantSourceMap', v_map, 'mapFingerprint', md5(v_map::text), 'reopen', v_reopen);
  insert into public.baseball_personal_link_receipts(user_id, operation_id, game_id, request_payload, result)
  values (v_user, p_operation_id, p_game_id, v_payload, v_result);
  return v_result;
end;
$$;

create or replace function public.finalize_baseball_event_game_reviewed(
  p_game_id uuid, p_primary_recorded_by uuid, p_event_revisions jsonb,
  p_stream_fingerprint text, p_canonical_snapshot jsonb, p_expected_map_fingerprint text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_game public.games%rowtype; v_map jsonb; v_fingerprint text; v_result jsonb; v_publication_id uuid;
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  if not public.has_active_app_access() then raise insufficient_privilege using message = 'APP_ACCESS_UNAVAILABLE'; end if;
  select * into v_game from public.games where id = p_game_id for update;
  if not found or v_game.sport_id is distinct from 'baseball' or v_game.cloud_scope <> 'personal'
     or v_game.created_by is distinct from auth.uid() or v_game.team_id is not null or v_game.season_id is not null then
    raise insufficient_privilege using message = 'Baseball personal creator access is required';
  end if;
  if not public.has_active_app_access() then raise insufficient_privilege using message = 'APP_ACCESS_UNAVAILABLE'; end if;
  if v_game.status = 'final' then
    -- Retry checks the ORIGINAL immutable pin, even if operational rows were merged.
    select pin.map_fingerprint into v_fingerprint from public.baseball_personal_publication_pins pin
    join public.game_event_canonical_publications publication on publication.id = pin.publication_id
    where publication.game_id = p_game_id and publication.sport_id = 'baseball' and publication.invalidated_at is null;
  else
    select public._baseball_personal_raw_map(p_game_id, setup.setup_snapshot) into v_map
    from public.game_event_setup_snapshots setup where setup.game_id = p_game_id and setup.sport_id = 'baseball';
    v_fingerprint := md5(v_map::text);
  end if;
  if v_fingerprint is null or v_fingerprint is distinct from p_expected_map_fingerprint then
    raise exception 'Baseball participant map changed; review before finalizing';
  end if;
  v_result := public.finalize_baseball_event_game(p_game_id, p_primary_recorded_by,
    p_event_revisions, p_stream_fingerprint, p_canonical_snapshot);
  v_publication_id := (v_result->>'publication_id')::uuid;
  if not exists (select 1 from public.baseball_personal_publication_pins pin
    where pin.publication_id = v_publication_id and pin.map_fingerprint = p_expected_map_fingerprint) then
    raise exception 'Baseball participant map changed during finalization';
  end if;
  return v_result;
end;
$$;

-- Aggregate eligibility is narrower than publication eligibility: forfeits/abandonment
-- remain valid BSB-6 publications but never contribute to official season totals.
create or replace function public._baseball_canonical_snapshot_completed(p_snapshot jsonb)
returns boolean
language sql immutable set search_path = public
as $$
  select coalesce(p_snapshot->>'canonicalSchemaVersion' = '1', false)
    and coalesce(p_snapshot->>'sportId' = 'baseball', false)
    and coalesce((
      select event.value->>'eventType' = 'baseball.game_ended'
        and event.value#>>'{payload,outcome}' in ('completed', 'run_rule', 'time_limit')
      from jsonb_array_elements(case when jsonb_typeof(p_snapshot#>'{eventStream,events}') = 'array'
        then p_snapshot#>'{eventStream,events}' else '[]'::jsonb end)
        with ordinality event(value, ordinality)
      where event.value->>'eventType' in ('baseball.game_ended', 'baseball.game_reopened')
        and nullif(event.value->>'deletedAt', '') is null
      order by case when (event.value->>'sequence') ~ '^[0-9]+$'
        then (event.value->>'sequence')::bigint else -1 end desc,
        event.value->>'id' desc, event.ordinality desc
      limit 1
    ), false);
$$;

create index idx_baseball_canonical_publications_active_finalized
  on public.game_event_canonical_publications(finalized_at desc, id desc)
  where invalidated_at is null and sport_id = 'baseball';

-- Exact latest-075 body except the Baseball sport/eligibility/personal-pin branches.
create or replace function public._event_aggregate_publication_page(
  p_sport_id text,
  p_scope_type text default null,
  p_scope_id uuid default null,
  p_player_id uuid default null,
  p_team_id uuid default null,
  p_season_id uuid default null,
  p_before_finalized_at timestamptz default null,
  p_before_publication_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := coalesce(p_limit, 20);
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.has_active_app_access() then
    raise insufficient_privilege using message = 'APP_ACCESS_UNAVAILABLE';
  end if;
  if p_sport_id not in ('soccer', 'basketball', 'hockey', 'baseball') then
    raise exception 'Aggregate sport is invalid';
  end if;
  if (p_player_id is null) = (p_scope_type is null) then
    raise exception 'Aggregate request must select one scope mode';
  end if;
  if p_scope_type is not null and p_scope_type not in ('team', 'season', 'tournament') then
    raise exception 'Aggregate scope type is invalid';
  end if;
  if p_scope_type is not null and p_scope_id is null then
    raise exception 'Aggregate scope id is required';
  end if;
  if v_limit < 1 or v_limit > 50 then
    raise exception 'Aggregate page size must be between 1 and 50';
  end if;
  if (p_before_finalized_at is null) <> (p_before_publication_id is null) then
    raise exception 'Aggregate cursor must include both finalized_at and publication_id';
  end if;

  with eligible as (
    select
      publication.*,
      game.game_date,
      game.status as game_status,
      game.cloud_scope,
      game.team_id,
      game.season_id,
      game.tournament_id,
      baseball.identity as baseball_identity,
      coalesce(nullif(trim(game.tracked_team_name), ''), team.name, 'Personal')
        as tracked_team_name,
      game.opponent_name,
      case
        when game.cloud_scope = 'personal' then game.created_by = v_user_id
        else public.current_team_role(game.team_id) in ('owner', 'admin')
      end as can_manage
    from public.game_event_canonical_publications publication
    join public.games game on game.id = publication.game_id
    left join public.teams team on team.id = game.team_id
    left join lateral (
      select public._baseball_personal_publication_identity(publication.id) as identity
      where p_sport_id = 'baseball' and game.cloud_scope = 'personal'
    ) baseball on true
    where publication.invalidated_at is null
      and publication.sport_id = p_sport_id
      and game.sport_id = p_sport_id
      and game.status = 'final'
      and public.can_read_game(game.id)
      and (
        p_sport_id = 'soccer'
        or exists (
          select 1
          from public.game_event_setup_snapshots setup
          where setup.game_id = game.id
            and setup.sport_id = p_sport_id
        )
      )
      and (
        p_sport_id in ('hockey', 'baseball')
        or public._event_aggregate_snapshot_completed(
          p_sport_id,
          publication.canonical_snapshot
        )
      )
      and (
        p_sport_id <> 'basketball'
        or public._basketball_canonical_snapshot_completed(publication.canonical_snapshot)
      )
      and (
        p_sport_id <> 'hockey'
        or public._hockey_canonical_snapshot_completed(publication.canonical_snapshot)
      )
      and (
        p_sport_id <> 'baseball'
        or public._baseball_canonical_snapshot_completed(publication.canonical_snapshot)
      )
      and (
        (
          p_scope_type is not null
          and game.cloud_scope = 'team'
          and (
            (p_scope_type = 'team' and game.team_id = p_scope_id)
            or (p_scope_type = 'season' and game.season_id = p_scope_id)
            or (p_scope_type = 'tournament' and game.tournament_id = p_scope_id)
          )
        )
        or (
          p_player_id is not null
          and (p_team_id is null or game.team_id = p_team_id)
          and (p_season_id is null or game.season_id = p_season_id)
          and (p_sport_id <> 'soccer' or game.cloud_scope = 'team')
          and (
            case when p_sport_id = 'baseball' and game.cloud_scope = 'personal' then
              public._baseball_personal_player_authorized(p_player_id, v_user_id)
              and (
                baseball.identity->>'status' = 'invalid'
                or exists (select 1 from jsonb_each_text(case
                  when jsonb_typeof(baseball.identity->'participantSourceMap') = 'object'
                    then baseball.identity->'participantSourceMap' else '{}'::jsonb end) entry
                  where entry.value = p_player_id::text)
              )
            else exists (
              select 1
              from public.game_participants participant
              where participant.game_id = game.id
                and participant.source_player_id = p_player_id
            ) end
          )
        )
      )
      and (
        p_before_finalized_at is null
        or (publication.finalized_at, publication.id)
          < (p_before_finalized_at, p_before_publication_id)
      )
    order by publication.finalized_at desc, publication.id desc
    limit v_limit + 1
  ),
  ranked as (
    select eligible.*,
      row_number() over (order by eligible.finalized_at desc, eligible.id desc) as page_row
    from eligible
  ),
  itemized as (
    select
      ranked.page_row,
      ranked.finalized_at,
      ranked.id,
      jsonb_build_object(
        'publicationId', ranked.id,
        'publicationNumber', ranked.publication_number,
        'snapshotFingerprint', ranked.snapshot_fingerprint,
        'finalizedAt', ranked.finalized_at,
        'eventCount', ranked.event_count,
        'payloadBytes', octet_length(convert_to(ranked.canonical_snapshot::text, 'UTF8')),
        'game', jsonb_build_object(
          'id', ranked.game_id,
          'date', to_char(ranked.game_date, 'YYYY-MM-DD'),
          'status', ranked.game_status,
          'cloudScope', ranked.cloud_scope,
          'teamId', ranked.team_id,
          'seasonId', ranked.season_id,
          'tournamentId', ranked.tournament_id,
          'trackedTeamName', ranked.tracked_team_name,
          'opponentName', ranked.opponent_name
        ),
        'canonicalSnapshot', ranked.canonical_snapshot,
        'participantSourceMap',
          case when p_sport_id = 'baseball' and ranked.cloud_scope = 'personal'
            then ranked.baseball_identity->'participantSourceMap'
            else public._event_aggregate_participant_source_map(p_sport_id, ranked.game_id) end,
        'canManage', ranked.can_manage
      ) || case when p_sport_id = 'baseball' then jsonb_build_object(
        'participantMapFingerprint', ranked.baseball_identity->'mapFingerprint',
        'identityStatus', coalesce(ranked.baseball_identity->>'status', 'valid'),
        'identityDiagnostic', ranked.baseball_identity->'diagnostic'
      ) else '{}'::jsonb end as item
    from ranked
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(itemized.item order by itemized.finalized_at desc, itemized.id desc)
      from itemized
      where itemized.page_row <= v_limit
    ), '[]'::jsonb),
    'nextCursor', case
      when exists (select 1 from itemized where itemized.page_row = v_limit + 1)
        then (
          select jsonb_build_object(
            'finalizedAt', itemized.finalized_at,
            'publicationId', itemized.id
          )
          from itemized
          where itemized.page_row = v_limit
        )
      else null
    end
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_baseball_scope_aggregate_publications(
  p_scope_type text, p_scope_id uuid, p_before_finalized_at timestamptz default null,
  p_before_publication_id uuid default null, p_limit integer default 20
)
returns jsonb language sql stable security definer set search_path = public
as $$
  select public._event_aggregate_publication_page('baseball', p_scope_type, p_scope_id,
    null, null, null, p_before_finalized_at, p_before_publication_id, p_limit);
$$;

create or replace function public.get_baseball_player_aggregate_publications(
  p_player_id uuid, p_team_id uuid default null, p_season_id uuid default null,
  p_before_finalized_at timestamptz default null, p_before_publication_id uuid default null,
  p_limit integer default 20
)
returns jsonb language sql stable security definer set search_path = public
as $$
  select public._event_aggregate_publication_page('baseball', null, null,
    p_player_id, p_team_id, p_season_id, p_before_finalized_at, p_before_publication_id, p_limit);
$$;

create or replace function public.get_baseball_aggregate_capabilities()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  if not public.has_active_app_access() then raise insufficient_privilege using message = 'APP_ACCESS_UNAVAILABLE'; end if;
  if not public.is_event_platform_sport('baseball')
     or to_regclass('public.game_event_canonical_publications') is null
     or to_regclass('public.game_participants') is null
     or to_regclass('public.player_merge_audit') is null
     or to_regclass('public.baseball_personal_publication_pins') is null
     or to_regclass('public.baseball_personal_link_receipts') is null
     or to_regprocedure('public._baseball_personal_player_authorized(uuid,uuid)') is null
     or to_regprocedure('public._baseball_personal_raw_map(uuid,jsonb)') is null
     or to_regprocedure('public._baseball_personal_publication_identity(uuid)') is null
     or to_regprocedure('public._baseball_personal_resolve_source(uuid,uuid)') is null
     or to_regprocedure('public._baseball_canonical_snapshot_completed(jsonb)') is null
     or to_regprocedure('public._event_aggregate_publication_page(text,text,uuid,uuid,uuid,uuid,timestamptz,uuid,integer)') is null
     or to_regprocedure('public.get_baseball_scope_aggregate_publications(text,uuid,timestamptz,uuid,integer)') is null
     or to_regprocedure('public.get_baseball_player_aggregate_publications(uuid,uuid,uuid,timestamptz,uuid,integer)') is null
     or not exists (select 1 from pg_trigger where tgrelid = 'public.game_event_canonical_publications'::regclass
       and tgname = 'baseball_personal_pin_publication' and tgenabled in ('O', 'A') and tgtype = 5
       and tgfoid = to_regprocedure('public._baseball_personal_pin_publication()')) then
    return jsonb_build_object('contractVersion', 0);
  end if;
  return jsonb_build_object('contractVersion', 1, 'sportId', 'baseball', 'aggregateContractVersion', 1, 'migration', 79);
end;
$$;

create or replace function public.get_baseball_personal_link_capabilities()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  if not public.has_active_app_access() then raise insufficient_privilege using message = 'APP_ACCESS_UNAVAILABLE'; end if;
  if to_regclass('public.baseball_personal_publication_pins') is null
     or to_regclass('public.baseball_personal_link_receipts') is null
     or to_regprocedure('public._baseball_personal_player_authorized(uuid,uuid)') is null
     or to_regprocedure('public._baseball_personal_lock_player(uuid)') is null
     or to_regprocedure('public._baseball_personal_raw_map(uuid,jsonb)') is null
     or to_regprocedure('public.get_baseball_personal_participant_links(uuid)') is null
     or to_regprocedure('public.link_baseball_personal_participant(uuid,text,uuid,text,uuid,text,uuid)') is null
     or to_regprocedure('public.finalize_baseball_event_game_reviewed(uuid,uuid,jsonb,text,jsonb,text)') is null
     or not exists (select 1 from pg_trigger where tgrelid = 'public.game_event_canonical_publications'::regclass
       and tgname = 'baseball_personal_pin_publication' and tgenabled in ('O', 'A') and tgtype = 5
       and tgfoid = to_regprocedure('public._baseball_personal_pin_publication()')) then
    return jsonb_build_object('contractVersion', 0);
  end if;
  return jsonb_build_object('contractVersion', 1, 'sportId', 'baseball', 'personalLinkContractVersion', 1,
    'publicationIdentityVersion', 1, 'reviewedFinalizationVersion', 1, 'migration', 79);
end;
$$;

revoke all on function public._baseball_personal_player_authorized(uuid, uuid) from public, anon, authenticated;
revoke all on function public._baseball_personal_lock_player(uuid) from public, anon, authenticated;
revoke all on function public._baseball_personal_raw_map(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._baseball_personal_pin_publication() from public, anon, authenticated;
revoke all on function public._baseball_personal_resolve_source(uuid, uuid) from public, anon, authenticated;
revoke all on function public._baseball_personal_publication_identity(uuid) from public, anon, authenticated;
revoke all on function public._baseball_canonical_snapshot_completed(jsonb) from public, anon, authenticated;
revoke all on function public._event_aggregate_publication_page(text, text, uuid, uuid, uuid, uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.get_baseball_personal_participant_links(uuid) from public, anon, authenticated;
revoke all on function public.link_baseball_personal_participant(uuid, text, uuid, text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.finalize_baseball_event_game_reviewed(uuid, uuid, jsonb, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.get_baseball_scope_aggregate_publications(text, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.get_baseball_player_aggregate_publications(uuid, uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.get_baseball_aggregate_capabilities() from public, anon, authenticated;
revoke all on function public.get_baseball_personal_link_capabilities() from public, anon, authenticated;
grant execute on function public.get_baseball_personal_participant_links(uuid) to authenticated;
grant execute on function public.link_baseball_personal_participant(uuid, text, uuid, text, uuid, text, uuid) to authenticated;
grant execute on function public.finalize_baseball_event_game_reviewed(uuid, uuid, jsonb, text, jsonb, text) to authenticated;
grant execute on function public.get_baseball_scope_aggregate_publications(text, uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.get_baseball_player_aggregate_publications(uuid, uuid, uuid, timestamptz, uuid, integer) to authenticated;
grant execute on function public.get_baseball_aggregate_capabilities() to authenticated;
grant execute on function public.get_baseball_personal_link_capabilities() to authenticated;

comment on table public.baseball_personal_publication_pins is
  'Private immutable schema-1 personal Baseball identity sidecars. UUIDs have no player FK or merge rewrite.';
comment on table public.baseball_personal_link_receipts is
  'Private account/operation-scoped atomic Baseball personal-link receipts and audit; no direct client access.';
notify pgrst, 'reload schema';
commit;
