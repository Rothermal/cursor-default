-- ============================================================================
-- Migration 019: Data integrity — seasons.sport, teams uniqueness, roster
-- jerseys, games.season_id + tournament FK check, sync trigger
-- ============================================================================
-- See docs/completed/DATA_INTEGRITY_AND_CREATION_PLAN.md
--
-- Preconditions (migration will abort with clear errors if violated):
--   - No duplicate (season_id, name) on teams
--   - No duplicate active jersey numbers per team (non-empty jersey_number)
--   - All seasons.sport values must be one of the app sport ids (lowercase)
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. Normalize and validate seasons.sport (must match src/config/sports.ts)
-- --------------------------------------------------------------------------

UPDATE public.seasons
SET sport = lower(trim(sport))
WHERE sport IS NOT NULL AND sport <> lower(trim(sport));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.seasons
    WHERE sport NOT IN ('basketball', 'baseball', 'football', 'hockey', 'soccer')
  ) THEN
    RAISE EXCEPTION
      'Migration 019: seasons.sport contains values outside app sport ids. '
      'Update offending rows to one of: basketball, baseball, football, hockey, soccer '
      '(see src/config/sports.ts).';
  END IF;
END $$;

ALTER TABLE public.seasons
  DROP CONSTRAINT IF EXISTS seasons_sport_valid;

ALTER TABLE public.seasons
  ADD CONSTRAINT seasons_sport_valid
  CHECK (sport IN ('basketball', 'baseball', 'football', 'hockey', 'soccer'));

COMMENT ON CONSTRAINT seasons_sport_valid ON public.seasons IS
  'Aligns with StatKeeper sport ids in src/config/sports.ts; extend when adding sports.';

-- --------------------------------------------------------------------------
-- 2. Unique team display name per season (owner-visible scope is per season)
-- --------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT season_id, name
    FROM public.teams
    GROUP BY season_id, name
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Migration 019: duplicate teams with the same season_id and name exist. '
      'Rename or merge duplicates, then re-run this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_unique_name_per_season
  ON public.teams (season_id, name);

-- --------------------------------------------------------------------------
-- 3. Active roster: at most one player per non-empty jersey number per team
-- --------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT team_id, btrim(jersey_number) AS jn
    FROM public.team_players
    WHERE is_active = true
      AND jersey_number IS NOT NULL
      AND btrim(jersey_number) <> ''
    GROUP BY team_id, btrim(jersey_number)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Migration 019: duplicate active jersey numbers on the same team exist. '
      'Fix team_players rows, then re-run this migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_players_active_jersey_unique
  ON public.team_players (team_id, (btrim(jersey_number)))
  WHERE is_active = true
    AND jersey_number IS NOT NULL
    AND btrim(jersey_number) <> '';

-- --------------------------------------------------------------------------
-- 4. games.season_id — denormalized from teams for reporting / integrity
-- --------------------------------------------------------------------------

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS season_id uuid REFERENCES public.seasons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_games_season ON public.games(season_id);

UPDATE public.games g
SET season_id = t.season_id
FROM public.teams t
WHERE g.team_id = t.id
  AND (g.season_id IS DISTINCT FROM t.season_id);

CREATE OR REPLACE FUNCTION public.set_game_season_from_team()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.team_id IS NULL THEN
    NEW.season_id := NULL;
    RETURN NEW;
  END IF;

  SELECT t.season_id INTO NEW.season_id
  FROM public.teams t
  WHERE t.id = NEW.team_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS games_set_season_id ON public.games;

CREATE TRIGGER games_set_season_id
  BEFORE INSERT OR UPDATE OF team_id ON public.games
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_game_season_from_team();

COMMENT ON COLUMN public.games.season_id IS
  'Denormalized from teams.season_id; kept in sync by trigger games_set_season_id.';

-- --------------------------------------------------------------------------
-- 5. Tournament FK must reference a tournament that belongs to the same team
--    (PostgreSQL CHECK cannot use subqueries; use a trigger.)
-- --------------------------------------------------------------------------

-- Fix obvious bad links before enforcing
UPDATE public.games g
SET tournament_id = NULL
WHERE g.tournament_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.tournaments tr
    WHERE tr.id = g.tournament_id AND tr.team_id = g.team_id
  );

CREATE OR REPLACE FUNCTION public.validate_game_tournament_team()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tournament_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tournaments tr
    WHERE tr.id = NEW.tournament_id
      AND tr.team_id = NEW.team_id
  ) THEN
    RAISE EXCEPTION
      'tournament_id % does not belong to team_id %',
      NEW.tournament_id,
      NEW.team_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS games_validate_tournament_team ON public.games;

CREATE TRIGGER games_validate_tournament_team
  BEFORE INSERT OR UPDATE OF team_id, tournament_id ON public.games
  FOR EACH ROW
  EXECUTE PROCEDURE public.validate_game_tournament_team();

COMMENT ON FUNCTION public.validate_game_tournament_team() IS
  'Ensures games.tournament_id references a tournaments row with matching team_id.';

-- --------------------------------------------------------------------------
-- 6. Refresh games_display view (018) to include games.season_id
-- --------------------------------------------------------------------------

DROP VIEW IF EXISTS public.games_display;
CREATE VIEW public.games_display WITH (security_invoker = true) AS
SELECT
  g.id,
  g.team_id,
  t.name AS team_name,
  g.season_id,
  s.name AS season_name,
  g.opponent_name,
  g.opponent_score,
  g.tournament_id,
  tour.name AS tournament_name,
  g.game_date,
  g.status,
  g.created_by,
  p.display_name AS created_by_name,
  g.home_score_adjustment,
  g.notes,
  g.created_at
FROM public.games g
LEFT JOIN public.teams t ON t.id = g.team_id
LEFT JOIN public.seasons s ON s.id = g.season_id
LEFT JOIN public.tournaments tour ON tour.id = g.tournament_id
LEFT JOIN public.profiles p ON p.id = g.created_by;
