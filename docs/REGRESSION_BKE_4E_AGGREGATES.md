# Regression: BKE-4E Basketball Aggregates

Status: BKE-4E1 is implemented. No migration, React route, Supabase client, or release-stage change
is included. BKE-4E2 owns paginated source transport and migration 060; event-game creation remains
internal through BKE-4E.

## BKE-4E1 Automated Gate

Run the focused pure suite:

```powershell
pnpm exec vitest run src/lib/basketball/aggregateStats.test.ts src/lib/basketball/aggregateProjection.test.ts src/lib/basketball/aggregateComposition.test.ts src/lib/basketball/aggregateDestinations.test.ts src/lib/basketball/aggregatePlayerDestinations.test.ts
```

Then run the repository gates:

```powershell
pnpm test
pnpm build
pnpm lint
git diff --check
```

Coverage verifies:

- the exact unique 22-id `bk_*` catalog and seven aggregate categories remain separate from the
  live/legacy Basketball `SportConfig` actions;
- made-plus-miss attempts, combined field goals/rebounds, points, recorded-minute seconds, PPG,
  FG%, 2PT%, 3PT%, FT%, eFG%, true shooting, and AST/TO derive from raw counters;
- zero denominators remain unavailable and cross-game rates use summed numerators/denominators;
- completed canonical snapshots rebuild through the production Basketball event projector;
- inactive, abandoned, nonterminal, malformed, and wrong-recorder canonical sources stay out;
- opening starters, active bench players, late players, DNP players, and removed-only activity use
  the approved recorded-participation rules;
- only tracked participants aggregate, stable source ids are mandatory, and names/numbers never
  repair identity;
- official side totals retain team/unknown contributions plus projected disqualifications and
  player/staff ejections without summing visible rows;
- correction-resolved legacy base counters map one way and cannot fabricate starts,
  disqualifications, or ejections;
- canonical-only, legacy-only, mixed, team, personal-player, unresolved, malformed, and duplicate
  source fixtures retain independent quality, provenance, and metric availability;
- personal games enter Player/Career only, active roster rows can remain at zero appearances, and
  historical contributors remain present;
- cross-authority duplicate game ids throw a typed fail-closed error; and
- destination categories, unavailable-metric ranking suppression, default PTS/PPG/APP ordering,
  player selection, game history, and team/personal career segmentation remain deterministic.

## Manual Check

None for BKE-4E1. The slice exposes no runtime UI or network path. BKE-4E3 and BKE-4E4 own route
validation after BKE-4E2 supplies authenticated source pages. The combined live Supabase and
multi-device evidence remains a BKE-4E5 release gate before BKE-5 exposes event-game creation.
