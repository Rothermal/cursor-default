-- HKY-6B1: Hockey canonical aggregate sources and a separate aggregate capability handshake.
--
-- Additive for Soccer and Basketball: the private paging core from 060 is re-created from its
-- 060 body with only 'hockey' added to the sport check and a Hockey completion branch (the
-- PR diffs it against 060). No table, row or legacy Hockey change: no sport backfill and no
-- legacy page RPC. get_hockey_release_capabilities stays contract 2 / migration 74, so cloud
-- setup, sync and settings do not depend on this migration.

-- A Hockey publication counts toward season totals only when the game was completed: the
-- latest of match_ended, match_abandoned, match_suspended and match_reopened is a match_ended
-- with a null reason. Hockey writes a reason only when a game ends before its rules say it is
-- complete, never 'completed', so the shared 060 predicate is not used. The latest event is
-- taken in stream order (sequence, then id), the order is_hockey_primary_stream_ended (073)
-- used to accept the game as ended when it was published.
create or replace function public._hockey_canonical_snapshot_completed(p_snapshot jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    coalesce(p_snapshot->>'canonicalSchemaVersion' = '1', false)
    and coalesce(p_snapshot->>'sportId' = 'hockey', false)
    and coalesce((
      select
        event.value->>'eventType' = 'hockey.match_ended'
        and jsonb_typeof(event.value->'payload') = 'object'
        and coalesce(event.value->'payload'->'reason', 'null'::jsonb) = 'null'::jsonb
      from jsonb_array_elements(
        case
          when jsonb_typeof(p_snapshot#>'{eventStream,events}') = 'array'
            then p_snapshot#>'{eventStream,events}'
          else '[]'::jsonb
        end
      ) with ordinality event(value, ordinality)
      where event.value->>'eventType' in (
        'hockey.match_ended',
        'hockey.match_abandoned',
        'hockey.match_suspended',
        'hockey.match_reopened'
      )
        and nullif(event.value->>'deletedAt', '') is null
      order by
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

revoke all on function public._hockey_canonical_snapshot_completed(jsonb) from public;

create index if not exists idx_hockey_canonical_publications_active_finalized
  on public.game_event_canonical_publications (finalized_at desc, id desc)
  where invalidated_at is null and sport_id = 'hockey';

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
  if p_sport_id not in ('soccer', 'basketball', 'hockey') then
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
      and (
        p_sport_id = 'hockey'
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

-- Fixed Hockey wrappers with Basketball's signatures. Team, season and tournament scopes cover
-- team games; a player request also covers that player's personal games.
create or replace function public.get_hockey_scope_aggregate_publications(
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
    'hockey', p_scope_type, p_scope_id, null, null, null,
    p_before_finalized_at, p_before_publication_id, p_limit
  );
$$;

create or replace function public.get_hockey_player_aggregate_publications(
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
    'hockey', null, null, p_player_id, p_team_id, p_season_id,
    p_before_finalized_at, p_before_publication_id, p_limit
  );
$$;

-- The aggregate handshake, separate from get_hockey_release_capabilities. It returns
-- contractVersion 0 until the paging core and both wrappers are present, so only the Hockey
-- season-stat destinations wait for this migration.
create or replace function public.get_hockey_aggregate_capabilities()
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
    not public.is_event_platform_sport('hockey')
    or to_regclass('public.game_event_canonical_publications') is null
    or to_regclass('public.game_participants') is null
    or to_regprocedure('public._hockey_canonical_snapshot_completed(jsonb)') is null
    or to_regprocedure(
      'public._event_aggregate_publication_page(text,text,uuid,uuid,uuid,uuid,timestamptz,uuid,integer)'
    ) is null
    or to_regprocedure(
      'public.get_hockey_scope_aggregate_publications(text,uuid,timestamptz,uuid,integer)'
    ) is null
    or to_regprocedure(
      'public.get_hockey_player_aggregate_publications(uuid,uuid,uuid,timestamptz,uuid,integer)'
    ) is null
  then
    return jsonb_build_object('contractVersion', 0);
  end if;

  return jsonb_build_object(
    'contractVersion', 1,
    'sportId', 'hockey',
    'aggregateContractVersion', 1,
    'migration', 75
  );
end;
$$;

revoke all on function public.get_hockey_scope_aggregate_publications(
  text, uuid, timestamptz, uuid, integer
) from public;
revoke all on function public.get_hockey_player_aggregate_publications(
  uuid, uuid, uuid, timestamptz, uuid, integer
) from public;
revoke all on function public.get_hockey_aggregate_capabilities() from public;

grant execute on function public.get_hockey_scope_aggregate_publications(
  text, uuid, timestamptz, uuid, integer
) to authenticated;
grant execute on function public.get_hockey_player_aggregate_publications(
  uuid, uuid, uuid, timestamptz, uuid, integer
) to authenticated;
grant execute on function public.get_hockey_aggregate_capabilities() to authenticated;

comment on function public.get_hockey_scope_aggregate_publications(
  text, uuid, timestamptz, uuid, integer
) is 'RLS-scoped keyset pages of active completed canonical Hockey publications.';
comment on function public.get_hockey_player_aggregate_publications(
  uuid, uuid, uuid, timestamptz, uuid, integer
) is 'RLS-scoped canonical Hockey publications indexed by stable source player.';
comment on function public.get_hockey_aggregate_capabilities() is
  'Hockey season-stat contract 1; separate from the Hockey release capability contract.';

notify pgrst, 'reload schema';
