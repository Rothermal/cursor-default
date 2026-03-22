# Stat tracking UI (Phase 6) — implementation progress

Parent plan: [DESIGN_STAT_TRACKING_UI.md](DESIGN_STAT_TRACKING_UI.md) · Seasons phase table: [DESIGN_SEASONS_DATA_MODEL.md §10](DESIGN_SEASONS_DATA_MODEL.md).

## Done (this branch)

- [x] Migration **`020_stat_tracking_ui_rpcs.sql`**: `get_player_game_log`, `get_career_stats_resolved`, `get_team_game_log`
- [x] **Leaderboard**: season dropdown, URL `seasonId` + `teamId`, games played on rows, **Team stats →** link, **Career** link per row (opens `/career` with `playerId` + season sport)
- [x] **Player profile**: season line in header, **Career →**, inline game log (RPC; N×`get_game_stats_resolved` fallback if RPC missing)
- [x] **`/career`**: career totals + by-season list; multi-sport picker when needed
- [x] **`/team-stats`**: W/L, tournaments list + placement, game-by-game (RPC or per-game fallback)
- [x] **Teams** roster: **Career** link per player
- [x] **`keyStatIds`** on basketball + **`formatCompactGameStatLine`** in `src/lib/statDisplay.ts`

## Not done yet

- [x] **Tournament stats** page `/tournament-stats` + migration **021** `get_tournament_stats_resolved` (fallback aggregates per game if RPC missing)
- [x] **Game Summary** Players / Team tab (team tab = score card + team totals tables only)
- [x] **`keyStatIds`** for baseball, football, hockey, soccer + `statDisplay` uses only configured keys (no bogus basketball ids)
- [x] Team season summary: **By opponent** table (aggregated W-L-T, PF-PA, +/-)
- [x] **Cloud Games** list: `teamDisplayName`, final score line via `get_game_stats_resolved`, **Tournament stats** link when `tournament_id` set
- [x] **Tournament stats**: **Career** link per leaderboard row; team **owner/admin** can edit **placement** (`tournaments.placement`) in-app

## Latest slice (021 + UI)

- `021_tournament_stats_rpc.sql`
- `TournamentStats.tsx`, route, Team stats → **Stats →** per tournament
- `GameSummary.tsx`: **Players** / **Team** toggle (alongside cloud Primary/All when applicable)

## Slice: polish (keyStatIds, team by-opponent, games list)

- `sports.ts`: `keyStatIds` for all sports
- `statDisplay.ts`: score label helper; only iterate `keyStatIds` when set
- `TeamStats.tsx`: **By opponent** section
- `Games.tsx`: nickname + season in team query, score on final cards, tournament deep link

## Slice: leaderboard career + editable tournament placement

- `Leaderboard.tsx`: row layout with **Career** link (HashRouter-safe `Link`)
- `TournamentStats.tsx`: same **Career** links on tournament leaderboard; **Placement** form for owners/admins (updates `tournaments.placement`, blank clears)

## Apply in Supabase

Run `020_stat_tracking_ui_rpcs.sql` after migrations through **010** (resolved stats). Optional if you rely on client fallbacks, but recommended for performance.
