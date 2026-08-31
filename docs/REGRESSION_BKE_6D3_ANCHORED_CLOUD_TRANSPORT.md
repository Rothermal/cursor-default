# Regression: BKE-6D3 Anchored Cloud Transport

Status: Automated checks pass. Live Supabase and browser smoke are not run in this implementation
environment.

## Scope

- exact setup-v2/rules-v3 anchored classification without changing clockless routes;
- fresh app access, team role, Basketball release capability, and clock/lineup capability checks;
- automatic Personal/team creation and confirmation-driven later cloud enablement;
- existing v4 one-recorder bind, pull/merge, upload, conflict, and exact-checkpoint transport;
- strict recorder ownership, duplicate-binding, stale-account, and malformed-stream guards;
- immutable source-team equal-play authority with owner/admin/scorer allow and viewer/removed deny;
- running clock, Set Clock, and recorded-later lineup replay through the shared projector; and
- unchanged Legacy Basketball, clockless Event Basketball, Soccer, and aggregate routing.

## Automated Evidence

| Gate | Result |
|---|---|
| Focused BKE-6D3 authorization, transport, enablement, policy, capability, and source-guard tests | Pass: 6 files / 65 tests |
| `pnpm typecheck` | Pass |
| Basketball test directory | Pass: 61 files / 488 tests |
| Full Vitest suite | Pass: 177 files / 1,268 tests |
| `pnpm build` | Pass; 12-entry PWA precache is about 2.1 MiB |
| `pnpm lint` | Pass: 0 errors / 6 existing Fast Refresh warnings |
| `git diff --check` | Pass |

Focused coverage proves that an exact anchored recorder can sync while running, that clockless event
games never call the clock capability, and that stale team roles fail before bind, pull, or upload.
Cloud adoption rebuilds an adjusted clock plus recorded-later lineup history without inventing a
second clock watermark; the marked lineup time sits after the pre-adjustment pause and before the
adjusted value so the fixture requires the explicit `clock_adjusted` branch. Independent anchored
recorders begin paused at elapsed zero. Later Enable Cloud installs automatic policy only after
successful transport/checkpoint and leaves the caller's local state unchanged on failure.

Anchored equal-play controls resolve authority from immutable `setup.sourceTeamId`, including
local-only team-sourced games with no cloud binding. The role matrix permits owner, admin, and
scorer while denying a resolved viewer or missing/removed membership. An explicitly local-only game
may continue while that role lookup is loading or unavailable, avoiding an offline live-play
deadlock; cloud-bound games fail closed, and every later cloud mutation freshly rechecks the source
team role. Cloud-bound live recording deliberately requires online role resolution; recorders who
need offline live capture must select the local-only path before play. The role hook reloads when
either the source team or signed-in account changes.

Source guards enforce both setup preflights before active-game replacement, tournament writes, or
commit. Capability caches are account-isolated and cleared on account change/sign-out; in-flight
setup and queue operations also reject a changed account before cloud mutation or persisted success.

## Manual Matrix

| Scenario | Status |
|---|---|
| Create an automatic Personal anchored game, run the clock, sync, park, and resume | Not run |
| Create an automatic existing-team anchored game as owner/admin/scorer | Not run |
| Confirm viewer and removed-member denial after a membership refresh | Not run |
| Enable Cloud from a local-only anchored game and confirm checkpoint-first activation | Not run |
| Open the same recorder on a second device and verify strict adoption/live clock review | Not run |
| Exercise offline queue replay, conflict recovery, duplicate binding, and account switch | Not run |
| Confirm Legacy, clockless Event, and Soccer sync remain unchanged | Not run |

## Compatibility

- No Supabase migration, event-row contract, RPC signature, or grant change is added.
- Anchored transport reuses `bind_basketball_event_game_v4` and the shared row/checkpoint engine.
- Cloud capability checks are mutation guards, not a second persisted authority.
- Structurally valid incomplete lineup history may upload for recovery; malformed, mixed-recorder,
  unknown-family, and non-projectable streams remain dirty and fail closed.
- The event tracker remains device opt-in/default-off and owner-only release policy is unchanged.

## Exit

BKE-6D3 is implementation-complete. BKE-6D4 subsequently completed trusted anchored readiness, finalization,
mode-aware Correct records/Resume game reopen, recorder-owner handoff, and explicit republication.
The live Supabase matrix remains required before broader access.
