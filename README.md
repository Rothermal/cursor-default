# StatKeeper

A mobile-first Progressive Web App for tracking sports game statistics in real time. Built with React, TypeScript, Vite, Tailwind CSS, and Supabase.

## Features

- **Sport Selection & Dashboards** — configurable sports roster; choose a sport from `/` or `/sports`, then manage that sport's active game, parked games, teams, cloud games, and season stats from `/sport/:sportId`
- **Seasons** — first-class entity at the top of the hierarchy; teams, games, and tournaments belong to a season; season CRUD in Settings -> Data & Sync; season picker on team creation and game setup
- **Game Setup** — select season, pick/create team, enter opponent, tournament/league, and date
- **Cloud Team & Roster Management** — create teams within seasons; manage rosters via `team_players` junction (players can span multiple teams/seasons); edit team names, player names, and jersey numbers inline
- **Player Pool** — players are persistent person records; add existing players from your pool (players you created or are guardian of) to new teams without re-entering names
- **Guardian System** — accepted non-viewer members can claim active-roster players; creators, guardians, and team managers can review/remove relationships; creator/guardian edits are limited to player identity fields; guarded players remain available in the player pool
- **Cloud Game Lifecycle** — resume in-progress games, finalize games, and review cloud game history; finalized games show **resolved stats** (checkout + admin corrections) in Game Summary
- **Tournaments** — first-class tournament entities scoped to teams; games reference tournaments via FK; tournament picker in Game Setup (select existing or create new); placement tracking (1st, 2nd, 3rd)
- **Player Management** — add new or existing players with name and jersey number; add more mid-game
- **Live Stat Tracking** — tap-friendly increment/decrement buttons organized by stat category; missed-shot tracking with made/attempted display
- **Minutes Played** — per-player minute counter for sports that track playing time (basketball, hockey, soccer, football)
- **Game Notes** — free-text notes field in Game Tracker and Game Summary; synced to cloud
- **Live Scoreboard** — home total can be a standalone scoreboard value or computed from player scoring stats + optional adjustment; manual opponent score; the score also shows on the sport dashboard active-game card (live) and on Cloud Games cards for in-progress games (last synced) — see [F4 plan](docs/completed/PLAN_F4_IN_PROGRESS_SCORES_ON_RESUME_UI.md)
- **Basketball team stats** — home/opponent “team” rows in Game Tracker for fouls (per period), timeouts, techs, turnovers; period toggle, bonus indicators, and season rules from `seasons.team_stats_config` (edit under **Settings -> Data & Sync -> Seasons**). Cloud games sync placeholder `players` + `game_stats`; **Game Summary** includes a **Team stats** tab (fouls by period, bonus events, other team stats). See [docs/completed/DESIGN_TEAM_STATS_TRACKING.md](docs/completed/DESIGN_TEAM_STATS_TRACKING.md)
- **Basketball court capture** — half-court SVG **inline on Game Tracker** (single scroll page, sticky player strip); tapping the court opens an event popup that records made/miss shots (with location + player switcher + live stat line + auto 2/3, manual 2PT/3PT override, optional made-shot assist linking, optional missed-shot rebound prompt, and zone classification) or rebounds/steals/blocks/assists (stat only) for the selected player; the full stat grid stays below the court for direct entry and corrections; the chart filters by the selected player/team chip with an **All** view (recording always targets the active player); **Game Summary** tab when chart shots exist (same filter, defaults to All); for cloud games the Summary shows **all recorders'** shots (one recorder per player — primary recorder, then game creator — so nothing double-plots) and Cloud Games cards flag chart availability; cloud persistence via migration **`032_shot_chart.sql`** ([design](docs/completed/DESIGN_SHOT_CHART_IMPLEMENTATION.md), [F1 plan](docs/completed/PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md), [F2 plan](docs/completed/PLAN_F2_PER_PLAYER_AND_TEAM_SHOT_VIEWS.md), [F3 plan](docs/completed/PLAN_F3_CLOUD_GAME_SHOT_CHARTS.md))
- **Undo Support** — review the last few tracked events, then undo the newest action
- **Game Summary** — per-player and team totals in organized tables; M/A (%) columns for shooting stats
- **Delete Entities** — delete seasons, teams, players, games, and tournaments with confirmation prompts; destructive tools live in Settings -> Advanced
- **Supabase Admin Views** — human-readable SQL views for all tables (JOINs FK UUIDs to names) in the Supabase table browser
- **PWA** — installable on Android/iOS home screens, works offline with service worker caching
- **Auth & Account** — Supabase email/password plus Google OAuth authentication, editable StatKeeper display name, connected sign-in methods, and manual Google linking from Settings -> Account (optional; app works offline without it)
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

Sports can be enabled/disabled from **Settings -> App** in the app shell. Sport-specific preferences live under **Settings -> Sports**. A new `src/config/sports.ts` entry is automatically discovered by generic UI; full sport support may also require a sport-specific tracker, rules, settings, and summary experience.

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
2. Copy `.env.example` to `.env` and fill in your project URL and key (prefer **publishable**; **anon** still works as a fallback — see `src/lib/supabase.ts`):
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   # Legacy fallback still accepted:
   # VITE_SUPABASE_ANON_KEY=your-anon-key
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
   - `supabase/migrations/034_google_auth_profile_defaults.sql` — profile defaults for Google OAuth users (`display_name`, `avatar_url`, `email`)
   - `supabase/migrations/035_team_access_hardening.sql` — accepted team membership, role-safe member RPCs, member privacy, and final-game/stat write hardening
   - `supabase/migrations/036_viewer_team_role.sql` — read-only viewer role, viewer-aware member RPCs, and tracker-only game/stat writes
   - `supabase/migrations/037_team_invite_links.sql` — expiring single-use scorer/viewer invite links with create/list/resolve/redeem/revoke RPCs
   - `supabase/migrations/038_guardianship_hardening.sql` — contextual guardian claims, manager/creator/self removal, and identity-only player update RPC
   - `supabase/migrations/039_app_level_access.sql` — active/pending/suspended accounts, app-admin RPCs, and PostgREST request enforcement
   - `supabase/migrations/040_access_audit_trail.sql` — immutable member/invite-link/app-access audit events and scoped read RPC
   - `supabase/migrations/041_merge_preserve_shot_chart.sql` — `merge_players_execute` remounts `shot_chart` before deleting the duplicate (avoids ON DELETE CASCADE wipe)
   - `supabase/migrations/042_game_events.sql` - SOC-1 generic recorder-owned event rows, RLS, and revision-aware event upsert RPC (automatic event sync is deferred to SOC-5)
   - `supabase/migrations/043_soccer_event_cloud_transport.sql` - SOC-5A team/personal game binding, game participant snapshots, personal-game event authorization, and verified recorder checkpoints
   > If you already applied earlier migrations, run only the new ones (e.g. only `018` for the seasons data model redesign).
   > Before **`019`**, run `supabase/scripts/audit_data_integrity_pre_019.sql` in the SQL Editor if you have existing data; migration `019` aborts if duplicate teams, invalid `seasons.sport`, duplicate active jersey numbers, or bad `games.tournament_id` links exist.
   > **Migration 018 is destructive**: it drops `teams.sport`, `teams.season`, `players.team_id`, `players.jersey_number`, `players.position`, and `players.is_active` columns after migrating data to the new `seasons`, `team_players`, and `player_guardians` tables. Back up your database before running.
   > If migrations are missing or outdated, the in-app scoreboard will show a cloud sync warning/error status.
4. Optional Google OAuth setup:
   - In Supabase Auth, enable the Google provider and add the Google Client ID/Secret.
   - Set Supabase Site URL to `https://rothermal.github.io/cursor-default/`.
   - Add Supabase redirect URLs: `http://localhost:5173/` and `https://rothermal.github.io/cursor-default/`.
   - In Google Cloud / Google Auth Platform, create a Web application OAuth client.
   - Add authorized JavaScript origins: `http://localhost:5173` and `https://rothermal.github.io`.
   - Add the Supabase callback URI as the authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Enable manual identity linking in Supabase Auth if you want **Settings -> Account -> Link Google** to connect Google to an already signed-in email/password account.
   - Configure the OAuth consent screen and add test users while the Google app is in test mode.
5. Restart the dev server — the auth page will appear

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

Supabase credentials must be set as [GitHub repository secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets) for cloud features to work in production. The deploy workflow currently passes `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; locally prefer `VITE_SUPABASE_PUBLISHABLE_KEY` (anon remains accepted). See [`GITHUB_PAGES_DEPLOY.md`](GITHUB_PAGES_DEPLOY.md) for setup steps.

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
│   ├── SportSelect.tsx    # Sport choice page
│   ├── SportDashboard.tsx # Sport-scoped active/parked/manage dashboard
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
│   └── Admin.tsx          # Settings sections: account, app, sports, data/sync, advanced
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
    ├── 033_client_sync_errors.sql
    ├── 034_google_auth_profile_defaults.sql
    ├── 035_team_access_hardening.sql
    ├── 036_viewer_team_role.sql
    ├── 037_team_invite_links.sql
    ├── 038_guardianship_hardening.sql
    ├── 039_app_level_access.sql
    ├── 040_access_audit_trail.sql
    ├── 041_merge_preserve_shot_chart.sql
    ├── 042_game_events.sql
    └── 043_soccer_event_cloud_transport.sql

supabase/scripts/
├── audit_data_integrity_pre_019.sql
└── normalize_exhibition_games.sql   # Identify/link/clear legacy exhibition tournament_name rows

docs/
├── AGENT_CODEBASE_OVERVIEW.md # Agent/contributor entry: routes, sync, doc workflow
├── INTEGRATION_PLAN.md    # Supabase architecture & phases (§1 schema summary = post-018; see migrations)
├── DESIGN_STAT_TRACKING_UI.md    # Design: Career/season/game views (living doc; progress table)
├── DESIGN_TEAM_INFO_PAGE.md # Team hub / drill-down (shipped V1 design reference)
├── DESIGN_SHOT_TRACKER_UI_REVAMP.md # Court-capture program status (F1–F13)
├── PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md # F5–F13 roadmap; F11 held, F13 moves to BKE
├── PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md # Held draft: shot detail / edit
├── PLAN_SOC_0_SOCCER_PRODUCT_MODEL.md # Soccer product model and SOC-1 through SOC-6 roadmap
├── PLAN_SOC_1_SHARED_EVENT_FOUNDATION.md # Versioned event foundation, projection, and cloud schema
├── PLAN_SOC_2_MATCH_RULES_LINEUPS_AND_CLOCK.md # Soccer setup, match state, clock, and substitutions
├── PLAN_SOC_3_FIELD_AND_ATTACKING_EVENTS.md # Soccer field capture, attacking events, and Timeline
├── PLAN_SOC_4_MATCH_EVENT_CATALOG.md # Defense, discipline, team events, shootouts, and outcomes
├── PLAN_SOC_5_CLOUD_SYNC_AND_FINALIZATION.md # Reviewed SOC-5 transport through finalization decisions
├── PLAN_SOC_5A_CLOUD_EVENT_TRANSPORT.md # SOC-5A binding, snapshots, revision upload, and checkpoints
├── PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md # Required post-SOC basketball event migration
├── PLAN_MULTI_GAME_PARKING.md # Roadmap: local parking + sync queue + cloud ordering hardening shipped
├── ACCESS_MATRIX.md       # Approved role/action contract and current security audit
├── PLAN_ADMIN_SECURITY_ROADMAP.md # Admin/security/access roadmap
├── PLAN_SEC_*.md        # Admin/security/access phase plans with Q&A sections
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
- [x] Configurable sports (Settings -> App toggles)
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
- [x] Delete editable entities — delete teams, players (hard delete), games, tournaments with confirmation dialogs; Settings -> Advanced data-management tools; cascading deletes via Supabase FK constraints
- [x] Graceful fallbacks for optional DB columns (`home_score_adjustment`, `tournament_id`, `notes`, `last_opened_at`) — app works with any subset of migrations applied
- [x] Bug fixes: leaderboard sorting/navigation, game stats review display, team list cleanup, finalize fallback, RLS policy caching (migration 013)
- [x] Seasons as first-class entity — `seasons` table (migration 018); teams belong to a season; season CRUD in Settings -> Data & Sync (create, edit, delete with cascade); season picker on team creation; season filter in Game Setup
- [x] Roster junction table — `team_players` replaces `players.team_id`; players can be on multiple teams across seasons; jersey number and active status are per-team
- [x] Player guardians — `player_guardians` junction; parents claim guardianship of players; guardians can edit player info and find players in their pool
- [x] Player pool — "Add Existing" mode on roster: pick from players you created or are guardian of; no duplicate player records when moving between teams/seasons
- [x] Supabase admin display views — 9 human-readable SQL views (`_display` suffix) with `security_invoker = true` for safe FK browsing in Supabase table browser
- [x] Tournament placement — `tournaments.placement` column for finish position (1st, 2nd, 3rd, etc.)
- [x] **Team-level stat tracking (basketball)** — pseudo-players `__team_home__` / `__team_opp__`, `teamCategories` in `sports.ts`, period-scoped stat ids (`team_foul_p1`, …), bonus UI, season rules in `seasons.team_stats_config` (Settings -> Data & Sync -> Seasons), cloud placeholder players + `get_game_team_stats`, checkout + Game Summary **Team stats** tab (design: [DESIGN_TEAM_STATS_TRACKING.md](docs/completed/DESIGN_TEAM_STATS_TRACKING.md))

- [x] **Team Info hub + drill-downs** — canonical `/team?teamId=` route with overview, roster, schedule, player/game/season drill-downs, Start Game preselect, and `/team/manage?teamId=` management migration ([plan](docs/completed/PLAN_TEAM_INFO_DRILLDOWN_IMPLEMENTATION.md))
- [x] **Court capture enhancements (F5–F9, F12)** — shot-value override, in-popup player switch, assist-linking, popup stat line, rebound-after-miss prompt, recent-events undo ([roadmap](docs/PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md))
- [x] **Multi-game parking P0** — local manifest + per-game records, legacy migration, park-on-new-game, parked list resume/discard, and multi-sport summaries ([plan](docs/PLAN_MULTI_GAME_PARKING.md))
- [x] **Multi-game sync queue P1** — dirty/revision metadata per parked game, ordered queue drain across dirty records, offline/retry handling, and cloud-id merges by `localGameId` ([plan](docs/PLAN_MULTI_GAME_PARKING.md))
- [x] **Multi-game cloud hardening P2** — roster/player resolution now happens before new cloud `games` inserts, and just-created games are best-effort rolled back if child stat/shot writes fail before the cloud id is persisted locally ([plan](docs/PLAN_MULTI_GAME_PARKING.md))
- [x] **Multi-game storage guardrails P3a/P3b** — 12 parked-game cap, storage/quota error UX, local parked-game export/import, parked-only keep-existing import merge behavior, reason-specific import skips, and storage estimate in Settings -> Data & Sync ([plan](docs/PLAN_MULTI_GAME_PARKING.md))
- [x] **Multi-game sync race guards** — block discard of cloud-bound unsynced games, skip auto-hydrate when the active session is bound to a different cloud game, and reject skipped-final sync success when mid-sync/local edits remain ([`gameSyncFingerprint.ts`](src/lib/gameSyncFingerprint.ts), [plan](docs/PLAN_MULTI_GAME_PARKING.md) §5a)
- [x] **Team invite links (SEC-3)** — owner/admin-created single-use scorer/viewer links, 7-day expiry, signed-out auth return, join confirmation, and active-link Copy/Revoke controls ([plan](docs/PLAN_SEC_3_INVITE_LINKS.md))
- [x] **Guardianship hardening (SEC-4)** — contextual self-service claims, creator/manager/self removal, identity-only editing, guardian visibility, and consistent creator-link creation ([plan](docs/PLAN_SEC_4_GUARDIANSHIP_REVIEW.md))
- [x] **App-level access (SEC-5)** — active/pending/suspended account states, early authenticated-session gate, PostgREST request enforcement, and narrow app-admin management RPCs/UI ([plan](docs/PLAN_SEC_5_APP_LEVEL_ACCESS.md))
- [x] **Access audit trail (SEC-6)** — immutable member/invite-link/app-access events with team manager and app-admin history views ([plan](docs/PLAN_SEC_6_AUDIT_TRAIL.md))
- [x] **Soccer product model (SOC-0)** — event-first soccer design, complete stat catalog, configurable match/lineup model, soccer field direction, and six-phase implementation roadmap ([plan](docs/PLAN_SOC_0_SOCCER_PRODUCT_MODEL.md))
- [x] **Shared event foundation (SOC-1)** - versioned raw streams, typed sport registry, deterministic projection and revisioned mutation engine, local parking/fingerprint support, and isolated recorder-owned cloud schema/repository ([plan](docs/PLAN_SOC_1_SHARED_EVENT_FOUNDATION.md))
- [x] **Soccer match-state foundation (SOC-2A)** - resolved rule/setup snapshots, production soccer event schemas, semantic projector diagnostics, atomic event batches, exact participation projection, and local-only sync guards ([plan](docs/PLAN_SOC_2_MATCH_RULES_LINEUPS_AND_CLOCK.md))
- [x] **Soccer setup and kickoff (SOC-2B)** - development-only soccer workspace, per-match rules, local/cloud roster sources, match roster and role assignment, goalkeeper/short-handed validation, and atomic kickoff ([plan](docs/PLAN_SOC_2_MATCH_RULES_LINEUPS_AND_CLOCK.md))
- [x] **Soccer live match controls (SOC-2C)** - anchored live clock, periods, lineup and substitution controls, exact participant time, role/direction/rule changes, revisioned history corrections, diagnostics, and match end/reopen ([plan](docs/PLAN_SOC_2_MATCH_RULES_LINEUPS_AND_CLOCK.md))
- [x] **Soccer attacking event domain (SOC-3A)** - typed shot/own-goal/score-adjustment events, stable participant actors, historical lineup/role validation, and event-derived attacking, goalkeeper, and score totals ([plan](docs/PLAN_SOC_3_FIELD_AND_ATTACKING_EVENTS.md))
- [x] **Soccer live field capture (SOC-3B)** - full-pitch capture, display-only field flipping, side and participant defaults, compact shot/own-goal attribution, quick goals, and event-driven live score ([plan](docs/PLAN_SOC_3_FIELD_AND_ATTACKING_EVENTS.md))
- [x] **Soccer Timeline and field review (SOC-3C)** - filtered unified Timeline, outcome markers, shared attacking-event correction, historical adds, scoring history, and signed score adjustments ([plan](docs/PLAN_SOC_3_FIELD_AND_ATTACKING_EVENTS.md))
- [x] **Soccer match event domain (SOC-4A)** - version-2 rule/state normalization, defense/discipline/team/shootout schemas, phased projection, derived totals, temporal dependency diagnostics, and structured outcomes behind hidden UI ([plan](docs/PLAN_SOC_4_MATCH_EVENT_CATALOG.md))
- [x] **Soccer normal-match event capture (SOC-4B)** - setup profiles, Defense/Foul field modes, compact quick actions, incident sheets, all-family markers, restart links, and expanded Timeline review ([plan](docs/PLAN_SOC_4_MATCH_EVENT_CATALOG.md))
- [x] **Soccer shootout and outcome workspace (SOC-4C)** - gated shootout setup, separate score and kick sequence, kicker/goalkeeper/eligibility management, corrections, and structured completion/reopen flows ([plan](docs/PLAN_SOC_4_MATCH_EVENT_CATALOG.md))
- [x] **Soccer cloud event transport (SOC-5A)** - idempotent team/personal cloud binding, game-scoped participant snapshots, revision-aware event upload, verified recorder checkpoints, and existing-local-game adoption through the parked queue ([plan](docs/PLAN_SOC_5A_CLOUD_EVENT_TRANSPORT.md))

### What's Next

- [ ] **Soccer SOC-5B through SOC-6** - cloud resume/conflicts, independent recorder resolution, finalization, summaries, settings, aggregates, QA, and release ([SOC-5 plan](docs/PLAN_SOC_5_CLOUD_SYNC_AND_FINALIZATION.md), [roadmap](docs/PLAN_SOC_0_SOCCER_PRODUCT_MODEL.md))
- [ ] **Basketball event-model migration (BKE-0 through BKE-4)** — required post-foundation redesign that unifies counters, action log, shot records, linked assists/rebounds, editing, and F13 on the shared event platform while preserving historical games ([roadmap](docs/PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md))
- [ ] **Audit event-family follow-ups** — expand the SEC-6 trail to guardian changes, stat corrections, primary-recorder reassignment, and game lifecycle/finalization events ([plan](docs/PLAN_SEC_6_AUDIT_TRAIL.md))
- [ ] **Multi-game storage/ops follow-ups** — optional historical orphan cleanup tooling, full transactional/idempotent cloud sync, IndexedDB storage, import conflict UI, and richer quota recovery UX ([plan](docs/PLAN_MULTI_GAME_PARKING.md))
- [ ] **Stat view follow-ups** — the major career/season/team/tournament stat views are shipped; use [DESIGN_STAT_TRACKING_UI.md](docs/DESIGN_STAT_TRACKING_UI.md) and [completed/STAT_TRACKING_UI_PROGRESS.md](docs/completed/STAT_TRACKING_UI_PROGRESS.md) as references for smaller refinements
- [ ] Per-sport stat refinements outside the soccer program (minutes for hockey/football, missed shots for hockey)
- [ ] Player transfer UI: search/autocomplete for adding existing players to new teams (player pool / Add Existing already ships; this is UX polish)
- [ ] Optional stat descriptions — toggle full stat names vs abbreviations
- [ ] Bulk / archive games — beyond per-row delete in Games and Settings -> Advanced data management

### Held / waiting for feedback

- **Court capture F11 / F13** — F10 visible numbering is superseded by F13; F11 remains held, while F13 product intent is now assigned to the future basketball event migration ([court roadmap](docs/PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md), [F13 plan](docs/PLAN_F13_SHOT_DETAIL_EDIT_MODAL.md), [basketball event roadmap](docs/PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md))

### Shipped history (formerly Future Enhancements)

Earlier backlog items that are already done (see What’s Done above for detail): home score adjustment (015), editable names/tournaments (016), minutes/notes/missed shots (017), entity deletes, in-progress/final scores on resume UI (F4), seasons on games (018), data-integrity migration **019**.

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
