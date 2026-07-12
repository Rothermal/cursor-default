# Plan: NAV-2 Settings and admin split

Execution plan for the second navigation foundation slice from
[PLAN_APP_FOUNDATION_ROADMAP.md](PLAN_APP_FOUNDATION_ROADMAP.md). NAV-2 splits the current
long Settings/Admin page into focused settings destinations so routine preferences, account
controls, sport-specific configuration, data/sync tools, and advanced/destructive tools do
not all live in one scrolling surface.

NAV-2 should follow NAV-1's app shell and sport dashboard work. It should not require Google
OAuth or soccer implementation to be complete.

---

## 1. Goal

Make settings easier to scan and safer to use by introducing a focused settings structure:

```text
Settings
  -> Account
  -> App / General
  -> Sports
      -> Basketball
      -> Soccer later
      -> Future sports
  -> Data & Sync
  -> Advanced
```

The intent is to reduce scrolling, put sport-specific settings under the relevant sport,
and separate advanced/destructive admin tools from normal user preferences.

---

## 2. Current state

Current route and page:

- `/admin` renders `src/pages/Admin.tsx`.
- The page title is "Settings", but the route and component are still named Admin.
- The page is a single long screen with expandable sections.

Current `Admin.tsx` responsibilities:

- Enabled sport toggles.
- Basketball court-capture setting:
  - missed-shot rebound prompt.
- Local parked-game storage information.
- Parked game export/import.
- Cloud team shortcuts:
  - Teams & Rosters.
  - Cloud Games.
- Seasons:
  - create/edit/delete seasons.
  - basketball team stat rules per season.
- Player merge advanced tool and audit list.
- Data management/destructive deletion:
  - teams.
  - games.
  - players.
  - tournaments.
- Multiple confirmation dialogs and Supabase-backed loading/error states.

Current related files:

- `src/pages/Admin.tsx`
- `src/context/SettingsContext.tsx`
- `src/context/AuthContext.tsx`
- `src/context/GameContext.tsx`
- `src/components/SeasonTeamStatsEditor.tsx`
- `src/components/MergePlayerWizard.tsx`
- `src/components/ConfirmDialog.tsx`
- `src/lib/gameParking.ts`
- `src/lib/mergePlayerScope.ts`

---

## 3. Target UX model

Use a Settings hub plus focused sections. On mobile, each section should feel like its own
short page or route-level tab, not one giant accordion.

Recommended route shape:

```text
/#/settings
/#/settings/account
/#/settings/app
/#/settings/sports
/#/settings/sports/basketball
/#/settings/data
/#/settings/advanced

Legacy:
/#/admin -> redirects or aliases to /settings
```

Recommended section ownership:

| Destination | Owns |
|-------------|------|
| Account | signed-in email, sign out, future profile and connected sign-in methods |
| App / General | enabled sports and app-wide preferences |
| Sports | sport settings index |
| Sports -> Basketball | missed-shot rebound prompt, basketball team stat rules entry points |
| Data & Sync | parked-game storage, export/import, cloud game/team shortcuts |
| Advanced | player merge, destructive delete tools, diagnostics/debug utilities |

---

## 4. Settled NAV-2 decisions

- Account should be a separate tab/page, not buried in a long Settings scroll.
- Sport-specific settings belong under that sport.
- The basketball missed-shot rebound setting should move to Basketball settings.
- Keep broad visual reskin deferred; NAV-2 is structural polish.
- Keep `/admin` working for existing links during this phase.
- Do not build Google account linking in NAV-2; leave placeholders/structure for AUTH-2.
- Do not implement soccer settings yet; create a future-ready location only.
- Keep dangerous/destructive tools away from normal settings.

---

## 5. Recommended implementation shape

### Settings shell

Add a route-level settings shell that renders section navigation and the active section.

Suggested files:

- `src/pages/Settings.tsx`
- `src/components/settings/SettingsLayout.tsx`
- `src/lib/settingsNavigation.ts`

Responsibilities:

- Render a compact settings header.
- Provide route tabs/section links.
- Keep mobile section navigation easy to tap and avoid horizontal overflow.
- Preserve a clear Back action to sport choice or previous page.
- Let individual section components own their data loading and actions.

### Section components

Suggested files:

```text
src/components/settings/AccountSettings.tsx
src/components/settings/AppSettings.tsx
src/components/settings/SportsSettings.tsx
src/components/settings/BasketballSettings.tsx
src/components/settings/DataSyncSettings.tsx
src/components/settings/AdvancedSettings.tsx
```

These names can change during implementation, but the section boundaries should remain.

### Legacy Admin route

Recommended first pass:

- Keep `src/pages/Admin.tsx`, but reduce it to a compatibility wrapper that redirects or
  renders the new settings route.
- Add `/settings` and nested settings routes to `src/App.tsx`.
- Update app shell/settings buttons to use `/settings`.
- Keep `/admin` valid for older links and docs until later cleanup.

---

## 6. Section-by-section scope

### Account

NAV-2 scope:

- Show current signed-in email when Supabase is configured and a user exists.
- Provide Sign Out.
- Show an offline/local-mode message when Supabase is not configured.
- Reserve obvious placement for future display name and connected sign-in methods.

Deferred to AUTH-2:

- Editable display name.
- Connected sign-in methods.
- Manual "Link Google".
- Avatar behavior.

### App / General

NAV-2 scope:

- Enabled sport toggles.
- Any truly app-wide preferences that are not sport-specific.
- "No sports enabled" recovery path still works.

Guardrail:

- Do not place basketball-only settings here.

### Sports

NAV-2 scope:

- Show a sport settings index using `src/config/sports.ts`.
- Basketball links to `/settings/sports/basketball`.
- Disabled/future sports can be shown as disabled or "coming later" entries if they have no
  settings yet.

### Sports -> Basketball

NAV-2 scope:

- Move missed-shot rebound prompt here.
- Link or embed basketball team stat rules in a clear basketball area.
- Preserve current `SettingsContext` storage for `courtCapture.reboundPromptAfterMiss`.

Open implementation choice:

- Team stat rules currently live inside the Seasons section because they are configured per
  season. NAV-2 can either:
  - keep season CRUD in Data & Sync/Advanced and provide a Basketball settings link to the
    relevant team-stat editor area; or
  - move the season list/editor into Basketball settings with a sport filter.

Recommendation:

- Keep full season CRUD together in Data & Sync for NAV-2, but add a Basketball settings
  entry that explains/links to basketball team stat rules. Move the actual editor only if it
  stays small.

### Data & Sync

NAV-2 scope:

- Local parked-game storage usage.
- Export parked games.
- Import parked games.
- Cloud Teams shortcut.
- Cloud Games shortcut.
- Seasons CRUD if not moved elsewhere.

Rationale:

- Seasons are data/model management, not app preferences.
- Parked-game import/export and cloud game navigation are normal user-facing data tools,
  not advanced/destructive tools.

### Advanced

NAV-2 scope:

- Player merge advanced tool and recent merge audit.
- Destructive deletion tools for teams/games/players/tournaments.
- Any migration/diagnostic warnings that are mainly for operators.

Guardrails:

- Use explicit confirmation dialogs.
- Keep scary actions visually separated from routine settings.
- Preserve existing RLS/migration error messaging.

---

## 7. Routing plan

Add routes:

```tsx
<Route path="/settings" element={<Settings />} />
<Route path="/settings/account" element={<Settings />} />
<Route path="/settings/app" element={<Settings />} />
<Route path="/settings/sports" element={<Settings />} />
<Route path="/settings/sports/:sportId" element={<Settings />} />
<Route path="/settings/data" element={<Settings />} />
<Route path="/settings/advanced" element={<Settings />} />
```

Keep route:

```tsx
<Route path="/admin" element={<Admin />} />
```

Recommended `/admin` behavior:

- Redirect to `/settings`, or render `Settings` with a compatibility note only if needed.
- Do not remove `/admin` in NAV-2 because many pages and docs still reference it.

---

## 8. Detailed tasks

### D1: Settings route foundation

- [ ] Add settings route helpers.
- [ ] Add `Settings` page and section routing.
- [ ] Add `SettingsLayout` with section navigation.
- [ ] Add `/settings/*` routes in `src/App.tsx`.
- [ ] Keep `/admin` as a legacy route.
- [ ] Update NAV-1 app shell/settings links to point to `/settings`.

### D2: Extract app/general settings

- [ ] Move enabled sport toggles out of `Admin.tsx`.
- [ ] Preserve `SettingsContext.toggleSport` behavior.
- [ ] Keep the "at least one sport enabled" status visible.
- [ ] Verify sport choice still handles zero enabled sports with a Settings CTA.

### D3: Extract sport settings

- [ ] Add sports settings index.
- [ ] Add Basketball settings section.
- [ ] Move missed-shot rebound prompt to Basketball settings.
- [ ] Preserve the existing local storage key/shape for this setting.
- [ ] Add future-ready placeholder entries for soccer/future sports only if useful.
- [ ] Avoid enabling soccer by default.

### D4: Extract account settings

- [ ] Add Account section.
- [ ] Show signed-in email if available.
- [ ] Add Sign Out.
- [ ] Show offline/local-mode account message when Supabase is not configured.
- [ ] Add AUTH-2 placeholder copy only if it does not clutter the page.

### D5: Extract Data & Sync

- [ ] Move local parked-game storage usage to Data & Sync.
- [ ] Move parked-game export/import to Data & Sync.
- [ ] Move Cloud Teams and Cloud Games shortcuts to Data & Sync.
- [ ] Decide whether Seasons CRUD stays here in NAV-2.
- [ ] Preserve import result messages and error handling.
- [ ] Preserve storage estimate behavior.

### D6: Extract Advanced

- [ ] Move Player merge advanced tool to Advanced.
- [ ] Move destructive data management/delete tools to Advanced.
- [ ] Preserve existing delete confirmation dialogs.
- [ ] Preserve merge audit loading/error behavior.
- [ ] Preserve current Supabase/RLS/migration guidance messages.

### D7: Compatibility cleanup

- [ ] Replace obvious `navigate('/admin')` calls with `/settings` or a specific settings route.
- [ ] Keep fallback links to `/admin` harmless.
- [ ] Update route docs.
- [ ] Ensure `Settings` is reachable from the global app shell.
- [ ] Make sure `Back` actions do not trap users inside settings sections.

### D8: Documentation

- [ ] Update `AGENTS.md` with new settings/admin routing.
- [ ] Update `docs/AGENT_CODEBASE_OVERVIEW.md` route table.
- [ ] Update `docs/PLAN_APP_FOUNDATION_ROADMAP.md` if NAV-2 scope changes.
- [ ] Update `docs/REGRESSION_TESTING.md` with settings section checks.
- [ ] Update README if user-facing settings instructions change materially.

---

## 9. Suggested file list

Likely touched:

- `src/App.tsx`
- `src/pages/Admin.tsx`
- `src/pages/Settings.tsx`
- `src/components/settings/SettingsLayout.tsx`
- `src/components/settings/AccountSettings.tsx`
- `src/components/settings/AppSettings.tsx`
- `src/components/settings/SportsSettings.tsx`
- `src/components/settings/BasketballSettings.tsx`
- `src/components/settings/DataSyncSettings.tsx`
- `src/components/settings/AdvancedSettings.tsx`
- `src/lib/settingsNavigation.ts`
- `src/components/AppShell.tsx`
- `AGENTS.md`
- `docs/AGENT_CODEBASE_OVERVIEW.md`
- `docs/REGRESSION_TESTING.md`

Possibly touched:

- `src/context/SettingsContext.tsx` if sport-specific settings need clearer grouping helpers.
- `src/pages/SportSelect.tsx` or `src/pages/SportDashboard.tsx` if Settings CTAs need route
  updates.
- `src/pages/Leaderboard.tsx`, `src/pages/TeamInfo.tsx`, `src/pages/TeamRoster.tsx`,
  `src/pages/TeamSchedule.tsx`, `src/pages/GameInfo.tsx`, `src/pages/SeasonInfo.tsx` for
  `/admin` link updates.

---

## 10. Acceptance criteria

- `/settings` loads a settings hub or default settings section.
- `/settings/account` shows account status and sign-out behavior.
- `/settings/app` shows enabled sport toggles.
- `/settings/sports` shows sport settings entry points.
- `/settings/sports/basketball` contains the missed-shot rebound prompt.
- Toggling missed-shot rebound prompt still controls the F9 rebound-after-miss popup.
- `/settings/data` contains parked-game storage/export/import and cloud data shortcuts.
- `/settings/advanced` contains player merge and destructive data management tools.
- `/admin` still works and leads users to the new settings experience.
- Existing destructive actions still require confirmation.
- Existing import/export behavior and messages remain intact.
- Supabase-unconfigured local mode still renders settings sections without cloud-only crashes.
- Settings pages are shorter and avoid the current long-scroll admin layout.

---

## 11. Regression tests

Automated:

- Run `pnpm test`.
- Run `pnpm build`.
- Run `pnpm lint` and note existing Fast Refresh warnings if unchanged.
- Add unit tests for route helper functions if `settingsNavigation.ts` has logic beyond
  simple string builders.

Manual:

- Open `/settings`, `/settings/account`, `/settings/app`, `/settings/sports`,
  `/settings/sports/basketball`, `/settings/data`, and `/settings/advanced`.
- Open `/admin` and verify compatibility behavior.
- Toggle enabled sports and verify sport choice reflects the change.
- Toggle Basketball missed-shot rebound prompt:
  - disabled: missed court shot does not open rebound prompt.
  - enabled: missed court shot opens rebound prompt.
- Export parked games from Data & Sync.
- Import parked games from Data & Sync and verify result messaging.
- Cloud-enabled account:
  - Cloud Teams shortcut works.
  - Cloud Games shortcut works.
  - Seasons list/create/edit still works if kept in NAV-2.
  - Player merge advanced tool still opens and audit messaging still works.
- Destructive tools:
  - confirm dialogs still appear.
  - cancel leaves data unchanged.
- Supabase not configured:
  - account section shows local/offline mode.
  - cloud-only sections do not crash.

---

## 12. Risks and guardrails

- **Large component extraction:** `Admin.tsx` is big and stateful. Extract sections in a way
  that preserves current behavior before polishing.
- **Cloud-only assumptions:** some sections require Supabase. Keep clear unavailable states
  when `isConfigured` or `user` is absent.
- **Accidental data loss:** destructive actions must keep confirmations and current RLS/error
  handling.
- **Settings storage drift:** moving the rebound prompt must not change the
  `statkeeper_settings.courtCapture.reboundPromptAfterMiss` storage shape.
- **Scope creep into AUTH-2:** Account section can show current identity and sign out, but
  profile editing and Google linking belong to AUTH-2.
- **Scope creep into soccer:** create the structure for sport settings, but do not define
  soccer settings yet.
- **Nested-card cleanup:** while extracting, avoid creating cards inside cards for whole
  sections. Repeated rows, forms, and modals can stay card-like; page sections should be
  simple focused layouts.

---

## 13. Pre-handoff decisions for implementation

Recommended defaults are listed first.

- **Settings navigation:** route-level tabs/sections using `/settings/...`.
- **Legacy `/admin`:** redirect/alias to `/settings`.
- **Account in NAV-2:** current email/sign-out/local-mode status only; AUTH-2 fills in
  display name, connected methods, and Google linking.
- **Basketball rebound prompt:** move to `/settings/sports/basketball`.
- **Season CRUD:** keep with Data & Sync in NAV-2 unless extraction proves cleaner under
  Basketball settings.
- **Player merge:** Advanced.
- **Destructive delete tools:** Advanced.
- **Visual scope:** structural polish only; no broad reskin.

No additional product decisions are required before implementation if these defaults are
accepted.
