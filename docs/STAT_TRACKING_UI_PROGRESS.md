# Stat tracking UI (Phase 6) — implementation progress

Parent plan: [DESIGN_STAT_TRACKING_UI.md](DESIGN_STAT_TRACKING_UI.md) · Seasons phase table: [DESIGN_SEASONS_DATA_MODEL.md §10](DESIGN_SEASONS_DATA_MODEL.md).

## Done (this branch)

- [x] Migration **`020_stat_tracking_ui_rpcs.sql`**: `get_player_game_log`, `get_career_stats_resolved`, `get_team_game_log`
- [x] **Leaderboard**: season dropdown, URL `seasonId` + `teamId`, games played on rows, **Team stats →** link
- [x] **Player profile**: season line in header, **Career →**, inline game log (RPC; N×`get_game_stats_resolved` fallback if RPC missing)
- [x] **`/career`**: career totals + by-season list; multi-sport picker when needed
- [x] **`/team-stats`**: W/L, tournaments list + placement, game-by-game (RPC or per-game fallback)
- [x] **Teams** roster: **Career** link per player
- [x] **`keyStatIds`** on basketball + **`formatCompactGameStatLine`** in `src/lib/statDisplay.ts`

## Not done yet

- [ ] **Tournament stats** page + `get_tournament_stats_resolved` RPC
- [ ] **Game Summary** Players / Team tab toggle
- [ ] **`keyStatIds`** for sports other than basketball (optional)
- [ ] Team season summary: per-opponent table, richer tournament W/L (optional)

## Apply in Supabase

Run `020_stat_tracking_ui_rpcs.sql` after migrations through **010** (resolved stats). Optional if you rely on client fallbacks, but recommended for performance.
