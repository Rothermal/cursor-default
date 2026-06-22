# Feature 3 Plan: Shot Trackers Viewable on Cloud-Saved Games

> **For agentic workers:** Design + implementation plan. Steps use checkbox (`- [ ]`)
> syntax. See [DESIGN_SHOT_TRACKER_UI_REVAMP.md](DESIGN_SHOT_TRACKER_UI_REVAMP.md) for
> shared context. Builds on **F1** (inline court, `ShotChartPanel`) and **F2**
> (`shotsForSelection`, the read-only selector + the `selection` contract, F2 §8 D13–D17).

> **Reconciled with the F1 pivot (read this):** F1 made the court the **live recording
> surface** on the single-page Game Tracker. So F3 review now lives entirely in the
> **Game Summary "Shot chart" tab** — for **both final and in-progress** cloud games —
> rather than putting the live tracker into a read-only mode. The tracker stays purely for
> recording (it always shows *your own* hydrated shots); the Summary is the read-only,
> all-recorder review surface. This removes the awkward "read-only live input" idea from
> the earlier draft.

**Goal:** When reviewing a cloud-saved game (final or in-progress) in the **Game Summary**,
the user sees the shot chart for that game — including shots recorded by **other team
members**, not just their own — with the per-player/team filtering from F2.

**Architecture:** Today cloud hydration loads only the current user's (`recorded_by =
auth.uid()`) shots. Add a **review load path** that fetches all team-visible shots for a
game and de-duplicates to one set per player (primary recorder, with a fallback), and feed
it (read-only) into the Game Summary shot chart tab. Add a discoverability hint on the
Cloud Games list.

**Tech Stack:** React + TypeScript, Supabase (`shot_chart` table + RLS already exist),
optionally one new read-only SQL RPC. No client dependencies.

---

## 1. Problem & current state

What already works:
- `shot_chart` rows sync per `(game_id, recorded_by, client_shot_id)`
  (`supabase/migrations/032_shot_chart.sql`). RLS lets **any team member SELECT all rows**
  for games on their teams; writes are limited to the recorder.
- Opening a cloud game (`loadCloudGameById`, `src/lib/cloudSync.ts`) hydrates
  `GameState.shotChart`, and `GameSummary` shows a read-only "Shot chart" tab when
  `shotChart.length > 0`.

The gaps:
1. **Only the viewer's own shots load.** `hydrateCloudGameFromRow` filters
   `.eq('recorded_by', userId)` (cloudSync.ts ~line 1024). If a teammate charted the shots
   and you didn't, you see an **empty** chart even though RLS would let you read theirs.
   This is the core miss.
2. **No per-player/team filtering** on the summary chart (F2 adds it; F3 must apply F2's
   filtering to the all-recorder data).
3. **Low discoverability.** Nothing on the Cloud Games card signals a game has a shot chart.

## 2. Design

### 2.1 Multi-recorder strategy (the key data decision)

`shot_chart` is per recorder. For a clean review chart we pick **one set of shots per
player** to avoid double-plotting the same shot charted by two people.

| Option | Behavior | Pros | Cons | Verdict |
|--------|----------|------|------|---------|
| A. Viewer-only (status quo) | `recorded_by = me` | Simple | Empty for non-recorders — the bug we're fixing | Rejected |
| B. Union of all recorders | every row | Always shows something | Duplicate markers when 2+ chart the same game | Rejected for default |
| **C. Primary recorder per player, fallback to any** | one recorder's rows per player | Mirrors stat resolution (`player_checkouts.is_primary` / `set_primary_recorder`); no duplicates | Slightly more logic | **Recommended** |

Option C reuses the existing "primary recorder" concept used for resolving stats in
`GameSummary` (`player_checkouts`, `set_primary_recorder`, migration `014`). Per player:
use the primary recorder's shots; else the game creator's; else any single recorder
(deterministic by `recorded_by`). Label the chart "primary recorder's chart" in the UI.

### 2.2 Where the data comes from

Recommend client-side first (no migration); optional RPC later.

**2.2a Client-side (recommended first):** new `cloudSync.ts` function
`loadGameShotChartForReview(gameId, playerIdMap, opts)`:
1. `select('player_id, recorded_by, client_shot_id, x, y, made, shot_type, zone, created_at').eq('game_id', gameId)` — **no `recorded_by` filter** (RLS scopes to team-visible).
2. Load `player_checkouts (player_id, user_id, is_primary)` for the game; build `primaryByPlayerRemoteId`.
3. For each remote `player_id`, keep the primary recorder's rows; else creator; else lowest `recorded_by`.
4. Map remote `player_id` → local via `playerIdMap` (shared mapping helper); count unmappable rows as dropped.

Returns `ShotRecord[]` shaped like hydration, so F2's `shotsForSelection` +
`BasketballCourt`/`ShootingSummary` consume it unchanged.

**2.2b Optional RPC (follow-up):** `get_game_shot_chart(p_game_id uuid)` (security invoker,
mirrors `get_game_team_stats`, migration `031`) returning primary-resolved rows. Add only
if the client-side join is a measured bottleneck.

### 2.3 Surfacing in the UI — Game Summary only

1. **Game Summary "Shot chart" tab, for ALL cloud games (final + in-progress).** When the
   game is a cloud game (`gameId` set) and `sport.id === 'basketball'`, the tab loads review
   shots via `loadGameShotChartForReview` and renders them (read-only `BasketballCourt`)
   with F2's filtering. The summary is reachable for in-progress games too (Tracker →
   "Summary →"), so this single surface covers both.
2. **The live Game Tracker is unchanged for review** — it always shows *your own* hydrated
   shots and remains the recording surface. We do **not** add a read-only mode to it.
3. **Cloud Games list discoverability.** On `Games.tsx` basketball cards, a small "🏀 chart"
   indicator when the game has any `shot_chart` rows. Optional but recommended.

### 2.4 Interaction with F1 / F2

- F1 put the court **inline** on the single-page tracker (recording surface) and left
  `GameSummary` with its read-only "Shot chart" tab. F3 touches the **summary** tab only.
- F2 added `shotsForSelection` + the read-only selector to the summary tab (F2 Task 4).
  F3 only swaps the **source array** there (review set vs. the hydrated viewer-only set);
  the rendering and filtering are F2's.
- F2's `ShotChartPanel.readOnly`/`shotsOverride` extension point (F2 §8 D16) is **not
  required** for F3 v1, because review renders in the Summary via `BasketballCourt`
  directly (today's approach); it remains available for a future inline read-only review.

### 2.5 File structure

| File | Change |
|------|--------|
| `src/lib/shotChartReview.ts` | **Create** — pure `pickRecorderPerPlayer(rows, primaryByPlayerRemoteId, creatorId)` + unit tests. |
| `src/lib/cloudSync.ts` | **Modify** — extract the remote-row → `ShotRecord` mapping into a shared `mapShotRows(...)`; add `loadGameShotChartForReview(...)`. |
| `src/pages/GameSummary.tsx` | **Modify** — for cloud games (final + in-progress), load review shots into the shot chart tab (state + effect) and use them as the F2-filtered source. |
| `src/pages/Games.tsx` | **Modify** — optional shot-chart-present indicator on basketball cards. |
| `supabase/migrations/03X_get_game_shot_chart.sql` | **Create (optional / follow-up)** — resolved review RPC. |

## 3. Implementation tasks (bite-sized)

### Task 1: Primary-recorder selection helper + tests

- [ ] **Create `src/lib/shotChartReview.test.ts`**:
  - Player with a primary recorder → only that recorder's rows kept.
  - Player with no primary but a creator recorder → creator's rows kept.
  - Player with neither → lowest-ordered `recorded_by` kept (deterministic).
  - Multiple players resolve independently (no cross-contamination).
- [ ] Run `pnpm test src/lib/shotChartReview.test.ts`. Expected: FAIL (missing module).
- [ ] **Create `src/lib/shotChartReview.ts`** with
  `pickRecorderPerPlayer(rows, primaryByPlayerRemoteId, creatorId)`. Pure; operates on
  remote-id-shaped rows.
- [ ] Run the test. Expected: PASS.
- [ ] **Commit:** `feat: add shotChartReview primary-recorder selection helper`

### Task 2: Review load path in cloudSync

- [ ] **Refactor `cloudSync.ts`**: extract the remote-row → `ShotRecord` mapping (zone
  validation, number coercion, `remoteToLocalPlayerId` lookup, dropped-row counting) from
  `hydrateCloudGameFromRow` (lines ~1017–1066) into a shared
  `mapShotRows(rows, remoteToLocalPlayerId)`. Verify hydration behaves identically.
- [ ] **Add `loadGameShotChartForReview(userId, gameId, playerIdMap, opts?)`** per §2.2a;
  return `{ shotChart, droppedRows }`; tolerate the missing-table error
  (`isMissingShotChartTableError`).
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] **Commit:** `feat: load all-recorder shot chart for cloud game review`

### Task 3: Wire review shots into Game Summary (final + in-progress cloud games)

- [ ] **Modify `GameSummary.tsx`**: add `reviewShotChart` state + an effect that, when
  `gameId && sport.id === 'basketball'` (any cloud game, not just final), calls
  `loadGameShotChartForReview(userId, gameId, playerIdMap)` and stores the result. Key the
  effect on `gameId` (+ `resolvedKey` for primary-recorder reassignment).
- [ ] In the shot chart tab render + F2 selector wiring, use `reviewShotChart ?? shotChart`
  as the source. Keep the tab visible when either is non-empty.
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] Manual (Supabase + migration `032`): user A records a game with shots; user B (same
  team) opens it → Summary → Shot chart shows A's shots; F2 filtering works; for an
  in-progress game B reaches Summary via "Summary →".
- [ ] **Commit:** `feat: all-recorder shot chart in Game Summary for cloud games`

### Task 4: Cloud Games list indicator (optional but recommended)

- [ ] **Modify `Games.tsx`**: after loading games, for basketball games run **one batched**
  existence check (`shot_chart` `player_id`/`game_id` `in (gameIds)`) and render a small
  "🏀 chart" pill on cards that have shots.
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] **Commit:** `feat: indicate shot-chart availability on Cloud Games cards`

### Task 5 (optional follow-up): resolved RPC

- [ ] **Create `supabase/migrations/03X_get_game_shot_chart.sql`** mirroring
  `get_game_team_stats` (security invoker, `grant execute ... to authenticated`); switch
  `loadGameShotChartForReview` to call it. Only if the client-side join is a measured
  bottleneck.

## 4. Testing

- **Unit:** `pnpm test src/lib/shotChartReview.test.ts`.
- **Build/lint:** `pnpm build`, `pnpm lint`.
- **Manual (Supabase configured, migration `032` applied):**
  - User A records a basketball game with shots for two players; finalizes it.
  - User B (same team) opens it → Game Summary → Shot chart shows A's shots; per-player/team
    filtering (F2) works.
  - Two recorders chart the same game → no duplicate markers (primary-recorder dedup).
  - Reassign primary recorder (admin) → review chart reflects the new primary's shots.
  - In-progress game recorded by A → B opens it, taps "Summary →" → Shot chart shows A's shots.
  - Non-basketball game → no shot chart tab, no list indicator.
  - DB without migration `032` → no errors; chart empty (graceful).

## 5. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Double-plotting when multiple recorders charted | Primary-recorder dedup (Option C); unit-tested selection. |
| **Review shots leaking into sync (data corruption)** | Review shots are **display-only** local state in `GameSummary`, fed to a read-only `BasketballCourt`; **never** dispatched into `GameState.shotChart`. The live tracker (the only thing that syncs shots) is untouched. See §7 D6. |
| RLS unexpectedly blocks cross-recorder reads | RLS already grants team-member SELECT on `shot_chart` (migration `032`); verify with two users. |
| Per-game existence checks add N queries to the list | One batched `in (gameIds)` query; or defer (indicator is optional). |
| `playerIdMap` gaps drop teammate shots | Reuse hydration's dropped-row accounting. |

## 6. Out of scope

- Editing/correcting teammates' shots (writes stay `recorded_by`-scoped).
- A read-only inline review mode on the live tracker (Summary covers review; revisit only
  if users ask to review without leaving the tracker).
- Season/career cross-game shot aggregation/heatmaps; opponent multi-player rosters.

## 7. Pre-handoff design decisions — RESOLVED

All F3 decisions are settled (signed off; every one confirmed as the recommended default).
**D6 is safety-critical** (review shots must never sync). Items marked **[CHANGED]** arose
from the F1 pivot. F3 reuses F2's `shotsForSelection` + `selection` contract (F2 §8
**D13–D17**, resolved) and renders review in the **Game Summary** (no live-tracker
read-only mode).

### A. Multi-recorder resolution

- **D1 — Resolution strategy.** **Option C** — primary recorder per player with fallback
  (no duplicates; mirrors stat resolution).
- **D2 — Fallback precedence.** primary (`player_checkouts.is_primary`) → game **creator's**
  rows → deterministic lowest `recorded_by`. Exactly one recorder's rows per player.
- **D3 — Per-player independence.** **Yes** — resolve each player's shots independently.
- **D4 — Stat/shot divergence is acceptable.** Accept divergence; label "primary recorder's
  chart"; don't reconcile counts in v1.

### B. Surface & scope

- **D5 — [CHANGED] Review surface.** **Game Summary "Shot chart" tab only**, covering
  **both final and in-progress** cloud games. The live tracker stays recording-only and
  shows the viewer's own hydrated shots. (Drops the earlier read-only-live-tracker idea.)
- **D6 — SAFETY (required): review shots never sync.** Review shots live in **`GameSummary`
  local state only**, fed to a read-only `BasketballCourt`; **never** dispatched into
  `GameState.shotChart`. The live tracker (the only shot-syncing surface) is untouched.
- **D7 — Source precedence in the tab.** `reviewShotChart ?? shotChart`; keep the tab
  visible if either is non-empty.

### C. Read path / data

- **D8 — Client-side join vs. RPC for v1.** **Client-side** `loadGameShotChartForReview`
  first; `get_game_shot_chart` RPC only as a measured follow-up (Task 5).
- **D9 — RLS / visibility.** Rely on the existing team-member SELECT policy (migration
  `032`); **verify with a two-user manual test**; no policy change expected.
- **D10 — Unmappable rows.** Skip and count as dropped (reuse hydration's accounting);
  don't error.
- **D11 — Caching.** Load once per `gameId` (effect keyed on `gameId`); refetch only on
  primary-recorder reassignment (`resolvedKey`).

### D. Discoverability UI

- **D12 — Cloud Games list indicator (Task 4).** **Include in v1**, using **one batched**
  existence query, rendering a "🏀 chart" pill.
- **D13 — Indicator content.** **Existence pill only** (cheapest); count is a follow-up.

### E. Acceptance criteria & regression

- **D14 — Acceptance criteria.** User B (same team) sees user A's shots on a final game's
  Summary; in-progress games show all-recorder shots via Summary too; two recorders → no
  duplicate markers; reassigning the primary updates the review chart; review shots never
  appear in `GameState.shotChart` and never sync; the live tracker still shows only the
  viewer's own shots; non-basketball games show no tab/indicator; missing `shot_chart`
  table degrades to empty with no error.
- **D15 — Regression checklist.** Viewer-only hydration still works (own shots, offline);
  finalizing still works; the summary shot chart tab is unaffected for solo-recorded games;
  the `mapShotRows` refactor keeps hydration equivalent; the live tracker is unchanged.

### F. Explicitly out of F3
Editing/correcting teammates' shots; a read-only inline review mode on the live tracker;
season/career heatmaps; opponent multi-player rosters. The `get_game_shot_chart` RPC
(Task 5) is an optional performance follow-up.
