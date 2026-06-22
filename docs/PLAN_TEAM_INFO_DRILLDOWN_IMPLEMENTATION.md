# Team Info Drill-Down Implementation Plan

> **For agentic workers:** Use `docs/DESIGN_TEAM_INFO_PAGE.md` as the product spec and this file as the execution guide. Work through the sections in order; each section is intended to be independently reviewable and testable.

**Goal:** Build the Team Info drill-down hierarchy around a new team hub, then migrate roster, schedule, player, game, season, and stats entry points into that hierarchy without changing the current Supabase schema.

**Architecture:** Add a `/team?teamId=` hub route first, backed by existing Supabase tables, existing resolved-stat RPCs, and shared display helpers. Keep current stat pages (`/leaderboard`, `/player`, `/career`, `/team-stats`, `/tournament-stats`, `/summary`) working while the new drill-down pages are introduced in small slices.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS, React Router `HashRouter`, Supabase client queries/RPCs, Vitest for pure helper tests, manual browser regression for route and mobile UI behavior.

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

## 2. Recommended focus

Start with **Team Info hub + minimal navigation shell**.

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

## 3. Execution principles

- Keep each section shippable behind existing routes and behavior.
- Prefer shared helpers over copy-pasting query and score logic into each new page.
- Reuse `teamDisplayName`, `playerDisplayName`, `formatCompactGameStatLine`, and `resolveFinalHomeScoreFromGameRow`.
- Keep route style flat and query-param based: `/team?teamId=`, `/team/roster?teamId=`, `/team/schedule?teamId=`.
- Gate management actions by team role from existing team member data.
- Update `docs/REGRESSION_TESTING.md` when a user flow changes.
- Use unit tests for pure helpers and manual browser testing for new routes/cards/navigation.

---

## 4. Implementation sections

### Section 0: Confirm current data contracts

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

**Commit target:** `docs/PLAN_TEAM_INFO_DRILLDOWN_IMPLEMENTATION.md` stays unchanged in this section unless the data contract discovery changes the plan.

---

### Section 1: Shared team-info helpers

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

### Section 2: Team Info route and hero MVP

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
  - `/teams` as a temporary management backstop
- Change team cards/rows on `/teams` so the primary tap opens `/team?teamId=`.
- Keep existing roster/member controls reachable in `/teams` until the later decomposition section.

**Validation:**
- Manual browser test with a signed-in cloud team: `/teams` -> `/team?teamId=`.
- Empty state test for missing or invalid `teamId`.
- Run `pnpm lint` and `pnpm build`.

**Commit target:** new route, minimal page, team list link.

---

### Section 3: Segmented shell and overview cards

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
  - quick stats from existing resolved season/team data where practical
- Link overview cards to existing pages first when a dedicated page is not built yet.

**Validation:**
- Manual browser test all card links and segment buttons.
- Check narrow mobile viewport for touch targets and no horizontal overflow.
- Run `pnpm lint` and `pnpm build`.

**Commit target:** overview cards and segmented shell.

---

### Section 4: Roster drill-down

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
- Keep Add Player, Merge Players, and member management in `/teams` for this section.

**Validation:**
- Manual browser test `/team/roster?teamId=`.
- Confirm back navigation returns to `/team?teamId=`.
- Confirm scorer-only users do not see owner/admin-only actions if any are introduced.
- Run `pnpm lint` and `pnpm build`.

**Commit target:** read-only roster drill-down and embedded roster segment.

---

### Section 5: Schedule and Game Info drill-down

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

### Section 6: Player Info route alignment

**Purpose:** Align player profile navigation with the team hub while preserving existing `/player` links.

**Likely files:**
- Create `src/pages/PlayerInfo.tsx` or refactor `src/pages/PlayerProfile.tsx`
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

### Section 7: Season Info route

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

### Section 8: Move team management into the hierarchy

**Purpose:** Decompose the current `/teams` page only after read-only drill-downs are stable.

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

### Section 9: Start Game and cross-page back-links

**Purpose:** Make the new hierarchy feel complete without changing the broader navigation plan.

**Likely files:**
- Modify `src/pages/GameSetup.tsx`
- Modify `src/pages/Leaderboard.tsx`
- Modify `src/pages/PlayerProfile.tsx` or `src/pages/PlayerInfo.tsx`
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

### Section 10: Regression docs and polish

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
- Record final walkthrough video for the implemented UI work.

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

## 6. Key risks and guardrails

| Risk | Guardrail |
|---|---|
| Teams page currently owns too many behaviors. | Do not decompose it until the read-only hub, roster, and schedule pages are working. |
| Record calculations drift between pages. | Reuse `resolveFinalHomeScoreFromGameRow` and test a shared record helper. |
| Team schedule accidentally copies global `Games` user-created filtering. | Query by `games.team_id` for team schedule and overview. |
| `/setup?teamId=` conflicts with sport selection state. | Preselect only when the team loads with a season sport; otherwise show a clear loading/error state. |
| Management actions leak to scorer-only users. | Gate Add/Edit/Delete/Invite/Merge actions with owner/admin role checks already used in Teams. |
| Navigation churn breaks shipped stats pages. | Keep `/player`, `/leaderboard`, `/team-stats`, `/tournament-stats`, and `/games` working while adding new links. |
| Supabase query volume grows with cards. | Start with inline queries for small limits; promote to RPC only after measuring a real bottleneck. |

---

## 7. Definition of done for the full feature

- `/team?teamId=` is the canonical team destination from `/teams` and team-scoped stats pages.
- Team Info shows hero, record, roster count, schedule preview, recent results, tournaments, team members, and links to existing stats pages.
- Roster, schedule, game, player, and season drill-downs have explicit back navigation to Team Info.
- Owner/admin management behavior from `/teams` is preserved in the new hierarchy.
- Scorer/read-only users can view team information without seeing management controls.
- Start Game from Team Info preselects the team.
- Existing routes remain compatible.
- Regression docs include the new flows.
- `pnpm lint`, `pnpm test`, and `pnpm build` pass after implementation.

---

## 8. First implementation checklist

When starting implementation, begin with this exact first slice:

- [ ] Create `src/lib/teamInfo.ts`.
- [ ] Create `src/lib/teamInfo.test.ts`.
- [ ] Add record and game-grouping helper tests.
- [ ] Run `pnpm test` and confirm the new tests pass.
- [ ] Add `src/pages/TeamInfo.tsx`.
- [ ] Add `src/components/team-info/TeamHero.tsx`.
- [ ] Add `src/components/team-info/RecordBadge.tsx`.
- [ ] Register `/team` in `src/App.tsx`.
- [ ] Link primary team rows/cards from `src/pages/Teams.tsx` to `/team?teamId=`.
- [ ] Run `pnpm lint` and `pnpm build`.
- [ ] Manually verify `/teams` -> `/team?teamId=` in the browser.
- [ ] Commit the helper and hub MVP.
