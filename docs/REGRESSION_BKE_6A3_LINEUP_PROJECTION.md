# Regression: BKE-6A3 Lineup Projection

Status: Implemented and automated. The no-UI BKE-6A foundation is complete; BKE-6B is next.

## Delivered

- Registered strict `lineup_confirmed`, `substitution`, `role_changed`, and
  `equal_play_override` event contracts without changing Basketball event or stream versions.
- Added tracked lineup authority for every anchored setup-v2 game and optional independent opponent
  authority when setup supplies an opponent opening lineup. Existing setup-v1 and clockless
  projections omit lineup state to preserve their shape and fingerprints.
- Derived setup-order current lineups, role/captain history, period-local on-court intervals, global
  running-clock intervals, exact millisecond/second participation, period credit, and completeness.
- Backward Set Clock corrections clip effective running, on-court, and participation intervals to
  the replacement elapsed value before future play accrues, preventing overlap and preserving exact
  participant attribution when the lineup changes at the reset point.
- Added paused-only checked commands for balanced, entry-only, exit-only, boundary, and current-lineup
  recovery substitutions, role changes, and boundary confirmation. One through four participants
  require a reason; zero, more than five, duplicate, stale, unavailable, and wrong-side inputs fail.
- Blocked Clock Start for unresolved boundary confirmation, invalid short-handed state, and an
  on-court ejected or disqualified participant. Replacement remains explicit and a pre-start lineup
  change requires confirmation again.
- Made anchored manual-minute events valid but inert. Clockless games retain the existing manual
  minute projection path.
- Added tracked-regulation equal-play review for minimum periods, maximum consecutive periods, and
  maximum period imbalance. Advisory mode records warnings; enforced mode requires a reasoned exact
  override immediately before its matching confirmation in one atomic capture group.
- Kept production setup, tracker controls, scheduling, correction UI, cloud preflight/wiring, and
  release policy out of this foundation slice.

## Automated Evidence

`src/lib/basketball/lineupProjection.test.ts` covers exact participation, clock adjustments,
multi-player substitutions, reasoned short-handed transitions, setup ordering, optional opponent
authority, role history, boundary confirmation, explicit ejection replacement, late participants,
incomplete recovery, invalid lineups, and equal-play off/advisory/enforced behavior.

Implementation verification:

```text
pnpm vitest run src/lib/basketball  55 files, 403 tests passed
pnpm test                          171 files, 1184 tests passed
pnpm typecheck                      passed
pnpm lint                           passed with six existing Fast Refresh warnings
pnpm build                          passed
```

## Deferred Intentionally

- BKE-6B: production setup review, opening lineup UI, sticky clock controls, expiration scheduling,
  parking/reload guards, and browser/PWA validation.
- BKE-6C: live substitution/role/equal-play controls and correction/consequence UX.
- BKE-6D/BKE-6E: cloud capability enforcement, recorder/finalization integration, summaries,
  aggregates, release evidence, and broader rollout.
- Shot clock, possession arrow, and league-specific equal-play policies beyond the three approved
  checks remain outside BKE-6.
