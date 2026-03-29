# Plan: Merge duplicate players

Merge two `players` rows when one was created by mistake: **reattach** all dependent data to the **survivor**, resolve uniqueness conflicts, then **delete** the duplicate row.

**Status:** Plan — not implemented. Needs product answers in §5 before build.

**Related:** [DATA_INTEGRITY_AND_CREATION_PLAN.md](DATA_INTEGRITY_AND_CREATION_PLAN.md), [DESIGN_SEASONS_DATA_MODEL.md](DESIGN_SEASONS_DATA_MODEL.md) (`team_players`, `player_guardians`).

---

## 1. Goals

- One **authoritative** `players` id after merge (survivor).
- **No orphaned** stats, checkouts, corrections, roster rows, or guardian links on the duplicate.
- **Predictable** behavior when both players have rows that would violate a `UNIQUE` constraint after repointing `player_id`.
- **Auditable** (recommended): record who merged whom and when.
- **Safe authorization**: only users who should be allowed to irreversibly combine identities can run the merge.

## 2. Non-goals

- Automatic duplicate detection (fuzzy name matching). Can be a later enhancement.
- Merging more than two players at once.
- Undo / split-after-merge (would require backups or a dedicated audit restore).

---

## 3. Data touched (current schema)

| Table | FK to `players` | Action |
|-------|------------------|--------|
| `game_stats` | `player_id` | `UPDATE` to survivor; **resolve** `(game_id, player_id, recorded_by, stat_id)` conflicts |
| `player_checkouts` | `player_id` | `UPDATE`; **resolve** `(game_id, player_id, user_id)` conflicts |
| `stat_corrections` | `player_id` | `UPDATE`; **resolve** `(game_id, player_id, stat_id)` conflicts |
| `team_players` | `player_id` | `UPDATE`; **resolve** `(team_id, player_id)` conflicts |
| `player_guardians` | `player_id` | Repoint to survivor; **resolve** `(player_id, user_id)` conflicts |
| `players` | — | `DELETE` duplicate after the above succeed |

**Not directly updated:** `games`, `tournaments`, `seasons`, `teams` — they do not reference `players.id`.

**App / client:** `localStorage` `statkeeper_game` and `cloudSync.playerIdMap` may still reference the old id until the user starts a fresh game or hydration remaps; document or optionally clear on device (out of scope for DB-only merge).

---

## 4. Proposed implementation

### 4.1 Database: single RPC (recommended)

Add a migration defining:

```text
merge_players(p_duplicate_id uuid, p_survivor_id uuid) RETURNS void
```

(or `RETURNS jsonb` with summary counts).

- **`SECURITY DEFINER`**, `SET search_path = public`, so one transaction can bypass per-row RLS while still enforcing **custom checks** inside the function.
- **`p_duplicate_id <> p_survivor_id`**; both rows must exist.
- **Authorization inside the function** (see §5 Q4): e.g. only if `auth.uid()` is **owner** of every `team_id` appearing in `team_players` for **either** player, or a stricter rule.
- Run all steps in **one transaction** (`BEGIN`…`COMMIT` inside the function, or implicit single-statement transaction).

**Ordered steps (conceptual):**

1. **Guardian links** — For each `player_guardians` row for duplicate: `INSERT` survivor + same `user_id` `ON CONFLICT (player_id, user_id) DO NOTHING`; then `DELETE` duplicate’s guardian rows (or update in place if no conflict).

2. **`team_players`** — For each row where `player_id = duplicate`:
   - If **no** row `(team_id, survivor)` exists: `UPDATE` `player_id` to survivor.
   - If **both** exist: **policy TBD** (§5 Q3) — e.g. keep survivor row, delete duplicate row; or merge jersey / `is_active` fields then delete one row.

3. **`game_stats`** — Repoint duplicate → survivor. On conflict `(game_id, survivor, recorded_by, stat_id)`:
   - **Policy TBD** (§5 Q1) — e.g. **sum** `value`, delete duplicate row; or keep survivor row and drop duplicate; or keep larger value.

4. **`stat_corrections`** — Same pattern; **policy TBD** (§5 Q2).

5. **`player_checkouts`** — Repoint; on conflict `(game_id, survivor, user_id)`:
   - **Policy TBD** (§5 Q6) — e.g. keep one row, prefer `is_primary = true`.

6. **`DELETE FROM players WHERE id = p_duplicate_id`**.

7. **Optional:** insert into **`player_merge_audit`** (new table) with `duplicate_id`, `survivor_id`, `merged_by`, `merged_at`, optional `note`.

### 4.2 Optional: audit table (migration)

```sql
CREATE TABLE public.player_merge_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  duplicate_player_id uuid NOT NULL,
  survivor_player_id uuid NOT NULL,
  merged_by uuid NOT NULL REFERENCES public.profiles(id),
  merged_at timestamptz NOT NULL DEFAULT now(),
  note text
);
```

RLS: insert only via RPC or service role; select for admins / support TBD.

### 4.3 App UI

**Placement (proposal):** **`/teams`** — when a team is selected, add an **“Advanced”** or **“Danger zone”** collapsible: **“Merge duplicate player”**.

**Flow:**

1. Short explanation: *This cannot be undone. All stats and roster links for the removed player move to the player you keep.*
2. **Survivor** — dropdown: active roster for **current team** (or searchable list of players user is allowed to merge — TBD).
3. **Duplicate** — dropdown: same team’s roster, excluding survivor; or “other player I created / guard” if we expand pool (TBD).
4. **Confirmation** — type **survivor’s full name** or both UUIDs checkboxes; show a **diff summary** if we add a read-only `preview_merge_players` RPC (optional): counts of `game_stats`, `team_players` rows to move.
5. **Submit** — call `merge_players(duplicate, survivor)`; show success or Postgres error (e.g. permission, unexpected conflict).

**Alternative:** **`/admin`** Data management section if you want merges **only** for power users and keep Teams simpler.

**Errors to surface:**

- Not authorized (function raises).
- Same id, missing id.
- Generic “merge failed” with support reference if constraint still hits (should not happen if logic is complete).

### 4.4 Documentation & ops

- **`README.md`** / **`REGRESSION_TESTING.md`**: note migration number, who can merge, and that Supabase must apply the new migration.
- **Runbook:** optional SQL-only procedure for support if UI is not used.

---

## 5. Clarifying questions (need answers before coding)

### Q1 — Duplicate `game_stats` (same game, recorder, stat)

If both players have a row for `(game_id, recorded_by, stat_id)`, after merge only one row may exist. Should we:

- **A.** **Sum** `value` (treat as double-entered),
- **B.** Keep **survivor’s** row only,
- **C.** Keep **duplicate’s** row only,
- **D.** Keep **max** of the two values,
- **E.** **Fail** the merge and require manual cleanup?

### Q2 — Duplicate `stat_corrections` (same game, stat)

If both have a correction row, which `corrected_value` (and metadata) wins?

- Survivor’s, duplicate’s, newer `created_at`, or fail?

### Q3 — Both on same `team_players` (same team)

Rare but possible. Keep **survivor** row and drop duplicate row, or merge **jersey_number** / **is_active** / **position** with explicit rules (e.g. prefer non-null jersey from duplicate)?

### Q4 — Who may merge?

Pick one or combine:

- **A.** User is **owner** of **all** teams that have either player on the roster (active or inactive),
- **B.** User is **owner or admin** on those teams,
- **C.** Only **`players.created_by = auth.uid()`** for **both** rows,
- **D.** **Season** `owner_id` covers all teams’ seasons for those roster rows,
- **E.** App-level **super-admin** only (future role).

### Q5 — Cross-team merges

Should merge be allowed when the duplicate and survivor have **never** shared a team (e.g. same kid, two accounts)? If yes, Q4’s permission model must still hold for **all** teams involved.

### Q6 — Duplicate `player_checkouts` (same game, user)

If both have a checkout, which row wins for `is_primary`?

### Q7 — Survivor identity

Must **survivor** always be the **older** `created_at` player, or **free user choice** with warnings?

### Q8 — Profile fields

After merge, should we **copy** `first_name` / `last_name` / `nickname` from duplicate → survivor if survivor’s fields are empty?

### Q9 — Preview RPC

Is a **dry-run** / counts-only RPC worth the extra migration surface, or is **typed confirmation** in the UI enough?

---

## 6. Implementation phases

| Phase | Deliverable |
|-------|-------------|
| **1** | Lock answers for §5 Q1–Q3, Q4, Q6 (minimum for safe SQL). |
| **2** | Migration: `merge_players` RPC (+ optional `player_merge_audit`). |
| **3** | Unit/integration tests in SQL or CI script with temp data (if you add a test harness). |
| **4** | Teams (or Admin) UI + error handling + copy. |
| **5** | `REGRESSION_TESTING.md` steps; README migration bullet. |
| **6** | Optional: `preview_merge_players`, duplicate detection, guardian merge UX. |

---

## 7. Risks

- **Wrong survivor** — irreversible data story; strong confirmation UX and optional audit.
- **RLS** — RPC must validate caller; avoid exposing raw `UPDATE players` to clients.
- **Concurrent edits** — merge during live game is rare; document “do not merge during active tracking” or use row locks if needed.

---

*Document version: 0.1 (plan)*
