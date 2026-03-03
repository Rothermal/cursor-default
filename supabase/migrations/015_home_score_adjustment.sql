-- Manual home team score: additive adjustment on top of computed score from player stats.
-- Displayed home score = computed_from_stats + home_score_adjustment (default 0).

alter table public.games
  add column if not exists home_score_adjustment int not null default 0;

comment on column public.games.home_score_adjustment is
  'Additive adjustment to the home team score (computed from player stats). Displayed home score = computed + this value.';
