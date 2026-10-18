-- BSB-6A: stage the canonical-publication sport constraint that admits Baseball.

-- Keep the validated Soccer/Basketball/Hockey constraint active while this replacement commits
-- without a table scan. Migration 077 validates and swaps the constraints after this transaction
-- releases its exclusive lock (the 072/073 pattern).
alter table public.game_event_canonical_publications
  add constraint game_event_canonical_publications_sport_id_baseball_check
  check (sport_id in ('soccer', 'basketball', 'hockey', 'baseball'))
  not valid;

comment on constraint game_event_canonical_publications_sport_id_baseball_check
  on public.game_event_canonical_publications is
  'Staged event-platform publication sport allow-list. Migration 077 validates it before removing the older Soccer/Basketball/Hockey check.';
