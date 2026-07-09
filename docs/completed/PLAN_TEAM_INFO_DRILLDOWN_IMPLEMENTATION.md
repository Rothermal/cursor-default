# Team Info Drill-Down Implementation Plan

> **For agentic workers:** Use `docs/DESIGN_TEAM_INFO_PAGE.md` as the product spec and this file as the execution guide. Work through the sections in order; each section is intended to be independently reviewable and testable.

**Goal:** Build the Team Info drill-down hierarchy around a new team hub, then migrate roster, schedule, player, game, season, and stats entry points into that hierarchy without changing the current Supabase schema.

**Architecture:** Add a `/team?teamId=` hub route first, backed by existing Supabase tables, existing resolved-stat RPCs, and shared display helpers. Keep current stat pages (`/leaderboard`, `/player`, `/career`, `/team-stats`, `/tournament-stats`, `/summary`) working while the new drill-down pages are introduced in small slices.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS, React Router `HashRouter`, Supabase client queries/RPCs, Vitest for pure helper tests, manual browser regression for route and mobile UI behavior.

**Status:** Implemented through **TI-9**. TI-9 completes the final docs/regression polish slice.
The shipped hierarchy is `/team?teamId=` plus `/team/roster`, `/team/schedule`,
`/team/season`, `/game-info`, `/player-info`, `/team/manage`, and `/setup?teamId=`.

---

## 1. Plans reviewed and how they relate

| Plan | Current relevance | Decision |
|---|---|---|
| `docs/DESIGN_TEAM_INFO_PAGE.md` | Primary feature spec for the team hub and drill-down hierarchy. | Focus here first. It is the most direct next feature and can reuse shipped stats work. |
| `docs/DESIGN_STAT_TRACKING_UI.md` | Most prerequisite stats pages are shipped: leaderboard, player profile, career, team stats, tournament stats, compact stat helpers. | Treat as foundation. Link into these pages instead of rebuilding their data views. |
| `docs/completed/DESIGN_SEASONS_DATA_MODEL.md` | Seasons, `team_players`, player guardians, and team-scoped games are already the current model. | Use as schema source of truth. Do not add tables for this feature. |
| `docs/completed/DESIGN_TOURNAMENTS.md` | Tournaments are team-scoped and already feed tournament stats and game setup. | Reuse for team overview cards and schedule grouping. |
| `docs/archived/DESIGN_NAVIGATION_SEASONS_TOURNAMENTS.md` | Broader Sport -> Season -> Team -> Tournament navigation concept. | Defer broad navigation replacement until the team hub exists. The hub becomes the team-level destination inside that larger hierarchy. |
| `docs/INTEGRATION_PLAN.md` | Live integration status and regression surface for Supabase teams, games, invites, stats, shot chart, and team stats. | Use for constraints and regression coverage. |
| `docs/REGRESSION_TESTING.md` | Manual scripts for cloud teams, games, season stats, tournaments, invites, and smoke tests. | Extend after each section that changes navigation. |

---

## 2. Completed implementation summary

The feature shipped as the planned series of small PRs:

- **TI-1 through TI-2:** Team Info hub, shared helpers, segmented shell, and overview cards.
- **TI-3 through TI-6:** Roster, schedule, game, player, and season drill-down routes.
- **TI-7:** `/teams` became list/create; `/team/manage?teamId=` became the management surface for roster, members, invites, and merge access.
- **TI-8:** Team Info Start Game uses `/setup?teamId=`, Game Setup preselects cloud teams, and team-context back links return to Team Info without breaking global home shortcuts.
- **TI-9:** Final regression/docs polish and full validation.

The original implementation guidance below is kept as historical execution context.

---

## 2a. Original recommended focus

Start with **TI-1: Team Info hub MVP + minimal navigation shell**.

Why this comes first:

1. It unlocks the central route everything else can link to: `/team?teamId=`.
2. It is read-heavy and does not require schema or migration work.
3. It gives a stable parent page for later roster, schedule, player, game, and season drill-down routes.
4. It lets the existing `/teams` page link to the hub before the riskier Teams page decomposition happens.
5. It produces an immediately testable user-visible slice: Teams list -> Team Info -> existing stats pages.

Defer these until after the hub exists:

- Full replacement of `/teams` roster/member management.
- Broad Sport -> Season -> Team -> Tournament navigation changes.
- New Supabase RPCs for team record or upcoming games.
- Offline/local team support.
- Visual team branding.

---

## 2b. Final design decisions

- **D1 - Route shape:** Query-param routes are canonical for this feature:
  `/team?teamId=`, `/team/roster?teamId=`, `/team/schedule?teamId=`.
- **D2 - Data model:** No Supabase schema changes for Team Info. Use existing
  `teams`, `seasons`, `team_players`, `games`, `tournaments`, `team_members`, and shipped
  stats RPCs.
- **D3 - Availability:** v1 is cloud-team only. Offline/local-only teams are out of scope
  until the app has a broader local team model.
- **D4 - Management surface:** `/team/manage?teamId=` is the owner/admin management surface.
  `/teams` remains the cloud team list/create entry page and hosts pending invite actions.
- **D5 - Stats strategy:** Link into existing stat pages first; do not rebuild leaderboard,
  player profile, team stats, tournament stats, or game summary data views inside TI-1.
- **D6 - Permissions:** Read-only/scorer users can view Team Info. Any management controls
  introduced later must reuse existing owner/admin role checks from `Teams.tsx`.
- **D7 - Start Game:** Team Info links to `/setup?teamId=`. Game Setup resolves the requested
  cloud team, preselects it, and confirms before resetting an active game when needed.
- **D8 - Broad navigation:** This feature adds team-level routes without replacing the
  broader Sport -> Season -> Team -> Tournament navigation model.

---

## 3. Execution principles

- Keep each section shippable behind existing routes and behavior.
- Prefer shared helpers over copy-pasting query and score logic into each new page.
- Reuse `teamDisplayName`, `playerDisplayName`, `formatCompactGameStatLine`, and `resolveFinalHomeScoreFromGameRow`.
- Keep route style flat and query-param based: `/team?teamId=`, `/team/roster?teamId=`, `/team/schedule?teamId=`.
- Gate management actions by team role from existing team member data.
- Update `docs/REGRESSION_TESTING.md` when a user flow changes.
- Use unit tests for pure helpers and manual browser testing for new routes/cards/navigation.

---

## 3a. Known reuse points

Start with these existing surfaces before creating new abstractions:

- `src/lib/display.ts`
  - `teamDisplayName`
  - `playerDisplayName`
- `src/lib/gameScore.ts`
  - `resolveFinalHomeScoreFromGameRow`
  - existing score-row fallback behavior
- `src/lib/statDisplay.ts`
  - `formatCompactGameStatLine`
- `src/pages/Teams.tsx`
  - team loading queries
  - owner/admin/scorer role checks
  - roster/member management behavior to preserve until TI-7
- Existing stat routes and query params:
  - `/leaderboard?teamId=&seasonId=`
  - `/team-stats?teamId=`
  - `/player?playerId=&teamId=`
  - `/tournament-stats?teamId=`
  - `/summary` hydration patterns from game/profile links

---

## 4. Implementation sections

### TI-1a: Confirm current data contracts

**Purpose:** Lock down the data shapes before UI work.

**Files to inspect:**
- `src/pages/Teams.tsx`
- `src/pages/TeamStats.tsx`
- `src/pages/Games.tsx`
- `src/pages/PlayerProfile.tsx`
- `src/pages/Leaderboard.tsx`
- `src/lib/display.ts`
- `src/lib/gameScore.ts`
- `src/lib/statDisplay.ts`
- `src/lib/supabase.ts`

**Work:**
- Confirm the fields needed for one team header: team name, nickname, season name, sport, current user role.
- Confirm roster query from `team_players` + `players`.
- Confirm games query by `games.team_id`.
- Confirm record logic using finalized games, `opponent_score`, `home_team_score`, `home_score_adjustment`, and `resolveFinalHomeScoreFromGameRow`.
- Decide whether to extract pure helper functions before adding pages.

**Validation:**
- Run `pnpm test` if helpers are added or changed.
- Run `pnpm build` to catch type contract drift.

**Commit target:** `docs/completed/PLAN_TEAM_INFO_DRILLDOWN_IMPLEMENTATION.md` stays unchanged in this section unless the data contract discovery changes the plan.

---

### TI-1b: Shared team-info helpers

**Purpose:** Keep record, grouping, display, and route helpers out of page components.

**Likely files:**
- Create `src/lib/teamInfo.ts`
- Create `src/lib/teamInfo.test.ts`

**Work:**
- Add `computeTeamRecord(games)` for W-L-T counts using existing score resolution.
- Add `splitTeamGames(games)` returning `upcoming`, `inProgress`, and `completed`.
- Add small URL builders for team drill-down links if repeated string construction appears in multiple files.

**Validation:**
- Unit test wins, losses, ties, missing scores, home score adjustment, and status grouping.
- Run `pnpm test`.
- Run `pnpm build`.

**Commit target:** helper and test files only.

---

### TI-1c: Team Info route and hero MVP

**Purpose:** Create the first useful `/team?teamId=` page.

**Likely files:**
- Create `src/pages/TeamInfo.tsx`
- Create `src/components/team-info/TeamHero.tsx`
- Create `src/components/team-info/RecordBadge.tsx`
- Modify `src/App.tsx`
- Modify `src/pages/Teams.tsx`

**Work:**
- Register `/team`.
- Load team metadata from `teams` joined to `seasons`.
- Load active roster count from `team_players`.
- Load finalized games for record.
- Render hero, season/sport line, record, roster count, game count, and a small set of links to existing pages:
  - `/leaderboard?teamId=&seasonId=`
  - `/team-stats?teamId=`
  - `/team/manage?teamId=` as the management surface
- Change team cards/rows on `/teams` so the primary tap opens `/team?teamId=`.
- Keep existing roster/member controls reachable in `/teams` until the later decomposition section.

**Validation:**
- Manual browser test with a signed-in cloud team: `/teams` -> `/team?teamId=`.
- Empty state test for missing or invalid `teamId`.
- Run `pnpm lint` and `pnpm build`.

**Commit target:** new route, minimal page, team list link.

**TI-1 MVP acceptance criteria:**
- Signed-in user can open `/teams` and select an existing team.
- Primary team card/row action opens `/team?teamId=<id>`.
- Missing, invalid, or unauthorized `teamId` renders a useful loading/error/empty state.
- Team Info hero shows team display name, season, sport, record, roster count, and game
  count.
- Record calculation uses finalized games and existing score helpers.
- Basic links to existing stat/management pages render only when their required ids exist.
- `/team/manage?teamId=` remains reachable as the management surface.
- `pnpm lint` and `pnpm build` pass.

---

### TI-2: Segmented shell and overview cards

**Purpose:** Make the hub useful without introducing new full-page drill-downs yet.

**Likely files:**
- Create `src/components/SegmentedControl.tsx`
- Create `src/components/team-info/TeamOverviewCards.tsx`
- Create `src/components/team-info/RosterPreviewCard.tsx`
- Create `src/components/team-info/SchedulePreviewCard.tsx`
- Create `src/components/team-info/RecentResultsCard.tsx`
- Create `src/components/team-info/QuickStatsCard.tsx`
- Create `src/components/team-info/TournamentCard.tsx`
- Create `src/components/team-info/TeamMembersCard.tsx`
- Create `src/components/team-info/ResultBadge.tsx`
- Modify `src/pages/TeamInfo.tsx`

**Work:**
- Add Overview, Roster, and Schedule segments.
- Keep Roster and Schedule segments as simple previews in this section.
- Load the smallest data set needed for overview:
  - active roster preview
  - next scheduled games
  - recent final games
  - tournaments for team
  - team members via existing RPC
  - links to existing resolved stat views where practical
- Link overview cards to existing pages first when a dedicated page is not built yet.

**Validation:**
- Manual browser test all card links and segment buttons.
- Check narrow mobile viewport for touch targets and no horizontal overflow.
- Run `pnpm lint` and `pnpm build`.

**Commit target:** overview cards and segmented shell.

---

### TI-3: Roster drill-down

**Purpose:** Move roster reading into the new hierarchy before moving roster management.

**Likely files:**
- Create `src/pages/TeamRoster.tsx`
- Create `src/components/team-info/PlayerRow.tsx`
- Modify `src/App.tsx`
- Modify `src/pages/TeamInfo.tsx`

**Work:**
- Register `/team/roster`.
- Build a shared roster list component that can render embedded in Team Info and full-page in Team Roster.
- Link player rows to `/player-info?playerId=&teamId=` only after Section 6 creates that route; until then link to `/player?playerId=&teamId=`.
- Keep Add Player, Merge Players, and member management outside the read-only roster route
  for this section. Final TI-7 implementation moved those actions to `/team/manage?teamId=`.

**Validation:**
- Manual browser test `/team/roster?teamId=`.
- Confirm back navigation returns to `/team?teamId=`.
- Confirm scorer-only users do not see owner/admin-only actions if any are introduced.
- Run `pnpm lint` and `pnpm build`.

**Commit target:** read-only roster drill-down and embedded roster segment.

---

### TI-4: Schedule and Game Info drill-down

**Purpose:** Add team-scoped games before altering global Cloud Games behavior.

**Likely files:**
- Create `src/pages/TeamSchedule.tsx`
- Create `src/pages/GameInfo.tsx`
- Create `src/components/team-info/GameCard.tsx`
- Modify `src/App.tsx`
- Modify `src/pages/TeamInfo.tsx`

**Work:**
- Register `/team/schedule` and `/game-info`.
- Query games by `team_id`, not by `created_by`.
- Group games by upcoming, in progress, and completed.
- Render scores and result badges for final games using shared score helpers.
- In `GameInfo`, load a single game, stat leaders from `get_game_stats_resolved`, and a "View full summary" action using the same hydration pattern as existing game/profile pages.

**Validation:**
- Manual browser test scheduled, in-progress, and final game cards.
- Manual browser test `GameInfo` -> full summary hydration.
- Run `pnpm lint` and `pnpm build`.

**Commit target:** schedule route, game card, game info route.

---

### TI-5: Player Info route alignment

**Purpose:** Align player profile navigation with the team hub while preserving existing `/player` links.

**Likely files:**
- Reuse/refactor `src/pages/PlayerProfile.tsx` for `/player-info`
- Modify `src/App.tsx`
- Modify `src/pages/Leaderboard.tsx`
- Modify `src/pages/TournamentStats.tsx`
- Modify `src/pages/TeamInfo.tsx`
- Modify `src/pages/TeamRoster.tsx`

**Work:**
- Prefer extracting shared player profile content from `PlayerProfile.tsx` before duplicating a full page.
- Add `/player-info?playerId=&teamId=`.
- Keep `/player?playerId=&teamId=` working as a compatibility alias during this section.
- Add explicit "Back to Team" navigation when `teamId` is present.
- Update roster and Team Info links to use `/player-info`.

**Validation:**
- Manual browser test Leaderboard -> Player Profile still works.
- Manual browser test Team Roster -> Player Info -> Back to Team.
- Manual browser test Career link remains intact.
- Run `pnpm lint` and `pnpm build`.

**Commit target:** player route compatibility and new team-context player entry.

---

### TI-6: Season Info route

**Purpose:** Provide a season detail page only after the team route is established.

**Likely files:**
- Create `src/pages/SeasonInfo.tsx`
- Modify `src/App.tsx`
- Modify `src/pages/TeamInfo.tsx`

**Work:**
- Register `/team/season?seasonId=`.
- Load season metadata and teams in that season.
- Link each team to `/team?teamId=`.
- Link season/team stats to `/leaderboard?seasonId=&teamId=`.
- Keep editing in existing Settings/Season UI unless there is already a clean reusable editor.

**Validation:**
- Manual browser test Team Info season link -> Season Info -> Team Info.
- Run `pnpm lint` and `pnpm build`.

**Commit target:** season detail route and links.

---

### TI-7: Move team management into the hierarchy

**Purpose:** Decompose the current `/teams` page only after read-only drill-downs are
stable. This is a later/high-risk slice, not part of the MVP.

**Likely files:**
- Modify `src/pages/Teams.tsx`
- Modify `src/pages/TeamInfo.tsx`
- Modify `src/pages/TeamRoster.tsx`
- Reuse `src/components/MergePlayerWizard.tsx`

**Work:**
- Keep `/teams` as a clean list/create entry page.
- Move active roster management into Team Roster or Team Info Roster segment.
- Move team member list and invites into Team Info or a dedicated team members card/section.
- Keep player merge available for owner/admin users.
- Preserve pending invite banner behavior on `/teams` or move it to a global location if needed.

**Validation:**
- Manual browser test create team, add player, edit player, remove player, invite member, accept invite, and merge entry visibility.
- Run the Cloud Teams & Roster and Team Invites sections from `docs/REGRESSION_TESTING.md`.
- Run `pnpm lint` and `pnpm build`.

**Commit target:** Teams page decomposition with management preserved.

---

### TI-8: Start Game and cross-page back-links

**Purpose:** Make the new hierarchy feel complete without changing the broader navigation plan.

**Likely files:**
- Modify `src/pages/GameSetup.tsx`
- Modify `src/pages/Leaderboard.tsx`
- Modify `src/pages/PlayerProfile.tsx` (`/player` and `/player-info` share it)
- Modify `src/pages/TeamStats.tsx`
- Modify `src/pages/TournamentStats.tsx`
- Modify `src/pages/Games.tsx`
- Modify `src/pages/SportSelect.tsx` only if adding a new team entry is necessary

**Work:**
- Teach `/setup?teamId=` to preselect an existing cloud team when possible.
- Add "Start Game" from Team Info to `/setup?teamId=`.
- Change team-name links and back links to return to `/team?teamId=` where the team context is known.
- Keep global shortcuts available from home until the larger navigation plan replaces them.

**Validation:**
- Manual browser test Team Info -> Start Game -> existing team preselected -> checkout/tracker.
- Manual browser test Team Stats, Tournament Stats, Player Info, and Game Info back links.
- Run `pnpm lint` and `pnpm build`.

**Commit target:** setup preselect and navigation cleanup.

---

### TI-9: Regression docs and polish

**Purpose:** Make the feature maintainable after implementation.

**Likely files:**
- Modify `docs/REGRESSION_TESTING.md`
- Modify `docs/DESIGN_TEAM_INFO_PAGE.md` only if implementation decisions differ from the spec.

**Work:**
- Add a Team Info drill-down regression section.
- Add quick smoke steps for:
  - `/teams` -> `/team`
  - Team Info overview cards
  - roster drill-down
  - schedule drill-down
  - player/game/season drill-down
  - Start Game preselect
  - scorer read-only role
- Optional final walkthrough video for the implemented UI work can be recorded outside Codex.

**Validation:**
- Run `pnpm lint`, `pnpm test`, and `pnpm build`.
- Complete the new manual regression section in a browser.

**Commit target:** docs and final polish only.

---

## 5. Smaller PR boundaries

Use these as digestible review chunks:

1. **Planning doc only** — this file.
2. **Pure helpers** — `teamInfo` helper tests and shared route/record logic.
3. **Team hub MVP** — route, hero, basic data, Teams list link.
4. **Overview cards** — segmented control and cards.
5. **Roster read-only drill-down** — embedded/full roster.
6. **Schedule + Game Info** — team games and single game details.
7. **Player Info compatibility** — route alignment and back links.
8. **Season Info** — season route and team links.
9. **Management migration** — roster/member/merge behavior moved from `/teams`.
10. **Start Game + navigation polish** — setup preselect and cross-page links.
11. **Regression docs** — finalized test scripts.

---

### Current TI PR labels

Use these labels when opening implementation PRs:

1. **TI-0 Planning cleanup** - this file.
2. **TI-1 Team Info MVP** - helpers, `/team?teamId=`, hero, basic data, Teams list link.
3. **TI-2 Overview cards** - segmented control and preview cards.
4. **TI-3 Roster read-only drill-down** - embedded/full roster.
5. **TI-4 Schedule + Game Info** - team games and single game details.
6. **TI-5 Player Info compatibility** - route alignment and back links.
7. **TI-6 Season Info** - season route and team links.
8. **TI-7 Management migration** - later/high-risk move of roster/member/merge behavior from `/teams`.
9. **TI-8 Start Game + navigation polish** - setup preselect and cross-page links.
10. **TI-9 Regression docs** - finalized test scripts.

---

## 5a. Open questions to resolve during implementation

- **Q1 - Record source:** For TI-1, is finalized-game record enough, or should in-progress
  games affect any hero status copy? Recommendation: finalized-game record only.
- **Q2 - Role display:** Should Team Info expose the current user's role in the MVP hero?
  Recommendation: no, unless needed to explain hidden management controls.
- **Q3 - Team members card timing:** Should team members appear in TI-2 overview or wait
  until TI-7 management migration? Recommendation: preview/read-only in TI-2 only if the
  existing Teams query is easy to reuse.
- **Q4 - Start Game placement:** Should the Start Game CTA appear disabled in TI-1 or wait
  until `/setup?teamId=` is implemented? Recommendation: wait until TI-8 to avoid a dead
  control.
- **Q5 - Player route naming:** Should `/player-info` become canonical, or should
  `/player` remain canonical with team-context back links? Recommendation: decide in TI-5
  after reviewing reuse cost in `PlayerProfile.tsx`.

---

## 6. Key risks and guardrails

| Risk | Guardrail |
|---|---|
| Teams page currently owns too many behaviors. | Do not decompose it until the read-only hub, roster, and schedule pages are working. |
| Management migration scope balloons. | TI-7 moved management into `/team/manage?teamId=` while keeping `/teams` as list/create. |
| Record calculations drift between pages. | Reuse `resolveFinalHomeScoreFromGameRow` and test a shared record helper. |
| Team schedule accidentally copies global `Games` user-created filtering. | Query by `games.team_id` for team schedule and overview. |
| `/setup?teamId=` conflicts with sport selection state. | Resolve the requested team sport first; confirm before resetting an active game; otherwise show a clear loading/error state. |
| Management actions leak to scorer-only users. | Gate Add/Edit/Delete/Invite/Merge actions with owner/admin role checks already used in Teams. |
| Navigation churn breaks shipped stats pages. | Keep `/player`, `/leaderboard`, `/team-stats`, `/tournament-stats`, and `/games` working while adding new links. |
| Supabase query volume grows with cards. | Start with inline queries for small limits; promote to RPC only after measuring a real bottleneck. |

---

## 7. Definition of done for the full feature

- `/team?teamId=` is the canonical team destination from `/teams` and team-scoped stats pages.
- Team Info shows hero, record, roster count, schedule preview, recent results, tournaments, team members, and links to existing stats pages.
- Roster, schedule, game, player, and season drill-downs have explicit back navigation to Team Info.
- Owner/admin management behavior from `/teams` is preserved in the new hierarchy.
- Scorer/read-only users can view team information without gaining management permissions; privileged writes remain gated.
- Start Game from Team Info preselects the team.
- Existing routes remain compatible.
- Regression docs include the new flows.
- `pnpm lint`, `pnpm test`, and `pnpm build` pass after implementation.

---

## 8. Implementation completion checklist

- [x] Created `src/lib/teamInfo.ts` and `src/lib/teamInfo.test.ts`.
- [x] Added record, game grouping, and route helper tests.
- [x] Added Team Info hub, hero, record badge, segmented shell, and overview cards.
- [x] Registered `/team`, `/team/roster`, `/team/schedule`, `/team/season`, `/game-info`, `/player-info`, and `/team/manage`.
- [x] Linked Teams list entries to Team Info and legacy `/teams?teamId=` to Team Manage.
- [x] Added roster, schedule, game, player, and season drill-downs with Team Info back navigation.
- [x] Moved roster/member/invite/merge management to `/team/manage?teamId=`.
- [x] Added Team Info Start Game via `/setup?teamId=` with cloud-team preselect.
- [x] Updated regression docs with Team Info drill-down smoke coverage.
- [x] Final validation for TI-9: `pnpm test`, `pnpm lint`, and `pnpm build`.
- [ ] Optional walkthrough video recording deferred; Codex cannot capture the signed-in cloud UI flow in this environment.
