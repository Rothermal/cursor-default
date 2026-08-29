# Regression: BKE-6C1 Live Substitutions

Status: Automated gates pass. Manual browser review remains owner smoke, not implied evidence.

Plan: [PLAN_BKE_6C_LIVE_LINEUPS_AND_CORRECTIONS.md](PLAN_BKE_6C_LIVE_LINEUPS_AND_CORRECTIONS.md)

## Delivered

- one pure side-aware lineup-sheet model using stable `participantId` authority;
- a shared mobile sheet/desktop dialog for tracked and optional opponent lineups;
- Current, Bench, Unavailable, and resulting-lineup views with explicit entering and leaving states;
- paused-only atomic balanced, exit-only, entry-only, and unequal mixed substitutions without
  implicit clock writes or fabricated intermediate lineups;
- structured Injury, Eligibility, Short-handed, Recovery, and Other reasons with bounded notes;
- reason-free full-five boundary rotations, structured short-handed projection authority, and one
  exhaustive mode/reason catalog shared by validator, command, model, and presentation;
- exact ordinary and `recordedLater: true` lineup-family payload forms while preserving the shipped
  three-key `basketball.lineup_confirmed` payload;
- replacement-required participants kept visibly current until an explicit transition removes them;
  and
- successful commits applied through one `GameContext` update with focus return and quick-Undo
  receipt clearing.

No Supabase migration, boundary/equal-play coordinator, role/captain editing, current-lineup
recovery, historical correction, or cloud anchored transport is included.

## Automated Evidence

| Gate | Result |
|---|---|
| `pnpm.cmd typecheck` | Pass |
| `pnpm.cmd test` | Pass: 175 files and 1,222 tests |
| `pnpm.cmd lint` | Pass: 0 errors; 6 existing Fast Refresh warnings, including 3 in an ignored worktree |
| `pnpm.cmd build` | Pass: production bundle and PWA service worker generated |
| `git diff --check` | Pass |

Focused coverage includes:

- exact live and recorded-later payload validation for all four lineup event families;
- shipped lineup-confirmation compatibility and rejection of superseded test-only substitution
  payloads;
- tracked/opponent grouping, unavailable participants, replacement-required presentation, and
  one-through-five lineup constraints;
- balanced, exit-only, entry-only, and unequal mixed derivation plus structured reason validation;
- full-five boundary rotations without false Other authority and separate projected reason code/note;
- one appended event with one command timestamp/capture id and quick-Undo receipt clearing; and
- one shared sheet mounted from the clock strip, paused-only controls, dialog semantics, Escape,
  focus return, and live-result announcement source contracts.

## Manual Matrix

| Check | Status |
|---|---|
| Open and cancel the lineup sheet on narrow phone and desktop viewports | Not run |
| Balanced multi-player substitution and resulting-five preview | Not run |
| Exit-only below-five transition with each reason and required Other note | Not run |
| Entry-only recovery from a short-handed lineup | Not run |
| Ejected/disqualified/DNP and replacement-required presentation | Not run |
| Opponent tab present only when opponent lineup authority exists | Not run |
| Running-clock action disabled with no implicit Pause | Covered automatically; browser smoke not run |
| Commit updates current five once and returns focus to Lineup | Covered by command/source contracts; browser smoke not run |
| Clockless Event, Legacy Basketball, and Soccer parity | Covered automatically; browser smoke not run |

## Exit

BKE-6C1 is complete. A supported local anchored game can now record truthful paused live lineup
transitions without inventing eligibility changes or opponent authority. BKE-6C2 owns configured
boundary review, changed-five confirmation, equal-play evaluation, and enforced override handling.
