# Plan: Merge duplicate players

Merge two `players` rows when one was created by mistake: **reattach** all dependent data to the **survivor**, resolve uniqueness conflicts (with **user choices** where needed), then **delete** the duplicate row.

**Status:** Product decisions locked (§5). Ready for implementation.

**Related:** [DATA_INTEGRITY_AND_CREATION_PLAN.md](DATA_INTEGRITY_AND_CREATION_PLAN.md), [DESIGN_SEASONS_DATA_MODEL.md](DESIGN_SEASONS_DATA_MODEL.md).

---

## 1. Goals

- One **authoritative** `players` id after merge (survivor — **user-selected**).
- **No orphaned** stats, checkouts, corrections, roster rows, or guardian links on the duplicate.
- **User-driven** resolution for conflicts where two rows would violate a `UNIQUE` after repointing (`game_stats`, `stat_corrections`, `team_players`).
- **Automatic** resolution for `player_checkouts` per product rule (earliest checkout wins).
- **Auditable:** `player_merge_audit` row on success.
- **Authorization:** **Owner or admin** on **every** team that has either player on the roster (any `is_active`); **cross-team merges allowed**.

## 2. Non-goals

- Automatic duplicate detection (fuzzy name matching) — later.
- Merging more than two players at once.
- Undo / split-after-merge.
- Dry-run RPC that only returns **counts** — not required; see §4.1 (conflict **detail** preview is required for the UI).

---

## 3. Data touched (current schema)

| Table | FK to `players` | Resolution |
|-------|------------------|------------|
| `game_stats` | `player_id` | Repoint non-conflicting rows; **per conflict**, user picks **one** row to keep (by `game_stats.id`), delete the other |
| `stat_corrections` | `player_id` | **Per conflict**, user picks **survivor’s** row, **duplicate’s** row, or **neither** (delete both corrections) |
| `player_checkouts` | `player_id` | Repoint; on duplicate `(game_id, survivor, user_id)` keep row with **earliest `checked_out_at`**; if equal, **delete one** arbitrarily (e.g. lower `id`) |
| `team_players` | `player_id` | Repoint when no clash; **per `(team_id)` clash**, user picks **jersey**, **is_active** (and **position** if we surface it) for the single remaining row |
| `player_guardians` | `player_id` | Repoint duplicate → survivor; `ON CONFLICT (player_id, user_id) DO NOTHING` then delete duplicate’s rows |
| `players` | — | After merge: **backfill** survivor name fields from duplicate if survivor’s are empty; then `DELETE` duplicate |

**Not directly updated:** `games`, `tournaments`, `seasons`, `teams`.

**Clients:** `localStorage` / `playerIdMap` may reference the old id until refresh — document in UX.

---

## 4. Implementation

### 4.1 RPC pair: preview + execute

Because conflicts need **human choice**, use **two** database entry points:

#### A. `merge_players_preview(p_duplicate_id uuid, p_survivor_id uuid) RETURNS jsonb`

- **`SECURITY DEFINER`** + `auth.uid()` check: caller is **owner or admin** on every `team_id` present in `team_players` for **either** `p_duplicate_id` or `p_survivor_id` (include inactive roster rows).
- Validates: distinct ids, both players exist, caller authorized.
- Returns **structured conflicts** (empty arrays if none):

```json
{
  "game_stats": [
    {
      "game_id": "...",
      "game_date": "2026-01-15",
      "opponent_name": "...",
      "recorded_by": "...",
      "recorder_display": "...",
      "stat_id": "pts",
      "survivor_row": { "id": "...", "value": 12 },
      "duplicate_row": { "id": "...", "value": 10 }
    }
  ],
  "stat_corrections": [
    {
      "game_id": "...",
      "game_date": "...",
      "stat_id": "pts",
      "survivor_row": { "id": "...", "corrected_value": 14, "created_at": "...", "reason": "..." },
      "duplicate_row": { "id": "...", "corrected_value": 12, "created_at": "...", "reason": "..." }
    }
  ],
  "team_players": [
    {
      "team_id": "...",
      "team_name": "...",
      "survivor": { "jersey_number": "5", "is_active": true, "position": null },
      "duplicate": { "jersey_number": "5", "is_active": true, "position": null }
    }
  ]
}
```

- **No mutations.** Safe to call repeatedly while the user works through the wizard.

#### B. `merge_players_execute(p_duplicate_id uuid, p_survivor_id uuid, p_resolutions jsonb) RETURNS void`

- Same **authorization** as preview.
- **`p_resolutions`** must include a decision for **every** conflict key returned by preview (validate server-side; reject if missing or unknown id).
- **Suggested `p_resolutions` shape:**

```json
{
  "game_stats": [
    { "keep_row_id": "uuid-of-either-survivor-or-duplicate-game_stats-row" }
  ],
  "stat_corrections": [
    { "game_id": "uuid", "stat_id": "text", "choice": "survivor" | "duplicate" | "neither" }
  ],
  "team_players": [
    {
      "team_id": "uuid",
      "jersey_number": "text | null",
      "is_active": true,
      "position": "text | null"
    }
  ]
}
```

- **Execution order (single transaction):**

  1. Re-validate auth and that preview conflicts match submitted resolutions (or recompute conflicts and compare).
  2. **`player_guardians`**: merge as in §3.
  3. **`game_stats`**: for each conflict, `DELETE` the row whose `id` ≠ `keep_row_id`; then `UPDATE` all remaining `game_stats` for duplicate → survivor.
  4. **`stat_corrections`**: for each conflict, apply `choice` (keep one row and delete the other, or delete both); then `UPDATE` remaining corrections for duplicate → survivor.
  5. **`team_players`**: for each team with both players, `DELETE` both rows, `INSERT` one row for survivor with user-chosen `jersey_number`, `is_active`, `position`; for teams with only duplicate, `UPDATE player_id`; for only survivor, leave as-is.
  6. **`player_checkouts`**: `UPDATE` duplicate → survivor; resolve duplicate `(game_id, user_id)` by **earliest `checked_out_at`**, delete others; **tie** → delete one row (deterministic e.g. `ORDER BY id LIMIT 1` keep).
  7. **`players`**: `UPDATE` survivor SET `first_name` / `last_name` / `nickname` = COALESCE(survivor.field, duplicate.field) where appropriate (copy from duplicate only where survivor is null/blank per §5).
  8. **`DELETE FROM players WHERE id = p_duplicate_id`**.
  9. **`player_merge_audit`** insert.

### 4.2 Audit table (migration)

```sql
CREATE TABLE public.player_merge_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  duplicate_player_id uuid NOT NULL,
  survivor_player_id uuid NOT NULL,
  merged_by uuid NOT NULL REFERENCES public.profiles(id),
  merged_at timestamptz NOT NULL DEFAULT now(),
  resolutions jsonb,  -- copy of p_resolutions for support
  note text
);
```

RLS: restrictive; inserts only from `merge_players_execute` or service role.

### 4.3 App UI (`/teams` recommended)

**Audience:** owner/admin only (hide merge entry otherwise).

**Cross-team:** survivor and duplicate need **not** be on the current team’s roster for selection — load candidates from **all players** the user could already add via pool logic **or** expand to “any player on a team where I’m owner/admin” (implementation detail: query `team_players` joined to `team_members` where `user_id = auth.uid()` and `role in ('owner','admin')`, distinct `player_id`).

**Wizard steps:**

1. **Intro** — irreversible; cross-team allowed.
2. **Pick survivor + duplicate** (two pickers; cannot be same id).
3. **Load preview** — call `merge_players_preview`.
4. **Resolve `game_stats`** — for each item, show both stat lines (value, recorder, game context); radio: keep survivor row / keep duplicate row.
5. **Resolve `stat_corrections`** — for each item, show both corrections; options: accept survivor’s / accept duplicate’s / **discard both**.
6. **Resolve `team_players`** — for each team with both, show both jersey/active (and position); controls to set final jersey, active toggle, position.
7. **If no conflicts** in a section, skip that step.
8. **Typed confirmation** — e.g. type survivor’s full name or “MERGE” (product copy TBD).
9. **Submit** — `merge_players_execute` with built `p_resolutions`.

**Empty preview conflicts:** still run execute path for guardian/checkout/non-conflicting updates + name backfill + delete duplicate (or a slim RPC variant).

### 4.4 Documentation

- README migration bullet; `REGRESSION_TESTING.md` happy path + permission denial.

---

## 5. Resolved product decisions

| Topic | Decision |
|--------|-----------|
| **Q1 `game_stats` conflicts** | **User chooses:** show summary of **both** rows; pick which row is **final** (other deleted). |
| **Q2 `stat_corrections` conflicts** | **User chooses:** show each correction; pick **survivor’s**, **duplicate’s**, or **discard both** (delete both rows). |
| **Q3 `team_players` same team** | **User chooses** final **jersey** and **status** (`is_active`; surface **position** if present). |
| **Q4 Authorization** | **Owner or admin** on **all** teams that have **either** player on the roster. |
| **Q5 Cross-team** | **Yes**, including cases where they never shared a team; auth still requires admin/owner on every team tied to **either** player. |
| **Q6 `player_checkouts` conflicts** | **Earliest `checked_out_at` wins**; if **tie**, **delete one** and continue (deterministic tie-break). |
| **Q7 Survivor** | **User picks** (not forced by `created_at`). |
| **Q8 Name fields** | **Yes** — after merge, copy `first_name` / `last_name` / `nickname` from duplicate → survivor where survivor field is **empty/null**. |
| **Q9 Preview** | **No** separate “counts-only” dry-run; **typed confirmation** before execute. **Conflict detail** comes from **`merge_players_preview`** (required for the wizard). |

---

## 6. Implementation phases

| Phase | Deliverable |
|-------|-------------|
| **1** | Migration: `player_merge_audit`, `merge_players_preview`, `merge_players_execute` |
| **2** | Teams UI: wizard, conflict screens, typed confirm, error handling |
| **3** | `REGRESSION_TESTING.md` + README |
| **4** | Optional: Admin-only mirror, analytics on audit table |

---

## 7. Risks

- **Payload tampering** — execute RPC must re-validate conflict keys and row ids belong to the two players.
- **Stale preview** — if data changes between preview and execute, return a clear error and ask user to refresh preview.
- **Concurrent games** — warn in UI to avoid merging during live tracking.

---

*Document version: 0.2 (decisions locked)*
