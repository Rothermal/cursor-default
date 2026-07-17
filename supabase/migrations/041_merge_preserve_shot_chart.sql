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
  'Applies merge resolutions, remounts shot_chart/game_stats/etc, deletes duplicate player, writes audit (DESIGN_PLAYER_MERGE).';

GRANT EXECUTE ON FUNCTION public.merge_players_execute(uuid, uuid, jsonb) TO authenticated;
