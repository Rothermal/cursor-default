-- BKE-4A1: stage the shared event-side widening without scanning game_events
-- while this migration holds the ADD CONSTRAINT lock.

alter table public.game_events
  add constraint game_events_team_side_event_platform_check
  check (team_side in ('tracked', 'opponent', 'neutral')) not valid;

comment on constraint game_events_team_side_event_platform_check
  on public.game_events is
  'Staged event-platform side allow-list. Migration 051 validates it before removing the older tracked/opponent-only check.';
