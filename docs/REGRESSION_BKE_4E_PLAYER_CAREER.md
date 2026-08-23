# Regression: BKE-4E4 Basketball Player and Career Destinations

Status: BKE-4E4 is implemented. Migration 060 remains the aggregate-source prerequisite. This
slice adds no migration and does not expose Basketball event-game creation.

## Permanent Reader Boundary

Legacy Basketball games remain supported indefinitely through correction-resolved compatibility
sources and the existing Game Info hydration path. Event-authority Basketball never writes or
reads compatibility aggregate rows. Leaderboard, Team Stats, Tournament Stats, Player Profile,
and Career Stats branch to Basketball aggregate transport before legacy `game_stats`,
`shot_chart`, `stat_corrections`, resolved-stat, or high-game readers.

Canonical history links directly to event Basketball Summary. Legacy history opens Game Info so
the legacy loader can hydrate its Summary without pretending the game has event authority.

## Automated Gate

Run the focused player, destination, transport, and authority suites:

```powershell
pnpm exec vitest run src/lib/basketball/aggregatePlayerDestinations.test.ts src/lib/basketball/aggregateDestinationRoutes.test.ts src/lib/basketball/aggregateDestinations.test.ts src/lib/basketball/aggregateComposition.test.ts src/lib/basketball/aggregateTransport.test.ts src/hooks/useBasketballAggregateDestination.test.ts src/lib/soccer/aggregateDestinationRoutes.test.ts
```

Then run the repository gates:

```powershell
pnpm test
pnpm build
pnpm lint
git diff --check
```

Coverage verifies:

- Player Profile and Career exit before every legacy aggregate/high-game reader;
- stable player ids are the only cross-game identity key;
- Profile team/season totals use a scoped source page while authorized Personal history loads
  separately and never changes those totals;
- Career combines readable team stints and eligible Personal games without fabricating a team;
- Participation remains visible at zero and unavailable/all-zero non-participation metrics hide;
- availability is evaluated within each displayed team or Personal history segment;
- canonical and legacy game history retains source provenance and authority-correct review paths;
- team-owned aggregate tables link to Basketball Player Profile and Career; and
- Basketball event destination code contains no compatibility storage reads.

## Manual Smoke Check

With migration 060 applied, use a stable Basketball player with any available combination of
legacy, canonical, team-owned, and Personal final games:

1. Open the player from Basketball Season Stats, Team Stats, or Tournament Stats. Confirm the
   selected team/season totals and Participation appear even when the player has no games.
2. If Personal history exists, confirm it appears in a separate section and does not change the
   team/season totals.
3. Open Career and confirm team/season stints and Personal history remain separate while Career
   totals combine all authorized contributions.
4. Confirm unavailable mixed-history metrics are suppressed only in the affected scope/segment.
5. Open one canonical and one legacy history row. Canonical must enter event Summary directly;
   legacy must enter Game Info and then its hydrated legacy Summary.
6. Switch the Career sport selector to Soccer and a legacy aggregate sport and confirm their
   existing destination behavior remains unchanged.

BKE-4E5 owns migration 061, the capability handshake, and the consolidated release exit audit.
Production user opt-in remains closed until BKE-5.
