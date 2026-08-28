# Regression: BKE-6B1 Clock and Setup Contracts

Status: Automated gates pass. Manual browser review remains owner smoke, not implied evidence.

Plan: [PLAN_BKE_6B_PRODUCTION_SETUP_AND_CLOCK.md](PLAN_BKE_6B_PRODUCTION_SETUP_AND_CLOCK.md)

## Delivered

- exact device-local `AppSettings.basketball` preferences for clock tenths, expiration sound, and
  expiration vibration;
- no clock preference fields in `AppSettings.courtCapture`, `BasketballPersonalSettingsV1`, or
  `BasketballTeamSettingsV1`;
- personal and team version-3 clock controls with a complete five-field upgrade review;
- an explicit older-client warning before normal saves and personal conflict `Keep This Device`;
- strict setup-draft version 2 participant/status/opening-lineup progress while preserving exact
  version-1 draft reads;
- a fail-closed version-3 setup producer that rejects before local game commit until BKE-6B2;
- pure local/cloud/equal-play setup policy, running-clock detection, and mutation classification; and
- no migration, cloud transport, anchored-game initialization, live clock, or parking interception.

## Automated Evidence

| Gate | Result |
|---|---|
| `pnpm.cmd typecheck` | Pass |
| `pnpm.cmd test` | Pass: 172 files and 1,191 tests |
| `pnpm.cmd lint` | Pass: 0 errors; 6 existing Fast Refresh warnings, including 3 in an ignored worktree |
| `pnpm.cmd build` | Pass: production bundle and PWA service worker generated |
| `git diff --check` | Pass |

Focused coverage includes:

- old/missing/malformed device preference values and exact namespace isolation;
- atomic addition/removal of all five version-3 clock fields;
- strict version-1 draft preservation and deliberate version-2 upgrade;
- restart-safe participant statuses, stable ids, opening lineups, and short-handed review guards;
- version-3 reviewed setup persistence without start authority;
- local-only equal-play-off setup admission and cloud/equal-play deferral; and
- mutation-free versus park/replacement action classification.

## Manual Matrix

| Check | Status |
|---|---|
| Personal anchored upgrade review and save warning | Not run |
| Team owner/admin upgrade and warning | Not run |
| Scorer/viewer read-only team review | Not run |
| Display preferences on sound/vibration-capable phone | Not run |
| Display preferences on unsupported desktop browser | Not run |
| Narrow phone layout and keyboard/focus order | Not run |
| Existing version-1 setup draft restore | Covered automatically; browser smoke not run |

## Exit

BKE-6B1 is complete. The app can save deliberate version-3 defaults and persist strict future
opening-lineup progress. Production version-3 setup is rejected before local game commit, with the
existing `PlayerSetup` refusal retained as defense in depth. BKE-6B2 owns the setup review,
opening-lineup screen, local-only preflight, and atomic setup-v2 start.
