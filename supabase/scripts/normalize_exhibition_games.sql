-- ============================================================================
-- Exhibition games: identify, optionally link legacy rows, optional cleanup
-- ============================================================================
-- Product rule: **Exhibition** = any game with `tournament_id IS NULL`.
-- Structured tournament games have `tournament_id` set to a row in `tournaments`.
--
-- Legacy rows may have `tournament_name` filled while `tournament_id` IS NULL
-- (pre–016 or free-text only). Those still appear in "Exhibition" until you either:
--   (A) set `tournament_id` by matching `tournaments(team_id, name)`, or
--   (B) clear `tournament_name` if you want exhibition rows to have no tournament label.
--
-- Run in Supabase SQL Editor as **service role** or a role that bypasses RLS for
-- maintenance, or run per-owner after authenticating — RLS may block bulk updates.
--
-- Always run the SELECT sections first; wrap UPDATEs in a transaction and verify counts.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) Counts: tournament vs exhibition (global)
-- --------------------------------------------------------------------------
SELECT
  count(*) FILTER (WHERE tournament_id IS NOT NULL) AS games_in_structured_tournament,
  count(*) FILTER (WHERE tournament_id IS NULL) AS games_exhibition,
  count(*) AS games_total
FROM public.games;

-- --------------------------------------------------------------------------
-- 2) Exhibition with leftover free-text tournament_name (legacy / misleading)
-- --------------------------------------------------------------------------
SELECT
  id,
  team_id,
  game_date,
  status,
  opponent_name,
  tournament_id,
  tournament_name
FROM public.games
WHERE tournament_id IS NULL
  AND tournament_name IS NOT NULL
  AND btrim(tournament_name) <> ''
ORDER BY game_date DESC
LIMIT 200;

-- --------------------------------------------------------------------------
-- 3) Preview: link exhibition rows to an existing tournament (exact name, same team)
--     tournaments has UNIQUE (team_id, name) — at most one match per game.
-- --------------------------------------------------------------------------
SELECT
  g.id AS game_id,
  g.team_id,
  g.tournament_name AS game_tournament_name,
  t.id AS would_set_tournament_id,
  t.name AS tournament_row_name
FROM public.games g
JOIN public.tournaments t
  ON t.team_id = g.team_id
 AND t.name = btrim(g.tournament_name)
WHERE g.tournament_id IS NULL
  AND g.tournament_name IS NOT NULL
  AND btrim(g.tournament_name) <> '';

-- --------------------------------------------------------------------------
-- 4) APPLY (optional): set tournament_id where name matches a tournament row
--     Uncomment and run inside a transaction after reviewing section 3.
-- --------------------------------------------------------------------------
-- BEGIN;
-- UPDATE public.games g
-- SET tournament_id = t.id
-- FROM public.tournaments t
-- WHERE g.tournament_id IS NULL
--   AND g.tournament_name IS NOT NULL
--   AND btrim(g.tournament_name) <> ''
--   AND t.team_id = g.team_id
--   AND t.name = btrim(g.tournament_name);
-- COMMIT;

-- --------------------------------------------------------------------------
-- 5) Preview: exhibition rows that still have tournament_name (after step 4 if run)
--     Clearing makes UI treat them as plain "Exhibition" with no redundant label.
-- --------------------------------------------------------------------------
SELECT id, team_id, tournament_name, opponent_name, game_date, status
FROM public.games
WHERE tournament_id IS NULL
  AND tournament_name IS NOT NULL
  AND btrim(tournament_name) <> '';

-- --------------------------------------------------------------------------
-- 6) APPLY (optional): clear tournament_name on exhibition rows only
-- --------------------------------------------------------------------------
-- BEGIN;
-- UPDATE public.games
-- SET tournament_name = NULL
-- WHERE tournament_id IS NULL
--   AND tournament_name IS NOT NULL
--   AND btrim(tournament_name) <> '';
-- COMMIT;

-- --------------------------------------------------------------------------
-- 7) Sanity: structured tournament but name out of sync (optional cleanup in app)
-- --------------------------------------------------------------------------
SELECT
  g.id,
  g.team_id,
  g.tournament_id,
  g.tournament_name,
  t.name AS tournaments_table_name
FROM public.games g
JOIN public.tournaments t ON t.id = g.tournament_id
WHERE g.tournament_id IS NOT NULL
  AND (
    g.tournament_name IS DISTINCT FROM t.name
  );

-- Optional: denormalize display name from tournaments row
-- BEGIN;
-- UPDATE public.games g
-- SET tournament_name = t.name
-- FROM public.tournaments t
-- WHERE t.id = g.tournament_id
--   AND (g.tournament_name IS DISTINCT FROM t.name);
-- COMMIT;
