# Regression: BKE-6D1 Summary Detail and Quality

Status: Automated checks pass. Browser smoke is not run in this implementation environment.

## Scope

- projection-derived appearance, exact participation time, stints, role history, and player
  plus-minus for anchored Basketball;
- zero-duration valid lineup entry as appearance evidence without invented playing time;
- five-player lineup time and eligible plus-minus;
- stable roster presentation with explicit name, minutes, and points sorts;
- page-level and metric-level quality disclosure while preserving trustworthy score/stat facts;
- display-only local, remote, and canonical Summary clock context; and
- unchanged clockless recorded-minute behavior and isolated Summary authorities.

## Automated Evidence

| Gate | Result |
|---|---|
| `pnpm typecheck` | Pass |
| Focused BKE-6D1 and source-contract tests | Pass: 4 files / 56 tests |
| Basketball test directory | Pass: 60 files / 465 tests |
| Full Vitest suite | Pass: 176 files / 1,245 tests |
| `pnpm build` | Pass; 12-entry PWA precache is about 2.1 MiB |
| `pnpm lint` | Pass: 0 errors / 6 existing Fast Refresh warnings |
| `git diff --check` | Pass |

Focused coverage proves truncate-once `MM:SS`, an entered zero-duration lineup producing an
appearance and eligible zero-time lineup combination, player and five-person plus-minus across
both sides, stable clockless Summary behavior, and the existing lineup correction/replay suite
under preserved zero-duration intervals.

## Manual Matrix

| Scenario | Status |
|---|---|
| Review anchored Players rows, sorts, stints, role history, and plus-minus | Not run |
| Review clockless Players and confirm recorded manual-minute labeling | Not run |
| Inspect complete and incomplete tracked/opponent quality disclosure | Not run |
| Inspect tracked and optional opponent five-player lineup combinations | Not run |
| Open local, primary, alternate, and canonical Timeline Summary sources | Not run |
| Observe a running remote clock without any live-state mutation | Not run |
| Check keyboard dialog close/focus return and narrow mobile rows | Not run |

## Compatibility

- No Supabase migration is added.
- Summary source selection and remote read isolation are unchanged.
- Existing local nonterminal Timeline correction behavior remains unchanged.
- Clockless Event Basketball, Legacy Basketball, Soccer, and aggregate schemas are unchanged.
- BKE-6D2 owns canonical exact-second participation and plus-minus provenance.

## Exit

BKE-6D1 is complete. BKE-6D2 now extends the pure canonical aggregate path with exact seconds,
appearances, DNP, and coverage-aware plus-minus without changing historical manual-minute authority;
BKE-6D3 anchored cloud transport is next.
