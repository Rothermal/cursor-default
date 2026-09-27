# HKY-1 Hockey Foundation Verification

Status: local implementation verification passed. No migration and no production
behavior change, so there is no owner deployment step.

## Automated and local checks

- Full Vitest suite: 235 files / 2,037 tests passed. `pnpm typecheck` and
  `pnpm build` passed. `pnpm lint` has 0 errors and the three existing context Fast
  Refresh warnings.
- `src/lib/hockey/hockey.test.ts` and `setup.test.ts` (HKY-1A/1B) cover rules,
  profiles, settings resolution, positions, lineup defaults, setup validation and the
  attacking-direction helper.
- `src/lib/hockey/live.test.ts` (HKY-1C) covers:
  - stream initialization, idempotency, and rejection of a changed setup or counter stats;
  - the full setup normalizer at initialization, so malformed labels or rules are rejected
    and every accepted setup survives hydration (PR #433 review);
  - the atomic opening lineup plus period 1 start;
  - clock start, pause and set, including expiration, backward time and stale elapsed values;
  - early period end needing a reason on an anchored clock;
  - youth regulation with no overtime, one NHL overtime on a tie, and repeating playoff overtime;
  - clockless null elapsed on every event, clock commands rejected, and periods ending at any time;
  - both initial directions across regulation and overtime under both ends policies;
  - the rink flip staying out of the projection, events and fingerprints;
  - suspend, abandon and reopen, and the active-game guard pausing a running clock.
- `src/lib/hockey/sportIsolation.test.ts` covers:
  - a legacy Hockey stat-grid game staying on the aggregate route, unchanged by reload;
  - event Hockey reaching no cloud route, even with corrupt sport state;
  - the strict normalizer;
  - reload and park/resume for both clock models;
  - export/import alongside legacy Basketball and Hockey games.
- `src/lib/hockey/previewGate.test.ts` checks that the preview is development-only and
  that its consumers are audited.
- Browser smoke, dev server at 390px width:
  - `/#/setup?sport=hockey&events=1` started a game;
  - the clock ran and survived a reload;
  - an early period end asked for a reason;
  - the event list showed the paused clock and the period end at the same time.

## Owner verification

None required for HKY-1. The preview is only reachable in development builds. In
production, a Hockey event game can only arrive through a local import, and it opens a
"not available in this build" notice instead of the legacy grid.
