# Regression: BKE-4E3 Basketball Aggregate Destinations

Status: BKE-4E3 is implemented. Migration 060 is the prerequisite and adds the source RPCs; this
slice adds no migration and does not expose Basketball event-game creation.

## Automated Gate

Run the destination, transport, and pure aggregate suites:

```powershell
pnpm exec vitest run src/hooks/useBasketballAggregateDestination.test.ts src/lib/basketball/aggregateDestinationRoutes.test.ts src/lib/basketball/aggregateDestinations.test.ts src/lib/basketball/aggregateTransport.test.ts src/lib/basketball/aggregateStats.test.ts src/lib/basketball/aggregateProjection.test.ts src/lib/basketball/aggregateComposition.test.ts src/lib/soccer/aggregateDestinationRoutes.test.ts src/hooks/useSoccerAggregateDestination.test.ts
```

Then run the repository gates:

```powershell
pnpm test
pnpm build
pnpm lint
git diff --check
```

Coverage verifies:

- Basketball Leaderboard, Team Stats, and Tournament Stats branch before legacy aggregate RPCs;
- season leaderboards open on Scoring and expose every metric available across the selected scope;
- team and tournament destinations provide Overview, Players, and Games from one mixed-history
  model;
- active-roster loading is best effort and preserves historical contributors when it fails;
- official team totals remain projection-authoritative instead of summing visible player rows;
- provenance, partial quality, manager diagnostics, empty states, Refresh, and focus reload remain
  explicit; and
- game history identifies legacy/canonical authority, linking canonical rows to event Summary and
  legacy rows through Game Info's legacy loader.

## Manual Smoke Check

With migration 060 applied, use a readable Basketball season containing any combination of legacy
final games and canonical event publications:

1. Open Basketball Season Stats and confirm Scoring is first, active zero-appearance players remain
   listed, and changing categories or Rank by does not call a legacy stats reader.
2. Open Team Stats and compare Overview, Players, and Games against the same season history.
3. Open Tournament Stats and confirm only that tournament's games contribute while placement and
   external-link controls remain available.
4. Open a legacy and a canonical Games row. Canonical history must open event Summary directly;
   legacy history must open Game Info and then its hydrated legacy Summary.
5. Use Refresh, then refocus the tab. The last coherent result remains visible during refresh and a
   failed refresh is labeled instead of replacing totals.

BKE-4E4 owns Player Profile, Career, and permanent compatibility-reader boundaries. The combined
role, live Supabase, and multi-device matrix remains mandatory before Event access broadens beyond
the initial owner-only opt-in permitted by `PLAN_BKE_5D_RELEASE_AND_EXIT.md` section 2.
