-- Run before migration 047. This is read-only and reports how existing
-- team-scoped soccer participant source links will be classified.

with recursive soccer_participants as (
  select
    participant.id as participant_id,
    participant.game_id,
    game.team_id,
    participant.participant_kind,
    participant.client_player_id,
    participant.source_player_id,
    case
      when participant.client_player_id ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then participant.client_player_id::uuid
      else null
    end as original_player_id
  from public.game_participants participant
  join public.games game on game.id = participant.game_id
  where game.sport_id = 'soccer'
    and game.cloud_scope = 'team'
    and game.team_id is not null
),
lineage as (
  select
    participant.participant_id,
    participant.original_player_id as current_player_id,
    array[participant.original_player_id]::uuid[] as path,
    0 as depth
  from soccer_participants participant
  where participant.source_player_id is null
    and participant.original_player_id is not null

  union all

  select
    lineage.participant_id,
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
classified as (
  select
    participant.participant_id,
    participant.game_id,
    participant.team_id,
    participant.client_player_id,
    participant.source_player_id,
    terminal.survivor_player_id as repair_survivor_player_id,
    case
      when participant.source_player_id is not null then 'already_resolved'
      when participant.participant_kind = 'anonymous'
        or participant.original_player_id is null then 'intentionally_unresolved'
      when terminal.depth > 0
        and exists (
          select 1
          from public.players player
          where player.id = terminal.survivor_player_id
        )
        and exists (
          select 1
          from public.team_players team_player
          where team_player.team_id = participant.team_id
            and team_player.player_id = terminal.survivor_player_id
        ) then 'repairable'
      else 'unprovable'
    end as classification
  from soccer_participants participant
  left join terminal on terminal.participant_id = participant.participant_id
)
select
  classification,
  count(*) as participant_count
from classified
group by classification
order by case classification
  when 'repairable' then 1
  when 'already_resolved' then 2
  when 'intentionally_unresolved' then 3
  else 4
end;

-- Detailed rows for operator review. Re-run the CTE above and replace the
-- final SELECT with `select * from classified order by classification, game_id`.
