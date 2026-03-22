# Design (placeholder): User permissions & roles

**Status:** Placeholder — no implementation yet. Requires a deeper product discussion before schema, RLS, or UI work.

## Intent

Evolve how **users** relate to **seasons, teams, players, games, and stats** through explicit **permission levels**, instead of only the current coarse roles (e.g. `team_members.role`).

## Default posture (product direction)

- **Default for all users:** **Read** access at the appropriate scope (what “read” means per resource will be defined later).
- Higher levels grant progressively more capability up to **full CRUD** where it makes sense for that resource.

## Open discussion: persona examples

The following are **examples only** — not final roles. We need to decide which personas exist, which overlap, and what each may do.

| Example persona | Notes (TBD) |
|-----------------|---------------|
| **Parent / guardian** | Often linked via `player_guardians`; likely read-heavy, maybe limited edit. |
| **Coach** | May need score/game management for assigned teams; probably not org-wide admin. |
| **Team manager** | Roster, schedules, tournaments; might align with current admin/owner in places. |
| **League / org admin** | Cross-team or cross-season operations (if we add orgs later). |
| **App admin** | Platform-level support; separate from team ownership. |

## Permission model (to be designed)

- **Dimensions:** Resource type (season, team, game, player, stats, invites, …) × action **R** / **C** / **U** / **D** (or a smaller set if we merge concepts).
- **Scope:** Per team, per season, per player (guardian), global — TBD.
- **Implementation options (later):** extend `team_members`, new join tables, Supabase RLS + RPC checks, or a hybrid.

## Dependencies

- [DESIGN_NAVIGATION_SEASONS_TOURNAMENTS.md](DESIGN_NAVIGATION_SEASONS_TOURNAMENTS.md) (navigation and CRUD surfaces).
- [DESIGN_SEASONS_DATA_MODEL.md](DESIGN_SEASONS_DATA_MODEL.md) (current data model).
- Existing RLS on `teams`, `team_members`, `seasons`, `tournaments`, `games`, etc.

## Next steps (when prioritized)

1. Workshop: list personas, realistic workflows, and minimum viable permission matrix.
2. Map matrix to current tables and identify gaps (e.g. parent vs coach on same team).
3. Draft migration + RLS plan; then UI for “you don’t have access” and admin assignment flows.

---

*Document version: 0.1 (placeholder)*
