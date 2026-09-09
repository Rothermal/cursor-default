# THM-2 verification

## Automated and local evidence

- 203 files / 1,470 tests pass; TypeScript/production build pass; lint has zero
  errors and the same three existing Fast Refresh warnings.
- `src/lib/appearanceSurfaces.test.ts` inventories the 15 converted components,
  rejects raw utility palettes and color-transition classes, preserves Google's
  four brand colors, and verifies no production Settings theme control was added.
- One-off TypeScript AST comparison confirms only className attributes changed
  in the 15 existing components; no handlers, permissions, data, or markup changed.
- Edge/Playwright visited all seven Settings destinations (Account, App, Sports,
  Soccer, Basketball, Data, Advanced) in local-only mode at 390px and 1280px in
  both themes. No page errors or horizontal document overflow. Signed-out Auth
  rendered in both themes. Representative screenshots inspected.
- Browser checks used an isolated browser context and a local-only Vite process;
  no existing account or cloud settings were changed. The harness was temporary,
  not a committed browser suite.

## Deployed owner checks

1. Sign-in/signup/invite success and errors; keyboard focus and disabled states.
2. Pending/suspended/access-error screens with a real account, without changing
   roles solely for theme testing on a production account.
3. Account profile/provider rows, settings save/conflict/error, access/audit data,
   guardianship and merge review under the appropriate authorized account.
4. Native selects/date fields, sticky settings actions, keyboard and safe areas
   on an actual mobile device; inspect every sport-settings tab.
5. Installed PWA offline and update notices, including active-game update safety.

These live/deployed checks remain pending. Dark can be inspected locally through
the THM-1 appearance preview and then navigating to Settings; production stays
Light until the full release audit. Team/game pages outside this inventory are
not claimed theme-complete.
