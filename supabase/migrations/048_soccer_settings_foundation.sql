-- SOC-6D1: generic sport settings storage with soccer schema version 1 validation.
-- Personal and team writes are revision-aware RPCs; direct table writes remain denied.

create table if not exists public.user_sport_settings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  sport_id text not null check (sport_id ~ '^[a-z][a-z0-9_]{1,39}$'),
  schema_version integer not null check (schema_version > 0),
  revision bigint not null default 1 check (revision > 0),
  settings jsonb not null check (
    jsonb_typeof(settings) = 'object'
    and octet_length(settings::text) <= 65536
  ),
  updated_at timestamptz not null default now(),
  primary key (user_id, sport_id)
);

create table if not exists public.team_sport_settings (
  team_id uuid not null references public.teams(id) on delete cascade,
  sport_id text not null check (sport_id ~ '^[a-z][a-z0-9_]{1,39}$'),
  schema_version integer not null check (schema_version > 0),
  revision bigint not null default 1 check (revision > 0),
  settings jsonb not null check (
    jsonb_typeof(settings) = 'object'
    and octet_length(settings::text) <= 65536
  ),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (team_id, sport_id)
);

create index if not exists idx_user_sport_settings_updated
  on public.user_sport_settings (user_id, updated_at desc);
create index if not exists idx_team_sport_settings_updated
  on public.team_sport_settings (team_id, updated_at desc);

alter table public.user_sport_settings enable row level security;
alter table public.team_sport_settings enable row level security;

drop policy if exists "user_sport_settings_select_own"
  on public.user_sport_settings;
create policy "user_sport_settings_select_own"
  on public.user_sport_settings
  for select using (
    user_id = (select auth.uid())
    and public.has_active_app_access()
  );

drop policy if exists "team_sport_settings_select_member"
  on public.team_sport_settings;
create policy "team_sport_settings_select_member"
  on public.team_sport_settings
  for select using (
    public.has_active_app_access()
    and public.current_team_role(team_id) is not null
  );

revoke all on table public.user_sport_settings from anon, authenticated;
revoke all on table public.team_sport_settings from anon, authenticated;
grant select on table public.user_sport_settings to authenticated;
grant select on table public.team_sport_settings to authenticated;

create or replace function public._sport_settings_is_integer(p_value jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when jsonb_typeof(p_value) is distinct from 'number' then false
    else
      (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
      and abs((p_value #>> '{}')::numeric) <= 2147483647
  end;
$$;

create or replace function public._validate_soccer_segments(
  p_segments jsonb,
  p_kind text,
  p_allow_empty boolean
)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_segment jsonb;
begin
  if jsonb_typeof(p_segments) is distinct from 'array' then
    raise exception 'SPORT_SETTINGS_INVALID: match segments must be an array';
  end if;
  if not p_allow_empty and jsonb_array_length(p_segments) = 0 then
    raise exception 'SPORT_SETTINGS_INVALID: regulation segments cannot be empty';
  end if;
  if jsonb_array_length(p_segments) > 20 then
    raise exception 'SPORT_SETTINGS_INVALID: match segment count exceeds 20';
  end if;

  for v_segment in select value from jsonb_array_elements(p_segments)
  loop
    if jsonb_typeof(v_segment) is distinct from 'object' then
      raise exception 'SPORT_SETTINGS_INVALID: every match segment must use the exact schema';
    end if;
    if not (v_segment ?& array['id', 'label', 'kind', 'order', 'durationMs'])
       or (select count(*) from jsonb_object_keys(v_segment)) <> 5 then
      raise exception 'SPORT_SETTINGS_INVALID: every match segment must use the exact schema';
    end if;
    if jsonb_typeof(v_segment->'id') is distinct from 'string'
       or jsonb_typeof(v_segment->'label') is distinct from 'string'
       or jsonb_typeof(v_segment->'kind') is distinct from 'string'
       or nullif(trim(v_segment->>'id'), '') is null
       or length(v_segment->>'id') > 80
       or nullif(trim(v_segment->>'label'), '') is null
       or length(v_segment->>'label') > 120
       or v_segment->>'kind' <> p_kind
       or not public._sport_settings_is_integer(v_segment->'order')
       or not public._sport_settings_is_integer(v_segment->'durationMs') then
      raise exception 'SPORT_SETTINGS_INVALID: match segment values are invalid';
    end if;
    if (v_segment->>'order')::numeric < 0
       or (v_segment->>'durationMs')::numeric <= 0 then
      raise exception 'SPORT_SETTINGS_INVALID: match segment values are invalid';
    end if;
  end loop;

  if (
    select count(*) <> count(distinct value->>'id')
    from jsonb_array_elements(p_segments)
  ) then
    raise exception 'SPORT_SETTINGS_INVALID: match segment ids must be unique';
  end if;
  if (
    select count(*) <> count(distinct value->>'order')
    from jsonb_array_elements(p_segments)
  ) then
    raise exception 'SPORT_SETTINGS_INVALID: match segment orders must be unique';
  end if;
end;
$$;

create or replace function public._validate_soccer_rule_settings(
  p_rules jsonb,
  p_complete boolean
)
returns void
language plpgsql
immutable
set search_path = public
as $$
declare
  v_allowed_keys constant text[] := array[
    'regulationSegments',
    'extraTimeSegments',
    'clockDirection',
    'clockDisplay',
    'maxOnFieldPlayers',
    'allowReturnSubstitutions',
    'substitutionLimit',
    'substitutionWindowLimit',
    'maxAssistsPerGoal',
    'yellowCardExitPolicy',
    'redCardReplacementPolicy',
    'tieResolution',
    'shootoutInitialKicksPerSide',
    'allowUnusedGoalkeeperShootoutReplacement'
  ];
  v_key text;
begin
  if jsonb_typeof(p_rules) is distinct from 'object' then
    raise exception 'SPORT_SETTINGS_INVALID: soccer rules must be an object';
  end if;
  if p_rules ?| array['extraTimeAvailable', 'shootoutAvailable'] then
    raise exception 'SPORT_SETTINGS_INVALID: availability mirrors are derived from tieResolution';
  end if;
  for v_key in select jsonb_object_keys(p_rules)
  loop
    if not (v_key = any(v_allowed_keys)) then
      raise exception 'SPORT_SETTINGS_INVALID: unknown soccer rule %', v_key;
    end if;
  end loop;
  if p_complete and not (p_rules ?& v_allowed_keys) then
    raise exception 'SPORT_SETTINGS_INVALID: personal soccer rules must be complete';
  end if;

  if p_rules ? 'regulationSegments' then
    perform public._validate_soccer_segments(
      p_rules->'regulationSegments',
      'regulation',
      false
    );
  end if;
  if p_rules ? 'extraTimeSegments' then
    perform public._validate_soccer_segments(
      p_rules->'extraTimeSegments',
      'extra_time',
      true
    );
  end if;
  if p_rules ? 'regulationSegments' and p_rules ? 'extraTimeSegments' then
    if (
      select count(*) <> count(distinct segment.value->>'id')
      from (
        select value from jsonb_array_elements(p_rules->'regulationSegments')
        union all
        select value from jsonb_array_elements(p_rules->'extraTimeSegments')
      ) segment
    ) then
      raise exception 'SPORT_SETTINGS_INVALID: all match segment ids must be unique';
    end if;
    if (
      select count(*) <> count(distinct segment.value->>'order')
      from (
        select value from jsonb_array_elements(p_rules->'regulationSegments')
        union all
        select value from jsonb_array_elements(p_rules->'extraTimeSegments')
      ) segment
    ) then
      raise exception 'SPORT_SETTINGS_INVALID: all match segment orders must be unique';
    end if;
  end if;
  if p_rules ? 'clockDirection' then
    if jsonb_typeof(p_rules->'clockDirection') is distinct from 'string'
       or p_rules->>'clockDirection' not in ('count_up', 'count_down') then
      raise exception 'SPORT_SETTINGS_INVALID: clock direction is invalid';
    end if;
  end if;
  if p_rules ? 'clockDisplay' then
    if jsonb_typeof(p_rules->'clockDisplay') is distinct from 'string'
       or p_rules->>'clockDisplay' not in ('continuous', 'per_period') then
      raise exception 'SPORT_SETTINGS_INVALID: clock display is invalid';
    end if;
  end if;
  if p_rules ? 'maxOnFieldPlayers' then
    if not public._sport_settings_is_integer(p_rules->'maxOnFieldPlayers') then
      raise exception 'SPORT_SETTINGS_INVALID: maximum on-field players is invalid';
    end if;
    if (p_rules->>'maxOnFieldPlayers')::numeric <= 0 then
      raise exception 'SPORT_SETTINGS_INVALID: maximum on-field players is invalid';
    end if;
  end if;
  if p_rules ? 'allowReturnSubstitutions'
     and jsonb_typeof(p_rules->'allowReturnSubstitutions') is distinct from 'boolean' then
    raise exception 'SPORT_SETTINGS_INVALID: return substitutions must be boolean';
  end if;
  if p_rules ? 'substitutionLimit'
     and jsonb_typeof(p_rules->'substitutionLimit') is distinct from 'null' then
    if not public._sport_settings_is_integer(p_rules->'substitutionLimit') then
      raise exception 'SPORT_SETTINGS_INVALID: substitution limit is invalid';
    end if;
    if (p_rules->>'substitutionLimit')::numeric < 0 then
      raise exception 'SPORT_SETTINGS_INVALID: substitution limit is invalid';
    end if;
  end if;
  if p_rules ? 'substitutionWindowLimit'
     and jsonb_typeof(p_rules->'substitutionWindowLimit') is distinct from 'null' then
    if not public._sport_settings_is_integer(p_rules->'substitutionWindowLimit') then
      raise exception 'SPORT_SETTINGS_INVALID: substitution window limit is invalid';
    end if;
    if (p_rules->>'substitutionWindowLimit')::numeric < 0 then
      raise exception 'SPORT_SETTINGS_INVALID: substitution window limit is invalid';
    end if;
  end if;
  if p_rules ? 'maxAssistsPerGoal' then
    if not public._sport_settings_is_integer(p_rules->'maxAssistsPerGoal') then
      raise exception 'SPORT_SETTINGS_INVALID: maximum assists per goal is invalid';
    end if;
    if (p_rules->>'maxAssistsPerGoal')::numeric < 0
       or (p_rules->>'maxAssistsPerGoal')::numeric > 2 then
      raise exception 'SPORT_SETTINGS_INVALID: maximum assists per goal is invalid';
    end if;
  end if;
  if p_rules ? 'yellowCardExitPolicy' then
    if jsonb_typeof(p_rules->'yellowCardExitPolicy') is distinct from 'string'
       or p_rules->>'yellowCardExitPolicy' not in ('stay_on', 'must_leave_may_replace') then
      raise exception 'SPORT_SETTINGS_INVALID: yellow-card exit policy is invalid';
    end if;
  end if;
  if p_rules ? 'redCardReplacementPolicy' then
    if jsonb_typeof(p_rules->'redCardReplacementPolicy') is distinct from 'string'
       or p_rules->>'redCardReplacementPolicy' <> 'play_short' then
      raise exception 'SPORT_SETTINGS_INVALID: red-card replacement policy is invalid';
    end if;
  end if;
  if p_rules ? 'tieResolution' then
    if jsonb_typeof(p_rules->'tieResolution') is distinct from 'string'
       or p_rules->>'tieResolution' not in (
         'draw_allowed',
         'extra_time_then_shootout',
         'direct_to_shootout'
       ) then
      raise exception 'SPORT_SETTINGS_INVALID: tie resolution is invalid';
    end if;
  end if;
  if p_rules ? 'shootoutInitialKicksPerSide' then
    if not public._sport_settings_is_integer(p_rules->'shootoutInitialKicksPerSide') then
      raise exception 'SPORT_SETTINGS_INVALID: initial shootout kick count is invalid';
    end if;
    if (p_rules->>'shootoutInitialKicksPerSide')::numeric <= 0 then
      raise exception 'SPORT_SETTINGS_INVALID: initial shootout kick count is invalid';
    end if;
  end if;
  if p_rules ? 'allowUnusedGoalkeeperShootoutReplacement'
     and jsonb_typeof(p_rules->'allowUnusedGoalkeeperShootoutReplacement')
       is distinct from 'boolean' then
    raise exception 'SPORT_SETTINGS_INVALID: shootout goalkeeper replacement must be boolean';
  end if;
end;
$$;

create or replace function public._validate_sport_settings_payload(
  p_sport_id text,
  p_schema_version integer,
  p_scope text,
  p_settings jsonb
)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_sport_id is null
     or p_schema_version is null
     or p_sport_id <> 'soccer'
     or p_schema_version <> 1 then
    raise exception 'SPORT_SETTINGS_UNSUPPORTED_SCHEMA';
  end if;
  if jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'SPORT_SETTINGS_INVALID: settings must be an object';
  end if;

  if p_scope = 'user' then
    if not (p_settings ?& array['rules', 'display'])
       or (select count(*) from jsonb_object_keys(p_settings)) <> 2 then
      raise exception 'SPORT_SETTINGS_INVALID: personal settings must contain rules and display';
    end if;
    perform public._validate_soccer_rule_settings(p_settings->'rules', true);
    if jsonb_typeof(p_settings->'display') is distinct from 'object' then
      raise exception 'SPORT_SETTINGS_INVALID: soccer display settings are invalid';
    end if;
    if not ((p_settings->'display') ? 'fieldFlipped')
       or (
         select count(*) from jsonb_object_keys(p_settings->'display')
       ) <> 1
       or jsonb_typeof(p_settings->'display'->'fieldFlipped')
         is distinct from 'boolean' then
      raise exception 'SPORT_SETTINGS_INVALID: soccer display settings are invalid';
    end if;
    return;
  end if;

  if p_scope = 'team' then
    if not (p_settings ? 'rules')
       or (select count(*) from jsonb_object_keys(p_settings)) <> 1 then
      raise exception 'SPORT_SETTINGS_INVALID: team settings must contain only rules';
    end if;
    perform public._validate_soccer_rule_settings(p_settings->'rules', false);
    return;
  end if;

  raise exception 'SPORT_SETTINGS_INVALID: settings scope is invalid';
end;
$$;

create or replace function public._sport_settings_record_json(
  p_sport_id text,
  p_schema_version integer,
  p_revision bigint,
  p_settings jsonb,
  p_updated_at timestamptz,
  p_updated_by uuid
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'sportId', p_sport_id,
    'schemaVersion', p_schema_version,
    'revision', p_revision,
    'settings', p_settings,
    'updatedAt', p_updated_at,
    'updatedBy', p_updated_by
  );
$$;

create or replace function public.save_user_sport_settings_revisioned(
  p_sport_id text,
  p_schema_version integer,
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
  v_existing public.user_sport_settings%rowtype;
  v_saved public.user_sport_settings%rowtype;
  v_exists boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if not public.has_active_app_access() then
    raise exception 'Active app access is required';
  end if;
  if p_expected_revision is not null and p_expected_revision <= 0 then
    raise exception 'SPORT_SETTINGS_INVALID: expected revision must be positive';
  end if;
  perform public._validate_sport_settings_payload(
    p_sport_id,
    p_schema_version,
    'user',
    p_settings
  );

  select *
  into v_existing
  from public.user_sport_settings
  where user_id = v_user_id
    and sport_id = p_sport_id
  for update;
  v_exists := found;

  if v_exists then
    if p_expected_revision is null or p_expected_revision <> v_existing.revision then
      return jsonb_build_object(
        'status', 'conflict',
        'record', public._sport_settings_record_json(
          v_existing.sport_id,
          v_existing.schema_version,
          v_existing.revision,
          v_existing.settings,
          v_existing.updated_at,
          null
        )
      );
    end if;

    update public.user_sport_settings
    set
      schema_version = p_schema_version,
      revision = revision + 1,
      settings = p_settings,
      updated_at = now()
    where user_id = v_user_id
      and sport_id = p_sport_id
      and revision = p_expected_revision
    returning * into v_saved;
    if not found then
      select *
      into v_existing
      from public.user_sport_settings
      where user_id = v_user_id
        and sport_id = p_sport_id;
      if found then
        return jsonb_build_object(
          'status', 'conflict',
          'record', public._sport_settings_record_json(
            v_existing.sport_id,
            v_existing.schema_version,
            v_existing.revision,
            v_existing.settings,
            v_existing.updated_at,
            null
          )
        );
      end if;
      return jsonb_build_object('status', 'conflict', 'record', null);
    end if;
  else
    if p_expected_revision is not null then
      return jsonb_build_object('status', 'conflict', 'record', null);
    end if;

    insert into public.user_sport_settings (
      user_id,
      sport_id,
      schema_version,
      settings
    ) values (
      v_user_id,
      p_sport_id,
      p_schema_version,
      p_settings
    )
    on conflict (user_id, sport_id) do nothing
    returning * into v_saved;

    if not found then
      select *
      into v_existing
      from public.user_sport_settings
      where user_id = v_user_id
        and sport_id = p_sport_id;
      return jsonb_build_object(
        'status', 'conflict',
        'record', public._sport_settings_record_json(
          v_existing.sport_id,
          v_existing.schema_version,
          v_existing.revision,
          v_existing.settings,
          v_existing.updated_at,
          null
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'status', 'applied',
    'record', public._sport_settings_record_json(
      v_saved.sport_id,
      v_saved.schema_version,
      v_saved.revision,
      v_saved.settings,
      v_saved.updated_at,
      null
    )
  );
end;
$$;

create or replace function public.save_team_sport_settings_revisioned(
  p_team_id uuid,
  p_sport_id text,
  p_schema_version integer,
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
  v_existing public.team_sport_settings%rowtype;
  v_saved public.team_sport_settings%rowtype;
  v_exists boolean;
  v_previous_settings jsonb := '{}'::jsonb;
  v_changed_fields jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if not public.has_active_app_access() then
    raise exception 'Active app access is required';
  end if;
  if coalesce(public.current_team_role(p_team_id), '') not in ('owner', 'admin') then
    raise exception 'Team owner or admin access is required';
  end if;
  if p_expected_revision is not null and p_expected_revision <= 0 then
    raise exception 'SPORT_SETTINGS_INVALID: expected revision must be positive';
  end if;

  select season.sport
  into v_team_sport
  from public.teams team
  join public.seasons season on season.id = team.season_id
  where team.id = p_team_id;
  if v_team_sport is null then
    raise exception 'Team sport could not be resolved';
  end if;
  if v_team_sport <> p_sport_id then
    raise exception 'Team sport does not match settings sport';
  end if;

  perform public._validate_sport_settings_payload(
    p_sport_id,
    p_schema_version,
    'team',
    p_settings
  );

  select *
  into v_existing
  from public.team_sport_settings
  where team_id = p_team_id
    and sport_id = p_sport_id
  for update;
  v_exists := found;

  if v_exists then
    if p_expected_revision is null or p_expected_revision <> v_existing.revision then
      return jsonb_build_object(
        'status', 'conflict',
        'record', public._sport_settings_record_json(
          v_existing.sport_id,
          v_existing.schema_version,
          v_existing.revision,
          v_existing.settings,
          v_existing.updated_at,
          v_existing.updated_by
        )
      );
    end if;

    v_previous_settings := v_existing.settings;
    update public.team_sport_settings
    set
      schema_version = p_schema_version,
      revision = revision + 1,
      settings = p_settings,
      updated_at = now(),
      updated_by = v_user_id
    where team_id = p_team_id
      and sport_id = p_sport_id
      and revision = p_expected_revision
    returning * into v_saved;
    if not found then
      select *
      into v_existing
      from public.team_sport_settings
      where team_id = p_team_id
        and sport_id = p_sport_id;
      if found then
        return jsonb_build_object(
          'status', 'conflict',
          'record', public._sport_settings_record_json(
            v_existing.sport_id,
            v_existing.schema_version,
            v_existing.revision,
            v_existing.settings,
            v_existing.updated_at,
            v_existing.updated_by
          )
        );
      end if;
      return jsonb_build_object('status', 'conflict', 'record', null);
    end if;
  else
    if p_expected_revision is not null then
      return jsonb_build_object('status', 'conflict', 'record', null);
    end if;

    insert into public.team_sport_settings (
      team_id,
      sport_id,
      schema_version,
      settings,
      updated_by
    ) values (
      p_team_id,
      p_sport_id,
      p_schema_version,
      p_settings,
      v_user_id
    )
    on conflict (team_id, sport_id) do nothing
    returning * into v_saved;

    if not found then
      select *
      into v_existing
      from public.team_sport_settings
      where team_id = p_team_id
        and sport_id = p_sport_id;
      return jsonb_build_object(
        'status', 'conflict',
        'record', public._sport_settings_record_json(
          v_existing.sport_id,
          v_existing.schema_version,
          v_existing.revision,
          v_existing.settings,
          v_existing.updated_at,
          v_existing.updated_by
        )
      );
    end if;
  end if;

  select coalesce(jsonb_agg(changed.key order by changed.key), '[]'::jsonb)
  into v_changed_fields
  from (
    select candidate.key
    from (
      select jsonb_object_keys(
        coalesce(v_previous_settings->'rules', '{}'::jsonb)
      ) as key
      union
      select jsonb_object_keys(
        coalesce(p_settings->'rules', '{}'::jsonb)
      ) as key
    ) candidate
    where v_previous_settings->'rules'->(candidate.key)
      is distinct from p_settings->'rules'->(candidate.key)
  ) changed;

  perform public.record_access_audit_event(
    p_event_type => 'soccer_settings_changed',
    p_actor_user_id => v_user_id,
    p_team_id => p_team_id,
    p_metadata => jsonb_build_object(
      'sport_id', p_sport_id,
      'revision', v_saved.revision,
      'changed_fields', v_changed_fields
    )
  );

  return jsonb_build_object(
    'status', 'applied',
    'record', public._sport_settings_record_json(
      v_saved.sport_id,
      v_saved.schema_version,
      v_saved.revision,
      v_saved.settings,
      v_saved.updated_at,
      v_saved.updated_by
    )
  );
end;
$$;

revoke all on function public._sport_settings_is_integer(jsonb) from public;
revoke all on function public._validate_soccer_segments(jsonb, text, boolean) from public;
revoke all on function public._validate_soccer_rule_settings(jsonb, boolean) from public;
revoke all on function public._validate_sport_settings_payload(text, integer, text, jsonb) from public;
revoke all on function public._sport_settings_record_json(
  text,
  integer,
  bigint,
  jsonb,
  timestamptz,
  uuid
) from public;
revoke all on function public.save_user_sport_settings_revisioned(
  text,
  integer,
  bigint,
  jsonb
) from public;
revoke all on function public.save_team_sport_settings_revisioned(
  uuid,
  text,
  integer,
  bigint,
  jsonb
) from public;

grant execute on function public.save_user_sport_settings_revisioned(
  text,
  integer,
  bigint,
  jsonb
) to authenticated;
grant execute on function public.save_team_sport_settings_revisioned(
  uuid,
  text,
  integer,
  bigint,
  jsonb
) to authenticated;
