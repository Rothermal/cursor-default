# THM-6: Appearance release

Status: implementation complete; owner approved enabling the single-user
deployment before manual real-game/cloud and installed-PWA signoff. This is not
a claim that the complete manual matrix passed. No migration is needed.

## Released behavior

Settings -> App -> Appearance offers Light and Dark. Light remains the default.
The existing pre-React runtime owns parsing, storage, theme-color/color-scheme
updates, cross-tab changes and storage-failure feedback. The choice survives
sign-out on the same browser/device and does not synchronize between devices.
No game, event, settings-schema or cloud payload is changed by this feature.
If saving fails, the current session still changes theme and shows a warning.
Missing bootstrap disables the controls with the existing reload error.

`APPEARANCE_RELEASE_ENABLED` in `src/lib/appearanceReleasePolicy.ts` controls the
production document flag, which also controls Settings visibility. Set it to
false and redeploy to force Light and hide the control without erasing the
saved Dark choice. Development preview remains available. This switch applies
to all users; it is not an app-admin permission or per-account allowlist.

## Audit and verification

- Full suite: 206 files / 1,725 tests passed. TypeScript and production/PWA build
  passed. Lint has zero errors and the three existing Fast Refresh warnings;
  existing bootstrap/CSS, Browserslist and bundle-size warning categories remain.

- Full page/component utility-color audit includes the dev shot-chart preview;
  no raw Tailwind palette utilities remain. Fixed Google logo paths and named
  sport artwork tokens retain their intended visual semantics.
- Existing appearance tests retain malformed-storage fallback, session-only
  storage failure, cross-tab removal, game/settings isolation and rollback tests.
- Release tests cover the centralized policy, App routing, selected/disabled
  controls, accessible errors and mobile zoom. The old viewport zoom prohibition
  was removed so users can enlarge content.
- Browser interaction checks at 320, 390 and 1280 pixels: pointer/keyboard theme
  choice, selected states, reload, cross-tab updates, storage failure, no document
  overflow, and unchanged seeded game/manifest/settings records. These use the
  real AppearanceSettings and provider, not a replica of the control.
- Production build first paint passes in both themes with the React bundle
  blocked. Production Dark sign-in rendering was inspected in a mobile screenshot.
- The generated service worker serves a Dark sign-in shell after offline reload.
  The harness explicitly registers the worker because normal app registration
  happens after sign-in. This is not installed/standalone device signoff.
- Prior THM-4/5 browser and domain-test evidence remains applicable; this batch
  does not repeat full Basketball/Soccer gameplay or use live cloud writes.

## Post-deployment checks

1. Open Settings -> App, select Dark, reload, and check Light again. Sign out and
   confirm the sign-in page preserves the choice; sign back in.
2. Check one Basketball and one Soccer game through tracking, parking/resuming,
   correction and Summary. Check live cloud sync/finalization/reopen when convenient.
3. Check recorder conflicts, canonical/alternate review, populated shootout and
   role-specific management views as those workflows are used.
4. On the actual installed phone PWA, check launch/relaunch, offline cached launch,
   keyboard focus, pinch zoom and large-text layouts. Browser chrome and OS splash
   behavior may differ from desktop emulation.
5. Confirm no theme-only action creates unsynced game changes. Record any visual
   issues for iteration; switch back to Light as a local fallback.

Keep these outstanding checks visible before expanding beyond the current user.
Team branding remains the separate next roadmap, not part of appearance storage.

## Review follow-up

Rendered-control tests now cover the disabled missing-bootstrap state, hidden
rollback state and distinct Light/Dark segments. The palette scan includes all
`src/**/*.tsx` files. Disabled text/background and unselected control pairs are
contrast-tested; Light disabled text was slightly darkened to meet 4.5:1.

On the actual touch device, specifically check Soccer pitch single-tap capture,
vertical scrolling, pinch zoom and double-tap behavior before and after zoom.
Basketball currently uses `touch-action: pan-y`; Soccer does not. No broken Soccer
capture has been demonstrated, so this release does not copy the Basketball
restriction speculatively. Decide any pitch-specific gesture change using those
results, preserving zoom elsewhere. This remains a post-deployment follow-up.
