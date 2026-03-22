# Data integrity & creation-order plan

This document captures a planned set of database and application changes to reduce drift after schema evolution (especially migration 018: seasons, `team_players`, `players.created_by`), align team/season creation across UI paths, and enforce clearer rules for required fields and insert order.

**Status:** Partially implemented (see migration `019`, `cloudSync`, Game Setup, Teams UI). Run `supabase/scripts/audit_data_integrity_pre_019.sql` before applying `019` in production if you have legacy rows.

---

## 1. Problem statement & reasoning

### 1.1 Why old or mixed data behaves poorly

- **Season identity is ambiguous.** There is no uniqueness rule tying “one logical season” to a single row. The **Teams** flow creates seasons with human names (e.g. `"Spring 2026"`). **`cloudSync.ts`** (`ensureSeason`) creates or finds a season using the **calendar year from the game date** as the season `name`, plus `sport`. The same user can end up with multiple seasons for the same sport/year or divergent naming, and duplicate **teams** (`owner_id` + `name` + `season_id`) are not prevented by the database.
- **Games do not store `season_id`.** Season is implied only through `teams.season_id`. If team/season data was repaired or inconsistent in SQL, games have no direct column to validate or filter without joining teams.
- **Tournament linkage is only partially enforced.** `games.tournament_id` is nullable; `tournament_name` is denormalized for display. Nothing in the database prevents `tournament_id` pointing at a `tournaments` row whose `team_id` differs from `games.team_id`, or `tournament_name` disagreeing with the FK row.
- **Roster flexibility vs. ambiguity.** `team_players.jersey_number` is optional. That is fine for flexibility but allows ambiguous rosters and confusing stats when historical data is messy.

### 1.2 Current canonical model (post–018)

| Entity        | Key facts |
|---------------|-----------|
| `seasons`     | Top-level; `owner_id`, `name`, `sport` required in DB. |
| `teams`       | `season_id` NOT NULL; sport lives on season, not team. |
| `tournaments` | Scoped by `team_id` only (season is indirect via team). |
| `players`     | Global row; `created_by` NOT NULL. |
| `team_players`| Junction: player ↔ team, optional `jersey_number`. |
| `games`       | `team_id` + optional `tournament_id` + `tournament_name`; season via team. |

### 1.3 Two creation paths today

1. **Teams / Admin UI** — Explicit season (new or existing), then team with `season_id`.
2. **`ensureSeason` / `ensureTeam` in `src/lib/cloudSync.ts`** — When there is no `cloudSync.seasonId`, season name is derived from **game date year**; team is matched or created by `owner_id`, `name`, `season_id`.

These paths can fork: a user who created a team under `"Spring 2026"` can still trigger creation of a separate season named `"2025"` when starting a game without an existing cloud team selection, producing duplicate teams/seasons and confusing history.

---

## 2. Target order of operations (canonical)

Use this for documentation, RPCs, wizards, and manual Supabase fixes (respect FK order).

1. **`auth.users` / `profiles`** — User exists.
2. **`seasons`** — `owner_id`, `name`, `sport` (+ optional `start_date`, `end_date`).
3. **`teams`** — `owner_id`, `name`, `season_id` (trigger adds owner to `team_members`).
4. **`tournaments`** (optional) — `team_id`, `name` after team exists.
5. **`players`** — `created_by`, `first_name`, etc.
6. **`team_players`** — Link player to team; set `jersey_number`, `is_active`.
7. **`player_guardians`** (recommended for consistency) — e.g. creator as guardian where the product expects pool/guardian behavior everywhere.
8. **`games`** — `team_id`, `opponent_name`, `game_date`, `created_by`, status; set `tournament_id` only when it belongs to the **same** `team_id`; keep `tournament_name` consistent with chosen tournament or explicit display rules.
9. **Downstream** — `game_stats`, `player_checkouts`, `stat_corrections`, etc.

---

## 3. Proposed work (phased)

### Phase A — Data audit & cleanup (Supabase / one-off SQL)

Before adding strict constraints, run checks and fix rows that would violate new rules.

| Check | Action |
|-------|--------|
| `teams.season_id` NULL or broken FK | Should not exist post-018; fix or delete orphans. |
| `games.tournament_id` set but `tournaments.team_id <> games.team_id` | Clear `tournament_id` or reassign to correct tournament; align `tournament_name`. |
| `tournament_id` set but `tournament_name` mismatches `tournaments.name` | Backfill name from join or clear FK. |
| Duplicate teams same `season_id` + `name` | Merge teams (hard) or rename; required before `UNIQUE(season_id, name)` if adopted. |
| Duplicate active jersey numbers per team | Resolve conflicts before partial unique index on active roster. |

Deliverable: short SQL notebook or commented script in repo (e.g. `supabase/scripts/` — optional) documenting queries used.

### Phase B — Database enforcement (new migration, e.g. `019`)

Implement in dependency order; each step may require Phase A cleanup first.

| Change | Rationale |
|--------|-----------|
| **`CHECK` on `seasons.sport`** | Restrict to known app sport IDs (align with `src/config/sports.ts`) so `GameSetup` filters (`.eq('seasons.sport', sport.id)`) never silently return empty due to typos. |
| **`UNIQUE (season_id, name)` on `teams`** | Prevents duplicate team names within one season. **Skip or defer** if product requires duplicate names. |
| **Partial unique index on `team_players`** | e.g. unique `(team_id, jersey_number)` WHERE `jersey_number IS NOT NULL AND jersey_number <> '' AND is_active = true` — prevents two active players sharing a number on one team. Tune for empty-string vs NULL. |
| **Integrity for game ↔ tournament** | `CHECK` constraint or trigger: `tournament_id IS NULL OR EXISTS (SELECT 1 FROM tournaments t WHERE t.id = games.tournament_id AND t.team_id = games.team_id)`. |
| **Optional `games.season_id`** | Add nullable column; `BEFORE INSERT/UPDATE` trigger sets `season_id` from `teams.season_id` for the game’s `team_id`. Backfill existing games via `UPDATE games g SET season_id = t.season_id FROM teams t WHERE t.id = g.team_id`. Simplifies reporting and future constraints. |

**Optional / stricter (later):**

- NOT NULL `team_players.jersey_number` for cloud flows — product decision; needs UI + backfill.
- Require `player_guardians` for creator — policy + backfill.

**RPCs (optional):**

- `create_team_with_season(...)` or transactional helper to insert season + team in one call and return IDs, reducing half-created states on flaky clients.

### Phase C — Application alignment

| Area | Change |
|------|--------|
| **`cloudSync.ts`** | Prefer **explicit** season when available: if UI has set `cloudSync.seasonId`, always use it for `ensureTeam` (already partially true); for “new team” cloud path, avoid relying **only** on calendar year — e.g. require season pick in Game Setup, or default season name from a visible rule consistent with Teams. Document behavior in README/INTEGRATION_PLAN. |
| **Game Setup** | When creating a new tournament (`+ Add new tournament`), validate non-empty name before proceed; on failure, show error (avoid silent no-op). |
| **Teams / Admin** | Optionally require explicit season name when creating new season (instead of only fallback `"{team} Season"`). |
| **Player Setup / Teams** | Optional UI validation: require jersey number for cloud teams (no DB change) if product wants stricter rosters. |

### Phase D — Documentation & tests

- Update [`docs/INTEGRATION_PLAN.md`](INTEGRATION_PLAN.md) schema section if `games.season_id` or new constraints land.
- Extend [`docs/REGRESSION_TESTING.md`](REGRESSION_TESTING.md) with cases: duplicate team blocked, invalid tournament FK rejected, cloud game uses selected team’s season.
- Add new migration filename to [`README.md`](../README.md) migration list when shipped.

---

## 4. Risks & decisions

| Topic | Decision needed |
|-------|-----------------|
| `UNIQUE(season_id, name)` on teams | Confirm no legitimate duplicate names in one season. |
| Partial unique on jersey | How to treat `''` vs NULL; inactive rows must not block re-use. |
| `seasons.sport` CHECK | Must update migration if new sports are added to `sports.ts` (or use a lookup table). |
| `games.season_id` | Slight redundancy with `teams.season_id`; tradeoff is simpler queries and safer audits. |

---

## 5. Completion checklist

- [ ] Phase A audit queries run (`supabase/scripts/audit_data_integrity_pre_019.sql`); problematic rows fixed or documented as exceptions.
- [ ] Migration `019_data_integrity_constraints.sql` applied in dev/staging; production after backup.
- [x] `cloudSync` prefers matching owner team+season by name+sport before year-based season; `ensureTeam` handles unique-name conflicts; `ensureGame` includes optional `season_id` with column fallback.
- [x] Game Setup: tournament name required when “+ Add new tournament”; optional season picker for **New team** cloud path; Teams: required season name when creating new season.
- [x] README migration list updated; INTEGRATION_PLAN + regression doc nudged.
- [ ] Full regression pass in app against a DB with `019` applied.

---

## 6. References

- Migration: `supabase/migrations/018_seasons_and_roster_junction.sql`
- Migration: `supabase/migrations/019_data_integrity_constraints.sql`
- Pre-migration audit: `supabase/scripts/audit_data_integrity_pre_019.sql`
- Cloud sync: `src/lib/cloudSync.ts` (`ensureSeason`, `ensureTeam`, `ensureGame`, `ensurePlayerId`)
- Team creation: `src/pages/Teams.tsx`
- Game setup: `src/pages/GameSetup.tsx`
- Sport IDs: `src/config/sports.ts`
