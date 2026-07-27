# SOC-6E Soccer Release Hardening and Enablement

Status: planned; focused Q&A complete.

## 1. Goal

Release Soccer as an opt-in production sport without weakening historical access, cloud
authorization, recovery behavior, or another sport's workflows.

SOC-6E uses three reviewable delivery slices:

```text
SOC-6E1 availability policy and cloud capability preflight
  -> SOC-6E2 release hardening and complete regression evidence
  -> SOC-6E3 production enablement, sign-off, and documentation
```

Soccer remains disabled by default. Enabling it uses the existing device-local
`statkeeper_settings.enabledSports.soccer` preference. This phase does not add event families,
statistics, standings, collaborative editing, or the application-wide visual reskin.

## 2. Approved Decisions

The focused Q&A approved the recommended option for all eight release decisions:

- keep Soccer enablement device-local in existing App Settings;
- hide disabled Soccer from discovery and new-game entry while preserving existing and historical
  access;
- block unsupported cloud creation with an actionable backend message and deliberate local path;
- make opt-in Soccer available to every user after release sign-off, without an allowlist;
- deliver SOC-6E in three PRs;
- remove the development release gate only in SOC-6E3;
- reuse existing status, error, and client-sync diagnostics rather than adding telemetry;
- fix release-blocking correctness, access, recovery, and layout issues while documenting
  non-blocking polish for later.

## 3. Current Release Gaps

The implemented Soccer product is still held behind several development-only checks:

- `isSportWorkspaceAvailable` returns true for Soccer only in development and ignores its stored
  toggle.
- `App.tsx` redirects Soccer setup, roster, tracker, summary, and legacy review routes in
  production.
- App Settings disables the Soccer switch and labels it Preview or Coming soon.
- Cloud Games and Game Info reject Soccer review in production.
- Cloud-team setup does not verify the complete Soccer backend contract before it may park the
  active game and enter the new flow.
- Release coverage is distributed across phase-specific matrices rather than one final operator
  matrix and sign-off record.

Production access must distinguish three different questions instead of using one broad gate:

1. Is the sport released by this build?
2. Has this device enabled new Soccer discovery and creation?
3. Is the user opening an already existing local or cloud Soccer record?

## 4. Availability and Historical Access Contract

### 4.1 New-game discovery

After SOC-6E3, Soccer appears in normal production discovery only when:

- the build marks the Soccer workspace as released; and
- `enabledSports.soccer` is true on the current device.

The preference stays device-local across sign-in and sign-out and defaults to false. App Settings
always exposes the Soccer switch and Soccer-specific settings route. Development builds retain an
explicit preview path until SOC-6E3 so release work can be tested before the production switch.

When Soccer is disabled:

- Sport Select omits Soccer as a new workspace.
- Team and dashboard Start Game actions do not create a new Soccer game.
- Direct new-game deep links show an enable prompt instead of mutating game state.
- A direct Soccer dashboard may show existing active/parked games, but its New Game action is
  unavailable.

### 4.2 Existing and historical access

Release or preference gates never become data-visibility gates. Subject to existing authentication,
app access, team role, RLS, and source-health rules, users may still:

- resume an active or parked local Soccer game;
- inspect Soccer teams, rosters, schedules, players, and seasons;
- open non-final cloud review and an owned recorder stream;
- open canonical final Summary, Team/Season/Tournament aggregates, Player Profile, and Career;
- reopen/finalize when their existing role permits it;
- export recovery data and resolve existing sync/conflict states.

Disabling Soccer cannot delete, rewrite, hide, or auto-finalize an existing record. Route helpers
must express discovery/new-game access separately from existing-record access. Historical routes
must not depend on `import.meta.env.DEV` or the device toggle.

## 5. Cloud Capability Contract

### 5.1 Backend handshake

SOC-6E1 adds migration `049_soccer_release_capabilities.sql` with a narrow authenticated RPC such
as `get_soccer_release_capabilities`.

The RPC:

- requires active app access and uses a fixed `search_path`;
- returns a versioned release contract, not table contents or user data;
- represents the required 043-049 Soccer transport, recovery, recorder, finalization, aggregate,
  and settings backend boundary;
- grants no write authority and does not replace the authorization checks in operational RPCs.

The client accepts only the exact supported contract version. Missing RPC/schema-cache errors map
to `backend_update_required`; malformed or unsupported responses fail closed. A successful result
may be cached only in memory for the current authenticated session. Sign-out, account change, or
explicit retry clears/rechecks it.

Migration 049 is a capability handshake only. It does not add product data, backfill records, or
change existing RLS.

### 5.2 Preflight timing and local fallback

Capability preflight is required before an authenticated cloud-team Soccer flow may park/replace
the active game or continue into a cloud-bound roster.

- Team deep links load team role, sport, and capabilities before `startNewGame`.
- A local Soccer setup checks capabilities when the user deliberately selects a cloud team and
  before Continue commits that source.
- Capability failure leaves the current active/parked game unchanged.
- The error identifies the backend update requirement and offers an explicit local-match path.
- Choosing local is a user action; it does not silently copy a cloud roster, claim future sync, or
  create a cloud binding.
- Supabase-unconfigured and offline users may continue local-only Soccer when the device has
  enabled it.

Operational RPC errors remain authoritative after preflight. Capability success never bypasses
normal CAS, RLS, team-role, finalization, or conflict checks.

## 6. Delivery Plan

### SOC-6E1: Availability policy and capability preflight

- Replace the broad availability helper with explicit released/discoverable/new-game and
  existing-record decisions.
- Keep the production release flag off while making the policy independently testable.
- Enable the Soccer switch in App Settings, keep it off by default, and remove Preview/Coming soon
  copy that conflates release stage with the user's preference.
- Preserve disabled-Soccer access to active, parked, team, game, summary, and aggregate
  destinations while blocking new-game entry.
- Add migration 049 and a typed capability parser/loader with backend-update classification.
- Preflight cloud-team deep links and cloud-source continuation before destructive local game
  transitions.
- Add an actionable local path that does not silently reuse cloud authority.
- Add pure tests for every release/preference/history combination, malformed capability responses,
  account changes, missing migration, and no-mutation-on-failure behavior.

Primary boundaries:

- `src/lib/sportAvailability.ts`
- `src/lib/soccer/releaseCapabilities.ts`
- `src/pages/Admin.tsx`
- `src/pages/GameSetup.tsx`
- `src/pages/SoccerGameSetup.tsx`
- team/dashboard new-game entry points
- `supabase/migrations/049_soccer_release_capabilities.sql`

Exit condition: production discovery remains off, but availability decisions and cloud preflight
are complete, fail closed, and cannot disturb an existing game on failure.

### SOC-6E2: Release hardening and regression evidence

- Consolidate all SOC-1 through SOC-6D automated/manual coverage into
  `docs/REGRESSION_SOC_6E_RELEASE.md`.
- Exercise mobile and desktop layouts, keyboard/focus behavior, local-only play, PWA/offline
  parking, reconnect, and recovery export.
- Exercise Basketball and Soccer active/parked games at the same time, including quota, import,
  account switch, and sync ownership boundaries.
- Exercise owner/admin/scorer/viewer access, independent recorders, primary conflicts,
  finalization/reopen, canonical and non-final summaries, field maps, aggregates, settings
  hierarchy, and migrations 043-049 failure states.
- Verify direct historical access while Soccer is disabled and every new-game entry remains
  blocked.
- Verify capability checks do not replace operational authorization or leak backend details.
- Fix only release-blocking correctness, authorization, recovery, accessibility, and responsive
  issues found by the matrix. Record non-blocking visual polish separately.
- Re-run Basketball setup, tracker, court capture, parking, cloud finalization, summary,
  corrections, player/team aggregates, and settings.

No new Soccer product behavior belongs in SOC-6E2. Any migration beyond 049 requires a concrete
release blocker and separate review.

Exit condition: CI passes, the automated matrix is complete, manual results are recorded against a
development/staging Supabase project through migration 049, and no unresolved release blocker
remains.

### SOC-6E3: Production enablement and sign-off

- Flip the explicit production release policy for Soccer.
- Remove remaining Soccer `import.meta.env.DEV` route/review guards while retaining dev-only tools
  such as the shot-chart preview.
- Route setup, players, tracker, summary, Cloud Games, and Game Info through normal authority and
  existing-record checks.
- Confirm Soccer remains off by default and is discoverable only after the device toggle is
  enabled.
- Run the final production build against the complete manual matrix, including a deployed
  GitHub Pages smoke test.
- Update README, agent documentation, migration instructions, SOC-0/SOC-6 status, and release
  rollback notes.

Go/no-go requires:

- all CI checks green;
- migration 049 applied in the target Supabase project;
- the complete manual release matrix signed off;
- no open correctness, access-control, data-loss, recovery, or incoherent mobile-layout blocker;
- Basketball and multi-game/multi-sport smoke paths green.

Rollback is a code/deployment release-policy reversal, not a data migration. It disables new
Soccer discovery while preserving all existing and historical Soccer access and data.

Exit condition: a production build exposes opt-in Soccer to every user, existing records remain
reachable when disabled, and the documented release/rollback checks pass.

## 7. Automated Coverage

At minimum, tests must prove:

- build release state and device preference independently control new-game discovery;
- disabled Soccer never hides active, parked, cloud, final, team, player, or aggregate records;
- every direct new-game entry checks availability before state mutation;
- legacy and malformed stored settings keep Soccer disabled by default;
- migration 049 exposes only the expected capability contract;
- missing, malformed, stale, or inaccessible capabilities fail closed;
- capability cache isolation follows the authenticated session;
- capability failure preserves the current active and parked game identities;
- local-only Soccer remains usable without Supabase;
- production routes use authority/source health rather than development mode;
- Basketball availability, setup, cloud sync, summary, aggregates, and court capture are unchanged.

Standard validation remains:

```text
pnpm lint
pnpm test
pnpm build
```

## 8. Manual Release Matrix

The SOC-6E2 matrix must record environment, migration level, browser/PWA mode, viewport, account,
team role, and pass/fail evidence for:

- anonymous/local and authenticated/cloud creation;
- capability success, missing migration, malformed response, offline, and retry;
- enable, disable, sign-out, account switch, and multiple accounts on one device;
- active and parked Basketball plus Soccer games in both directions;
- recorder conflict, finalization, reopen, recovery export, and canonical review;
- disabled-Soccer historical Team/Game/Summary/Player/Career access;
- narrow mobile capture/setup/settings and desktop review/aggregate surfaces;
- GitHub Pages HashRouter/OAuth return paths and production PWA refresh;
- existing Basketball end-to-end regression.

## 9. Deferred

- Global rollout controls, app-admin allowlists, or percentage rollout.
- Account-synced sport enablement.
- Dedicated product analytics or release telemetry.
- New Soccer event/stat families, standings, per-90 rates, or shootout aggregates.
- Realtime settings subscriptions and collaborative recorder streams.
- Broad application reskin and non-blocking visual polish.
- Basketball migration to the shared event model.

