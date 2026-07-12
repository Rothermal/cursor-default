# Plan: NAV-1 App shell and sport dashboards

Execution plan for the first navigation foundation slice from
[PLAN_APP_FOUNDATION_ROADMAP.md](PLAN_APP_FOUNDATION_ROADMAP.md). NAV-1 introduces a
sport-aware app structure while keeping the existing basketball game flow and legacy routes
working.

---

## 1. Goal

Make the authenticated app easier to navigate and ready for multiple sports by splitting the
current home responsibilities into:

- **Sport choice:** choose the sport context after login.
- **Sport dashboard:** resume/start/manage work for one sport.
- **Global app shell:** persistent access to core global destinations, especially Settings.

NAV-1 should be a functional re-architecture with light visual polish only. A broad reskin
is intentionally deferred until the UI hierarchy is stable.

---

## 2. Current state

Current route table:

- `/` renders `SportSelect`.
- `SportSelect` currently handles sport choice, active game resume, parked games, new game
  creation, Cloud Games, Teams, Season Stats, Settings, sign-out, and sync/status display.
- `/setup`, `/players`, `/checkout`, `/game`, `/summary` are the current live-game path.
- `/teams`, `/team`, `/games`, `/leaderboard`, and related drill-downs are global routes.
- `HashRouter` is required; URLs are `/#/path`.

Current implementation starting points:

- `src/App.tsx` route table.
- `src/pages/SportSelect.tsx` current overloaded home screen.
- `src/context/GameContext.tsx` exposes active game, parked games, start/park/resume/discard.
- `src/context/SettingsContext.tsx` exposes enabled sports.
- `src/config/sports.ts` defines all sport configs; Basketball is enabled by default, Soccer
  exists but is disabled by default today.
- `src/lib/teamInfo.ts` owns team route helpers such as `gameSetupPath`.

---

## 3. Target UX model

```text
Login / Auth
  -> Sport choice (/, /sports)
      -> Basketball dashboard (/sport/basketball)
          -> Resume active basketball game
          -> Parked basketball games
          -> New basketball game
          -> Basketball teams
          -> Basketball cloud games
          -> Basketball season stats
      -> Soccer dashboard (/sport/soccer)
          -> Future-ready dashboard using enabled sport config

Global shell
  -> Sports
  -> Settings
  -> Account placeholder or future destination
```

The dashboard scope is the important behavior change: active/parked/new/team/cloud actions
should be filtered to the selected sport where the data supports it.

---

## 4. Settled NAV-1 decisions

- Keep `/` as the main sport choice route during NAV-1 to preserve existing "home" links.
- Add `/sports` as an alias route for the same sport choice page.
- Add `/sport/:sportId` for sport dashboards.
- Keep existing game-flow routes (`/setup`, `/players`, `/checkout`, `/game`, `/summary`)
  working in NAV-1.
- Prefer query params for existing global list routes in this phase, e.g. `/teams?sport=basketball`
  and `/games?sport=basketball`, instead of creating duplicate full pages immediately.
- Do not move the basketball rebound setting in NAV-1; that belongs to NAV-2 settings split.
- Keep visual changes modest: clearer hierarchy, shorter pages, stable mobile layout.
- Do not enable Soccer by default in NAV-1 unless a later phase explicitly decides to.

---

## 5. Recommended implementation shape

### App shell

Add a small authenticated shell component around the protected route table.

Suggested file:

- `src/components/AppShell.tsx`

Responsibilities:

- Render shared layout around authenticated pages.
- Provide compact global navigation to:
  - sport choice (`/` or `/sports`)
  - settings/admin (`/admin` for now)
  - account placeholder only if implemented in this phase
- Avoid taking over page-level back buttons. Existing pages can keep their local back
  actions until later cleanup.
- Hide or simplify shell chrome on full-focus pages if needed, especially `/game`.

Recommendation:

- Start with a compact top header, not a full bottom nav.
- Use text or existing emoji/symbols for now because this repo does not currently have an
  icon dependency.
- Keep the shell optional per route so `/game` can remain focused if the header feels too
  crowded on mobile.

### Sport choice page

Refactor `SportSelect` so it becomes sport choice only.

Possible file direction:

- Keep `src/pages/SportSelect.tsx` as the route page for `/` and `/sports`.
- Extract reusable sport tile/card helpers only if the file stays large.

Responsibilities:

- List enabled sports from `SettingsContext`.
- Show high-level status per sport:
  - active game indicator if the active game belongs to that sport
  - parked game count for that sport
  - optional sync/error indicator if any parked game for that sport needs attention
- Navigate to `/sport/:sportId` when a sport is chosen.
- If no sports are enabled, show a path to Settings.

Do not start a new game directly from sport choice in NAV-1. The sport dashboard should own
new game creation.

### Sport dashboard page

Add a dedicated sport dashboard.

Suggested file:

- `src/pages/SportDashboard.tsx`

Responsibilities:

- Resolve `sportId` from route params.
- Validate that the sport exists and is enabled.
- Show sport-scoped actions:
  - resume active game for this sport
  - start new game for this sport
  - parked games for this sport
  - teams for this sport
  - cloud games for this sport
  - season stats for this sport
- If the active game belongs to another sport, starting a new game should still follow the
  existing park-confirm flow.
- If the selected sport is disabled, show a Settings CTA instead of silently failing.

Recommended dashboard sections:

```text
Header: Basketball
Primary action row:
  - Resume active game (if active basketball game exists)
  - New basketball game
Parked games:
  - Basketball-only parked rows with Resume / Discard
Manage:
  - Teams
  - Cloud Games
  - Season Stats
```

---

## 6. Routing plan

Add routes:

```tsx
<Route path="/" element={<SportSelect />} />
<Route path="/sports" element={<SportSelect />} />
<Route path="/sport/:sportId" element={<SportDashboard />} />
```

Keep existing routes:

```tsx
<Route path="/setup" element={<GameSetup />} />
<Route path="/players" element={<PlayerSetup />} />
<Route path="/checkout" element={<GameCheckout />} />
<Route path="/game" element={<GameTracker />} />
<Route path="/summary" element={<GameSummary />} />
<Route path="/admin" element={<Admin />} />
<Route path="/teams" element={<TeamsList />} />
<Route path="/games" element={<Games />} />
```

Possible later routes, not required for NAV-1:

```text
/#/sport/:sportId/setup
/#/sport/:sportId/parked
/#/sport/:sportId/cloud-games
/#/account
/#/settings
```

NAV-1 should prefer additive route aliases and query params over deep rewrites.

---

## 7. Sport-scoped helpers

Add small helper functions instead of duplicating filtering in multiple pages.

Suggested file:

- `src/lib/sportNavigation.ts`

Possible helpers:

```ts
sportDashboardPath(sportId: string): string
sportTeamsPath(sportId: string): string
sportGamesPath(sportId: string): string
sportLeaderboardPath(sportId: string): string
isGameForSport(summaryOrState, sportId: string): boolean
```

Also consider extracting current `SportSelect` utility logic:

- active game score line
- parked sync label
- route after resuming a parked game
- active/parked game filtering by sport

Keep these pure where possible so they can get targeted unit tests.

---

## 8. Detailed tasks

### D1: Route and shell foundation

- [ ] Add `SportDashboard` route to `src/App.tsx`.
- [ ] Add `/sports` alias for sport choice.
- [ ] Add `AppShell` around authenticated routes or around selected authenticated pages.
- [ ] Keep dev-only `/dev/shot-chart` behavior unchanged.
- [ ] Ensure unauthenticated Supabase-configured users still see `Auth`.
- [ ] Ensure unconfigured/offline-local mode still enters the app without auth.

### D2: Sport choice simplification

- [ ] Refactor `SportSelect` to list enabled sports and route to `/sport/:sportId`.
- [ ] Remove direct new-game start from sport cards.
- [ ] Show active/parked indicators per sport.
- [ ] Keep "no sports enabled" Settings CTA.
- [ ] Move sign-out/account-adjacent controls out of `SportSelect` if the shell or account
  placeholder handles them; otherwise leave sign-out here until NAV-2/AUTH-2.

### D3: Basketball dashboard

- [ ] Add `src/pages/SportDashboard.tsx`.
- [ ] Render selected sport metadata from `src/config/sports.ts`.
- [ ] Show active game card only when the active game's `state.sport.id` matches `sportId`.
- [ ] Show parked game rows filtered by `summary.sportId === sportId`.
- [ ] Reuse the existing resume/discard behavior from `SportSelect`.
- [ ] Move the current "start new game" behavior into the dashboard.
- [ ] Navigate new games to `/setup` after `startNewGame(sport)`.
- [ ] Link Teams to `/teams?sport=:sportId`.
- [ ] Link Cloud Games to `/games?sport=:sportId`.
- [ ] Link Season Stats to `/leaderboard?sport=:sportId` if the current page can tolerate
  or ignore that param safely.

### D4: Sport filtering follow-through

- [ ] Review `Teams` for existing sport filter behavior and make `/teams?sport=:sportId`
  preselect/filter by sport if needed.
- [ ] Review `Games` for existing sport filtering and make `/games?sport=:sportId` filter
  cloud games if needed.
- [ ] Review `Leaderboard` for `sport` query-param behavior and make the dashboard link
  land sensibly.
- [ ] If any of these pages need larger refactors, document the gap and keep NAV-1 focused.

### D5: Back links and route helpers

- [ ] Add route helper functions for sport dashboard links.
- [ ] Update obvious "Back home" buttons where they should return to the sport dashboard
  instead of generic sport choice.
- [ ] Keep legacy `/` navigation valid where the sport context is unknown.
- [ ] Do not break team drill-down canonical routes (`/team?teamId=...`).

### D6: Documentation

- [ ] Update `AGENTS.md` route/gotcha notes for sport choice and sport dashboards.
- [ ] Update `docs/AGENT_CODEBASE_OVERVIEW.md` route table.
- [ ] Update `docs/PLAN_APP_FOUNDATION_ROADMAP.md` if NAV-1 decisions change while planning.
- [ ] Update `docs/REGRESSION_TESTING.md` with manual nav checks.
- [ ] Update README only if the user-facing feature list or route guidance changes materially.

---

## 9. Suggested file list

Likely touched:

- `src/App.tsx`
- `src/pages/SportSelect.tsx`
- `src/pages/SportDashboard.tsx`
- `src/components/AppShell.tsx`
- `src/lib/sportNavigation.ts`
- `src/pages/Teams.tsx`
- `src/pages/Games.tsx`
- `src/pages/Leaderboard.tsx`
- `AGENTS.md`
- `docs/AGENT_CODEBASE_OVERVIEW.md`
- `docs/REGRESSION_TESTING.md`

Possibly touched:

- `src/lib/teamInfo.ts` if helper paths move there instead of a new nav helper.
- `src/context/GameContext.tsx` only if current resume/start helpers need a tiny API
  improvement. Avoid broader GameContext changes in NAV-1.
- `src/pages/GameSetup.tsx`, `src/pages/GameTracker.tsx`, `src/pages/GameSummary.tsx` for
  back-link polish only.

---

## 10. Acceptance criteria

- `/` and `/sports` show sport choice.
- Enabled sports appear as tiles/cards.
- Clicking Basketball opens `/sport/basketball`.
- `/sport/basketball` shows basketball-scoped active game, parked games, new game, teams,
  cloud games, and season stats actions.
- Starting a basketball game from `/sport/basketball` reaches the existing setup flow.
- Resuming a parked basketball game restores the correct setup/players/game route.
- Parked games from other sports do not appear in the basketball dashboard.
- Existing routes still work when opened directly:
  - `/setup`
  - `/players`
  - `/game`
  - `/summary`
  - `/teams`
  - `/games`
  - `/admin`
- Settings/Admin is reachable from primary authenticated pages through the app shell or
  equivalent global control.
- Supabase-unconfigured local mode still works.
- Dev shot chart preview remains reachable at `/#/dev/shot-chart` in dev.

---

## 11. Regression tests

Automated:

- Add/adjust unit tests for pure sport navigation helpers if added.
- Run `pnpm test`.
- Run `pnpm build`.
- Run `pnpm lint` and note existing Fast Refresh warnings if unchanged.

Manual:

- Fresh load with only Basketball enabled:
  - `/` shows Basketball sport choice.
  - Basketball opens `/sport/basketball`.
  - New game starts the current setup flow.
- Active basketball game:
  - dashboard shows active game and score.
  - Resume opens `/game`.
- Parked basketball game:
  - dashboard lists it.
  - Resume restores the correct route.
  - Discard removes it after confirmation.
- Mixed parked sports:
  - temporarily enable another sport and create/park a local game.
  - Basketball dashboard hides the other sport's parked row.
  - Sport choice shows counts on both sport tiles.
- Cloud-enabled account:
  - Teams link lands on basketball team context/filter.
  - Cloud Games link lands on basketball game context/filter.
  - Season Stats link lands sensibly.
- Supabase not configured:
  - app still enters without auth.
  - sport choice and dashboard work.

---

## 12. Risks and guardrails

- **Route churn:** many pages navigate to `/`. Keep `/` stable in NAV-1 and add `/sports`
  as an alias rather than forcing all links to change at once.
- **Scope creep into NAV-2:** sport-specific settings belong to NAV-2, not NAV-1.
- **Scope creep into soccer:** NAV-1 should be soccer-ready, not a soccer implementation.
- **GameContext risk:** avoid changing reducer/persistence behavior unless a small helper
  is clearly needed.
- **Mobile crowding:** the app shell should stay compact and should not make live tracking
  harder to use.
- **Cloud filters:** if Teams/Games filtering is larger than expected, preserve query params
  and document the follow-up rather than bloating NAV-1.

---

## 13. Pre-handoff decisions for implementation

Recommended defaults are listed first.

- **Shell placement:** compact top header, hidden/minimal on `/game` if needed.
- **Sport choice route:** keep `/` as canonical for now; `/sports` is an alias.
- **Dashboard route:** `/sport/:sportId`.
- **Dashboard links to global pages:** use query params first (`/teams?sport=...`,
  `/games?sport=...`) instead of duplicate sport-specific pages.
- **Account link:** either omit until NAV-2/AUTH-2 or add a very small placeholder route if
  the shell feels incomplete without it. Recommendation: omit from NAV-1 shell unless it is
  cheap and clearly useful.
- **Soccer visibility:** do not enable Soccer by default in NAV-1.

No additional user-facing design questions are required before implementation if these
defaults are accepted.
