-- HKY-5A: stage the canonical-publication sport constraint that admits Hockey.

-- Keep the validated Soccer/Basketball constraint active while this replacement commits without
-- a table scan. Migration 073 validates and swaps the constraints after this transaction
-- releases its exclusive lock (the 054/055 pattern).
alter table public.game_event_canonical_publications
  add constraint game_event_canonical_publications_sport_id_hockey_check
  check (sport_id in ('soccer', 'basketball', 'hockey'))
  not valid;

comment on constraint game_event_canonical_publications_sport_id_hockey_check
  on public.game_event_canonical_publications is
  'Staged event-platform publication sport allow-list. Migration 073 validates it before removing the older Soccer/Basketball check.';
