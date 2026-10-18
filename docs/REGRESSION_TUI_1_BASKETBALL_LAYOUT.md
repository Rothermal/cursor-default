# TUI-1 Basketball Layout and Action Inventory

Status: layout/action pass implemented for review. This is the first of two TUI-1
PRs, not completion of the event-only/legacy-retirement cutover.
Plan: [Shared tracker UI](PLAN_TRACKER_UI_UNIFICATION.md).

## Scope and Preserved Contracts

- Event Basketball puts workspace navigation above score/clock, then named side
  selection and the court. Current foul/bonus context remains compact above it.
- Quick Foul, Free throw, Manage Lineup and Undo are below the court. Filters and
  chart detail/destructive tools are collapsed; court orientation remains available.
- Clock/lineup details are expandable; Start/Pause, recovery errors and pending
  boundary review remain visible. The paused-substitution policy is unchanged.
- Game options contains lifecycle controls and entry to score correction/Actions.
  Menu dismissal preserves focus; critical sync errors stay above the workspace.
- Routine sync/recorder/cloud-enable controls move to the bottom. They are not
  hidden in a collapsed panel that could conceal their own errors or confirmations.
- Shared Scoreboard defaults and generic sibling tracking remain compatible.
  No reducer, event schema, cloud transport, backend, creation gate or legacy
  retirement behavior changes. Preview/version controls are removed in the next PR,
  not silently declared removed by this layout pass.

## Action Inventory

| Action | Destination in this pass | Authority/guard |
| --- | --- | --- |
| Located shots and plays, actor selection, linked assist/rebound follow-up | Court popup | Existing checked capture, side/frame inference and live actor eligibility |
| Court flip | Compact toolbar below court | Existing display-only orientation command |
| Chart player/side review | Display filters below court, independent of capture side | Local view state only |
| Zone summary, last-shot Undo, clear chart | Chart details & tools | Existing newest-capture and dependency-aware clear/confirmation guards |
| Quick foul / free throw | Under-court buttons and existing court popup | Same foul/award/attempt workflows; no fabricated location for quick entry |
| Start/Pause and clock display | Sticky clock strip | Existing checked clock commands, expiration and recovery behavior |
| Set Clock, stoppage context, current lineup names | Clock & lineup disclosure | Existing reason/paused/time/eligibility checks |
| Substitution / current lineup recovery | Under-court Lineup; Lineup view Manage Lineup; clock tools | Disabled without side lineup authority or while running; existing sheet/commands |
| Boundary/equal-play review | Visible Review lineup, Start and blocked End Period handoff | Existing checked confirmation/override policy |
| Player stat controls, related stats, manual minutes where supported | Lineup card -> in-game details | Existing period/eligibility and clockless minute semantics |
| Team direct stats, timeouts, ejections, notes | Actions (tab or Game menu entry) | Existing checked administrative commands and correction guards |
| Quick score +/- and official score correction | Actions scoreboard; official correction also in Game menu | Existing checked score-adjustment commands |
| End/start period, complete, suspend, abandon, local reasoned reopen | Game menu | Existing running-clock, boundary, period/result and reopen checks |
| Global and participant Timeline/edit/remove/restore | Timeline or player details | Existing revision, stale-state, dependency and terminal guards |
| Recent events / Undo / Restore | Under-court Undo and Game menu | Same existing popup, newest-first/restore rules; correction-mode lock retained |
| Summary / cloud finalization / manager reopen | Summary link; existing Game Info route | Existing authority/role policy; menu local reopen does not replace cloud finalization |
| Enable cloud, recorder status/history access | Footer | Existing transport/capability checks and Game Info links |
| Conflict review, retry, deleted-source history recovery, recovery export | Existing attention/error banner above workspace | Remains visible outside collapsed menu/tools |

## Verification

Observed on 2026-10-17:

- Full suite: **292 files / 2,747 tests passed**, including 16 new tests across the
  layout/callback, sync-status and chart-placement coverage. The older source-order
  guard now pins the clock above workspace content, not below navigation markup;
  real component-tree tests pin navigation/score/clock/court/footer order.
- Typecheck and production build pass; the build emits the existing public-asset,
  Browserslist and large-chunk warnings. PWA precaching succeeds.
- Lint passes with 0 errors and the 3 existing Fast Refresh warnings when ignored
  local `qa.local` review checkouts and `.claude` are excluded. A plain root lint
  also passed, but included 9 additional warnings from those local review copies.
- A concurrent build/test repeat timed out in the existing 5-second release-consumer
  filesystem scan. The final full-suite rerun without a concurrent build passed;
  no timeout or allowlist was relaxed.
- Whitespace and all 116 relative links across the six changed documentation files
  pass. Temporary browser fixture sources were removed; screenshots remain local
  ignored QA artifacts, not production files.

### Actual Browser Checks

Disposable Chromium contexts mounted the real providers and tracker with synthetic
local data. Ten render cases completed without page errors:

| Case | Observed result |
| --- | --- |
| 390 x 844, Light and Dark | Court begins at about 423 px and ends at 624 px, fully in the first viewport; real tan court remains visible in both themes |
| 1280 x 844, Light and Dark | Centered court, stable proportions, controls and text remain in bounds |
| Clockless Event | Period/score remain visible, without an invented clock or Start control |
| Legacy Basketball | Established legacy tracker remains reachable for this pre-cutover pass |
| Generic Football | Existing generic tracker renders without a Basketball workspace or authority change |
| Abandoned Event and period break | Quick capture remains disabled; existing lifecycle context remains available |
| Long team names | Wrapping team buttons/names and truncated court-end labels have no horizontal page overflow; contained screen-reader text fixes the overflow found during this check |

The phone-sized Dark run also exercised Game-menu Escape/focus and score-correction
Cancel, Start/Pause with exactly two events, running-clock Lineup/Suspend guards,
Set Clock access/Cancel, Foul/Free throw/Lineup open-and-cancel, checked made-shot
capture, Recent Events access, chart-clear confirmation/Cancel, and an injected
sync-error banner above the court. Tab/filter navigation left the game fingerprint
unchanged. Component callback tests separately pin side-local unattributed quick
entry, score-command wiring and independent chart/capture selection.

These are desktop-browser viewport fixtures, not live Supabase, installed-PWA,
physical-phone or full-match signoff. Component-tree tests mock effects; the browser
checks supply the real focus/clock/navigation coverage. Owner deployed checks remain
post-deployment validation under the governing plan; broader rollout stays gated.

### PR #491 Repair Checks

Observed on 2026-10-18, starting from `08a463f1`:

- Lineup Save and Cancel now return focus to the actual court, roster or clock-tools
  launcher without changing the clock disclosure's open state. Add Participant
  keeps that launcher through Save back to the sheet or Cancel back to the launcher;
  opening or dismissing these workflows does not record gameplay events.
- Before the repair, the focused callback tests reproduced external Save/Cancel
  focus failures. Afterward, **3 files / 29 tests passed** using
  `pnpm test -- src/components/basketball/BasketballClockStrip.test.ts src/pages/GameTrackerLayout.test.ts src/components/basketball/BasketballWorkspaceRoster.test.ts --maxWorkers=2`.
- Coverage includes internal/external close paths, rejected Save, actual tracker
  launcher wiring, Add Participant handoff, and quick Foul/Free throw disabled after
  checked Abandon and End Period commands. The lifecycle guards themselves were
  already correct and are unchanged.
- The coordinator separately reports real Chromium checks at 390px: external Cancel
  kept the tools closed at 36px high and focused `#external-launcher`; external Save
  made one checked one-out/one-in substitution event (two total events), kept tools
  closed and returned external focus; internal Lineup Cancel preserved expanded
  tools and internal focus. All three checks had zero page errors.
- The unit checks use mocked focus targets; the coordinator's browser checks are
  desktop Chromium, not physical-device or live-service signoff. Post-repair full-gate
  reruns are not recorded here yet; prior full-suite counts above remain historical.

## Remaining Work

The next TUI-1 PR owns event-only setup/commit, stale legacy drafts, read-only
active/parked/cloud legacy source review, exclusion notices/export, safe existing-data
sync and shared Summary/Game Info mutation guards keyed by sport and authority.
Other sports' legacy controls must remain intact. The owner-only validation timing
and unfinished-legacy decisions in the governing plan remain unchanged.
