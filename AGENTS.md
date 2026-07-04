# AGENTS.md

> **New to this repo?** Read [docs/AGENT_CODEBASE_OVERVIEW.md](docs/AGENT_CODEBASE_OVERVIEW.md) first for architecture, file map, and doc workflow. This file is runtime ops and gotchas only.

## Cursor Cloud specific instructions

**StatKeeper** is a mobile-first React web app for tracking sports statistics in real time. It uses React 18 + TypeScript + Vite + Tailwind CSS 3.

### Services

| Service | Command | Port |
|---|---|---|
| Vite dev server | `pnpm dev` | 5173 |

### Key Commands

See `package.json` scripts. Standard commands:
- `pnpm dev` — start dev server (binds `0.0.0.0:5173`)
- `pnpm build` — TypeScript check + production build
- `pnpm lint` — ESLint
- `pnpm preview` — serve production build

### Gotchas

- `pnpm.onlyBuiltDependencies` in `package.json` allowlists `esbuild`; no interactive `pnpm approve-builds` needed.
- The app uses `HashRouter` (`/#/path`), not `BrowserRouter`. URLs in the browser will look like `http://localhost:5173/#/game`.
- **Shot chart (basketball):** Real flow `#/shot-chart` from Game Tracker. **Dev-only SVG preview:** `#/dev/shot-chart` loads sample shots without auth (`ShotChartPreview`); see `docs/REGRESSION_TESTING.md` §4d.
- Game state persists in `localStorage` under key `statkeeper_game` (**single active game**; starting another flow overwrites that snapshot). Planned: multiple parked games + sync queue — see `docs/PLAN_MULTI_GAME_PARKING.md`. To reset state, use the "New Game" flow or clear localStorage.
- Sport configurations live in `src/config/sports.ts`. Adding a new sport means adding a `SportConfig` entry to the array — the UI auto-discovers it.
- **Team-level stats (basketball):** Optional `teamCategories` on `SportConfig`; local pseudo-player ids `__team_home__` / `__team_opp__` (`src/lib/teamPlayers.ts`). Season rules: `seasons.team_stats_config`, edited in **Settings → Seasons** (`SeasonTeamStatsEditor`). Cloud: placeholder rows on `players`, `games.home_team_player_id` / `opp_team_player_id`, RPC `get_game_team_stats`. Game Summary tab **Team stats** when any team stat exists. Design: `docs/completed/DESIGN_TEAM_STATS_*.md`.
