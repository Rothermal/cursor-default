# BKE-6E Basketball Release Regression Matrix

Status: BKE-6E1 release audit and BKE-6E2 release-surface hardening are implemented. The exact
BKE-6E2 merge candidate is deployed; BKE-6E3 owner smoke and final sign-off are in progress.

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

## BKE-6E2 Implementation Record

| Field | Value |
|---|---|
| Branch | `feature/bke-6e2-release-surface-hardening` |
| Runtime scope | Build identity, prompt-based PWA updates, offline/update status, compact clock controls, safe areas, reduced motion, and focused modal keyboard handling |
| Release behavior | Production remains `opt_in`; device preference remains default-off |
| Migration ceiling | `064`; no migration added |
| Deployed identity | GitHub Pages injects `VITE_APP_BUILD_ID` from the exact `github.sha`; the shell displays a safe 12-character label and exposes the full id as its accessible name/title |
| PWA update policy | Prompt before reload; an active anchored clock uses the centralized `reload_commit` preparation and must pause successfully before applying the worker update |
| Local validation | Typecheck pass; lint pass with 3 existing Fast Refresh warnings; focused release suite 5 files/49 tests plus review follow-up workflow suite 3 files/72 tests; full suite 181 files/1,291 tests; production PWA build pass with 12 precache entries (2,212.09 KiB) |
| Built artifact probe | `bke6e2-probe`, update guidance, and `reload_commit` are present in the production bundle; the worker waits for an explicit `SKIP_WAITING` message |
| Exact browser/PWA evidence | Pending the merged/deployed candidate; use the procedures below and retain the result in this matrix |

### Responsive procedure

Use browser responsive mode for `320 x 568`, `390 x 844`, `768 x 1024`, and `1440 x 900`.
At each size, keep zoom at 100% and exercise Game Setup rules/source review, opening-lineup
Starter/Bench/DNP assignment, Track and Timeline, Set Clock, stoppage, lineup and boundary sheets,
shot detail/correction, Summary tabs, Game Info, and Basketball settings. At the two phone sizes,
also rotate once and return to portrait. Record blocking horizontal page scroll, clipped primary
buttons, hidden dialog footers, keyboard-covered inputs, sticky-clock overlap, bottom-action overlap,
or text that cannot wrap. A horizontally scrolling lineup chip rail or tab strip is expected and is
not page-level overflow.

### Keyboard and announcement procedure

Starting from the control that opens each surface, use only `Tab`, `Shift+Tab`, arrow keys where a
tablist documents them, `Enter`, `Space`, and `Escape`. Confirm that focus is visible, remains inside
open dialogs, returns to the opener on close, and can reach Start/Pause, Set Clock, Lineup, Timeline
detail/correction, Summary tabs, update controls, and recovery actions. Trigger a clock expiration,
unsafe clock recovery, failed save, offline transition, and available PWA update. Confirm concise
status/alert announcements without reading the ticking clock every tenth of a second. Enable OS or
browser reduced motion and verify marker pulses, spinners, and transitions do not create sustained
motion. On devices without audio or vibration APIs, confirm those settings are disabled and labeled
unavailable rather than failing capture.

### Installed-PWA and recovery procedure

1. Install the deployed app, open it online, and record the displayed full build id.
2. Start a local-only anchored game, run the clock briefly, pause, capture an event, park/reload, and
   confirm the same local authority reopens.
3. Go offline, repeat local capture/correction and a reload, and confirm cloud actions wait without
   claiming success. Reconnect and confirm normal sync/recovery status returns.
4. While the anchored clock is running, make a newer worker available and choose **Update now**.
   Cancel once and verify no reload; accept once and verify the centralized preparation pauses the
   clock before the worker reload.
5. Confirm the newly displayed build id matches the deployed candidate. A dismissed update remains
   on the old displayed build until a later reload/update and must not be described as current.

### Release-stage rollback rehearsal

1. Record the current deployed build id and prove one existing Legacy, clockless Event, anchored
   local/parked, and cloud/canonical record remains reachable.
2. Change only `BASKETBALL_EVENT_RELEASE_STAGE` from `opt_in` to `internal`, run the release-policy
   tests and production build, then deploy that exact rollback commit. Do not change migrations,
   capability grants, stored games, or device preferences.
3. On an online installed app, wait for the update prompt, apply it, and verify the displayed build
   id changes. New Event discovery/creation must stop; all records from step 1 must still open.
4. Keep a second installed app offline on the prior build. Verify its unchanged build id makes the
   stale policy visible; immediate remote shutdown is explicitly not expected. Bring it online,
   apply the update, and repeat the stopped-creation/existing-access check.
5. To resume the owner preview, restore `opt_in` in a new reviewed commit and repeat the same exact-
   build verification. Never edit or reverse migrations 061 through 064 for client rollback.

## BKE-6E3 Owner Smoke Run Sheet

This is the minimum exact-candidate path for the initial owner-only, default-off rollout. It does
not replace the rows marked **Broader gate**. Record private evidence outside the repository and
enter only the disposition and non-sensitive notes here.

### Candidate

| Field | Value |
|---|---|
| Merge commit | `cc0a41237dd8d46478069aa7afeaa45fd50f7f10` |
| Expected displayed build | `cc0a41237dd8` |
| Pages deployment | Run `33419187582`; completed successfully on 2026-08-31 |
| Production URL | `https://rothermal.github.io/cursor-default/` |
| Production policy | `opt_in`; device preference default-off |
| Required migration ceiling | `064` |

Before gameplay, confirm the running app displays `cc0a41237dd8`. In Supabase, confirm migration
`064` is the highest applied migration. Starting a cloud-backed anchored setup while signed in and
active must pass the exact release contract v2 and clock/lineup version 1 handshakes before any
local slot is created; an actionable capability failure is a failed run, not permission to continue.

### Run 1: Entry and local authority

1. With the Event preference off, confirm Basketball remains available and Legacy remains an
   option. Enable the preference and enter Basketball setup from the Sport Dashboard.
2. Choose Event and explicit local-only authority, review version-3 rules, assign five tracked
   starters plus Bench/DNP, and start. Period 1 must open paused at canonical elapsed `0:00` with
   no cloud binding; count-up displays `0:00`, while count-down displays the configured duration.
3. Exercise Start/Pause, one stoppage, Set Clock, a shot, free throw, foul, timeout, turnover,
   substitution/role change, and one Timeline remove/restore. End a period and open the next.
4. While running, cancel one park attempt and accept the next. Cancel must change nothing; accept
   must append and persist Pause before parking. Resume and complete the game, then review all
   Summary tabs.

Covers: A02-A04, C01-C06, E02, G01-G02, H01-H05, I01.

### Run 2: Cloud lifecycle

1. Start a new Event game with Personal cloud or an existing team while online. Confirm capability
   recovery does not create or replace a local game before Continue succeeds.
2. Assign the opening lineup, start, record several event families, sync, reload, and resume the
   matching binding. Confirm the same source and clock/lineup authority return.
3. End the game, checkpoint/finalize, and inspect canonical Summary plus one aggregate destination.
   Use **Correct records**, reopen with a reason, make one correction, end again, and explicitly
   republish. Confirm publication history remains visible.

Covers: B04, D01-D02, E01-E03, F03, I02.

### Run 3: Compatibility and gating

1. Turn the Event preference off. Confirm new Event creation is unavailable while the completed
   Event games from Runs 1-2 remain reachable.
2. Open one Legacy or clockless Basketball record and verify its established tracking/review path.
3. Park Basketball, open or resume an existing Soccer game, then return to Basketball. Confirm no
   court/field, event stream, parked id, or transport crossover.

Covers: F01, F03-F04, I03.

### Run 4: Installed PWA and offline recovery

1. At a supported phone/PWA size, repeat a short local-only clock/capture/correction path online,
   then offline. Dismiss the offline notice and confirm it stays dismissed without covering Undo;
   reconnect and confirm a later offline transition announces again.
2. Park/reload offline, reopen the same local authority, reconnect, and confirm cloud actions never
   claimed success while disconnected.
3. If another build is available, exercise **Later**, cancel one running-clock **Update now**, then
   accept it. The displayed build changes only after activation and the accepted running-clock path
   persists Pause before reload. Otherwise mark only this update-activation substep `Not run`.

Covers: G01-G03, H01-H05, I01, I04-I05. Release-stage rollback remains a separate broader gate
unless it is deliberately rehearsed with reviewed `internal` and restored `opt_in` deployments.

### Owner result

| Run | Result | Non-sensitive evidence/notes |
|---|---|---|
| Exact candidate and migration/capabilities | Pass | Owner confirmed displayed build `cc0a41237dd8` in a desktop browser; release, clock/lineup, and migration-064 entry-point checks all returned `true`. Authenticated capability responses remain covered by Run 2. |
| Run 1: Entry and local authority | Blocked | Core setup/capture/correction and running-clock pause safety passed. Replacement setup continuity failed in [issue #352](https://github.com/Rothermal/cursor-default/issues/352). Completion reached Summary, which reported unresolved tracked-lineup boundary authority; diagnostic [issue #353](https://github.com/Rothermal/cursor-default/issues/353). Both investigations are intentionally deferred. |
| Run 2: Cloud lifecycle | Pending | Owner account and deployed Supabase required |
| Run 3: Compatibility and gating | Pending | Existing Legacy/clockless and Soccer records required |
| Run 4: Installed PWA and offline recovery | Pending | Installed/mobile browser required; update-activation substep may be `Not run` |
| Owner-only release disposition | Pending | Broader rollout remains blocked independently |

## Operator Metadata

Complete metadata separately for the BKE-6E2 hardening candidate and BKE-6E3 exact deployed
candidate.

| Field | BKE-6E2 hardening | BKE-6E3 deployed owner smoke |
|---|---|---|
| Date/time | Not run | 2026-08-31 |
| Commit/deployment | Not run | `cc0a41237dd8d46478069aa7afeaa45fd50f7f10`; Pages run `33419187582` |
| Running-app build identifier | Implemented; exact deployed value pending | Pass; displayed `cc0a41237dd8` |
| Supabase project | Not run | Deployed project; identifier intentionally omitted |
| Highest migration | Must be `064` | Migration-064 entry point present; ledger value not separately recorded |
| Browser/version | Not run | Desktop browser; version not recorded |
| Browser or installed PWA | Not run | Desktop browser |
| Viewport/device | Not run | Not run |
| Accounts used | Not run | Not run |
| Team roles used | Not run | Not run |
| Reviewer | Not run | Owner |

## A. Policy and Entry

| ID | Procedure | Expected | Class | Result/evidence |
|---|---|---|---|---|
| A01 | Exercise internal/opt-in, development/production, and preference off/on policy combinations | New Event creation follows the centralized stage and device preference; existing access is always true | Automated | `sportAvailability.test.ts` |
| A02 | With preference off, inspect Sport Select, Sport Dashboard, Settings App/Sports, and Basketball Tracker settings | Basketball whole-sport navigation remains available when enabled; new Event choice is unavailable while Legacy remains usable | E2 hardening | Pass for owner New Game path; Legacy remained available and Event followed the device preference. Other navigation surfaces remain broader matrix coverage. |
| A03 | Enable the preference and enter setup from Sport Dashboard, Team Info, and a direct team/sport URL | Entry is mutation-free; setup owns authority choice and Continue owns the guarded commit | E3 owner smoke | Pass for owner Sport Dashboard path; local-only Event setup committed only after explicit choices. Team Info/direct-link variants remain broader matrix coverage. |
| A04 | Cancel setup and capability recovery from each entry with another active game | Active id, parked ids, state, dirty flags, and setup draft follow their documented no-mutation behavior | E3 owner smoke | Pass for the owner running-game replacement cancellation path; Cancel preserved the active game and running clock. Other entries remain broader matrix coverage. |
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
| C01 | Create a local-only rules-v3/setup-v2 game with five starters | Period 1 opens paused at canonical elapsed zero with immutable rules/setup and no cloud binding; display follows configured count direction | E3 owner smoke | Pass; owner confirmed paused opening, correct configured count-down duration/direction, and no setup error or cloud binding. |
| C02 | Start, pause with/without stoppage, Set Clock, expire, end period, and open the next period | Canonical elapsed time remains monotonic and periods open paused; expiration creates one authoritative Pause | E3 owner smoke | Pass for Start/Pause/Set Clock and configured count-down continuation; expiration and period boundary pending. |
| C03 | Record shots, free throws, fouls, timeouts, turnovers, substitutions, roles, and late participants | One canonical command time and checked event transitions preserve projection | E3 owner smoke | Pass for owner shot, turnover, foul/free-throw trip, timeout, paused substitution, and role path; late participant remains broader matrix coverage. |
| C04 | Exercise changed-five and equal-play-off/advisory/enforced boundaries | Review and reasoned override rules match the immutable profile and current lineup | E3 owner smoke | Blocked; completed Summary reported `Tracked lineup requires boundary review`. It is not yet known whether a required review was skipped or failed to persist; [issue #353](https://github.com/Rothermal/cursor-default/issues/353). |
| C05 | Correct clock, lineup, gameplay, and administrative events through Timeline | Consequence preview, stale rejection, grouped remove/restore, and full reprojection stay coherent | E3 owner smoke | Pass for owner made-shot remove/restore and score reprojection; exhaustive event-family correction remains automated/broader coverage. |
| C06 | Park or replace while the clock is running | Confirmed workflow appends Pause before storage mutation; Cancel changes nothing | E3 owner smoke | Pass for clock safety: Cancel changed nothing and Accept paused/parked durably. The new replacement slot then lost setup continuity; [issue #352](https://github.com/Rothermal/cursor-default/issues/352). |

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
| G03 | Install the PWA, deploy a release-stage rollback, and keep one stale client open/offline | Stale client remains on the old bundle until the prompt is accepted or all scoped clients close and the waiting worker activates; operator guidance and displayed build make this visible | E2 hardening | Runbook prepared; exact deployed rehearsal pending |
| G04 | Switch anonymous/account A/account B with parked and bound games | Local and cloud ownership, capability cache, drafts, and recovery state remain isolated | Broader gate | Not run |
| G05 | Exercise duplicate binding, stale sync completion, quota, cap, and recovery export | No authority is overwritten or falsely marked clean; recovery remains available | E2 hardening | Not run |

## H. Responsive, Accessibility, and Alerts

| ID | Procedure | Expected | Class | Result/evidence |
|---|---|---|---|---|
| H01 | Run setup, opening lineup, tracker, sheets, Timeline, Summary, and settings at `320 x 568` | Primary controls remain reachable with no blocking overlap or clipping | E2 hardening | Compact clock contract implemented; exact browser row pending |
| H02 | Repeat the live path in an installed PWA at `390 x 844` | Safe areas/browser chrome do not hide clock, lineup, correction, or parking controls | E2 hardening | Safe-area contracts implemented; installed-PWA row pending |
| H03 | Review the same surfaces at `768 x 1024` and `1440 x 900` | Stable layout remains scan-friendly without stretched or shifting controls | E2 hardening | Procedure prepared; exact browser row pending |
| H04 | Navigate tabs, dialogs, sheets, clock, correction, and recovery by keyboard | Focus is visible/logical, dialogs restore focus, and no primary workflow traps | E2 hardening | Visible-focus and critical modal contracts implemented; exact keyboard row pending |
| H05 | Trigger expiration, offline, conflict, save, error, and completion states | Status is announced without duplication or sensitive detail; reduced motion and unavailable sound/vibration degrade safely | E2 hardening | Status, reduced-motion, and unavailable-device contracts implemented; live announcement row pending |

## I. Operations, Rollback, and Sign-off

| ID | Procedure | Expected | Class | Result/evidence |
|---|---|---|---|---|
| I01 | Inspect the running app after deployment | A concise displayed build/commit identifier matches the exact candidate | E2 hardening | Pass; owner confirmed displayed `cc0a41237dd8` matches deployed merge commit `cc0a41237dd8d46478069aa7afeaa45fd50f7f10` |
| I02 | Confirm migrations and call both capability handshakes | Highest migration is 064; release contract v2 and clock/lineup version 1 are exact | E3 owner smoke | Not run |
| I03 | Disable the device preference | New Event creation stops immediately on that device; existing Event and Legacy records remain available | E3 owner smoke | Not run |
| I04 | Change the client stage to `internal`, build, deploy, then accept the online PWA update prompt or close every scoped client and reopen after activation | Displayed build changes and new Event creation stops after activation; refresh alone is not sufficient, and no server objects or existing records are changed | E2 hardening | Repeatable rollback procedure prepared; deployed rehearsal pending |
| I05 | Repeat I04 with an offline/stale PWA, including **Later** or prompt dismissal | Old policy persists visibly for that session until the waiting rollback bundle activates; no claim of immediate remote shutdown is made | E2 hardening | Stale-build guidance implemented; deployed rehearsal pending |
| I06 | Run lint, full tests, production build, and CI on the exact candidate | All automated gates pass; existing warnings are recorded separately | Automated | BKE-6E2 local typecheck/lint/1,291 tests/build pass; updated PR CI is the exact-candidate gate |

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
| BKE-6E1 automated release audit | Accepted in PR #350 | 2026-08-31 | Consumer allowlist, matrix, and CI |
| BKE-6E2 release-surface hardening | Pending PR review | Pending | Runtime contracts implemented; exact browser/PWA/rollback evidence remains pending |
| BKE-6E3 owner-only exact-candidate smoke | Pending | Pending | Local/cloud smoke and deployed identifier |
| Broader rollout | Blocked | Pending | D03, D05-D07, and G03-G04 must pass |
