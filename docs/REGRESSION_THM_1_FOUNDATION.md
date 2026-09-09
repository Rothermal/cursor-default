# THM-1 verification

Initial implementation validation: 202 files / 1,451 tests pass; TypeScript/production
build pass; lint has zero errors and the three existing Fast Refresh warnings.
PR review validation: 202 files / 1,453 tests pass; build and lint remain clean
apart from the same existing warnings. Edge with `appearance.js` deliberately
blocked still renders the preview on the Light canvas, shows the unavailable
controls notice, and reports no page errors.

## Automated contracts

`src/lib/appearance.test.ts` executes the actual blocking script in an isolated
runtime: strict parsing, saved first paint, runtime document/meta updates,
production Light gating without erasing Dark, blocked storage session fallback,
subscriptions, cross-tab changes and clear/removal, unrelated storage isolation,
and legacy settings/game preservation.
Palette tests also verify normal-text contrast for the primary, supporting,
action, and semantic status foreground/background pairs in both modes.
PR review coverage pins the real HTML meta, stylesheet/bootstrap ordering,
build activation expression, Light splash and fixed theme chrome, plus a stable
non-writing runtime fallback when the bootstrap is absent.
Follow-up review coverage pins the provider's fallback call, requires exactly
two palettes (accepting either CSS quote style), and compares each palette's
token names and variable mappings against the evaluated Tailwind configuration.

The Soccer release diagnostic inventory explicitly includes the new preview;
no sport release policy is changed.

## Browser matrix

Use local development `/#/dev/appearance` without signing in. Verify both themes
at mobile and desktop widths, input/select/placeholder/disabled contrast,
confirmation focus and Escape, no overflow, and cross-tab/reload persistence.
Production build must contain the disabled activation attribute, base-correct
appearance assets and PWA precache entries, without the diagnostic route bundle.

## Deployment follow-ups

Local Edge/Playwright checks passed at 390px and 1280px in Light and Dark:
screenshots inspected, no horizontal overflow or page errors, confirmation/Escape,
cross-tab updates, and reload persistence. This was a one-off local harness,
not a committed browser automation suite.

Production Edge verification with `pnpm preview --base /cursor-default/` also
passed: saved Dark remains stored, effective theme is Light, root canvas is
`rgb(244, 245, 247)`, and there are no page errors. Both appearance assets are in
the generated service-worker precache. Use the explicit base for preview because
the existing Vite configuration otherwise uses the development base in serve mode.

- Installed PWA update/offline cold start and fixed splash/task-switcher chrome
  need real-device verification; this PR does not claim that signoff.
- Full sport/page contrast and dark release remain THM-2 through THM-6.
- Recheck Light shared primitives in real team/game pages as those pages convert;
  legacy inline utilities can still override shared classes until migrated.
