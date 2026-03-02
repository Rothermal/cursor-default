# StatKeeper

A mobile-first Progressive Web App for tracking sports game statistics in real time. Built with React, TypeScript, Vite, Tailwind CSS, and Supabase.

## Features

- **Sport Selection** — configurable sports roster; enable/disable via the Settings page
- **Game Setup** — enter team name, opponent, tournament/league, and date
- **Cloud Team & Roster Management** — create teams and maintain active rosters in Supabase; optional nickname/display names for teams and players
- **Cloud Game Lifecycle** — resume in-progress games, finalize games, and review cloud game history; finalized games show **resolved stats** (checkout + admin corrections) in Game Summary
- **Player Management** — add players with name and jersey number; add more mid-game
- **Live Stat Tracking** — tap-friendly increment/decrement buttons organized by stat category
- **Live Scoreboard** — auto-computed team score from player stats; manual opponent score
- **Undo Support** — undo any stat action instantly
- **Game Summary** — per-player and team totals in organized tables
- **PWA** — installable on Android/iOS home screens, works offline with service worker caching
- **Auth** — Supabase email/password authentication (optional; app works offline without it)
- **Cloud Database** — Supabase PostgreSQL with Row Level Security (migrations + in-app game snapshot sync for signed-in users)
- **Persistent State** — game and settings saved locally with incremental cloud sync when Supabase is configured

### Supported Sports

| Sport | Status | Stats |
|---|---|---|
| Basketball | Enabled by default | FT, 2PT, 3PT, Rebounds (OFF/DEF), Assists, Steals, Blocks, Turnovers, Fouls |
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
   > If you already applied earlier migrations, run only the new ones (e.g. only `008`–`011` for Phase 3 player checkout, resolved stats, and team invites).
   > If migrations are missing or outdated, the in-app scoreboard will show a cloud sync warning/error status.
4. Restart the dev server — the auth page will appear

Without Supabase configured, the app runs in offline-only mode using localStorage.

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
│   └── supabase.ts        # Supabase client init (graceful fallback if not configured)
├── config/
│   └── sports.ts          # Sport definitions (stats, categories, scoring rules)
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
│   ├── GameTracker.tsx    # Live stat tracking interface
│   ├── GameSummary.tsx    # Post-game stat tables (resolved stats + admin corrections)
│   ├── Games.tsx          # Cloud game history and resume/final flows
│   ├── Teams.tsx          # Cloud team + roster management + invites
│   ├── Leaderboard.tsx    # Season leaderboard (sortable by stat)
│   ├── PlayerProfile.tsx  # Player season totals and game log
│   └── Admin.tsx          # Settings — enable/disable sports
├── components/
│   ├── Scoreboard.tsx     # Live score display
│   └── StatButton.tsx     # Reusable stat increment/decrement button
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
    └── 011_team_invites.sql

docs/
├── INTEGRATION_PLAN.md    # Full architecture, data model, and phased roadmap
└── REGRESSION_TESTING.md  # High-level test scripts for all features
```

### Testing

See [`docs/REGRESSION_TESTING.md`](docs/REGRESSION_TESTING.md) for step-by-step regression test scripts (offline mode, auth, teams, games, checkout, corrections, season stats, invites, PWA, deploy).

## Roadmap

See [`docs/INTEGRATION_PLAN.md`](docs/INTEGRATION_PLAN.md) for the full architecture and phased plan.

| Phase | What | Status |
|---|---|---|
| 1 | **Supabase Foundation** — auth, cloud DB, RLS, migrations, auth UI | In Progress |
| 2 | **Cloud Stat Tracking** — persistent teams/rosters, games saved to cloud | Planned |
| 3 | **Season Stats + Multi-Parent** — player checkout, admin corrections, leaderboards | In Progress |
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

### What's Next

- [ ] Deeper admin review tooling: explicit review queue for averaged/conflicting stats and optional "All submissions" comparison view
- [ ] Team collaboration invites: multi-parent workflows, invite links
- [ ] Per-sport stat refinements and additional stats

### Future Enhancements

A backlog of ideas to iterate over:

1. **Manual home team score** — Add the ability to update the home team score just like the away team; disconnect game score completely from player stats (home score is currently auto-computed from player stats).
2. **Editable team names, player names, and tournaments** — Allow editing from the proper locations; editing and sync work for both local and cloud.
   - **Team names**: Edit primary team name (and nickname) from the Teams page; keep history when editing (update historical game records). Also support editing **opponent** team names from both Game Setup and Games history.
   - **Player names**: Edit first name, last name, and jersey number from both the Teams roster and PlayerSetup; currently only nickname is editable.
   - **Tournaments**: (a) Tournament name field in Game Setup remains editable. (b) Tournaments as its own table — central `tournaments` table in Supabase; games reference `tournament_id`; multiple games in the same tournament can be aggregated (e.g., tournament standings, stats across games).
4. **Minutes played, game notes, missed shots** — Extend stat tracking:
   - **Minutes played**: Per-player counter with +/- buttons (whole minutes); only for sports that traditionally track minutes played (e.g., basketball, hockey, soccer, football).
   - **Notes**: Open text field at the bottom; editable and saved during the game; sync to cloud; editable from multiple areas (Game Tracker, Game Summary, etc.).
   - **Missed shots**: Per-player single counter with +/- buttons; only for sports that track shots (e.g., basketball, hockey).
5. **Delete editable entities** — Ability to delete all editable things (teams, players, tournaments, games, etc.). Every delete action shows a confirmation prompt with Yes/No buttons before proceeding.
6. **Score totals in game list** — Game summaries / game history menu should show the score totals for each team (home vs opponent) in the list.
7. **Optional stat descriptions** — Toggle to display full stat names (e.g., "Free Throw") instead of abbreviated labels (e.g., "FT"); or optionally show stat descriptions.
8. **Games tied to season** — Determine how games are tied to an individual season (e.g., team has season field; games inherit or reference it; season filter in leaderboard).
9. **Clean up existing games** — A way to clean up existing games (delete, archive, or bulk actions).
10. *(Add more as we go)*

### Known Issues

1. **Completed game appears as both final and in progress** — When a game is completed from the summary, in cloud saves it appears as both a completed game and as an in-progress game. When a game is closed and saved, the in-progress game should end.

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
