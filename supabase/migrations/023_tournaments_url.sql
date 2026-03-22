-- Optional external link for a tournament (bracket site, registration, etc.)

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS url text;

COMMENT ON COLUMN public.tournaments.url IS
  'Optional URL (e.g. bracket or registration page). Nullable.';
