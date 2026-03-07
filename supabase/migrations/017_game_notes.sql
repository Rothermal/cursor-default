-- Game-level notes field: free-text notes added during or after a game.
-- Displayed in Game Tracker (bottom text area) and Game Summary.

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.games.notes IS
  'Free-text notes entered by the scorer during or after the game.';
