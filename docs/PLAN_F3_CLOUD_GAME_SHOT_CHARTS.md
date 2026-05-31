# Feature 3 Plan: Shot Trackers Viewable on Cloud-Saved Games

> **For agentic workers:** Design + implementation plan. Steps use checkbox (`- [ ]`)
> syntax. See [DESIGN_SHOT_TRACKER_UI_REVAMP.md](DESIGN_SHOT_TRACKER_UI_REVAMP.md) for
> shared context. Builds on **F1** (`ShotChartPanel`) and **F2** (`shotsForSelection`).

**Goal:** When reviewing a cloud-saved game (in-progress or final), the user can view
the shot chart for that game — including shots recorded by **other team members**, not
just their own — with the per-player/team filtering from F2.

**Architecture:** Today cloud hydration loads only the current user's (`recorded_by =
auth.uid()`) shots. Add a **review load path** that fetches all team-visible shots for a
game and de-duplicates to one set per player (primary recorder, with a fallback). Surface
it on the Game Summary shot chart tab (final games) and the cloud-opened Game Tracker
chart tab (in-progress). Add a discoverability hint on the Cloud Games list.

**Tech Stack:** React + TypeScript, Supabase (`shot_chart` table + RLS already exist),
optionally one new read-only SQL RPC. No client dependencies.

---

## 1. Problem & current state

What already works:
- `shot_chart` rows sync to the cloud per `(game_id, recorded_by, client_shot_id)`
  (`supabase/migrations/032_shot_chart.sql`). RLS lets **any team member SELECT all
  rows** for games on their teams; writes are limited to the recorder.
- Opening a cloud game (`loadCloudGameById` in `src/lib/cloudSync.ts`, used by
  `Games.tsx`) hydrates `GameState.shotChart`, and `GameSummary` shows a read-only
  "Shot chart" tab when `shotChart.length > 0`.

The gaps that make this feel incomplete:
1. **Only the viewer's own shots load.** `hydrateCloudGameFromRow` filters
   `.eq('recorded_by', userId)` (cloudSync.ts ~line 1024). If a teammate charted the
   shots and you didn't, you see an **empty** chart — even though the data exists and
   RLS would let you read it. This is the core miss for "viewable when looking at cloud
   save games."
2. **No per-player/team filtering** on the cloud/summary chart (addressed by F2, but F3
   must ensure F2's filtering is applied to the all-recorder data).
3. **Low discoverability.** Nothing on the Cloud Games card signals a game has a shot
   chart; you must open the game and find the tab.

## 2. Design

### 2.1 Multi-recorder strategy (the key decision)

`shot_chart` is per recorder. For a clean review chart we must pick **one set of shots
per player** to avoid double-plotting the same shot charted by two people.

| Option | Behavior | Pros | Cons | Verdict |
|--------|----------|------|------|---------|
| A. Viewer-only (status quo) | `recorded_by = me` | Simple | Empty for non-recorders — the bug we're fixing | Rejected |
| B. Union of all recorders | every row | Always shows something | Duplicate markers when 2+ chart the same game | Rejected for default |
| **C. Primary recorder per player, fallback to any** | one recorder's rows per player | Mirrors stat resolution (`player_checkouts.is_primary` / `set_primary_recorder`); no duplicates | Slightly more logic | **Recommended** |

Option C reuses the existing "primary recorder" concept already used for resolving
stats in `GameSummary` (`player_checkouts`, `set_primary_recorder` RPC, migration `014`).
For each player: use the primary recorder's shots; if no primary checkout exists, fall
back to the game creator's shots, then to any single recorder (deterministic by
`recorded_by` order). Document this precedence in the UI as "primary recorder's chart."

### 2.2 Where the data comes from

Two viable implementations; recommend starting client-side (no migration), with an
optional RPC for efficiency later.

**2.2a Client-side (recommended first, no migration):**
- New function in `cloudSync.ts`: `loadGameShotChartForReview(gameId, players, playerIdMap, opts)`:
  1. `select('player_id, recorded_by, client_shot_id, x, y, made, shot_type, zone, created_at').eq('game_id', gameId)` — **no `recorded_by` filter** (RLS scopes to team-visible).
  2. Load primary recorders: `player_checkouts.select('player_id, user_id, is_primary').eq('game_id', gameId)` (already queried by `GameSummary`'s admin path).
  3. For each remote `player_id`, keep rows from the primary recorder; else creator; else lowest `recorded_by`.
  4. Map remote `player_id` → local id via `playerIdMap` (same mapping logic as hydration); count unmappable rows as `shotChartHydrationDroppedRows` so existing sync-safety invariants hold.
- This returns `ShotRecord[]` shaped exactly like hydration, so F2's `shotsForSelection`
  and `BasketballCourt`/`ShootingSummary` consume it unchanged.

**2.2b Optional RPC (follow-up for efficiency / correctness centralization):**
- `get_game_shot_chart(p_game_id uuid)` (security invoker, mirrors
  `get_game_team_stats` in migration `031`) returning the primary-resolved shot rows
  with `player_id`. Lets the client avoid the join and matches the resolved-stats RPC
  family. Add only if the client-side join proves slow for big charts.

### 2.3 Surfacing in the UI

1. **Final games → Game Summary "Shot chart" tab.** When `isFinalCloudGame`, the tab
   loads review shots via `loadGameShotChartForReview` (overriding the hydrated
   viewer-only `shotChart`) and renders them with F2 filtering. This is the primary
   review surface.
2. **In-progress games opened from Cloud Games → Game Tracker chart tab (F1).** When a
   game is opened read-for-review and the viewer is **not** actively the recorder, also
   load review shots so the chart isn't empty. (For the active recorder, local
   `shotChart` is authoritative — don't override mid-recording.)
3. **Cloud Games list discoverability.** On `Games.tsx` basketball cards, show a small
   "🏀 shot chart" indicator when the game has any `shot_chart` rows (cheap existence
   check or count), so users know it's there before opening. Optional but recommended.

### 2.4 Interaction with F1/F2

- F1 makes the chart a tab in the Game Tracker (so cloud-opened in-progress games get it
  for free).
- F2 supplies `shotsForSelection` + the read-only selector strip; F3 only changes the
  **source array** (review-loaded vs viewer-only), not the rendering.
- The Game Summary shot chart tab already exists (F2 adds filtering); F3 swaps its data
  source to the all-recorder review set for cloud games.

### 2.5 File structure

| File | Change |
|------|--------|
| `src/lib/cloudSync.ts` | **Modify** — add `loadGameShotChartForReview(...)`; refactor the remote→local shot mapping out of `hydrateCloudGameFromRow` into a shared helper so both paths use it. |
| `src/lib/shotChartReview.ts` | **Create (optional)** — pure primary-recorder selection logic (`pickRecorderPerPlayer(rows, primaryByPlayer, creatorId)`) + unit tests, keeping `cloudSync.ts` thin. |
| `src/pages/GameSummary.tsx` | **Modify** — for cloud games, load review shots into the shot chart tab (state + effect), used by the F2-filtered render. |
| `src/pages/Games.tsx` | **Modify** — optional shot-chart-present indicator on basketball cards (existence check). |
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
  `pickRecorderPerPlayer(rows, primaryByPlayerRemoteId, creatorId)` returning the kept
  rows. Pure; operates on remote-id-shaped rows.
- [ ] Run the test. Expected: PASS.
- [ ] **Commit:** `feat: add shotChartReview primary-recorder selection helper`

### Task 2: Review load path in cloudSync

- [ ] **Refactor `cloudSync.ts`**: extract the remote-row → `ShotRecord` mapping (zone
  validation, number coercion, `remoteToLocalPlayerId` lookup, dropped-row counting)
  from `hydrateCloudGameFromRow` (lines ~1017–1066) into a shared
  `mapShotRows(rows, remoteToLocalPlayerId)` helper. Verify hydration still behaves
  identically.
- [ ] **Add `loadGameShotChartForReview(userId, gameId, playerIdMap, opts?)`**:
  - Query `shot_chart` for the game with **no** `recorded_by` filter.
  - Query `player_checkouts` (player_id, user_id, is_primary) for the game; build
    `primaryByPlayerRemoteId`.
  - `pickRecorderPerPlayer(rows, primaryByPlayerRemoteId, creatorId)` then `mapShotRows`.
  - Return `{ shotChart, droppedRows }`. Tolerate the missing-table error like hydration
    (`isMissingShotChartTableError`).
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] **Commit:** `feat: load all-recorder shot chart for cloud game review`

### Task 3: Wire review shots into Game Summary (final games)

- [ ] **Modify `GameSummary.tsx`**: add `reviewShotChart` state + an effect that, when
  `isFinalCloudGame && gameId && sport.id === 'basketball'`, calls
  `loadGameShotChartForReview` and stores the result.
- [ ] In the `summaryTab === 'shot_chart'` render (and the F2 selector wiring), use
  `reviewShotChart ?? shotChart` as the source array. Keep `showShotChartTab` truthy when
  either the hydrated `shotChart` **or** `reviewShotChart` is non-empty.
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] Manual (requires Supabase + migration `032`): create a final game whose shots were
  recorded by user A; open it as user B (same team) → shot chart tab shows A's shots;
  F2 filtering works.
- [ ] **Commit:** `feat: show all-recorder shot chart in Game Summary for cloud games`

### Task 4: In-progress cloud review in the Game Tracker chart tab

- [ ] **Decide ownership:** when `Games.tsx` opens an in-progress game and the viewer has
  no local shots for it, load review shots and seed the displayed chart (without
  overwriting an active recorder's local `shotChart`). Simplest: pass a
  `reviewMode`/`reviewShots` into the F1 `ShotChartPanel` that, when present, renders the
  review set read-only and disables recording for non-recorders.
- [ ] Implement the minimal version: in `ShotChartPanel`, accept optional `reviewShots`;
  when set, render those (read-only court, no `onCourtTap`) and the F2 selector.
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] Manual: open a teammate's in-progress game → Shot Chart tab shows their shots.
- [ ] **Commit:** `feat: review teammates' shots on in-progress cloud games`

### Task 5: Cloud Games list indicator (optional but recommended)

- [ ] **Modify `Games.tsx`**: after loading games, for basketball games run a light
  existence check (e.g. `shot_chart` count per game, or a single `select id ... limit 1`)
  and render a small "🏀 chart" pill on cards that have shots.
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] **Commit:** `feat: indicate shot-chart availability on Cloud Games cards`

### Task 6 (optional follow-up): resolved RPC

- [ ] **Create `supabase/migrations/03X_get_game_shot_chart.sql`** mirroring
  `get_game_team_stats` (security invoker, `grant execute ... to authenticated`),
  returning primary-resolved shot rows; switch `loadGameShotChartForReview` to call it.
  Only if the client-side join is a measured bottleneck.

## 4. Testing

- **Unit:** `pnpm test src/lib/shotChartReview.test.ts`.
- **Build/lint:** `pnpm build`, `pnpm lint`.
- **Manual (Supabase configured, migration `032` applied):**
  - User A records a basketball game with shots for two players; finalizes it.
  - User B (same team) opens it from Cloud Games → Game Summary → Shot chart tab shows
    A's shots; per-player/team filtering (F2) works.
  - Two recorders chart the same game → no duplicate markers (primary-recorder dedup).
  - Reassign primary recorder (admin) → review chart reflects the new primary's shots.
  - In-progress game recorded by A, opened by B → chart tab shows A's shots, read-only.
  - Non-basketball game → no shot chart tab, no list indicator.
  - DB without migration `032` → no errors; chart simply empty (graceful).

## 5. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Double-plotting when multiple recorders charted | Primary-recorder dedup (Option C); unit-tested selection. |
| Overwriting an active recorder's local edits with review data | Only load review shots for non-recorders / read-only surfaces; never replace a live local `shotChart` mid-recording. |
| RLS unexpectedly blocks cross-recorder reads | RLS already grants team-member SELECT on `shot_chart` (migration `032`); verify in manual test with two users. |
| Per-game existence checks add N queries to the list | Batch into one `in('game_id', ids)` count/exists query; cache; or defer (indicator is optional). |
| `playerIdMap` gaps drop teammate shots | Reuse hydration's dropped-row accounting; surface count like existing `shotChartHydrationDroppedRows`. |

## 6. Out of scope

- Editing/correcting teammates' shots (writes stay `recorded_by`-scoped; corrections are
  a separate future feature mirroring stat corrections).
- Season/career cross-game shot aggregation/heatmaps.
- Opponent multi-player rosters.

## 7. Open questions

1. **Q4 (umbrella):** Confirm primary-recorder dedup (Option C) vs. union vs. viewer-only.
   Default: Option C.
2. Should in-progress review (Task 4) be in v1 or limited to final games first?
   Default: final games are the priority; in-progress review is a thin add-on.
3. Build the resolved RPC now or only if the client join is slow? Default: client-side
   first; RPC as a measured follow-up.
4. Is the Cloud Games list indicator (Task 5) worth the extra query, or skip for v1?
   Default: include with a single batched query.
