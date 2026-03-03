# Design: Phase 3 Game Summary & Admin (Multi-Parent Review)

Design for the remaining Phase 3 features: Primary vs All Submissions view, reassign primary checkout, admin review queue, and conflict indicators. Ideas and decisions are tracked here so we can implement in small parts.

---

## 1. Goal & scope

**Goal:** Let team owners/admins and parents see both the “official” resolved stats and (optionally) all parent submissions for a finalized game; allow admins to reassign whose stats count as primary; and surface stats that need review (averaged / conflicting).

**Out of scope for this design:** Side-by-side comparison as a separate page, trend charts, or any change to the resolution logic itself (correction > primary > sole > averaged stays as-is).

---

## 2. Features (breakdown)

| # | Feature | Description | Priority |
|---|---------|-------------|----------|
| A | **Primary vs All Submissions toggle** | On Game Summary (finalized cloud games), a toggle or tab: “Primary view” (current resolved table) vs “All submissions” (per-recorder breakdown). | P1 |
| B | **Reassign primary checkout** | Admin can change who is the primary recorder for a player in a game (update `player_checkouts.is_primary`). Affects resolved view and season stats. | P1 |
| C | **Review queue for averaged stats** | List or section of (game, player, stat) rows where `source = 'averaged'` or `recorder_count > 1` with no correction, so admins can add a correction or reassign primary. | P2 |
| D | **Conflict indicator** | In Primary view, show a subtle indicator (e.g. icon/tooltip) when a stat is averaged or has multiple recorders, so “needs review” is visible without opening All Submissions. | P2 |
| E | **Side-by-side parent submissions** | Optional: dedicated view comparing each recorder’s values for a player (e.g. table: rows = stats, columns = recorders). | P3 |

---

## 3. Current state (what we have)

- **`get_game_stats_resolved(p_game_id)`**  
  Returns per (player, stat): `value`, `source` (`'correction'|'primary'|'sole'|'averaged'`), `recorded_by` (uuid or null for averaged), `recorder_count`.  
  GameSummary currently uses only `value` and builds `ResolvedStatsMap` (player → stat → value). We do **not** yet use `source`, `recorded_by`, or `recorder_count` in the UI.

- **Tables**
  - `game_stats`: (game_id, player_id, recorded_by, stat_id, value) — raw submissions.
  - `player_checkouts`: (game_id, player_id, user_id, is_primary) — who is primary per player per game.
  - `stat_corrections`: (game_id, player_id, stat_id, corrected_value, …) — admin overrides.

- **Game Summary today**
  - Finalized cloud games: loads resolved via RPC, shows one table (resolved values).
  - Admin “Review / Correct stats”: review mode with pencil per stat → correction modal (value + reason).
  - No toggle, no “all submissions” view, no reassign primary, no explicit review queue.

---

## 4. Data & API

### 4.1 Primary view (current)

- **Source:** `get_game_stats_resolved(p_game_id)`.
- **Change:** Use `source` and `recorder_count` for conflict/averaged indicators (Feature D). No new API.

### 4.2 All Submissions view (Feature A)

- **Need:** For this game, for each (player, stat), show each recorder’s value (and optionally display name).
- **Option 1 — Client:**  
  Query `game_stats` for `game_id = p_game_id`, group by player_id, stat_id, recorded_by. Resolve display names via `profiles` (id → display_name) for recorded_by.  
  - Pros: Simple, no new RPC.  
  - Cons: Two queries (game_stats + profiles), client-side grouping.
- **Option 2 — New RPC:**  
  e.g. `get_game_stats_all_submissions(p_game_id)` returns (player_id, stat_id, recorded_by, value, display_name?).  
  - Pros: One call, can restrict to team members only.  
  - Cons: New migration, need to join profiles (or auth.users) with RLS in mind.
- **Recommendation:** Start with **Option 1** (direct `game_stats` + `profiles` select by list of recorded_by uuids). Add RPC later if we want to centralize or optimize.

### 4.3 Reassign primary (Feature B)

- **Need:** Update `player_checkouts`: for (game_id, player_id), set `is_primary = false` for current primary and `is_primary = true` for the chosen user.  
  Constraint: only one primary per (game_id, player_id). Either:
  - Two updates (unset current primary, set new primary), or
  - RPC that does both in one transaction.
- **Recommendation:** Do two updates in a single transaction from the client (or one small RPC `set_primary_recorder(game_id, player_id, user_id)` that does both). No new table.

### 4.4 Review queue (Feature C)

- **Need:** Rows where resolved `source = 'averaged'` (or `recorder_count > 1` and no correction). We already get this from `get_game_stats_resolved` (source + recorder_count).  
  - UI: filter resolved rows to `source === 'averaged'` and show in a compact list/section with links to “Correct” or “Reassign primary” (Features B + existing correction flow).

### 4.5 Conflict indicator (Feature D)

- **Need:** Only display logic: when rendering a stat cell in Primary view, if `source === 'averaged'` or `recorder_count > 1`, show a small icon or tooltip (“Multiple recorders” / “Averaged – review”).  
  Data already in RPC response; we only need to pass `source`/`recorder_count` through and render accordingly.

---

## 5. UI sketch (concise)

- **Game Summary (finalized cloud game)**  
  - **Primary view (default):** Current table. Add small indicator per cell when `source === 'averaged'` or `recorder_count > 1` (Feature D).  
  - **Toggle:** “Primary” | “All submissions” (or tabs). Only show for finalized cloud games.  
  - **All submissions view:** Same table structure; each cell shows either a list of “recorder name: value” or a compact “e.g. 12 (Mom), 14 (Dad)” so multiple submissions are visible. If we have only one recorder for that stat, show single value.  
  - **Admin:** Existing “Review / Correct stats” stays. Add “Reassign primary” entry point: e.g. per player row or in a modal, “Primary recorder: [Dropdown of users who have checkouts for this player]” (Feature B).  
  - **Review queue (P2):** Section “Stats needing review” listing averaged (and optionally multi-recorder) stats with quick actions: Correct | Reassign primary.

- **Reassign primary flow**  
  - From Game Summary (admin): e.g. “Set primary recorder” per player → dropdown of team members who have a checkout (or submitted stats) for that player in this game → on select, call API to set primary, then refetch resolved.

---

## 6. Implementation order

1. **Part 1 — Use existing RPC metadata in Primary view**  
   - In GameSummary, when loading resolved, keep not only `value` but also `source` and `recorder_count` (e.g. `ResolvedStatsMap` extended or a parallel structure).  
   - Render conflict/averaged indicator in table cells (Feature D).  
   - Delivers: visible “needs review” in current view with no new APIs.

2. **Part 2 — Primary vs All Submissions toggle**  
   - Add toggle/tabs; “All submissions” fetches `game_stats` for the game + profiles for `recorded_by`.  
   - Build a “by player, by stat, by recorder” structure and render the same table with multi-value cells (Feature A).  
   - Only show toggle for finalized cloud games.

3. **Part 3 — Reassign primary**  
   - Add “Reassign primary” for admins (e.g. per player or from All Submissions).  
   - Load checkouts (and optionally who submitted) for the game/player; update `player_checkouts` (set one primary, clear other); refetch resolved (Feature B).

4. **Part 4 — Review queue**  
   - Add “Stats needing review” section: filter resolved rows by `source === 'averaged'` (and optionally `recorder_count > 1`), list them with links to Correct or Reassign primary (Feature C).

5. **Later — Side-by-side (P3)**  
   - Optional table view: rows = stats, columns = recorders, cells = value. Can reuse same data as “All submissions.”

---

## 7. Open questions / ideas to track

- **Display names for recorders:** Use `profiles.display_name` (and fallback to email) for “All submissions” and “Reassign primary” dropdown. Need to ensure RLS allows reading teammate profiles (already in 011: profiles of team mates readable).
- **Reassign primary UX:** Per-player dropdown in the table vs a single “Manage primary recorders” modal that lists all players and lets you set primary for each. Modal may scale better for many players.
- **Review queue placement:** Same page below the summary table vs a separate “Review” tab. Same page is simpler for v1.
- **Caching:** If we add an RPC for “all submissions,” consider making it STABLE and ensuring it only reads game_stats + profiles so it’s cacheable.

---

## 8. Summary

- **P1:** Primary vs All Submissions toggle (Part 2), Reassign primary (Part 3). Use existing RPC; add client query for raw submissions and profiles.
- **P2:** Conflict indicator in Primary view (Part 1), Review queue section (Part 4). Both use data we already have from `get_game_stats_resolved`.
- **P3:** Side-by-side view later.
- Design doc location: `docs/DESIGN_PHASE3_GAME_SUMMARY_ADMIN.md`. Update this file as we make implementation decisions or add ideas.
