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
remain unchanged. The owner must apply 080 manually after merge; it has **not**
been applied to live Supabase by this work.

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

**7C2 remains:** mount the controller with React lifecycle, add the personal settings
editor/conflict controls, seed personal setup from settled defaults, add My Players
and explicit Create Player/link intents, and add device-local capture defaults that
seed only new games. Keep team hierarchy, current match preferences, active-game
Cancel/commit safety and frozen historical setups unchanged. No settings/setup UI
or device-default change is claimed by 7C1. Baseball remains opt-in; 7D owns cutover.

## Observed Local Checks

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

## Pending Evidence

- 7C2 React/editor/setup/device-default and narrow-screen/keyboard checks.
- Owner application of migration 080 and live own-account/cross-account checks.
- BSB-6/7A live exit and broader release matrix remain pending independently.
- No new browser, physical-mobile or installed-PWA pass is asserted for this
  non-UI foundation. Existing application screens are not wired to it yet.

Implementation and self-review are single-agent. PR review remains separate; no
independent agent review, live migration, merge, deployment or gate change is claimed.
