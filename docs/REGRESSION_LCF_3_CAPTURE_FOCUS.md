# LCF-3: Basketball Capture and Focus

Status: implemented for review on 2026-10-27. No Supabase migration. Physical-touch
and installed-PWA checks below are not claimed by desktop browser automation.

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

- Full suite: **344 files / 3,547 tests passed**, including 11 new gesture cases
  and three nested scroll-lock cases. TypeScript and production/PWA build pass;
  existing large-bundle advisory remains. No new dependencies.
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
