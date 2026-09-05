# Soccer Restart Capture Regression

Status: R1-R4 implementation is complete. Automated coverage is green;
deployed browser/PWA and live Supabase evidence remain to be recorded.

Use this checklist for `S17` / `S20` and the restart work delivered through
`PLAN_SOC_RESTARTS.md`. It covers Corner, Throw-in, Goal kick, and Offside
capture without treating every dead ball as a required event.

## Deployment And Compatibility Gate

No migration was added for restart capture. The new kinds and optional actor
use the existing Soccer schema-version-1 event envelope and shared JSON cloud
transport. A cloud test project must include migration
`049_soccer_release_capabilities.sql` and its required Soccer dependencies.
The normal Soccer new-game capability preflight is the live backend gate.

Reader support shipped before writers:

| Layer | Merge evidence | Purpose |
|---|---|---|
| R1 domain readers | PR #366 | Accept and project all four kinds, optional actor roles, totals, and canonical suggestions |
| R2 review readers | PR #370 | Render Timeline, Field, and Summary labels/totals |
| R3 writers | PR #371 | Expose one-shot live capture and historical Add/Edit |

A client older than R1 cannot safely inspect `throw_in`, `goal_kick`, or
`taker`; its fail-closed diagnostics may mark the stream incomplete. Refresh
or fully close/reopen an installed PWA until it is on an R1-or-newer build
before recording or opening those events. A cached R1/R2 client is expected to
read R3 events because writer payloads use exactly the previously deployed
reader contract. Do not use a pre-R1 client to mutate a game after new restart
events exist.

## Automated Evidence

Run from the repository root:

```powershell
pnpm.cmd exec vitest run src/lib/soccer/field.test.ts src/lib/soccer/soc4.test.ts src/lib/soccer/summary.test.ts src/lib/soccer/summaryField.test.ts src/lib/soccer/summaryTimeline.test.ts src/lib/soccer/timeline.test.ts src/lib/soccer/matchReadiness.test.ts src/lib/soccer/cloudSync.test.ts src/lib/soccer/releaseCapabilities.test.ts src/lib/soccer/migration049.test.ts
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd test
pnpm.cmd build
```

Coverage includes kind/actor cardinality, opponent identity rejection,
historical corner/offside compatibility, side totals, canonical and flipped
geometry, labels, marker families, one-shot wiring, repeated-location marker
pass-through, cloud event round-trip, and the existing capability contract.

### R4 documentation run

| Field | Value |
|---|---|
| Base commit | `34c96e7` |
| Branch | `docs/soc-restarts-r4-regression` |
| Reader/writer merge order | PR #366 -> PR #370 -> PR #371 |
| Restart migration | None |
| Live capability | Existing migration 049 fixed handshake; no version change |
| Focused tests | Pass; 10 files, 91 tests |
| Full tests | Pass; 190 files, 1,365 tests |
| Typecheck | Pass; `pnpm.cmd typecheck` |
| Lint | Pass; 0 errors, 3 existing Fast Refresh warnings |
| Production build | Pass; PWA generated with 12 precache entries |
| Browser/PWA evidence | Not run |
| Live Supabase evidence | Not run |

## Operator Record

Use a disposable Soccer game and do not include emails, tokens, or raw event
payloads in evidence.

| Field | Value |
|---|---|
| Date/time | Not run |
| Commit/deployment | Not run |
| Browser or installed PWA/version | Not run |
| Viewport/device | Not run |
| Supabase project | Not run |
| Highest applied migration | Not run; must include at least 049 |
| Account/team role | Not run |
| Game/team | Not run |
| Reviewer | Not run |

Use `Pass`, `Fail`, `Blocked`, or `Not run`. Evidence may be a screenshot,
screen recording, build/CI link, cloud sync status, or issue link.

## Manual Matrix

| ID | Procedure | Expected | Result/evidence |
|---|---|---|---|
| RST-01 | On the deployed build, enable Soccer and start a cloud-team game | New-game capability preflight succeeds without backend/client update guidance; the game reaches the normal tracker | Not run |
| RST-02 | Select Tracked and Shot, arm Restart, then tap the tracked attacking corner | The pitch and Restart button show the armed state with Tracked context; Corner is suggested and the normal Shot preference remains unchanged | Not run |
| RST-03 | Save that Corner with an on-field tracked taker, arm Restart again, and tap the same marker location | The existing marker is click-through while armed; a second new Corner sheet opens rather than correction of the first event | Not run |
| RST-04 | Select Opponent, arm Restart, tap a touchline, and save Throw-in with no taker | Throw-in is suggested; no tracked-player choice is offered; Save records an opponent event labeled `Taker not recorded` | Not run |
| RST-05 | Record an opponent Throw-in with a free-text taker, then switch the sheet to Tracked | Opponent accepts the label; switching to Tracked clears the invalid label selection and allows only an on-field tracked player or no taker | Not run |
| RST-06 | Arm Restart and tap the awarded side's defending goal-area band | Goal kick is suggested; changing the visible kind before Save records the selected kind without changing the tapped location | Not run |
| RST-07 | Record Offside for both sides with no actor, a tracked player, and an opponent label as applicable | Offside uses `offside_player`, never `taker`; labels and omitted-actor copy remain correct | Not run |
| RST-08 | Arm Restart, then change side, capture mode, tracker tab, or open another quick/More action | Restart disarms without changing Shot/Defense/Foul preference or opening an unintended restart | Not run |
| RST-09 | Flip the field and repeat equivalent corner, touchline, and goal-area taps | Suggestions match the physical pitch context; reviewed markers retain canonical locations and upright labels/counts | Not run |
| RST-10 | From Timeline, Add each restart kind without a location; edit one to set/clear location and change taker/kind | Historical Add/Edit uses the same validation; unknown location remains valid; correction preserves valid actor attribution | Not run |
| RST-11 | Open live Timeline and Summary Field/Timeline/Overview after recording both sides | Labels name kind, awarded side, and known/omitted actor; Field shows located markers; Summary shows non-zero Corners, Offsides, Throw-ins, and Goal kicks | Not run |
| RST-12 | Park or sync, reload/close-reopen, resume the matching cloud game, and inspect sync state | All restart events round-trip through Supabase once, remain projectable, and preserve kind, side, actor, location, and correction revision | Not run |
| RST-13 | Finalize the disposable cloud game and reopen its canonical Summary | Finalization succeeds with a healthy stream; canonical review retains restart totals, labels, and positions | Not run |
| RST-14 | If an installed R1/R2 pre-writer PWA is available, open the R3-created game read-only; separately refresh any pre-R1 shell before opening it | R1/R2 reads all R3 events; a pre-R1 shell is updated before use rather than treated as compatible | Not run |
| RST-15 | Repeat one local-only game with Supabase unavailable | Capture, correction, parking, resume, Timeline, and Summary remain usable without claiming cloud authority | Not run |

## Exit And Failure Handling

R1-R4 implementation may merge with the manual cells still `Not run`; this
matches the owner-only opt-in release posture. Complete the focused rows before
relying on restart history for a production match or broadening Soccer access.

Any incorrect side, overwritten prior event, lost actor/location, incomplete
stream diagnostic, duplicate cloud event, or finalization failure is a
correctness blocker. Stop using restart capture for that game, preserve a
recovery export, and link the diagnostic to a GitHub issue before continuing.
