# Plan: BKE-5D Basketball Event Release and Exit

Status: Product and delivery Q&A approved. Implementation remains split into BKE-5D1 policy and
hardening, followed by BKE-5D2 production activation and owner signoff.

Parent: [PLAN_BKE_5_SETTINGS_AND_EVENT_ROLLOUT.md](PLAN_BKE_5_SETTINGS_AND_EVENT_ROLLOUT.md)

## 1. Goal

Release the new Basketball Event tracker as a deliberate, device-local, default-off production
preview without changing Legacy Basketball defaults or reducing access to any existing Event game.

BKE-5D uses two reviewable delivery slices:

```text
BKE-5D1 centralized policy, preference, guards, and regression record
  -> BKE-5D2 production opt-in activation, owner smoke pass, and rollback signoff
```

The initial rollout is owner-only in practice because the owner is currently the only user. The
focused owner smoke pass may happen after deployment. The complete role/device/PWA/local/cloud
matrix remains required before access materially broadens or production Basketball history depends
on the Event tracker.

No Supabase migration is expected. Migration 062 remains the required Basketball settings and
release-capability ceiling unless implementation finds a concrete server-side release blocker.

## 2. Approved Decisions

The BKE-5D Q&A approved the recommended option for all sixteen decisions:

1. use an owner-only, default-off initial rollout with post-deployment validation;
2. separate hardening from production activation;
3. keep Legacy as the default authority for every new setup;
4. rollback blocks only new Event creation and never disables existing Event games;
5. require the device preference in development preview and released production;
6. place the preference under Settings -> Sports -> Basketball;
7. keep the preference device-local and independent of account identity;
8. retain signed-out, offline, and capability-failure Event local-only creation;
9. preserve full existing Event-game access when release or preference is off;
10. preserve an Event setup draft but block Event commit until re-enabled or deliberately changed;
11. keep unavailable direct setup links usable for Legacy without mutating active/parked state;
12. treat malformed stored preference values as disabled;
13. use one source-controlled `internal | opt_in` policy instead of a remote flag service;
14. show the preference disabled while an internal production build cannot create Event games;
15. use `New event tracker (preview)` user-facing terminology while retaining stable internal
    `legacy` / `sport_events` authority values;
16. require a focused post-deployment owner smoke pass and retain the full matrix as the
    broader-release backlog.

For this initial owner-only exception, this plan supersedes older BKE-4 wording that described
every pending live-matrix row as a pre-opt-in hard gate. Those rows are not waived or marked passed;
they remain mandatory before the rollout broadens.

## 3. Release Invariants

- Basketball remains generally enabled through `enabledSports.basketball`; that existing setting is
  independent from Event rollout.
- The Event preference defaults to false and must be an exact stored boolean. Malformed legacy JSON
  fails closed without changing unrelated settings.
- Legacy is available whenever ordinary Basketball creation is available and remains selected by
  default even when Event preview is enabled.
- Release policy and preference gate only **new Event-game creation**.
- Existing local, parked, imported, recovery, and cloud Event records remain reachable regardless
  of release policy or preference.
- Sync, conflict recovery, Summary, Game Info, Timeline correction, finalization, reopen, canonical
  publication, and aggregate review never consult the creation gate.
- Turning the preference off or rolling policy back cannot rewrite a setup draft or game, clear a
  binding, stop an existing queue entry, or convert Event authority to Legacy.
- An Event draft may remain stored while unavailable, but commit must fail before local game
  creation or active/parked replacement.
- Local-only Event creation stays available when the user deliberately opts in but is signed out,
  offline, Supabase-unconfigured, or unable to complete cloud capability preflight.
- Event and Legacy paths never dual-write.
- Feature components do not make independent production/development release decisions.

## 4. Central Policy Model

### 4.1 Stages

`src/lib/sportAvailability.ts` owns a Basketball Event stage with exactly two values:

- `internal`: development preview may create Event games when the device preference is on;
  production cannot create them.
- `opt_in`: development and production may create Event games when the device preference is on.

BKE-5D1 introduces and tests the policy while leaving the production stage effectively internal.
BKE-5D2 changes only the centralized production stage to `opt_in` after BKE-5D1 merges.

The policy should expose a pure result rather than leaking environment checks to pages. At minimum,
callers need to distinguish:

- whether the preference control is available;
- whether the current build/device may create a new Event game; and
- the invariant that existing Event records remain accessible.

Tests must inject development and release-stage inputs rather than depend on the test runner's
environment.

### 4.2 Expected matrix

| Build stage | Device preference | New Legacy game | New Event game | Existing Event game |
|---|---:|---:|---:|---:|
| Internal development | Off | Allowed | Blocked | Allowed |
| Internal development | On | Allowed | Allowed | Allowed |
| Internal production | Off | Allowed | Blocked | Allowed |
| Internal production | On | Allowed | Blocked | Allowed |
| Opt-in development | Off | Allowed | Blocked | Allowed |
| Opt-in development | On | Allowed | Allowed | Allowed |
| Opt-in production | Off | Allowed | Blocked | Allowed |
| Opt-in production | On | Allowed | Allowed | Allowed |

General Basketball discovery still follows `enabledSports.basketball`. If general Basketball is
disabled, the sport remains undiscoverable for new work while existing-game access follows the
existing navigation contract.

## 5. Device Preference

Add one exact boolean to the local `statkeeper_settings` contract. Use a Basketball-specific nested
field rather than overloading `enabledSports.basketball` or the Supabase-backed personal settings.
The final field name should clearly represent Event preview creation, for example:

```ts
basketball: {
  eventTrackerPreviewEnabled: boolean
}
```

Requirements:

- default false for new and existing devices;
- strict boolean parsing on load;
- device-local persistence across sign-in/sign-out and account changes;
- merge old settings without losing `enabledSports`, court capture, or future-sport values;
- no migration into `user_sport_settings`;
- no automatic enablement based on an existing Event game or setup draft;
- disabling affects only later Event commits.

`SettingsContext` remains the single runtime owner. It should expose a narrow getter/setter or
explicit preference fields rather than letting pages write localStorage directly.

## 6. User Experience

### 6.1 Basketball settings

Add a compact Tracker or Preview tab under Settings -> Sports -> Basketball. Keep it separate from
the cloud-synced Rules/Capture/Display draft so saving rule settings cannot enable rollout and
changing rollout cannot produce a settings CAS write.

- Label the switch `New event tracker (preview)`.
- In internal production, render it disabled with unavailable-build status.
- In development preview and opt-in production, make it interactive and default off.
- Use the existing device-settings persistence/error behavior.
- Keep the tab usable at narrow mobile widths and in the existing keyboard tab order.

### 6.2 Game setup

When creation is available, expose the two authority choices using user-facing labels such as
`Classic tracker` and `New tracker`, while retaining `legacy` and `sport_events` internally.
Classic remains selected on every fresh setup; do not remember the previous authority choice.

When Event creation is unavailable:

- fresh Basketball setup remains fully usable in Classic mode;
- an existing Event draft remains stored but cannot commit;
- setup explains that the device preference must be enabled, or that the build is internal;
- the user may re-enable preview or deliberately choose Classic;
- no automatic authority conversion occurs;
- no active or parked game changes before a valid commit.

The setup commit boundary must recheck the policy. Hiding or disabling the segmented control is not
sufficient because a stale tab, restored draft, imported storage value, or direct helper call could
otherwise bypass the UI gate.

### 6.3 Local and cloud choices

After Event creation is allowed, BKE-5C remains authoritative:

- cloud-capable Personal/team setup performs the exact migration-062 capability preflight;
- cloud failures retain Retry, Classic cloud, Event local-only, and Cancel choices where valid;
- signed-out/offline/unconfigured setup may deliberately create Event local-only;
- later Enable Cloud Sync keeps its fresh ownership/access/role/capability transaction;
- release policy is not a substitute for authorization or backend capability.

## 7. Existing-Record Boundary

Audit every Event-aware route and helper to prove the new gate is creation-only. It must not gate:

- active or parked Tracker and terminal Summary routing;
- import/export and recovery-state restoration;
- the dirty sync queue or conflict resolution;
- Cloud Games, Game Info, recorder inspection, primary selection, or publication history;
- local Timeline correction and matching owned-binding handoff;
- finalization, reopen, checkpoint, or late-audit upload;
- canonical Summary and mixed canonical/Legacy aggregates;
- team, player, season, tournament, profile, or career history.

Static release-entry tests should pin the allowlist of direct environment checks and fail if a new
page adds its own Event creation decision.

## 8. Delivery Slices

### BKE-5D1: Policy, preference, and release hardening

- Add the centralized `internal | opt_in` Basketball Event policy with production left internal.
- Add strict default-off device preference storage and `SettingsContext` ownership.
- Add the Basketball settings rollout tab and unavailable-build state.
- Route Game Setup authority visibility and the final commit guard through the central policy.
- Preserve stored Event drafts without silently converting them.
- Replace the internal-preview copy with approved user-facing terminology.
- Audit entry points so existing records never consult the new creation policy.
- Add availability, storage, settings, setup, stale-draft, local-only, historical-access, and
  cross-sport tests.
- Create `docs/REGRESSION_BKE_5_SETTINGS_AND_ROLLOUT.md` with consolidated automated evidence, the
  focused owner smoke pass, the broader-release matrix, exact migration ceiling, and rollback steps.
- Update roadmap, README, AGENTS, and codebase overview while retaining the internal production
  stage.

Primary boundaries:

- `src/lib/sportAvailability.ts`
- `src/lib/settingsStorage.ts`
- `src/context/SettingsContext.tsx`
- `src/components/settings/BasketballSettings.tsx`
- `src/pages/GameSetup.tsx`
- Basketball setup draft/commit helpers and focused tests
- `docs/REGRESSION_BKE_5_SETTINGS_AND_ROLLOUT.md`

Exit: development can exercise the exact default-off preference path, internal production cannot
create Event games even with stored true, Classic creation remains unchanged, and every existing
Event record remains reachable.

### BKE-5D2: Production activation and owner signoff

- Start from merged BKE-5D1 and re-run the complete automated suite.
- Flip only the centralized production policy from `internal` to `opt_in`.
- Update policy tests to prove released production still requires the default-off device preference.
- Build the exact release candidate and record commit, CI, build, migration ceiling, and deployment.
- Record owner approval for the initial single-user rollout with post-deployment validation.
- Run the focused owner smoke pass after deployment and file/disposition any failure.
- Keep the complete matrix pending as an explicit gate before materially broader access.
- Document one-step rollback to `internal`; do not reverse migration 062 or hide existing games.

Exit: production defaults to Classic-only creation, a deliberate device opt-in exposes the New
tracker, rollback disables only new Event creation, and the owner smoke record has a clear status.

## 9. Automated Verification

BKE-5D1 should add focused coverage for:

- every stage/development/preference row in the policy matrix;
- unchanged non-Event Basketball and non-Basketball availability;
- default, saved true/false, malformed, partial, and legacy settings JSON;
- sign-in/account changes preserving one device-local preference;
- settings control availability, keyboard tab behavior, and independent save boundaries;
- fresh setup defaulting to Classic even after a prior Event game;
- unavailable Event draft preservation and fail-before-mutation commit rejection;
- preference changes between setup render and final commit;
- internal production with malicious/stale stored true remaining blocked;
- signed-out/offline/unconfigured Event local-only creation when opted in;
- capability failure choices after opt-in;
- existing active/parked/imported/cloud Event route and sync accessibility with preference off;
- Legacy aggregate and Soccer event behavior remaining unchanged;
- direct environment-check allowlist and no creation gate in historical paths.

Required release commands on the exact candidate:

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
git diff --check
```

No migration is expected. The operator record must confirm migration 062 has already been applied.

## 10. Focused Owner Smoke Pass

The initial owner-only release may merge and deploy before this pass is complete. Run it promptly
after deployment and record `Pass`, `Fail`, `Blocked`, or `Not run` with concise evidence:

1. On a clean/default device, verify Basketball remains enabled but New tracker creation is absent;
   Classic setup still works.
2. Enable `New event tracker (preview)`, begin a fresh setup, and verify Classic is still selected.
3. Create a Personal Event local-only game, record/correct events, park, reload, resume, and open
   Summary.
4. Enable cloud sync for that owned local-only game and verify one binding, one recorder stream,
   exact events, and a current checkpoint.
5. Create a cloud-team Event game as an allowed role; sync, inspect Game Info/Summary, finalize,
   reopen, correct, and republish as time permits.
6. Park the Event game alongside Legacy Basketball and Soccer; resume each and verify the correct
   tracker, transport, and history authority.
7. Turn the preference off and verify existing Event local/cloud games still resume, sync, review,
   and finalize while new setup offers only Classic.
8. Re-enable and verify a new setup again defaults to Classic rather than remembering Event.
9. Install or refresh the PWA and verify the same preference and existing-game behavior survives
   close/reopen.
10. If rollback is exercised, deploy `internal` with stored true and verify only new Event creation
    stops.

The full BKE-4/BKE-5 role, two-device, recorder conflict, offline recovery, PWA, responsive,
accessibility, finalization, canonical aggregate, and multi-sport matrix remains in the consolidated
regression document. It is not silently marked complete by this focused pass.

## 11. Rollback

Rollback is a source-controlled policy change from `opt_in` to `internal` followed by the normal CI
and deployment process.

- Do not delete or rewrite the device preference; it is ignored for production Event creation while
  internal and becomes effective again only after a later approved opt-in deployment.
- Do not reverse migrations 050-062.
- Do not disable Event sync, recovery, Summary, finalization, reopen, or aggregates.
- Do not convert Event games or drafts to Legacy.
- Installed PWAs may require refresh or close/reopen to receive the rollback build; document this in
  the operator record.
- Correctness, authorization, cross-account/cross-sport leakage, data loss, unrecoverable conflict,
  or canonical-authority failures require rollback evaluation. Non-blocking visual polish remains an
  iteration item.

## 12. Out of Scope

- Basketball clock, stoppages, substitutions, lineups, and on-court intervals: BKE-6
- remote feature flags, organization allowlists, or account-scoped rollout preferences
- making Event the default authority or remembering the last authority choice
- disabling cloud after a successful binding or creating local forks
- changing profile/rule schemas, migration 062, or capability contract v2
- new event families, stat definitions, Summary tabs, or aggregate metrics
- application-wide visual reskin

## 13. Completion Rule

BKE-5 is complete when BKE-5D1 and BKE-5D2 merge, the production policy is reversible, migration
062 is confirmed, the focused owner smoke pass has a recorded disposition, and no owner-rollout
blocker remains. The complete live matrix stays open until it is actually run and remains mandatory
before the Event tracker is offered beyond the initial owner-only rollout.
