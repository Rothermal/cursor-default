# Design Overview: Shot Tracker UI Revamp (program)

Umbrella doc for the StatKeeper basketball shot-tracking revamp. It captures the shared
context, the data model the work builds on, the recommended build order, and the
cross-cutting decisions so the individual plans stay consistent.

> **Status:** F1-F9 and F12 are implemented in the app and documented in the linked plans.
> F10 is no longer needed as a standalone feature and is superseded by F13. F11 and F13
> are both held pending further user feedback. Manual Supabase-heavy QA is still tracked in
> [REGRESSION_TESTING.md](REGRESSION_TESTING.md).
>
> **Major pivot (recorded):** F1 was originally "make the shot chart a tab." After
> live-use feedback it is now a **single scrollable Game Tracker** where the **court is a
> primary, additive input** — a court tap opens an event popup (shot / rebound / steal /
> block / assist) for the selected player, while the **full stat grid stays editable** so
> every stat can still be entered/adjusted directly. This spawned a family of follow-on
> enhancements (F5–F12). See
> [completed/PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md](completed/PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md) and
> [PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md](PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md).

## Features

| # | Feature | Plan | One-line goal |
|---|---------|------|----------------|
| **F1** | Single-page Game Tracker + **Court Event Capture** | [completed/PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md](completed/PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md) | **Implemented.** One scroll page; tap court -> event popup (Made/Miss w/ auto 2-3, Off/Def Reb, Steal, Block, Assist) as an additive fast input; the **full stat grid stays editable**. |
| **F2** | Per-player + team shot views | [completed/PLAN_F2_PER_PLAYER_AND_TEAM_SHOT_VIEWS.md](completed/PLAN_F2_PER_PLAYER_AND_TEAM_SHOT_VIEWS.md) | **Implemented.** Filter the inline court to the selected player; team selections show every player's shots on that side; All shows everything. |
| **F3** | Shot trackers on cloud-saved games | [completed/PLAN_F3_CLOUD_GAME_SHOT_CHARTS.md](completed/PLAN_F3_CLOUD_GAME_SHOT_CHARTS.md) | **Implemented; needs two-user QA.** Show full all-recorder shot charts when reviewing in-progress/final cloud games. |
| **F4** | In-progress scores on the resume UI | [completed/PLAN_F4_IN_PROGRESS_SCORES_ON_RESUME_UI.md](completed/PLAN_F4_IN_PROGRESS_SCORES_ON_RESUME_UI.md) | **Implemented; needs cloud-list QA.** Live score on the home active-game card and the Cloud Games list. |
| **F5** | Auto 2/3 with manual override chip | [completed/PLAN_F5_AUTO_2_3_OVERRIDE.md](completed/PLAN_F5_AUTO_2_3_OVERRIDE.md) | **Implemented.** The popup's 2PT/3PT value defaults from court location and can be overridden before logging Made/Missed. |
| **F6** | In-popup player confirm/switch | [completed/PLAN_F6_IN_POPUP_PLAYER_SWITCH.md](completed/PLAN_F6_IN_POPUP_PLAYER_SWITCH.md) | **Implemented.** The popup's Log for control can switch the active player before logging an event. |
| **F12** | Recent-events undo popup | [completed/PLAN_F12_RECENT_EVENTS_UNDO.md](completed/PLAN_F12_RECENT_EVENTS_UNDO.md) | **Implemented.** The bottom Undo opens a recent-events popup; the newest event can be undone via existing LIFO `UNDO`. |
| **F7** | Assist-linking on a made shot | [completed/PLAN_F7_ASSIST_LINKING.md](completed/PLAN_F7_ASSIST_LINKING.md) | **Implemented.** After a made court shot, optionally credit a same-side teammate assist as a separate `ast` increment. |
| **F8** | Live per-player line in popup | [completed/PLAN_F8_LIVE_PER_PLAYER_LINE.md](completed/PLAN_F8_LIVE_PER_PLAYER_LINE.md) | **Implemented.** Shows the selected player's compact live stat line under the popup's Log for label. |
| **F9-F13** | Court Event Capture enhancements | [PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md](PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md) | F9 rebound-after-miss is implemented; F10 visible numbering is superseded by F13; F11 and F13 are held pending further feedback. |

F1 is the foundation for F2, F3, and F5-F12. F4 is independent and has landed.

## Why these belong together

The original shot chart ([completed/DESIGN_SHOT_CHART.md](completed/DESIGN_SHOT_CHART.md),
[completed/DESIGN_SHOT_CHART_IMPLEMENTATION.md](completed/DESIGN_SHOT_CHART_IMPLEMENTATION.md))
deferred per-player filtering (§2.2, §8.2) and richer review surfaces. F2/F3 shipped that
deferred work. F1 reimagined *how stats are entered during live play* (court-as-input);
F5-F12 refine that loop. F4 shipped as an orthogonal review/resume quality-of-life win.

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

Shots live in `GameState.shotChart: ShotRecord[]` (one flat array per game). F2/F3 now
consume that player attribution through `shotsForSelection` and the cloud review load path;
future court-capture enhancements should keep this flat `ShotRecord[]` shape.

**For F1:** the court popup needs **no new data** — Made/Miss → `ADD_SHOT` (which already
increments `2pt`/`3pt`(`_miss`) + links a `shotId` for undo); rebound/steal/block/assist →
`INCREMENT_STAT` with existing stat ids (`oreb`/`dreb`/`stl`/`blk`/`ast`).

### Shared surfaces (pre-change baseline)

| Surface | File | Role |
|---------|------|------|
| Game Tracker | `src/pages/GameTracker.tsx` | The main page: scoreboard, sticky player selector strip, inline court capture, stat grid, period toggle, undo bar. |
| Shot Chart page | `src/pages/ShotChart.tsx` | Legacy `/shot-chart` route; redirects to `/game`. |
| Game Summary | `src/pages/GameSummary.tsx` | Read-only tabs (Players / Scores / Team stats / Shot chart) for live + cloud games. |
| Cloud Games list | `src/pages/Games.tsx` | Lists cloud games; Resume / View Summary; final games show a resolved score line. |
| Home | `src/pages/SportSelect.tsx` | Active-game card (local state) with Resume/New. |
| Court | `src/components/shot-chart/BasketballCourt.tsx` | Reusable SVG half-court; `shots` + optional `onCourtTap`, with tap-vs-scroll discrimination. |
| Shooting summary | `src/components/shot-chart/ShootingSummary.tsx` | Zone breakdown for a `shots` array. |
| Player selector | `src/components/PlayerSelectorStrip.tsx` | Shared team-first strip with optional All chip for shot-chart views. |

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
- Hydration (`hydrateCloudGameFromRow`, `src/lib/cloudSync.ts`) still loads the viewer's
  own shots into live `GameState`; F3's `loadGameShotChartForReview` separately loads
  display-only all-recorder shots for Game Summary review.
- Scores: `getDisplayedHomeScore()` / `resolveFinalHomeScoreFromGameRow()`
  (`src/lib/gameScore.ts`); `games` rows carry `opponent_score`, `home_team_score`
  (nullable), `home_score_adjustment`.

## Cross-cutting decisions (apply across plans)

1. **Court Event Capture (Option A) is a primary, additive input** (F1). A court tap opens
   a popup that resolves the event and updates the **selected** player via existing
   dispatches; only shots store location. The **full stat grid is retained** — the popup is
   a faster path, not a replacement, so every stat stays directly enterable/adjustable via
   its button (the two paths are additive, like today's chart-vs-buttons model).
2. **Single scroll page, no tabs, no visible scrollbar** (F1). Standard scrolling; a
   **sticky player strip** keeps the active player visible.
3. **Extract shared components** (F1): `PlayerSelectorStrip` (was duplicated),
   `ShotChartPanel` (inline court), `CourtEventPopup`. F2/F3/F5–F12 are thin additions on
   top of these.
4. **One shot-filtering helper** (F2): `src/lib/shotChartViews.ts#shotsForSelection`
   maps a selection (player / team side / all) to the displayed `ShotRecord[]`. The inline
   court, the Game Summary tab, and F3's review all consume it — no surface re-implements
   filtering.
5. **`teamSide` is derived, not stored** (F2): a roster player is home unless it's the
   opponent pseudo-player. No migration / `Player` change.
6. **Keep the full stat grid** (F1): the court popup is additive, not a replacement — all
   stats remain directly enterable and adjustable via their buttons (needed to fix/adjust
   counts). No `capturedViaCourt` hiding, no `types.ts`/`sports.ts` change.
7. **No data-model changes anywhere in F1 + F5–F12** — all map to `ADD_SHOT` /
   `INCREMENT_STAT` and existing stat ids. F3 may add an optional read-only RPC.
8. **`/shot-chart` redirects to `/game`** after F1 (dev `/dev/shot-chart` untouched). No
   new dependencies.

## Recommended build order

```
F1  Single-page tracker + Court Event Capture     (implemented)
 ├─ F2  Per-player / team shot filtering           (implemented)
 ├─ F3  Cloud-saved game shot review               (implemented; two-user QA pending)
 ├─ F5  Auto 2/3 override chip                      (implemented)
 ├─ F6  In-popup player confirm/switch             (implemented)
 ├─ F12 Recent-events undo popup                   (implemented)
 ├─ F7  Assist-linking on a made shot              (implemented)
 ├─ F8  Live per-player line in popup             (implemented)
 ├─ F9  Rebound-after-miss prompt                  (implemented; opt-in)
 ├─ F10 Shot sequence numbers / recency            (cosmetic)
 └─ F11 Hybrid quick buttons (Option B)            (only if testing shows it's needed)
F4  In-progress scores on resume UI                (implemented; cloud-list QA pending)

F9 is complete. F10 is superseded by F13 shot detail/edit planning. F11 and F13 are both
held pending further user feedback before build work resumes.
```

Rationale and per-feature phases: see
[PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md](PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md).

Note: the legacy visible-marker-numbering idea listed as F10 above is no longer planned as
a standalone build. It is superseded by F13, which moves shot numbering into a shot detail
and edit workflow.

## Open questions (consolidated)

Resolved items are struck/marked; defaults are what the plans assume.

| # | Question | Status / default |
|---|----------|------------------|
| Q1 | F1 page model: tabs vs single page? | **Resolved:** single scrollable page, no tabs, standard scrolling (no visible scrollbar). |
| Q1b | F1 input model: stat-grid vs court-as-primary-input? | **Resolved:** **Court Event Capture (Option A)** — court popup is an *additive* fast input for shot/reb/stl/blk/ast; the **full grid stays editable** (every stat still adjustable via its button). |
| Q1c | F1 sticky scope? | Default: pin the player strip only (F1 §7 D2). |
| Q2 | F2: keep an explicit "All" view alongside per-player/team? | Yes — team chip = side union; add an "All shots" affordance. |
| Q3 | F2: per-player marker colors? | v1 uniform; color is a follow-up. |
| Q4 | F3: all-recorder vs primary-recorder shots on cloud review? | All-recorder via a review path, **de-duped to the primary recorder per player** (F3 §7 D1–D2). |
| Q5 | F4: trust the synced `games` row score vs aggregate stats? | Row snapshot first; stats fallback only when `home_team_score` is null (creator-scoped). |
| Q6 | F11 (Option B) quick buttons — build now or gate on testing? | **Held:** revisit only after further user feedback shows non-shot popup friction. |

| Q7 | F10 visible numbering? | **Resolved:** no standalone marker numbering; superseded by F13 shot detail metadata. |

## Testing posture

Standard StatKeeper loop: `pnpm build` + `pnpm lint`; Vitest for new pure helpers
(`shotChartViews`, `shotChartReview`, `actionLogLabels`, `assistCandidates`); manual GUI via `pnpm dev` (HashRouter URLs,
`#/game`, dev-only `#/dev/shot-chart`). Cloud steps (F3; F4 list scores) need a configured
Supabase project with migration `032` applied.
