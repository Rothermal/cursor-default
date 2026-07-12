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
- **Court capture (basketball):** The half-court lives **inline on Game Tracker** (`#/game`) — tapping the court opens `CourtEventPopup` (Made/Miss stores a located shot via `ADD_SHOT`; the Log for picker can switch the active player before logging; the 2PT/3PT segmented chip defaults from court location but can be overridden before logging; Off/Def Reb, Steal, Block, Assist are stat-only `INCREMENT_STAT`). The full stat grid stays below the court as a second, additive input path. The chart **filters by the selected chip** (individual → their shots; team ★ → that side's union; leading **All** chip → everything) via `src/lib/shotChartViews.ts`; the "All" view changes display only — recording always targets `activePlayerId`. Same filtering on the Game Summary shot chart tab (defaults to All). **F9 missed-shot rebound prompt:** opt-in under Settings → Game tracker (`statkeeper_settings.courtCapture.reboundPromptAfterMiss`); after Missed, Off Reb defaults to the missed-shot side's team pseudo-player and Def Reb defaults to the opposite side, with candidate chips to switch before dispatching a separate `INCREMENT_STAT`. **Cloud game review (F3):** the Summary tab loads **all recorders'** shots (`loadGameShotChartForReview`, one recorder per player: primary → creator → lowest id via `src/lib/shotChartReview.ts`) as display-only local state — never dispatched into `GameState.shotChart`; Cloud Games cards show a "🏀 chart" pill when a game has shots. Legacy `#/shot-chart` **redirects** to `#/game`. **Dev-only SVG preview:** `#/dev/shot-chart` loads sample shots without auth (`ShotChartPreview`); see `docs/REGRESSION_TESTING.md` §4d.
- **Recent-events undo (F12):** The bottom Game Tracker Undo opens `RecentEventsPopup`, labels recent `actionLog` entries with `src/lib/actionLogLabels.ts`, and still unwinds strictly through the newest `UNDO` entry. Older rows are context only; arbitrary out-of-order undo is deferred.
- **Assist-linking (F7):** After a made court shot, `CourtEventPopup` can show an optional **Assisted by?** step for same-side individual teammates from `src/lib/assistCandidates.ts`; choosing one dispatches the shot first, then a plain `INCREMENT_STAT(ast)` for the assister. No reducer/data-model change; F12 shows the two undo rows.
- **Popup stat line (F8):** `ShotChartPanel` computes `formatCompactGameStatLine(sport, effectivePlayer.stats)` and passes it to `CourtEventPopup`; the line is display-only context under **Log for** and updates with the F6 player switch.
- Game state uses local multi-game parking: `statkeeper_games_manifest` tracks `activeLocalGameId` plus parked summaries, each game is stored at `statkeeper_game:{localGameId}` with per-record dirty/revision sync metadata, and `statkeeper_game` remains a legacy/active mirror. P0 parks/resumes multiple local games across sports; P1 drains dirty parked games through the local sync queue; P2 hardens cloud sync by resolving roster/player rows before new `games` inserts and best-effort rolling back a just-created game if child writes fail. Historical orphan cleanup/full transactional sync remains future work — see `docs/PLAN_MULTI_GAME_PARKING.md`. To reset state, use the "New Game" flow or clear localStorage.
- Sport configurations live in `src/config/sports.ts`. Adding a new sport means adding a `SportConfig` entry to the array — the UI auto-discovers it.
- **Team Info hierarchy:** `/team?teamId=` is the canonical cloud team hub. `/teams` is list/create plus pending invites; `/team/manage?teamId=` hosts roster/member management and merge access. Team drill-downs are `/team/roster`, `/team/schedule`, `/team/season`, `/game-info`, and `/player-info`, all query-param based. Team Info Start Game links to `/setup?teamId=`; Leaderboard only backs to Team Info when `from=team` is present.
- **Team-level stats (basketball):** Optional `teamCategories` on `SportConfig`; local pseudo-player ids `__team_home__` / `__team_opp__` (`src/lib/teamPlayers.ts`). Season rules: `seasons.team_stats_config`, edited in **Settings → Seasons** (`SeasonTeamStatsEditor`). Cloud: placeholder rows on `players`, `games.home_team_player_id` / `opp_team_player_id`, RPC `get_game_team_stats`. Game Summary tab **Team stats** when any team stat exists. Design: `docs/completed/DESIGN_TEAM_STATS_*.md`.
