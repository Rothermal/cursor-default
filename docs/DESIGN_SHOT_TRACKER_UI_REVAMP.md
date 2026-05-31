# Design Overview: Shot Tracker UI Revamp (4 features)

This is the umbrella doc for a four-part UI update to StatKeeper's basketball shot
tracking. Each feature has its own detailed plan; this doc captures the shared
context, the data model they all build on, the recommended sequencing, and the
cross-cutting decisions so the four plans stay consistent.

> **Status:** Planning only. No code shipped. Each linked plan is a draft for review.

## The four features

| # | Feature | Plan | One-line goal |
|---|---------|------|----------------|
| **F1** | Combine the shot tracker into the main tab | [PLAN_F1_SHOT_CHART_IN_TRACKER_TAB.md](PLAN_F1_SHOT_CHART_IN_TRACKER_TAB.md) | Make the shot chart a tab inside Game Tracker instead of a separate page. |
| **F2** | Per-player shot tracker + team views | [PLAN_F2_PER_PLAYER_AND_TEAM_SHOT_VIEWS.md](PLAN_F2_PER_PLAYER_AND_TEAM_SHOT_VIEWS.md) | Filter the chart to the selected player; team selections show every player's shots on that side. |
| **F3** | Shot trackers viewable on cloud-saved games | [PLAN_F3_CLOUD_GAME_SHOT_CHARTS.md](PLAN_F3_CLOUD_GAME_SHOT_CHARTS.md) | Show full (all-recorder) shot charts when reviewing in-progress or final cloud games. |
| **F4** | In-progress scores on the resume game UI | [PLAN_F4_IN_PROGRESS_SCORES_ON_RESUME_UI.md](PLAN_F4_IN_PROGRESS_SCORES_ON_RESUME_UI.md) | Display the live score on the home active-game card and the Cloud Games list. |

F1–F3 are tightly related (they all touch the shot tracker surfaces). F4 is
independent and can land in any order.

## Why these belong together

The shipped shot chart (see [completed/DESIGN_SHOT_CHART.md](completed/DESIGN_SHOT_CHART.md)
and [completed/DESIGN_SHOT_CHART_IMPLEMENTATION.md](completed/DESIGN_SHOT_CHART_IMPLEMENTATION.md))
explicitly deferred per-player filtering (§2.2 "v2: Per-Player Shot Charts",
§8.2 "Per-Player Filtering (v2)") and richer review surfaces. F1–F3 are exactly
that deferred work, plus a navigation simplification. F4 is a small, orthogonal
quality-of-life win that fits the same "review/resume" theme.

## Current architecture (what all four plans build on)

### Shot data model — already player-aware

`ShotRecord` (`src/types.ts`) already carries everything F2/F3 need:

```ts
interface ShotRecord {
  id: string; x: number; y: number; made: boolean
  shotType: '2pt' | '3pt'; zone: ShotZone
  playerId: string        // <- already attributed per player
  timestamp: number
}
```

Shots live in `GameState.shotChart: ShotRecord[]` (one flat array per game).
The key gap: **recording is per-player, but display is not.** Both `ShotChart.tsx`
and the `GameSummary` "Shot chart" tab render the *entire* array via
`<BasketballCourt shots={shotChart} />` with no filtering.

### Shared surfaces

| Surface | File | Role |
|---------|------|------|
| Game Tracker | `src/pages/GameTracker.tsx` | "main tab": scoreboard, player selector strip, stat-button grid, period toggle, undo bar; has a **Shot chart** button → `/shot-chart`. |
| Shot Chart page | `src/pages/ShotChart.tsx` | `/shot-chart` route: made/missed toggle, player selector strip, `BasketballCourt` (tap to record), undo/clear, `ShootingSummary`. |
| Game Summary | `src/pages/GameSummary.tsx` | Read-only tabs (Players / Scores / Team stats / Shot chart). Used for both live and cloud (final/in-progress) games. |
| Cloud Games list | `src/pages/Games.tsx` | Lists cloud games; "Resume Game" / "View Summary"; final games show a resolved score line. |
| Home | `src/pages/SportSelect.tsx` | Active-game card (local state) with Resume/New. |
| Court component | `src/components/shot-chart/BasketballCourt.tsx` | Reusable SVG half-court; `shots` + optional `onCourtTap`. |
| Shooting summary | `src/components/shot-chart/ShootingSummary.tsx` | Zone breakdown for a `shots` array. |
| Player ordering | `sortTeamPlayersFirst()` (duplicated in `GameTracker.tsx` and `ShotChart.tsx`) | Team pseudo-players first, then individuals. |

### Player model

- Individual roster players: `Player` with no `teamSide` (all implicitly the **home** side).
- Team pseudo-players: `__team_home__` / `__team_opp__` (`src/lib/teamPlayers.ts`),
  flagged `isTeamPlayer: true` with `teamSide: 'home' | 'opponent'`. Injected by
  `GameTracker`/`GameCheckout` and on cloud hydration.
- There is **no per-opponent-player roster** — the opponent is a single pseudo-player.

### Cloud model

- `shot_chart` table (`supabase/migrations/032_shot_chart.sql`): one row per
  `(game_id, recorded_by, client_shot_id)` with `player_id`, `x`, `y`, `made`,
  `shot_type`, `zone`. RLS: **team members can SELECT all rows** for games on
  their teams; insert/update/delete limited to `recorded_by = auth.uid()`.
- Hydration (`hydrateCloudGameFromRow` in `src/lib/cloudSync.ts`) currently loads
  **only `recorded_by = userId`** shots and maps remote `player_id` → local id.
- Game scores: `getDisplayedHomeScore()` / `resolveFinalHomeScoreFromGameRow()`
  in `src/lib/gameScore.ts`. `games` rows carry `opponent_score`,
  `home_team_score` (nullable), `home_score_adjustment`.

## Cross-cutting decisions (apply to all plans)

1. **Reuse one shot-filtering helper.** F2 introduces a single pure function
   (proposed `src/lib/shotChartViews.ts`) that maps a "selection" (a player id,
   or a team side, or "all") to the subset of `ShotRecord[]` to display. F1's
   in-tab panel, F3's cloud/summary view, and the existing summary tab all consume
   it. No surface should re-implement filtering.

2. **Extract the player-selector strip.** The identical strip is copy-pasted in
   `GameTracker.tsx` and `ShotChart.tsx`. F1 extracts it to
   `src/components/PlayerSelectorStrip.tsx` so the merged tab and any cloud view
   share one implementation. (Targeted cleanup justified because F1 merges those
   two pages.)

3. **`teamSide` is derived, not stored on individual players.** A roster player is
   "home" unless it is the opponent pseudo-player. The view helper computes side
   from `isTeamPseudoPlayer` + `teamSide`, so no migration or `Player` shape change
   is needed. (See F2 for the exact rule.)

4. **Keep the `/shot-chart` route as a redirect alias** after F1 so existing
   bookmarks / deep links and `docs`/`AGENTS.md` references don't 404. The dev-only
   `/dev/shot-chart` preview is untouched.

5. **No new dependencies.** Everything stays hand-rolled SVG + Tailwind, matching
   the existing shot chart implementation notes.

## Recommended sequencing

```
F1 (merge into tab, extract selector strip + view helper scaffolding)
        │
        ▼
F2 (per-player + team filtering, consumes the helper)   ──►  F3 (cloud all-recorder
        │                                                       review reuses F2 filtering)
        ▼
(F4 anytime — independent)
```

F1 first because it creates the shared components (`PlayerSelectorStrip`,
in-tab panel) that F2 then makes player-aware, and F3 reuses both. F4 has no
dependency and can be done first if a quick win is desired.

## Open questions (consolidated)

These are the decisions that most affect scope. Defaults are what the plans assume.

| # | Question | Plan default |
|---|----------|--------------|
| Q1 | F1: tabs **inside** Game Tracker (segmented control swapping the body) vs. keeping a separate full-screen page? | Segmented control inside Game Tracker; `/shot-chart` becomes a redirect. |
| Q2 | F2: when an individual player is selected, do we also keep an explicit **"All"** option for the merged team view? | Yes — selecting a team pseudo-player shows that side's union; add an "All shots" affordance for whole-game view. |
| Q3 | F2: should team-view markers be **color-coded per player** (legend) or uniform made/miss? | v1 uniform made/miss (current styling); per-player color is a noted follow-up. |
| Q4 | F3: for final cloud games, show shots from **all recorders** (team-visible) or only the **primary recorder** per player (mirrors stat resolution)? | Show all-recorder shots via a new read path; de-dupe is discussed in F3. |
| Q5 | F4: for in-progress cloud games in the list, is the **`games.opponent_score` / `home_team_score`** snapshot accurate enough, or must we aggregate `game_stats`? | Use the row snapshot first, fall back to a stats aggregate only when `home_team_score` is null. |

## Testing posture for the eventual implementation

Each plan's "Testing" section assumes the standard StatKeeper loop: `pnpm build`
+ `pnpm lint`, Vitest unit tests for any new pure helper (e.g. the view filter),
and manual GUI testing via the dev server (`pnpm dev`, HashRouter URLs) including
the dev-only `#/dev/shot-chart` preview where useful. Cloud-dependent steps
(F3, F4 list scores) require a configured Supabase project with migration `032`
applied.
