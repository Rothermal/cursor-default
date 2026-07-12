# Plan: Multi-game parking, active game, and sync queue

Living blueprint for local multi-game parking and sync queue work. **P0 local parking and P1 sync queue are shipped**: the app keeps one mounted `GameState`, stores the active local id in `statkeeper_games_manifest`, saves full snapshots at `statkeeper_game:{localGameId}`, and syncs dirty parked records through a local queue. `statkeeper_game` remains a legacy/active mirror for migration compatibility. **P2+ cloud hardening is not shipped yet.** See also [INTEGRATION_PLAN.md](INTEGRATION_PLAN.md) (cloud model) and **README** (migrations, features).

---

## 1. Problem statement

- **Multi-sport requirement:** "Multi-game" means multiple parked/resumable sessions across any enabled sport, not only multiple basketball games. The UI still mounts one active tracker at a time, but parked records may mix basketball, soccer, baseball, football, volleyball, or future configured sports.

- **Today:** One persisted game blob overwrites the previous session. Starting a second game replaces the first locally; cloud resume uses a single preferred `gameId` per user.
- **Failures:** If cloud sync fails after a `games` row is inserted but before stats land, retries can orphan rows (see historical analysis in repo discussions). Multi-game work should eventually align sync order with “no orphan game without stats” (later phase).
- **Goal:** Same device can hold **multiple** in-progress or paused games across any enabled sport, switch between them, work **offline**, and **drain a sync queue** when online without losing other games’ snapshots.

---

## 2. Core concepts

| Term | Meaning |
|------|--------|
| **Active game** | The single `GameState` the tracker, checkout, and sport-specific live surface bind to. One `activeLocalGameId` at a time. |
| **Parked game** | A full saved snapshot not currently active: paused, between games, or finished-but-not-finalized on cloud. |
| **Local game id** | Stable string (e.g. UUID) assigned when a session is created (after setup or at “start tracking”). Distinct from `cloudSync.gameId` (cloud UUID), which may be null until first successful sync. |
| **Sync job** | Work unit: push one parked/active record’s state to Supabase via the existing snapshot pipeline (`syncGameSnapshotToCloud` or a refactored variant). |
| **Sync queue** | Ordered jobs with status (`pending` / `running` / `done` / `failed`), retries, and backoff so many games do not stampede the network. |
| **Sport-specific tracker surface** | The live input layout for a sport. Basketball has the inline court today; future sports should mount their own surfaces (soccer field, baseball diamond, football field, etc.) from the active record's `gameState.sport`. |

---

## 3. Local storage model

**P0 replaces** “one key `statkeeper_game`” with:

1. **Manifest** (small JSON), e.g. `statkeeper_games_manifest`:
   - `version` (integer for migrations).
   - `activeLocalGameId: string | null`.
   - `gameIds: string[]` (order optional: MRU, created, etc.).
   - Optional row summaries for rendering lists without loading every blob: `localGameId`, `sportId`, `sportName`, `teamName`, `opponentName`, `gameDate`, `status`, `updatedAt`, `cloudGameId`, `syncStatus`.

2. **Per-game record**, e.g. `statkeeper_game:{localGameId}`:
   - `localGameId`, `createdAt`, `updatedAt`.
   - `gameState`: same shape as today’s `GameState` (sport, `gameInfo`, `players`, stats, `shotChart`, `actionLog`, `cloudSync`, …).
   - Denormalized metadata copied from `gameState` for parked-game lists and filters: sport id/name, teams, date, status, cloud id, sync status. This metadata must be derived from the full snapshot, not treated as a second source of truth.
   - **Sync metadata** (either inside `gameState.cloudSync` only, or duplicated for queue UI):
     - `dirty` boolean or monotonic **revision** counter bumped on every local mutation.
     - Optional: `lastEnqueuedRevision`, `lastSuccessfulSyncRevision`.

3. **Migration path:** On first load after upgrade, if legacy `statkeeper_game` exists and manifest missing → create one `ParkedGameRecord` + manifest with `activeLocalGameId` set; keep legacy read until migration succeeds, then remove or ignore legacy key.
   - Capture the legacy game's `sport` into parked-game metadata so migrated sessions render under the correct sport label.

**Storage limits:** `localStorage` is ~5MB per origin; many shot charts + action logs may require **IndexedDB** for per-game blobs in a later iteration.

---

## 4. Sync queue (behavior)

**Producer**

- On state change for a given `localGameId`: mark record dirty, **enqueue** one job per `localGameId` (coalesce: single pending job per id, refresh payload revision when merging).

**Consumer**

- Single global worker (simplest) or one mutex so two jobs do not corrupt the same client state.
- Pop by policy, e.g.:
  1. Active game if dirty.
  2. Other dirty games FIFO by `updatedAt` (or strict FIFO to avoid starvation).
- Load **that record’s** `gameState`, call cloud sync with `userId`, merge returned `seasonId` / `teamId` / `gameId` / `playerIdMap` / timestamps **only into that record**, persist, mark job `done` or `failed`.

**Retries:** exponential backoff, max attempts, surface last error in UI per parked row (and optionally continue writing to `client_sync_errors` for server-side debugging).

**Relation to current code:** Today `GameContext` debounces `runCloudSync` on fingerprint of **global** state. Queue mode should call sync with **explicit game payload**, not whatever is currently mounted, unless the job is for the active id and you intentionally share one code path.

---

## 5. Cloud alignment

- **`syncGameSnapshotToCloud`** should accept a **`GameState` snapshot** (already mostly true) and return ids/maps; caller updates **only** the targeted parked record.
- **Phase 2 (hardening):** defer `games` INSERT until after placeholder/player resolution, or use transactions / idempotent client-chosen ids, to avoid orphan `in_progress` games without `game_stats` on repeated failures. Document separately when scoping DB changes.
- **`statkeeper_cloud_resume_targets`:** today one `gameId` per user; consider either keeping “last opened cloud game” for hydration **or** storing preferred cloud id **inside** each `ParkedGameRecord` so multiple cloud games map cleanly.

---

## 6. UI / UX (minimal viable)

- **Home or sport screen:** list **Parked games** (title: team vs opponent, date, sync badge: synced / pending / error). Actions: **Resume**, **Discard** (confirm).
- **Starting another game while one is active:** prompt to **Park** current (default yes) → persist active record → create new `localGameId` → navigate setup/tracker.
- **Tracker:** unchanged if `GameProvider` still exposes one `state`/`dispatch` for the **active** record only.
- **Sport visibility:** MVP parked-game rows must show the sport (badge/icon/text) even if filtering/grouping by sport ships later.
- **Sport-specific tracker routing:** The mounted live tracker surface should resolve from `state.sport`. Basketball renders the court; future sports render their own field/diamond/rink/etc. surfaces when those UIs are built.

---

## 7. Phased delivery

| Phase | Deliverable |
|-------|-------------|
| **P0** | Manifest + per-game keys + migrate legacy key; park-on-switch; parked list UI; still one debounced sync for **active** game only (behavioral win without full queue). **Shipped.** |
| **P1** | Sync queue worker; dirty flags; enqueue/dequeue for all dirty parked games; offline drain. **Shipped.** |
| **P2** | Cloud write ordering / transactional safety; optional cleanup tooling for historical orphan games (ops-only, not automatic user data deletion). |
| **P3** | IndexedDB, export/import, max parked count, quota UX. |

---

## 8. Test matrix (acceptance)

- Park game A, start game B, resume A → A’s stats and shots intact.
- Park a basketball game with shots, start a soccer game, resume each one → sport-specific stats and tracker surfaces restore correctly, with no basketball court state leaking into soccer or future sport surfaces.
- Park multiple games for different sports and the same team/date → rows remain distinguishable by sport, opponent, updated time, and local game id.
- Two games offline, both dirty → online → both sync; order matches policy; no cross-contamination of `playerIdMap` / `gameId`.
- Finalize A from summary while B is active → A finalized on cloud; B unchanged.
- Legacy migration: existing `statkeeper_game` → one parked record, no loss.
- Large shot chart on multiple parked games → storage / performance acceptable or falls back to IndexedDB.

---

## 9. Related code (starting points)

- `src/context/GameContext.tsx` — reducer, `loadState`, `GAME_STORAGE_KEY`, `runCloudSync`, resume hydration.
- `src/lib/cloudSync.ts` — `syncGameSnapshotToCloud`, `ensureGame` ordering.
- `src/lib/logClientSyncError.ts` — optional logging per failed job.
- [completed/DATA_INTEGRITY_AND_CREATION_PLAN.md](completed/DATA_INTEGRITY_AND_CREATION_PLAN.md) — broader integrity context.

---

## 10. Open decisions

- IndexedDB vs localStorage for per-game payloads.
- Max number of parked games; eviction policy.
- Whether “New game” on home must always park vs discard with warning.
- Multi-device: parked-only-local games remain device-specific until synced.
