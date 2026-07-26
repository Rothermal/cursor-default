-- SOC-6C2: authorized canonical aggregate sources and stable participant identity.

-- Repair only source links whose original UUID has an audited merge path to a
-- surviving player on the game's team. Unprovable rows remain unresolved.
do $$
declare
  v_repaired integer := 0;
  v_remaining integer := 0;
begin
  with recursive candidates as (
    select
      participant.id as participant_id,
      game.team_id,
      participant.client_player_id::uuid as original_player_id
    from public.game_participants participant
    join public.games game on game.id = participant.game_id
    where game.sport_id = 'soccer'
      and game.cloud_scope = 'team'
      and game.team_id is not null
      and participant.source_player_id is null
      and participant.client_player_id ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  lineage as (
    select
      candidate.participant_id,
      candidate.team_id,
      candidate.original_player_id,
      candidate.original_player_id as current_player_id,
      array[candidate.original_player_id]::uuid[] as path,
      0 as depth
    from candidates candidate

    union all

    select
      lineage.participant_id,
      lineage.team_id,
      lineage.original_player_id,
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
    join public.team_players team_player
      on team_player.team_id = terminal.team_id
      and team_player.player_id = terminal.survivor_player_id
    where terminal.depth > 0
  )
  update public.game_participants participant
  set
    source_player_id = repairable.survivor_player_id,
    updated_at = now()
  from repairable
  where participant.id = repairable.participant_id
    and participant.source_player_id is null;

  get diagnostics v_repaired = row_count;

  select count(*)::integer into v_remaining
  from public.game_participants participant
  join public.games game on game.id = participant.game_id
  where game.sport_id = 'soccer'
    and game.cloud_scope = 'team'
    and participant.source_player_id is null;

  raise notice
    'SOC-6C2 participant source repair: repaired %, remaining unresolved %',
    v_repaired,
    v_remaining;
end;
$$;

create or replace function public._soccer_canonical_snapshot_completed(
  p_snapshot jsonb
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce((
    select
      event.value->>'eventType' = 'soccer.match_ended'
      and event.value->'payload'->>'reason' = 'completed'
    from jsonb_array_elements(
      case
        when jsonb_typeof(p_snapshot#>'{eventStream,events}') = 'array'
          then p_snapshot#>'{eventStream,events}'
        else '[]'::jsonb
      end
    ) with ordinality event(value, ordinality)
    where event.value->>'eventType' in (
      'soccer.match_ended',
      'soccer.match_reopened'
    )
      and nullif(event.value->>'deletedAt', '') is null
    order by
      case
        when event.value->>'sequence' ~ '^[0-9]+$'
          then (event.value->>'sequence')::bigint
        else -1
      end desc,
      event.ordinality desc,
      event.value->>'id' desc
    limit 1
  ), false);
$$;

create or replace function public._soccer_participant_source_map(
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
    cross join lateral (
      values
        (participant.id::text),
        (participant.client_participant_id),
        (participant.client_player_id)
    ) source(source_key)
    where participant.game_id = p_game_id
      and participant.source_player_id is not null
      and nullif(trim(source.source_key), '') is not null
    group by source.source_key
    having count(distinct participant.source_player_id) = 1
  ) identity;
$$;

revoke all on function public._soccer_canonical_snapshot_completed(jsonb) from public;
revoke all on function public._soccer_participant_source_map(uuid) from public;

create index if not exists idx_soccer_canonical_publications_active_finalized
  on public.game_event_canonical_publications (finalized_at desc, id desc)
  where invalidated_at is null and sport_id = 'soccer';

create or replace function public.get_soccer_scope_aggregate_publications(
  p_scope_type text,
  p_scope_id uuid,
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
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if p_scope_type is null
     or p_scope_type not in ('team', 'season', 'tournament') then
    raise exception 'Aggregate scope type is invalid';
  end if;
  if p_scope_id is null then
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
      coalesce(nullif(trim(game.tracked_team_name), ''), team.name) as tracked_team_name,
      game.opponent_name,
      public.current_team_role(game.team_id) in ('owner', 'admin') as can_manage
    from public.game_event_canonical_publications publication
    join public.games game on game.id = publication.game_id
    join public.teams team on team.id = game.team_id
    where publication.invalidated_at is null
      and publication.sport_id = 'soccer'
      and game.sport_id = 'soccer'
      and game.status = 'final'
      and game.cloud_scope = 'team'
      and public.can_read_game(game.id)
      and public._soccer_canonical_snapshot_completed(publication.canonical_snapshot)
      and (
        (p_scope_type = 'team' and game.team_id = p_scope_id)
        or (p_scope_type = 'season' and game.season_id = p_scope_id)
        or (p_scope_type = 'tournament' and game.tournament_id = p_scope_id)
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
    select
      eligible.*,
      row_number() over (
        order by eligible.finalized_at desc, eligible.id desc
      ) as page_row
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
          public._soccer_participant_source_map(ranked.game_id),
        'canManage', ranked.can_manage
      ) as item
    from ranked
  )
  select jsonb_build_object(
    'items',
      coalesce((
        select jsonb_agg(itemized.item order by itemized.finalized_at desc, itemized.id desc)
        from itemized
        where itemized.page_row <= v_limit
      ), '[]'::jsonb),
    'nextCursor',
      case
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
  )
  into v_result;

  return v_result;
end;
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
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := coalesce(p_limit, 20);
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if p_player_id is null then
    raise exception 'Aggregate player id is required';
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
      coalesce(nullif(trim(game.tracked_team_name), ''), team.name) as tracked_team_name,
      game.opponent_name,
      public.current_team_role(game.team_id) in ('owner', 'admin') as can_manage
    from public.game_event_canonical_publications publication
    join public.games game on game.id = publication.game_id
    join public.teams team on team.id = game.team_id
    where publication.invalidated_at is null
      and publication.sport_id = 'soccer'
      and game.sport_id = 'soccer'
      and game.status = 'final'
      and game.cloud_scope = 'team'
      and public.can_read_game(game.id)
      and public._soccer_canonical_snapshot_completed(publication.canonical_snapshot)
      and (p_team_id is null or game.team_id = p_team_id)
      and (p_season_id is null or game.season_id = p_season_id)
      and exists (
        select 1
        from public.game_participants participant
        where participant.game_id = game.id
          and participant.source_player_id = p_player_id
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
    select
      eligible.*,
      row_number() over (
        order by eligible.finalized_at desc, eligible.id desc
      ) as page_row
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
          public._soccer_participant_source_map(ranked.game_id),
        'canManage', ranked.can_manage
      ) as item
    from ranked
  )
  select jsonb_build_object(
    'items',
      coalesce((
        select jsonb_agg(itemized.item order by itemized.finalized_at desc, itemized.id desc)
        from itemized
        where itemized.page_row <= v_limit
      ), '[]'::jsonb),
    'nextCursor',
      case
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
  )
  into v_result;

  return v_result;
end;
$$;

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

comment on function public.get_soccer_scope_aggregate_publications(
  text, uuid, timestamptz, uuid, integer
) is 'RLS-scoped keyset pages of active completed canonical soccer publications.';
comment on function public.get_soccer_player_aggregate_publications(
  uuid, uuid, uuid, timestamptz, uuid, integer
) is 'RLS-scoped canonical soccer publications indexed by stable source player.';

-- Replace migration 041's merge function so future merges preserve stable
-- soccer participant links as well as shot-chart and aggregate stat rows.
-- Fix: player merge must remount shot_chart before deleting the duplicate.
-- Migration 032 added shot_chart.player_id ON DELETE CASCADE after merge RPCs
-- (024/029). Without remounting, merge_players_execute silently wiped all court
-- shots for the duplicate player when DELETE FROM players ran.

CREATE OR REPLACE FUNCTION public.merge_players_execute(
  p_duplicate_id uuid,
  p_survivor_id uuid,
  p_resolutions jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_exp_gs int;
  v_exp_sc int;
  v_exp_tp int;
  v_act_gs int;
  v_act_sc int;
  v_act_tp int;
  r_gs RECORD;
  r_sc RECORD;
  r_tp RECORD;
  v_idx int;
  v_keep uuid;
  v_choice text;
  v_jersey text;
  v_active boolean;
  v_pos text;
  v_dup_first text;
  v_dup_last text;
  v_dup_nick text;
  v_tid uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'merge_players_execute: not authenticated';
  END IF;
  IF p_duplicate_id = p_survivor_id THEN
    RAISE EXCEPTION 'merge_players_execute: duplicate and survivor must differ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_duplicate_id) THEN
    RAISE EXCEPTION 'merge_players_execute: duplicate player not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_survivor_id) THEN
    RAISE EXCEPTION 'merge_players_execute: survivor player not found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.players
    WHERE id IN (p_duplicate_id, p_survivor_id) AND is_team_placeholder
  ) THEN
    RAISE EXCEPTION 'merge_players_execute: team stat placeholders cannot be merged';
  END IF;

  IF NOT public.merge_players_can_merge(v_uid, p_duplicate_id, p_survivor_id) THEN
    RAISE EXCEPTION 'merge_players_execute: not authorized';
  END IF;

  IF p_resolutions IS NULL
     OR jsonb_typeof(p_resolutions) <> 'object'
     OR NOT (p_resolutions ? 'game_stats')
     OR NOT (p_resolutions ? 'stat_corrections')
     OR NOT (p_resolutions ? 'team_players') THEN
    RAISE EXCEPTION 'merge_players_execute: p_resolutions must include game_stats, stat_corrections, team_players arrays';
  END IF;

  IF jsonb_typeof(p_resolutions->'game_stats') <> 'array'
     OR jsonb_typeof(p_resolutions->'stat_corrections') <> 'array'
     OR jsonb_typeof(p_resolutions->'team_players') <> 'array' THEN
    RAISE EXCEPTION 'merge_players_execute: game_stats, stat_corrections, team_players must be JSON arrays';
  END IF;

  SELECT COUNT(*) INTO v_exp_gs FROM (
    SELECT 1
    FROM public.game_stats gs_s
    JOIN public.game_stats gs_d
      ON gs_d.game_id = gs_s.game_id
     AND gs_d.recorded_by = gs_s.recorded_by
     AND gs_d.stat_id = gs_s.stat_id
     AND gs_d.player_id = p_duplicate_id
    WHERE gs_s.player_id = p_survivor_id
  ) c;

  SELECT COUNT(*) INTO v_exp_sc FROM (
    SELECT 1
    FROM public.stat_corrections sc_s
    JOIN public.stat_corrections sc_d
      ON sc_d.game_id = sc_s.game_id
     AND sc_d.stat_id = sc_s.stat_id
     AND sc_d.player_id = p_duplicate_id
    WHERE sc_s.player_id = p_survivor_id
  ) c;

  SELECT COUNT(*) INTO v_exp_tp FROM (
    SELECT 1
    FROM public.team_players tp_s
    JOIN public.team_players tp_d
      ON tp_d.team_id = tp_s.team_id
     AND tp_d.player_id = p_duplicate_id
    WHERE tp_s.player_id = p_survivor_id
  ) c;

  SELECT jsonb_array_length(p_resolutions->'game_stats') INTO v_act_gs;
  SELECT jsonb_array_length(p_resolutions->'stat_corrections') INTO v_act_sc;
  SELECT jsonb_array_length(p_resolutions->'team_players') INTO v_act_tp;

  IF v_act_gs <> v_exp_gs OR v_act_sc <> v_exp_sc OR v_act_tp <> v_exp_tp THEN
    RAISE EXCEPTION 'merge_players_execute: resolution counts do not match current conflicts (re-run preview). expected game_stats=%, stat_corrections=%, team_players=%; got %, %, %',
      v_exp_gs, v_exp_sc, v_exp_tp, v_act_gs, v_act_sc, v_act_tp;
  END IF;

  -- --- game_stats conflicts (same order as preview) ---
  v_idx := 0;
  FOR r_gs IN
    SELECT gs_s.id AS surv_row_id, gs_d.id AS dup_row_id
    FROM public.game_stats gs_s
    JOIN public.game_stats gs_d
      ON gs_d.game_id = gs_s.game_id
     AND gs_d.recorded_by = gs_s.recorded_by
     AND gs_d.stat_id = gs_s.stat_id
     AND gs_d.player_id = p_duplicate_id
    WHERE gs_s.player_id = p_survivor_id
    ORDER BY gs_s.game_id, gs_s.recorded_by, gs_s.stat_id
  LOOP
    v_keep := (p_resolutions->'game_stats'->v_idx->>'keep_row_id')::uuid;
    IF v_keep IS NULL THEN
      RAISE EXCEPTION 'merge_players_execute: game_stats[%] missing keep_row_id', v_idx;
    END IF;
    IF v_keep <> r_gs.surv_row_id AND v_keep <> r_gs.dup_row_id THEN
      RAISE EXCEPTION 'merge_players_execute: game_stats[%] keep_row_id does not match conflict pair', v_idx;
    END IF;
    IF v_keep = r_gs.surv_row_id THEN
      DELETE FROM public.game_stats WHERE id = r_gs.dup_row_id;
    ELSE
      DELETE FROM public.game_stats WHERE id = r_gs.surv_row_id;
      UPDATE public.game_stats SET player_id = p_survivor_id WHERE id = r_gs.dup_row_id;
    END IF;
    v_idx := v_idx + 1;
  END LOOP;

  -- --- stat_corrections conflicts ---
  v_idx := 0;
  FOR r_sc IN
    SELECT sc_s.id AS surv_row_id, sc_d.id AS dup_row_id, sc_s.game_id, sc_s.stat_id
    FROM public.stat_corrections sc_s
    JOIN public.stat_corrections sc_d
      ON sc_d.game_id = sc_s.game_id
     AND sc_d.stat_id = sc_s.stat_id
     AND sc_d.player_id = p_duplicate_id
    WHERE sc_s.player_id = p_survivor_id
    ORDER BY sc_s.game_id, sc_s.stat_id
  LOOP
    v_choice := p_resolutions->'stat_corrections'->v_idx->>'choice';
    IF v_choice IS NULL OR v_choice NOT IN ('survivor', 'duplicate', 'neither') THEN
      RAISE EXCEPTION 'merge_players_execute: stat_corrections[%] choice must be survivor, duplicate, or neither', v_idx;
    END IF;
    IF v_choice = 'survivor' THEN
      DELETE FROM public.stat_corrections WHERE id = r_sc.dup_row_id;
    ELSIF v_choice = 'duplicate' THEN
      DELETE FROM public.stat_corrections WHERE id = r_sc.surv_row_id;
      UPDATE public.stat_corrections SET player_id = p_survivor_id WHERE id = r_sc.dup_row_id;
    ELSE
      DELETE FROM public.stat_corrections WHERE id IN (r_sc.surv_row_id, r_sc.dup_row_id);
    END IF;
    v_idx := v_idx + 1;
  END LOOP;

  -- --- team_players conflicts ---
  v_idx := 0;
  FOR r_tp IN
    SELECT tp_s.team_id
    FROM public.team_players tp_s
    JOIN public.team_players tp_d
      ON tp_d.team_id = tp_s.team_id
     AND tp_d.player_id = p_duplicate_id
    WHERE tp_s.player_id = p_survivor_id
    ORDER BY tp_s.team_id
  LOOP
    v_tid := (p_resolutions->'team_players'->v_idx->>'team_id')::uuid;
    IF v_tid IS NULL OR v_tid <> r_tp.team_id THEN
      RAISE EXCEPTION 'merge_players_execute: team_players[%] team_id mismatch', v_idx;
    END IF;
    IF p_resolutions->'team_players'->v_idx ? 'is_active' THEN
      v_active := (p_resolutions->'team_players'->v_idx->>'is_active')::boolean;
    ELSE
      RAISE EXCEPTION 'merge_players_execute: team_players[%] missing is_active', v_idx;
    END IF;
    v_jersey := p_resolutions->'team_players'->v_idx->>'jersey_number';
    IF v_jersey = '' THEN
      v_jersey := NULL;
    END IF;
    IF (p_resolutions->'team_players'->v_idx->'position') IS NULL
       OR jsonb_typeof(p_resolutions->'team_players'->v_idx->'position') = 'null' THEN
      v_pos := NULL;
    ELSE
      v_pos := p_resolutions->'team_players'->v_idx->>'position';
    END IF;

    DELETE FROM public.team_players
    WHERE team_id = r_tp.team_id AND player_id IN (p_survivor_id, p_duplicate_id);

    INSERT INTO public.team_players (team_id, player_id, jersey_number, position, is_active, joined_at)
    VALUES (r_tp.team_id, p_survivor_id, v_jersey, v_pos, v_active, now());

    v_idx := v_idx + 1;
  END LOOP;

  -- --- player_guardians: move duplicate links to survivor ---
  INSERT INTO public.player_guardians (player_id, user_id, relationship)
  SELECT p_survivor_id, pg.user_id, pg.relationship
  FROM public.player_guardians pg
  WHERE pg.player_id = p_duplicate_id
  ON CONFLICT (player_id, user_id) DO NOTHING;

  DELETE FROM public.player_guardians WHERE player_id = p_duplicate_id;

  -- --- Remaining game_stats: repoint duplicate -> survivor ---
  UPDATE public.game_stats SET player_id = p_survivor_id WHERE player_id = p_duplicate_id;

  -- --- Remaining stat_corrections ---
  UPDATE public.stat_corrections SET player_id = p_survivor_id WHERE player_id = p_duplicate_id;

  -- --- Remaining team_players (duplicate only on team) ---
  UPDATE public.team_players SET player_id = p_survivor_id WHERE player_id = p_duplicate_id;

  -- --- player_checkouts: repoint then dedupe (earliest checked_out_at, then id) ---
  UPDATE public.player_checkouts SET player_id = p_survivor_id WHERE player_id = p_duplicate_id;

  DELETE FROM public.player_checkouts pc
  WHERE pc.id IN (
    SELECT id FROM (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY game_id, user_id
          ORDER BY checked_out_at ASC, id ASC
        ) AS rn
      FROM public.player_checkouts
      WHERE player_id = p_survivor_id
    ) ranked
    WHERE ranked.rn > 1
  );

  -- --- shot_chart: remount before deleting duplicate (ON DELETE CASCADE would wipe) ---
  -- Unique key is (game_id, recorded_by, client_shot_id). Prefer survivor on collision.
  DELETE FROM public.shot_chart sc_d
  WHERE sc_d.player_id = p_duplicate_id
    AND EXISTS (
      SELECT 1
      FROM public.shot_chart sc_s
      WHERE sc_s.player_id = p_survivor_id
        AND sc_s.game_id = sc_d.game_id
        AND sc_s.recorded_by = sc_d.recorded_by
        AND sc_s.client_shot_id = sc_d.client_shot_id
    );

  UPDATE public.shot_chart
  SET player_id = p_survivor_id
  WHERE player_id = p_duplicate_id;

  -- --- game_participants: preserve stable soccer identity before ON DELETE SET NULL ---
  UPDATE public.game_participants
  SET source_player_id = p_survivor_id, updated_at = now()
  WHERE source_player_id = p_duplicate_id;

  -- --- Backfill survivor name from duplicate where survivor is blank ---
  SELECT first_name, last_name, nickname
  INTO v_dup_first, v_dup_last, v_dup_nick
  FROM public.players WHERE id = p_duplicate_id;

  UPDATE public.players s
  SET
    first_name = CASE
      WHEN NULLIF(btrim(COALESCE(s.first_name, '')), '') IS NULL THEN v_dup_first
      ELSE s.first_name
    END,
    last_name = CASE
      WHEN NULLIF(btrim(COALESCE(s.last_name, '')), '') IS NULL THEN v_dup_last
      ELSE s.last_name
    END,
    nickname = CASE
      WHEN NULLIF(btrim(COALESCE(s.nickname, '')), '') IS NULL THEN v_dup_nick
      ELSE s.nickname
    END
  WHERE s.id = p_survivor_id;

  DELETE FROM public.players WHERE id = p_duplicate_id;

  INSERT INTO public.player_merge_audit (
    duplicate_player_id,
    survivor_player_id,
    merged_by,
    resolutions
  ) VALUES (
    p_duplicate_id,
    p_survivor_id,
    v_uid,
    p_resolutions
  );
END;
$$;

COMMENT ON FUNCTION public.merge_players_execute(uuid, uuid, jsonb) IS
  'Applies merge resolutions, remounts shot_chart/game_participants/game_stats/etc, deletes duplicate player, writes audit.';

GRANT EXECUTE ON FUNCTION public.merge_players_execute(uuid, uuid, jsonb) TO authenticated;
