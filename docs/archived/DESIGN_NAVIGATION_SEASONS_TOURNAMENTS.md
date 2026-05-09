# Design: Sport → Seasons → Tournaments → Games navigation

High-level navigation redo: keep the **home screen** as-is; after **choosing a sport**, guide users through **seasons**, then **team** (when a season has teams), then **tournaments** or **exhibition**, then **games**, with **CRUD** at each level where the product and RLS allow.

**Status:** Product decisions recorded (see §10). Ready to break into implementation slices.

**Related docs:** [DESIGN_SEASONS_DATA_MODEL.md](../completed/DESIGN_SEASONS_DATA_MODEL.md), [DATA_INTEGRITY_AND_CREATION_PLAN.md](../completed/DATA_INTEGRITY_AND_CREATION_PLAN.md), [DESIGN_STAT_TRACKING_UI.md](../DESIGN_STAT_TRACKING_UI.md). **Future:** granular permissions — [DESIGN_USER_PERMISSIONS_AND_ROLES.md](DESIGN_USER_PERMISSIONS_AND_ROLES.md) (placeholder).

---

## 1. Goals

- **Predictable hierarchy:** Sport → Seasons (filtered) → **team in season** → Tournaments + Exhibition → Games (scoped to team + tournament or exhibition).
- **CRUD where it matters:** Create / read / update / delete for seasons, teams, tournaments, and games without losing context.
- **Align with Supabase:** Respect existing tables, RLS, and integrity rules (019 triggers, uniqueness) unless we explicitly extend the schema.
- **Mobile-first:** Cards, full-width lists, `HashRouter` URLs.
- **Universal entry:** This path is the **primary** way to move from sport selection into any app interaction that needs season/tournament/game context (see §10).

## 2. Non-goals (for this doc)

- Replacing in-game tracking UI (scoreboard, checkout, summary) — only **navigation into** setup / resume / lists.
- Full redesign of stat pages — may add deep links later.
- **Fine-grained RBAC** beyond what exists today — see [DESIGN_USER_PERMISSIONS_AND_ROLES.md](DESIGN_USER_PERMISSIONS_AND_ROLES.md).

---

## 3. Proposed user flow (conceptual)

```
Home (unchanged)
  → Pick sport
       → Seasons list (filtered by sport)           [CRUD seasons — owner]
            → Select season
                 → Season hub
                      → Teams in this season
                           → If no teams: prominent “Create team” (NOT bundled with season create)
                           → Select team
                                → Tournaments list   [CRUD tournaments — per team]
                                → “Exhibition”
                                     → Games list     [CRUD games; all statuses]
                                → Select tournament
                                     → Games list     [CRUD games; all statuses]
```

**Exhibition:** Games for the selected **team** with **no structured tournament** — **`games.tournament_id IS NULL`**. That is the canonical rule: legacy free-text `tournament_name` without a `tournaments` row still counts as exhibition until you **link** the row (`tournament_id`) or **clear** `tournament_name` for a cleaner list. List includes **all game statuses** (scheduled, in progress, final).

**Data normalization:** Run [`supabase/scripts/normalize_exhibition_games.sql`](../supabase/scripts/normalize_exhibition_games.sql) in Supabase (identify → optional link by name → optional clear). Optional migration **`022_games_is_exhibition_generated.sql`** adds a stored generated `is_exhibition` column (`tournament_id IS NULL`) for simpler queries.

**Authentication:** User must be **signed in before** entering this flow (see §10). **Offline/local** still participates in the same conceptual tree (see §10).

---

## 4. Current data model (relevant facts)

| Entity | Scope | Notes |
|--------|--------|--------|
| `seasons` | `owner_id`, `sport`, `name`, optional dates | Member visibility via teams in season. |
| `teams` | **`season_id` required** (018) | Tournaments and games attach to **teams**. |
| `tournaments` | **`team_id`** | Unique `(team_id, name)`. |
| `games` | `team_id`, optional `tournament_id` | Exhibition ↔ `tournament_id` null. |

---

## 5. Season hub and teams (decided)

- **Many teams per season** are supported.
- **No** combined “create season + first team” step. Creating a season and creating a team remain **separate** actions.
- If the season has **no teams**, the hub shows a clear empty state and a **Create team** button (navigates to existing team-creation flow scoped to that season).
- **Tournaments and exhibition are per team:** user **selects a team** in the season before seeing tournaments or exhibition games (engineering option **A** from the earlier draft).

---

## 6. Tournaments (decided)

- Lists are **per team** (not aggregated across the season).
- **Placement** may be edited from **both** the tournaments list UI **and** the tournament stats page (keep behavior consistent).
- Tournaments with **zero games** still **appear** in the list.

---

## 7. Games lists & CRUD (decided)

- **Statuses:** Include **all** statuses in exhibition and tournament game lists (filter chips optional later).
- **Delete:** **Hard delete** with a strong **warning** (copy should mention stats/checkout data if applicable; align with DB cascades and RLS).
- **View default:** Primary action opens the game (tracker, checkout, or summary as appropriate).
- **Edit:** Allowed; for **finalized** games, require an explicit confirmation (e.g. “This game is finalized — editing may affect records. Continue?”) before applying changes.

**Legacy `tournament_name`:** Rows with **`tournament_id IS NULL`** are **exhibition**, including legacy free-text names. Prefer a one-time DB pass: optionally **set `tournament_id`** when `btrim(tournament_name)` matches `tournaments(team_id, name)`, else **clear `tournament_name`** if you want exhibition rows to show only the UI “Exhibition” label. See `supabase/scripts/normalize_exhibition_games.sql`.

---

## 8. CRUD constraints (RLS & safety)

- **Seasons:** Owner-only mutating operations (018); members see via team membership.
- **Tournaments:** Insert: team members; update/delete: owner/admin (016).
- **Games:** Follow existing policies; UI warnings must match what the server allows.
- **Delete season:** CASCADE implications — confirmation pattern (e.g. type season name).

---

## 9. Implementation phases (suggested)

1. **Auth gate** — After sport select, ensure **authenticated** before seasons UI; post-login return to intended sport.
2. **Routing shell** — Params: `sport`, `seasonId`, `teamId`, `tournamentId`, `mode=exhibition`.
3. **Seasons CRUD** — Filter by sport; no auto-team on create.
4. **Season hub** — Team list, empty state + **Create team**; team select persistence (URL or session).
5. **Tournaments CRUD** — Per team; placement on list + stats page.
6. **Games lists + CRUD** — Exhibition vs tournament scope; hard delete + finalized edit confirmation.
7. **Local/offline branch** — Same hierarchy metaphor for local games (placeholder season/team or explicit “Local” scope) without breaking auth-first for cloud.
8. **Polish** — Retire or redirect legacy shortcuts; deep links from stats pages.

---

## 10. Resolved product Q&A

| # | Question | Decision |
|---|----------|----------|
| A.1 | Multiple teams per season? | **Yes** — supported. |
| A.2 | Create season + first team in one step? | **No.** Separate steps. If no teams, show **Create team** only. |
| B.3 | Tournament list scope? | **Per team.** |
| B.4 | Placement editing? | **Both** tournaments list and tournament stats page. |
| B.5 | Show empty tournaments? | **Yes.** |
| C.6 | Legacy `tournament_name` without `tournament_id`? | **Exhibition.** Normalize via script: link by matching tournament name per team, or clear `tournament_name`. |
| C.7 | Exhibition statuses? | **All statuses.** |
| D.8 | Delete game? | **Hard delete** with warning. |
| D.9 | Edit finalized games? | **Yes**, with **explicit confirmation** before save. |
| E.10 | Cloud only vs local too? | **Both** — same conceptual flow; local path detailed in build. |
| E.11 | Not signed in after sport? | **Authenticate first**, then continue. |
| F.12 | Sport select destination? | **Always** this navigation path for app interactions: sport → season → tournament or exhibition → configure or add game. |

---

## 11. Decision log

| ID | Topic | Decision |
|----|--------|----------|
| D1 | Season hub | **Team picker (option A)** — tournaments and exhibition are per selected team. |
| D2 | Tournaments scope | **Per team.** |
| D3 | Legacy `tournament_name` | **Resolved:** exhibition = `tournament_id IS NULL`. Script + optional migration `022` for `is_exhibition`. |
| D4 | Replace `/games` | **TBD** — redirect into new games list vs keep alias route. |
| D5 | Permissions beyond today | **Future doc:** [DESIGN_USER_PERMISSIONS_AND_ROLES.md](DESIGN_USER_PERMISSIONS_AND_ROLES.md). |

---

*Document version: 0.3 (exhibition data rule + normalization)*
