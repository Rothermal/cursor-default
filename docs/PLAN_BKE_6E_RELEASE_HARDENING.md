# Plan: BKE-6E Release Hardening and Sign-off

Status: Approved carry-forward scope. BKE-6A through BKE-6D are implemented through migration
064. BKE-6E1 is the next implementation slice.

Parent: [PLAN_BKE_6_CLOCK_AND_LINEUPS.md](PLAN_BKE_6_CLOCK_AND_LINEUPS.md)

Predecessor: [PLAN_BKE_6D_CLOUD_SUMMARY_AND_AGGREGATES.md](PLAN_BKE_6D_CLOUD_SUMMARY_AND_AGGREGATES.md)

---

## 1. Goal

Finish the default-off Basketball anchored-clock and lineup release with one auditable entry
contract, focused responsive/accessibility/PWA hardening, an explicit rollback record, and honest
owner smoke evidence. This phase consolidates and proves the BKE-4 through BKE-6 release boundary;
it does not add gameplay features or broaden access.

---

## 2. Fixed Release Decisions

The following decisions are inherited and are not reopened by BKE-6E:

1. Production remains at the centralized `opt_in` Basketball Event release stage.
2. The device preference remains default-off. New Event creation still requires a fresh explicit
   setup choice and all existing policy, authority, capability, and commit guards.
3. Existing local, parked, imported, cloud-bound, finalized, reopened, and canonical Event games
   remain reachable when the device preference is off. Release policy gates discovery and new
   creation, not historical access or recovery.
4. "Owner-only" describes the initial operating rollout. BKE-6E does not add a user-id allowlist,
   special owner bypass, or new app/team role. Existing app access, team roles, recorder authority,
   and RLS remain authoritative.
5. Migration 064 is the expected release ceiling. BKE-6E adds no migration unless the audit finds
   a concrete server-contract defect that cannot be fixed safely in the client.
6. Cloud-backed Event setup and binding continue to require the exact existing Basketball release
   capability and clock/lineup capability handshakes. Their shapes are not widened.
7. Local-only anchored games remain available without a server capability. Enabling cloud later
   retains its fresh dual-capability and checkpoint-first transaction.
8. Post-deployment owner smoke is acceptable for this default-off, single-user rollout. The full
   role, multi-device, offline, PWA, mixed-sport, correction, finalization, and aggregate matrix is
   still required before access materially broadens.
9. Release-blocking defects found by the audit are fixed in this phase. Nonblocking visual polish
   is recorded for later work rather than expanding BKE-6E into a reskin.
10. Cloud-bound team games deliberately require online source-team role resolution for authorized
    equal-play overrides. Recorders who require offline live capture must choose local-only before
    play. This limitation is accepted for the default-off owner rollout, must be explicit in the
    matrix, and must be reconsidered before access broadens.

---

## 3. Compatibility Invariants

- Legacy Basketball games remain aggregate-authority games and never gain Event setup, anchored
  events, or event-cloud writes.
- Existing rules versions 1 and 2 and setup version 1 remain clockless with their established
  manual-minute semantics.
- Existing clockless Event games retain their current capture, sync, correction, Summary,
  aggregate, finalization, and reopen behavior.
- Rules version 3 with setup version 2 is the only anchored authority. Unknown anchored events,
  malformed setup, unsupported capability shapes, and authority collisions fail closed.
- No historical game is auto-converted, backfilled, or rewritten for release entry.
- Soccer release, transport, parking, Summary, aggregates, settings, and finalization remain
  unchanged. A Basketball release failure cannot consume or mutate Soccer state.
- Each recorder remains one coherent stream. Review, conflict handling, primary selection,
  canonical publication, and aggregates never blend recorder histories.
- Release evidence must not contain invite tokens, access tokens, private emails, raw event
  payloads, or other account-identifying data.

---

## 4. Current Baseline and Remaining Gaps

Already implemented:

- centralized default-off production opt-in and existing-record access policy;
- exact Basketball release and clock/lineup capability handshakes;
- versioned rules/setup, local-only and later cloud binding, anchored clock, lineups,
  substitutions, equal-play, correction, Summary, aggregates, cloud transport, finalization,
  reopen, and republication;
- migration 064 trusted anchored finalization/reopen enforcement; and
- slice-specific automated regression records through BKE-6D4.

Still required:

- one release-entry inventory proving every new-game path uses the centralized policy and exact
  setup authority;
- a consolidated operator matrix that links existing automation and clearly marks manual rows;
- explicit older-client, clockless, Legacy Basketball, Soccer, and mixed-sport parity evidence;
- focused small-screen, keyboard, screen-reader announcement, reduced-motion, installed-PWA,
  offline/reload, and device-alert checks;
- a rehearsable rollback procedure that stops new Event creation without stranding existing
  records; and
- owner smoke against the exact deployed candidate, with broader-matrix disposition recorded
  separately from owner-only release acceptance.

---

## 5. Delivery Slices

### BKE-6E1: Release Audit and Consolidated Matrix

Scope:

- inventory every Basketball discovery, preference, and new-game entry path, including Sport
  Select, Sport Dashboard, Settings App/Sports discovery, Basketball Tracker settings, Team Info,
  direct setup links, replacement/continue flows, matching draft resume, and cloud enablement;
- prove creation policy, device preference, setup authority, capability preflight, account/team
  access, no-mutation cancellation, and exact matching pre-start reuse at those boundaries;
- add focused automated parity for Legacy Basketball, clockless Event Basketball, existing Event
  records with the preference off, Soccer, and mixed-sport parking;
- verify that both exact capability parsers, caches, fresh mutation checks, and migration-064
  finalization/reopen contracts fail closed without blocking local-only play;
- preserve the existing `releaseEntryGuards.test.ts` declaration guard and
  `sportAvailability.test.ts` stage-derived policy coverage rather than adding a duplicate stage
  test;
- create `REGRESSION_BKE_6E_RELEASE.md` as the single operator record, linking rather than copying
  the exhaustive BKE-4E, BKE-5, and BKE-6 slice matrices; and
- update release and rollback guidance without changing the production stage.

Exit condition:

- the release-entry inventory has automated contract coverage or an explicit manual row;
- compatibility tests pass for old and adjacent authorities;
- the consolidated matrix distinguishes automated, owner-smoke, and broader-rollout evidence; and
- no release-stage, permission, migration, or product-behavior change is hidden in the audit.

### BKE-6E2: Release-Surface Hardening and Rollback Rehearsal

Scope:

- exercise the setup, opening-lineup, live clock, substitution, Timeline, Summary, Game Info, and
  settings surfaces at narrow phone, common phone PWA, tablet, and desktop sizes;
- correct release-blocking overlap, clipping, focus loss, inaccessible naming, dialog focus,
  keyboard traversal, status announcement, reduced-motion, and unavailable sound/vibration
  behavior;
- test installed-PWA and browser reload/background recovery, offline local capture, reconnect,
  stale service-worker guidance, wall-clock movement warnings, and expiration alerts;
- surface a concise build or commit identifier that lets an operator verify the exact deployed
  candidate from the running app without exposing account or environment secrets;
- exercise multi-game parking, import/export, account isolation, Soccer plus Basketball parking,
  and running-clock mutation confirmations;
- rehearse the preference-off and client release-stage rollback paths while proving existing
  records stay accessible, including a stale installed PWA that has not yet loaded the rollback
  bundle; and
- record nonblocking visual refinements separately rather than broadening this slice.

Recommended viewport set:

- `320 x 568` compact phone stress case;
- `390 x 844` common installed-PWA phone case;
- `768 x 1024` tablet case; and
- `1440 x 900` desktop case.

Exit condition:

- no supported viewport blocks primary clock, lineup, correction, recovery, or finalization work;
- keyboard and announcement checks have an explicit disposition;
- offline/PWA recovery and rollback have repeatable operator steps; and
- any deferred issue is documented as nonblocking with a reason.

### BKE-6E3: Exact-Candidate Owner Smoke and BKE-6 Sign-off

Scope:

- deploy the exact merged candidate, record the commit/deployment identifier, and confirm the
  running app displays that same identifier before smoke begins;
- confirm migration 064 and both fixed capability handshakes in the deployed Supabase project;
- run one local-only anchored game through rules review, opening lineup, clock, stoppage,
  substitution, boundary/equal-play handling, correction, Summary, and completion;
- run one cloud-backed anchored game through bind/sync/checkpoint, recorder review, finalization,
  canonical Summary/aggregates, Correct records, Resume game, and explicit republication as data
  and available roles permit;
- confirm one Legacy or clockless Basketball record and one existing Soccer record still open and
  retain their established authority;
- repeat release-sensitive phone/PWA, offline/reload, parking, and account-isolation rows; and
- record every row as `Pass`, `Fail`, `Blocked`, or `Not run`, with owner-only acceptance kept
  distinct from broader-rollout readiness.

Exit condition:

- all owner-smoke release blockers pass or are fixed and repeated against a new exact candidate;
- any unavailable team, role, or second-device scenario is marked honestly rather than inferred;
- the default-off owner-only rollout has an explicit accepted disposition; and
- BKE-6 is marked complete only while the unexecuted broader matrix remains a documented gate to
  wider enablement.

---

## 6. Consolidated Release Matrix

`REGRESSION_BKE_6E_RELEASE.md` will organize evidence into these groups:

| Group | Required coverage |
|---|---|
| A. Policy and entry | Development and production policy, preference off/on, Sport Select, Sport Dashboard, Settings App/Sports, Basketball Tracker settings, every setup entry, direct links, cancellation, matching pre-start reuse, existing-record access |
| B. Access and capability | App access, team roles, account/team isolation, exact release and clock capability shapes, local-only fallback, migration 064 ceiling |
| C. Local authority | Rules/source review, opening lineup, clock lifecycle, substitutions, equal play, corrections, periods/overtime, completion, recovery |
| D. Cloud lifecycle | Bind, running upload, adoption, conflicts, recorder presence, primary, checkpoint, finalization, Correct records, Resume game, republication |
| E. Review and aggregates | Local/remote/canonical Summary, Timeline, shot review, exact participation, DNP, plus-minus quality, destination routing, provenance |
| F. Compatibility | Legacy Basketball, clockless Event Basketball, older setup/rules, malformed/unknown authority, Soccer, mixed-sport parking |
| G. Recovery and PWA | Local-only offline capture, cloud-bound online-role limitation, reconnect, reload/background, stale-PWA rollback propagation, import/export, quota/recovery state, account switch, duplicate binding |
| H. Responsive and accessibility | Four viewports, keyboard, focus, dialog semantics, status alerts, reduced motion, sound/vibration unavailable behavior |
| I. Operations | Running-app build identifier, exact candidate, migrations/capabilities, CI, owner smoke, broader-matrix status, rollback rehearsal, evidence hygiene |

Automation supports release confidence but does not substitute for the rows that require a real
browser, installed PWA, Supabase project, second account, or second device.

---

## 7. Rollback Contract

### Immediate user rollback

Disable the Basketball Event Tracker device preference. This stops new Event discovery/creation on
that device while preserving access to every existing Event game and all historical review.

### Release and deployment rollback

Change the centralized Basketball Event release stage from `opt_in` to `internal` and redeploy.
This blocks new production Event creation without deleting, converting, or hiding existing games.
It is a client build-time change, not a separate server switch: stopping creation is eventually
consistent with deployment propagation. A device that remains offline or keeps a stale installed
PWA open can continue using the old creation policy until it loads the rollback bundle. The only
immediate control is the user's per-device preference; it is not a remote operator control.

There is intentionally no server-side feature flag fallback. The capability RPCs prove schema
availability; revoking their grants or dropping required objects would also break existing
cloud-bound records. BKE-6E2 must rehearse a stale-client rollback and surface a build identifier so
the operator can confirm that the new bundle is active. Preserve the existing declaration and
stage-derived policy tests that keep the stage change deployable; do not add a third overlapping
guard.

For any other client-only blocker, redeploy the previous known-good client. The operator must record
its build identifier, bring the device online, close all installed app windows, reopen the app, and
confirm that displayed identifier before continuing an active game.

### Data and server rules

- Do not reverse migrations 061 through 064 merely to disable creation; they are additive release,
  settings, clock/lineup, and trusted-boundary contracts used by current runtime behavior and
  existing records.
- Do not delete or rewrite event streams as rollback.
- Export local recovery data before destructive troubleshooting.
- A server-contract defect requires a new forward migration and a repeated exact-candidate smoke
  pass; editing an already-applied migration is not a release procedure.

---

## 8. Go/No-Go Rules

Release blockers include:

- authentication, app-access, RLS, account-isolation, or team-role bypass;
- data loss, duplicate bindings, authority blending, failed recovery, or silent sync success;
- incorrect clock, lineup, score, publication, aggregate, or correction authority;
- inability to stop new creation without losing existing-record access;
- a supported phone/PWA layout that prevents recording, pausing, correcting, parking, or recovery;
  or
- a keyboard/focus failure that prevents a primary workflow.

The owner-only default-off rollout may proceed after the exact-candidate owner smoke is accepted,
even if clearly identified broader-role or second-device rows remain `Not run`. Wider discovery,
default-on behavior, or promotion beyond the initial operating rollout requires the complete
broader matrix to pass or receive an explicit, documented risk acceptance.

At minimum, broader rollout remains blocked until these live rows pass:

- a second account proves owner/admin/scorer equal-play override access and viewer/removed-member
  denial after a fresh role resolution;
- a second device proves strict same-recorder adoption, conflict/checkpoint handling, primary
  selection, finalization, and reopen/republication without blending streams; and
- installed-PWA offline/reconnect and stale-bundle rollback behavior passes alongside mixed-sport
  parking and existing-record access. Cloud-bound equal-play override while offline retains the
  accepted online-role limitation unless a later plan deliberately changes it.

---

## 9. Non-Goals

BKE-6E does not add:

- new stats, events, rules profiles, clock models, shot-clock, possession, or collaboration;
- a UI reskin or unrelated navigation redesign;
- a hidden owner bypass, account allowlist, or new role;
- automatic conversion of Legacy or clockless games;
- migration rollback or historical data rewriting;
- automatic publication/republication; or
- wider release defaults.

---

## 10. Documentation and Completion

Each slice updates this plan, the parent BKE-6 plan, Basketball roadmap, README checklist, codebase
overview, regression index, and its consolidated release matrix. Runtime behavior changes also
update AGENTS.md when they alter an operator or agent contract.

BKE-6E is complete only after BKE-6E1 through BKE-6E3 merge, automated gates pass, migration and
capability state are recorded, the exact-candidate owner smoke has an accepted disposition, the
rollback path is rehearsed, and remaining broader-rollout rows are visible as a gate rather than
silently treated as passed.
