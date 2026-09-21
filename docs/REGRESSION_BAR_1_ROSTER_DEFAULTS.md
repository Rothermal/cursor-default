# BAR-1 Roster Defaults Verification

Status: local implementation verification passed; production migration and owner checks pending.

## Automated and local checks

- Full Vitest suite: 218 files / 1,846 tests passed. Typecheck and production build
  passed; lint has no errors and the three existing context Fast Refresh warnings.
- PR review follow-up: 228 focused tests and typecheck passed after migration naming,
  invalid v2 position rejection coverage, and the unavailable-starter save hint.
  The full-suite count above is the pre-review baseline, not a rerun claim.

- Position/default tests cover standard/custom/unassigned values, length bounds,
  exact UUID defaults, duplicates, schema versions, cache compatibility, snapshot
  isolation, repeated reconciliation and legacy draft parsing.
- Clockless event command coverage verifies positions reach the immutable setup.
- Migration contract tests inspect access checks, CAS delegation, active team roster
  validation, duplicate/limit rejection and old-client downgrade protection. These
  are source-level tests, not proof of execution or RLS behavior in PostgreSQL.
- Position control browser checks: Edge, 390px and 1280px, Light and Dark; standard
  selection, multiword custom input, Unassigned reset and horizontal overflow passed.
  This isolated control test does not replace authenticated Team Manage verification.

## Owner verification

1. Apply `supabase/migrations/070_basketball_roster_defaults.sql` in the
   Supabase SQL editor. No separate backfill or production data cleanup is needed.
   Highest required sequential migration for BAR-1 is `070`.
2. As a team owner/admin, open Basketball Team Manage. Add/edit a roster player's
   position, including a multiword custom position. Save and reload. Set up to five
   default starters under shared defaults and save separately; unchecked players are
   Bench. Save a rules change and verify those starter choices remain.
3. Open two browser tabs on the same defaults. Save in one, then attempt to save the
   stale second tab. Expect the existing conflict/reload flow, not an overwrite.
   A scorer/viewer must not get writable controls or permission to call the save RPC.
4. Start a new team Event game. Verify positions and starter choices, change one
   position and one starter, navigate back/reload, and confirm those choices survive.
   Start with the normal opening-lineup/short-handed confirmation. Team defaults
   must remain unchanged. Also check a clockless Event game preserves positions.
5. Change team defaults and reopen an older started/parked game. Its positions and
   lineup must stay unchanged. Test a local-only new roster: Bench/Unassigned until
   explicitly edited. A player shared with another team must retain that team's own
   independent defaults.
6. Remove a default starter from the active team roster. Team settings must expose
   the unavailable starter for explicit cleanup; a fresh setup must call for review,
   not invent a replacement. Retry a default save with stale/deleted/foreign-team
   IDs and expect rejection. Unavailable starters also block rules-only saves because
   rules and defaults share one atomic payload; explicitly uncheck them first.
   Refresh all active clients before editing new defaults.

The application was not connected to a live Supabase test account for these checks.
