# THM-2: Shell, authentication, and Settings

Status: implemented; deployed account/PWA verification remains pending.
Depends on [THM-1](PLAN_THM_1_FOUNDATION.md); parent [roadmap](PLAN_APP_THEMING.md).

## Scope and decisions

Continue the approved neutral Light/Dark palettes without changing layout,
navigation, auth, access permissions, settings persistence, or sport behavior.
Production remains Light-only through the existing THM-6 release gate. No new
product decisions or database migrations are required for this presentation slice.

Convert by visual role: neutral canvas/surfaces/content, semantic notices,
selected controls, contrasting toggle thumbs, borders, focus, and disabled states.
Settings no longer uses a fixed dark gradient header. Existing sport icons and
Google's brand paths remain unchanged. Remove color transitions on the converted
surfaces so appearance updates are instant; retain transform/motion behavior.

## File inventory

- `src/components/AppShell.tsx`: sticky global shell and navigation.
- `src/pages/Auth.tsx`, `src/pages/AppAccessGate.tsx`, `src/pages/TeamInvite.tsx`:
  sign-in/signup, pending/suspended/error, and invite states.
- `src/components/PwaStatus.tsx`: offline/update/status surface and actions.
- `src/pages/Admin.tsx`: Account/App/Sports/Data/Advanced host, section navigation,
  enabled-sport controls, season and data-management UI.
- `src/components/settings/AccountSettings.tsx`, `AppAccessPanel.tsx`: identity,
  connected providers, account access, validation and result messages.
- `src/components/settings/SoccerSettings.tsx`, `BasketballSettings.tsx`,
  `BasketballRulesSettingsFields.tsx`: all personal tabs, fields, conflict notices,
  effective rule previews, toggles, and sticky action bars.
- `src/components/AuditTrailPanel.tsx`, `MergePlayerWizard.tsx`,
  `PlayerGuardiansDialog.tsx`, `SeasonTeamStatsEditor.tsx`: shared operational
  panels/dialogs reachable from settings or management workflows.

Shared rule/audit/guardian components also affect their Team Manage callers;
those outer page surfaces remain THM-3. The shared ConfirmDialog is already
converted in THM-1. OAuth return handling has no separate rendered page to theme;
its errors use Auth. No domain or transport files change.

## Verification and boundaries

The targeted component changes are limited to className attributes. A one-off
TypeScript AST comparison against the merged baseline confirms that removing
those attributes yields identical component code. Color-inventory tests cover
all 15 files, preserve Google branding, and retain the production appearance gate.

See [regression record](REGRESSION_THM_2_SHELL_SETTINGS.md). Local-only Settings
and signed-out browser checks are not evidence of live account mutation or
installed-PWA testing. Those remain explicit deployment checks, without expanding
this styling PR into changes to authentication or access workflows.

Next: THM-3 operational team/game/stat pages. Team colors/logos remain TBR-1/TBR-2
after THM-6; no team-level CSS overrides are introduced here.
