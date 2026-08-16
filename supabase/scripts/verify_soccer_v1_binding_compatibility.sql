-- Runtime verification for the permanent migration-051 bind_soccer_event_game wrapper.
-- Run in the Supabase SQL Editor after an owner has one non-final personal Soccer cloud game.
-- The transaction rolls back the binder's idempotent metadata writes.

begin;

select set_config(
  'app.verify_user_id',
  (
    select game.created_by::text
    from public.games game
    where game.sport_id = 'soccer'
      and game.cloud_scope = 'personal'
      and game.status <> 'final'
      and game.client_local_game_id is not null
    order by game.created_at desc, game.id desc
    limit 1
  ),
  true
);

select set_config(
  'request.jwt.claim.sub',
  current_setting('app.verify_user_id'),
  true
);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('app.verify_user_id'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

with target as (
  select
    game.id,
    game.client_local_game_id,
    game.tracked_team_name,
    game.opponent_name,
    game.tournament_name,
    game.game_date,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'client_participant_id', participant.client_participant_id,
        'client_player_id', participant.client_player_id,
        'source_player_id', participant.source_player_id,
        'kind', participant.participant_kind,
        'display_name', participant.display_name,
        'jersey_number', participant.jersey_number,
        'snapshot', participant.snapshot
      ) order by participant.created_at, participant.id), '[]'::jsonb)
      from public.game_participants participant
      where participant.game_id = game.id
    ) as participants,
    (
      select coalesce(
        jsonb_object_agg(participant.client_player_id, participant.id::text),
        '{}'::jsonb
      )
      from public.game_participants participant
      where participant.game_id = game.id
        and participant.client_player_id is not null
    ) as expected_participant_id_map
  from public.games game
  where game.created_by = (select auth.uid())
    and game.sport_id = 'soccer'
    and game.cloud_scope = 'personal'
    and game.status <> 'final'
    and game.client_local_game_id is not null
  order by game.created_at desc, game.id desc
  limit 1
), result as (
  select
    target.*,
    public.bind_soccer_event_game(
      target.client_local_game_id,
      null,
      null,
      target.tracked_team_name,
      target.opponent_name,
      target.tournament_name,
      target.game_date,
      target.participants
    ) as binding
  from target
)
select
  id as expected_game_id,
  (binding->>'game_id')::uuid as returned_game_id,
  (binding->>'game_id')::uuid = id as same_game_id,
  binding->'participant_id_map' = expected_participant_id_map
    as same_participant_id_map
from result;

rollback;

-- Expected: exactly one row with same_game_id=true and same_participant_id_map=true.
