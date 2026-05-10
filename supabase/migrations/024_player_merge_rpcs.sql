-- ============================================================================
-- Migration 024: Player merge — audit table + preview / execute RPCs
-- Design: docs/completed/DESIGN_PLAYER_MERGE.md
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Audit table
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.player_merge_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  duplicate_player_id uuid NOT NULL,
  survivor_player_id uuid NOT NULL,
  merged_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  resolutions jsonb,
  note text
);

COMMENT ON TABLE public.player_merge_audit IS
  'Record of merge_players_execute runs (support / compliance).';

ALTER TABLE public.player_merge_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "player_merge_audit_no_select" ON public.player_merge_audit
  FOR SELECT USING (false);

CREATE POLICY "player_merge_audit_no_insert" ON public.player_merge_audit
  FOR INSERT WITH CHECK (false);

CREATE POLICY "player_merge_audit_no_update" ON public.player_merge_audit
  FOR UPDATE USING (false);

CREATE POLICY "player_merge_audit_no_delete" ON public.player_merge_audit
  FOR DELETE USING (false);

-- --------------------------------------------------------------------------
-- 2. Authorization: owner or admin on every team that has either player
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_players_can_merge(
  p_user_id uuid,
  p_duplicate_id uuid,
  p_survivor_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM (
      SELECT DISTINCT tp.team_id
      FROM public.team_players tp
      WHERE tp.player_id IN (p_duplicate_id, p_survivor_id)
    ) teams_involved
    WHERE NOT (
      EXISTS (
        SELECT 1 FROM public.teams t
        WHERE t.id = teams_involved.team_id AND t.owner_id = p_user_id
      )
      OR EXISTS (
        SELECT 1 FROM public.team_members tm
        WHERE tm.team_id = teams_involved.team_id
          AND tm.user_id = p_user_id
          AND tm.role IN ('owner', 'admin')
      )
    )
  );
$$;

COMMENT ON FUNCTION public.merge_players_can_merge(uuid, uuid, uuid) IS
  'True if p_user_id may merge p_duplicate_id into p_survivor_id (DESIGN_PLAYER_MERGE).';

-- --------------------------------------------------------------------------
-- 3. Preview: conflict detail for UI (no mutations)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_players_preview(
  p_duplicate_id uuid,
  p_survivor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_gs jsonb;
  v_sc jsonb;
  v_tp jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'merge_players_preview: not authenticated';
  END IF;
  IF p_duplicate_id = p_survivor_id THEN
    RAISE EXCEPTION 'merge_players_preview: duplicate and survivor must differ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_duplicate_id) THEN
    RAISE EXCEPTION 'merge_players_preview: duplicate player not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_survivor_id) THEN
    RAISE EXCEPTION 'merge_players_preview: survivor player not found';
  END IF;
  IF NOT public.merge_players_can_merge(v_uid, p_duplicate_id, p_survivor_id) THEN
    RAISE EXCEPTION 'merge_players_preview: not authorized (need owner or admin on all teams for both players)';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.game_id, x.recorded_by, x.stat_id), '[]'::jsonb)
  INTO v_gs
  FROM (
    SELECT
      g.id AS game_id,
      g.game_date::text AS game_date,
      g.opponent_name,
      gs_s.recorded_by,
      COALESCE(pr.display_name, gs_s.recorded_by::text) AS recorder_display,
      gs_s.stat_id,
      jsonb_build_object('id', gs_s.id, 'value', gs_s.value) AS survivor_row,
      jsonb_build_object('id', gs_d.id, 'value', gs_d.value) AS duplicate_row
    FROM public.game_stats gs_s
    JOIN public.game_stats gs_d
      ON gs_d.game_id = gs_s.game_id
     AND gs_d.recorded_by = gs_s.recorded_by
     AND gs_d.stat_id = gs_s.stat_id
     AND gs_d.player_id = p_duplicate_id
    JOIN public.games g ON g.id = gs_s.game_id
    LEFT JOIN public.profiles pr ON pr.id = gs_s.recorded_by
    WHERE gs_s.player_id = p_survivor_id
  ) x;

  SELECT COALESCE(jsonb_agg(row_to_json(y)::jsonb ORDER BY y.game_id, y.stat_id), '[]'::jsonb)
  INTO v_sc
  FROM (
    SELECT
      sc_s.game_id,
      g.game_date::text AS game_date,
      sc_s.stat_id,
      jsonb_build_object(
        'id', sc_s.id,
        'corrected_value', sc_s.corrected_value,
        'created_at', sc_s.created_at,
        'reason', sc_s.reason
      ) AS survivor_row,
      jsonb_build_object(
        'id', sc_d.id,
        'corrected_value', sc_d.corrected_value,
        'created_at', sc_d.created_at,
        'reason', sc_d.reason
      ) AS duplicate_row
    FROM public.stat_corrections sc_s
    JOIN public.stat_corrections sc_d
      ON sc_d.game_id = sc_s.game_id
     AND sc_d.stat_id = sc_s.stat_id
     AND sc_d.player_id = p_duplicate_id
    JOIN public.games g ON g.id = sc_s.game_id
    WHERE sc_s.player_id = p_survivor_id
  ) y;

  SELECT COALESCE(jsonb_agg(row_to_json(z)::jsonb ORDER BY z.team_id), '[]'::jsonb)
  INTO v_tp
  FROM (
    SELECT
      tp_s.team_id,
      t.name AS team_name,
      jsonb_build_object(
        'jersey_number', tp_s.jersey_number,
        'is_active', tp_s.is_active,
        'position', tp_s.position
      ) AS survivor,
      jsonb_build_object(
        'jersey_number', tp_d.jersey_number,
        'is_active', tp_d.is_active,
        'position', tp_d.position
      ) AS duplicate
    FROM public.team_players tp_s
    JOIN public.team_players tp_d
      ON tp_d.team_id = tp_s.team_id
     AND tp_d.player_id = p_duplicate_id
    JOIN public.teams t ON t.id = tp_s.team_id
    WHERE tp_s.player_id = p_survivor_id
  ) z;

  RETURN jsonb_build_object(
    'game_stats', v_gs,
    'stat_corrections', v_sc,
    'team_players', v_tp
  );
END;
$$;

COMMENT ON FUNCTION public.merge_players_preview(uuid, uuid) IS
  'Returns JSON conflict lists for merge wizard (DESIGN_PLAYER_MERGE).';

GRANT EXECUTE ON FUNCTION public.merge_players_preview(uuid, uuid) TO authenticated;

-- --------------------------------------------------------------------------
-- 4. Execute: apply resolutions and delete duplicate (single transaction)
-- --------------------------------------------------------------------------
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
  'Applies merge resolutions, deletes duplicate player, writes audit (DESIGN_PLAYER_MERGE).';

GRANT EXECUTE ON FUNCTION public.merge_players_execute(uuid, uuid, jsonb) TO authenticated;
