# BKE-5A Basketball Profiles Regression

Status: Automated implementation evidence complete. No migration or live Supabase signoff is
required for BKE-5A; event-game creation remains behind the internal gate.

## Scope

- Seven immutable source-linked Basketball tracking profiles: NFHS, NCAA Men's, NCAA Women's, NBA,
  FIBA, Youth Standard, and Youth Equal-Play.
- Strict `BasketballMatchRulesV2` validation and clone-safe profile lookup, sparse layer resolution,
  field-source metadata, and upgrade-diff preparation.
- Version-aware rules normalization that preserves untagged version-1 snapshots without enrichment
  or rewrite.
- Projection, capture, Timeline correction, cloud hydration, and Summary compatibility for foul
  windows and charged-timeout pools.
- Total/full/30-second inventory, overtime continuation/reset/additions, and forward unused-pool
  carryover. Neutral media/official timeouts remain outside charged pools.
- Eight distinct Youth Equal-Play periods, halftime foul/timeout windows after Period 4, and eight
  reserved lineup-change boundaries. Lineup enforcement and clocks remain BKE-6.

## Source Fixtures

Each catalog record stores its exact source URLs, effective rules label, review date, enforced
coverage, deferred coverage, and immutable profile version. `profiles.test.ts` verifies catalog
uniqueness, populated provenance fields, structural values, current NFHS no-one-and-one behavior,
separate NCAA Men's/Women's rules, NBA overtime bonus, and the Youth Equal-Play model.

The profiles are tracking presets, not complete officiating rulebooks. Clock-dependent exceptions,
shot clocks, substitutions, playing-time enforcement, equipment, and defensive restrictions are
explicitly deferred.

## Automated Evidence

- `pnpm exec vitest run src/lib/basketball/profiles.test.ts`
  - catalog and source fixtures;
  - clone isolation;
  - sparse layer validation/source metadata;
  - upgrade differences;
  - invalid references, thresholds, assignments, and carryover;
  - exact version-1 normalization;
  - every profile starts through the production projector;
  - cross-period equal-play bonus projection;
  - shared-half timeout exhaustion.
- Focused projection/capture/correction suites cover administrative projection, timeout commands,
  historical administration edits, foul/free-throw commands, and Timeline correction invariants.
- Full `pnpm test`, `pnpm lint`, and `pnpm build` are required before the PR is opened. Existing
  Fast Refresh warnings in context providers are non-blocking and unrelated to BKE-5A.

## Compatibility Assertions

- Event envelope/schema and Basketball sport-state versions remain 1.
- A rules snapshot is projection authority; catalog lookup is not required to open an existing game.
- Version-1 cloud/local/canonical snapshots normalize and reproject without receiving a version tag.
- Version-1 timeout and overtime-foul behavior remains unchanged.
- Version-2 cloud shells leave the legacy top-level team-stats configuration empty instead of
  flattening shared foul windows or timeout pools into misleading period-scoped fields.
- Pre-BKE-5 `rulesSource` values are treated as placeholders and display as Legacy configuration.
- Aggregate Basketball stays on its existing reducer/snapshot path.
- No SQL migration, capability change, settings persistence, or production creation toggle ships in
  this slice. Those remain BKE-5B through BKE-5D.
