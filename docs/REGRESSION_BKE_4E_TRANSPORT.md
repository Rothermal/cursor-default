# Regression: BKE-4E2 Basketball Aggregate Transport

Status: BKE-4E2 is implemented. Migration 060 must be applied before any BKE-4E3 destination calls
the new RPCs. This slice does not add routes or expose Basketball event-game creation.

## Automated Gate

Run the focused transport, pure-engine, cloud-sync, and Soccer parity suites:

```powershell
pnpm exec vitest run src/lib/basketball/migration060.test.ts src/lib/basketball/aggregateTransport.test.ts src/lib/basketball/aggregateStats.test.ts src/lib/basketball/aggregateProjection.test.ts src/lib/basketball/aggregateComposition.test.ts src/lib/basketball/aggregateDestinations.test.ts src/lib/basketball/aggregatePlayerDestinations.test.ts src/lib/cloudSyncHardening.test.ts src/lib/soccer/migration047.test.ts src/lib/soccer/aggregateTransport.test.ts
```

Then run the repository gates:

```powershell
pnpm test
pnpm build
pnpm lint
git diff --check
```

Coverage verifies:

- migration 060 exposes only four fixed authenticated Basketball aggregate wrappers;
- private shared canonical helpers retain the existing fixed Soccer signatures and payload keys;
- active app access, readable final games, immutable event setup, completed active publications,
  and exact Basketball authority are required;
- canonical `(finalized_at, publication_id)` and legacy `(game_date, game_id)` cursors are paired,
  descending, bounded to 1-50, and safe across equal primary cursor values;
- legacy pages use `get_game_stats_resolved`, preserve player checkout participation evidence,
  include placeholder-backed team contributions, and exclude every event-setup game;
- only UUID-shaped, audited, non-cyclic participant merge lineage is repaired;
- provable team-owned Basketball rows created before `games.sport_id` are backfilled while
  ambiguous rows remain untouched, and new aggregate syncs persist the sport id;
- canonical and legacy pages drain independently, deduplicate source ids, and compose only after
  both families complete;
- malformed page envelopes, access failures, and missing contracts reject the load;
- malformed individual items become explicit partial exclusions;
- one game returned by both authority families fails closed;
- identical in-flight work is shared while consumer cancellation remains independent; and
- projection yields between bounded batches and returns structured source/network/projection
  metrics without persisting completed results.

## Migration Smoke Check

After applying migration 060, confirm the four `get_basketball_*_aggregate_*` functions exist and
are executable by `authenticated`, while `_event_aggregate_*` and `_basketball_legacy_*` remain
private. Existing Soccer aggregate pages should still load unchanged.

There is no user-facing Basketball aggregate route in this slice. BKE-4E3 provides the first route
consumer and its authorized owner/admin/scorer/viewer matrix. The complete live Supabase and
multi-device matrix remains BKE-4E5 release evidence before BKE-5 exposes event-game creation.
