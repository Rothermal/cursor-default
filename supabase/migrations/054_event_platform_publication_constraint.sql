-- BKE-4A4: stage the event-platform canonical-publication sport constraint.

-- Keep the validated Soccer-only constraint active while this replacement commits without a
-- table scan. Migration 055 validates and swaps the constraints after this transaction releases
-- its exclusive lock.
alter table public.game_event_canonical_publications
  add constraint game_event_canonical_publications_sport_id_event_platform_check
  check (sport_id in ('soccer', 'basketball'))
  not valid;
