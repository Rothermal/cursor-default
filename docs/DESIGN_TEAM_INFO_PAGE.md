# Design: Team Info Page & Drill-Down Hierarchy

A **Team Info Page** that serves as the central hub when a user taps on a team. It surfaces roster, schedule, season stats, and team metadata in a scannable, mobile-first layout, with drill-down links to dedicated Player Info, Season Info, Schedule, and Game Info screens.

**Status:** Implementation plan — ready for engineering hand-off.

**Related docs:** [DESIGN_NAVIGATION_SEASONS_TOURNAMENTS.md](archived/DESIGN_NAVIGATION_SEASONS_TOURNAMENTS.md), [DESIGN_SEASONS_DATA_MODEL.md](completed/DESIGN_SEASONS_DATA_MODEL.md), [DESIGN_STAT_TRACKING_UI.md](DESIGN_STAT_TRACKING_UI.md), [INTEGRATION_PLAN.md](INTEGRATION_PLAN.md).

---

## 1. Goals

- **Single hub per team:** Tapping a team anywhere in the app (Teams list, Game Setup, Leaderboard back-link) opens a unified Team Info page scoped to that team.
- **Glanceable overview:** Show the most important information (record, roster count, next game, key stats) in a card-based overview without scrolling past the fold on a typical phone.
- **Drill-down navigation:** Each section card links to a full-page detail screen (Roster → Player Info, Schedule → Game Info, Season → Season Info).
- **Mobile-first:** Large touch targets, progressive disclosure, minimal horizontal scrolling. Follow the app's existing card + `HashRouter` + Tailwind patterns.
- **No new backend tables:** The initial version reads existing Supabase tables and RPCs. New RPCs or views are acceptable for performance but no schema changes are planned.

## 2. Non-goals

- Replacing the in-game tracking flow (tracker, checkout, summary).
- Full redesign of the existing `/leaderboard`, `/player`, `/career`, `/team-stats` pages — those stay as-is and receive incoming links from the new hierarchy.
- Team branding (logos, custom colors) — nice-to-have for a future phase.
- Offline/local mode support — cloud teams only for V1 (same as existing `/teams`).

---

## 3. Competitive research summary

Key patterns observed in GameChanger, TeamSnap, iScore, Stattie, and others:

| Pattern | Description | Adopt? |
|---------|-------------|--------|
| **Hero header** | Team name, sport icon, season, W-L record prominently at top | Yes |
| **Card-based overview** | Roster preview, upcoming games, quick stats as tappable cards | Yes |
| **Tab or segmented control** | Top-level tabs on the team page (Overview / Roster / Schedule / Stats) | Yes — segmented control |
| **Team-scoped context** | Once inside a team, everything (players, games, stats) is scoped | Yes |
| **Drill-down lists** | Team → Player → Player profile/stats | Yes |
| **Quick actions** | Prominent "Start Game", "Add Player" buttons on team page | Partial — link to existing flows |
| **Avatar/jersey circles** | Player previews with jersey numbers in circles | Yes |
| **Color-coded results** | Green/red/gray badges for W/L/T | Yes |
| **Role-based views** | Different info for coach vs parent | No — out of scope |

---

## 4. New screens & routes

All routes use query parameters (existing pattern, no `react-router` path params).

| Route | Component | Query params | Purpose |
|-------|-----------|--------------|---------|
| `/team` | `TeamInfo` | `teamId` | **Team hub** — hero, tabs, overview cards |
| `/team/roster` | `TeamRoster` | `teamId` | Full roster list, add/edit/remove players, links to Player Info |
| `/team/schedule` | `TeamSchedule` | `teamId` | All games (grouped by tournament / exhibition), links to Game Info |
| `/team/season` | `SeasonInfo` | `seasonId` | Season detail — teams in season, date range, team stats config |
| `/game-info` | `GameInfo` | `gameId` | Single game detail — scores, stat leaders, link to full summary |
| `/player-info` | `PlayerInfo` | `playerId`, `teamId` | Player detail — bio, season stats, game log (superset of current `/player`) |

> **Migration path:** The existing `/teams` page becomes a **team list** that links into `/team?teamId=X` instead of showing inline roster/member management. The existing `/player` page can either redirect to `/player-info` or be kept as a read-only alias.

---

## 5. Screen designs

### 5a. Team Info (`/team?teamId=X`)

```
┌──────────────────────────────────────┐
│  ← Back                             │
│  🏀 Wildcats                        │  ← Hero header
│  Spring 2026 · Basketball           │
│  Record: 12-3-0                     │
├──────────────────────────────────────┤
│ [ Overview ] [ Roster ] [ Schedule ] │  ← Segmented control
├──────────────────────────────────────┤
│                                      │
│  ┌── Roster ────────────────────┐   │  ← Overview tab: summary cards
│  │ 14 players  ·  Season Stats →│   │
│  │ #3 Smith · #12 Jones · +12   │   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌── Upcoming ──────────────────┐   │
│  │ Apr 15  vs Eagles  · 5:30pm  │   │
│  │ Apr 22  vs Hawks   · 6:00pm  │   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌── Recent Results ────────────┐   │
│  │ Apr 8  vs Tigers  W 52-41   │   │
│  │ Apr 1  vs Bears   W 48-39   │   │
│  │ Mar 25 vs Lions   L 35-42   │   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌── Quick Stats ───────────────┐   │
│  │ PPG: 48.2 · RPG: 32.1       │   │
│  │ FG%: 42.3 · Season Stats →  │   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌── Tournaments ───────────────┐   │
│  │ Spring Classic (2nd place)   │   │
│  │ Regional Cup                 │   │
│  └──────────────────────────────┘   │
│                                      │
│  ┌── Team Members ──────────────┐   │
│  │ Coach Smith (owner)          │   │
│  │ Jane Doe (admin)             │   │
│  │ Invite →                     │   │
│  └──────────────────────────────┘   │
│                                      │
│  [ Edit Team ]  [ Start Game → ]    │  ← Quick actions
└──────────────────────────────────────┘
```

**Overview tab** (default): Hero header + summary cards.  
**Roster tab**: Inline full roster (same content as `/team/roster`, embedded).  
**Schedule tab**: Inline schedule (same content as `/team/schedule`, embedded).

The segmented control avoids navigating away from the team context. Full-page routes (`/team/roster`, `/team/schedule`) exist as deep-link targets and share the same component.

### 5b. Team Roster (`/team/roster?teamId=X`)

Full-screen roster view. Each player row shows:
- Jersey number badge (circle)
- Player display name (nickname if set, else first + last)
- Position (if available — future field)
- Compact season stat line (e.g., "12.5 PPG · 4.2 RPG") via `formatCompactGameStatLine`
- Tap → `/player-info?playerId=Y&teamId=X`

Action buttons (owner/admin only): **Add Player**, **Merge Players**.

### 5c. Team Schedule (`/team/schedule?teamId=X`)

All games for the team, grouped into sections:
1. **Upcoming** — `status = 'scheduled'`, sorted ascending by date
2. **In Progress** — `status = 'in_progress'`
3. **Completed** — `status = 'final'`, sorted descending by date

Each game card shows:
- Date, opponent name
- Score (for completed/in-progress), result badge (W/L green/red)
- Tournament name (if any)
- Tap → `/game-info?gameId=Z`

### 5d. Season Info (`/team/season?seasonId=X`)

- Season name, sport, date range
- List of teams in this season (each links to `/team?teamId=`)
- Team stats config summary (basketball: foul rules, bonus thresholds)
- Season-wide leaderboard link → existing `/leaderboard?teamId=&seasonId=`
- Edit season (name, dates) — owner only

### 5e. Game Info (`/game-info?gameId=X`)

Single game detail screen:
- Hero: date, opponent, final score, result badge
- Stat leaders (top 3 by points, rebounds, etc.)
- Link to full Game Summary → loads game into `GameContext` and navigates to `/summary`
- Quick box score table (collapsed by default, expandable)
- Shot chart thumbnail (basketball, if data exists) → links to summary shot-chart tab

### 5f. Player Info (`/player-info?playerId=Y&teamId=X`)

Enhanced version of the existing `/player` page:
- Hero: jersey number, name, team name, season
- Season stat summary tables (existing `PlayerStatSummaryTables`)
- Game log with compact stat lines
- Career link → existing `/career`
- Bio section placeholder (height, position — future)

> **Decision needed:** Merge with existing `/player` page or keep separate? Recommendation: **replace** `/player` with `/player-info` and add a redirect for backward compatibility.

---

## 6. Data requirements

### Existing tables/RPCs (no changes needed)

| Data | Source | Notes |
|------|--------|-------|
| Team details | `teams` + `seasons` join | Name, nickname, sport, season |
| Roster | `team_players` + `players` join | Active players with jersey |
| Games list | `games` where `team_id = X` | All statuses |
| Tournaments | `tournaments` where `team_id = X` | Name, placement |
| Team members | RPC `get_team_members_with_profiles` | Roles, accepted status |
| Season stats (player) | RPC `get_season_stats_resolved` | Per-player season totals |
| Game stats | RPC `get_game_stats_resolved` | Per-game resolved stats |
| Player game log | RPC `get_player_game_log` | Per-player per-game stats |
| Team game log | RPC `get_team_game_log` | Per-team aggregate |

### New RPCs (performance optimization, can defer to V2)

| RPC | Purpose | Notes |
|-----|---------|-------|
| `get_team_record` | Return W-L-D for a team | Could be a simple query on `games` where `status = 'final'`, comparing scores. Avoid N+1 in the overview. |
| `get_team_upcoming_games` | Next N scheduled games | Simple query, but a dedicated RPC with `LIMIT` keeps the client lean. |

> These can start as inline Supabase queries and be promoted to RPCs if performance warrants.

---

## 7. Component architecture

```
src/
├── pages/
│   ├── TeamInfo.tsx              # /team — hub page with segmented control
│   ├── TeamRoster.tsx            # /team/roster — full roster (also embedded in TeamInfo)
│   ├── TeamSchedule.tsx          # /team/schedule — full schedule (also embedded)
│   ├── SeasonInfo.tsx            # /team/season — season detail
│   ├── GameInfo.tsx              # /game-info — single game detail
│   └── PlayerInfo.tsx            # /player-info — enhanced player profile
├── components/
│   ├── team-info/
│   │   ├── TeamHero.tsx          # Hero header with name, sport, record
│   │   ├── TeamOverviewCards.tsx  # Card grid for overview tab
│   │   ├── RosterPreviewCard.tsx  # Compact roster preview (count + top names)
│   │   ├── SchedulePreviewCard.tsx # Next 2-3 upcoming games
│   │   ├── RecentResultsCard.tsx  # Last 3-5 completed games with W/L badges
│   │   ├── QuickStatsCard.tsx     # Key team averages
│   │   ├── TournamentCard.tsx     # Tournament list with placements
│   │   ├── TeamMembersCard.tsx    # Coach/admin list
│   │   ├── GameCard.tsx           # Reusable game row (date, opp, score, badge)
│   │   ├── PlayerRow.tsx          # Reusable player row (jersey, name, stat line)
│   │   ├── RecordBadge.tsx        # W-L-D display
│   │   └── ResultBadge.tsx        # Single-game W/L/T color badge
│   └── SegmentedControl.tsx       # Reusable tab-like segmented control
```

### Shared/reusable component guidelines

- `GameCard` and `PlayerRow` are the atomic building blocks used across `TeamInfo`, `TeamSchedule`, `TeamRoster`, `GameInfo`, and `PlayerInfo`.
- `SegmentedControl` is a generic component: `<SegmentedControl tabs={[...]} active={tab} onChange={setTab} />`.
- `TeamHero` is shared between `TeamInfo` and any sub-page that needs the team header context.

---

## 8. Navigation map

```
/teams (existing, becomes team list)
  └── /team?teamId=X (Team Info hub)
        ├── Overview tab
        │     ├── Roster card → /team/roster?teamId=X
        │     ├── Schedule card → /team/schedule?teamId=X
        │     ├── Recent game → /game-info?gameId=Z
        │     ├── Season Stats → /leaderboard?teamId=X&seasonId=Y (existing)
        │     ├── Tournament → /tournament-stats?tournamentId=T&teamId=X (existing)
        │     └── Season name → /team/season?seasonId=Y
        ├── Roster tab (inline)
        │     └── Player row → /player-info?playerId=P&teamId=X
        └── Schedule tab (inline)
              └── Game row → /game-info?gameId=Z

/team/roster?teamId=X (full-page roster)
  └── Player row → /player-info?playerId=P&teamId=X

/team/schedule?teamId=X (full-page schedule)
  └── Game row → /game-info?gameId=Z

/team/season?seasonId=Y
  ├── Team card → /team?teamId=X
  └── Leaderboard → /leaderboard?teamId=X&seasonId=Y

/game-info?gameId=Z
  ├── View full summary → /summary (loads into GameContext)
  └── Player stat leader → /player-info?playerId=P&teamId=X

/player-info?playerId=P&teamId=X
  ├── Game log entry → /game-info?gameId=Z
  └── Career → /career?playerId=P&sport=S (existing)
```

---

## 9. Implementation phases

### Phase 1: Team Info hub + navigation shell

**Scope:** New `/team` route with `TeamInfo.tsx`, hero header, segmented control, overview cards (roster count, games count, record). Wire up from `/teams` list.

**Files to create:**
- `src/pages/TeamInfo.tsx`
- `src/components/team-info/TeamHero.tsx`
- `src/components/team-info/RecordBadge.tsx`
- `src/components/SegmentedControl.tsx`

**Files to modify:**
- `src/App.tsx` — add `/team` route
- `src/pages/Teams.tsx` — change team row tap to navigate to `/team?teamId=X`

**Data queries:**
- `teams` + `seasons` join for team metadata
- `games` count + W/L/D calculation from `games` where `status = 'final'`
- `team_players` count

**Estimated scope:** ~300 lines new, ~20 lines modified.

### Phase 2: Overview tab cards

**Scope:** Flesh out the overview tab with interactive cards: Roster preview, Upcoming games, Recent results (with W/L badges), Quick stats, Tournaments, Team members.

**Files to create:**
- `src/components/team-info/RosterPreviewCard.tsx`
- `src/components/team-info/SchedulePreviewCard.tsx`
- `src/components/team-info/RecentResultsCard.tsx`
- `src/components/team-info/QuickStatsCard.tsx`
- `src/components/team-info/TournamentCard.tsx`
- `src/components/team-info/TeamMembersCard.tsx`
- `src/components/team-info/ResultBadge.tsx`

**Data queries:**
- `get_season_stats_resolved` for quick stats
- `games` with `status = 'scheduled'` + `ORDER BY game_date ASC LIMIT 3`
- `games` with `status = 'final'` + `ORDER BY game_date DESC LIMIT 5`
- `tournaments` for the team
- `get_team_members_with_profiles` RPC

**Estimated scope:** ~500 lines new.

### Phase 3: Roster tab + Team Roster page

**Scope:** Inline roster tab on Team Info + dedicated `/team/roster` full-page route. Each player row links to Player Info. Add/edit/remove actions for owner/admin.

**Files to create:**
- `src/pages/TeamRoster.tsx`
- `src/components/team-info/PlayerRow.tsx`

**Files to modify:**
- `src/App.tsx` — add `/team/roster` route
- `src/pages/TeamInfo.tsx` — wire Roster tab

**Data queries:** Same as existing roster logic in `Teams.tsx`.

**Estimated scope:** ~350 lines new.

### Phase 4: Schedule tab + Team Schedule page

**Scope:** Inline schedule tab on Team Info + `/team/schedule` full page. Games grouped by Upcoming / In Progress / Completed. Game rows link to Game Info.

**Files to create:**
- `src/pages/TeamSchedule.tsx`
- `src/components/team-info/GameCard.tsx`

**Files to modify:**
- `src/App.tsx` — add `/team/schedule` route
- `src/pages/TeamInfo.tsx` — wire Schedule tab

**Estimated scope:** ~300 lines new.

### Phase 5: Game Info page

**Scope:** `/game-info?gameId=X` — single game detail with score, stat leaders, box score, link to full summary.

**Files to create:**
- `src/pages/GameInfo.tsx`

**Files to modify:**
- `src/App.tsx` — add `/game-info` route

**Data queries:**
- `games` single row
- `get_game_stats_resolved` for stat leader extraction
- `shot_chart` count check (basketball)

**Estimated scope:** ~250 lines new.

### Phase 6: Player Info page

**Scope:** `/player-info` as an enhanced `/player` with team-context hero, season stats, game log, career link.

**Files to create:**
- `src/pages/PlayerInfo.tsx`

**Files to modify:**
- `src/App.tsx` — add `/player-info` route, optional redirect from `/player`

**Data queries:** Same as existing `PlayerProfile.tsx` — refactor shared logic.

**Estimated scope:** ~300 lines new (much reuse from `PlayerProfile.tsx`).

### Phase 7: Season Info page

**Scope:** `/team/season?seasonId=X` — season metadata, list of teams in season, link to leaderboard, edit (owner).

**Files to create:**
- `src/pages/SeasonInfo.tsx`

**Files to modify:**
- `src/App.tsx` — add `/team/season` route

**Estimated scope:** ~200 lines new.

### Phase 8: Teams list refactor + back-navigation

**Scope:** Refactor existing `/teams` page to be a clean team list that links to `/team?teamId=X`. Move roster management, member management, and merge wizard access into the new Team Info / Roster pages. Update all existing back-links across stat pages.

**Files to modify:**
- `src/pages/Teams.tsx` — simplify to list + create-team form only
- `src/pages/Leaderboard.tsx`, `src/pages/PlayerProfile.tsx`, `src/pages/TeamStats.tsx` — update back-links
- `src/pages/GameSetup.tsx` — link team name to `/team`
- `src/pages/SportSelect.tsx` — potential link to teams for current sport

**Estimated scope:** ~200 lines modified, some code removed from `Teams.tsx`.

---

## 10. W-L record calculation

The app currently does not compute W-L-D records. The record logic for the Team Info hero:

```
For each game in `games` where team_id = X and status = 'final':
  home_total = SUM(game_stats where player is on home team, stat_id matches score stat)
               + home_score_adjustment
  // OR use stored home/opponent scores if available
  if home_total > opponent_score → W
  if home_total < opponent_score → L
  if home_total = opponent_score → D (or T)
```

The simplest approach: query `games` rows that have `status = 'final'` and use the stored `opponent_score` field plus the computed home score (from `game_stats` or a future column). If the app already writes a derived `home_score` to the `games` row on finalization (check `cloudSync.ts`), use that directly.

> **Action item for implementer:** Verify whether `games` has a stored home score or if it must be derived from `game_stats`. If derived, consider adding a `home_score` column on game finalization for query simplicity.

---

## 11. Open questions

| # | Question | Recommendation |
|---|----------|----------------|
| 1 | Should `/player` redirect to `/player-info` or coexist? | Redirect with query-param mapping. Single source of truth. |
| 2 | Should the Team Info page work without Supabase (local games)? | V1: cloud only (matches existing `/teams`). V2: local team support via localStorage game list. |
| 3 | Should we introduce nested routes (`/team/:id/roster`) vs flat (`/team/roster?teamId=X`)? | Flat with query params for consistency with the rest of the app. Avoids `react-router` path-param refactor. |
| 4 | Should the Roster tab be the exact same component as `/team/roster` (shared) or separate? | Shared component rendered in both contexts, with a `embedded` prop that hides the page-level header when inline. |
| 5 | Where does "Start Game" from Team Info go? | Navigate to `/setup` with `teamId` pre-filled in the URL. Existing `GameSetup` picks it up. |
| 6 | Should Team Info have an "Edit" mode or link to the existing edit UI? | Link to the existing edit in `/teams` (or inline modal). Keep V1 simple. |
| 7 | How to handle the Team Info page for teams the user doesn't own (scorer role)? | Show read-only view. Hide Add Player, Edit, Delete actions. Use `myRole` check from `team_members`. |

---

## 12. Design principles

1. **Progressive disclosure.** Overview cards show 2-3 items + a "See all →" link. Full lists live on their own pages/tabs.
2. **Consistent back-navigation.** Every sub-page has a back arrow that returns to Team Info (not the browser history stack). Use `navigate(`/team?teamId=${teamId}`)` explicitly.
3. **Reuse existing data patterns.** Follow the `useEffect` + `useState` + Supabase query pattern from `PlayerProfile.tsx` and `TeamStats.tsx`. No new state management libraries.
4. **Sport-agnostic.** The Team Info page works for any sport in `sports.ts`. Sport-specific sections (shot chart, team fouls) are conditionally rendered based on `SportConfig`.
5. **Accessibility.** All interactive elements are `<button>` or `<a>`. Cards have clear focus rings. Color badges have text labels, not color-only indicators.

---

## 13. Decision log

| ID | Topic | Decision |
|----|-------|----------|
| D1 | Routing style | Flat query params (`/team?teamId=X`), consistent with existing app |
| D2 | Tab implementation | Segmented control (not separate routes per tab) — avoids full page reload on tab switch |
| D3 | Roster/schedule embedding | Shared component with `embedded` prop, rendered both inline (tab) and full-page |
| D4 | Record calculation | Derive from `games` table on client, promote to RPC in V2 if slow |
| D5 | Phase ordering | Hub first, then cards, then drill-downs — each phase is independently shippable |
| D6 | Player Info vs existing `/player` | Replace `/player` with `/player-info` and add redirect |

---

*Document version: 1.0*
