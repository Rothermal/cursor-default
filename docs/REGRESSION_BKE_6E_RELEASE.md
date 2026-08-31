# BKE-6E Basketball Release Regression Matrix

Status: BKE-6E1 release audit and automated contract inventory implemented. BKE-6E2 manual
release-surface hardening and BKE-6E3 exact-candidate owner smoke remain pending.

Plan: [PLAN_BKE_6E_RELEASE_HARDENING.md](PLAN_BKE_6E_RELEASE_HARDENING.md)

## Purpose

This is the single operator record for the default-off Basketball Event tracker release. It maps
the automated contracts already delivered from BKE-4E through BKE-6D, records the BKE-6E release
entry audit, and separates evidence required for owner smoke from the larger role/device matrix
that gates broader rollout.

Do not treat CI, an owner-only acceptance, or an unexecuted row as evidence that a live browser,
Supabase, role, second-device, offline, or installed-PWA scenario passed.

## Fixed Release State

- Production remains `opt_in`; the device Event preference defaults to off.
- Release policy blocks only new Event creation. Existing local, parked, imported, cloud-bound,
  finalized, reopened, and canonical Event records remain accessible.
- Legacy Basketball and clockless Event Basketball keep their established authority and transport.
- Local-only anchored play does not require cloud capability. Cloud setup, binding, sync,
  finalization, and reopen require their existing fresh access and exact capability checks.
- Cloud-bound team equal-play overrides require online source-team role resolution. Offline live
  capture uses the local-only path for this initial rollout.
- Migration 064 is the release ceiling. No BKE-6E1 migration or runtime behavior change is added.
- Soccer and mixed-sport parking remain unchanged.

## Evidence Classes

| Class | Meaning |
|---|---|
| Automated | Covered by the listed test and required in normal CI |
| E2 hardening | Manual browser/PWA/responsive/accessibility/rollback work owned by BKE-6E2 |
| E3 owner smoke | Must run against the exact deployed candidate before BKE-6 sign-off |
| Broader gate | May remain `Not run` for the initial owner-only rollout but must pass before access materially broadens |

Use `Pass`, `Fail`, `Blocked`, or `Not run` for manual results. Evidence may identify a CI run,
screenshot, recording, console excerpt, database query, or issue without including access tokens,
invite tokens, email addresses, raw event payloads, or private account data.

## Automated Evidence Map

Run from the repository root:

```text
pnpm lint
pnpm test
pnpm build
```

| Contract | Primary coverage |
|---|---|
| Release stage, preference off/on, existing access, and Soccer/non-Soccer parity | `src/lib/sportAvailability.test.ts` |
| Audited implementation-consumer allowlists, mutation-free entries, preflight ordering, account cache clearing, and active-game mutation guards | `src/lib/basketball/releaseEntryGuards.test.ts` |
| Legacy, new Event, blocked draft, and exact matching pre-start continuation policy | `src/lib/basketball/releasePolicy.test.ts` |
| Atomic setup draft/commit, immutable rules, local-only policy, and rollback-safe storage | `src/lib/basketball/setupDraft.test.ts`, `src/lib/gameParking.test.ts` |
| Exact release capability parsing, account-isolated cache, retry, and failure classification | `src/lib/basketball/releaseCapabilities.test.ts` |
| Exact clock/lineup capability parsing, account isolation, and retry | `src/lib/basketball/clockLineupCapabilities.test.ts` |
| Fresh app/team/capability authorization and accepted local-only versus cloud-bound role behavior | `src/lib/basketball/cloudAuthorization.test.ts` |
| Later cloud enablement, checkpoint-first persistence, duplicate binding, and failure rollback | `src/lib/basketball/enableCloudSync.test.ts` |
| Legacy/clockless/anchored transport isolation, stale results, conflicts, and adoption | `src/lib/basketball/cloudSync.test.ts`, `src/lib/gameEvents/cloudOpen.test.ts` |
| Migration 061 release contract, 062 settings, 063 clock/lineup, and 064 trusted finalization/reopen | `src/lib/basketball/migration061.test.ts` through `migration064.test.ts` |
| Anchored readiness, finalization, reopen handoff, correction, and republication | `src/lib/basketball/anchoredFinalization.test.ts`, `finalization.test.ts`, `reopenHandoff.test.ts` |
| Summary, Timeline, shots, exact-second aggregates, provenance, and destination routing | BKE-4D/BKE-4E/BKE-6D tests under `src/lib/basketball/` |
| Legacy Basketball, clockless Event, Soccer, mixed-sport parking/import, and account ownership | Full `src/lib/`, `src/lib/gameEvents/`, and `src/lib/soccer/` suites |

## BKE-6E1 Entry Inventory

The source-consumer allowlist fails when a new use of `getBasketballEventCreationPolicy` or
`getSportAvailabilityPolicy` appears without review.

This inventory intentionally follows direct symbol consumers. Do not alias, re-export, or wrap
either policy helper; introducing an adapter requires a new audited boundary and an explicit
inventory update rather than allowlisting only the adapter.

| Surface | Policy responsibility | BKE-6E1 disposition |
|---|---|---|
| Sport Select | Generic sport discovery only; parked counts remain sport-scoped | Audited and allowlisted |
| Sport Dashboard | Generic sport availability; Basketball New Game navigates to mutation-free setup | Audited and source-guarded |
| Settings App/Sports | Generic discovery and sport settings navigation | Audited and allowlisted |
| Basketball Tracker settings | Device-local Event preference and stage availability; no cloud settings write | Audited and source-guarded |
| Teams | Generic sport-scoped navigation and disabled-sport presentation | Audited and allowlisted |
| Team Info | Generic team sport availability; Basketball start navigates without mutation | Audited and source-guarded |
| Direct Game Setup links | Generic team/sport validation; Basketball Event policy and capabilities are rechecked before mutation | Audited and source-guarded |
| Setup replacement/Continue | Fresh creation guard precedes capability, parking, tournament, and atomic commit | Audited and source-guarded |
| Matching pre-start draft | Exact committed local id may continue while new creation is unavailable; mismatches fail closed | Automated policy coverage |
| Player Setup | Rechecks reviewed rule authority before immutable Event start | Audited and source-guarded |
| Atomic context commit | Reloads persisted device preference; stale tabs and failed preference writes fail closed | Audited and source-guarded |
| Later Enable Cloud | Fresh app/team/dual-capability checks precede transport and parked persistence | Audited and source-guarded |
| Games/Game Info cloud open | Existing record path uses current account, local matching binding first, and strict source adoption | Audited existing-record path |
| Tracker/Summary/history | Existing record surfaces do not consume new-creation policy | Enforced by the implementation-consumer allowlist |

## BKE-6E1 Implementation Record

| Field | Value |
|---|---|
| Base commit | `cd2a2e8` |
| Branch | `feature/bke-6e1-release-audit` |
| Production release stage | `opt_in` unchanged |
| Device default | Event tracker off unchanged |
| Migration ceiling | `064`; no migration added |
| Focused release tests | Pass; 7 files, 67 tests |
| Lint | Pass; 0 errors, 3 Fast Refresh warnings in the candidate tree; repository-local worktrees and generated checkout directories are excluded |
| Full tests | Pass; 180 files, 1,287 tests |
| Production build | Pass; PWA generated with 12 precache entries (2,198.70 KiB) |
| CI | Pass on PR #350 |

Focused release validation used:

```text
pnpm exec vitest run src/lib/basketball/releaseEntryGuards.test.ts src/lib/basketball/releasePolicy.test.ts src/lib/sportAvailability.test.ts src/lib/basketball/releaseCapabilities.test.ts src/lib/basketball/clockLineupCapabilities.test.ts src/lib/basketball/cloudAuthorization.test.ts src/lib/basketball/migration064.test.ts
```

The BKE-6E1 compatibility scope was resolved by mapping existing automated parity contracts into
F02 and F05 and retaining explicit manual rows F01, F03, and F04. No new parity behavior is claimed
for an unexecuted manual row.

## Operator Metadata

Complete metadata separately for the BKE-6E2 hardening candidate and BKE-6E3 exact deployed
candidate.

| Field | BKE-6E2 hardening | BKE-6E3 deployed owner smoke |
|---|---|---|
| Date/time | Not run | Not run |
| Commit/deployment | Not run | Not run |
| Running-app build identifier | Not available until BKE-6E2 | Not run |
| Supabase project | Not run | Not run |
| Highest migration | Must be `064` | Must be `064` |
| Browser/version | Not run | Not run |
| Browser or installed PWA | Not run | Not run |
| Viewport/device | Not run | Not run |
| Accounts used | Not run | Not run |
| Team roles used | Not run | Not run |
| Reviewer | Not run | Not run |

## A. Policy and Entry

| ID | Procedure | Expected | Class | Result/evidence |
|---|---|---|---|---|
| A01 | Exercise internal/opt-in, development/production, and preference off/on policy combinations | New Event creation follows the centralized stage and device preference; existing access is always true | Automated | `sportAvailability.test.ts` |
| A02 | With preference off, inspect Sport Select, Sport Dashboard, Settings App/Sports, and Basketball Tracker settings | Basketball whole-sport navigation remains available when enabled; new Event choice is unavailable while Legacy remains usable | E2 hardening | Not run |
| A03 | Enable the preference and enter setup from Sport Dashboard, Team Info, and a direct team/sport URL | Entry is mutation-free; setup owns authority choice and Continue owns the guarded commit | E3 owner smoke | Not run |
| A04 | Cancel setup and capability recovery from each entry with another active game | Active id, parked ids, state, dirty flags, and setup draft follow their documented no-mutation behavior | E3 owner smoke | Not run |
| A05 | Disable preference after committing a pre-start Event slot, then continue its exact draft | Exact matching pre-start continuation works; a new or mismatched Event draft fails closed | Automated | `releasePolicy.test.ts` |
| A06 | Add a new implementation consumer of either release policy helper | Consumer allowlist fails until the entry is audited | Automated | `releaseEntryGuards.test.ts` |

## B. Access, Capabilities, and Backend State

Use a disposable project for missing-contract simulations. Do not alter production migration
history or revoke grants used by existing games.

| ID | Procedure | Expected | Class | Result/evidence |
|---|---|---|---|---|
| B01 | Parse exact, older, newer, malformed, auth, access, offline, and generic release capability responses | Exact succeeds; every other state receives its narrow fail-closed classification | Automated | `releaseCapabilities.test.ts` |
| B02 | Repeat B01 for the clock/lineup handshake | Exact version 1 succeeds; drift and failures remain distinct and retryable | Automated | `clockLineupCapabilities.test.ts` |
| B03 | Sign out or switch accounts around successful and in-flight checks | Success and in-flight ownership never cross accounts; failures are not cached | Automated | capability and auth source-guard tests |
| B04 | Start cloud-backed Personal and existing-team anchored setup against migration 064 | Fresh app access and both capability checks pass before storage mutation | E3 owner smoke | Not run |
| B05 | Attempt cloud setup while offline, signed out, suspended, or without current team access | Failure is actionable and leaves active/parked/setup authority unchanged; local-only remains explicit where permitted | E3 owner smoke | Not run |
| B06 | Call the migration 064 readiness/finalize/reopen surfaces with malformed or unauthorized authority | Fixed wrappers fail closed and shared private cores remain unavailable | Automated | `migration064.test.ts`, finalization tests |

## C. Local Anchored Authority

| ID | Procedure | Expected | Class | Result/evidence |
|---|---|---|---|---|
| C01 | Create a local-only rules-v3/setup-v2 game with five starters | Period 1 opens paused at zero with immutable rules/setup and no cloud binding | E3 owner smoke | Not run |
| C02 | Start, pause with/without stoppage, Set Clock, expire, end period, and open the next period | Canonical elapsed time remains monotonic and periods open paused; expiration creates one authoritative Pause | E3 owner smoke | Not run |
| C03 | Record shots, free throws, fouls, timeouts, turnovers, substitutions, roles, and late participants | One canonical command time and checked event transitions preserve projection | E3 owner smoke | Not run |
| C04 | Exercise changed-five and equal-play-off/advisory/enforced boundaries | Review and reasoned override rules match the immutable profile and current lineup | E3 owner smoke | Not run |
| C05 | Correct clock, lineup, gameplay, and administrative events through Timeline | Consequence preview, stale rejection, grouped remove/restore, and full reprojection stay coherent | E3 owner smoke | Not run |
| C06 | Park or replace while the clock is running | Confirmed workflow appends Pause before storage mutation; Cancel changes nothing | E3 owner smoke | Not run |

## D. Cloud Lifecycle, Roles, and Recorders

| ID | Procedure | Expected | Class | Result/evidence |
|---|---|---|---|---|
| D01 | Enable cloud on a local-only game | Fresh access and both capabilities precede bind/upload; checkpoint succeeds before automatic policy persists | E3 owner smoke | Not run |
| D02 | Record and sync a running anchored game, then reload and resume the matching binding | One recorder remains coherent; exact clock/lineup authority survives adoption | E3 owner smoke | Not run |
| D03 | Use a second account as owner/admin/scorer, viewer, and removed member at an enforced equal-play boundary | Owner/admin/scorer may override; viewer/removed are denied after fresh role resolution | Broader gate | Not run |
| D04 | Take a cloud-bound team game offline at an enforced violation | Override remains blocked until online role resolution or a compliant five; no silent authorization occurs | E3 owner smoke | Not run; accepted initial limitation |
| D05 | Open the same recorder on a second device and create a divergence | Strict adoption/conflict/checkpoint handling never blends streams or reports stale success | Broader gate | Not run |
| D06 | Create independent recorder streams and select primary | Presence and history stay role-limited; alternate review is isolated and read-only | Broader gate | Not run |
| D07 | Finalize, Correct records, Resume game, sync, and republish | Trusted readiness, checkpoint, reopen mode, recorder handoff, and append-only publication history remain exact | Broader gate | Not run |

## E. Summary and Aggregates

| ID | Procedure | Expected | Class | Result/evidence |
|---|---|---|---|---|
| E01 | Review local, remote primary, manager-selected alternate, and canonical Summary | Exactly one source is labeled; remote/canonical review never hydrates live context | E3 owner smoke | Not run |
| E02 | Inspect Players, Timeline, Shot Chart, Overview, and Team Stats | Exact participation, stint/role history, active corrections, score, and quality disclosures share one authority | E3 owner smoke | Not run |
| E03 | Open Leaderboard, Team, Season, Tournament, Player, and Career destinations | Canonical and Legacy sources do not collide; exact seconds/DNP/plus-minus provenance remains truthful | E3 owner smoke | Not run |
| E04 | Inspect incomplete tracked/opponent lineup authority | Valid facts remain visible while dependent comparative plus-minus is suppressed | E3 owner smoke | Not run |

## F. Compatibility and Adjacent Sports

| ID | Procedure | Expected | Class | Result/evidence |
|---|---|---|---|---|
| F01 | Open and track a Legacy Basketball game with Event preference off | Aggregate reducer, snapshot sync, manual minutes, Game Info, and legacy Summary remain unchanged | E3 owner smoke | Not run |
| F02 | Open rules-v1/v2 or setup-v1 clockless Event games | No anchored events/capability path is invented; manual minutes retain established semantics | Automated | clockless command/cloud/authorization suites |
| F03 | Open an existing anchored local, parked, cloud, final, reopened, and canonical record with preference off | Every existing authority remains reachable; only new Event creation is gated | E3 owner smoke | Not run |
| F04 | Park Basketball, start/resume Soccer, then reverse | Each sport restores its own workspace and state; no court/field or transport crossover occurs | E3 owner smoke | Not run |
| F05 | Exercise Soccer sync, finalization, Summary, aggregates, and settings after Basketball release changes | Soccer fixed wrappers and runtime behavior remain unchanged | Automated | full Soccer and shared event suites |
| F06 | Import/export mixed Legacy, clockless, anchored, and Soccer records | Import remains parked-only, preserves valid ids/authority, and reports safe skips | E2 hardening | Not run |

## G. Recovery, Offline, PWA, and Account Isolation

| ID | Procedure | Expected | Class | Result/evidence |
|---|---|---|---|---|
| G01 | Run local-only capture/correction offline, park, reload, and reconnect | Local work remains coherent without capability claims; owned dirty work resumes safely | E2 hardening | Not run |
| G02 | Reload/background a running clock with safe and unsafe wall-time movement | Safe anchor resumes; unsafe movement requires explicit recovery instead of silently accepting time | E2 hardening | Not run |
| G03 | Install the PWA, deploy a release-stage rollback, and keep one stale client open/offline | Stale client remains on the old bundle until online reload; operator guidance and displayed build make this visible | E2 hardening | Not run |
| G04 | Switch anonymous/account A/account B with parked and bound games | Local and cloud ownership, capability cache, drafts, and recovery state remain isolated | Broader gate | Not run |
| G05 | Exercise duplicate binding, stale sync completion, quota, cap, and recovery export | No authority is overwritten or falsely marked clean; recovery remains available | E2 hardening | Not run |

## H. Responsive, Accessibility, and Alerts

| ID | Procedure | Expected | Class | Result/evidence |
|---|---|---|---|---|
| H01 | Run setup, opening lineup, tracker, sheets, Timeline, Summary, and settings at `320 x 568` | Primary controls remain reachable with no blocking overlap or clipping | E2 hardening | Not run |
| H02 | Repeat the live path in an installed PWA at `390 x 844` | Safe areas/browser chrome do not hide clock, lineup, correction, or parking controls | E2 hardening | Not run |
| H03 | Review the same surfaces at `768 x 1024` and `1440 x 900` | Stable layout remains scan-friendly without stretched or shifting controls | E2 hardening | Not run |
| H04 | Navigate tabs, dialogs, sheets, clock, correction, and recovery by keyboard | Focus is visible/logical, dialogs restore focus, and no primary workflow traps | E2 hardening | Not run |
| H05 | Trigger expiration, offline, conflict, save, error, and completion states | Status is announced without duplication or sensitive detail; reduced motion and unavailable sound/vibration degrade safely | E2 hardening | Not run |

## I. Operations, Rollback, and Sign-off

| ID | Procedure | Expected | Class | Result/evidence |
|---|---|---|---|---|
| I01 | Inspect the running app after deployment | A concise displayed build/commit identifier matches the exact candidate | E2 hardening | Not available until BKE-6E2 |
| I02 | Confirm migrations and call both capability handshakes | Highest migration is 064; release contract v2 and clock/lineup version 1 are exact | E3 owner smoke | Not run |
| I03 | Disable the device preference | New Event creation stops immediately on that device; existing Event and Legacy records remain available | E3 owner smoke | Not run |
| I04 | Change the client stage to `internal`, build, deploy, and refresh/close-reopen an online PWA | New Event creation stops after bundle propagation; no server objects or existing records are changed | E2 hardening | Not run |
| I05 | Repeat I04 with an offline/stale PWA | Old policy persists visibly until the new bundle loads; no claim of immediate remote shutdown is made | E2 hardening | Not run |
| I06 | Run lint, full tests, production build, and CI on the exact candidate | All automated gates pass; existing warnings are recorded separately | Automated | Local lint/tests/build pass; PR #350 CI pass |

## Go/No-Go

BKE-6E1 may merge when the consumer inventory is enforced, focused and full automation pass, the
matrix is linked from project docs, and no runtime/migration/release-stage change is present.

The initial default-off owner rollout may continue after BKE-6E3 owner smoke is accepted. Broader
rollout remains blocked at minimum on:

- D03 live second-account owner/admin/scorer versus viewer/removed role resolution;
- D05-D07 second-device recorder/conflict/primary/finalization/reopen/republication; and
- G03-G04 installed-PWA rollback/offline behavior plus account-isolated mixed-sport recovery.

Any authentication, authorization, data-loss, authority-blending, clock/lineup/score correctness,
recovery, or primary-workflow accessibility failure is a release blocker. Nonblocking visual polish
receives an issue and explicit disposition rather than silently expanding BKE-6E.

## Sign-off

| Decision | Reviewer | Date | Evidence/notes |
|---|---|---|---|
| BKE-6E1 automated release audit | Pending PR review | Pending | Consumer allowlist, matrix, and CI |
| BKE-6E2 release-surface hardening | Pending | Pending | Responsive/accessibility/PWA/rollback rows |
| BKE-6E3 owner-only exact-candidate smoke | Pending | Pending | Local/cloud smoke and deployed identifier |
| Broader rollout | Blocked | Pending | D03, D05-D07, and G03-G04 must pass |
