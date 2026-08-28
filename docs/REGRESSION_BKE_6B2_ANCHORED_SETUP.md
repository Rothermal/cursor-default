# Regression: BKE-6B2 Anchored Setup

Status: Automated gates pass. Manual browser review remains owner smoke, not implied evidence.

Plan: [PLAN_BKE_6B_PRODUCTION_SETUP_AND_CLOCK.md](PLAN_BKE_6B_PRODUCTION_SETUP_AND_CLOCK.md)

## Delivered

- version-3 Event Setup review through the existing source-aware rules summary;
- an explicit Automatic Cloud versus Local only control for existing-team Event setup;
- pre-mutation rejection of anchored cloud targets and advisory/enforced equal-play rules;
- existing-team local-only roster loading through reviewed source identity without restoring a cloud binding;
- restart-safe tracked roster reconciliation with stable match participant ids;
- one focused Starter, Bench, and DNP opening-lineup step with a stable `n / 5` count;
- a required reason and final preview for one-through-four-player opening lineups;
- immutable setup version 2 initialization with exact opening authority;
- Period 1 initialization at elapsed zero with a paused clock and no implicit Clock Start; and
- unchanged Legacy, rules-v1/v2 Event, and version-3 clockless start behavior.

No Supabase migration, cloud clock transport, live clock controls, substitutions, role/captain
editing, equal-play override UI, or release-stage change is included.

## Automated Evidence

| Gate | Result |
|---|---|
| `pnpm.cmd typecheck` | Pass |
| `pnpm.cmd test` | Pass: 172 files and 1,197 tests |
| `pnpm.cmd lint` | Pass: 0 errors; 6 existing Fast Refresh warnings, including 3 in an ignored worktree |
| `pnpm.cmd build` | Pass: production bundle and PWA service worker generated |
| `git diff --check` | Pass |

Focused coverage includes:

- v3 review production, tri-state clockless/anchored admission, and local/cloud/equal-play policy;
- matching committed local-only team roster resolution without cloud game metadata;
- stable participant ids across roster reordering;
- Starter, Bench, DNP, five-player, over-five, and reasoned short-handed decisions;
- strict draft parsing and reload-safe review progress;
- exact setup-v2 participant/opening-lineup authority;
- Period 1 paused initialization with only `basketball.period_started` at elapsed zero;
- version-3 clockless initialization with null elapsed and no lineup projection; and
- original-state return when version-3 setup authority is missing or invalid.

## Manual Matrix

| Check | Status |
|---|---|
| Personal anchored setup with five tracked starters | Not run |
| Existing-team anchored setup switched to Local only | Not run |
| Automatic Cloud anchored preflight before active-game replacement | Not run |
| Equal-play advisory/enforced preflight before active-game replacement | Not run |
| One-through-four short-handed reason and final review | Not run |
| Starter/Bench/DNP keyboard and touch operation | Not run |
| Reload on roster, opening-lineup, and review steps | Not run |
| Narrow phone layout with long names and numbers | Not run |
| Legacy, rules-v2 Event, and v3 clockless setup parity | Covered automatically; browser smoke not run |

## Exit

BKE-6B2 is complete. A supported explicit local-only anchored game can now freeze setup version 2,
start Period 1 paused with exact tracked opening authority, and enter the existing tracker. BKE-6B3
owns the sticky clock strip, canonical capture-time resolver, Start/Pause/Stoppage/Set Clock,
display ticking, expiration, same-five boundary confirmation, and reload recovery.
