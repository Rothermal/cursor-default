-- Copies of parity games with one malformed change each. Run after parity.sql in the same database.
\set ON_ERROR_STOP 1
create temporary table bad (name text, error text);
create or replace function pg_temp.clone_case(p_name text, p_game uuid) returns uuid language plpgsql as $$
declare g uuid := gen_random_uuid(); u uuid;
begin
  select created_by into u from public.games where id = p_game;
  insert into public.games (id, opponent_name, created_by, cloud_scope, sport_id, tracked_team_name, status, client_local_game_id)
    values (g, 'Rivals', u, 'personal', 'hockey', 'Blades', 'in_progress', p_name || g::text);
  insert into public.game_event_setup_snapshots (game_id, sport_id, setup_snapshot, updated_by)
    select g, sport_id, setup_snapshot, updated_by from public.game_event_setup_snapshots where game_id = p_game;
  insert into public.game_events (id, game_id, recorded_by, sport_id, event_type, schema_version, stream_sequence, revision, period_id, period_order, elapsed_ms, occurred_at, team_side, location, actors, payload, event_created_at, event_updated_at, deleted_at)
    select gen_random_uuid(), g, recorded_by, sport_id, event_type, schema_version, stream_sequence, revision, period_id, period_order, elapsed_ms, occurred_at, team_side, location, actors, payload, event_created_at, event_updated_at, deleted_at
    from public.game_events where game_id = p_game;
  return g;
end $$;
create or replace function pg_temp.try(p_name text, p_game uuid) returns void language plpgsql as $$
declare t int; o int; u uuid;
begin
  select created_by into u from public.games where id = p_game;
  begin
    select tracked_score, opponent_score into t, o from public.validate_hockey_finalization_policy(p_game, u);
    insert into bad values (p_name, 'ACCEPTED ' || t || '-' || o);
  exception when others then insert into bad values (p_name, sqlerrm);
  end;
end $$;
do $$
declare base uuid; tie uuid; g uuid;
begin
  -- The shootout early-clinch game and the youth tie from the parity run.
  select e.game_id into base from public.game_events e where e.event_type = 'hockey.shootout_attempt' group by e.game_id having count(*) = 4 limit 1;
  select e.game_id into tie from public.game_events e join public.game_event_setup_snapshots s on s.game_id = e.game_id
    where s.setup_snapshot#>>'{rulesSnapshot,profileId}' = 'usa_hockey_youth' group by e.game_id
    having count(*) filter (where e.event_type = 'hockey.shot') = 2 and count(*) filter (where e.event_type = 'hockey.match_ended') = 1 limit 1;

  g := pg_temp.clone_case('rounds-missing', base);
  update public.game_event_setup_snapshots set setup_snapshot = setup_snapshot #- '{rulesSnapshot,shootout,rounds}' where game_id = g;
  perform pg_temp.try('shootout rounds missing', g);

  g := pg_temp.clone_case('rounds-fraction', base);
  update public.game_event_setup_snapshots set setup_snapshot = jsonb_set(setup_snapshot, '{rulesSnapshot,shootout,rounds}', '2.5') where game_id = g;
  perform pg_temp.try('shootout rounds 2.5', g);

  g := pg_temp.clone_case('rounds-null-shootout', base);
  update public.game_event_setup_snapshots set setup_snapshot = jsonb_set(setup_snapshot, '{rulesSnapshot,shootout}', 'null') where game_id = g;
  perform pg_temp.try('shootout rules null', g);

  g := pg_temp.clone_case('two-starts', base);
  insert into public.game_events (id, game_id, recorded_by, sport_id, event_type, schema_version, stream_sequence, revision, period_id, period_order, occurred_at, team_side, payload, event_created_at, event_updated_at)
    select gen_random_uuid(), game_id, recorded_by, sport_id, event_type, 1, 500, 1, period_id, period_order, occurred_at, team_side, payload, event_created_at, event_updated_at
    from public.game_events where game_id = g and event_type = 'hockey.shootout_started';
  perform pg_temp.try('two shootout starts', g);

  g := pg_temp.clone_case('uneven-attempts', base);
  update public.game_events set team_side = 'tracked' where game_id = g and event_type = 'hockey.shootout_attempt' and stream_sequence = (select max(stream_sequence) from public.game_events where game_id = g and event_type = 'hockey.shootout_attempt');
  perform pg_temp.try('attempts differ by two', g);

  g := pg_temp.clone_case('attempt-no-start', base);
  delete from public.game_events where game_id = g and event_type = 'hockey.shootout_started';
  perform pg_temp.try('attempts without a start', g);

  g := pg_temp.clone_case('attempt-bad-outcome', base);
  update public.game_events set payload = jsonb_set(payload, '{outcome}', '"blocked"') where game_id = g and event_type = 'hockey.shootout_attempt' and payload->>'outcome' = 'saved';
  perform pg_temp.try('attempt outcome blocked', g);

  g := pg_temp.clone_case('delta-two', tie);
  insert into public.game_events (id, game_id, recorded_by, sport_id, event_type, schema_version, stream_sequence, revision, period_id, period_order, occurred_at, team_side, payload, event_created_at, event_updated_at)
    values (gen_random_uuid(), g, (select created_by from public.games where id = g), 'hockey', 'hockey.score_adjustment', 1, 2, 1, 'regulation-1', 1, now(), 'tracked', '{"captureCommandId":null,"delta":2,"reason":"x"}', now(), now());
  perform pg_temp.try('adjustment delta 2', g);

  g := pg_temp.clone_case('delta-string', tie);
  insert into public.game_events (id, game_id, recorded_by, sport_id, event_type, schema_version, stream_sequence, revision, period_id, period_order, occurred_at, team_side, payload, event_created_at, event_updated_at)
    values (gen_random_uuid(), g, (select created_by from public.games where id = g), 'hockey', 'hockey.score_adjustment', 1, 2, 1, 'regulation-1', 1, now(), 'tracked', '{"captureCommandId":null,"delta":"1","reason":"x"}', now(), now());
  perform pg_temp.try('adjustment delta as text', g);

  g := pg_temp.clone_case('negative', tie);
  insert into public.game_events (id, game_id, recorded_by, sport_id, event_type, schema_version, stream_sequence, revision, period_id, period_order, occurred_at, team_side, payload, event_created_at, event_updated_at)
    select gen_random_uuid(), g, created_by, 'hockey', 'hockey.score_adjustment', 1, 2 + n, 1, 'regulation-1', 1, now(), 'tracked', '{"captureCommandId":null,"delta":-1,"reason":"x"}', now(), now()
    from public.games, generate_series(1, 2) n where id = g;
  perform pg_temp.try('score below zero', g);

  g := pg_temp.clone_case('neutral-shot', tie);
  update public.game_events set team_side = 'neutral' where game_id = g and event_type = 'hockey.shot' and team_side = 'tracked';
  perform pg_temp.try('neutral goal', g);

  g := pg_temp.clone_case('bad-outcome', tie);
  update public.game_events set payload = jsonb_set(payload, '{outcome}', '"scored"') where game_id = g and event_type = 'hockey.shot' and team_side = 'tracked';
  perform pg_temp.try('shot outcome scored', g);

  g := pg_temp.clone_case('schema-2', tie);
  update public.game_events set schema_version = 2 where game_id = g and event_type = 'hockey.shot' and team_side = 'tracked';
  perform pg_temp.try('shot schema version 2', g);

  g := pg_temp.clone_case('end-schema-2', tie);
  update public.game_events set schema_version = 2 where game_id = g and event_type = 'hockey.match_ended';
  perform pg_temp.try('end schema version 2', g);

  g := pg_temp.clone_case('deleted-goal', tie);
  update public.game_events set deleted_at = event_created_at, revision = 2 where game_id = g and event_type = 'hockey.shot' and team_side = 'tracked';
  perform pg_temp.try('removed tracked goal (valid, 0-1)', g);

  g := pg_temp.clone_case('other-recorder-ignored', tie);
  perform pg_temp.try('clone of the youth tie (valid, 1-1)', g);
end $$;
select * from bad;
do $$
declare expected jsonb := '{
  "shootout rounds missing": "Hockey shootout rules are unavailable for finalization",
  "shootout rounds 2.5": "Hockey shootout rules are unavailable for finalization",
  "shootout rules null": "Hockey shootout rules are unavailable for finalization",
  "two shootout starts": "invalid Hockey shootout data",
  "attempts differ by two": "invalid Hockey shootout data",
  "attempts without a start": "invalid Hockey shootout data",
  "attempt outcome blocked": "invalid Hockey scoring data",
  "adjustment delta 2": "invalid Hockey scoring data",
  "adjustment delta as text": "invalid Hockey scoring data",
  "score below zero": "Canonical Hockey scores are invalid",
  "neutral goal": "invalid Hockey scoring data",
  "shot outcome scored": "invalid Hockey scoring data",
  "shot schema version 2": "invalid Hockey scoring data",
  "end schema version 2": "do not end in a final Hockey outcome",
  "removed tracked goal (valid, 0-1)": "ACCEPTED 0-1",
  "clone of the youth tie (valid, 1-1)": "ACCEPTED 1-1"
}';
declare row record; n int := 0;
begin
  for row in select * from bad loop
    n := n + 1;
    if expected->>row.name is null or position(lower(expected->>row.name) in lower(row.error)) = 0 then
      raise exception 'malformed case "%" gave "%"', row.name, row.error;
    end if;
  end loop;
  if n <> (select count(*) from jsonb_object_keys(expected)) then raise exception 'expected % malformed cases, ran %', (select count(*) from jsonb_object_keys(expected)), n; end if;
end $$;
