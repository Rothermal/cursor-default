# Regression: BKE-6C3 Roles and Current-Lineup Recovery

Status: Automated checks pass. Browser smoke is not run in this implementation environment.

## Scope

- atomic substitution plus role/captain capture;
- paused role-only capture with PG, SG, SF, PF, C, None, and Custom presentation;
- explicit replacement guidance and ordinary late-player bench entry;
- acknowledged, reasoned Set Current Lineup recovery; and
- Timeline detail and durable event authority for role and recovery metadata.

## Automated Evidence

| Gate | Result |
|---|---|
| `pnpm typecheck` | Pass |
| Focused lineup, sheet-model, and release-guard tests | Pass: 3 files / 47 tests |
| Full Vitest suite | Pass: 175 files / 1,232 tests |
| `pnpm build` | Pass; lineup sheet is a lazy-loaded precached chunk |
| `pnpm lint` | Pass: 0 errors / 6 existing Fast Refresh warnings |
| `git diff --check` | Pass |

Focused tests prove substitution-before-role ordering, one timestamp/capture group, preset/custom/none
positions, zero/multiple captains, replacement Start blocking, late participants remaining Bench until
ordinary substitution, same-five recovery, current-period-only incomplete evidence, and independent
opponent/prior-period quality.

## Manual Matrix

| Scenario | Status |
|---|---|
| Save only PG/Custom/None and zero or multiple captain changes while paused | Not run |
| Commit a substitution and role changes together, then inspect Timeline detail | Not run |
| Eject/disqualify an on-court player and replace them through Lineup | Not run |
| Add a participant from Lineup and verify the sheet returns with them on Bench | Not run |
| Recover the same and a changed current five after acknowledging the warning | Not run |
| Park/reload and confirm role, captain, recovery, and incomplete-period presentation | Not run |
| Repeat tracked/opponent controls on narrow mobile and desktop layouts | Not run |

## Exit

BKE-6C3 is complete. BKE-6C4 owns grouped Recent Events, consequence-aware
Timeline correction, stale previews, diagnostics, accessibility/responsive hardening, and the BKE-6C
exit audit.
