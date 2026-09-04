# Plan: App theming and dark mode

Status: approved high-level direction; implementation phases not started

This roadmap makes StatKeeper themeable across authentication, administration,
team/game management, live sport workspaces, and review destinations. Light and
Dark are the first supported themes. The work is presentation-only: it must not
change game authority, event projection, cloud sync, access control, or sport
rules.

The implementation should land in small phases so context remains manageable and
each surface family can be reviewed independently. The Dark setting must not be
exposed to production users until the required surfaces pass the release audit.

---

## 1. Goals

- Replace the assumption that every app surface is white/slate-on-white with a
  semantic theme contract.
- Add **Light** and **Dark** as an App setting under `/#/settings/app`.
- Preserve Light as the default for existing, missing, or corrupt settings.
- Apply the saved theme before React renders, including Auth and App Access screens.
- Keep the selected theme through reload, sign-out, offline/PWA use, and app updates.
- Make future sport UIs consume the same semantic surfaces without inheriting a
  Basketball- or Soccer-specific palette.
- Preserve readable success, warning, error, selected, disabled, and focus states.
- Audit the Basketball court, Soccer pitch, markers, and sport-brand colors rather
  than mechanically inverting them.

## 2. Non-goals

- A broad visual reskin, layout rewrite, or typography redesign.
- A user-selectable accent color or per-sport application theme.
- A System/automatic theme in the first release.
- Cloud-synced appearance preferences in the first release.
- High-contrast, OLED-black, seasonal, or custom themes in the first release.
- Recoloring real-world play surfaces solely because the surrounding UI is dark.
- Storing theme choice in a game snapshot, sync fingerprint, event stream, or
  Supabase table.

These remain possible because the runtime contract uses a theme identifier and
semantic tokens rather than Light/Dark checks scattered through components.

---

## 3. Current-state audit

Planning inventory at the time this document was written:

- 157 TSX files and 35 routed page files.
- 115 source files contain an explicit white utility.
- 140 source files contain explicit slate utilities.
- Approximate high-frequency utilities include 375 `bg-white`, 106
  `bg-slate-50`, 395 `border-slate-200`, and hundreds of explicit slate text
  declarations.
- `tailwind.config.js` has no semantic color aliases or dark-mode configuration.
- `index.html` fixes the body to `bg-slate-50 text-slate-900` and has one static
  browser `theme-color`.
- `index.css` provides shared `.card` and `.input-field` classes, but both encode
  Light colors directly.
- `SettingsProvider` mounts only after auth and app-access gates. An effect inside
  it cannot prevent first-paint flash or theme Auth/App Access screens.
- `SoccerField` deliberately uses a green field, white markings, and explicit
  marker colors.
- `BasketballCourt` deliberately uses a wood-tone court and dark line colors.

A global background override is therefore insufficient. It would leave white
cards, low-contrast text, Light inputs, and mismatched dialogs throughout the app.

---

## 4. Settled product decisions

1. First-release choices are exactly **Light** and **Dark**.
2. Light is the compatibility default. Existing users do not change appearance
   until they explicitly choose Dark.
3. Appearance is a device-local App setting, not an account/team/sport setting.
4. The control lives in **Settings -> App**, separate from sport settings.
5. No quick header/footer theme toggle is required in the first release.
6. Theme applies to the entire application, including signed-out, access-gate,
   loading, offline, live-game, summary, and administrative surfaces.
7. The choice is presentation state only and cannot dirty, park, resync, or alter a
   game.
8. Intermediate phases may merge, but the public Dark selector remains unavailable
   until the release phase.
9. Existing sport header/accent colors remain sport-owned. Theme tokens own the
   surrounding surfaces and content contrast.
10. The Soccer pitch should normally remain green with light markings. The
    Basketball court should normally remain wood-toned. Both require marker,
    boundary, focus, and surrounding-panel contrast checks in Dark mode.
11. New components use semantic colors after the foundation lands. Raw colors
    remain allowed for deliberate data visualization, sport geometry, team colors,
    and branded/status graphics when documented by the component.

---

## 5. Theme contract

### 5.1 Stored preference

Extend device settings with a strict version-compatible value:

```ts
type AppThemePreference = 'light' | 'dark'

interface AppSettings {
  appearance: {
    theme: AppThemePreference
  }
  // existing fields remain unchanged
}
```

Requirements:

- Missing, malformed, or unsupported values resolve to `light`.
- `mergeStoredSettings` preserves existing partial/deep-merge behavior.
- The preference stays under `statkeeper_settings`; do not add it to parked-game
  export, game storage, or cloud settings.
- Provide one strict parser and one application helper rather than duplicating
  storage/document mutations in components.

### 5.2 Pre-React bootstrap

The document must know the theme before the module bundle and providers mount. Add
a tiny defensive bootstrap in the HTML head or an equivalent blocking entry script
that:

1. reads only the appearance preference from `statkeeper_settings`;
2. treats every error or unknown value as Light;
3. sets `data-theme="light|dark"` on `document.documentElement`;
4. sets the matching CSS `color-scheme`;
5. updates the browser/PWA `theme-color` to the active canvas/header color;
6. never blocks app startup when storage is unavailable.

The runtime setter applies the same document state synchronously. Bootstrap and
runtime behavior need contract tests or shared constants so accepted values and
colors cannot drift.

### 5.3 Semantic tokens

Define CSS custom properties for roles, not theme-specific names. Tailwind aliases
consume these variables with opacity support where needed.

| Token family | Purpose |
|---|---|
| canvas | page and safe-area background |
| surface | cards, sheets, headers, table bodies |
| surface-muted | secondary rows, filters, inactive regions |
| surface-elevated | dialogs, menus, popovers |
| content | primary text and icons |
| content-muted | supporting text |
| content-subtle | timestamps, placeholders, tertiary labels |
| line | ordinary borders/dividers |
| line-strong | emphasized control boundaries |
| control | default interactive background |
| control-hover | hover/pressed background |
| control-disabled | disabled fill/content treatment |
| focus | keyboard focus outline/ring |
| overlay | modal scrim |

Also define paired background/content/border treatments for `info`, `success`,
`warning`, and `danger`. Do not turn these states into neutral gray in Dark mode.
Sport themes and event-marker colors remain separate from application neutrals.

Recommended usage:

```tsx
<main className="bg-canvas text-content">
  <section className="border-line bg-surface text-content">
    <p className="text-content-muted">...</p>
  </section>
</main>
```

Avoid adding thousands of paired `dark:` utilities. A component may use a narrow
variant when the same semantic role genuinely needs different composition, but the
default migration path is token replacement.

### 5.4 Native and platform surfaces

- Set `color-scheme` so native inputs, selects, scrollbars, and browser UI match.
- Keep focus-visible treatment at least as clear as the current blue outline.
- Update mobile browser/PWA theme color when preference changes.
- Ensure overscroll/root backgrounds do not reveal Light behind a Dark page.
- Preserve reduced-motion behavior; theme switching should not animate the whole
  document or flash between palettes.

---

## 6. Conversion rules

1. Convert by semantic role, not global string replacement. `bg-white` may mean a
   card, selected tab, button, field, or text on a sport header.
2. Convert shared primitives before consumers: `.card`, `.input-field`, segmented
   controls, confirmation dialogs, sheets, notices, tables, and navigation.
3. Preserve selected/unselected contrast. A Light selected tab cannot simply become
   a Dark selected tab without checking its parent surface.
4. Preserve hierarchy with a small number of surfaces; do not make every section a
   floating card.
5. Review disabled controls independently. Opacity alone can make Dark controls and
   text disappear.
6. Keep destructive, warning, success, sync, and quarantine states distinguishable
   without relying only on hue.
7. Do not modify court/field coordinates, hit targets, event meanings, or exported
   data while changing presentation.
8. Avoid theme conditionals in domain libraries. SVG color props or CSS variables
   belong at the rendering boundary.
9. Every converted surface remains complete in Light mode.

---

## 7. Phase roadmap

### THM-1 - Runtime, tokens, and shared primitives

Goal: establish the contract without exposing an incomplete Dark experience.

- Add strict Light/Dark settings parsing and defaults.
- Add pre-React bootstrap and runtime document application helpers.
- Add semantic CSS variables and Tailwind aliases.
- Convert body/root, `.card`, `.input-field`, common buttons, segmented controls,
  confirmation dialogs, overlays, loading shells, and focus treatment.
- Test missing/corrupt/legacy settings, persistence, document state, and theme color.
- Add a development-only way to force either theme for phase verification.
- Keep the production Settings selector hidden.

Exit: first paint uses the persisted palette without a Light flash; shared
primitives and pre-auth roots render correctly; no domain/cloud contracts change.

### THM-2 - Shell, authentication, access, and Settings

Goal: complete the global framework around every workflow.

- Convert AppShell, Auth, invite/auth-return, App Access, PWA status, and global
  loading/error states.
- Convert Settings navigation and all Account/App/Sports/Data/Advanced panels.
- Convert shared audit, merge, guardianship, invite, and access dialogs.
- Validate sticky headers, safe areas, overlays, native controls, and focus.
- Keep the appearance selector release-gated.

Exit: signed-out, pending/suspended, local-only, authenticated shell, and every
Settings route are complete without Light-only islands.

### THM-3 - Teams, games, and aggregate destinations

Goal: convert sport-neutral operational and review workflows.

- Convert sport choice/dashboard, Teams, Team Info/Manage/Roster/Schedule, Seasons,
  Games, Game Info, Player Profile, Career, Leaderboard, Team Stats, and Tournament
  Stats.
- Convert common tables, filters, pagination, cards, empty/loading/error states,
  audit history, conflict/recovery, and cloud/local status presentation.
- Verify long names, dense tables, and mobile overflow in both themes.

Exit: all non-live management and aggregate routes are theme-complete, including
authority, provenance, warning, and unavailable states.

### THM-4 - Basketball surfaces

Goal: theme legacy and event-model Basketball without changing game behavior.

- Convert setup, player setup, checkout, tracker, Timeline, lineups, clock,
  administrative dialogs, finalization/reopen, Summary, and recovery/conflict UI.
- Audit BasketballCourt background, lines, made/miss markers, overlap counts,
  selection/focus, and located/unlocated lists in both surrounding themes.
- Exercise legacy aggregate and event-authority routes.

Exit: a complete Basketball game can be created, tracked, parked/resumed,
corrected, finalized, reopened, and reviewed in either theme; geometry and marker
meanings are unchanged.

### THM-5 - Soccer surfaces

Goal: theme the complete Soccer match workspace and review stack.

- Convert setup, player setup, tracker tabs, clock, lineup/role controls, event
  sheets, Timeline, restart/formation surfaces present at implementation time,
  recorder/finalization UI, Summary, and aggregate destinations.
- Audit SoccerField lines, markers, clusters, cards, selection, focus, direction
  controls, and embedded field editors.
- Preserve field green and event semantics unless contrast evidence requires a
  deliberate tokenized variant.

Exit: a complete Soccer game can be created, tracked, parked/resumed, corrected,
finalized, reopened, and reviewed in either theme; geometry and marker meanings
are unchanged.

### THM-6 - Release audit and App setting

Goal: expose Dark only after the complete required matrix is ready.

- Add the Light/Dark segmented control to Settings -> App.
- Remove the development force mechanism or keep it strictly DEV-only.
- Search for unexplained Light-only utilities and hard-coded colors; document
  intentional sport/data-visual exceptions.
- Run mobile, desktop, keyboard, PWA/reload, offline, and cross-theme regression.
- Verify switching themes never mutates GameState, dirty revision, event stream,
  sync queue, or parked records.
- Update AGENTS, codebase overview, regression docs, and user-facing README notes.

Exit: Light remains a complete safe fallback; Dark has no unreadable text,
invisible border, white flash, Light modal, or unthemed required route; the App
setting applies immediately and survives reload/sign-out/PWA restart.

---

## 8. Verification matrix

Each implementation phase adds a focused regression document. THM-6 combines them.

### Viewports and input

- Phone portrait around 390 x 844.
- Narrow phone around 320 x 568.
- Desktop around 1440 x 900.
- Touch/pointer and keyboard-only navigation.
- Installed/standalone PWA where available.

### Required states

- Loading, empty, populated, offline, sync pending, success, warning, error,
  unavailable, quarantined/incomplete, disabled, selected, hover, pressed, and
  keyboard focus.
- Local-only, authenticated active, pending/suspended access, and applicable team
  roles.
- Active, parked, nonfinal cloud, canonical final, reopened, and recovery flows.

### Accessibility targets

- Normal text contrast: at least 4.5:1.
- Large text contrast: at least 3:1.
- Meaningful control boundaries and focus indicators: at least 3:1 against
  adjacent colors.
- Information must not rely on color alone.
- Browser zoom and text enlargement must not hide or overlap actions.

### Automated coverage

- Strict settings parser/default/persistence tests.
- Bootstrap/runtime theme application tests.
- Inventory tests for required semantic roots and unexplained Light-only patterns
  where practical.
- Existing `pnpm lint`, `pnpm test`, `pnpm typecheck`, and `pnpm build` gates.
- Representative screenshot comparison if browser tooling is added; it does not
  replace interaction and contrast review.

---

## 9. Ownership boundaries

Likely foundation files:

- `index.html`
- `tailwind.config.js`
- `src/index.css`
- `src/lib/settingsStorage.ts`
- `src/context/SettingsContext.tsx`
- a small presentation-only theme helper/context if THM-1 requires it
- `src/pages/Admin.tsx` for the eventual Settings -> App control

Large conversion areas are `src/pages/`, shared `src/components/`, shot charts,
Basketball components, and Soccer components.

Do not place theme behavior in sport projectors/commands, `GameContext` sync and
persistence, event fingerprints/cloud payloads, Supabase, or immutable match setup.
No database migration is expected for the approved device-local first release.

---

## 10. Risks and controls

| Risk | Control |
|---|---|
| White flash before providers mount | Pre-React defensive bootstrap |
| Partial Dark mode reaches production | Hide public selector until THM-6 |
| Bulk replacement changes semantics | Convert by component role and review states |
| Light mode regresses | Treat Light as a test target in every phase |
| Sport markers disappear | Dedicated court/field contrast matrices |
| Native inputs remain Light | Root `color-scheme` plus browser testing |
| Theme dirties active games | Keep it outside GameState and fingerprints |
| Future themes require a rewrite | Theme identifiers plus semantic tokens |
| App/PWA browser chrome mismatches | Update theme-color at bootstrap and runtime |
| Context overload | One coherent surface-family PR per phase |

---

## 11. Deferred decisions

- Add `system` as a third preference and react to OS changes.
- Sync appearance across devices.
- Put a quick theme action in the global header/footer.
- Add high-contrast or OLED-black variants.
- Let users choose accents.
- Give a sport an alternate play-surface palette.

Each deferred item must extend the theme identifier/token contract rather than add
component-level global theme checks.

---

## 12. Detailed-planning handoff

Before each phase:

1. inventory exact components and routes;
2. select and record the Light/Dark token values;
3. identify meaningful raw-color exceptions;
4. write focused automated/manual regression coverage;
5. keep the phase within one coherent surface family;
6. update this roadmap with status and links.

Recommended order: THM-1, THM-2, THM-3, THM-4, THM-5, THM-6. THM-4 and
THM-5 may proceed independently after THM-1 through THM-3, but THM-6 requires
both.
