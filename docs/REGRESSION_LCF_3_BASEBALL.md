# LCF-3: Baseball Focused Capture

Status: implemented for review on 2026-10-28, following merged #513/#514.
Plan: [Live capture follow-up and Baseball assessment](PLAN_LIVE_CAPTURE_FIELD_TEST_FOLLOWUP.md#baseball-surface-assessment-2026-10-28).
Preserved workflow: [BSB-3 diamond/pitch capture](PLAN_BSB_3_DIAMOND_AND_PITCH_CAPTURE.md).
Single-agent implementation/self-review, not independent agent review.
No migration, new dependency, event/schema change or release-gate expansion.

## Assessment and Implemented Contract

- The live diamond shows current runners, fielders and batter context, not saved
  event markers. A pending spray point is an unsaved draft. Existing Recent Plays,
  Timeline and Summary charts remain the history/review paths; this slice does not
  add a live historical spray-map or convert current players into edit targets.
- The shared gesture hook makes short stationary location taps cancellable on
  movement, scrolling, second pointer, cancellation/lost capture, resize, blur,
  hidden document and teardown. A held location does nothing on release. Browser
  pan/zoom remains enabled; no guessed pitch/result is recorded by a location tap.
- Current runner/fielder short taps retain their distinct scoring actions. A
  fielder goes into the active fielding sequence; a runner opens/cycles the existing
  runner flow. Pointer-generated clicks cannot duplicate those actions. Keyboard
  Enter/Space remains direct activation. Inactive fielder drawings do not intercept
  batted-ball placement. Holds do not invent historical review for these controls.
- `surfacePoint` excludes SVG letterboxing before Baseball's fixed-frame conversion.
  Repeated locations can be identical; no point/frame or saved play is rewritten.
- `useTrackerFocus`, `TrackerFocusButton` and `TrackerSurfaceTools` provide the same
  phone-landscape auto-focus, explicit Expand/Exit, optional native fullscreen,
  fallback, suppression, Back/Escape and safe-area behavior as the sibling sports.
  No second tracker, GameContext, recorder or capture flow is mounted.
- Baseball preserves its BSB-3 requirement to show the diamond and scoring controls
  together. Focused landscape puts an aspect-preserved diamond beside an internally
  scrollable pitch/in-play/runner panel. Explicit portrait focus stacks the panes.
  Drafts, optional pitch location and runner choices survive Expand/Exit/rotation.
- Compact context shows score, actual inning, balls/strikes/outs, pitcher count and
  advisory threshold warning, then actual batting/fielding teams. There is no fake
  clock or freely selectable recording side. The inning remains authoritative.
- Line score is a dialog in focus and the existing inline table normally. Game
  uses `TrackerDialog`; rotation with either open keeps it reachable and closing
  returns focus to a visible control. Routine cloud controls move to the footer;
  confirmation/errors remain outside hidden focus controls. No enable/transport
  permission, RPC or state policy is altered.
- Pregame, terminal/final, pending-ending, unauthorized/loading-team and non-Track
  views do not enter focus. Pending-ending controls remain in the ordinary tracker.
  Existing checked capture, endings, lineup, correction and cloud guards remain.
- Basketball, Soccer, Hockey and Football behavior is not redesigned here.

## Observed Verification

- Full suite: **352 files / 3,629 tests passed**. The **21** new surface DOM cases
  cover semantic runner/fielder targets, keyboard activation, exact repeated
  locations, cancelled/held gestures, disabled pitch input, letterboxing, batter
  label separation and line-score dismissal.
- **7** committed real-tracker DOM integration cases cover mutation-free auto-focus,
  delayed team access, pregame/ended/final exclusion, draft preservation through
  Exit/Expand, one checked in-play commit and a no-pitch runner play. They render
  real components/hooks and sport commands, rather than invoking hook components
  as ordinary functions or replacing their command callbacks with success stubs.
- Synthetic Chromium: **21 workflows / 16 screenshots passed**. Light/Dark at
  390x844, 844x390, 568x320 and 1280x800; long team/player labels; both panes framed;
  score/count/pitcher context; line-score/Game dialogs; native and denied fullscreen;
  Back/Exit/rotation/suppression; warning/error visibility; zone-off, pregame, ended
  and cloud-final states; 9/10-fielder setups; draft-preserving in-play captures
  with exact spray coordinates and a single fielder entry; no-pitch steals;
  Lineup/Dashboard navigation; and rotation with an open cloud-enable confirmation.
  Screenshots were inspected.
- The initial browser fixture used "Single" instead of the shipped "1B" button
  label, then tried cloud enable with signed-out event ownership. The fixture was
  corrected to use the real label and an eligible synthetic owner-recorded local
  stream. No capture or cloud eligibility guard was relaxed to pass those checks.
- Configured TypeScript/Vite/PWA build with placeholder public backend values
  passed: **2,432 modules / 15 precache entries**, app asset **3,055,176 bytes**,
  **90,552 bytes** below the unchanged 3 MiB per-asset limit. Existing bundle,
  Browserslist and mixed-import advisories remain follow-ups; no budget was raised.
- Source lint (`pnpm exec eslint . --ignore-pattern "qa.local/**"`): **0 errors /
  3 existing Fast Refresh warnings**. Private/synthetic ignored QA fixtures are not
  shipped. Existing automated-review safety controls: **22 tests passed**.
- Changed-document routing: **103 relative targets validated**; whitespace checks
  passed. No ignored QA fixture or private recovery export is committed.

Document routing and exact-head CI results are recorded with this PR.
Local/browser evidence does not establish installed-PWA,
physical-phone, live backend or full-match signoff. Browser fixtures stub auth and
cloud, use synthetic roster data and real capture commands/reducers, and do not
read or write the owner's browser/game data. Existing owner-only post-deployment
validation and broader-rollout gates remain unchanged.

## Owner Post-Deployment Checks

1. Refresh used browsers/PWAs. Rotate an active Baseball game to landscape, or use
   Expand. Check the complete diamond, pitcher/count/warnings and scoring panel.
   Scroll the scoring panel while the diamond remains usable; check small-phone
   touch targets, safe areas, zoom and installed-PWA rotation.
2. Record a pitch, then an in-play ball. Choose a location and fielders, change
   layouts before runner confirmation, and verify the draft and final recorded
   result. Selecting a location alone must not record a pitch or play.
3. Tap a runner for a no-pitch play; verify runner resolution, the count, bases and
   pitch count. Use Recent Plays/Timeline for history, not a hold on current players.
4. Open line score/Game/cloud confirmation, rotate and dismiss. Test Back/Exit and
   focus return, then the normal retained-game sync/finalization workflow.

The separate second-game Basketball scoring report still awaits its export.
Football's future field consumes the shared interaction direction after its event
foundation; this slice does not start Football development or timing/lineup redesign.
