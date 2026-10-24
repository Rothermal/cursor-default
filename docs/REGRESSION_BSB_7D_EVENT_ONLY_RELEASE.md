# BSB-7D Event-Only Cutover and Release Evidence

Date: 2026-10-24. Status: **implemented for review; deployed matrix pending**.
Governing contract: [BSB-7](PLAN_BSB_7_AGGREGATES_SETTINGS_AND_RELEASE.md), especially
Q21-Q23 and sections 7-9. Depends on merged #503/#504. Owner reports migration 080
applied on 2026-10-23; no new migration, backend contract, auth role or access expansion.
This is single-agent implementation/self-review, not independent agent review.

## Implemented Boundaries

| Entry or operation | Candidate behavior |
| --- | --- |
| Baseball Dashboard / Team Info New Game | Mutation-free event setup, regardless of old preview preference |
| Explicit `/setup?sport=baseball`, absent/stale `events`, plain setup with Baseball active | Event setup only |
| Team-only or explicit team setup with an unrelated active sport | Resolve current account's team sport first; unavailable, unsupported and mismatched teams refuse with Retry, without changing the active game |
| Setup Cancel / failed capability / failed commit | Prior game and storage preserved; existing rollback-safe game/intent commit retained |
| Fresh setup with missing individual feature support | Existing explicit retry/device-only/built-in choices retained; no aggregate creation or automatic identity loss |
| `/players`, `/checkout`, `/game`, legacy import and parked resume | Legacy Baseball Summary only; no setup/checkout/grid effects mounted |
| Legacy Summary, every role/status | No correction, primary reassignment, capture or finalization; unfinished exclusion label, notes/stats/export remain |
| Cloud Games / Game Info legacy open | Prefer matching owned active/parked history before cloud hydration; ambiguous/incompatible bindings refuse rather than replace local facts |
| Legacy cloud metadata edits | Authority checked before opening/saving the editor; no legacy write |
| Healthy or damaged event game | Existing event tracker/Summary only; damaged markers survive normalization and cannot become aggregate authority |
| Creation rollback | Blocks setup/commit, including development; saved event/legacy reads, exports and authorized transport stay available |
| Sibling sports / app access / team roles | Existing behavior and server authorization retained; shared team routing now refuses unresolved/mismatched authority |

Legacy Baseball's aggregate sync capability is deliberately retained to drain
already-recorded data. Read-only is not permission to clear dirty flags, discard,
auto-finalize or convert a game. Explicit local deletion retains its existing warning.
Clean cloud legacy review can read resolved stats; dirty local facts remain visible
instead of being replaced by that overlay. Generic Summary remounts per local/cloud
identity so review state cannot carry between records.

## Observed Local Evidence

- Full Vitest: **332 files / 3,337 tests passed** (`pnpm test --maxWorkers=2 --silent`).
  Focused final route/retirement/context/Game Info run: **5 files / 70 tests passed**.
- Configured TypeScript/Vite/PWA build passed with placeholder public Supabase
  configuration and local build id `bsb-7d-local-20261024`: **2,420 modules / 15
  precache entries**. App chunk **3,026,236 bytes (96.2%)**, **119,492 bytes** below
  the unchanged 3 MiB hard limit. Exact CI bytes may vary with its build identity.
- Lint passed: **0 errors / 3 existing Fast Refresh warnings**. Review controls:
  **22 tests passed**. **152 local documentation links** and whitespace checks passed.
- Synthetic Chromium cutover batch: **8 desktop/narrow Light/Dark views / 17
  interaction cases passed**. Includes retired routes, all four roles, team-only
  routing/mismatch with unrelated Football active, preview-off setup, settings,
  disabled discovery, corrupt authority, creation rollback with existing event
  capture, dirty Game Info binding preservation and refusal of legacy cloud rename.
  Screenshots inspected; no page errors or horizontal overflow on the passing run.
- Prior 7C real-component browser batch rerun: **12 views / 15 interaction/race
  scenarios passed**, including complete personal game creation/intent persistence,
  coherent team defaults, Cancel/capability failures and request recovery.

Browser fixtures use real routes/components/controllers with synthetic auth/Supabase
responses and isolated GameContext adapters, not live RLS, real offline or PWA signoff.
Fixture SDK/React adapters and ownership/locator mistakes were corrected before the
reported passing runs. Two initial source-audit expectations were updated to the new
resolved-team route expression/availability consumer; no test was skipped. SQL was
not rerun because this slice changes no backend behavior. Exact-head CI is reported
on the PR separately; no independent agent review is claimed.

## PR Review Follow-Up

2026-10-24: all three items in the
[review](https://github.com/Rothermal/cursor-default/pull/505#issuecomment-6381074962)
were valid and addressed:

- Restored plain `/setup` with mounted Hockey to generic setup. Three restored/new
  routing expectations failed before the fix and passed afterwards. Explicit Hockey
  and resolved-team event setup, active Soccer setup and Baseball event-only setup
  retain their intended routes. A synthetic browser case also confirms plain Hockey
  setup preserves the mounted game's state without a commit or cloud write.
- Added seven executable finalization-hook tests: all four legacy Baseball roles
  refuse before sync/write/reset, stale callbacks and in-flight sync cannot bypass
  retirement, and Football aggregate finalization still works. Four committed source
  audits pin tracker/roster/checkout redirects, Summary correction/primary guards and
  cloud rename refusals. Source audits supplement runtime evidence, not live checks.
- Removed the unused Baseball release-stage entry and ignored preview/development
  policy arguments. `BASEBALL_NEW_GAME_CREATION_ENABLED` remains the only creation
  rollback switch; existing-game access and rollout authorization are unchanged.

Follow-up verification: **333 files / 3,350 tests passed**; focused route, Baseball/
Hockey release and finalization-hook tests: **4 files / 43 tests passed**. Configured
TypeScript/Vite/PWA build passed with local build id `bsb-7d-review-20261024`:
**2,420 modules / 15 precache entries**, app chunk **3,026,268 bytes (96.2%)**,
**119,460 bytes** below the unchanged hard limit. Lint: **0 errors / 3 existing
Fast Refresh warnings**. The cutover Chromium batch passed **8 views / 18 interaction
cases**, including the new plain Hockey setup case. The prior 7C batch above was not
rerun in this follow-up. No SQL or live/device/PWA checks were performed.

## Rollback and Client Refresh

- Set `BASEBALL_NEW_GAME_CREATION_ENABLED` to false in
  `src/lib/baseball/releasePolicy.ts` through a reviewed build. Do not revert Baseball
  to opt-in, restore the legacy grid or remove its historical aggregate transport.
- Existing event tracker, Summary, cloud recovery and legacy exports remain reachable.
  The transaction checks the same switch before touching parking storage.
- Previously cached PWA clients remain old clients. Accept the existing Update prompt
  and verify the displayed deployed build before testing. If a live game needs a
  guarded pause/save, follow that flow; do not force-reload or wipe storage.
- Existing prompt-based updates and the all-JavaScript precache policy are unchanged.
  The 3 MiB per-file hard limit is not raised. Route splitting remains the separate
  [operations follow-up](OPERATIONS.md#configured-build-and-offline-assets).

## Deployed Checks Still Pending

Q22 approves owner-only post-deployment validation, not broader rollout or a new ACL.
Merge/build/unit/browser-fixture success does not mark these passed:

| Check | Owner verification after deployment | Status |
| --- | --- | --- |
| Build and installed clients | Update every used browser/PWA; confirm deployed SHA and retained parked games | Pending |
| Local personal play | With preview preference off, create an unlinked device-only game, record pitches/plays, park/resume and view Summary | Pending |
| Actual cloud/auth/RLS | Personal and team event setup, authorized sync and denied cross-account/viewer writes on 078-080 | Pending |
| Two-device lifecycle | Independent streams, primary selection, conflicts, finalize, reopen, republish and canonical Summary | Pending |
| Legacy history | Open final and unfinished/local/dirty cloud-bound records; verify preserved stats/export, read-only UI, unfinished exclusion and authorized old-data sync | Pending |
| Offline/reconnect | Open cached app without signal, use account defaults/unlinked players, reconnect and explicitly recover link/sync failures | Pending |
| Feature compatibility | Exact 2/078 handshake and independently missing aggregate/settings/link features block only affected operations; no aggregate fallback | Pending live; client branches covered by existing automated suites |
| Physical mobile/PWA | Narrow field/pitch controls, Light/Dark, installed offline chunk loading and guarded update with an active game | Pending |
| Rollback build | Creation disabled while saved event/legacy review, export and recovery remain reachable | Pending deployed; synthetic browser covers policy behavior |

Record observed failures and their build/account/game context before expanding app
access. BSB-6/7A live exit remains open independently of implementation completion.
