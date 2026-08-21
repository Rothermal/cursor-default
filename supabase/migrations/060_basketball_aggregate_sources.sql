-- BKE-4E2: fixed Basketball canonical/legacy aggregate source contracts.

-- Older aggregate sync predated games.sport_id. Team sport is sufficient proof for
-- these team-owned, non-event rows; ambiguous and personal rows remain untouched.
-- The current identity trigger intentionally forbids runtime sport changes, so this
-- migration performs the bounded repair under the table lock and restores the trigger
-- before exposing any new contracts. Sport belongs to seasons, not teams.
do $migration$
begin
  -- Normalize a database where a previous manually executed batch stopped after DISABLE.
  execute 'alter table public.games enable trigger enforce_game_identity_and_final_state';
  execute 'alter table public.games disable trigger enforce_game_identity_and_final_state';
  begin
    update public.games game
    set sport_id = 'basketball'
    from public.teams team
    join public.seasons season on season.id = team.season_id
    where game.team_id = team.id
      and game.sport_id is null
      and lower(trim(season.sport)) = 'basketball'
      and not exists (
        select 1
        from public.game_event_setup_snapshots setup
        where setup.game_id = game.id
      );
  exception when others then
    execute 'alter table public.games enable trigger enforce_game_identity_and_final_state';
    raise;
  end;
  execute 'alter table public.games enable trigger enforce_game_identity_and_final_state';
end;
$migration$;

-- Repair only UUID-shaped participant identities with an audited, non-cyclic merge
-- path to a surviving player authorized for the original team/personal game.
do $$
declare
  v_repaired integer := 0;
  v_remaining integer := 0;
begin
  with recursive candidates as (
    select
      participant.id as participant_id,
      game.team_id,
      game.cloud_scope,
      game.created_by,
      participant.client_player_id::uuid as original_player_id
    from public.game_participants participant
    join public.games game on game.id = participant.game_id
    where game.sport_id = 'basketball'
      and participant.source_player_id is null
      and participant.client_player_id ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  lineage as (
    select
      candidate.participant_id,
      candidate.team_id,
      candidate.cloud_scope,
      candidate.created_by,
      candidate.original_player_id as current_player_id,
      array[candidate.original_player_id]::uuid[] as path,
      0 as depth
    from candidates candidate

    union all

    select
      lineage.participant_id,
      lineage.team_id,
      lineage.cloud_scope,
      lineage.created_by,
      merge.survivor_player_id,
      lineage.path || merge.survivor_player_id,
      lineage.depth + 1
    from lineage
    join lateral (
      select audit.survivor_player_id
      from public.player_merge_audit audit
      where audit.duplicate_player_id = lineage.current_player_id
      order by audit.merged_at desc, audit.id desc
      limit 1
    ) merge on true
    where not merge.survivor_player_id = any(lineage.path)
  ),
  terminal as (
    select distinct on (lineage.participant_id)
      lineage.participant_id,
      lineage.team_id,
      lineage.cloud_scope,
      lineage.created_by,
      lineage.current_player_id as survivor_player_id,
      lineage.depth
    from lineage
    where not exists (
      select 1
      from public.player_merge_audit next_merge
      where next_merge.duplicate_player_id = lineage.current_player_id
    )
    order by lineage.participant_id, lineage.depth desc
  ),
  repairable as (
    select terminal.participant_id, terminal.survivor_player_id
    from terminal
    join public.players player on player.id = terminal.survivor_player_id
    where terminal.depth > 0
      and (
        (
          terminal.cloud_scope = 'team'
          and terminal.team_id is not null
          and exists (
            select 1
            from public.team_players team_player
            where team_player.team_id = terminal.team_id
              and team_player.player_id = terminal.survivor_player_id
          )
        )
        or (
          terminal.cloud_scope = 'personal'
          and (
            player.created_by = terminal.created_by
            or exists (
              select 1
              from public.player_guardians guardian
              where guardian.player_id = terminal.survivor_player_id
                and guardian.user_id = terminal.created_by
            )
          )
        )
      )
  )
  update public.game_participants participant
  set source_player_id = repairable.survivor_player_id,
      updated_at = now()
  from repairable
  where participant.id = repairable.participant_id
    and participant.source_player_id is null;

  get diagnostics v_repaired = row_count;

  select count(*)::integer into v_remaining
  from public.game_participants participant
  join public.games game on game.id = participant.game_id
  where game.sport_id = 'basketball'
    and participant.source_player_id is null;

  raise notice
    'BKE-4E2 participant source repair: repaired %, remaining unresolved %',
    v_repaired,
    v_remaining;
end;
$$;

create or replace function public._event_aggregate_snapshot_completed(
  p_sport_id text,
  p_snapshot jsonb
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce((
    select
      event.value->>'eventType' = p_sport_id || '.match_ended'
      and event.value->'payload'->>'reason' = 'completed'
    from jsonb_array_elements(
      case
        when jsonb_typeof(p_snapshot#>'{eventStream,events}') = 'array'
          then p_snapshot#>'{eventStream,events}'
        else '[]'::jsonb
      end
    ) with ordinality event(value, ordinality)
    where event.value->>'eventType' in (
      p_sport_id || '.match_ended',
      p_sport_id || '.match_reopened'
    )
      and nullif(event.value->>'deletedAt', '') is null
    order by
      case
        when (event.value#>>'{period,order}') ~ '^-?[0-9]+$'
          then (event.value#>>'{period,order}')::bigint
        else 2147483647
      end desc,
      case
        when (event.value->>'elapsedMs') ~ '^[0-9]+$'
          then (event.value->>'elapsedMs')::bigint
        else 9007199254740991
      end desc,
      case
        when (event.value->>'sequence') ~ '^[0-9]+$'
          then (event.value->>'sequence')::bigint
        else -1
      end desc,
      event.value->>'id' desc,
      event.ordinality desc
    limit 1
  ), false);
$$;

create or replace function public._event_aggregate_participant_source_map(
  p_sport_id text,
  p_game_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(identity.source_key, identity.source_player_id), '{}'::jsonb)
  from (
    select
      source.source_key,
      min(participant.source_player_id::text) as source_player_id
    from public.game_participants participant
    join public.games game on game.id = participant.game_id
    cross join lateral (
      values
        (participant.id::text),
        (participant.client_participant_id),
        (participant.client_player_id)
    ) source(source_key)
    where participant.game_id = p_game_id
      and game.sport_id = p_sport_id
      and participant.source_player_id is not null
      and nullif(trim(source.source_key), '') is not null
    group by source.source_key
    having count(distinct participant.source_player_id) = 1
  ) identity;
$$;

create or replace function public._soccer_canonical_snapshot_completed(p_snapshot jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select public._event_aggregate_snapshot_completed('soccer', p_snapshot);
$$;

create or replace function public._soccer_participant_source_map(p_game_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public._event_aggregate_participant_source_map('soccer', p_game_id);
$$;

create or replace function public._basketball_canonical_snapshot_completed(p_snapshot jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    p_snapshot->>'canonicalSchemaVersion' = '1'
    and p_snapshot->>'sportId' = 'basketball'
    and public._event_aggregate_snapshot_completed('basketball', p_snapshot);
$$;

comment on function public._event_aggregate_participant_source_map(text, uuid) is
  'Private definer helper; fixed sport wrappers must enforce game read authorization.';

revoke all on function public._event_aggregate_snapshot_completed(text, jsonb) from public;
revoke all on function public._event_aggregate_participant_source_map(text, uuid) from public;
revoke all on function public._soccer_canonical_snapshot_completed(jsonb) from public;
revoke all on function public._soccer_participant_source_map(uuid) from public;
revoke all on function public._basketball_canonical_snapshot_completed(jsonb) from public;

create index if not exists idx_basketball_canonical_publications_active_finalized
  on public.game_event_canonical_publications (finalized_at desc, id desc)
  where invalidated_at is null and sport_id = 'basketball';

create index if not exists idx_basketball_legacy_games_final_date
  on public.games (game_date desc, id desc)
  where status = 'final' and sport_id = 'basketball';

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
  if p_sport_id not in ('soccer', 'basketball') then
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
      and public._event_aggregate_snapshot_completed(
        p_sport_id,
        publication.canonical_snapshot
      )
      and (
        p_sport_id <> 'basketball'
        or public._basketball_canonical_snapshot_completed(publication.canonical_snapshot)
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
          and exists (
            select 1
            from public.game_participants participant
            where participant.game_id = game.id
              and participant.source_player_id = p_player_id
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
          public._event_aggregate_participant_source_map(p_sport_id, ranked.game_id),
        'canManage', ranked.can_manage
      ) as item
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

revoke all on function public._event_aggregate_publication_page(
  text, text, uuid, uuid, uuid, uuid, timestamptz, uuid, integer
) from public;

-- Preserve the fixed Soccer signatures while moving their common page mechanics
-- behind the private sport-neutral core.
create or replace function public.get_soccer_scope_aggregate_publications(
  p_scope_type text,
  p_scope_id uuid,
  p_before_finalized_at timestamptz default null,
  p_before_publication_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public._event_aggregate_publication_page(
    'soccer', p_scope_type, p_scope_id, null, null, null,
    p_before_finalized_at, p_before_publication_id, p_limit
  );
$$;

create or replace function public.get_soccer_player_aggregate_publications(
  p_player_id uuid,
  p_team_id uuid default null,
  p_season_id uuid default null,
  p_before_finalized_at timestamptz default null,
  p_before_publication_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public._event_aggregate_publication_page(
    'soccer', null, null, p_player_id, p_team_id, p_season_id,
    p_before_finalized_at, p_before_publication_id, p_limit
  );
$$;

create or replace function public.get_basketball_scope_aggregate_publications(
  p_scope_type text,
  p_scope_id uuid,
  p_before_finalized_at timestamptz default null,
  p_before_publication_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public._event_aggregate_publication_page(
    'basketball', p_scope_type, p_scope_id, null, null, null,
    p_before_finalized_at, p_before_publication_id, p_limit
  );
$$;

create or replace function public.get_basketball_player_aggregate_publications(
  p_player_id uuid,
  p_team_id uuid default null,
  p_season_id uuid default null,
  p_before_finalized_at timestamptz default null,
  p_before_publication_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public._event_aggregate_publication_page(
    'basketball', null, null, p_player_id, p_team_id, p_season_id,
    p_before_finalized_at, p_before_publication_id, p_limit
  );
$$;

create or replace function public._basketball_empty_stat_totals()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'ft', 0, 'ft_miss', 0,
    '2pt', 0, '2pt_miss', 0,
    '3pt', 0, '3pt_miss', 0,
    'oreb', 0, 'dreb', 0,
    'ast', 0, 'stl', 0, 'blk', 0,
    'to', 0, 'pf', 0, 'min', 0
  );
$$;

create or replace function public._basketball_legacy_aggregate_source(p_game_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_game record;
  v_players jsonb;
  v_tracked_stats jsonb;
  v_opponent_stats jsonb;
  v_resolved_at timestamptz;
  v_tracked_score integer;
  v_source_body jsonb;
begin
  select
    game.*,
    coalesce(nullif(trim(game.tracked_team_name), ''), team.name, 'Personal')
      as resolved_team_name,
    case
      when game.cloud_scope = 'personal' then game.created_by = auth.uid()
      else public.current_team_role(game.team_id) in ('owner', 'admin')
    end as can_manage
  into v_game
  from public.games game
  left join public.teams team on team.id = game.team_id
  where game.id = p_game_id
    and game.sport_id = 'basketball'
    and game.status = 'final'
    and public.can_read_game(game.id)
    and not exists (
      select 1
      from public.game_event_setup_snapshots setup
      where setup.game_id = game.id
    );

  if not found then return null; end if;

  with resolved as (
    select stat.*, player.is_team_placeholder
    from public.get_game_stats_resolved(p_game_id) stat
    join public.players player on player.id = stat.player_id
    where stat.stat_id in (
        'ft', 'ft_miss', '2pt', '2pt_miss', '3pt', '3pt_miss',
        'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'pf', 'min'
      )
  ),
  player_rows as (
    select
      player.id as player_id,
      coalesce(
        nullif(trim(player.nickname), ''),
        nullif(trim(concat_ws(' ', player.first_name, player.last_name)), ''),
        'Basketball player'
      ) as display_name,
      team_player.jersey_number,
      public._basketball_empty_stat_totals()
        || coalesce(jsonb_object_agg(
          resolved.stat_id,
          resolved.value
          order by resolved.stat_id
        ) filter (where resolved.stat_id is not null), '{}'::jsonb) as stats,
      exists (
        select 1
        from public.player_checkouts checkout
        where checkout.game_id = p_game_id
          and checkout.player_id = player.id
      ) as participation_evidence
    from public.players player
    left join resolved on resolved.player_id = player.id
    left join public.team_players team_player
      on team_player.team_id = v_game.team_id
      and team_player.player_id = player.id
    where not player.is_team_placeholder
      and (
        exists (
          select 1 from resolved candidate where candidate.player_id = player.id
        )
        or exists (
          select 1
          from public.player_checkouts checkout
          where checkout.game_id = p_game_id
            and checkout.player_id = player.id
        )
    )
    group by player.id, team_player.jersey_number
  ),
  player_items as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'playerId', player_rows.player_id,
      'displayName', player_rows.display_name,
      'number', player_rows.jersey_number,
      'stats', player_rows.stats,
      'participationEvidence', player_rows.participation_evidence
    ) order by player_rows.display_name, player_rows.player_id), '[]'::jsonb) as items
    from player_rows
  ),
  tracked_totals as (
    select resolved.stat_id, sum(resolved.value)::integer as value
    from resolved
    where resolved.player_id is distinct from v_game.opp_team_player_id
      and (
        not resolved.is_team_placeholder
        or resolved.player_id = v_game.home_team_player_id
      )
    group by resolved.stat_id
  ),
  opponent_totals as (
    select resolved.stat_id, sum(resolved.value)::integer as value
    from resolved
    where resolved.player_id = v_game.opp_team_player_id
    group by resolved.stat_id
  )
  select
    player_items.items,
    public._basketball_empty_stat_totals()
      || coalesce((select jsonb_object_agg(stat_id, value) from tracked_totals), '{}'::jsonb),
    public._basketball_empty_stat_totals()
      || coalesce((select jsonb_object_agg(stat_id, value) from opponent_totals), '{}'::jsonb)
  into v_players, v_tracked_stats, v_opponent_stats
  from player_items;

  select greatest(
    v_game.created_at,
    coalesce((select max(stat.updated_at) from public.game_stats stat
      where stat.game_id = p_game_id), v_game.created_at),
    coalesce((select max(correction.created_at) from public.stat_corrections correction
      where correction.game_id = p_game_id), v_game.created_at),
    coalesce((select max(checkout.checked_out_at) from public.player_checkouts checkout
      where checkout.game_id = p_game_id), v_game.created_at)
  ) into v_resolved_at;

  v_tracked_score := coalesce(
    v_game.home_team_score,
    coalesce((v_tracked_stats->>'ft')::integer, 0)
      + 2 * coalesce((v_tracked_stats->>'2pt')::integer, 0)
      + 3 * coalesce((v_tracked_stats->>'3pt')::integer, 0)
      + coalesce(v_game.home_score_adjustment, 0)
  );

  v_source_body := jsonb_build_object(
    'resolvedAt', v_resolved_at,
    'game', jsonb_build_object(
      'id', v_game.id,
      'date', to_char(v_game.game_date, 'YYYY-MM-DD'),
      'status', v_game.status,
      'cloudScope', v_game.cloud_scope,
      'teamId', v_game.team_id,
      'seasonId', v_game.season_id,
      'tournamentId', v_game.tournament_id,
      'trackedTeamName', v_game.resolved_team_name,
      'opponentName', v_game.opponent_name
    ),
    'players', v_players,
    'trackedStats', v_tracked_stats,
    'opponentStats', v_opponent_stats,
    'score', jsonb_build_object(
      'tracked', v_tracked_score,
      'opponent', v_game.opponent_score
    ),
    'periods', '[]'::jsonb,
    'canManage', v_game.can_manage
  );

  return jsonb_build_object(
    'sourceId', v_game.id,
    'sourceFingerprint', md5(v_source_body::text),
    'payloadBytes', octet_length(convert_to(v_source_body::text, 'UTF8'))
  ) || v_source_body;
end;
$$;

revoke all on function public._basketball_empty_stat_totals() from public;
revoke all on function public._basketball_legacy_aggregate_source(uuid) from public;

create or replace function public._basketball_legacy_aggregate_page(
  p_scope_type text default null,
  p_scope_id uuid default null,
  p_player_id uuid default null,
  p_team_id uuid default null,
  p_season_id uuid default null,
  p_before_game_date date default null,
  p_before_game_id uuid default null,
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
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_active_app_access() then
    raise insufficient_privilege using message = 'APP_ACCESS_UNAVAILABLE';
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
  if (p_before_game_date is null) <> (p_before_game_id is null) then
    raise exception 'Aggregate cursor must include both game_date and game_id';
  end if;

  with eligible as (
    select game.id, game.game_date
    from public.games game
    where game.sport_id = 'basketball'
      and game.status = 'final'
      and public.can_read_game(game.id)
      and not exists (
        select 1
        from public.game_event_setup_snapshots setup
        where setup.game_id = game.id
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
          and (
            exists (
              select 1
              from public.get_game_stats_resolved(game.id) stat
              join public.players player on player.id = stat.player_id
              where stat.player_id = p_player_id
                and not player.is_team_placeholder
            )
            or exists (
              select 1
              from public.player_checkouts checkout
              join public.players player on player.id = checkout.player_id
              where checkout.game_id = game.id
                and checkout.player_id = p_player_id
                and not player.is_team_placeholder
            )
          )
        )
      )
      and (
        p_before_game_date is null
        or (game.game_date, game.id) < (p_before_game_date, p_before_game_id)
      )
    order by game.game_date desc, game.id desc
    limit v_limit + 1
  ),
  ranked as (
    select eligible.*,
      row_number() over (order by eligible.game_date desc, eligible.id desc) as page_row
    from eligible
  ),
  itemized as (
    select
      ranked.page_row,
      ranked.game_date,
      ranked.id,
      public._basketball_legacy_aggregate_source(ranked.id) as item
    from ranked
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(itemized.item order by itemized.game_date desc, itemized.id desc)
      from itemized
      where itemized.page_row <= v_limit
        and itemized.item is not null
    ), '[]'::jsonb),
    'nextCursor', case
      when exists (select 1 from itemized where itemized.page_row = v_limit + 1)
        then (
          select jsonb_build_object(
            'gameDate', to_char(itemized.game_date, 'YYYY-MM-DD'),
            'gameId', itemized.id
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

create or replace function public.get_basketball_scope_aggregate_legacy_games(
  p_scope_type text,
  p_scope_id uuid,
  p_before_game_date date default null,
  p_before_game_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public._basketball_legacy_aggregate_page(
    p_scope_type, p_scope_id, null, null, null,
    p_before_game_date, p_before_game_id, p_limit
  );
$$;

create or replace function public.get_basketball_player_aggregate_legacy_games(
  p_player_id uuid,
  p_team_id uuid default null,
  p_season_id uuid default null,
  p_before_game_date date default null,
  p_before_game_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public._basketball_legacy_aggregate_page(
    null, null, p_player_id, p_team_id, p_season_id,
    p_before_game_date, p_before_game_id, p_limit
  );
$$;

revoke all on function public._basketball_legacy_aggregate_page(
  text, uuid, uuid, uuid, uuid, date, uuid, integer
) from public;

revoke all on function public.get_soccer_scope_aggregate_publications(
  text, uuid, timestamptz, uuid, integer
) from public;
revoke all on function public.get_soccer_player_aggregate_publications(
  uuid, uuid, uuid, timestamptz, uuid, integer
) from public;
grant execute on function public.get_soccer_scope_aggregate_publications(
  text, uuid, timestamptz, uuid, integer
) to authenticated;
grant execute on function public.get_soccer_player_aggregate_publications(
  uuid, uuid, uuid, timestamptz, uuid, integer
) to authenticated;

revoke all on function public.get_basketball_scope_aggregate_publications(
  text, uuid, timestamptz, uuid, integer
) from public;
revoke all on function public.get_basketball_player_aggregate_publications(
  uuid, uuid, uuid, timestamptz, uuid, integer
) from public;
revoke all on function public.get_basketball_scope_aggregate_legacy_games(
  text, uuid, date, uuid, integer
) from public;
revoke all on function public.get_basketball_player_aggregate_legacy_games(
  uuid, uuid, uuid, date, uuid, integer
) from public;

grant execute on function public.get_basketball_scope_aggregate_publications(
  text, uuid, timestamptz, uuid, integer
) to authenticated;
grant execute on function public.get_basketball_player_aggregate_publications(
  uuid, uuid, uuid, timestamptz, uuid, integer
) to authenticated;
grant execute on function public.get_basketball_scope_aggregate_legacy_games(
  text, uuid, date, uuid, integer
) to authenticated;
grant execute on function public.get_basketball_player_aggregate_legacy_games(
  uuid, uuid, uuid, date, uuid, integer
) to authenticated;

comment on function public.get_basketball_scope_aggregate_publications(
  text, uuid, timestamptz, uuid, integer
) is 'RLS-scoped keyset pages of active completed canonical Basketball publications.';
comment on function public.get_basketball_player_aggregate_publications(
  uuid, uuid, uuid, timestamptz, uuid, integer
) is 'RLS-scoped canonical Basketball publications indexed by stable source player.';
comment on function public.get_basketball_scope_aggregate_legacy_games(
  text, uuid, date, uuid, integer
) is 'RLS-scoped keyset pages of correction-resolved legacy Basketball games.';
comment on function public.get_basketball_player_aggregate_legacy_games(
  uuid, uuid, uuid, date, uuid, integer
) is 'RLS-scoped legacy Basketball games indexed by stable player identity.';
