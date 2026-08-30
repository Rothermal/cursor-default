# Regression: BKE-6D2 Exact-Second Aggregates

Status: Automated checks pass. Browser smoke is not run in this implementation environment.

## Scope

- stable additive `bk_dnp` and signed `bk_pm` canonical metrics;
- sum-then-truncate anchored participation seconds using projector-owned match intervals;
- lineup-entry appearance, opening-lineup start, and roster-without-entry DNP authority;
- player and aggregate participation basis plus structured metric eligibility and coverage;
- partial eligible plus-minus in Player Profile/Career and complete-coverage comparative ranking;
- optional opponent-player projection without requiring opponent players for tracked metrics; and
- unchanged clockless manual minutes, legacy aggregates, transport envelopes, and Soccer paths.

## Automated Evidence

| Gate | Result |
|---|---|
| `pnpm typecheck` | Pass |
| Focused BKE-6D2 aggregate, transport, hook, and route tests | Pass: 8 files / 57 tests |
| Basketball test directory | Pass: 60 files / 473 tests |
| Full Vitest suite | Pass: 176 files / 1,253 tests |
| `pnpm build` | Pass; 12-entry PWA precache is about 2.1 MiB |
| `pnpm lint` | Pass: 0 errors / 6 existing Fast Refresh warnings |
| `git diff --check` | Pass |

Focused coverage rebuilds a real anchored canonical stream with two 1,234 ms running intervals,
proving each player total is summed before one whole-second truncation. It covers starters, a bench
entry, DNP, tracked and optional opponent plus-minus, revised/deleted scoring, stable-player merge,
unmapped-DNP isolation, mixed manual/interval history, partial `N of M` coverage, comparative
suppression, unchanged exact canonical paging, and legacy/manual compatibility.

## Manual Matrix

| Scenario | Status |
|---|---|
| Review anchored Profile/Career participation, DNP, signed plus-minus, and coverage labels | Not run |
| Confirm mixed clockless/anchored individual history shows partial plus-minus coverage | Not run |
| Confirm Leaderboard, Team, Season, and Tournament hide partial plus-minus rankings | Not run |
| Confirm a complete anchored comparative scope offers plus-minus ranking | Not run |
| Review narrow/mobile Participation cells and signed value formatting | Not run |

## Compatibility

- No Supabase migration or RPC response change is added.
- Existing canonical snapshots are reprojected through the production event registry/projector.
- Clockless Event and Legacy Basketball keep recorded/manual minutes and cannot fabricate DNP or
  plus-minus.
- Unavailable metrics use eligibility metadata and reasons; numeric totals never use sentinels.
- Unresolved stable-player, authority-collision, duplicate, abandoned, malformed, pagination,
  cancellation, and account-isolation behavior remains fail-closed.

## Exit

BKE-6D2 is complete. BKE-6D3 next enables anchored cloud bind/sync using the existing coherent
recorder transport after fresh Basketball release and clock/lineup capability checks.
