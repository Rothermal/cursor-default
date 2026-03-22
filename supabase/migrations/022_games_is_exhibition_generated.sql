-- ============================================================================
-- Migration 022: games.is_exhibition — generated column for queries & clarity
-- ============================================================================
-- Exhibition = no structured tournament FK (`tournament_id IS NULL`).
-- Keeps reporting and UI filters aligned without duplicating logic in every query.
-- ============================================================================

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS is_exhibition boolean
  GENERATED ALWAYS AS (tournament_id IS NULL) STORED;

COMMENT ON COLUMN public.games.is_exhibition IS
  'True when this game is not linked to a tournaments row (exhibition / non-tournament). Generated from tournament_id.';

CREATE INDEX IF NOT EXISTS idx_games_team_exhibition
  ON public.games (team_id)
  WHERE tournament_id IS NULL;
