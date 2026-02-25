# StatKeeper

A mobile-first Progressive Web App for tracking sports game statistics in real time. Built with React, TypeScript, Vite, and Tailwind CSS.

## Features

- **Sport Selection** — configurable sports roster; enable/disable via the Settings page
- **Game Setup** — enter team name, opponent, tournament/league, and date
- **Player Management** — add players with name and jersey number; add more mid-game
- **Live Stat Tracking** — tap-friendly increment/decrement buttons organized by stat category
- **Live Scoreboard** — auto-computed team score from player stats; manual opponent score
- **Undo Support** — undo any stat action instantly
- **Game Summary** — per-player and team totals in organized tables
- **PWA** — installable on Android/iOS home screens, works offline with service worker caching
- **Persistent State** — game and settings saved to localStorage; survives page refreshes

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
- **vite-plugin-pwa** — service worker generation, web app manifest, offline caching

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm

### Install & Run

```bash
pnpm install
pnpm dev
```

The dev server starts at `http://localhost:5173`.

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
├── config/
│   └── sports.ts          # Sport definitions (stats, categories, scoring rules)
├── context/
│   ├── GameContext.tsx     # Game state management (reducer + localStorage)
│   └── SettingsContext.tsx # App settings (enabled sports, persisted)
├── pages/
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
├── App.tsx                # Router + providers
├── main.tsx               # Entry point
└── index.css              # Tailwind directives + custom component classes
```

## Roadmap

### Near-Term

- [ ] Per-sport stat refinements and additional stats
- [ ] Game history — save and review past games
- [ ] Export game stats (CSV, share link)

### Mobile Native (Capacitor)

The app is currently a PWA installable from the browser. For full App Store / Play Store distribution and access to native device APIs, the next step is wrapping the app with [Capacitor](https://capacitorjs.com/):

```bash
pnpm add @capacitor/core @capacitor/cli
npx cap init StatKeeper com.statkeeper.app --web-dir dist
pnpm build
npx cap add android
npx cap add ios
npx cap sync
```

Capacitor uses the same web codebase — no rewrite needed. It provides a native shell with access to device APIs (camera, push notifications, haptic feedback, etc.) while keeping the React app as the UI layer.

### API Integration

Future plans include connecting to the [Sports Engine API](https://www.sportsengine.com/) and other data providers to:

- Pull team rosters and player data automatically
- Sync game results to league platforms
- Import schedules and tournament brackets

Environment variables for API keys and database connectors should be placed in `.env` files (already gitignored).

## License

Private — not yet licensed for distribution.
