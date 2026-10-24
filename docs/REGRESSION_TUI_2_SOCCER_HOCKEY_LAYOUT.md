# TUI-2 Soccer and Hockey Tracker Alignment

Date: 2026-10-24. Status: **implemented for review; deployed checks pending**.
Plan: [Shared tracker UI](PLAN_TRACKER_UI_UNIFICATION.md), sections 3-4 and 7-8.
Implementation baseline: `0d4b2094` (merged Basketball cutover #506).
Single-agent implementation/self-review, not independent agent review.

## Scope and Preserved Contracts

Both sport layouts are one review package. Hockey legacy retirement remains a
separate next slice because it changes shared routes, mutations and preservation
guards; this pass changes no sport's creation or legacy authority.

- Soccer places navigation before the sticky score/clock strip, named team
  selection immediately before the field, capture modes and quick actions below
  the field, collapsed marker filters, then routine sync/recorder context.
- Hockey places Track/Timeline navigation before its score/clock, compact
  strength/penalty count, named team selection, rink, quick capture, collapsed
  marker filters, Recent Events and footer cloud controls. Full penalty details
  no longer expand the sticky header.
- Shared `TrackerSideSelector`, `TrackerDialog` and `EventCloudStatus` contain
  presentation only. The dialog reuses `useModalFocus`; sport callbacks retain
  event construction, eligibility, replay, lifecycle and cloud authority.
- Soccer retains its fingerprint-inert capture preference actions. Hockey's new
  side/filter state is component-local and never enters setup, events, storage,
  fingerprints or cloud payloads. Reload defaults to the tracked side/all markers.
- No clock semantics, running-clock substitutions, event schemas, field geometry,
  new shift tracking, roles/access, migration or backend capability changes.

## Action Inventory

| Action | Location | Preserved behavior |
| --- | --- | --- |
| Navigation and Game/Match Actions | Compact top row | Changing views/opening a sheet records no event and does not stop the clock |
| Score/period/Start/Pause | Sticky header | Same checked clock and lifecycle commands, terminal/recovery guards and clockless Hockey behavior |
| Named side context | Above field/rink | Seeds the next event form, not a hidden individual or a marker filter |
| Soccer located/quick shots, defense, fouls, cards and restarts | Field and below-field modes/actions | Existing actor eligibility, location/side mapping, one-shot restart and penalty-kick follow-up |
| Soccer Lineup, Timeline and recent Undo | Existing view/action entry points | Same pause/boundary, correction, read-only and dependency rules |
| Hockey located/quick shots and plays | Rink chooser and quick row | Selected-side defaults; all forms still offer explicit side/actor review. Stored edit sides win over new defaults |
| Hockey penalties/goalies | Quick row sheets | Selected-side form defaults only; choosing a team never assigns a penalty or changes a goalie. Coincidental units and explicit save remain unchanged |
| Hockey faceoffs | Explicit rink dots / chooser | Winner remains Won/Lost, independent of selected capture team; existing taker and canonical dot mapping |
| Hockey strength and penalty count | Compact header button | Actual projected strength/count, including waiting penalties; clockless context is labelled per period |
| Hockey penalty details/release | Penalty box sheet | Existing running/waiting/timer information and reason-required checked release; opening/closing records nothing |
| Hockey marker filters | Collapsed below rink | Family (all/shots/plays), team and current/latest/full-game display only; no invented faceoff markers, stats or event edits |
| Hockey Undo/Restore and corrections | Recent Events / Timeline | Existing newest-capture, restore and correction commands |
| Routine sync / Hockey Enable cloud sync | Footer | Existing availability, confirmation, ownership and capability flow; rejected enable remains visible, never treated as success |
| Conflicts, save failures and recovery export | Visible attention/error banners | Remain above the surface, not hidden in footer/menu/filter disclosures |

The shared status line reports explicit `synced` state as synced. An idle bound
record also says Synced when its current payload matches the acknowledged sync
fingerprint and no conflict/recovery acknowledgment remains pending. Missing or
mismatched acknowledgments say Waiting to sync; a cloud id alone is not proof.
Baseball's existing shared cloud menu uses the same status presentation, without
changing its enable/transport policy.

## Observed Verification

- New focused coverage: **3 files / 30 tests passed**. Tests pin component order,
  local capture versus marker filters, shot/play/penalty/goalie defaults, stored
  edit precedence, explicit faceoff winner, running-clock penalty inspection,
  full accessible team labels, honest sync status, all four Hockey side/flip tap
  mappings, canonical marker coordinates, deleted/unlocated handling and
  fingerprint/data preservation.
- Existing focused Soccer/Hockey wiring, appearance and release checks: **4 files /
  72 tests passed** before the final form-default additions; final full gates are
  recorded below rather than inferred from that earlier run.
- Configured TypeScript/Vite/PWA build passed with placeholder public Supabase
  configuration and build id `tui2-alignment-20261024`: **2,424 modules / 15 precache
  entries**. Local app chunk **3,028,687 bytes**, **117,041 bytes** below the unchanged
  3 MiB limit. Existing asset/Browserslist/large-chunk warnings remain operational
  follow-ups, not a reason to raise the precache limit.
- Synthetic Chromium: **8 narrow/desktop Light/Dark views / 31 interaction cases
  passed**. Screenshots inspected. Healthy 390px Soccer field starts at **326px**
  and ends about **551px**; Hockey rink starts about **326px** and ends about
  **478px**. Both are fully in the first 844px-high viewport.
- Browser checks cover long names, running/paused, break, ended/abandoned, dense
  and waiting penalties, clockless Hockey, visible sync errors, sticky headers
  while scrolling, menu Escape/Tab/
  return focus, filters independent of recording, selected-team forms, actual
  opponent captures, Hockey Undo, Soccer Timeline navigation and two-event
  Start/Pause. Footer cloud confirmation restores focus on Cancel; a synthetic
  rejected Enable preserves saved facts and displays its error.
- A browser selector initially used Soccer pitch rather than the existing Soccer
  field accessible name; it was corrected before passing runs. The initial unit
  harness also omitted Soccer's preference reducer action and used an unsupported
  Array.at call; both fixture issues were corrected without relaxing checks.
- The scroll check found Soccer's old overflow wrapper prevented sticky behavior;
  it now uses horizontal clipping without creating a scroll container. After this
  repair, **4 focused files / 74 tests passed** and the configured build/browser
  matrix passed again. The browser test also waits for the existing focus hook's
  animation-frame restoration instead of racing it.
- Full local suite before that final CSS-only repair: **337 files / 3,415 tests
  passed**. Final source lint (`pnpm lint --ignore-pattern 'qa.local/**'`): **0 errors /
  3 existing Fast Refresh warnings**. Review controls: **22 tests passed**.
  **152 relative document targets** and whitespace checks passed. Exact-head CI
  with the complete final suite will be recorded on the PR.

Browser fixtures mount real tracker/dialog/field components with synthetic auth,
no live Supabase client and an isolated GameContext adapter using real reducers
and checked commands. They are desktop Chromium, not physical-phone, installed-PWA,
live RLS/cloud enable or full-match signoff. No game on the owner's browser was
loaded, changed or uploaded.

## PR Comment Follow-Up

The [reconnect-status report](https://github.com/Rothermal/cursor-default/pull/507#issuecomment-6388154760)
is valid: connectivity returns clean games to `idle`, but fingerprint-clean records
do not enter the upload queue, so no later upload changes their status to `synced`.
The footer now recognizes that acknowledged payload instead of showing a permanent
pending label. The queue, stored status, fingerprint and cloud writes are unchanged.

- Eleven added cases cover clean reconnect and dirty-bound behavior across Soccer,
  Hockey and Baseball; missing binding/acknowledgment; offline/syncing/error priority;
  and pending conflict-audit work. Before the repair, all three clean-reconnect
  cases failed. Afterward, the focused run passed **3 files / 64 tests**.
- The status label is memoized against immutable game state, so live-clock-only
  renders do not repeatedly serialize the same event history. Tests render the
  real component through React's server renderer rather than invoking its hooks
  outside React.
- The synthetic Chromium matrix passed **8 views / 33 interaction cases**, adding
  clean -> offline -> idle -> dirty footer checks in both real tracker components.
  Existing fixture/service/device limitations remain in force.
- Final follow-up verification passed **337 files / 3,426 tests**, source lint
  (**0 errors / 3 existing Fast Refresh warnings**), and **22 review-control tests**.
  The configured production build and PWA generation passed; the app chunk is
  **3,028,947 bytes**, leaving **116,781 bytes** below the enforced precache limit.
  These local checks do not establish deployed cloud, mobile or installed-PWA signoff.

## Pending Deployed Validation

- Refreshed browser/PWA: verify both sports' header, named teams, playing surface,
  action sheets, filters and footer with real retained games.
- Real-game capture, lineups, Undo/correction and cloud/reconnect/recovery behavior.
- Physical phone safe areas, keyboard/focus and installed PWA interaction.
- Existing broader-rollout gates and historical release evidence remain unchanged.

No live SQL, migration, deployment, merge, rollout-gate expansion, record conversion
or cleanup is performed by this slice. Hockey legacy retirement is still next;
Football still needs its event foundations before adopting this layout.
