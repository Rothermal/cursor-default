# THM-1: Appearance foundation

Status: implemented in this PR; downstream page conversions remain THM-2 through
THM-6. Parent: [App theming](PLAN_APP_THEMING.md).

## Approved Q&A

1. Dark uses neutral charcoal canvas, lighter surfaces, and off-white text.
2. Light is deliberately refined, not frozen to existing white/slate utilities:
   soft neutral canvas, white surfaces, clear borders, and near-black text.
3. Both palettes live in one clearly labeled file. Components consume semantic
   roles, so changing the blend does not require editing individual screens.
4. Switching is instant; no appearance fade or page reload.
5. Other open tabs follow the device preference without touching game state.
6. If saving fails, apply the selection for the session and show a persistence
   warning. Missing/unreadable preferences start Light.
7. Production stays Light until THM-6; development has a preview. Saved Dark
   preferences are preserved but not activated by an intermediate production
   build. This intentionally tightens the earlier selector-only release gate.
8. Plan and implementation ship in this same PR. Branding remains TBR-1/TBR-2.

## Implementation map

- `public/appearance.css`: single RGB palette source, semantic neutral/status/
  action pairs, root first-paint styling. Tailwind opacity aliases consume it.
- `public/appearance.js`: blocking classic script, strict version-1 parser,
  dedicated `statkeeper_appearance` key, one document writer, storage errors,
  subscriptions, and cross-tab updates. No separate bootstrap parser can drift.
- `index.html`: stylesheet before blocking script, both before React. Base-aware
  URLs support GitHub Pages. Vite copies these public assets without bundling;
  its classic-script/static-URL notices are expected. Both assets enter PWA
  precache through the existing JS/CSS glob.
- `vite.config.ts`: development-only activation attribute; built HTML disables
  Dark. Manifest theme chrome uses fixed neutral `#35383e`; the splash background
  stays Light canvas `#f4f5f7` until THM-6 revisits the release policy. Static HTML
  theme-color also defaults to Light. Dynamic HTML chrome derives
  from the active CSS canvas token rather than another palette constant.
- `src/context/AppearanceContext.tsx`, `src/main.tsx`: appearance subscription
  outside Auth/Settings/Game providers, shared by signed-out and signed-in UI.
- `src/lib/appearanceRuntime.ts`: stable non-writing Light fallback when the
  blocking script is unavailable; presentation failure cannot blank the app.
- `tailwind.config.js`, `src/index.css`: semantic aliases, shared card/input/
  primary/secondary controls and focus styling. Existing dimensions remain.
- `src/components/ConfirmDialog.tsx`: shared modal surface, scrim, semantic
  actions, error state; existing focus/keyboard behavior retained.
- `src/App.tsx`: neutral loading text and development-only preview entry.
- `src/pages/AppearancePreview.tsx`: unauthenticated `/#/dev/appearance` diagnostic
  with segmented Light/Dark controls, real shared inputs/buttons/dialog, and
  semantic notices. Not included as a production route.

## Scope boundaries

No global replacement of raw colors. Sport-specific sheets, page-owned segmented
controls, tables, navigation, Auth and access forms remain their owning later
phases. THM-1 themes root/loading surfaces, not every pre-auth form. There is no
existing universal segmented-control component to refactor; the diagnostic
demonstrates its semantic selected/unselected treatment for later conversions.

No branding values, persistence, uploads, game changes, cloud writes, schema
changes, or public Settings control. Existing Light pages gradually adopt the
new palette as their phase lands; shared primitives already use it.

## Release and follow-up

THM-6 must deliberately replace the development-only activation policy with the
production release policy in both bootstrap and runtime, add the App setting,
and test saved preference activation without a light flash. Do not enable it by
only adding a visible selector. The built preview remains unavailable.

THM-2 owns shell/Auth/access/Settings conversions. TBR-1 later scopes accent
overrides to team destinations, while surface/text/status tokens remain owned
by appearance. Do not place team-specific tokens on the global document root.

See [verification](REGRESSION_THM_1_FOUNDATION.md).
