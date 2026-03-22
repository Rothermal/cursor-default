# Design: Tournaments in Data Model and UI

Design for elevating tournaments from a free-text field to a first-class entity: central `tournaments` table, games linked via `tournament_id`, and UI that supports tournament-scoped views (game list, standings, stats). Aligns with README/INTEGRATION_PLAN Future Enhancements (editable team names, player names, and tournaments).

---

## 1. Goal and scope

**Goals:**

- **Data model:** Introduce a `tournaments` table; games reference `tournament_id` (optional). Enables grouping games by tournament, consistent naming, and future aggregation (standings, tournament-only stats).
- **UI:** Let users create/select a tournament when setting up a game; show tournament context on game list, Game Summary, and Scoreboard; optionally add tournament-scoped views (e.g. "Games in this tournament," "Tournament standings," "Tournament stats").

**In scope:** Migration path from current `games.tournament_name` (text) to optional `games.tournament_id` (FK); tournament create/select in Game Setup (and/or Teams); display of tournament name on game cards, summary header, scoreboard; filter games by tournament on Cloud Games page; optional Tournament detail/standings page.

**Out of scope (for this design):** Complex bracket logic, multi-phase tournaments, or automatic standings calculation (we can define standings as a simple aggregation later).

---

## 2. Current state

**Database:** See migrations `016` (`tournaments` table), `023` (`tournaments.url` — optional external link). `games` has optional `tournament_id` FK and legacy `tournament_name`.

**Historical note — before `016` ([003_games_stats.sql](supabase/migrations/003_games_stats.sql)):**

- `games` had `tournament_name text` only; no `tournament_id` or `tournaments` table.

**App:**

- **[GameSetup](src/pages/GameSetup.tsx):** Single text field "Tournament / League"; value stored in `gameInfo.tournamentName` and (when syncing) in `games.tournament_name`. No list of existing tournaments; every game can have a different free-text value.
- **[Game Summary](src/pages/GameSummary.tsx), [Scoreboard](src/components/Scoreboard.tsx):** Show `gameInfo.tournamentName` when non-empty (subtitle under score).
- **[Games](src/pages/Games.tsx):** Fetches games with `id, team_id, opponent_name, opponent_score, game_date, status, created_at` — **does not fetch or display** `tournament_name`. No filter by tournament.
- **Types ([types.ts](src/types.ts)):** `GameInfo.tournamentName: string`.

**Gaps:**

- Same tournament typed repeatedly (e.g. "Spring Invitational") with possible typos; no single source of truth.
- No way to "see all games in Tournament X" or "tournament standings" without a central tournament entity.
- Game list does not show or filter by tournament.

---

## 3. Data model

### 3.1 Option A: Tournaments scoped to team (recommended for v1)

Tournaments are created and used in the context of a **team** (e.g. "Eagles – Spring Invitational"). Same tournament name can exist for different teams.

**New table: `tournaments`**

| Column        | Type      | Description                          |
|---------------|-----------|--------------------------------------|
| id            | uuid      | PK, default gen_random_uuid()       |
| team_id       | uuid      | FK → teams, NOT NULL                 |
| name          | text      | NOT NULL                             |
| created_at    | timestamptz | NOT NULL default now()             |

- Unique constraint: `(team_id, name)` or allow duplicates and distinguish by id.
- RLS: team members can CRUD tournaments for their team (same as games: via team_id in team_members).

**Games table change:**

- Add `tournament_id uuid REFERENCES tournaments(id) ON DELETE SET NULL`.
- Keep `tournament_name text` for **backward compatibility and migration:** when `tournament_id` is set, treat `tournament_name` as denormalized copy of `tournaments.name` (or leave null and resolve name via join). When migrating existing rows, we can backfill `tournament_id` by matching `tournament_name` to a created tournament, or leave old games with only `tournament_name` and new games with `tournament_id`.
- **Simpler migration:** Add `tournament_id` nullable; do **not** drop `tournament_name` initially. App logic: if `tournament_id` present, use resolved tournament name; else fall back to `tournament_name`. Later we can backfill and optionally drop `tournament_name`.

### 3.2 Option B: Global tournaments (no team_id)

One global list of tournaments; any team’s game can link to any tournament. Simpler table but less clear ownership and RLS (who can create/edit?). Prefer Option A for clarity and RLS consistency.

### 3.3 Recommendation

- **Option A.** `tournaments(team_id, name)` with unique `(team_id, name)`; `games.tournament_id` nullable FK; keep `games.tournament_name` for now so existing data and sync still work. Resolve display name: `COALESCE(t.name, g.tournament_name)` when we have a join.

---

## 4. Migration strategy

This design does not assign a specific migration number; when implementing, add a new migration file with the next available number (e.g. after the latest in `supabase/migrations/`).

1. **New migration:**
   - Create `tournaments` table (id, team_id, name, created_at), RLS (team members can select/insert/update/delete for their team), unique (team_id, name).
   - Add `games.tournament_id uuid REFERENCES tournaments(id) ON DELETE SET NULL`.
   - Do **not** remove `games.tournament_name` yet.

2. **Backfill (optional, can be separate migration or one-off):**
   - For each distinct (team_id, tournament_name) where tournament_name is not null, insert into `tournaments` if not exists, then set `games.tournament_id` for those games. Allows existing games to show under a "tournament" without user re-entering.

3. **App:**
   - Game Setup: when saving a game (create or update), if user selected or created a tournament, set `games.tournament_id` and optionally keep `games.tournament_name` in sync for readability in DB. When loading a game, prefer tournament name from join on `tournament_id`, fallback to `tournament_name`.

---

## 5. UI integration

### 5.1 Game Setup

- **Tournament field:** Replace or augment the single text input with:
  - **Dropdown "Tournament (optional)":** Load tournaments for the selected team (or current team in cloud flow). Options: existing tournaments for that team + "Add new…".
  - **"Add new…"** opens inline or modal: enter name → create row in `tournaments` (team_id = selected team) → select it. If no team selected yet (e.g. new team flow), keep free-text for this game only and optionally create tournament later (or defer creation until we have team_id).
- **Backward compatibility:** If we still support "type anything" for ad-hoc league names, we can allow a hybrid: dropdown of existing + "Other: [text]" which writes only `tournament_name` and leaves `tournament_id` null. That keeps one-off names without polluting the tournaments table.

### 5.2 Cloud Games list ([Games.tsx](src/pages/Games.tsx))

- **Fetch:** Include `tournament_id` and `tournament_name` in the games select (and optionally join `tournaments` to get `tournaments.name` for display).
- **Display:** On each game card, show tournament name when present (e.g. subtitle or small label "Spring Invitational").
- **Filter:** Add optional filter "Tournament: All | [list of tournaments for this team]." When selected, restrict list to games where `tournament_id` = chosen (or `tournament_name` = chosen for old games). Requires loading tournaments for the user’s teams (or per-team when we have a team filter).

### 5.3 Game Summary and Scoreboard

- **Already show** `gameInfo.tournamentName`. Once we have `tournament_id` and resolved name from API, pass the same display value (resolved tournament name or fallback to free text) so the header/subtitle is unchanged from the user’s perspective.

### 5.4 Tournament-scoped views (optional, v2)

- **Tournament detail page:** Route e.g. `/#/teams/:teamId/tournaments/:tournamentId` or `/#/tournaments/:id`. Shows: tournament name, list of games in that tournament (with scores if we add score to list), and optionally:
  - **Standings:** If we define "standings" as wins/losses per team (our team vs opponents), we can compute from finalized games in that tournament. Simple table: Opponent, W, L, PF, PA.
  - **Tournament stats:** Same as season stats but filtered to games where `tournament_id` = X (reuse resolved stats RPC with a game filter).
- **Entry point:** From Games list (e.g. "View tournament" when filter is by tournament) or from a "Tournaments" section on the team detail (list of tournaments for the team with game counts and links).

---

## 6. Suggestions summary

| Area            | Suggestion                                                                 |
|-----------------|----------------------------------------------------------------------------|
| **Data model**  | `tournaments(team_id, name)`; `games.tournament_id` nullable FK; keep `tournament_name` for migration and fallback. |
| **Game Setup**  | Dropdown of team’s tournaments + "Add new…"; optional "Other: [text]" for one-off names. |
| **Games list**  | Show tournament name on each card; add filter by tournament (per team or global list). |
| **Summary/Scoreboard** | Keep current display; feed with resolved tournament name from API. |
| **New pages**   | Optional: Tournament detail page with game list + standings + tournament-only stats (v2). |
| **Standings**   | Simple W/L (and PF/PA) from finalized games in tournament; no bracket.    |

---

## 7. Implementation order

1. **Migration:** Add a new migration file (use next available number). Create `tournaments` table (with RLS); add `games.tournament_id`; leave `tournament_name` in place.
2. **Cloud sync / types:** Ensure game payloads and types include `tournament_id` and resolved tournament name where needed; cloudSync and GameContext continue to support tournament display.
3. **Game Setup:** Load tournaments for selected team; dropdown + "Add new"; on save, set `tournament_id` when a tournament is selected, else keep using `tournament_name` for free text.
4. **Games page:** Select `tournament_id` and `tournament_name`; display tournament on cards; add tournament filter (load tournaments for teams in the game list, then filter games by selected tournament).
5. **Backfill (optional):** Script or migration to create tournament rows from distinct `(team_id, tournament_name)` and set `games.tournament_id`.
6. **Tournament detail + standings (v2):** New route and page; standings = aggregated W/L from finalized games in tournament; link from game list when filtered by tournament.

---

## 8. Open questions

- **Unique name per team:** Should (team_id, name) be unique? Prevents duplicate "Spring Invitational" for same team; allows "Spring Invitational" for two different teams. Recommendation: yes, unique (team_id, name).
- **Edit/delete tournament:** When a tournament is renamed or deleted, do we update or null out `games.tournament_id`? ON DELETE SET NULL already handles delete. For rename, update `tournaments.name`; no need to touch games if we always resolve name via join.
- **"Other" free text:** Keep one-off tournament name without creating a row? If yes, we only set `games.tournament_name` and leave `tournament_id` null; display uses `tournament_name` for those games.
- **Season vs tournament:** Teams already have a `season` field. Tournaments are often within a season but not 1:1. We do not add season_id to tournaments in v1; we can add later if we want "tournaments for this season" filters.

---

## 9. File and doc references

- Games schema: [supabase/migrations/003_games_stats.sql](supabase/migrations/003_games_stats.sql)
- Game Setup: [src/pages/GameSetup.tsx](src/pages/GameSetup.tsx)
- Games list: [src/pages/Games.tsx](src/pages/Games.tsx)
- Game Summary: [src/pages/GameSummary.tsx](src/pages/GameSummary.tsx)
- Types: [src/types.ts](src/types.ts)
- Future enhancements: [README.md](README.md) (Editable team names, player names, and tournaments)
