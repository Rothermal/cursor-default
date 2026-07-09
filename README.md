# StatKeeper

A mobile-first Progressive Web App for tracking sports game statistics in real time. Built with React, TypeScript, Vite, Tailwind CSS, and Supabase.

## Features

- **Sport Selection** — configurable sports roster; enable/disable via the Settings page
- **Seasons** — first-class entity at the top of the hierarchy; teams, games, and tournaments belong to a season; season CRUD in Settings; season picker on team creation and game setup
- **Game Setup** — select season, pick/create team, enter opponent, tournament/league, and date
- **Cloud Team & Roster Management** — create teams within seasons; manage rosters via `team_players` junction (players can span multiple teams/seasons); edit team names, player names, and jersey numbers inline
- **Player Pool** — players are persistent person records; add existing players from your pool (players you created or are guardian of) to new teams without re-entering names
- **Guardian System** — parents can claim guardianship of players on their team; guardians can edit player info and find players in their pool for future rosters
- **Cloud Game Lifecycle** — resume in-progress games, finalize games, and review cloud game history; finalized games show **resolved stats** (checkout + admin corrections) in Game Summary
- **Tournaments** — first-class tournament entities scoped to teams; games reference tournaments via FK; tournament picker in Game Setup (select existing or create new); placement tracking (1st, 2nd, 3rd)
- **Player Management** — add new or existing players with name and jersey number; add more mid-game
- **Live Stat Tracking** — tap-friendly increment/decrement buttons organized by stat category; missed-shot tracking with made/attempted display
- **Minutes Played** — per-player minute counter for sports that track playing time (basketball, hockey, soccer, football)
- **Game Notes** — free-text notes field in Game Tracker and Game Summary; synced to cloud
- **Live Scoreboard** — home total can be a standalone scoreboard value or computed from player scoring stats + optional adjustment; manual opponent score; the score also shows on the home active-game card (live) and on Cloud Games cards for in-progress games (last synced) — see [F4 plan](docs/completed/PLAN_F4_IN_PROGRESS_SCORES_ON_RESUME_UI.md)
- **Basketball team stats** — home/opponent “team” rows in Game Tracker for fouls (per period), timeouts, techs, turnovers; period toggle, bonus indicators, and season rules from `seasons.team_stats_config` (edit under **Settings → Seasons**). Cloud games sync placeholder `players` + `game_stats`; **Game Summary** includes a **Team stats** tab (fouls by period, bonus events, other team stats). See [docs/completed/DESIGN_TEAM_STATS_TRACKING.md](docs/completed/DESIGN_TEAM_STATS_TRACKING.md)
- **Basketball court capture** — half-court SVG **inline on Game Tracker** (single scroll page, sticky player strip); tapping the court opens an event popup that records made/miss shots (with location + player switcher + live stat line + auto 2/3, manual 2PT/3PT override, optional made-shot assist linking, optional missed-shot rebound prompt, and zone classification) or rebounds/steals/blocks/assists (stat only) for the selected player; the full stat grid stays below the court for direct entry and corrections; the chart filters by the selected player/team chip with an **All** view (recording always targets the active player); **Game Summary** tab when chart shots exist (same filter, defaults to All); for cloud games the Summary shows **all recorders'** shots (one recorder per player — primary recorder, then game creator — so nothing double-plots) and Cloud Games cards flag chart availability; cloud persistence via migration **`032_shot_chart.sql`** ([design](docs/completed/DESIGN_SHOT_CHART_IMPLEMENTATION.md), [F1 plan](docs/completed/PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md), [F2 plan](docs/completed/PLAN_F2_PER_PLAYER_AND_TEAM_SHOT_VIEWS.md), [F3 plan](docs/completed/PLAN_F3_CLOUD_GAME_SHOT_CHARTS.md))
- **Undo Support** — review the last few tracked events, then undo the newest action
- **Game Summary** — per-player and team totals in organized tables; M/A (%) columns for shooting stats
- **Delete Entities** — delete seasons, teams, players, games, and tournaments with confirmation prompts; centralized Data Management in Settings
- **Supabase Admin Views** — human-readable SQL views for all tables (JOINs FK UUIDs to names) in the Supabase table browser
- **PWA** — installable on Android/iOS home screens, works offline with service worker caching
- **Auth** — Supabase email/password authentication (optional; app works offline without it)
- **Cloud Database** — Supabase PostgreSQL with Row Level Security (migrations + in-app game snapshot sync for signed-in users)
- **Persistent State** — game and settings saved locally with incremental cloud sync when Supabase is configured

### Supported Sports

| Sport | Status | Stats |
|---|---|---|
| Basketball | Enabled by default | FT, 2PT, 3PT (with missed/attempted), Rebounds (OFF/DEF), Assists, Steals, Blocks, Turnovers, Fouls, Minutes |
| Baseball | Configured (disabled) | Hits (1B–HR), Walks, Strikeouts, Runs, RBIs, Stolen Bases, Fielding |
| Football | Configured (disabled) | Passing, Rushing, Receiving, Defense, Kicking |
| Hockey | Configured (disabled) | Goals, Assists, Shots, Hits, Blocks, Penalties, Goaltending |
| Soccer | Configured (disabled) | Goals, Assists, Shots, Tackles, Cards, Goalkeeping |

Sports can be enabled/disabled from the **Settings** page (gear icon on the home screen). Adding a new sport requires only a new entry in `src/config/sports.ts` — the UI discovers it automatically.

## Tech Stack

- **React 18** + **TypeScript**
- **Vite** — dev server and build tooling
- **Tailwind CSS 3** — utility-first styling, mobile-first responsive design
- **React Router 6** — HashRouter for client-side routing
- **Supabase** — auth, PostgreSQL database, Row Level Security
- **vite-plugin-pwa** — service worker generation, web app manifest, offline caching

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- Supabase project (optional — app works offline without it)

### Install & Run

```bash
pnpm install
pnpm dev
```

The dev server starts at `http://localhost:5173`.

### Supabase Setup (optional)

1. Create a project at [supabase.com](https://supabase.com)
2. Copy `.env.example` to `.env` and fill in your project URL and anon key:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
3. Run the migration SQL files in order via the Supabase SQL Editor:
   - `supabase/migrations/001_profiles.sql`
   - `supabase/migrations/002_teams_players.sql`
   - `supabase/migrations/003_games_stats.sql`
   - `supabase/migrations/004_team_members_rls_fix.sql`
   - `supabase/migrations/005_team_members_rls_recursion_cycle_fix.sql`
   - `supabase/migrations/006_teams_insert_policy_fix.sql`
   - `supabase/migrations/007_games_last_opened_preference.sql`
   - `supabase/migrations/008_player_checkouts.sql`
   - `supabase/migrations/009_stat_corrections.sql`
   - `supabase/migrations/010_resolved_stats_rpcs.sql`
   - `supabase/migrations/011_team_invites.sql`
   - `supabase/migrations/012_team_members_rls_recursion_fix.sql`
   - `supabase/migrations/013_rls_auth_uid_cached.sql`
   - `supabase/migrations/014_set_primary_recorder.sql`
   - `supabase/migrations/015_home_score_adjustment.sql`
   - `supabase/migrations/016_tournaments.sql`
   - `supabase/migrations/017_game_notes.sql`
   - `supabase/migrations/018_seasons_and_roster_junction.sql`
   - `supabase/migrations/019_data_integrity_constraints.sql`
   - `supabase/migrations/020_stat_tracking_ui_rpcs.sql` — career / player game log / team game log RPCs ([DESIGN_STAT_TRACKING_UI.md](docs/DESIGN_STAT_TRACKING_UI.md))
   - `supabase/migrations/021_tournament_stats_rpc.sql` — `get_tournament_stats_resolved`
   - `supabase/migrations/022_games_is_exhibition_generated.sql` — optional generated `games.is_exhibition` (`tournament_id IS NULL`); see `supabase/scripts/normalize_exhibition_games.sql` for legacy row cleanup
   - `supabase/migrations/023_tournaments_url.sql` — optional `tournaments.url` (bracket/registration link); set or edit from Game Setup when creating or selecting a tournament
   - `supabase/migrations/024_player_merge_rpcs.sql` — `merge_players_preview` / `merge_players_execute` + `player_merge_audit` ([DESIGN_PLAYER_MERGE.md](docs/completed/DESIGN_PLAYER_MERGE.md))
   - `supabase/migrations/025_player_merge_audit_select_policy.sql` — users can `SELECT` their own `player_merge_audit` rows (Admin merge history)
   - `supabase/migrations/026_player_stat_high_games.sql` — `get_player_stat_high_games` / `get_player_stat_high_games_for_team` for career & season “Best game” links to game summary
   - `supabase/migrations/027_home_team_score.sql` — optional `games.home_team_score` + `get_team_game_log` column
   - `supabase/migrations/028_team_placeholder_players.sql` — `players.is_team_placeholder`; aggregate RPCs exclude placeholders
   - `supabase/migrations/029_merge_block_team_placeholders.sql` — merge RPCs reject placeholder players
   - `supabase/migrations/030_team_stats_schema.sql` — `games.home_team_player_id`, `opp_team_player_id`, `seasons.team_stats_config`, display views, `get_game_team_stats` (see file for notes on `get_game_stats_resolved`)
   - `supabase/migrations/031_get_game_team_stats.sql` — repair: `get_game_team_stats` only if needed
   - `supabase/migrations/032_shot_chart.sql` — `shot_chart` per-game shot locations (cloud sync from the shot chart; see `docs/completed/DESIGN_SHOT_CHART_IMPLEMENTATION.md` SC-6)
   - `supabase/migrations/033_client_sync_errors.sql` — `client_sync_errors` for failed cloud sync attempts (debugging; RLS: own rows only)
   > If you already applied earlier migrations, run only the new ones (e.g. only `018` for the seasons data model redesign).
   > Before **`019`**, run `supabase/scripts/audit_data_integrity_pre_019.sql` in the SQL Editor if you have existing data; migration `019` aborts if duplicate teams, invalid `seasons.sport`, duplicate active jersey numbers, or bad `games.tournament_id` links exist.
   > **Migration 018 is destructive**: it drops `teams.sport`, `teams.season`, `players.team_id`, `players.jersey_number`, `players.position`, and `players.is_active` columns after migrating data to the new `seasons`, `team_players`, and `player_guardians` tables. Back up your database before running.
   > If migrations are missing or outdated, the in-app scoreboard will show a cloud sync warning/error status.
4. Restart the dev server — the auth page will appear

Without Supabase configured, the app runs in offline-only mode using localStorage.

**Career / season stat display (product):** On **Career totals**, **per-game** divides by the **sum of `games_played` per season/team stint** from `get_career_stats_resolved` (same as before the summary-style UI). That can double-count if the same calendar game were ever counted in two stints; we accept this until a distinct-game GP is defined. **Best game** uses migration **026** RPCs over **resolved** finalized stats; tap opens that game’s Summary (hydrate from cloud).

### GitHub Pages Deployment

StatKeeper is deployed to **GitHub Pages** via GitHub Actions. Each push to the `stattracker` branch triggers an automatic build and deploy.

| Item | Value |
|------|-------|
| **Live URL** | [https://rothermal.github.io/cursor-default/](https://rothermal.github.io/cursor-default/) |
| **Status** | Deployed |
| **Trigger** | Push to `stattracker` branch |
| **Build** | `pnpm build` with Supabase env vars from GitHub Actions secrets |

Supabase credentials (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) must be set as [GitHub repository secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets) for cloud features to work in production. See [`GITHUB_PAGES_DEPLOY.md`](GITHUB_PAGES_DEPLOY.md) for setup steps.

### Other Commands

```bash
pnpm build      # TypeScript check + production build
pnpm test       # Vitest unit tests
pnpm preview    # Serve the production build locally (port 4173)
pnpm lint       # Run ESLint
```

### PWA Icons

App icons are pre-generated in `public/`. To regenerate after changes:

```bash
pnpm add -D sharp
node scripts/generate-icons.mjs
pnpm remove sharp
```

## Project Structure

```
src/
├── lib/
│   ├── supabase.ts        # Supabase client init (graceful fallback if not configured)
│   ├── cloudSync.ts       # Cloud game snapshot sync, hydration, resume, team placeholders
│   ├── logClientSyncError.ts  # Inserts failed sync rows into client_sync_errors (Supabase)
│   ├── uuidValidation.ts  # Remote player id UUID checks (sync + persisted playerIdMap)
│   ├── display.ts         # Shared display name helpers (teams, players)
│   ├── statDisplay.ts     # Compact stat lines for game logs (sport-aware)
│   ├── gameScore.ts       # Display/final home score (standalone vs computed from player stats)
│   ├── teamPlayers.ts     # Team pseudo-player ids and isTeamPseudoPlayer helper
│   ├── teamStatsPeriods.ts   # Period labels, bonus foul counts vs season rules
│   └── teamStatsSummary.ts   # Game Summary team tab: fouls, bonus events, aggregates
├── config/
│   ├── sports.ts          # Sport definitions (stats, categories, scoring rules)
│   └── teamStatsDefaults.ts  # Basketball team-stat defaults, presets, resolveTeamStatsConfig
├── context/
│   ├── AuthContext.tsx     # Auth state (sign up, sign in, sign out, session)
│   ├── GameContext.tsx     # Game state management (reducer + localStorage)
│   └── SettingsContext.tsx # App settings (enabled sports, persisted)
├── pages/
│   ├── Auth.tsx           # Sign in / sign up page
│   ├── SportSelect.tsx    # Home page — choose a sport
│   ├── GameSetup.tsx      # Enter game info (teams, tournament, date)
│   ├── PlayerSetup.tsx    # Add/remove players
│   ├── GameCheckout.tsx   # Pre-game player checkout (cloud teams)
│   ├── GameTracker.tsx    # Live stat tracking interface (basketball: inline court)
│   ├── GameSummary.tsx    # Post-game stat tables (resolved stats + admin corrections)
│   ├── Games.tsx          # Cloud game history, resume/final flows, delete games
│   ├── Teams.tsx          # Cloud team list/create + /team/manage roster/members/merge
│   ├── TeamInfo.tsx       # Team hub (/team) — overview, Start Game, stats links
│   ├── TeamRoster.tsx     # Read-only roster drill-down (/team/roster)
│   ├── TeamSchedule.tsx   # Team schedule drill-down (/team/schedule)
│   ├── SeasonInfo.tsx     # Season detail (/team/season)
│   ├── GameInfo.tsx       # Single cloud game detail (/game-info)
│   ├── Leaderboard.tsx    # Season leaderboard (season + team scope, sortable)
│   ├── PlayerProfile.tsx  # /player and /player-info shared profile
│   ├── CareerStats.tsx    # Career stats (/career)
│   ├── TeamStats.tsx      # Team season summary (/team-stats)
│   ├── TournamentStats.tsx # Tournament stats (/tournament-stats)
│   └── Admin.tsx          # Settings — sports, seasons CRUD, cloud links, data management
├── components/
│   ├── ConfirmDialog.tsx  # Reusable confirmation modal (delete prompts)
│   ├── Scoreboard.tsx     # Live score display
│   ├── StatButton.tsx     # Reusable stat increment/decrement button
│   ├── SeasonTeamStatsEditor.tsx  # Admin: season team-stat rules (basketball)
│   ├── shot-chart/        # Half-court SVG, CourtEventPopup, ShotChartPanel
│   ├── team-info/         # TeamHero, overview cards, GameCard, PlayerRow
│   └── team-stats/        # PeriodToggle, BasketballBonusIndicator, TeamStatSummary
├── types.ts               # TypeScript interfaces
├── App.tsx                # Router + providers + auth gate
├── main.tsx               # Entry point
└── index.css              # Tailwind directives + custom component classes

supabase/
└── migrations/            # SQL files to run in Supabase SQL Editor
    ├── 001_profiles.sql
    ├── 002_teams_players.sql
    ├── 003_games_stats.sql
    ├── 004_team_members_rls_fix.sql
    ├── 005_team_members_rls_recursion_cycle_fix.sql
    ├── 006_teams_insert_policy_fix.sql
    ├── 007_games_last_opened_preference.sql
    ├── 008_player_checkouts.sql
    ├── 009_stat_corrections.sql
    ├── 010_resolved_stats_rpcs.sql
    ├── 011_team_invites.sql
    ├── 012_team_members_rls_recursion_fix.sql
    ├── 013_rls_auth_uid_cached.sql
    ├── 014_set_primary_recorder.sql
    ├── 015_home_score_adjustment.sql
    ├── 016_tournaments.sql
    ├── 017_game_notes.sql
    ├── 018_seasons_and_roster_junction.sql
    ├── 019_data_integrity_constraints.sql
    ├── 020_stat_tracking_ui_rpcs.sql
    ├── 021_tournament_stats_rpc.sql
    ├── 022_games_is_exhibition_generated.sql
    ├── 023_tournaments_url.sql
    ├── 024_player_merge_rpcs.sql
    ├── 025_player_merge_audit_select_policy.sql
    ├── 026_player_stat_high_games.sql
    ├── 027_home_team_score.sql
    ├── 028_team_placeholder_players.sql
    ├── 029_merge_block_team_placeholders.sql
    ├── 030_team_stats_schema.sql
    ├── 031_get_game_team_stats.sql
    ├── 032_shot_chart.sql
    └── 033_client_sync_errors.sql

supabase/scripts/
├── audit_data_integrity_pre_019.sql
└── normalize_exhibition_games.sql   # Identify/link/clear legacy exhibition tournament_name rows

docs/
├── AGENT_CODEBASE_OVERVIEW.md # Agent/contributor entry: routes, sync, doc workflow
├── INTEGRATION_PLAN.md    # Supabase architecture & phases (§1 schema summary = post-018; see migrations)
├── DESIGN_STAT_TRACKING_UI.md    # Design: Career/season/game views (living doc; progress table)
├── DESIGN_TEAM_INFO_PAGE.md # Team hub / drill-down (shipped V1 design reference)
├── DESIGN_SHOT_TRACKER_UI_REVAMP.md # Court-capture program status (F1–F13)
├── PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md # F5–F13 roadmap; F11/F13 held
├── PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md # Held draft: shot detail / edit
├── PLAN_MULTI_GAME_PARKING.md # Roadmap: multiple parked games + sync queue (not shipped)
├── REGRESSION_TESTING.md  # High-level test scripts for all features
├── completed/             # Shipped features — design & implementation references
│   ├── PLAN_TEAM_INFO_DRILLDOWN_IMPLEMENTATION.md
│   ├── PLAN_F1…F9, PLAN_F12  # Court-capture feature plans (implemented)
│   ├── DESIGN_SEASONS_DATA_MODEL.md
│   ├── STAT_TRACKING_UI_PROGRESS.md
│   ├── DESIGN_PHASE3_GAME_SUMMARY_ADMIN.md
│   ├── DESIGN_TOURNAMENTS.md
│   ├── DATA_INTEGRITY_AND_CREATION_PLAN.md
│   ├── DESIGN_PLAYER_MERGE.md
│   ├── DESIGN_TEAM_STATS_*.md
│   ├── DESIGN_SHOT_CHART.md
│   └── DESIGN_SHOT_CHART_IMPLEMENTATION.md
└── archived/              # Future / placeholder / not-built specs
    ├── DESIGN_NAVIGATION_SEASONS_TOURNAMENTS.md
    ├── DESIGN_MULTI_PARENT_INVITE_LINKS.md
    └── DESIGN_USER_PERMISSIONS_AND_ROLES.md
```

> Full route table and file map: [`docs/AGENT_CODEBASE_OVERVIEW.md`](docs/AGENT_CODEBASE_OVERVIEW.md).

### Testing

See [`docs/REGRESSION_TESTING.md`](docs/REGRESSION_TESTING.md) for step-by-step regression test scripts (offline mode, auth, teams, games, checkout, corrections, season stats, invites, PWA, deploy).

## Roadmap

See [`docs/INTEGRATION_PLAN.md`](docs/INTEGRATION_PLAN.md) for the full architecture and phased plan.

| Phase | What | Status |
|---|---|---|
| 1 | **Supabase Foundation** — auth, cloud DB, RLS, migrations, auth UI | Done |
| 2 | **Cloud Stat Tracking** — persistent teams/rosters, games saved to cloud | Done |
| 3 | **Season Stats + Multi-Parent** — player checkout, admin corrections, leaderboards | Done |
| 4 | **Capacitor + Polish** — native Android/iOS builds, push notifications, exports | Planned |
| 5 | **Sports Engine** — API integration (deferred; requires developer access) | Deferred |

### What's Done

- [x] Mobile-first React + TypeScript + Vite + Tailwind app
- [x] Sport-specific stat tracking (basketball fully built; 4 others configured)
- [x] Configurable sports (admin settings page with toggles)
- [x] PWA support (installable, offline-capable, service worker)
- [x] Supabase client integration with graceful offline fallback
- [x] Auth UI (sign in / sign up / sign out)
- [x] Database schema and RLS policies (migration SQL ready to run)
- [x] Cloud teams + roster management UI (create teams, add/remove active players)
- [x] Existing-team game setup with cloud roster preload
- [x] Cloud game/stat snapshot sync with visible sync status in UI
- [x] Cloud resume hydration with deterministic active-game preference (cloud-backed via `last_opened_at` when `007` is applied)
- [x] Cloud game history page with finalize flow and final-game read-only summary behavior
- [x] Snapshot-based offline queue with reconnect-triggered cloud sync replay
- [x] Integration plan with multi-parent checkout model and admin corrections
- [x] Phase 3 DB: `player_checkouts`, `stat_corrections`, `get_game_stats_resolved`, `get_season_stats_resolved` (migrations 008–010)
- [x] Player checkout flow (GameCheckout) for cloud teams and resolved Game Summary for finalized cloud games
- [x] Admin stat corrections UI on Game Summary (finalized games, team owner/admin only) using stat_corrections and resolved RPCs
- [x] Team invite system — invite by email, accept/decline, roles (owner/admin/scorer), member list
- [x] Season stats UI — Leaderboard (team selector, sortable by stat), Player Profile (season totals, game log, view game)
- [x] Game Summary: Primary vs All Submissions toggle and conflict indicator (averaged / multi-recorder) for finalized cloud games
- [x] Admin: reassign primary recorder per player on Game Summary (finalized games; RPC `set_primary_recorder`)
- [x] Admin: "Stats needing review" section for averaged / multi-recorder stats (Correct and Set primary recorder links)
- [x] Manual home score adjustment — editable +/− on Scoreboard; persisted and cloud-synced (migration 015)
- [x] Editable team names (name + nickname) from Teams page; editable player names (first, last, jersey, nickname) from Teams roster
- [x] Editable opponent name from Games history (inline edit per game card)
- [x] Tournaments as first-class entities — `tournaments` table (migration 016), team-scoped, tournament picker in Game Setup, games reference `tournament_id`
- [x] Missed shots for basketball — attempt buttons on scoring cards; [−][A][+] UI; M/A (%) columns in Game Summary
- [x] Minutes played — per-player minute counter for basketball (stat `min`; layout: Playmaking category)
- [x] Game notes — free-text notes in Game Tracker and Game Summary; synced to cloud (migration 017)
- [x] Delete editable entities — delete teams, players (hard delete), games, tournaments with confirmation dialogs; centralized Data Management section in Settings; cascading deletes via Supabase FK constraints
- [x] Graceful fallbacks for optional DB columns (`home_score_adjustment`, `tournament_id`, `notes`, `last_opened_at`) — app works with any subset of migrations applied
- [x] Bug fixes: leaderboard sorting/navigation, game stats review display, team list cleanup, finalize fallback, RLS policy caching (migration 013)
- [x] Seasons as first-class entity — `seasons` table (migration 018); teams belong to a season; season CRUD in Settings (create, edit, delete with cascade); season picker on team creation; season filter in Game Setup
- [x] Roster junction table — `team_players` replaces `players.team_id`; players can be on multiple teams across seasons; jersey number and active status are per-team
- [x] Player guardians — `player_guardians` junction; parents claim guardianship of players; guardians can edit player info and find players in their pool
- [x] Player pool — "Add Existing" mode on roster: pick from players you created or are guardian of; no duplicate player records when moving between teams/seasons
- [x] Supabase admin display views — 9 human-readable SQL views (`_display` suffix) with `security_invoker = true` for safe FK browsing in Supabase table browser
- [x] Tournament placement — `tournaments.placement` column for finish position (1st, 2nd, 3rd, etc.)
- [x] **Team-level stat tracking (basketball)** — pseudo-players `__team_home__` / `__team_opp__`, `teamCategories` in `sports.ts`, period-scoped stat ids (`team_foul_p1`, …), bonus UI, season rules in `seasons.team_stats_config` (Admin → Seasons), cloud placeholder players + `get_game_team_stats`, checkout + Game Summary **Team stats** tab (design: [DESIGN_TEAM_STATS_TRACKING.md](docs/completed/DESIGN_TEAM_STATS_TRACKING.md))

- [x] **Team Info hub + drill-downs** — canonical `/team?teamId=` route with overview, roster, schedule, player/game/season drill-downs, Start Game preselect, and `/team/manage?teamId=` management migration ([plan](docs/completed/PLAN_TEAM_INFO_DRILLDOWN_IMPLEMENTATION.md))
- [x] **Court capture enhancements (F5–F9, F12)** — shot-value override, in-popup player switch, assist-linking, popup stat line, rebound-after-miss prompt, recent-events undo ([roadmap](docs/PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md))

### What's Next

- [ ] **Court capture held items** — F10 visible numbering is superseded by F13; F11 quick buttons and F13 shot detail/editing are held pending further user feedback ([roadmap](docs/PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md), [F13 plan](docs/PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md))
- [ ] **Multi-game parking + sync queue** — multiple in-progress/paused games per device, offline-safe snapshots, ordered cloud sync ([plan](docs/PLAN_MULTI_GAME_PARKING.md))
- [ ] **Stat view follow-ups** — the major career/season/team/tournament stat views are shipped; use [DESIGN_STAT_TRACKING_UI.md](docs/DESIGN_STAT_TRACKING_UI.md) and [completed/STAT_TRACKING_UI_PROGRESS.md](docs/completed/STAT_TRACKING_UI_PROGRESS.md) as references for smaller refinements
- [ ] Team collaboration invites: multi-parent workflows, invite links (design: [DESIGN_MULTI_PARENT_INVITE_LINKS.md](docs/archived/DESIGN_MULTI_PARENT_INVITE_LINKS.md))
- [ ] Per-sport stat refinements and additional stats (minutes for hockey/soccer/football, missed shots for hockey)
- [ ] Player transfer UI: search/autocomplete for adding existing players to new teams (player pool / Add Existing already ships; this is UX polish)

### Future Enhancements

A backlog of ideas to iterate over:

1. **Manual home team score** — Add the ability to update the home team score just like the away team; disconnect game score completely from player stats (home score is currently auto-computed from player stats). *Implemented: home score = computed from player stats + editable adjustment (+/− buttons on Scoreboard); adjustment persisted and synced (migration 015).*
2. **Editable team names, player names, and tournaments** — Allow editing from the proper locations; editing and sync work for both local and cloud. *Implemented: team name + nickname editable from Teams page; player first/last name, jersey number, nickname editable from Teams roster; opponent name editable from Games history (inline edit). Tournaments as first-class entity — `tournaments` table (migration 016) with team-scoped picker in Game Setup; games reference `tournament_id`. Design: [DESIGN_TOURNAMENTS.md](docs/completed/DESIGN_TOURNAMENTS.md).*
4. **Minutes played, game notes, missed shots** — Extend stat tracking. *Implemented: minutes played as per-player counter in basketball (stat `min`, Playmaking category); game notes with free-text field in Game Tracker and Game Summary, synced to cloud (migration 017); missed shots for basketball with [−][A][+] attempt buttons and M/A (%) columns in Game Summary.*
5. **Delete editable entities** — Ability to delete all editable things (teams, players, tournaments, games, etc.). Every delete action shows a confirmation prompt with Yes/No buttons before proceeding. *Implemented: delete teams, players (hard delete), games, and tournaments from the Teams page, Games page, Game Setup tournament picker, and a centralized Data Management section in Settings (Admin). All deletes show a confirmation dialog. Cascading deletes handled by Supabase FK constraints (`ON DELETE CASCADE`).*
6. **Score totals in game list** — *Implemented for final and in-progress Cloud Games cards via F4; scheduled 0-0 games hide the score.*
7. **Optional stat descriptions** — Toggle to display full stat names (e.g., "Free Throw") instead of abbreviated labels (e.g., "FT"); or optionally show stat descriptions.
8. **Games tied to season** — Determine how games are tied to an individual season (e.g., team has season field; games inherit or reference it; season filter in leaderboard). *Implemented: `seasons` table as top-level entity (migration 018); teams belong to a season via `season_id` FK; games inherit season through their team; season filter in Game Setup; season CRUD in Settings. Design: [DESIGN_SEASONS_DATA_MODEL.md](docs/completed/DESIGN_SEASONS_DATA_MODEL.md).*
9. **Clean up existing games** — A way to clean up existing games (delete, archive, or bulk actions). *Partially addressed by enhancement #5 (delete games individually from Games page and Data Management in Settings). Bulk actions and archive not yet implemented.*
10. **Data integrity & creation order** — Migration **`019` applied** on the database (sport CHECK, unique team per season, active jersey uniqueness, `games.season_id` + triggers, tournament/team validation). App aligns `cloudSync` and Game Setup / Teams. Full plan and checklist: [docs/completed/DATA_INTEGRITY_AND_CREATION_PLAN.md](docs/completed/DATA_INTEGRITY_AND_CREATION_PLAN.md). Regression: [docs/REGRESSION_TESTING.md](docs/REGRESSION_TESTING.md) §13.
11. *(Add more as we go)*

### Known Issues

1. **Verify historical duplicate final/in-progress listing** — Older docs noted that a completed cloud game could appear as both final and in progress after finalization. Re-test this against the current Cloud Games flow before treating it as an active bug; if it still reproduces, fix the finalization/list filtering path.

### Performance updates

1. **RLS policy re-evaluates per row** — Supabase warns: Table `public.profiles` has a row level security policy `profiles_select_own` that re-evaluates `current_setting()` or `auth.<function>()` for each row, which hurts query performance at scale. Fix: replace `auth.uid()` (and similar) with `(select auth.uid())` in the policy so the result is cached per statement. See [Call functions with select](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select).

### Mobile Native (Capacitor)

The app is currently a PWA installable from the browser. For App Store / Play Store distribution and native device APIs, wrap with [Capacitor](https://capacitorjs.com/):

```bash
pnpm add @capacitor/core @capacitor/cli
npx cap init StatKeeper com.statkeeper.app --web-dir dist
pnpm build
npx cap add android
npx cap add ios
npx cap sync
```

Capacitor uses the same web codebase — no rewrite needed.

### Integrations

- **[Supabase](https://supabase.com/)** — PostgreSQL database, auth, Row Level Security
- **Sports Engine API** — deferred (requires developer API access); data model includes `se_*` columns for future compatibility

Environment variables for API keys and database connectors go in `.env` files (already gitignored).

## License

Private — not yet licensed for distribution.
