# Regression: BKE-6B3 Live Clock

Status: Automated gates pass. Manual browser review remains owner smoke, not implied evidence.

Plan: [PLAN_BKE_6B_PRODUCTION_SETUP_AND_CLOCK.md](PLAN_BKE_6B_PRODUCTION_SETUP_AND_CLOCK.md)

## Delivered

- one shared command-time resolver for anchored live capture and lifecycle commands;
- identical canonical `occurredAt` and `elapsedMs` for atomic shots, assists, rebounds, foul trips,
  and Steal plus Turnover groups;
- a sticky clock strip above the Track and Timeline workspace with period, current five, Start/Pause,
  Set Clock, optional stoppage context, and same-five confirmation;
- display-only count-up/countdown ticking with optional tenths below one minute;
- one projection-guarded expiration Pause after foreground, focus, visibility, or online recovery;
- best-effort visual, sound, and vibration expiration presentation;
- unsafe backward or over-24-hour wall-time blocking with reasoned Set Clock recovery at the exact
  last-known-good elapsed/instant pair; and
- hidden and command-rejected manual-minute capture for anchored games.

No Supabase migration, cloud anchored transport, live substitution, changed-five boundary review,
equal-play override, running-clock parking interception, or complete period-flow audit is included.

## Automated Evidence

| Gate | Result |
|---|---|
| `pnpm.cmd typecheck` | Pass |
| `pnpm.cmd test` | Pass: 172 files and 1,205 tests |
| `pnpm.cmd lint` | Pass: 0 errors; 6 existing Fast Refresh warnings, including 3 in an ignored worktree |
| `pnpm.cmd build` | Pass: production bundle and PWA service worker generated |
| `git diff --check` | Pass |

Focused coverage includes:

- anchored Start/Pause/Set Clock, atomic stoppage, expiration, and display direction;
- canonical running elapsed across court-linked, direct-stat, foul, timeout, and ejection families;
- exact last-known watermark recovery after an intervening running event;
- durable recorded-later payload markers, strict live-time matching, and isolation of historical or
  non-active-period events from the running watermark;
- backward, accepted 24-hour boundary, and excessive wall-time classification;
- one strip mounted above both workspaces with a presentation-only interval;
- same-five control and disabled BKE-6C Bench affordance; and
- anchored manual-minute UI exclusion plus existing projection-level inertness.

## Manual Matrix

| Check | Status |
|---|---|
| Start, Pause, Set Clock, and reason validation on a phone viewport | Not run |
| Count-up/countdown display and optional tenths below one minute | Not run |
| Stoppage category plus optional note | Not run |
| Expiration visual/sound/vibration behavior | Not run |
| Reload/focus/visibility/online return while running | Not run |
| Backward or excessive device-time recovery | Not run |
| Track/Timeline switching with stable clock controls | Covered by source contract; browser smoke not run |
| Same-five confirmation at a configured boundary | Not run |
| Clockless Event, Legacy Basketball, and Soccer parity | Covered automatically; browser smoke not run |

## Exit

BKE-6B3 is complete. A supported local anchored game now has one canonical live time authority and
stable clock controls without per-second game-state writes. BKE-6B4 owns running-clock parking and
replacement interception, period-flow integration, responsive/accessibility polish, and the final
BKE-6B regression audit.
