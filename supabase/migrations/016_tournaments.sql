-- Tournaments as a first-class entity scoped to a team.
-- Games can optionally reference a tournament via tournament_id.
-- The existing tournament_name text column is preserved for backward compatibility
-- and as a denormalized display value; new games set both columns.

CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, name)
);

CREATE INDEX idx_tournaments_team ON public.tournaments(team_id);

ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

-- Team members can read their team's tournaments
CREATE POLICY "tournaments_read" ON public.tournaments
  FOR SELECT USING (
    team_id IN (
      SELECT team_id FROM public.team_members WHERE user_id = (SELECT auth.uid())
    )
  );

-- Any team member can create tournaments for their team
CREATE POLICY "tournaments_insert" ON public.tournaments
  FOR INSERT WITH CHECK (
    team_id IN (
      SELECT team_id FROM public.team_members WHERE user_id = (SELECT auth.uid())
    )
  );

-- Only owners/admins can rename tournaments
CREATE POLICY "tournaments_update" ON public.tournaments
  FOR UPDATE USING (
    team_id IN (
      SELECT team_id FROM public.team_members
      WHERE user_id = (SELECT auth.uid()) AND role IN ('owner', 'admin')
    )
  );

-- Only owners/admins can delete tournaments
CREATE POLICY "tournaments_delete" ON public.tournaments
  FOR DELETE USING (
    team_id IN (
      SELECT team_id FROM public.team_members
      WHERE user_id = (SELECT auth.uid()) AND role IN ('owner', 'admin')
    )
  );

-- Add tournament_id to games (nullable FK; SET NULL on tournament delete)
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS tournament_id uuid REFERENCES public.tournaments(id) ON DELETE SET NULL;

CREATE INDEX idx_games_tournament ON public.games(tournament_id);

COMMENT ON TABLE public.tournaments IS
  'Tournaments scoped to a team. Games reference tournaments via tournament_id.';

COMMENT ON COLUMN public.games.tournament_id IS
  'FK to tournaments. NULL means no structured tournament; fall back to tournament_name for display.';
