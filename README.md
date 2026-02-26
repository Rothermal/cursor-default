# StatKeeper

A mobile-first Progressive Web App for tracking sports game statistics in real time. Built with React, TypeScript, Vite, Tailwind CSS, and Supabase.

## Features

- **Sport Selection** — configurable sports roster; enable/disable via the Settings page
- **Game Setup** — enter team name, opponent, tournament/league, and date
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
   > If migrations are missing or outdated, the in-app scoreboard will show a cloud sync warning/error status.
4. Restart the dev server — the auth page will appear

Without Supabase configured, the app runs in offline-only mode using localStorage.

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
│   ├── GameTracker.tsx    # Live stat tracking interface
│   ├── GameSummary.tsx    # Post-game stat tables
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
    └── 004_team_members_rls_fix.sql

docs/
└── INTEGRATION_PLAN.md    # Full architecture, data model, and phased roadmap
```

## Roadmap

See [`docs/INTEGRATION_PLAN.md`](docs/INTEGRATION_PLAN.md) for the full architecture and phased plan.

| Phase | What | Status |
|---|---|---|
| 1 | **Supabase Foundation** — auth, cloud DB, RLS, migrations, auth UI | In Progress |
| 2 | **Cloud Stat Tracking** — persistent teams/rosters, games saved to cloud | Planned |
| 3 | **Season Stats + Multi-Parent** — player checkout, admin corrections, leaderboards | Planned |
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
- [x] Integration plan with multi-parent checkout model and admin corrections

### What's Next

- [ ] Complete cloud-backed team/roster management UI and editing flows
- [ ] Finalize cloud game lifecycle (history/finalization) and reduce localStorage reliance
- [ ] Game history — save and review past games
- [ ] Per-sport stat refinements and additional stats

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
