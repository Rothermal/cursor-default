# Regression: BKE-6C4 Lineup Corrections and Exit

Status: Automated checks pass. Browser smoke is not run in this implementation environment.

## Scope

- effective-time replay for recorded-later substitutions, roles, confirmations, and equal-play overrides;
- consequence-aware, stale-safe Timeline edit for all lineup event families;
- atomic capture-group remove and restore;
- grouped Recent Events with older actions routed to Timeline;
- familiar display-clock and canonical elapsed detail; and
- replacement, boundary-confirmation, and deliberately incomplete recovery diagnostics.

## Automated Evidence

| Gate | Result |
|---|---|
| `pnpm typecheck` | Pass |
| Focused lineup and Timeline tests | Pass: 4 files / 53 tests |
| Full Vitest suite | Pass: 175 files / 1,238 tests |
| `pnpm build` | Pass; 12-entry PWA precache is about 2.1 MiB and remains below the 3 MiB per-asset budget |
| `pnpm lint` | Pass: 0 errors / 6 existing Fast Refresh warnings |
| `git diff --check` | Pass |

Focused tests prove deterministic backdated substitution replay through later clock intervals,
exact participation consequences, grouped substitution-plus-role remove/restore, stale correction
rejection, terminal correction denial, quick-Undo clearing, Timeline filters/detail, and replacement
plus incomplete-recovery diagnostics. They also preserve corrected history when the match later enters
a local terminal state.

## Manual Matrix

| Scenario | Status |
|---|---|
| Edit substitution time and participants, review consequences, and apply | Not run |
| Edit roles/captains and an equal-play override or confirmation group | Not run |
| Remove and restore substitution plus role and override plus confirmation groups | Not run |
| Open an older Recent Events lineup group in Timeline | Not run |
| Verify count-down and count-up display input against canonical elapsed detail | Not run |
| Inspect replacement, pending confirmation, and incomplete-recovery diagnostics | Not run |
| Repeat edit/preview on narrow mobile, tablet, and desktop layouts with keyboard focus | Not run |
| Park/reload a corrected game, then suspend and reopen it | Not run |

## Compatibility

- No Supabase migration is added.
- Legacy and clockless Event Basketball retain their existing behavior.
- Correction remains local and nonterminal; cloud/reopened correction belongs to BKE-6D.
- Soccer and generic event-stream capture ordering are unchanged.

## Exit

BKE-6C4 and BKE-6C are complete. BKE-6D next owns anchored cloud lifecycle, remote destination
detail, exact-second aggregates, finalization, reopen, and republication.
