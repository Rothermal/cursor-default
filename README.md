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
- `supabase/migrations/044_soccer_event_recovery.sql` - SOC-5B immutable soccer setup snapshots, same-recorder conflict audit, and recovery RPCs
- `supabase/migrations/045_soccer_recorder_resolution.sql` - SOC-5C independent team recorder binding, recorder presence, provisional primary selection, and audit history
- `supabase/migrations/046_soccer_finalization_recovery.sql` - SOC-5D canonical publication, primary locking, final audit uploads, and reason-required reopen
- `supabase/migrations/047_soccer_canonical_aggregate_sources.sql` - SOC-6C2 RLS/keyset canonical aggregate source RPCs, audited participant-link repair, merge-safe stable identities, and retention of migration 041's basketball shot-chart remount
- `supabase/migrations/048_soccer_settings_foundation.sql` - SOC-6D1 generic personal/team sport-settings tables, strict soccer schema validation, read-only RLS, revision-aware write RPCs, and shared-setting audit events
- `supabase/migrations/049_soccer_release_capabilities.sql` - SOC-6E1 authenticated read-only handshake for the complete Soccer cloud contract
- `supabase/migrations/050_event_platform_team_side_constraint.sql` - BKE-4A1 staged event-platform team-side widening
- `supabase/migrations/051_event_platform_cloud_transport.sql` - BKE-4A1 neutral transport foundation and Soccer wrappers
- `supabase/migrations/052_event_platform_recovery.sql` - BKE-4A2 neutral setup recovery and conflict contracts
- `supabase/migrations/053_event_platform_recorder_resolution.sql` - BKE-4A3 neutral recorder and primary-resolution contracts
- `supabase/migrations/054_event_platform_publication_constraint.sql` - BKE-4A4 staged canonical-publication sport widening
- `supabase/migrations/055_event_platform_finalization_recovery.sql` - BKE-4A4 neutral finalization/recovery mechanics and Soccer wrappers
- `supabase/migrations/056_basketball_event_cloud_transport.sql` - BKE-4B1 fixed Basketball v4 binding wrapper over the private event-platform transport
- `supabase/migrations/057_basketball_recorder_finalization_contracts.sql` - BKE-4C1 fixed Basketball recorder/readiness preparation wrappers and private terminal/score policy
- `supabase/migrations/058_basketball_canonical_finalization.sql` - BKE-4C3 fixed schema-gated Basketball finalization wrapper and trusted shared-transaction policy dispatch
- `supabase/migrations/059_basketball_reopen_republication.sql` - BKE-4C4 manager publication-history reader, fixed reason-required Basketball reopen wrapper, and append-only republication path
   > Apply **`059`** after **`058`** for Basketball reopen and republication.
   > Apply **`057`** for BKE-4C2 recorder/readiness UI.
   > Apply **`056`** before running BKE-4B2 Basketball event sync; the client fails closed when the binder is unavailable.
   > Apply **`054` and `055` separately and in order** so the staged constraint add commits before validation and replacement.
   > Apply **`049`** before enabling Soccer for cloud-team starts. Missing or stale capability contracts fail closed while local-only Soccer and existing/history access remain available.
   > Before **`047`**, run `supabase/scripts/audit_soccer_participant_sources_pre_047.sql` and review the repairable/unprovable participant counts.
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
    ├── 043_soccer_event_cloud_transport.sql
    ├── 044_soccer_event_recovery.sql
    ├── 045_soccer_recorder_resolution.sql
    ├── 046_soccer_finalization_recovery.sql
    ├── 047_soccer_canonical_aggregate_sources.sql
    ├── 048_soccer_settings_foundation.sql
    ├── 049_soccer_release_capabilities.sql
    ├── 050_event_platform_team_side_constraint.sql
    ├── 051_event_platform_cloud_transport.sql
    ├── 052_event_platform_recovery.sql
    ├── 053_event_platform_recorder_resolution.sql
    ├── 054_event_platform_publication_constraint.sql
    ├── 055_event_platform_finalization_recovery.sql
    └── 056_basketball_event_cloud_transport.sql

supabase/scripts/
├── audit_data_integrity_pre_019.sql
├── audit_soccer_participant_sources_pre_047.sql
├── normalize_exhibition_games.sql   # Identify/link/clear legacy exhibition tournament_name rows
└── verify_soccer_v1_binding_compatibility.sql

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
├── PLAN_SOC_5B_OFFLINE_RECOVERY_AND_CONFLICTS.md # SOC-5B cloud resume and same-recorder conflicts
├── PLAN_SOC_5C_INDEPENDENT_RECORDERS_AND_PRIMARY.md # SOC-5C recorder presence and primary resolution
├── PLAN_SOC_5D_FINALIZATION_AND_RECOVERY.md # SOC-5D canonical publication and audited reopen
├── PLAN_SOC_6_SUMMARY_AND_RELEASE.md # Reviewed SOC-6 summary, aggregates, settings, and release roadmap
├── PLAN_SOC_6A_SUMMARY_FOUNDATION.md # Reviewed SOC-6A summary source and Overview implementation plan
├── PLAN_SOC_6B_DETAILED_MATCH_REVIEW.md # Reviewed detailed soccer match review implementation plan
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
- [x] **Soccer offline recovery and same-recorder conflicts (SOC-5B)** - pull-before-push merge, event-aware cloud resume, durable competing revisions, explicit resolution, retry details, and recovery export ([plan](docs/PLAN_SOC_5B_OFFLINE_RECOVERY_AND_CONFLICTS.md))
- [x] **Soccer independent recorders and primary resolution (SOC-5C)** - separate team recorder streams, compact presence, opt-in read-only detail, provisional owner/admin primary selection, and immutable selection history ([plan](docs/PLAN_SOC_5C_INDEPENDENT_RECORDERS_AND_PRIMARY.md))
- [x] **Soccer finalization and recovery (SOC-5D)** - owner/admin readiness, primary conflict preparation and lock, append-only canonical publications, canonical final review, late non-primary audit uploads, and reason-required audited reopen ([plan](docs/PLAN_SOC_5D_FINALIZATION_AND_RECOVERY.md))
- [x] **Soccer summary foundation (SOC-6A)** - one Overview-only `/summary` for current local matches, effective cloud primaries, and canonical finals; direct cloud review preserves parked games, diagnostics suppress partial official totals, and finalization/reopen refresh authority in place ([plan](docs/PLAN_SOC_6A_SUMMARY_FOUNDATION.md))
- [x] **Soccer summary player review (SOC-6B1)** - URL-backed Players tab with lineup-aware ordering, DNP and live minutes, category totals, rates, intervals, clean-sheet context, and isolated other-recorder review ([plan](docs/PLAN_SOC_6B_DETAILED_MATCH_REVIEW.md))
- [x] **Soccer summary Timeline (SOC-6B2)** - period-grouped normal-match review, overlapping event-family filters, removed/corrected history, and local-only checked corrections ([plan](docs/PLAN_SOC_6B_DETAILED_MATCH_REVIEW.md))
- [x] **Soccer summary Field (SOC-6B3)** - canonical event markers, normalized/original coordinates, combined filters, deterministic clusters, unknown-location review, and local-only editing ([plan](docs/PLAN_SOC_6B_DETAILED_MATCH_REVIEW.md))
- [x] **Soccer summary Shootout (SOC-6B4)** - round-paired attempts, retakes, forfeits, sudden death, stable anonymous slots, and game-scoped kicker/goalkeeper summaries ([plan](docs/PLAN_SOC_6B_DETAILED_MATCH_REVIEW.md))
- [x] **Soccer canonical aggregate engine (SOC-6C1)** - exact `soc_*` stat contract, conservative legacy aliases, canonical-publication projection, stable-player aggregation, combined rates, and explicit identity/publication exclusions ([plan](docs/PLAN_SOC_6C_CANONICAL_AGGREGATES.md))
- [x] **Soccer canonical aggregate transport (SOC-6C2)** - authorized keyset publication RPCs, audited merge-lineage repair, merge-safe source identities, full-page loading, cancellation/deduplication, cooperative projection, and metrics ([plan](docs/PLAN_SOC_6C_CANONICAL_AGGREGATES.md))
- [x] **Soccer aggregate destinations (SOC-6C3)** - canonical season Leaderboard plus Team/Tournament Overview, Players, and Games; active-roster zero rows; compact category ranking; partial-quality authorization; and refresh/focus lifecycle ([plan](docs/PLAN_SOC_6C_CANONICAL_AGGREGATES.md))
- [x] **Soccer player and career aggregates (SOC-6C4)** - stable-player canonical Profile/Career totals, Participation-at-zero, all-zero category suppression, season/team history, direct Summary links, and legacy-route regression guards ([plan](docs/PLAN_SOC_6C_CANONICAL_AGGREGATES.md))
- [x] **Soccer settings foundation (SOC-6D1)** - strict configurable rule schema, source-aware built-in/personal/team/match resolution, anonymous and account-keyed local cache contracts, backend capability parsing, and migration 048 revision-aware personal/team storage ([plan](docs/PLAN_SOC_6D_SOCCER_SETTINGS.md))
- [x] **Soccer personal settings (SOC-6D2)** - compact grouped personal defaults, editable presets, explicit Save/Discard and reset, anonymous/account cache isolation, cloud reconciliation, offline pending writes, and explicit revision-conflict choices ([plan](docs/PLAN_SOC_6D_SOCCER_SETTINGS.md))
- [x] **Soccer team defaults and setup inheritance (SOC-6D3)** - owner/admin shared team overrides, scorer/viewer read-only review, compatible-team copy, account/team cache isolation, source-labeled built-in/personal/team/match setup resolution, sparse match resets, and immutable setup snapshots ([plan](docs/PLAN_SOC_6D_SOCCER_SETTINGS.md))
- [x] **Soccer settings hardening (SOC-6D4)** - fail-closed schema/cache handling, non-crashing device-storage failures, transactional audit-write verification, keyboard and narrow-screen refinements, reset confirmation, and a settings regression matrix ([plan](docs/PLAN_SOC_6D_SOCCER_SETTINGS.md), [regression matrix](docs/REGRESSION_SOC_6D_SETTINGS.md))
- [x] **Soccer availability and cloud capability preflight (SOC-6E1)** - centralized preview/release/discovery/history policy, production-safe existing Soccer routes, migration 049 capability handshake, account-scoped strict parsing, and preflight-before-mutation cloud entry with explicit local fallback ([plan](docs/PLAN_SOC_6E_RELEASE_HARDENING.md))
- [ ] **Soccer release hardening sign-off (SOC-6E2)** - automated release contracts, fail-closed legacy settings, stale-PWA recovery guidance, and the consolidated operator matrix are implemented; development/staging and unreleased-production evidence remains to be recorded ([plan](docs/PLAN_SOC_6E_RELEASE_HARDENING.md), [release matrix](docs/REGRESSION_SOC_6E_RELEASE.md))
- [x] **Soccer production enablement (SOC-6E3)** - owner-only rollout approved; the centralized production policy offers Soccer as a device-local opt-in while preserving existing records when disabled, with post-deployment iteration evidence tracked in the release matrix ([plan](docs/PLAN_SOC_6E_RELEASE_HARDENING.md), [release matrix](docs/REGRESSION_SOC_6E_RELEASE.md))

- [x] **Basketball shared event engine (BKE-1A)** - sport-neutral state dispatch/fingerprints, fail-closed aggregate-sync capabilities, definition-scoped neutral event sides, and atomic final-candidate multi-event revisions with unchanged Soccer behavior ([plan](docs/PLAN_BKE_1A_SHARED_EVENT_ENGINE.md))
- [x] **Basketball state and lifecycle foundation (BKE-1B1)** - immutable rules/setup snapshots, stable tracked/opponent participants, defensive state normalization, lifecycle event projection, and parking/fingerprint coverage without production runtime registration ([plan](docs/PLAN_BKE_1B_BASKETBALL_EVENT_FOUNDATION.md))
- [x] **Basketball stat-event projection (BKE-1B2)** - strict shooting/free-throw/assist/rebound/steal/block/turnover/score-adjustment events, participant/side/team totals, normalized court geometry, advisory relationship diagnostics, located shot projection, and reducer-equivalence fixtures behind the private runtime gate ([plan](docs/PLAN_BKE_1B_BASKETBALL_EVENT_FOUNDATION.md))
- [x] **Basketball administrative parity and authority (BKE-1B3)** - strict foul/ejection/timeout/minutes events, period team fouls, bonus/disqualification/team technical projections, durable event authority with corrupt-state quarantine, complete runtime registration, and an unchanged aggregate creation path ([plan](docs/PLAN_BKE_1B_BASKETBALL_EVENT_FOUNDATION.md))
- [x] **Basketball event-game setup and command foundation (BKE-1C1)** - development-only local creation intent, immutable participant/setup snapshot, atomic Period 1 start, and checked command context ([plan](docs/PLAN_BKE_1C_COURT_EVENTS.md))
- [x] **Basketball event-backed court capture (BKE-1C2)** - projected court filters and markers, persistent side/player targeting, unlinked popup stats, and atomic linked shot/assist/rebound capture ([plan](docs/PLAN_BKE_1C_COURT_EVENTS.md))
- [x] **Basketball grouped court corrections (BKE-1C3)** - capture-unit Recent Events, newest-first undo/restore, and dependency-aware Clear Chart with reload-safe inverse receipts ([plan](docs/PLAN_BKE_1C_COURT_EVENTS.md))

### What's Next

- [ ] **Soccer post-deployment validation** - exercise the owner-only opt-in release against migration 049 and retain the broader role/device/failure matrix before access expands ([release matrix](docs/REGRESSION_SOC_6E_RELEASE.md), [SOC-6 plan](docs/PLAN_SOC_6_SUMMARY_AND_RELEASE.md))
- [x] **Basketball lifecycle and participants (BKE-2A)** - sequential regulation/overtime transitions, local completion, late participants, generalized capture units, and non-undoable lifecycle boundaries ([plan](docs/PLAN_BKE_2_COMPLETE_EVENT_CAPTURE.md))
- [x] **Basketball direct stats, score, and minutes (BKE-2B)** - event-backed grid/score controls, optional steal-turnover pairing, unlocated direct shots, and safe decrements ([plan](docs/PLAN_BKE_2_COMPLETE_EVENT_CAPTURE.md))
- [x] **Basketball foul and free-throw domain (BKE-2C1)** - checked foul/trip/attempt commands, one-and-one enforcement, consequential corrections, and reload-safe exact restore ([plan](docs/PLAN_BKE_2_COMPLETE_EVENT_CAPTURE.md))
- [x] **Basketball foul and awarded-free-throw UI (BKE-2C2)** - structured foul sheet, resumable trip workspace, player/team grid actions, and consequence-aware corrections ([plan](docs/PLAN_BKE_2_COMPLETE_EVENT_CAPTURE.md))
- [x] **Basketball official ejections (BKE-2C3)** - checked player/staff rulings with optional foul links, focused capture/correction UI, projected DQ/Ejected labels, and domain-level unavailable-player enforcement ([plan](docs/PLAN_BKE_2_COMPLETE_EVENT_CAPTURE.md))
- [x] **Basketball timeout administration (BKE-2C4)** - checked charged and neutral timeout capture, finite/unlimited inventory enforcement, focused inventory UI, newest-match correction, and exact restore ([plan](docs/PLAN_BKE_2_COMPLETE_EVENT_CAPTURE.md))
- [x] **Basketball discipline and administration (BKE-2C)** - structured fouls, free-throw trips, ejections, timeouts, and dependency-aware corrections ([plan](docs/PLAN_BKE_2_COMPLETE_EVENT_CAPTURE.md))
- [x] **Basketball complete tracker parity (BKE-2D)** - team/period presentation, projected bonus/inventory state, local suspend/abandon/reopen, unavailable participants, and full exit regression ([plan](docs/PLAN_BKE_2_COMPLETE_EVENT_CAPTURE.md))
- [x] **Basketball event Timeline and read-only detail (BKE-3A)** - Track/Timeline workspace, filtered capture groups, revision/removal diagnostics, shared event/legacy shot detail, and nearest-marker touch selection with an ambiguity chooser ([plan](docs/PLAN_BKE_3_EVENT_TIMELINE_AND_F13.md))
- [x] **Basketball F13 shot and relationship editing (BKE-3C)** - atomic marker/Timeline shot editing, court location placement, assist/rebound/block re-linking, and recorded-later field-goal additions ([plan](docs/PLAN_BKE_3_EVENT_TIMELINE_AND_F13.md))
- [x] **Basketball related-event editors (BKE-3D1)** - assist/rebound/steal/block/turnover editing, safe relationship repair, historical additions, and paired Steal + Turnover capture ([plan](docs/PLAN_BKE_3_EVENT_TIMELINE_AND_F13.md))
- [x] **Basketball score and minutes editors (BKE-3D2)** - checked signed score/manual-minutes correction, historical additions to started periods, reason preservation, and non-negative projection guards ([plan](docs/PLAN_BKE_3_EVENT_TIMELINE_AND_F13.md))
- [x] **Basketball foul and free-throw editors (BKE-3D3)** - structured foul/award/attempt correction, dependency repair, stable trip positions, and recorded-later additions ([plan](docs/PLAN_BKE_3_EVENT_TIMELINE_AND_F13.md))
- [x] **Basketball administration editors and exit audit (BKE-3D4)** - ejection/timeout correction and additions, period inventory enforcement, parity fixtures, and final local-model audit ([plan](docs/PLAN_BKE_3_EVENT_TIMELINE_AND_F13.md))
- [x] **Basketball event Timeline and F13 (BKE-3)** - complete event review, detail editing, remove/restore, relationships, historical additions, and checked correction across every user-recorded family ([plan](docs/PLAN_BKE_3_EVENT_TIMELINE_AND_F13.md))
- [x] **Basketball neutral event transport foundation (BKE-4A1)** - staged neutral-side constraint widening, private sport-neutral base binding, permanent Soccer compatibility wrapper, and migration-046-equivalent revision/checkpoint behavior ([plan](docs/PLAN_BKE_4A_NEUTRAL_RPC_EXTRACTION.md))
- [x] **Basketball event recovery extraction (BKE-4A2)** - private setup/adoption binding, atomic immutable-snapshot enforcement, permanent Soccer v2 compatibility, and sport-bounded same-recorder conflicts ([plan](docs/PLAN_BKE_4A_NEUTRAL_RPC_EXTRACTION.md))
- [x] **Basketball recorder-resolution extraction (BKE-4A3)** - private checkpoint, recorder, primary-selection, history, and independent-recorder binding cores behind permanent Soccer wrappers ([plan](docs/PLAN_BKE_4A_NEUTRAL_RPC_EXTRACTION.md))
- [x] **Basketball finalization/recovery extraction (BKE-4A4)** - staged canonical-publication widening, private neutral finalization/reopen/recovery cores, trusted Soccer policy wrappers, and aggregate-only Basketball compatibility ([plan](docs/PLAN_BKE_4A_NEUTRAL_RPC_EXTRACTION.md), [regression](docs/REGRESSION_BKE_4A_PLATFORM.md))
- [x] **Basketball shared event transport (BKE-4B1)** - fixed Basketball v4 binding wrapper, sport-neutral pull/merge/upload/checkpoint engine, shared conflict ownership, Soccer parity, and the Basketball adapter contract ([plan](docs/PLAN_BKE_4B_BASKETBALL_TRANSPORT.md), [regression](docs/REGRESSION_BKE_4B_TRANSPORT.md))
- [x] **Basketball automatic event sync (BKE-4B2)** - fail-closed aggregate/event routing, personal and authorized-team binding, durable queue/recovery integration, editable nonfinal cloud games, and no legacy stat/shot dual writes ([plan](docs/PLAN_BKE_4B_BASKETBALL_TRANSPORT.md), [regression](docs/REGRESSION_BKE_4B_TRANSPORT.md))
- [x] **Basketball event recovery and conflicts (BKE-4B3)** - strict current-recorder cloud adoption, resume-first parked bindings, shared explicit conflict controls, durable recovery metadata, malformed-source quarantine, and duplicate-binding protection ([plan](docs/PLAN_BKE_4B_BASKETBALL_TRANSPORT.md), [regression](docs/REGRESSION_BKE_4B_TRANSPORT.md))
- [x] **Basketball event transport (BKE-4B)** - shared bind/pull/merge/upload/checkpoint transport, automatic Basketball sync, cross-device recovery, explicit conflicts, and offline retry in three slices ([plan](docs/PLAN_BKE_4B_BASKETBALL_TRANSPORT.md))
- [x] **Basketball recorder/finalization contracts (BKE-4C1)** - role-limited recorder preparation wrappers, Basketball terminal/score policy, manager checkpoint confirmation, and the canonical payload contract without enabling publication ([plan](docs/PLAN_BKE_4C_RECORDERS_AND_FINALIZATION.md), [regression](docs/REGRESSION_BKE_4C_FINALIZATION.md))
- [x] **Basketball recorder presence and primary selection (BKE-4C2)** - strict role-limited presence/history clients, isolated read-only stream projection, compact tracker health, and team/personal Game Info management without stream blending ([plan](docs/PLAN_BKE_4C_RECORDERS_AND_FINALIZATION.md), [regression](docs/REGRESSION_BKE_4C_FINALIZATION.md))
- [x] **Basketball transactional canonical finalization (BKE-4C3)** - schema-gated fixed finalization RPC, trusted server score policy, isolated primary preview/checkpoint preparation, explicit Game Info confirmation, conflict handling, and canonical authority metadata ([plan](docs/PLAN_BKE_4C_RECORDERS_AND_FINALIZATION.md), [regression](docs/REGRESSION_BKE_4C_FINALIZATION.md))
- [x] **Basketball reopen and republication (BKE-4C4)** - manager publication history, fixed reason-required reopen RPC, append-only invalidation, owned parked-binding recovery, and BKE-3 correction/re-finalization handoff ([plan](docs/PLAN_BKE_4C_RECORDERS_AND_FINALIZATION.md), [regression](docs/REGRESSION_BKE_4C_FINALIZATION.md))
- [x] **Basketball recorder authority and finalization (BKE-4C)** - recorder presence, deterministic primary selection, canonical publication, audited reopen/republication, and finalized correction integration in four slices ([plan](docs/PLAN_BKE_4C_RECORDERS_AND_FINALIZATION.md))
- [x] **Basketball Summary authority foundation (BKE-4D1)** - isolated local, primary, alternate, and canonical sources; fail-closed final review; explicit route authority; and projection-derived Overview ([plan](docs/PLAN_BKE_4D_SUMMARY_AUTHORITY.md), [regression](docs/REGRESSION_BKE_4D_SUMMARY.md))
- [x] **Basketball Summary Players and Team Stats (BKE-4D2)** - stable participant rows, traditional and safe derived box scores, authoritative side totals, and participant versus team/unknown attribution ([plan](docs/PLAN_BKE_4D_SUMMARY_AUTHORITY.md), [regression](docs/REGRESSION_BKE_4D_SUMMARY.md))
- [x] **Basketball Summary Timeline (BKE-4D3)** - complete oldest-first event review with local-only correction and read-only remote/canonical authorities ([plan](docs/PLAN_BKE_4D_SUMMARY_AUTHORITY.md), [regression](docs/REGRESSION_BKE_4D_SUMMARY.md))
- [x] **Basketball Summary Shot Chart and exit audit (BKE-4D4)** - authority-aware located/unlocated field-goal review, filters, overlap handling, shared detail/correction, and explicit terminal routing ([plan](docs/PLAN_BKE_4D_SUMMARY_AUTHORITY.md), [regression](docs/REGRESSION_BKE_4D_SUMMARY.md))
- [x] **Basketball Summary authority (BKE-4D)** - Overview, Players, Timeline, Shot Chart, and Team Stats consume one explicit authority with legacy Basketball preserved ([plan](docs/PLAN_BKE_4D_SUMMARY_AUTHORITY.md))
- [x] **Basketball canonical aggregate engine (BKE-4E1)** - exact `bk_*` stat/rate catalog, isolated canonical and resolved-legacy game projection, recorded participation, authoritative team totals, mixed provenance and metric availability, stable-player career history, and one-authority enforcement ([plan](docs/PLAN_BKE_4E_AGGREGATES_AND_RELEASE_READINESS.md), [regression](docs/REGRESSION_BKE_4E_AGGREGATES.md))
- [x] **Basketball aggregate source transport (BKE-4E2)** - migration 060 fixed canonical/legacy scope and player RPCs, private sport-neutral canonical paging with Soccer parity, correction-resolved legacy sources, strict dual-family transport, cancellation, metrics, and fail-closed authority collisions ([plan](docs/PLAN_BKE_4E_AGGREGATES_AND_RELEASE_READINESS.md), [regression](docs/REGRESSION_BKE_4E_TRANSPORT.md))
- [x] **Basketball aggregate destinations (BKE-4E3/E4)** - Leaderboard, Team Stats, Tournament Stats, Player Profile, and Career use authority-aware mixed legacy/canonical sources with stable identity, Personal separation, provenance, and correct Summary/Game Info routing ([plan](docs/PLAN_BKE_4E_AGGREGATES_AND_RELEASE_READINESS.md), [regression](docs/REGRESSION_BKE_4E_PLAYER_CAREER.md))
- [x] **Basketball capability and release exit audit (BKE-4E5)** - migration 061 exact authenticated BKE-4 handshake, account-isolated client cache, no-mutation internal event-cloud preflight, and consolidated live release matrix ([plan](docs/PLAN_BKE_4E_AGGREGATES_AND_RELEASE_READINESS.md), [regression](docs/REGRESSION_BKE_4E_RELEASE_READINESS.md))
- [x] **Basketball canonical aggregates and release readiness (BKE-4E)** - five implemented slices covering mixed legacy/canonical history, paginated source transport, all aggregate destinations, capability negotiation, and release evidence; pending live rows remain required before the owner-only rollout broadens ([plan](docs/PLAN_BKE_4E_AGGREGATES_AND_RELEASE_READINESS.md))
- [x] **Basketball rule profiles and compatibility (BKE-5A)** - seven immutable source-linked tracking profiles, strict version-2 segment/foul/timeout rules and layered resolution, Youth Equal-Play's eight-period structure, version-1 history preservation, and profile-aware projection/correction ([plan](docs/PLAN_BKE_5_SETTINGS_AND_EVENT_ROLLOUT.md), [regression](docs/REGRESSION_BKE_5A_PROFILES.md))
- [x] **Basketball settings foundation (BKE-5B1)** - migration 062 fixed personal/team CAS wrappers, exact schema/profile parsing, strict structural rule validation, metadata-only team audit, and capability contract v2; UI consumption begins in BKE-5B2/BKE-5B3 ([plan](docs/PLAN_BKE_5_SETTINGS_AND_EVENT_ROLLOUT.md), [regression](docs/REGRESSION_BKE_5B1_SETTINGS_FOUNDATION.md))
- [x] **Basketball personal/team settings (BKE-5B2/B3)** - account/device personal reconciliation, role-aware shared team rules, strict cache isolation, CAS conflict recovery, and compact source-aware settings surfaces ([plan](docs/PLAN_BKE_5_SETTINGS_AND_EVENT_ROLLOUT.md), [regression](docs/REGRESSION_BKE_5B3_TEAM_SETTINGS.md))
- [x] **Basketball profile review and legacy import (BKE-5B4)** - explicit effective-rule diffs with compatible override preservation, manager-reviewed season import into an unsaved team draft, and deterministic personal/team/match hierarchy coverage ([regression](docs/REGRESSION_BKE_5B4_UPGRADES_IMPORT.md), [BKE-5B exit](docs/REGRESSION_BKE_5B_SETTINGS.md))
- [x] **Basketball setup authority and binding policy (BKE-5C)** - account-scoped reload-safe drafts, mutation-free entry, exact personal/team/match rules review and immutable freeze, per-game court orientation, capability recovery, durable local-only policy, and guarded later cloud binding ([plan](docs/PLAN_BKE_5C_SETUP_AUTHORITY_AND_BINDING.md), [C1 regression](docs/REGRESSION_BKE_5C1_SETUP_DRAFT.md), [C2 regression](docs/REGRESSION_BKE_5C2_RULES_FREEZE.md), [C3 regression](docs/REGRESSION_BKE_5C3_LOCAL_ONLY.md), [C4 regression](docs/REGRESSION_BKE_5C4_ENABLE_CLOUD.md))
- [x] **Basketball release hardening (BKE-5D1)** - centralized internal/opt-in creation policy, strict default-off device preference, separate Tracker settings UI, setup plus atomic commit guards, and existing-game continuation invariants; this slice left production internal ([plan](docs/PLAN_BKE_5D_RELEASE_AND_EXIT.md), [regression](docs/REGRESSION_BKE_5_SETTINGS_AND_ROLLOUT.md))
- [x] **Basketball production opt-in activation (BKE-5D2)** - centralized production stage switched to `opt_in` while the device preference and fresh per-game authority remain default-off; deployment smoke remains pending ([plan](docs/PLAN_BKE_5D_RELEASE_AND_EXIT.md), [regression](docs/REGRESSION_BKE_5_SETTINGS_AND_ROLLOUT.md))
- [ ] **Basketball settings and event rollout (BKE-5A-5D)** - implementation is complete through BKE-5D2; deployment evidence and focused owner smoke remain, with a broader-release evidence gate ([plan](docs/PLAN_BKE_5_SETTINGS_AND_EVENT_ROLLOUT.md), [BKE-5D plan](docs/PLAN_BKE_5D_RELEASE_AND_EXIT.md))
- [x] **Basketball clock and lineup planning (BKE-6)** - approved rules-v3 anchored clock, explicit stoppages, opening/live lineups, atomic substitutions, equal-play enforcement, exact intervals, cloud capability, and five-slice delivery roadmap ([plan](docs/PLAN_BKE_6_CLOCK_AND_LINEUPS.md))
- [x] **Basketball rules/setup clock foundation (BKE-6A1)** - strict rules v3 and setup v2, deliberate clone-only upgrades, atomic settings compatibility, exact opening-lineup authority, migration 063, and an isolated fixed feature handshake without production creation or UI ([plan](docs/PLAN_BKE_6A_CLOCK_LINEUP_FOUNDATION.md), [regression](docs/REGRESSION_BKE_6A1_RULES_SETUP.md))
- [x] **Basketball anchored clock projection (BKE-6A2)** - strict clock/stoppage events, deterministic anchored replay, authoritative expiration pauses, pure count-up/countdown display derivation, and atomic checked Start/Pause/Set Clock commands without production controls ([plan](docs/PLAN_BKE_6A_CLOCK_LINEUP_FOUNDATION.md), [regression](docs/REGRESSION_BKE_6A2_CLOCK_PROJECTION.md))
- [x] **Basketball lineup projection (BKE-6A3)** - strict lineup, substitution, role, and equal-play events; exact running-clock participation; replacement and boundary guards; and checked local commands without production controls ([plan](docs/PLAN_BKE_6A_CLOCK_LINEUP_FOUNDATION.md), [regression](docs/REGRESSION_BKE_6A3_LINEUP_PROJECTION.md))
- [x] **Basketball clock/lineup foundation (BKE-6A)** - all three no-UI implementation slices are complete; BKE-6B owns production setup and live-clock controls ([plan](docs/PLAN_BKE_6A_CLOCK_LINEUP_FOUNDATION.md))
- [x] **Basketball production clock contracts (BKE-6B1)** - device alert preferences, deliberate version-3 controls and compatibility confirmation, restart-safe opening-lineup drafts, and shared local/runtime policy guards without production anchored startup ([plan](docs/PLAN_BKE_6B_PRODUCTION_SETUP_AND_CLOCK.md), [regression](docs/REGRESSION_BKE_6B1_CLOCK_SETUP_CONTRACTS.md))
- [x] **Basketball anchored setup (BKE-6B2)** - immutable version-3 setup review, restart-safe Starter/Bench/DNP opening-lineup capture, guarded local-only setup-v2 commit, and paused Period 1 start ([plan](docs/PLAN_BKE_6B_PRODUCTION_SETUP_AND_CLOCK.md), [regression](docs/REGRESSION_BKE_6B2_ANCHORED_SETUP.md))
- [x] **Basketball live anchored clock (BKE-6B3)** - one canonical command-time path, sticky Track/Timeline controls, same-five boundary confirmation, Start/Pause/Stoppage/Set Clock, expiration, and reasoned reload recovery ([plan](docs/PLAN_BKE_6B_PRODUCTION_SETUP_AND_CLOCK.md), [regression](docs/REGRESSION_BKE_6B3_LIVE_CLOCK.md))
- [x] **Basketball production clock exit (BKE-6B4)** - centralized running-clock park/replacement preparation, checked Pause before storage mutation, atomic Pause plus End Period, paused terminal controls, and consolidated exit evidence ([plan](docs/PLAN_BKE_6B_PRODUCTION_SETUP_AND_CLOCK.md), [regression](docs/REGRESSION_BKE_6B_PRODUCTION_CLOCK.md))
- [x] **Basketball live-lineup planning (BKE-6C)** - approved side-aware substitutions, boundary/equal-play review, roles/recovery, grouped correction, and four-slice delivery contract ([plan](docs/PLAN_BKE_6C_LIVE_LINEUPS_AND_CORRECTIONS.md))
- [x] **Basketball live substitutions (BKE-6C1)** - paused side-aware multi-player substitution sheet, explicit unbalanced reasons, atomic capture, and optional opponent authority ([plan](docs/PLAN_BKE_6C_LIVE_LINEUPS_AND_CORRECTIONS.md))
- [x] **Basketball boundary and equal-play review (BKE-6C2)** - changed-five confirmation, advisory evaluation, enforced reasoned overrides, and Clock Start gating ([plan](docs/PLAN_BKE_6C_LIVE_LINEUPS_AND_CORRECTIONS.md))
- [x] **Basketball roles and lineup recovery (BKE-6C3)** - position/captain history, replacement and late-player integration, and reasoned Set Current Lineup ([plan](docs/PLAN_BKE_6C_LIVE_LINEUPS_AND_CORRECTIONS.md), [regression](docs/REGRESSION_BKE_6C3_ROLES_AND_RECOVERY.md))
- [x] **Basketball lineup correction and exit (BKE-6C4)** - grouped Recent Events, consequence-aware Timeline correction, stale-safe restore, diagnostics, and exit evidence ([plan](docs/PLAN_BKE_6C_LIVE_LINEUPS_AND_CORRECTIONS.md), [regression](docs/REGRESSION_BKE_6C4_LINEUP_CORRECTIONS.md))
- [x] **Basketball cloud Summary and lifecycle planning (BKE-6D)** - approved anchored Summary quality, exact-second aggregates, dual-capability transport, recorder readiness, mode-aware reopen, republication, and four-slice delivery contract ([plan](docs/PLAN_BKE_6D_CLOUD_SUMMARY_AND_AGGREGATES.md))
- [x] **Basketball anchored Summary detail (BKE-6D1)** - projection-derived participation, stint/role history, quality disclosure, and eligible player/lineup plus-minus across isolated local and remote authorities ([plan](docs/PLAN_BKE_6D_CLOUD_SUMMARY_AND_AGGREGATES.md), [regression](docs/REGRESSION_BKE_6D1_SUMMARY_DETAIL.md))
- [x] **Basketball exact-second aggregates (BKE-6D2)** - additive appearance/DNP/minutes/plus-minus projection with explicit coverage provenance and clockless compatibility ([plan](docs/PLAN_BKE_6D_CLOUD_SUMMARY_AND_AGGREGATES.md), [regression](docs/REGRESSION_BKE_6D2_EXACT_AGGREGATES.md))
- [x] **Basketball anchored cloud transport (BKE-6D3)** - dual-capability creation/binding, one-recorder running sync, strict adoption, recoverable incomplete upload, and team-role revalidation ([plan](docs/PLAN_BKE_6D_CLOUD_SUMMARY_AND_AGGREGATES.md), [regression](docs/REGRESSION_BKE_6D3_ANCHORED_CLOUD_TRANSPORT.md))
- [x] **Basketball anchored finalization and reopen (BKE-6D4)** - migration 064 trusted readiness, mode-aware correction/resume handoff, immutable audit history, and explicit republication ([plan](docs/PLAN_BKE_6D_CLOUD_SUMMARY_AND_AGGREGATES.md), [regression](docs/REGRESSION_BKE_6D4_FINALIZATION_AND_REOPEN.md))
- [x] **Basketball release-hardening planning (BKE-6E)** - approved three-slice release audit, compatibility, responsive/accessibility/PWA, rollback, owner-smoke, and broader-matrix contract ([plan](docs/PLAN_BKE_6E_RELEASE_HARDENING.md))
- [ ] **Basketball release audit and consolidated matrix (BKE-6E1)** - inventory and prove every release entry, capability, existing-record, Legacy/clockless, Soccer, and mixed-sport boundary in one operator record ([plan](docs/PLAN_BKE_6E_RELEASE_HARDENING.md))
- [ ] **Basketball release-surface hardening (BKE-6E2)** - focused responsive, accessibility, installed-PWA, offline/recovery, mixed-sport, and rollback rehearsal with blocker-only fixes ([plan](docs/PLAN_BKE_6E_RELEASE_HARDENING.md))
- [ ] **Basketball owner smoke and sign-off (BKE-6E3)** - exact-candidate local/cloud owner smoke, evidence disposition, and BKE-6 completion while the broader matrix continues to gate wider access ([plan](docs/PLAN_BKE_6E_RELEASE_HARDENING.md))
- [ ] **Basketball event-model migration (BKE-4 through BKE-6)** - cloud lifecycle and aggregates, settings/rollout, then clock and lineups ([roadmap](docs/PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md))
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
