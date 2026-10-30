# LCF-3: Basketball Capture and Focus

Status: merged in #513 on 2026-10-27. No Supabase migration. Physical-touch
and installed-PWA checks below are not claimed by desktop browser automation.
Soccer/Hockey adoption is recorded separately in the
[sibling regression record](REGRESSION_LCF_3_SOCCER_HOCKEY.md).

## Implemented Contract

- Writable full-court Basketball: short tap opens the existing capture sheet at
  that exact canonical point, including an occupied marker. Saving remains explicit.
  Identical locations are permitted without jitter, replacement or score changes
  caused by simply opening a sheet.
- Stationary hold starts review at 500 ms. Existing overlap resolution chooses
  deterministically; keyboard Enter/Space still reviews the focused marker.
  Release and pointer-generated click after a hold do not also capture.
- Movement beyond the existing 18 px tolerance, scrolling, a second pointer,
  pointer cancellation/lost capture, resize, blur, hidden document or unmount
  cancels pending input. Browser pan/pinch behavior is not disabled. The threshold
  is an initial value, not claimed as tuned on a physical device.
- Expand opens a viewport-filling court; native fullscreen and landscape lock
  are optional enhancements. Denial/absence leaves the in-app layout usable.
  Phone-like landscape viewports auto-focus; wide desktop windows do not.
  Actual screen orientation, where available, prevents a portrait software
  keyboard from being mistaken for rotation.
- Exit, Escape and browser/Android Back leave focus. Exit suppresses automatic
  re-entry until a later portrait/landscape cycle. Route navigation replaces the
  transient focus entry; it does not add a second recorder or GameContext.
- Compact score, period/clock, Start/Pause, team selector and three-dot Game menu
  remain above the court. Quick actions move into that menu; chart filters/tools
  and clock options remain accessible in disclosures. Failure/conflict warnings
  retain their review/retry/export actions. Optional routine sync/recorders remain
  accessible by leaving focus through the menu.
- Full SVG bounds and aspect ratio stay intact; unused letterbox space does not
  create a baseline shot. No fake CSS rotation. Dialogs remain inside the native
  fullscreen subtree, with focus management and nested scroll-lock cleanup.
- The manifest changes from `portrait` to `any`, affecting the installed app's
  orientation preference, not event/game metadata. Existing installations may
  need a manifest refresh before rotation behavior changes.

Read-only Summary/legacy full-court charts still use short-click review. Existing
half-court gestures are unchanged. Soccer/Hockey adoption is the next sibling
pass, not included here; Baseball's diamond controls require their own assessment.
Football remains paused. Existing clock/substitution command guards are unchanged.

## Automated Evidence

- Full suite after PR review updates: **346 files / 3,562 tests passed**,
  including 11 recognizer cases, three nested scroll-lock cases and 15 committed
  DOM/hook cases. TypeScript and production/PWA build pass; existing large-bundle
  advisory remains. No new runtime dependency; dev-only JSDOM runs the two new
  interaction files within the normal `pnpm test`/CI command.
- Source lint (`pnpm exec eslint . --ignore-pattern "qa.local/**"`) passes with
  zero errors and the three existing Fast Refresh warnings. Plain `pnpm lint`
  also traverses ignored local QA fixtures and reports two pre-existing unused
  variables there; those unrelated fixtures are not changed or committed.
- Chromium/Playwright: **21 browser workflows passed**, with **16 screenshots**
  across Light/Dark, 390x844 portrait, 844x390 and 568x320 phone landscape, and
  1280x800 desktop. Checked full-court framing, long names, score/context, menu
  sheets, small-landscape bounds, Tab trapping and SVG focus return.
- Exercised exact stacked captures, deterministic overlap choice, mouse and
  browser-generated touch holds with no release capture, drag, pointer cancel,
  second touch, scroll/resize cancellation, blank holds, flipped coordinates,
  keyboard review and read-only short-click review.
- Exercised automatic landscape, exit suppression/orientation cycle, actual
  browser fullscreen entry/exit and its dialog subtree, forced fullscreen denial,
  Back with an open sheet, hash-router return from Summary, and a portrait-screen
  software-keyboard-shaped viewport. Nested sheets retain their scroll lock until
  closed. A running clock remains running through focus/tools/workspace changes;
  event count and sync fingerprint stay unchanged by those presentation actions.

The ignored local browser harness uses synthetic players and real tracker/projector
commands under StrictMode/HashRouter with auth/cloud transport stubbed; no owner
export or cloud game is used. Browser-emulated touch is not physical-device signoff.

## PR Review Follow-Up

Both notes on the initial #513 head were validated and addressed:

- A team-role lookup starts with capture eligibility unavailable. The original
  disabled branch called the same `exit()` as a user action, setting suppression
  before permission finished loading. Passive disable now closes focus/releases
  browser presentation without changing the explicit-exit preference. Access
  checks themselves are unchanged. Explicit Exit/Back/menu behavior still
  suppresses automatic entry until the documented orientation cycle.
- `useTrackerFocus.test.ts` mounts the actual hook under StrictMode, including a
  pending-access view without the tracker root. Seven tests cover delayed
  eligibility, temporary loss/recovery, explicit exit persistence, rotation and
  desktop/portrait-keyboard exclusions. The old disabled branch fails two cases.
- `BasketballFullCourt.test.ts` mounts the actual component, gesture hook and
  marker in JSDOM. Eight tests exercise DOM capture/bubble propagation, pointer
  click suppression, hold/release, non-bubbling descendant scroll, cancellation,
  second touch, keyboard/read-only activation and teardown. Only SVG layout is
  stubbed to an identity transform; these do not replace real geometry/browser QA.
- Mutation checks confirm these are effective regressions: removing court click
  suppression fails five cases; removing the scroll listener fails one. Both
  guards were restored unchanged, and the focused suite passes all 15 cases.
  This closes the CI coverage gap; the existing browser matrix is retained.

## Owner Follow-Up

1. Refresh the deployed app and any installed PWA; confirm the new build. Rotate
   an ordinary setup/settings page in both directions, then return to portrait.
   The app should remain navigable without horizontal page overflow.
2. In a test full-court Basketball game, save several shots at one exact spot.
   A short tap there should still open capture; hold about half a second to review
   the overlap list. Review/edit is explicit and release must not open capture too.
3. Try a scrolling finger, cancelled press and two-finger pinch. None should save
   an event. Check display Flip and both basket directions; capture remains at
   the location shown, with normal sport-owned value/actor checks.
4. Rotate a phone into landscape. Check score, clock, teams, whole court, error
   actions, Game menu, free-throw/foul/lineup sheets and chart filters in Light
   and Dark. Try small screens and long names. Close sheets with normal controls.
5. Try Expand with native fullscreen allowed and denied/unavailable. Exit, Back
   and Escape should remain usable; exiting should not immediately auto-expand
   again. Rotate to portrait and back to permit a new automatic entry.
6. Start the clock, then rotate, expand/exit and browse menus. These actions must
   not pause/reset it, add events, substitute players or change attacking ends.
   A real period expiration still follows existing clock policy.

Physical mobile touch, actual orientation-lock support, installed-PWA manifest
updates and live cloud sync/finalization remain post-deployment owner checks.
These are not a new broader-release signoff. The separate second-game scoring
report remains open pending its export; LCF-3 makes no speculative scoring fix.

## Browser References

The implementation keeps browser APIs optional, following the current
[Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API),
[orientation lock](https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock)
and [manifest orientation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/orientation)
contracts. Browser automation is not proof of physical-device support.

## Counted Shot Stacks Follow-Up (2026-10-30)

Status: implemented for review. No migration or event/score/authority changes.

- The live full court and full-court Summary replace overlapping visible shots
  with a numbered stack. Singles retain their made-dot/missed-cross appearance.
  Counts use the current display filters, not hidden shots or linked assists.
- Grouping is deterministic in canonical full-court feet, within the existing
  2.1-foot marker tolerance. Every pair in a stack must fit that tolerance, so a
  chain of neighboring shots cannot combine into a court-wide stack. Rendering
  uses the group's mean position without changing any stored event location.
- A writable short tap still captures at the actual tapped point. A 500 ms hold,
  or keyboard Enter/Space, opens every shot in that displayed stack, newest first.
  Read-only Summary uses a short click for the same chooser. The count stays
  upright when the view is flipped; padding keeps baseline/corner badges visible.
- The existing **Select shot -> Shot detail -> Edit** flow was already present.
  Stack activation now supplies the exact displayed group instead of rerunning
  nearest-point selection, which could omit members of a nearby stack. Rows retain
  shot ordinals, shooters, results and values. Checked corrections and existing
  read-only/terminal restrictions are unchanged; no new editor is introduced.
- Half-court charts and placement/play-map consumers retain their existing
  individual-marker contracts. This follow-up changes no Soccer/Hockey gestures.

Browser evidence: **13 workflows passed**, with **16 screenshots** across
Light/Dark and 390x844, 844x390, 568x320 and 1280x800 viewports. Checked exact
stacked capture/count increases, complete choice lists, selected-shot-only saving,
moving one shot out of a stack, unchanged review fingerprints, local Summary Edit
and read-only Summary filtering. Synthetic fixtures use real checked commands
with auth/cloud transport stubbed, not owner game data or live Supabase.

Automated checks: **354 files / 3,653 tests passed**, including 24 new tests for
grouping, gesture/keyboard wiring, exact stack choice, selected-shot-only saving,
Summary filters/authority, focus return and boundary/large-count rendering.
TypeScript and configured production/PWA build pass. Source lint has zero errors
and the three existing Fast Refresh warnings; review-tooling checks pass (22).
The existing PWA asset budget is unchanged. Physical-device/installed-PWA and
live-cloud checks remain post-deployment owner validation, not claimed signoff.

Owner smoke check after deployment:

1. Save two or more Basketball shots at the same spot. Check the count, then add
   another with a short tap; it should increase without changing earlier shots.
2. Hold the count, choose a shot by number/player/result, then Edit. Move or change
   only that shot; check the resulting count and the other shots' unchanged facts.
3. Filter by player/result in Summary and flip the court. Check visible counts,
   upright numbers and read-only review. Repeat on a phone/installed PWA when able.
