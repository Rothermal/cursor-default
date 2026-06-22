# Design Overview: Shot Tracker UI Revamp (program)

Umbrella doc for the StatKeeper basketball shot-tracking revamp. It captures the shared
context, the data model the work builds on, the recommended build order, and the
cross-cutting decisions so the individual plans stay consistent.

> **Status:** Planning only. No code shipped. Each linked plan/sketch is a draft for review.
>
> **Major pivot (recorded):** F1 was originally "make the shot chart a tab." After
> live-use feedback it is now a **single scrollable Game Tracker** where the **court is
> the primary input** — a court tap opens an event popup (shot / rebound / steal / block /
> assist) for the selected player, and the stat grid shrinks to FT / fouls / TO / minutes.
> This spawned a family of follow-on enhancements (F5–F11). See
> [PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md](PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md) and
> [PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md](PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md).

## Features

| # | Feature | Plan | One-line goal |
|---|---------|------|----------------|
| **F1** | Single-page Game Tracker + **Court Event Capture** | [PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md](PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md) | One scroll page; tap court → event popup (Made/Miss w/ auto 2-3 · Off/Def Reb · Steal · Block · Assist); shrink grid to FT/Foul/TO/Min. |
| **F2** | Per-player + team shot views | [PLAN_F2_PER_PLAYER_AND_TEAM_SHOT_VIEWS.md](PLAN_F2_PER_PLAYER_AND_TEAM_SHOT_VIEWS.md) | Filter the inline court to the selected player; team selections show every player's shots on that side. |
| **F3** | Shot trackers on cloud-saved games | [PLAN_F3_CLOUD_GAME_SHOT_CHARTS.md](PLAN_F3_CLOUD_GAME_SHOT_CHARTS.md) | Show full (all-recorder) shot charts when reviewing in-progress/final cloud games. |
| **F4** | In-progress scores on the resume UI | [PLAN_F4_IN_PROGRESS_SCORES_ON_RESUME_UI.md](PLAN_F4_IN_PROGRESS_SCORES_ON_RESUME_UI.md) | Live score on the home active-game card and the Cloud Games list. |
| **F5–F11** | Court Event Capture enhancements | [PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md](PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md) | 2/3 override · in-popup player switch · assist-linking · per-player line · rebound-after-miss · sequence numbers · Option B quick buttons. |

F1 is the foundation for F2, F3, and F5–F11. F4 is independent and can land anytime.

## Why these belong together

The shipped shot chart ([completed/DESIGN_SHOT_CHART.md](completed/DESIGN_SHOT_CHART.md),
[completed/DESIGN_SHOT_CHART_IMPLEMENTATION.md](completed/DESIGN_SHOT_CHART_IMPLEMENTATION.md))
deferred per-player filtering (§2.2, §8.2) and richer review surfaces. F2/F3 are that
deferred work. F1 reimagines *how stats are entered during live play* (court-as-input),
which the original docs hinted at but never built; F5–F11 refine that loop. F4 is an
orthogonal review/resume quality-of-life win.

## Current architecture (what the plans build on)

### Shot data model — already player-aware

`ShotRecord` (`src/types.ts`) already carries what F2/F3 need:

```ts
interface ShotRecord {
  id: string; x: number; y: number; made: boolean
  shotType: '2pt' | '3pt'; zone: ShotZone
  playerId: string        // <- already attributed per player
  timestamp: number
}
```

Shots live in `GameState.shotChart: ShotRecord[]` (one flat array per game). Key gap for
F2/F3: **recording is per-player, but display is not** — `BasketballCourt` renders the
whole array.

**For F1:** the court popup needs **no new data** — Made/Miss → `ADD_SHOT` (which already
increments `2pt`/`3pt`(`_miss`) + links a `shotId` for undo); rebound/steal/block/assist →
`INCREMENT_STAT` with existing stat ids (`oreb`/`dreb`/`stl`/`blk`/`ast`).

### Shared surfaces (pre-change baseline)

| Surface | File | Role |
|---------|------|------|
| Game Tracker | `src/pages/GameTracker.tsx` | The main page: scoreboard, player selector strip, stat grid, period toggle, undo bar; today has a **Shot chart** button → `/shot-chart`. **F1 turns this into the single-page court-capture screen.** |
| Shot Chart page | `src/pages/ShotChart.tsx` | `/shot-chart` route. **F1 redirects this to `/game`** (body becomes the inline `ShotChartPanel`). |
| Game Summary | `src/pages/GameSummary.tsx` | Read-only tabs (Players / Scores / Team stats / Shot chart) for live + cloud games. |
| Cloud Games list | `src/pages/Games.tsx` | Lists cloud games; Resume / View Summary; final games show a resolved score line. |
| Home | `src/pages/SportSelect.tsx` | Active-game card (local state) with Resume/New. |
| Court | `src/components/shot-chart/BasketballCourt.tsx` | Reusable SVG half-court; `shots` + optional `onCourtTap`. F1 adds tap-vs-scroll discrimination. |
| Shooting summary | `src/components/shot-chart/ShootingSummary.tsx` | Zone breakdown for a `shots` array. |
| Player ordering | `sortTeamPlayersFirst()` (duplicated in `GameTracker`/`ShotChart`) | Team pseudo-players first; F1 extracts this into `PlayerSelectorStrip`. |

### Player model

- Individual roster players: `Player` with no `teamSide` (implicitly **home**).
- Team pseudo-players: `__team_home__` / `__team_opp__` (`src/lib/teamPlayers.ts`),
  `isTeamPlayer: true`, `teamSide: 'home' | 'opponent'`. The court popup works for these
  too (opponent shots/rebounds/etc.).
- No per-opponent-player roster — the opponent is a single pseudo-player.

### Cloud model

- `shot_chart` table (`supabase/migrations/032_shot_chart.sql`): one row per
  `(game_id, recorded_by, client_shot_id)`. RLS: team members can SELECT all rows for
  their teams' games; writes limited to `recorded_by = auth.uid()`.
- Hydration (`hydrateCloudGameFromRow`, `src/lib/cloudSync.ts`) loads **only
  `recorded_by = userId`** shots today (F3 changes this for review).
- Scores: `getDisplayedHomeScore()` / `resolveFinalHomeScoreFromGameRow()`
  (`src/lib/gameScore.ts`); `games` rows carry `opponent_score`, `home_team_score`
  (nullable), `home_score_adjustment`.

## Cross-cutting decisions (apply across plans)

1. **Court Event Capture (Option A) is the primary input** (F1). A court tap opens a
   popup that resolves the event and updates the **selected** player via existing
   dispatches; only shots store location. FT / fouls / TO / minutes stay as buttons.
2. **Single scroll page, no tabs, no visible scrollbar** (F1). Standard scrolling; a
   **sticky player strip** keeps the active player visible.
3. **Extract shared components** (F1): `PlayerSelectorStrip` (was duplicated),
   `ShotChartPanel` (inline court), `CourtEventPopup`. F2/F3/F5–F11 are thin additions on
   top of these.
4. **One shot-filtering helper** (F2): `src/lib/shotChartViews.ts#shotsForSelection`
   maps a selection (player / team side / all) to the displayed `ShotRecord[]`. The inline
   court, the Game Summary tab, and F3's review all consume it — no surface re-implements
   filtering.
5. **`teamSide` is derived, not stored** (F2): a roster player is home unless it's the
   opponent pseudo-player. No migration / `Player` change.
6. **Hide court-owned grid actions via config** (F1): `capturedViaCourt?: boolean` on
   `StatAction` (`sports.ts`) rather than hard-coded ids.
7. **No data-model changes anywhere in F1 + F5–F11** — all map to `ADD_SHOT` /
   `INCREMENT_STAT` and existing stat ids. F3 may add an optional read-only RPC.
8. **`/shot-chart` redirects to `/game`** after F1 (dev `/dev/shot-chart` untouched). No
   new dependencies.

## Recommended build order

```
F1  Single-page tracker + Court Event Capture     (foundation)
 ├─ F2  Per-player / team shot filtering
 ├─ F5  Auto 2/3 override chip                     (tiny; correctness)
 ├─ F6  In-popup player confirm/switch             (attribution; top pain)
 ├─ F3  Cloud-saved game shot review
 ├─ F7  Assist-linking on a made shot
 ├─ F8  Live per-player line in popup
 ├─ F9  Rebound-after-miss prompt                  (opt-in)
 ├─ F10 Shot sequence numbers / recency            (cosmetic)
 └─ F11 Hybrid quick buttons (Option B)            (only if testing shows it's needed)
F4  In-progress scores on resume UI                (independent; quick win, anytime)
```

Rationale and per-feature phases: see
[PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md](PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md).

## Open questions (consolidated)

Resolved items are struck/marked; defaults are what the plans assume.

| # | Question | Status / default |
|---|----------|------------------|
| Q1 | F1 page model: tabs vs single page? | **Resolved:** single scrollable page, no tabs, standard scrolling (no visible scrollbar). |
| Q1b | F1 input model: stat-grid vs court-as-primary-input? | **Resolved:** **Court Event Capture (Option A)** — court popup owns shot/reb/stl/blk/ast; grid keeps FT/foul/TO/min. |
| Q1c | F1 sticky scope? | Default: pin the player strip only (F1 §7 D2). |
| Q2 | F2: keep an explicit "All" view alongside per-player/team? | Yes — team chip = side union; add an "All shots" affordance. |
| Q3 | F2: per-player marker colors? | v1 uniform; color is a follow-up. |
| Q4 | F3: all-recorder vs primary-recorder shots on cloud review? | All-recorder via a review path, **de-duped to the primary recorder per player** (F3 §7 D1–D2). |
| Q5 | F4: trust the synced `games` row score vs aggregate stats? | Row snapshot first; stats fallback only when `home_team_score` is null (creator-scoped). |
| Q6 | F11 (Option B) quick buttons — build now or gate on testing? | Gate on live testing of Option A; default A. |

## Testing posture

Standard StatKeeper loop: `pnpm build` + `pnpm lint`; Vitest for new pure helpers
(`shotChartViews`, `shotChartReview`); manual GUI via `pnpm dev` (HashRouter URLs,
`#/game`, dev-only `#/dev/shot-chart`). Cloud steps (F3; F4 list scores) need a configured
Supabase project with migration `032` applied.
