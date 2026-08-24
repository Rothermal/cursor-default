-- BKE-5B1: fixed Basketball settings validation and revisioned writes.
-- Existing broad sport-settings validators and public RPCs stay unchanged.

create or replace function public._basketball_settings_exact_keys(
  p_value jsonb,
  p_keys text[]
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(p_value) = 'object'
    and p_value ?& p_keys
    and (select count(*) from jsonb_object_keys(p_value)) = cardinality(p_keys);
$$;

create or replace function public._basketball_settings_valid_bonus_policy(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_bonus integer;
  v_double integer;
  v_one_and_one boolean;
begin
  if jsonb_typeof(p_value->'hasOneAndOne') is distinct from 'boolean' then
    return false;
  end if;
  if p_value->'bonusThreshold' <> 'null'::jsonb
     and (
       not public._sport_settings_is_integer(p_value->'bonusThreshold')
       or (p_value->>'bonusThreshold')::integer <= 0
     ) then
    return false;
  end if;
  if p_value->'doubleBonusThreshold' <> 'null'::jsonb
     and (
       not public._sport_settings_is_integer(p_value->'doubleBonusThreshold')
       or (p_value->>'doubleBonusThreshold')::integer <= 0
     ) then
    return false;
  end if;
  if p_value->'bonusThreshold' = 'null'::jsonb then
    return p_value->'doubleBonusThreshold' = 'null'::jsonb
      and (p_value->>'hasOneAndOne')::boolean = false;
  end if;
  if p_value->'doubleBonusThreshold' = 'null'::jsonb then return false; end if;
  v_bonus := (p_value->>'bonusThreshold')::integer;
  v_double := (p_value->>'doubleBonusThreshold')::integer;
  v_one_and_one := (p_value->>'hasOneAndOne')::boolean;
  return v_double >= v_bonus and (v_one_and_one or v_double = v_bonus);
end;
$$;

create or replace function public._basketball_settings_valid_timeout_limits(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text;
  v_total integer;
begin
  foreach v_key in array array['totalLimit', 'fullLimit', 'shortLimit']
  loop
    if p_value->v_key <> 'null'::jsonb
       and (
         not public._sport_settings_is_integer(p_value->v_key)
         or (p_value->>v_key)::integer < 0
       ) then
      return false;
    end if;
  end loop;
  if p_value->'totalLimit' = 'null'::jsonb then return true; end if;
  v_total := (p_value->>'totalLimit')::integer;
  return (p_value->'fullLimit' = 'null'::jsonb or (p_value->>'fullLimit')::integer <= v_total)
    and (p_value->'shortLimit' = 'null'::jsonb or (p_value->>'shortLimit')::integer <= v_total);
end;
$$;

create or replace function public._validate_basketball_profile_ref(p_profile jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if not public._basketball_settings_exact_keys(
    p_profile,
    array['profileId', 'profileVersion']
  ) then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball profile reference is invalid';
  end if;
  if jsonb_typeof(p_profile->'profileId') is distinct from 'string'
     or not public._sport_settings_is_integer(p_profile->'profileVersion')
     or (p_profile->>'profileVersion')::integer <> 1
     or p_profile->>'profileId' not in (
       'nfhs',
       'ncaa_men',
       'ncaa_women',
       'nba',
       'fiba',
       'youth_standard',
       'youth_equal_play'
     ) then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball profile reference is unsupported';
  end if;
end;
$$;

create or replace function public._validate_basketball_rule_overrides(p_overrides jsonb)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_allowed constant text[] := array[
    'regulationSegments',
    'overtimeTemplate',
    'foulWindows',
    'timeoutPools',
    'personalFoulLimit',
    'clockModel'
  ];
  v_structural_count integer;
  v_item jsonb;
  v_policy jsonb;
  v_segment_id text;
  v_segment_ids text[] := array[]::text[];
  v_foul_ids text[] := array[]::text[];
  v_pool_ids text[] := array[]::text[];
  v_count integer;
  v_source_order integer;
  v_target_order integer;
begin
  if jsonb_typeof(p_overrides) is distinct from 'object'
     or exists (
       select 1
       from jsonb_object_keys(p_overrides) key
       where not (key = any(v_allowed))
     ) then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball rule overrides are invalid';
  end if;

  if p_overrides ? 'personalFoulLimit'
     and (
       not public._sport_settings_is_integer(p_overrides->'personalFoulLimit')
       or (p_overrides->>'personalFoulLimit')::integer <= 0
       or (p_overrides->>'personalFoulLimit')::integer > 20
     ) then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball personal foul limit is invalid';
  end if;
  if p_overrides ? 'clockModel'
     and (
       jsonb_typeof(p_overrides->'clockModel') is distinct from 'string'
       or p_overrides->>'clockModel' <> 'none'
     ) then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball clock model is invalid';
  end if;

  v_structural_count :=
    (case when p_overrides ? 'regulationSegments' then 1 else 0 end) +
    (case when p_overrides ? 'overtimeTemplate' then 1 else 0 end) +
    (case when p_overrides ? 'foulWindows' then 1 else 0 end) +
    (case when p_overrides ? 'timeoutPools' then 1 else 0 end);
  if v_structural_count = 0 then
    return;
  end if;
  if v_structural_count <> 4 then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball structural overrides must be saved together';
  end if;

  if jsonb_typeof(p_overrides->'regulationSegments') is distinct from 'array'
     or jsonb_array_length(p_overrides->'regulationSegments') not between 1 and 20 then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball regulation segments are invalid';
  end if;
  for v_item in select value from jsonb_array_elements(p_overrides->'regulationSegments')
  loop
    if not public._basketball_settings_exact_keys(
      v_item,
      array[
        'id', 'label', 'kind', 'order', 'durationMs', 'foulWindowId',
        'timeoutPoolId', 'lineupChangeBoundary'
      ]
    )
       or jsonb_typeof(v_item->'id') is distinct from 'string'
       or nullif(trim(v_item->>'id'), '') is null
       or length(v_item->>'id') > 80
       or (v_item->>'id') = any(v_segment_ids)
       or jsonb_typeof(v_item->'label') is distinct from 'string'
       or nullif(trim(v_item->>'label'), '') is null
       or length(v_item->>'label') > 120
       or v_item->>'kind' <> 'regulation'
       or not public._sport_settings_is_integer(v_item->'order')
       or (v_item->>'order')::integer <> cardinality(v_segment_ids) + 1
       or not public._sport_settings_is_integer(v_item->'durationMs')
       or (v_item->>'durationMs')::integer <= 0
       or jsonb_typeof(v_item->'foulWindowId') is distinct from 'string'
       or nullif(trim(v_item->>'foulWindowId'), '') is null
       or jsonb_typeof(v_item->'timeoutPoolId') is distinct from 'string'
       or nullif(trim(v_item->>'timeoutPoolId'), '') is null
       or jsonb_typeof(v_item->'lineupChangeBoundary') is distinct from 'boolean' then
      raise exception 'SPORT_SETTINGS_INVALID: Basketball regulation segment is invalid';
    end if;
    v_segment_ids := array_append(v_segment_ids, v_item->>'id');
  end loop;

  if jsonb_typeof(p_overrides->'foulWindows') is distinct from 'array'
     or jsonb_array_length(p_overrides->'foulWindows') not between 1 and 20 then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball foul windows are invalid';
  end if;
  for v_item in select value from jsonb_array_elements(p_overrides->'foulWindows')
  loop
    if not public._basketball_settings_exact_keys(
      v_item,
      array[
        'id', 'label', 'segmentIds', 'bonusThreshold',
        'doubleBonusThreshold', 'hasOneAndOne'
      ]
    )
       or jsonb_typeof(v_item->'id') is distinct from 'string'
       or nullif(trim(v_item->>'id'), '') is null
       or length(v_item->>'id') > 80
       or (v_item->>'id') = any(v_foul_ids)
       or jsonb_typeof(v_item->'label') is distinct from 'string'
       or nullif(trim(v_item->>'label'), '') is null
       or length(v_item->>'label') > 120
       or jsonb_typeof(v_item->'segmentIds') is distinct from 'array'
       or jsonb_array_length(v_item->'segmentIds') = 0
       or not public._basketball_settings_valid_bonus_policy(v_item) then
      raise exception 'SPORT_SETTINGS_INVALID: Basketball foul window is invalid';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(v_item->'segmentIds') segment
      where jsonb_typeof(segment) <> 'string'
        or not ((segment #>> '{}') = any(v_segment_ids))
    ) then
      raise exception 'SPORT_SETTINGS_INVALID: Basketball foul window segment is invalid';
    end if;
    v_foul_ids := array_append(v_foul_ids, v_item->>'id');
  end loop;

  if jsonb_typeof(p_overrides->'timeoutPools') is distinct from 'array'
     or jsonb_array_length(p_overrides->'timeoutPools') not between 1 and 20 then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball timeout pools are invalid';
  end if;
  for v_item in select value from jsonb_array_elements(p_overrides->'timeoutPools')
  loop
    if not public._basketball_settings_exact_keys(
      v_item,
      array[
        'id', 'label', 'segmentIds', 'totalLimit', 'fullLimit', 'shortLimit',
        'carryoverToPoolId'
      ]
    )
       or jsonb_typeof(v_item->'id') is distinct from 'string'
       or nullif(trim(v_item->>'id'), '') is null
       or length(v_item->>'id') > 80
       or (v_item->>'id') = any(v_pool_ids)
       or jsonb_typeof(v_item->'label') is distinct from 'string'
       or nullif(trim(v_item->>'label'), '') is null
       or length(v_item->>'label') > 120
       or jsonb_typeof(v_item->'segmentIds') is distinct from 'array'
       or jsonb_array_length(v_item->'segmentIds') = 0
       or exists (
         select 1
         from jsonb_array_elements(v_item->'segmentIds') segment
         where jsonb_typeof(segment) <> 'string'
           or not ((segment #>> '{}') = any(v_segment_ids))
       ) then
      raise exception 'SPORT_SETTINGS_INVALID: Basketball timeout pool is invalid';
    end if;
    if not public._basketball_settings_valid_timeout_limits(v_item) then
      raise exception 'SPORT_SETTINGS_INVALID: Basketball timeout limit is invalid';
    end if;
    v_pool_ids := array_append(v_pool_ids, v_item->>'id');
  end loop;

  for v_item in select value from jsonb_array_elements(p_overrides->'timeoutPools')
  loop
    if v_item->'carryoverToPoolId' <> 'null'::jsonb
       and (
         jsonb_typeof(v_item->'carryoverToPoolId') is distinct from 'string'
         or not ((v_item->>'carryoverToPoolId') = any(v_pool_ids))
         or v_item->>'carryoverToPoolId' = v_item->>'id'
       ) then
      raise exception 'SPORT_SETTINGS_INVALID: Basketball timeout carryover is invalid';
    end if;
    if v_item->'carryoverToPoolId' <> 'null'::jsonb then
      select min((segment->>'order')::integer) into v_source_order
      from jsonb_array_elements(p_overrides->'regulationSegments') segment
      where segment->>'timeoutPoolId' = v_item->>'id';
      select min((segment->>'order')::integer) into v_target_order
      from jsonb_array_elements(p_overrides->'regulationSegments') segment
      where segment->>'timeoutPoolId' = v_item->>'carryoverToPoolId';
      if v_target_order is null or v_source_order is null or v_target_order <= v_source_order then
        raise exception 'SPORT_SETTINGS_INVALID: Basketball timeout carryover must move forward';
      end if;
    end if;
  end loop;

  foreach v_segment_id in array v_segment_ids
  loop
    select count(*) into v_count
    from jsonb_array_elements(p_overrides->'foulWindows') foul_window,
      jsonb_array_elements_text(foul_window->'segmentIds') segment_id
    where segment_id = v_segment_id;
    if v_count <> 1 then
      raise exception 'SPORT_SETTINGS_INVALID: Basketball foul-window assignment is invalid';
    end if;
    select count(*) into v_count
    from jsonb_array_elements(p_overrides->'timeoutPools') pool,
      jsonb_array_elements_text(pool->'segmentIds') segment_id
    where segment_id = v_segment_id;
    if v_count <> 1 then
      raise exception 'SPORT_SETTINGS_INVALID: Basketball timeout-pool assignment is invalid';
    end if;
    select count(*) into v_count
    from jsonb_array_elements(p_overrides->'regulationSegments') segment
    join jsonb_array_elements(p_overrides->'foulWindows') foul_window
      on foul_window->>'id' = segment->>'foulWindowId'
    where segment->>'id' = v_segment_id
      and (foul_window->'segmentIds') ? v_segment_id;
    if v_count <> 1 then
      raise exception 'SPORT_SETTINGS_INVALID: Basketball segment foul-window reference is invalid';
    end if;
    select count(*) into v_count
    from jsonb_array_elements(p_overrides->'regulationSegments') segment
    join jsonb_array_elements(p_overrides->'timeoutPools') pool
      on pool->>'id' = segment->>'timeoutPoolId'
    where segment->>'id' = v_segment_id
      and (pool->'segmentIds') ? v_segment_id;
    if v_count <> 1 then
      raise exception 'SPORT_SETTINGS_INVALID: Basketball segment timeout-pool reference is invalid';
    end if;
  end loop;

  v_item := p_overrides->'overtimeTemplate';
  if not public._basketball_settings_exact_keys(
    v_item,
    array[
      'idPrefix', 'label', 'durationMs', 'foulPolicy', 'timeoutPolicy',
      'lineupChangeBoundary'
    ]
  )
     or jsonb_typeof(v_item->'idPrefix') is distinct from 'string'
     or nullif(trim(v_item->>'idPrefix'), '') is null
     or length(v_item->>'idPrefix') > 80
     or jsonb_typeof(v_item->'label') is distinct from 'string'
     or nullif(trim(v_item->>'label'), '') is null
     or length(v_item->>'label') > 120
     or not public._sport_settings_is_integer(v_item->'durationMs')
     or (v_item->>'durationMs')::integer <= 0
     or jsonb_typeof(v_item->'lineupChangeBoundary') is distinct from 'boolean' then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball overtime template is invalid';
  end if;

  v_policy := v_item->'foulPolicy';
  if not public._basketball_settings_exact_keys(
    v_policy,
    array['mode', 'regulationWindowId', 'window']
  )
     or v_policy->>'mode' not in ('continue', 'new_each', 'shared_overtimes') then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball overtime foul policy is invalid';
  end if;
  if v_policy->>'mode' = 'continue' then
    if v_policy->'window' <> 'null'::jsonb
       or jsonb_typeof(v_policy->'regulationWindowId') is distinct from 'string'
       or not ((v_policy->>'regulationWindowId') = any(v_foul_ids)) then
      raise exception 'SPORT_SETTINGS_INVALID: Basketball overtime foul continuation is invalid';
    end if;
  elsif v_policy->'regulationWindowId' <> 'null'::jsonb
     or not public._basketball_settings_exact_keys(
       v_policy->'window',
       array['label', 'bonusThreshold', 'doubleBonusThreshold', 'hasOneAndOne']
     )
     or jsonb_typeof(v_policy->'window'->'label') is distinct from 'string'
     or nullif(trim(v_policy->'window'->>'label'), '') is null
     or length(v_policy->'window'->>'label') > 120
     or not public._basketball_settings_valid_bonus_policy(v_policy->'window') then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball overtime foul window is invalid';
  end if;

  v_policy := v_item->'timeoutPolicy';
  if not public._basketball_settings_exact_keys(
    v_policy,
    array['mode', 'regulationPoolId', 'pool', 'additionsPerOvertime']
  )
     or v_policy->>'mode' not in ('continue', 'new_each', 'shared_overtimes')
     or not public._basketball_settings_exact_keys(
       v_policy->'additionsPerOvertime',
       array['total', 'full', 'short']
     ) then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball overtime timeout policy is invalid';
  end if;
  foreach v_segment_id in array array['total', 'full', 'short']
  loop
    if not public._sport_settings_is_integer(
      v_policy->'additionsPerOvertime'->v_segment_id
    )
       or (v_policy->'additionsPerOvertime'->>v_segment_id)::integer < 0 then
      raise exception 'SPORT_SETTINGS_INVALID: Basketball overtime timeout addition is invalid';
    end if;
  end loop;
  if v_policy->>'mode' = 'new_each'
     and (
       (v_policy->'additionsPerOvertime'->>'total')::integer <> 0
       or (v_policy->'additionsPerOvertime'->>'full')::integer <> 0
       or (v_policy->'additionsPerOvertime'->>'short')::integer <> 0
     ) then
    raise exception 'SPORT_SETTINGS_INVALID: per-overtime timeout pools cannot accumulate additions';
  end if;
  if v_policy->>'mode' = 'continue' then
    if v_policy->'pool' <> 'null'::jsonb
       or jsonb_typeof(v_policy->'regulationPoolId') is distinct from 'string'
       or not ((v_policy->>'regulationPoolId') = any(v_pool_ids)) then
      raise exception 'SPORT_SETTINGS_INVALID: Basketball overtime timeout continuation is invalid';
    end if;
  elsif v_policy->'regulationPoolId' <> 'null'::jsonb
     or not public._basketball_settings_exact_keys(
       v_policy->'pool',
       array['label', 'totalLimit', 'fullLimit', 'shortLimit']
     )
     or jsonb_typeof(v_policy->'pool'->'label') is distinct from 'string'
     or nullif(trim(v_policy->'pool'->>'label'), '') is null
     or length(v_policy->'pool'->>'label') > 120
     or not public._basketball_settings_valid_timeout_limits(v_policy->'pool') then
    raise exception 'SPORT_SETTINGS_INVALID: Basketball overtime timeout pool is invalid';
  end if;
end;
$$;

create or replace function public._validate_basketball_settings_payload(
  p_scope text,
  p_settings jsonb
)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_scope = 'user' then
    if not public._basketball_settings_exact_keys(
      p_settings,
      array['baseProfile', 'ruleOverrides', 'capture', 'display']
    )
       or not public._basketball_settings_exact_keys(
         p_settings->'capture',
         array['reboundPromptAfterMiss']
       )
       or jsonb_typeof(p_settings->'capture'->'reboundPromptAfterMiss')
         is distinct from 'boolean'
       or not public._basketball_settings_exact_keys(
         p_settings->'display',
         array['defaultCourtFlipped']
       )
       or jsonb_typeof(p_settings->'display'->'defaultCourtFlipped')
         is distinct from 'boolean' then
      raise exception 'SPORT_SETTINGS_INVALID: Basketball personal settings are invalid';
    end if;
  elsif p_scope = 'team' then
    if not public._basketball_settings_exact_keys(
      p_settings,
      array['baseProfile', 'ruleOverrides']
    ) then
      raise exception 'SPORT_SETTINGS_INVALID: Basketball team settings are invalid';
    end if;
  else
    raise exception 'SPORT_SETTINGS_INVALID: settings scope is invalid';
  end if;

  perform public._validate_basketball_profile_ref(p_settings->'baseProfile');
  perform public._validate_basketball_rule_overrides(p_settings->'ruleOverrides');
end;
$$;

create or replace function public._save_sport_settings_revisioned_core(
  p_scope text,
  p_user_id uuid,
  p_team_id uuid,
  p_sport_id text,
  p_schema_version integer,
  p_expected_revision bigint,
  p_settings jsonb,
  p_audit_event_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_existing public.user_sport_settings%rowtype;
  v_user_saved public.user_sport_settings%rowtype;
  v_team_existing public.team_sport_settings%rowtype;
  v_team_saved public.team_sport_settings%rowtype;
  v_previous_settings jsonb := '{}'::jsonb;
  v_changed_fields jsonb := '[]'::jsonb;
begin
  if p_scope = 'user' then
    select * into v_user_existing
    from public.user_sport_settings
    where user_id = p_user_id and sport_id = p_sport_id
    for update;

    if found then
      if p_expected_revision is null or p_expected_revision <> v_user_existing.revision then
        return jsonb_build_object(
          'status', 'conflict',
          'record', public._sport_settings_record_json(
            v_user_existing.sport_id,
            v_user_existing.schema_version,
            v_user_existing.revision,
            v_user_existing.settings,
            v_user_existing.updated_at,
            null
          )
        );
      end if;
      update public.user_sport_settings
      set schema_version = p_schema_version,
        revision = revision + 1,
        settings = p_settings,
        updated_at = now()
      where user_id = p_user_id
        and sport_id = p_sport_id
        and revision = p_expected_revision
      returning * into v_user_saved;
    else
      if p_expected_revision is not null then
        return jsonb_build_object('status', 'conflict', 'record', null);
      end if;
      insert into public.user_sport_settings (
        user_id, sport_id, schema_version, settings
      ) values (
        p_user_id, p_sport_id, p_schema_version, p_settings
      )
      on conflict (user_id, sport_id) do nothing
      returning * into v_user_saved;
    end if;

    if v_user_saved.user_id is null then
      select * into v_user_existing
      from public.user_sport_settings
      where user_id = p_user_id and sport_id = p_sport_id;
      return jsonb_build_object(
        'status', 'conflict',
        'record', case when found then public._sport_settings_record_json(
          v_user_existing.sport_id,
          v_user_existing.schema_version,
          v_user_existing.revision,
          v_user_existing.settings,
          v_user_existing.updated_at,
          null
        ) else null end
      );
    end if;
    return jsonb_build_object(
      'status', 'applied',
      'record', public._sport_settings_record_json(
        v_user_saved.sport_id,
        v_user_saved.schema_version,
        v_user_saved.revision,
        v_user_saved.settings,
        v_user_saved.updated_at,
        null
      )
    );
  end if;

  if p_scope <> 'team' or p_team_id is null then
    raise exception 'SPORT_SETTINGS_INVALID: settings scope is invalid';
  end if;

  select * into v_team_existing
  from public.team_sport_settings
  where team_id = p_team_id and sport_id = p_sport_id
  for update;
  if found then
    if p_expected_revision is null or p_expected_revision <> v_team_existing.revision then
      return jsonb_build_object(
        'status', 'conflict',
        'record', public._sport_settings_record_json(
          v_team_existing.sport_id,
          v_team_existing.schema_version,
          v_team_existing.revision,
          v_team_existing.settings,
          v_team_existing.updated_at,
          v_team_existing.updated_by
        )
      );
    end if;
    v_previous_settings := v_team_existing.settings;
    update public.team_sport_settings
    set schema_version = p_schema_version,
      revision = revision + 1,
      settings = p_settings,
      updated_at = now(),
      updated_by = p_user_id
    where team_id = p_team_id
      and sport_id = p_sport_id
      and revision = p_expected_revision
    returning * into v_team_saved;
  else
    if p_expected_revision is not null then
      return jsonb_build_object('status', 'conflict', 'record', null);
    end if;
    insert into public.team_sport_settings (
      team_id, sport_id, schema_version, settings, updated_by
    ) values (
      p_team_id, p_sport_id, p_schema_version, p_settings, p_user_id
    )
    on conflict (team_id, sport_id) do nothing
    returning * into v_team_saved;
  end if;

  if v_team_saved.team_id is null then
    select * into v_team_existing
    from public.team_sport_settings
    where team_id = p_team_id and sport_id = p_sport_id;
    return jsonb_build_object(
      'status', 'conflict',
      'record', case when found then public._sport_settings_record_json(
        v_team_existing.sport_id,
        v_team_existing.schema_version,
        v_team_existing.revision,
        v_team_existing.settings,
        v_team_existing.updated_at,
        v_team_existing.updated_by
      ) else null end
    );
  end if;

  select coalesce(jsonb_agg(changed.key order by changed.key), '[]'::jsonb)
  into v_changed_fields
  from (
    select candidate.key
    from (
      select jsonb_object_keys(v_previous_settings) as key
      union
      select jsonb_object_keys(p_settings) as key
    ) candidate
    where v_previous_settings->candidate.key is distinct from p_settings->candidate.key
  ) changed;
  perform public.record_access_audit_event(
    p_event_type => p_audit_event_type,
    p_actor_user_id => p_user_id,
    p_team_id => p_team_id,
    p_metadata => jsonb_build_object(
      'sport_id', p_sport_id,
      'revision', v_team_saved.revision,
      'changed_fields', v_changed_fields
    )
  );
  return jsonb_build_object(
    'status', 'applied',
    'record', public._sport_settings_record_json(
      v_team_saved.sport_id,
      v_team_saved.schema_version,
      v_team_saved.revision,
      v_team_saved.settings,
      v_team_saved.updated_at,
      v_team_saved.updated_by
    )
  );
end;
$$;

create or replace function public.save_basketball_user_settings_revisioned(
  p_expected_revision bigint,
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.has_active_app_access() then
    raise exception 'Active app access is required';
  end if;
  if p_expected_revision is not null and p_expected_revision <= 0 then
    raise exception 'SPORT_SETTINGS_INVALID: expected revision must be positive';
  end if;
  perform public._validate_basketball_settings_payload('user', p_settings);
  return public._save_sport_settings_revisioned_core(
    'user', v_user_id, null, 'basketball', 1, p_expected_revision, p_settings, null
  );
end;
$$;

create or replace function public.save_basketball_team_settings_revisioned(
  p_team_id uuid,
  p_expected_revision bigint,
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_team_sport text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not public.has_active_app_access() then
    raise exception 'Active app access is required';
  end if;
  if coalesce(public.current_team_role(p_team_id), '') not in ('owner', 'admin') then
    raise exception 'Team owner or admin access is required';
  end if;
  if p_expected_revision is not null and p_expected_revision <= 0 then
    raise exception 'SPORT_SETTINGS_INVALID: expected revision must be positive';
  end if;
  select season.sport into v_team_sport
  from public.teams team
  join public.seasons season on season.id = team.season_id
  where team.id = p_team_id;
  if v_team_sport is distinct from 'basketball' then
    raise exception 'Team sport does not match Basketball settings';
  end if;
  perform public._validate_basketball_settings_payload('team', p_settings);
  return public._save_sport_settings_revisioned_core(
    'team',
    v_user_id,
    p_team_id,
    'basketball',
    1,
    p_expected_revision,
    p_settings,
    'basketball_settings_changed'
  );
end;
$$;

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
    or to_regclass('public.user_sport_settings') is null
    or to_regclass('public.team_sport_settings') is null
    or to_regprocedure(
      'public.bind_basketball_event_game_v4(uuid,text,uuid,uuid,text,text,text,date,jsonb,jsonb)'
    ) is null
    or to_regprocedure(
      'public.upsert_game_event_revisioned(uuid,uuid,text,text,integer,bigint,integer,text,integer,bigint,timestamptz,text,jsonb,jsonb,jsonb,timestamptz,timestamptz,timestamptz)'
    ) is null
    or to_regprocedure('public.record_game_event_conflict(uuid,uuid,jsonb,jsonb)') is null
    or to_regprocedure('public.resolve_game_event_conflict(uuid,text,jsonb)') is null
    or to_regprocedure(
      'public.confirm_game_event_stream_checkpoint(uuid,integer,jsonb,integer,bigint,text)'
    ) is null
    or to_regprocedure('public.get_basketball_game_recorders(uuid)') is null
    or to_regprocedure('public.get_basketball_primary_recorder_history(uuid)') is null
    or to_regprocedure('public.set_basketball_primary_recorder(uuid,uuid)') is null
    or to_regprocedure('public.get_basketball_finalization_readiness(uuid)') is null
    or to_regprocedure('public.get_basketball_canonical_publication(uuid)') is null
    or to_regprocedure('public.get_basketball_primary_conflicts_for_finalization(uuid)') is null
    or to_regprocedure('public.resolve_basketball_primary_conflict_for_finalization(uuid,text)') is null
    or to_regprocedure(
      'public.confirm_basketball_primary_checkpoint_for_finalization(uuid,uuid,integer,jsonb,integer,bigint,text)'
    ) is null
    or to_regprocedure('public.finalize_basketball_event_game(uuid,uuid,jsonb,text,jsonb)') is null
    or to_regprocedure('public.get_basketball_canonical_publication_history(uuid)') is null
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
    or to_regprocedure('public.save_basketball_user_settings_revisioned(bigint,jsonb)') is null
    or to_regprocedure('public.save_basketball_team_settings_revisioned(uuid,bigint,jsonb)') is null
  then
    return jsonb_build_object('contractVersion', 0);
  end if;

  return jsonb_build_object(
    'contractVersion', 2,
    'migration', 62,
    'eventTransportVersion', 4,
    'recoveryVersion', 1,
    'recorderResolutionVersion', 1,
    'canonicalFinalizationVersion', 1,
    'summaryAuthorityVersion', 1,
    'aggregateSourceVersion', 1,
    'settingsContractVersion', 1
  );
end;
$$;

revoke all on function public._basketball_settings_exact_keys(jsonb, text[]) from public;
revoke all on function public._basketball_settings_valid_bonus_policy(jsonb) from public;
revoke all on function public._basketball_settings_valid_timeout_limits(jsonb) from public;
revoke all on function public._validate_basketball_profile_ref(jsonb) from public;
revoke all on function public._validate_basketball_rule_overrides(jsonb) from public;
revoke all on function public._validate_basketball_settings_payload(text, jsonb) from public;
revoke all on function public._save_sport_settings_revisioned_core(
  text, uuid, uuid, text, integer, bigint, jsonb, text
) from public;
revoke all on function public.save_basketball_user_settings_revisioned(bigint, jsonb)
  from public;
revoke all on function public.save_basketball_team_settings_revisioned(uuid, bigint, jsonb)
  from public;
revoke all on function public.get_basketball_release_capabilities() from public;

grant execute on function public.save_basketball_user_settings_revisioned(bigint, jsonb)
  to authenticated;
grant execute on function public.save_basketball_team_settings_revisioned(uuid, bigint, jsonb)
  to authenticated;
grant execute on function public.get_basketball_release_capabilities() to authenticated;

comment on function public.get_basketball_release_capabilities() is
  'Read-only exact-version preflight for Basketball BKE-4 and settings contract v1.';

notify pgrst, 'reload schema';
