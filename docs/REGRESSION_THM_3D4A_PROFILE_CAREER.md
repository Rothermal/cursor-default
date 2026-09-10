# THM-3D4a verification

## Scope

PlayerProfile and CareerStats hosts use semantic colors, including legacy
branches and loading/missing/error states. Imported aggregate renderers and
PlayerStatSummaryTables were converted in 3D3. No cloud, authority, calculation,
handoff or navigation changes. No migration. Production Dark remains gated.

## Evidence

- 203 test files / 1,560 tests pass, including 107 appearance surface tests.
  TypeScript and production build pass; lint has zero errors and three existing
  context Fast Refresh warnings.
- PR review added a unique loaded-header Career back-button guard requiring
  `w-8`, `h-8` and `shrink-0`. Full tests and targeted lint pass again; runtime
  source remains unchanged, so prior build/browser evidence still applies.
- Both pages are in the semantic color inventory. Profile's player-name wrapping
  is guarded after an unbroken synthetic name exposed header overflow.
- Actual page fixtures in Edge at 390px and 1280px in Light/Dark exercised loaded,
  missing-parameter and unavailable-player states for Basketball/Soccer and the
  Baseball legacy route. Long player/team names produced no document overflow
  after the Profile fix; no page errors. Light mobile Profile and Dark mobile
  Career screenshots inspected.
- Auth/GameContext, cloud helpers, Supabase and aggregate hooks used synthetic
  replacements. Aggregate bodies were empty, while legacy RPCs returned empty
  rows. This validates shells/empty legacy branches, not full data integration.
  Temporary fixtures/screenshots removed; no real game was opened or changed.

## Deployed follow-up

Check populated legacy totals/logs/segments, high-game actions, parking failures,
named seasons, Profile back/Career navigation, sport switching, loading/offline,
and installed-PWA/mobile keyboard behavior. Existing 3D3 evidence covers populated
aggregate children separately. Leaderboard/TeamStats/TournamentStats remain 3D4b;
THM-3 is not yet complete.
