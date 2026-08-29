# Regression: BKE-6C2 Boundary and Equal-Play Review

Status: Automated gates pass. Manual browser review remains owner smoke, not implied evidence.

Plan: [PLAN_BKE_6C_LIVE_LINEUPS_AND_CORRECTIONS.md](PLAN_BKE_6C_LIVE_LINEUPS_AND_CORRECTIONS.md)

## Scope

BKE-6C2 replaces the same-five shortcut with explicit boundary review for anchored Basketball
games. It adds changed-five confirmation, optional-opponent coordination, advisory equal-play
presentation, authorized enforced overrides, and stale-safe atomic command composition. It adds no
Supabase migration and does not change clockless, Legacy, or historical-game authority.

## Automated Evidence

| Gate | Result |
|---|---|
| `pnpm.cmd typecheck` | Pass |
| `pnpm.cmd test` | Pass: 175 files and 1,228 tests |
| `pnpm.cmd lint` | Pass: 0 errors; 6 existing Fast Refresh warnings, including 3 in an ignored worktree |
| `pnpm.cmd build` | Pass: production bundle and PWA service worker generated |
| GitHub CI | Pass |
| `git diff --check` | Pass |

Focused coverage includes:

- Start checks pending sides before invoking `startBasketballClock` and the explicit Review Lineup
  action remains visible while review is pending.
- Unchanged and changed boundary candidates are confirmed through checked commands; a changed five
  appends substitution before confirmation in one timestamp, elapsed value, and capture group.
- Enforced changed candidates append substitution, override, and confirmation atomically.
- Missing authority, blank/oversized override reasons, stale current-five evidence, duplicate or
  unavailable participants, and running/unsafe clock state fail without mutation.
- Advisory violations remain confirmable without override events; equal-play-off and opponent-only
  review do not invent tracked-policy decisions.
- A pre-Start substitution after confirmation returns projection to review-required.

## Manual Matrix

| Check | Status |
|---|---|
| Start on a configured boundary opens review with no Clock Start event | Covered by command/source contracts; browser smoke not run |
| Tracked and optional-opponent cards resolve independently | Covered automatically; browser smoke not run |
| Changed-five review reuses the C1 sheet and commits once | Not run |
| Four-to-five boundary recovery does not request or discard a reason | Covered automatically; browser smoke not run |
| Below-five boundary transition requires and stores its reason | Covered automatically; browser smoke not run |
| Advisory warning remains nonblocking and prescribes no five | Not run |
| Enforced warning requires an authorized bounded reason | Covered automatically; browser smoke not run |
| Disabled override control explains missing role authority | Covered by source contract; browser smoke not run |
| Cancel coordinator and nested editor without mutation | Not run |
| Narrow phone and desktop two-side coordinator layout | Not run |

## Authority Note

Anchored games remain local-only in BKE-6C2, so Personal ownership is the only production override
path and `canOverrideEqualPlay` is true there. Team owner/admin/scorer resolution is wired and tested
as a source contract but cannot receive live anchored traffic until BKE-6D. BKE-6D must revalidate
that role path when anchored cloud lifecycle is enabled rather than treating this slice as live-team
evidence.

## Exit

BKE-6C2 is complete. BKE-6C3 owns roles, captain history, replacement integration, and reasoned
current-lineup recovery. BKE-6C4 owns grouped Undo and Timeline correction.
