# BKE-5C2 Basketball Rules Authority and Freeze Regression

Status: implementation complete. No Supabase migration is required. Basketball event creation
remains behind the internal gate; BKE-5C3, BKE-5C4, and BKE-5D remain before release.

## Scope

- segmented Legacy/Event authority choice with Legacy still the default
- exact personal authority for personal games and exact team authority for team games
- complete source-labeled rules review with match-only foul-limit override and reset
- authoritative settings payload/revision persisted through reload and Player Setup
- fresh personal/team revision check immediately before event-stream initialization
- stale revision block with explicit Refresh Defaults or Keep Reviewed Draft choices
- compatible match overrides reapplied during Refresh; incompatible refresh remains blocked
- explicit version-2 `rulesSnapshot` and complete `rulesSource` passed into the start command
- exact personal/team/match customization provenance; customized games display as Custom
- personal display default seeded into Legacy and Event per-game court orientation
- manual court flip preserves canonical shot locations and stays outside gameplay fingerprints
- old command callers and pre-C2 event setup retain their existing compatibility fallback

Team Event setup never reads personal rule defaults. Personal display orientation remains a
presentation input for both source types and never becomes team rules authority.

## Automated Evidence

Recorded 2026-08-24:

- focused setup/authority/commands/entry/parking/court suite: 6 files, 91 tests passed
- `pnpm test`: 163 files, 1,104 tests passed
- `pnpm build`: passed; existing Browserslist freshness and bundle-size warnings only
- `pnpm lint`: zero errors; six existing Fast Refresh warnings, including the separate worktree
- `git diff --check`: passed

Coverage proves strict authority loading, personal/team isolation, stale comparison, compatible
refresh, complete source provenance, exact reviewed start payload, immutable setup freeze, Legacy
and Event orientation handoff, local-only orientation correction, coordinate round trips, unchanged
parking transactions, and source ordering that checks freshness before start.

## Live Checks

1. Open a new Basketball setup and confirm Legacy is selected. Confirm the Initial court view label
   matches Settings -> Sports -> Basketball.
2. Select Event. For a personal game, confirm the rules source says Personal defaults; for an
   existing team, confirm it says Team defaults and shows the shared revision.
3. Change Match foul limit, reload setup, and confirm the Match override badge and value persist.
4. Continue to Player Setup. Confirm the same read-only rules review appears before the roster.
5. Change the source personal/team defaults in another tab or device, return, add a player, and
   Start. Confirm start blocks with Refresh Defaults and Keep Reviewed Draft.
6. Choose Refresh Defaults. Confirm the refreshed review appears and requires another Start tap.
7. Repeat the stale change and choose Keep Reviewed Draft. Confirm the game starts with the prior
   reviewed profile/revision and match rules.
8. Start one standard and one flipped game. Confirm the court opens in the reviewed orientation,
   the rotate button changes only that game, and a recorded location remains in the same canonical
   zone after repeated flips and reload.
9. Start a Legacy game and confirm aggregate tracking, team configuration, and cloud routing remain
   unchanged.
10. Repeat a Soccer setup/start to confirm its settings and kickoff paths are unchanged.

## Deferred

- capability recovery choices and durable Event local-only sync policy: BKE-5C3
- guarded Enable Cloud Sync and the combined BKE-5C exit audit: BKE-5C4
- production event-model opt-in and accepted live evidence: BKE-5D
