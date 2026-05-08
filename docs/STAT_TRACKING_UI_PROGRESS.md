# Stat tracking UI (Phase 6) — implementation progress

Parent plan: [DESIGN_STAT_TRACKING_UI.md](DESIGN_STAT_TRACKING_UI.md) · Seasons: [DESIGN_SEASONS_DATA_MODEL.md](DESIGN_SEASONS_DATA_MODEL.md).

**Status:** Phase 6 UI and RPCs described in the parent design are **implemented** in the app (leaderboard, player profile, career, team stats, tournament stats, game log fallbacks, tournament placement editing, Games list polish). Treat this file as a **historical work log**, not an open backlog.

## Shipped (summary)

- [x] Migration **`020_stat_tracking_ui_rpcs.sql`**: `get_player_game_log`, `get_career_stats_resolved`, `get_team_game_log`
- [x] **Leaderboard** — season + team scope, games played, links to Career / team stats
- [x] **Player profile** — season header, career link, inline game log (RPC + fallback)
- [x] **`/career`**, **`/team-stats`**, **`/tournament-stats`** routes and pages
- [x] Migration **021** `get_tournament_stats_resolved` + fallbacks
- [x] **`keyStatIds`** across sports + **`formatCompactGameStatLine`** in `src/lib/statDisplay.ts`
- [x] Team season **By opponent** table; **Games** list scores / tournament deep links; tournament **placement** edit for owner/admin
- [x] Teams roster **Career** links; Game Summary **Players / Team** tabs

## Optional follow-ups (product, not blockers)

- Further stat-view polish per [DESIGN_STAT_TRACKING_UI.md](DESIGN_STAT_TRACKING_UI.md) (copy, layout, or additional aggregates).
- Any new RPCs if reporting outgrows client-side fallbacks.

## Apply in Supabase

Run **`020`** after migrations through **010** (resolved stats). Run **`021`** for tournament aggregates. See README for full migration order through **033**.
