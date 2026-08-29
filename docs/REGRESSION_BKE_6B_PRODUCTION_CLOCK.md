# Regression: BKE-6B Production Clock Exit

Status: Automated implementation evidence is complete. Browser/PWA owner smoke remains explicitly
not run and does not block the current owner-only, default-off workflow.

Plan: [PLAN_BKE_6B_PRODUCTION_SETUP_AND_CLOCK.md](PLAN_BKE_6B_PRODUCTION_SETUP_AND_CLOCK.md)

## Delivered

- one `GameContext.prepareActiveGameMutation` confirmation for active-game park, setup replacement,
  new-game, resume, and cloud-open commits;
- `Pause and continue` for a running anchored Basketball clock, using one checked Pause before any
  manifest or active-game storage mutation;
- fail-closed storage methods when a caller omits preparation while the anchored clock is running;
- Cancel leaves game state, event history, active local id, and parking manifest unchanged;
- End Period appends the canonical Pause and Period End in one candidate rebuild and capture group;
- the next period starts paused at elapsed zero, with Clock Start remaining explicit;
- Suspend and Abandon are disabled and command-rejected while the anchored clock is running; and
- unchanged route/tab/setup-draft navigation, browser reload anchor recovery, and parked-only import.

No Supabase migration, anchored cloud lifecycle, live substitutions, changed-five boundary review,
equal-play override workflow, Timeline clock correction, or lineup correction is included.

## Automated Evidence

| Gate | Result |
|---|---|
| `pnpm.cmd typecheck` | Pass |
| `pnpm.cmd test` | Pass: 172 files, 1,208 tests |
| `pnpm.cmd lint` | Pass: 0 errors, 6 existing Fast Refresh warnings |
| `pnpm.cmd build` | Pass |
| `git diff --check` | Pass |

Focused coverage includes:

- checked workflow Pause at an injected canonical timestamp;
- policy classification for mutation-free versus park/replacement actions;
- Pause plus Period End ordering, shared capture id, and one atomic projection rebuild;
- next-period paused-zero initialization and explicit Start authority;
- running-clock terminal rejection and disabled terminal buttons;
- centralized caller coverage across setup, sport/team entry, summaries, cloud game review, player
  history, local resume, and explicit parking; and
- compatibility source contracts for the release/capability guards that precede replacement.

## Manual Matrix

| Check | Status |
|---|---|
| Running Park: Cancel and Pause/continue | Not run |
| Running New Game, setup replacement, local resume, and cloud open | Not run |
| Paused park/reload/resume and running reload recovery | Not run |
| End Period while running, next period paused at zero, explicit Start | Not run |
| Expiration before End Period and background/reload recovery | Not run |
| Set Clock forward/backward and unsafe-time recovery | Not run |
| Clockless Event, Legacy Basketball, Soccer, and mixed parked games | Covered automatically; browser smoke not run |
| Phone/tablet/desktop and narrow-height landscape | Not run |
| Keyboard, screen-reader announcements, reduced motion, sound/vibration preferences | Not run |
| Local-only capability failure before replacement | Covered automatically; browser smoke not run |

## Exit

BKE-6B is complete. A supported local anchored Basketball game can be configured, started, timed,
captured, adjusted, expired, parked or replaced without silently leaving a running authority, and
advanced through period boundaries. BKE-6C owns live substitutions, lineup changes, equal-play
review, and lineup correction. The feature remains owner-only/default-off and anchored cloud
lifecycle remains unavailable.
