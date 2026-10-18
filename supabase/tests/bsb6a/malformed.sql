-- Copies of parity games with one malformed change each. Run after parity.sql in the same database.
\set ON_ERROR_STOP 1
create temporary table bad (name text, error text);
create or replace function pg_temp.clone_case(p_case text) returns uuid language plpgsql as $$
declare g uuid := gen_random_uuid(); u uuid; source uuid;
begin
  select id, created_by into source, u from public.games where client_local_game_id = p_case;
  if source is null then raise exception 'no parity case %', p_case; end if;
  insert into public.games (id, opponent_name, created_by, cloud_scope, sport_id, tracked_team_name, status, client_local_game_id)
    values (g, 'Visitors', u, 'personal', 'baseball', 'Aces', 'in_progress', 'clone ' || g::text);
  insert into public.game_event_setup_snapshots (game_id, sport_id, setup_snapshot, updated_by)
    select g, sport_id, setup_snapshot, updated_by from public.game_event_setup_snapshots where game_id = source;
  insert into public.game_events (id, game_id, recorded_by, sport_id, event_type, schema_version, stream_sequence, revision, period_id, period_order, elapsed_ms, occurred_at, team_side, location, actors, payload, event_created_at, event_updated_at, deleted_at)
    select gen_random_uuid(), g, recorded_by, sport_id, event_type, schema_version, stream_sequence, revision, period_id, period_order, elapsed_ms, occurred_at, team_side, location, actors, payload, event_created_at, event_updated_at, deleted_at
    from public.game_events where game_id = source;
  return g;
end $$;
create or replace function pg_temp.try(p_name text, p_game uuid) returns void language plpgsql as $$
declare t int; o int; u uuid;
begin
  select created_by into u from public.games where id = p_game;
  begin
    select tracked_score, opponent_score into t, o from public.validate_baseball_finalization_policy(p_game, u);
    insert into bad values (p_name, 'ACCEPTED ' || t || '-' || o);
  exception when others then insert into bad values (p_name, sqlerrm);
  end;
end $$;
-- The walk-off double of the walk-off case: first -> home, batter -> second.
create or replace function pg_temp.walk_off(p_game uuid) returns uuid language sql as $$
  select id from public.game_events where game_id = p_game and event_type = 'baseball.pitch' and payload#>>'{inPlay,result}' = 'double';
$$;
create or replace function pg_temp.add_adjustment(p_game uuid, p_side text, p_delta jsonb) returns void language sql as $$
  insert into public.game_events (id, game_id, recorded_by, sport_id, event_type, schema_version, stream_sequence, revision, period_id, period_order, occurred_at, team_side, payload, event_created_at, event_updated_at)
  select gen_random_uuid(), p_game, created_by, 'baseball', 'baseball.score_adjustment', 1, 100000, 1, 'inning-7-bottom', 14, now(), p_side,
    jsonb_build_object('captureCommandId', null, 'delta', p_delta, 'reason', 'x'), now(), now()
  from public.games where id = p_game;
$$;
do $$
declare
  walk_off constant text := 'walk-off double in the bottom of the seventh';
  third_out constant text := 'batter out before first on the third out';
  g uuid;
begin
  g := pg_temp.clone_case(walk_off);
  delete from public.game_event_setup_snapshots where game_id = g;
  perform pg_temp.try('setup missing', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_event_setup_snapshots set setup_snapshot = setup_snapshot #- '{trackedSide}' where game_id = g;
  perform pg_temp.try('tracked side missing', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_event_setup_snapshots set setup_snapshot = jsonb_set(jsonb_set(setup_snapshot, '{rulesSnapshot,placedRunnerBase}', '"fourth"'), '{rulesSnapshot,placedRunnerFromInning}', '8') where game_id = g;
  perform pg_temp.try('placed runner base fourth', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_event_setup_snapshots set setup_snapshot = jsonb_set(jsonb_set(setup_snapshot, '{rulesSnapshot,placedRunnerBase}', '"second"'), '{rulesSnapshot,placedRunnerFromInning}', '8.5') where game_id = g;
  perform pg_temp.try('placed runner inning 8.5', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_event_setup_snapshots set setup_snapshot = jsonb_set(setup_snapshot, '{rulesSnapshot,placedRunnerBase}', '"second"') where game_id = g;
  perform pg_temp.try('placed runner base without an inning', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set period_id = 'inning-7-middle' where id = pg_temp.walk_off(g);
  perform pg_temp.try('unreadable half-inning', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set period_order = 13 where id = pg_temp.walk_off(g);
  perform pg_temp.try('half-inning order mismatch', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set period_id = 'inning-1-top', period_order = 1 where id = pg_temp.walk_off(g);
  perform pg_temp.try('half-inning goes backward', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set payload = jsonb_set(payload, '{movements,0,from}', '"home"') where id = pg_temp.walk_off(g);
  perform pg_temp.try('movement from home', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set payload = jsonb_set(payload, '{movements,0,to}', '"first"') where id = pg_temp.walk_off(g);
  perform pg_temp.try('movement does not advance', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set payload = jsonb_set(payload, '{movements,0,runCounts}', '"yes"') where id = pg_temp.walk_off(g);
  perform pg_temp.try('run override as text', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set payload = jsonb_set(payload, '{movements,1,runCounts}', 'true') where id = pg_temp.walk_off(g);
  perform pg_temp.try('run override on a base', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set payload = payload #- '{movements,0,runCounts}' where id = pg_temp.walk_off(g);
  perform pg_temp.try('run override key missing', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set payload = jsonb_set(payload, '{movements,0,from}', '"second"') where id = pg_temp.walk_off(g);
  perform pg_temp.try('runner from an empty base', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set payload = jsonb_set(payload, '{movements,0,to}', '"second"') where id = pg_temp.walk_off(g);
  perform pg_temp.try('two runners finish on second', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set payload = jsonb_set(payload, '{movements,0,from}', '"batter"') where id = pg_temp.walk_off(g);
  perform pg_temp.try('two batter movements', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set team_side = 'opponent' where id = pg_temp.walk_off(g);
  perform pg_temp.try('pitch for the fielding side', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set schema_version = 2 where id = pg_temp.walk_off(g);
  perform pg_temp.try('pitch schema version 2', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set payload = jsonb_set(payload, '{movements}', '{}') where id = pg_temp.walk_off(g);
  perform pg_temp.try('movements not a list', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set payload = jsonb_set(payload, '{movements}', (payload->'movements') || (payload->'movements') || (payload->'movements')) where id = pg_temp.walk_off(g);
  perform pg_temp.try('six movements', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set event_type = 'baseball.baserunning' where id = pg_temp.walk_off(g);
  perform pg_temp.try('batter runs on a baserunning play', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set event_type = 'baseball.plate_appearance', payload = jsonb_set(payload, '{movements}', jsonb_build_array(payload#>'{movements,0}')) where id = pg_temp.walk_off(g);
  perform pg_temp.try('plate appearance without the batter', g);

  g := pg_temp.clone_case(third_out);
  update public.game_events set payload = jsonb_set(payload, '{movements,0,to}', '"out"') where game_id = g and event_type = 'baseball.pitch' and payload#>>'{inPlay,result}' = 'out';
  perform pg_temp.try('fourth out', g);

  g := pg_temp.clone_case(third_out);
  update public.game_events set stream_sequence = stream_sequence + 10 where game_id = g and event_type = 'baseball.game_ended';
  insert into public.game_events (id, game_id, recorded_by, sport_id, event_type, schema_version, stream_sequence, revision, period_id, period_order, occurred_at, team_side, payload, event_created_at, event_updated_at)
    select gen_random_uuid(), g, created_by, 'baseball', 'baseball.baserunning', 1,
      (select stream_sequence - 5 from public.game_events where game_id = g and event_type = 'baseball.game_ended'), 1, 'inning-1-top', 1, now(), 'opponent',
      '{"captureCommandId":null,"play":"stolen_base","movements":[{"runnerId":"x","from":"first","to":"second","reason":"stolen_base","fielders":[],"errorBy":null,"earned":null,"rbi":null,"runCounts":null}]}', now(), now()
    from public.games where id = g;
  perform pg_temp.try('play after the third out', g);

  g := pg_temp.clone_case(walk_off);
  perform pg_temp.add_adjustment(g, 'tracked', '1.5');
  perform pg_temp.try('adjustment delta 1.5', g);

  g := pg_temp.clone_case(walk_off);
  perform pg_temp.add_adjustment(g, 'tracked', '"1"');
  perform pg_temp.try('adjustment delta as text', g);

  g := pg_temp.clone_case(walk_off);
  perform pg_temp.add_adjustment(g, 'tracked', '51');
  perform pg_temp.try('adjustment delta 51', g);

  g := pg_temp.clone_case(walk_off);
  perform pg_temp.add_adjustment(g, 'neutral', '1');
  perform pg_temp.try('adjustment for neither side', g);

  g := pg_temp.clone_case(walk_off);
  perform pg_temp.add_adjustment(g, 'opponent', '-1');
  perform pg_temp.try('score below zero', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set schema_version = 2 where game_id = g and event_type = 'baseball.game_ended';
  perform pg_temp.try('end schema version 2', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set payload = jsonb_set(payload, '{outcome}', '"rained_out"') where game_id = g and event_type = 'baseball.game_ended';
  perform pg_temp.try('end outcome rained out', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set team_side = 'tracked' where game_id = g and event_type = 'baseball.game_ended';
  perform pg_temp.try('end for one side', g);

  g := pg_temp.clone_case(walk_off);
  update public.game_events set deleted_at = event_created_at, revision = 2 where id = pg_temp.walk_off(g);
  perform pg_temp.try('removed walk-off double (valid, 0-0)', g);

  g := pg_temp.clone_case(walk_off);
  perform pg_temp.add_adjustment(g, 'opponent', '2');
  perform pg_temp.try('opponent adjustment (valid, 1-2)', g);

  g := pg_temp.clone_case(walk_off);
  perform pg_temp.try('clone of the walk-off (valid, 1-0)', g);
end $$;
select * from bad;
do $$
declare expected jsonb := '{
  "setup missing": "Baseball rules are unavailable for finalization",
  "tracked side missing": "Baseball rules are unavailable for finalization",
  "placed runner base fourth": "Baseball rules are unavailable for finalization",
  "placed runner inning 8.5": "Baseball rules are unavailable for finalization",
  "placed runner base without an inning": "Baseball rules are unavailable for finalization",
  "unreadable half-inning": "unreadable Baseball half-inning",
  "half-inning order mismatch": "unreadable Baseball half-inning",
  "half-inning goes backward": "unreadable Baseball half-inning",
  "movement from home": "invalid Baseball runner movements",
  "movement does not advance": "invalid Baseball runner movements",
  "run override as text": "invalid Baseball runner movements",
  "run override on a base": "invalid Baseball runner movements",
  "run override key missing": "invalid Baseball runner movements",
  "runner from an empty base": "move a runner who is not on that base",
  "two runners finish on second": "put two runners on one base",
  "two batter movements": "invalid Baseball runner movements",
  "pitch for the fielding side": "invalid Baseball scoring data",
  "pitch schema version 2": "invalid Baseball scoring data",
  "movements not a list": "invalid Baseball scoring data",
  "six movements": "invalid Baseball scoring data",
  "batter runs on a baserunning play": "invalid Baseball runner movements",
  "plate appearance without the batter": "invalid Baseball runner movements",
  "fourth out": "more than three outs",
  "play after the third out": "play after the third out",
  "adjustment delta 1.5": "invalid Baseball scoring data",
  "adjustment delta as text": "invalid Baseball scoring data",
  "adjustment delta 51": "invalid Baseball scoring data",
  "adjustment for neither side": "invalid Baseball scoring data",
  "score below zero": "Canonical Baseball scores are invalid",
  "end schema version 2": "do not end in a final Baseball outcome",
  "end outcome rained out": "do not end in a final Baseball outcome",
  "end for one side": "do not end in a final Baseball outcome",
  "removed walk-off double (valid, 0-0)": "ACCEPTED 0-0",
  "opponent adjustment (valid, 1-2)": "ACCEPTED 1-2",
  "clone of the walk-off (valid, 1-0)": "ACCEPTED 1-0"
}'::jsonb; r record; n int := 0;
begin
  for r in select * from bad loop
    n := n + 1;
    if expected->>r.name is null or position(expected->>r.name in r.error) = 0 then
      raise exception 'malformed check % gave: %', r.name, r.error;
    end if;
  end loop;
  if n <> (select count(*) from jsonb_object_keys(expected)) then raise exception 'malformed checks ran % of %', n, (select count(*) from jsonb_object_keys(expected)); end if;
  raise notice 'malformed: % checks passed', n;
end $$;
