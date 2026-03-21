-- Optional: run in Supabase SQL Editor BEFORE applying migration 019_data_integrity_constraints.sql
-- to find rows that will block the migration. Fix data, then apply 019.

-- 1) Seasons with sport outside app ids (must become basketball|baseball|football|hockey|soccer)
SELECT id, name, sport
FROM public.seasons
WHERE lower(trim(sport)) NOT IN ('basketball', 'baseball', 'football', 'hockey', 'soccer')
   OR sport <> lower(trim(sport));

-- 2) Duplicate team name within same season
SELECT season_id, name, COUNT(*) AS n
FROM public.teams
GROUP BY season_id, name
HAVING COUNT(*) > 1;

-- 3) Duplicate active jersey numbers (non-empty) on same team
SELECT team_id, btrim(jersey_number) AS jn, COUNT(*) AS n
FROM public.team_players
WHERE is_active = true
  AND jersey_number IS NOT NULL
  AND btrim(jersey_number) <> ''
GROUP BY team_id, btrim(jersey_number)
HAVING COUNT(*) > 1;

-- 4) Games pointing at a tournament for a different team
SELECT g.id, g.team_id, g.tournament_id
FROM public.games g
WHERE g.tournament_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.tournaments tr
    WHERE tr.id = g.tournament_id AND tr.team_id = g.team_id
  );
