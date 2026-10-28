# LCF-3: Soccer and Hockey Capture / Focus

Status: implemented for review on 2026-10-27, following merged Basketball #513.
Plan: [Live capture follow-up](PLAN_LIVE_CAPTURE_FIELD_TEST_FOLLOWUP.md).
Single-agent implementation/self-review, not independent agent review.
No migration, new dependency, event/schema change or rollout-gate expansion.

## Preserved Contract

- Writable pitch/rink: a short tap opens the sport's existing capture path even
  over a marker. Nothing is recorded until explicit save. Exact repeated
  coordinates remain valid. Stationary 500 ms holds open marker/overlap review;
  release and pointer-generated clicks never perform a second action.
- The shared recognizer preserves browser pan/zoom and cancels on movement,
  scroll, second touch, pointer cancellation/lost capture, resize, blur, hidden
  document and teardown. Keyboard Enter/Space and read-only marker clicks retain
  review behavior. The hold threshold still needs physical-device feedback.
- `surfacePoint` maps the actual aspect-preserved drawing, excluding letterbox
  space. Existing sport helpers undo visual flips and supply the selected side's
  attacking direction. Neither coordinates nor existing markers are jittered.
- Soccer retains Shot/Defense/Foul modes, one-shot Restart, incident attribution,
  penalty-kick follow-up, lineup restrictions and all checked saves/corrections.
  The existing overlap chooser now uses the shared accessible `TrackerDialog`.
- Hockey retains explicit faceoff-dot shortcuts and the general shot/play
  chooser. In focus, these inline controls become sheets inside the fullscreen
  root. Held shot/play markers open existing Timeline detail/correction; nearby
  visible markers get a deterministic chooser. Hidden/removed/unlocated events
  are not invented as markers. Ended/final/unauthorized correction guards remain.
- Both consume `useTrackerFocus`: phone-like landscape auto-focus, explicit
  Expand/Exit, optional native fullscreen/orientation lock, fallback on denial,
  same-URL Back, Escape, safe areas and counted body-scroll locks. The same
  tracker, clock and GameContext remain mounted. Period breaks, terminal games,
  shootout workspaces and non-surface tabs do not auto-focus.
- Compact score/period/clock and named team context remain above the surface.
  Three-dot tools retain sport actions/filters and navigation; routine sync is
  accessible through the existing footer. Save/access/conflict errors stay visible.
  Menus and modals stay inside the fullscreen root, with keyboard focus handling.
- Baseball, Football, Basketball's shipped behavior, cloud authority, clock and
  substitution semantics are not redesigned in this slice.

## Observed Verification

- Full suite: **350 files / 3,601 tests passed**. New committed coverage includes
  **28** actual SVG DOM gesture cases, **4** letterbox mapping cases, **4** tools
  disclosure cases, **1** Hockey overlap case and **2** cloud-footer transition
  cases. Existing Basketball DOM and
  focus-hook checks pass in the same suite.
- The previous Hockey presentation test directly invoked a now-hooked component;
  it now renders through React's server renderer. Its four side/flip coordinate
  cases are covered through real DOM pointer propagation in the new gesture suite,
  rather than bypassing hooks. The first new test fixture also selected a Lucide
  SVG instead of the playing surface; that selector was corrected before passing.
- Configured TypeScript/Vite/PWA build with placeholder public backend values
  passed: **2,432 modules / 15 precache entries**, app chunk **3,050,262 bytes**,
  **95,466 bytes** below the unchanged 3 MiB per-asset limit. Bundle/Browserslist
  warnings remain follow-ups; no budget was raised. An earlier test-only TypeScript
  children-prop error was corrected before this passing build.
- Source lint (`pnpm exec eslint . --ignore-pattern "qa.local/**"`): **0 errors /
  3 existing Fast Refresh warnings**. Ignored private/synthetic QA fixtures are not
  shipped and are excluded from this local source-lint command.
- Synthetic Chromium: **31 workflows / 32 screenshots passed**, both sports in
  Light/Dark at 390x844, 844x390, 568x320 and 1280x800. Screenshots inspected.
  Checks include long names, actual marker tap/hold/release, overlap sheets,
  menu-launched incidents/penalties, nested scroll-lock cleanup, focus exit and
  suppression, running/paused/break/ended states, visible errors, dense penalties,
  clockless Hockey, real native fullscreen and denied-fullscreen fallback, sheets
  under the native fullscreen element, browser Back cleanup, clock progression,
  two actual opponent saves at identical coordinates per sport, one-shot Soccer
  Restart, Hockey faceoff-dot capture, and rotation with an open cloud-enable
  confirmation. Actual saves wait for the existing atomic-save busy guard.
- Browser checking found the old Soccer cluster sheet had no dialog semantics,
  and the new tools disclosure consumed Escape while already closed. Both are
  corrected; committed menu tests distinguish first-close from second-Escape exit.
- Final self-review found that hiding the entire Hockey footer would also hide an
  already-open cloud-enable confirmation on rotation. Focus now hides routine
  controls only; confirmation and errors remain visible. Cancellation returns focus
  to the visible Exit control. The browser rotation replay and committed tests pass.
- Automated-review safety controls: **22 tests passed**. This is verification of
  the existing review tooling, not an independent code review of this slice.
- Changed-document routing: **97 relative targets validated**; whitespace checks
  passed. No private recovery export or ignored browser fixture is committed.

Browser fixtures use synthetic participants, stubbed auth/cloud, real tracker
components and checked sport commands/reducers. No owner's browser data or live
database was read or changed. These checks do not establish physical-touch,
installed-PWA, live cloud or complete-match signoff. Exact-head CI is recorded on
the PR. Existing owner-only post-deployment validation policy remains unchanged.

## Owner Post-Deployment Checks

1. Refresh each used browser/PWA. In a Soccer or Hockey game, short-tap an occupied
   marker to record another play, then hold to review the overlapping entries.
2. Rotate to landscape; verify score/clock/team context, the complete playing
   surface, tools, capture sheets, safe areas and browser zoom. Exit and rotate
   through portrait to verify intentional re-entry.
3. Try the explicit Expand button, native/fallback fullscreen, Escape/Back and
   return focus. Confirm a running clock continues; merely opening tools or
   changing layout must not add an event or change the lineup/attacking direction.
4. Verify Soccer modes/restarts/lineup guards and Hockey faceoffs/penalties/goalies,
   then resume the ordinary sync/finalization workflow with real retained games.

The separate second-game Basketball scoring report remains open pending its
export. Baseball surface adaptation requires its own runner/fielder interaction
assessment; Football implementation remains paused.
