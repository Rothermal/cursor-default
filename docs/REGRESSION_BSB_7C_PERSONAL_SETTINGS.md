# BSB-7C Personal Settings Evidence

Date: 2026-10-23. Governing plan:
[BSB-7](PLAN_BSB_7_AGGREGATES_SETTINGS_AND_RELEASE.md), section 6 and workstream 7C.

## Delivery Boundary

**7C1 foundation implemented for review.** Migration
[080](../supabase/migrations/080_baseball_personal_settings.sql) adds fixed personal
read/save/capability functions over existing settings storage, with an expected
account id checked against `auth.uid()`. It reuses 071's exact profile/override
validation with an empty transient lineup; no lineup enters personal settings.
Existing functions, team settings v1, shared policies and release contract 2/078
remain unchanged. The owner reports 080 applied on 2026-10-23 after #503 merged.
No agent applied it; this report does not establish live behavioral signoff.

The client adds exact three-key personal parsing, profile/effective-rule resolution,
an independent migration-080 capability, strict receipts and an account-generation
bound adapter/controller. It reuses shared cache/reconciliation helpers, without
changing Soccer/Hockey/Basketball hooks. Refresh never uploads defaults or imports
signed-out settings into an account. Only explicit account edits become pending.
Offline retries keep their base revision; conflicts require Use Cloud or Keep This
Device. A disappeared cloud row requires a choice before re-creation. Account
switches/disposal/abort block later requests and local settlement; an uncertain
already-sent save remains pending for its original account. Pending edits must be
persisted before any cloud write.

**7C2 integration is implemented for review:** controller React lifecycle, personal
editor/conflict controls, settled personal setup defaults, My Players/explicit
Create Player, separate durable link intents and device-local capture defaults that
seed only new games. No settings/setup UI or device-default change was part of
7C1 itself. Baseball remains opt-in; 7D owns cutover.

## Initial Local Checks (8ffdec68)

- Focused Vitest: **5 files / 90 tests passed** (personal schema/hierarchy, transport,
  controller, parity-fixture generator and independent feature capabilities).
- Disposable PostgreSQL **16.14**: **8 check groups**, **127 expected refusals**,
  **189 client/server payload cases**, and **2 lock-observed CAS races** passed.
  The runner creates/drops only a random loopback test database. It compares every
  pre-existing public function body and both settings tables' policies before/after
  080, and checks unchanged release/aggregate/link capabilities.
- Configured TypeScript/Vite/PWA build passed, **2,412 modules / 15 precache
  entries**. The measured app chunk is **2,997,302 bytes**, below the unchanged
  3 MiB limit; the expected 95.3% headroom warning is retained from #502.
- Project lint passed: **0 errors / 3 existing Fast Refresh warnings**. Automated
  review controls: **22 passed**. Full Vitest: **328 files / 3,274 tests passed**.
  **122 local documentation links** resolved; whitespace checks passed.

The cancellation test initially found a delayed capability request could continue
to the read after controller disposal. The controller now owns an abort signal,
passed through both fixed transport operations; the focused regression passes.
Initial typecheck failures in the new test fixture/unused import were corrected.
Self-review also made stale-draft conflicts durable before offering either choice;
the proposed device edit and its original base revision survive reload.

Reproduce the SQL checks with the [committed harness](../supabase/tests/bsb7c/README.md).
Its auth-claim stand-in does not establish live Supabase JWT, PostgREST schema-cache
availability, deployed app access or two-device behavior.

## PR Review Follow-Up

Both findings in [the PR review](https://github.com/Rothermal/cursor-default/pull/503#issuecomment-6366687646)
were validated. New regression assertions reproduced six failures on the original
controller, including the pending-device value being shown as Cloud and a fabricated
missing-row timestamp.

Stale-draft saves now persist the proposed device edit, then perform a fresh fixed
cloud read before offering either conflict choice. They never use the current device
settings as Cloud. If that read is unavailable, the edit remains pending and no Use
Cloud choice is offered; reconnect/reload can compare against the actual cloud row.
The last known cloud revision remains separate from the stale edit's base revision,
so an offline retry cannot silently re-create a subsequently deleted cloud row.
Account changes and disposal retain their guards during this added read.

Confirmed missing rows now carry a nullable timestamp in Baseball-only conflict
metadata. Use Cloud on an absent row retains null cloud/last-sync timestamps rather
than claiming a sync happened. Shared sport hook types and migration 080 are unchanged.

Follow-up focused tests: **5 files / 96 tests passed**, including **22 controller
tests** covering real/newer cloud values, offline reload, both choices, account
switch during the comparison and deleted-row retries. Repository-wide checks and
exact-head CI are reported with the follow-up commit in the PR. Local full-suite
verification passed **328 files / 3,280 tests**; the configured TypeScript/Vite/PWA
build retained **15 precache entries**. Lint passed with **0 errors / 3 baseline
warnings**, and **22 review-control tests** passed. The SQL harness was not rerun
for this client-only follow-up; the unchanged migration retains the initial SQL
evidence above. No new browser/device/live Supabase verification is claimed.

## 7C2 Integration Evidence

Date: 2026-10-23. This is single-agent implementation/self-review, not independent
agent review. There is no new SQL, live migration, deployment or rollout change.

- `useBaseballPersonalSettings` mounts/disposes the existing controller by auth
  generation, subscribes with stable React state rather than clone-producing
  `useSyncExternalStore` snapshots, and refreshes on active mount/focus/reconnect.
  Settings uses exact personal fields, explicit Save/Discard/Refresh and both
  conflict choices. Team Manage shares the same bounded rules editor; its lineup
  defaults and manager permissions remain separate.
- Personal setup waits for settled defaults; unreadable/missing-feature sources
  require Retry or an explicit built-in choice for this match only. Team setup
  waits for matching team/season, roster and defaults; a genuinely missing team row
  uses its own baseline, while unreadable sources no longer silently default.
  Later refreshes cannot overwrite recorder edits.
- Explicit My Players selections create synthetic game-local roster ids and separate
  account/local-game/participant intents. UUID shape, names and numbers never infer
  cloud identity. Unlinked play remains available. Create Player is a distinct,
  guarded user action with an id retained for uncertain retry; cancelling setup
  after explicit creation does not delete that account-owned player.
- Fresh capability checks precede the complete rollback-safe game/intent commit.
  Failed parking/metadata writes restore the old game and prior keys. Only selected
  players get intents. After binding, sync uses fresh server maps and checked link
  operations; lost responses retain intents until current confirmation. Another
  binding, participant set, existing different target or published result requires
  explicit review. No automatic reopen, frozen setup rewrite or raw-event mutation.
  Setup choices use exact device-intent version 2 with `origin: setup`; existing
  manual version-1 requests stay readable and never enter the automatic queue.
  The tracker offers explicit cancellation of an individual pending request,
  guarded by account/game and exact intent revision. This does not undo already-sent
  requests or remove cloud links/history. Other requested links may still sync.
  Final source review also caught the transport's separately returned first-upload
  binding: the Baseball wrapper now installs it before link work and in recovery
  snapshots. Three integration regressions cover first-sync application, retained
  binding after a link failure and no link work after an upload failure.
- Both device location defaults are true when absent and persist independently.
  Their only effect on game state is seeding a fresh setup candidate. Existing
  per-game capture controls/reload and gameplay fingerprints remain unchanged.
- Simulated Chromium: **12 views** (Settings, fresh setup and Team Manage at 390px
  and 1280px, Light/Dark) passed keyboard-focus and horizontal-overflow checks;
  screenshots were inspected. **15 interaction/race scenarios passed**: both
  conflict choices, dirty-refresh preservation, offline save/reload/reconciliation,
  held A -> B -> A reads, anonymous/account isolation, missing-feature explicit
  fallback, one successful commit with nine intents, failed commit/Cancel, explicit
  versus unlinked creation, held personal/default roster reads, missing/unreadable
  team sources, Cancel during final capability verification, device-only edits and
  cancellation of one pending request without changing game facts.
  These used real components/controllers with synthetic auth and Supabase responses,
  not a live project, physical phone or installed PWA.

Final local gates: **331 files / 3,307 tests passed**. The focused integration
batch passed **6 files / 77 tests** (setup, intents, first-upload handoff, explicit
creation, device storage and the existing controller). The configured TypeScript/Vite/PWA build
passed with **2,419 modules / 15 precache entries**. The measured app chunk is
**3,020,430 bytes**, **96.0%** of the unchanged 3 MiB per-file cap, leaving
**125,298 bytes**. Keep the
documented route-splitting follow-up visible rather than weakening offline caching.
Repository lint: **0 errors / 3 existing Fast Refresh warnings**. Review controls:
**22 passed**. **121 local documentation links** and whitespace checks passed.
The unchanged SQL was not rerun for this UI/client-only integration;
7C1's separately labelled disposable PostgreSQL evidence above still applies.

## Pending Evidence

- Live own-account/cross-account checks after owner-reported application of 080.
- BSB-6/7A live exit and broader release matrix remain pending independently.
- Physical-mobile, installed-PWA, actual offline/reconnect and deployed cloud
  setup/link/finalization checks remain pending; synthetic browsers do not replace them.

Implementation and self-review are single-agent. PR review remains separate; no
independent agent review, live migration, merge, deployment or gate change is claimed.
