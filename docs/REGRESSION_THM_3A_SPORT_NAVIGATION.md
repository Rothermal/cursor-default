# THM-3A verification

## Scope

SportSelect and SportDashboard only. Shared shell is THM-2. Management routes
linked from these pages remain in later THM-3 slices. Production remains Light.

## Checks

Automated validation: 203 files / 1,491 tests pass; TypeScript/production build
pass; lint has zero errors and the same three existing warnings. One-off Edge
checks visited sport choice, Basketball dashboard, disabled Hockey, and missing
sport routes at 390px and 1280px in both themes. No page errors or horizontal
document overflow; empty-dashboard screenshots inspected in Light and Dark.
Populated active/parked histories remain a deployed follow-up, not claimed by
the empty-state browser run.

- Shared color ownership tests cover both files, including arbitrary colors.
- Verify Light/Dark sport choice, dashboard, missing/disabled sport and local
  cloud-unavailable state at narrow and desktop widths.
- Review active and parked names, score/sync labels, Resume and Discard in both
  themes without changing their handlers or introducing appearance state into
  game data. Long labels must remain contained by their existing truncation.
- New Game availability and existing-game access remain sport-policy-owned.

Deployed owner checks for real parked/cloud histories and installed-PWA use
remain pending. This slice adds no migrations or public appearance selector.
