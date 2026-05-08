# Implementation Plan: Team-Level Stat Tracking

Step-by-step implementation plan for the team stats feature, broken into small work units with clear test breakpoints, dependency ordering, and guidance on which units can be assigned to parallel agents.

**Status (2026):** Work units **WU-1 through WU-12** are **done** on the `stattracker` branch. Treat the sections below as a **historical checklist** and architecture reference, not pending tasks.

**Shipped surface (quick ref):**

| Area | Location / notes |
|------|------------------|
| Types & reducer | `src/types.ts`, `src/context/GameContext.tsx` (`currentPeriod`, `teamStatsConfig`, `SET_PERIOD`, `SET_TEAM_STATS_CONFIG`) |
| Basketball config | `src/config/sports.ts` (`teamCategories`, `teamFoulBaseStatId`), `src/config/teamStatsDefaults.ts` |
| Tracker UI | `src/pages/GameTracker.tsx`, `src/components/team-stats/*` |
| Season rules UI | `src/components/SeasonTeamStatsEditor.tsx`, `src/pages/Admin.tsx` (Seasons) — not a standalone `SeasonSettings` route |
| Cloud | `src/lib/cloudSync.ts` — placeholder `players`, `games.home_team_player_id` / `opp_team_player_id`, `game_stats` |
| Checkout | `src/pages/GameCheckout.tsx`, `src/pages/PlayerSetup.tsx` (inject placeholders) |
| Summary | `src/pages/GameSummary.tsx` — tabs **Players** / **Scores** / **Team stats**; `TeamStatSummary.tsx`, `get_game_team_stats` RPC |
| DB | `supabase/migrations/027_*.sql` … `031_*.sql` |

**Design docs implemented by this plan:**
- [DESIGN_TEAM_STATS_TRACKING.md](DESIGN_TEAM_STATS_TRACKING.md) — core architecture (pseudo-players, injection, category switching)
- [DESIGN_TEAM_STATS_BASKETBALL.md](DESIGN_TEAM_STATS_BASKETBALL.md) — basketball-specific stats, bonus indicators, period toggle
- [DESIGN_TEAM_STATS_SEASON_CONFIG.md](DESIGN_TEAM_STATS_SEASON_CONFIG.md) — season-level configuration UI and data flow
- [DESIGN_TEAM_STATS_DATA_MODEL.md](DESIGN_TEAM_STATS_DATA_MODEL.md) — database schema, cloud sync, RPC changes

---

## 1. Dependency Graph

```
WU-1  Foundation Types & Config
  │
  ├──────────────────────┬─────────────────────┐
  │                      │                     │
  ▼                      ▼                     ▼
WU-2  Filtering        WU-3  Injection       WU-6  DB Migration ─────────┐
  │   Guard Rails        │                     │                         │
  │                      ▼                     ├────────────┐            │
  │                    WU-4  Category          │            │            │
  │                    │     Switching +       ▼            ▼            │
  │                    │     Period Toggle   WU-7  Season  WU-10 Cloud   │
  │                    │                    │     Config    │    Sync    │
  │                    ▼                    │     Types     │            │
  │                  WU-5  Bonus            │              │            │
  │                  │     Indicators       ▼              ▼            │
  │                  │                    WU-8  Season   WU-11 Checkout │
  │                  │                    │     Config     Integration  │
  │                  │                    │     UI                      │
  │                  │                    │                             │
  │                  ├────────────────────┤                             │
  │                  │                    │                             │
  │                  ▼                    ▼                             │
  │                WU-9  Config-Driven Components                      │
  │                                                                    │
  │                  WU-12 Game Summary ◄──── WU-4                     │
  │                                                                    │
  └──── all filter work is low-risk and can be done alongside WU-3    │
```

**Critical path:** WU-1 → WU-3 → WU-4 → WU-5 → WU-9

**Longest backend path:** WU-1 → WU-6 → WU-10 → WU-11

---

## 2. Work Units

Each work unit (WU) is a self-contained chunk of work that a single agent can complete, test, commit, and hand off. Work units are designed to take roughly 1 focused agent session each.

---

### WU-1: Foundation Types & Config

**Design docs:** [TRACKING §2.1, §2.3, §3.1](DESIGN_TEAM_STATS_TRACKING.md) · [BASKETBALL §2](DESIGN_TEAM_STATS_BASKETBALL.md)

**Depends on:** Nothing — this is the root of the dependency tree.

**Blocks:** Everything else.

**What to do:**

1. **`src/types.ts`** — Extend existing interfaces:
   - `Player`: add `isTeamPlayer?: boolean`, `teamSide?: 'home' | 'opponent'`
   - `StatAction`: add `periodScoped?: boolean`
   - `GameState`: add `currentPeriod: number`, `teamStatsConfig: TeamStatsConfig | null`
   - `GameAction`: add `| { type: 'SET_PERIOD'; period: number }`
   - Define `BasketballTeamStatsConfig` interface and `TeamStatsConfig` union type
   - `SportConfig`: add `teamCategories?: StatCategory[]`, `teamKeyStatIds?: string[]`

2. **`src/config/sports.ts`** (or a new `src/config/teamStatsDefaults.ts`):
   - Export `BASKETBALL_TEAM_STATS_DEFAULTS` constant
   - Export `resolveTeamStatsConfig(sport: SportConfig, seasonConfig: unknown): TeamStatsConfig | null` — merges sport defaults with season JSON
   - Add `teamCategories` to the basketball entry in the `sports` array (see [BASKETBALL §2](DESIGN_TEAM_STATS_BASKETBALL.md) for exact config)

3. **`src/context/GameContext.tsx`**:
   - Add `currentPeriod: 1` and `teamStatsConfig: null` to `createInitialState()`
   - Add `SET_PERIOD` case to `gameReducer`
   - Include `currentPeriod` and `teamStatsConfig` in `loadState()` deserialization with fallback defaults

**Files touched:** `src/types.ts`, `src/config/sports.ts`, `src/context/GameContext.tsx`

**Test breakpoint:**
- `pnpm build` — no type errors
- `pnpm lint` — no new warnings
- Start a game in the browser — existing player tracking works identically (no visual changes)

**Commit message:** `feat: add team stats foundation types and basketball team categories`

---

### WU-2: Score Exclusion & Filtering Guard Rails

**Design docs:** [TRACKING §2.4](DESIGN_TEAM_STATS_TRACKING.md) · [DATA_MODEL §5](DESIGN_TEAM_STATS_DATA_MODEL.md)

**Depends on:** WU-1

**Blocks:** Nothing directly — this is a safety net.

**What to do:**

Add `isTeamPlayer` filters to prevent team pseudo-players from corrupting individual player views. These are no-ops right now (no team players exist yet) but must be in place before injection (WU-3) lands.

1. **`src/components/Scoreboard.tsx`** — Filter `players.filter(p => !p.isTeamPlayer)` before `computePlayerScore` reduce.
2. **`src/pages/GameSummary.tsx`** — Filter team players from the per-player stat tables.
3. **`src/pages/Leaderboard.tsx`** — Filter team players from rendered results (client-side).
4. **`src/components/MergePlayerWizard.tsx`** — Exclude `isTeamPlayer` from merge candidate lists.
5. **`src/lib/cloudSync.ts`** — In `ensurePlayerId` (or wherever roster `team_players` rows are created), skip players with `isTeamPlayer === true`.

**Files touched:** `Scoreboard.tsx`, `GameSummary.tsx`, `Leaderboard.tsx`, `MergePlayerWizard.tsx`, `cloudSync.ts`

**Test breakpoint:**
- `pnpm build` passes
- Existing game play unchanged — start a game, track stats, view summary, check leaderboard. Everything works as before.

**Commit message:** `feat: add isTeamPlayer guard filters across Scoreboard, Summary, Leaderboard`

---

### WU-3: Team Pseudo-Player Injection & Selector UI

**Design docs:** [TRACKING §2.1, §2.2, §4.1](DESIGN_TEAM_STATS_TRACKING.md) · [BASKETBALL §5.1](DESIGN_TEAM_STATS_BASKETBALL.md)

**Depends on:** WU-1 (types exist), WU-2 recommended (filters in place)

**Blocks:** WU-4, WU-5, WU-11, WU-12

**What to do:**

1. **`src/pages/GameTracker.tsx`** — At the top of the component (after the redirect guard), check if the sport has `teamCategories` and team pseudo-players are not already in `players`. If both true, inject them:
   ```typescript
   const homeTeamPlayer: Player = {
     id: '__team_home__',
     name: gameInfo.teamName,
     number: '★',
     stats: {},
     isTeamPlayer: true,
     teamSide: 'home',
   }
   const oppTeamPlayer: Player = {
     id: '__team_opp__',
     name: gameInfo.opponentName,
     number: '★',
     stats: {},
     isTeamPlayer: true,
     teamSide: 'opponent',
   }
   ```
   Use a `useEffect` or an early dispatch to inject via `SET_PLAYERS` (prepend to existing players).

2. **Player selector strip** — Sort: team players first (home, then opponent), then individual players. Add visual distinction:
   - Different background: use a gradient or semi-transparent pattern instead of the solid sport theme color
   - Show full team name (truncated if long) instead of first name
   - Show `★` instead of `#number`
   - Add a thin vertical divider or spacing gap between team and individual player buttons

3. **Undo label** — Modify the `lastActionLabel` logic: if the player is a team player (`isTeamPlayer`), show the first word of the team name instead of `#number`. E.g., `Rebels TF +` instead of `#★ TF +`.

**Files touched:** `src/pages/GameTracker.tsx`

**Test breakpoint:**
- Start a basketball game → two team player buttons appear pinned left: `★ [TeamName]`, `★ [OpponentName]`
- They look visually different from individual players
- Tapping them selects them (active highlight)
- Start a baseball game → no team buttons (baseball has no `teamCategories` yet)
- Undo label shows team name prefix for team stat actions
- Score in the Scoreboard is unaffected by team player selection

**Commit message:** `feat: inject team pseudo-players and pin to left of player selector`

---

### WU-4: Stat Category Switching + Period Toggle

**Design docs:** [TRACKING §2.3, §3.1, §3.2](DESIGN_TEAM_STATS_TRACKING.md) · [BASKETBALL §2.1, §4](DESIGN_TEAM_STATS_BASKETBALL.md)

**Depends on:** WU-3 (team players exist and are selectable)

**Blocks:** WU-5, WU-9, WU-12

**What to do:**

1. **`src/pages/GameTracker.tsx`** — When `activePlayer.isTeamPlayer === true`:
   - Render `sport.teamCategories` instead of `sport.categories`
   - For actions with `periodScoped === true`, construct the actual stat ID as `${action.id}_p${currentPeriod}`
   - The `StatButton` value reads from `player.stats[actualStatId]`
   - The `INCREMENT_STAT` / `DECREMENT_STAT` dispatches use the period-scoped stat ID
   - For period-scoped stats, show a game-total subtitle below the count (sum all `${action.id}_p*` keys)

2. **New: `src/components/team-stats/PeriodToggle.tsx`**:
   - Props: `periods: number`, `periodLabels: string[]`, `currentPeriod: number`, `onPeriodChange: (p: number) => void`, `onAddOvertime: () => void`, `sportTheme: SportTheme`
   - Renders a segmented control: `[1st Half] [2nd Half] [+ OT]`
   - Active period highlighted with sport theme color
   - `+ OT` adds a new period (increments period count in local component state; dispatches `SET_PERIOD` with new number)
   - Period labels are config-driven via `resolveTeamStatsConfig` (season JSON + defaults)

3. **`src/pages/GameTracker.tsx`** — Show `PeriodToggle` between player selector and stat grid, but only when `activePlayer.isTeamPlayer === true`.

4. **`src/pages/GameTracker.tsx`** — Period state: dispatch `SET_PERIOD` when toggle changes. The `currentPeriod` from `state` drives which stat IDs are active.

**Files touched:** `src/pages/GameTracker.tsx`, new `src/components/team-stats/PeriodToggle.tsx`

**Test breakpoint:**
- Select home team player → stat grid shows "Team Foul", "Timeout", "Technical", "Turnover" (not scoring/rebounds/etc.)
- Tap "Team Foul" → counter increments; stat ID in action log is `team_foul_p1`
- Switch to "2nd Half" → foul counter resets to 0; tap again → `team_foul_p2` increments
- Switch back to "1st Half" → original count is still there
- Game total subtitle shows sum across both halves
- Select an individual player → normal stat grid returns; period toggle disappears
- Undo works for team stats

**Commit message:** `feat: render team stat categories with period toggle when team player active`

---

### WU-5: Basketball Bonus Indicators

**Design docs:** [BASKETBALL §3, §3.3, §3.4](DESIGN_TEAM_STATS_BASKETBALL.md)

**Depends on:** WU-4 (team stat tracking works, fouls can be recorded per period)

**Blocks:** WU-9

**What to do:**

1. **New: `src/components/team-stats/BasketballBonusIndicator.tsx`**:
   - Props: `foulCount: number`, `bonusThreshold: number`, `doubleBonusThreshold: number`, `hasOneAndOne: boolean`
   - Implements `getBonusStatus()` logic from [BASKETBALL §3.3](DESIGN_TEAM_STATS_BASKETBALL.md)
   - Renders:
     - Nothing if `none`
     - Amber banner with `⚠️ 1-AND-1` if `one_and_one`
     - Red banner with `🔴 DOUBLE BONUS` if `double_bonus`
   - Shows "approaching" hint when within 2 fouls of a threshold
   - Uses Tailwind classes consistent with the app's design (rounded-xl, shadow, etc.)

2. **`src/pages/GameTracker.tsx`** — When team player is active and sport is `basketball`:
   - Read current period's foul count from `activePlayer.stats[team_foul_p${currentPeriod}]`
   - Render `BasketballBonusIndicator` between the period toggle and the stat grid
   - Pass thresholds from `resolveTeamStatsConfig(sport, state.teamStatsConfig)`

**Files touched:** new `src/components/team-stats/BasketballBonusIndicator.tsx`, `src/pages/GameTracker.tsx`

**Test breakpoint:**
- Select home team → record 5 fouls → see "2 fouls from 1-and-1" hint
- Record 7th foul → amber `⚠️ 1-AND-1` banner appears
- Record 10th foul → red `🔴 DOUBLE BONUS` banner replaces 1-and-1
- Switch to 2nd Half → no banner (0 fouls in this period)
- Record fouls in 2nd half → bonus indicators work independently per period
- Select opponent team → bonus indicator works for opponent's fouls too
- Undo a foul → banner updates accordingly

**Commit message:** `feat: add basketball bonus indicator (1-and-1, double bonus) for team fouls`

---

### WU-6: Database Migration

**Design docs:** [DATA_MODEL §2, §4, §6](DESIGN_TEAM_STATS_DATA_MODEL.md) · [SEASON_CONFIG §4.2](DESIGN_TEAM_STATS_SEASON_CONFIG.md)

**Depends on:** Nothing (schema is independent of app code)

**Blocks:** WU-8, WU-10

**What to do (shipped across 027–031):**

1. **Migrations in repo** — `027_home_team_score.sql` through `031_get_game_team_stats.sql` for team stats placeholders, `games` FKs, `seasons.team_stats_config`, display views, `get_game_team_stats`, and aggregate RPC filters. **`get_game_stats_resolved`** was not given a new return shape (Postgres limitation); clients join `players` or use `get_game_team_stats` for placeholder-only stats. **`032_shot_chart.sql`** adds per-game shot persistence (see shot chart design docs). **`033_client_sync_errors.sql`** is unrelated to team stats (client-reported snapshot failures).

2. **Original single-file sketch** — [DATA_MODEL §6.1](DESIGN_TEAM_STATS_DATA_MODEL.md) listed one migration; the repo split this for safer rollout.

3. **Validate against existing RPCs** — When adding filters, read current definitions in `010`, `020`, `028`, etc.

**Files touched:** `supabase/migrations/027_*.sql` through `031_*.sql` (as in repo).

**Test breakpoint:**
- Migrations apply cleanly to Supabase (or local Supabase instance)
- Existing RPCs still return correct results for games with no team stats
- `get_game_team_stats` returns empty for existing games (no team placeholders yet)
- `players_display` view includes `is_team_placeholder` column

**Commit message:** `feat: add team stats database schema (migration 027)`

---

### WU-7: Season Config Types & Resolution Helper

**Design docs:** [SEASON_CONFIG §4.3, §4.4, §6.1](DESIGN_TEAM_STATS_SEASON_CONFIG.md)

**Depends on:** WU-1 (types defined — `BasketballTeamStatsConfig` exists in types.ts)

**Blocks:** WU-8, WU-9

**What to do:**

1. **`src/config/teamStatsDefaults.ts`** (new file) or add to `sports.ts`:
   - Export `BASKETBALL_TEAM_STATS_DEFAULTS: BasketballTeamStatsConfig`
   - Export `BASKETBALL_PRESETS` — array of named presets (NFHS, NCAA, NBA, FIBA, Youth Rec Halves, Youth Rec Quarters) with their config values
   - Export `resolveTeamStatsConfig(sportId: string, seasonConfig: Record<string, unknown> | null): TeamStatsConfig` — merges season JSON with sport defaults, with validation
   - Export `getDefaultPeriodLabels(periodsPerGame: number): string[]` — generates `['1st Half', '2nd Half']` for 2 or `['Q1', 'Q2', 'Q3', 'Q4']` for 4

2. **`src/pages/GameSetup.tsx`** — When a season is selected (cloud flow), fetch the season's `team_stats_config` from the season row (already loaded via the existing season query). Dispatch `SET_CLOUD_SYNC_STATE` or a new action to store the config in `state.teamStatsConfig`.

3. **`src/context/GameContext.tsx`** — Ensure `teamStatsConfig` is included in the sync fingerprint if relevant, and persisted/restored in `loadState`.

**Files touched:** new `src/config/teamStatsDefaults.ts`, `src/pages/GameSetup.tsx`, `src/context/GameContext.tsx`

**Test breakpoint:**
- `pnpm build` passes
- `resolveTeamStatsConfig('basketball', null)` returns the NFHS defaults
- `resolveTeamStatsConfig('basketball', { periodsPerGame: 4, hasOneAndOne: false })` returns NBA-style config
- Start a game with a cloud season → `state.teamStatsConfig` is populated (or null if season has no config yet)

**Commit message:** `feat: add season config types, defaults, presets, and resolution helper`

---

### WU-8: Season Config UI

**Design docs:** [SEASON_CONFIG §5](DESIGN_TEAM_STATS_SEASON_CONFIG.md)

**Depends on:** WU-6 (schema — `team_stats_config` column exists), WU-7 (types and presets defined)

**Blocks:** WU-9 (indirectly — can't fully test config-driven components without a way to set config)

**What to do:**

1. **Shipped as Admin Seasons panel** — Use `SeasonTeamStatsEditor` from **`src/pages/Admin.tsx`** (expand Seasons → basketball season → team stat rules). The standalone **`src/pages/SeasonSettings.tsx`** route described here was **not** added.

2. **Original sketch (historical):** `SeasonSettings.tsx` season configuration screen:
   - Load the season's current `team_stats_config` from Supabase
   - Preset dropdown (NFHS, NCAA, NBA, FIBA, Youth Rec, Custom)
   - Selecting a preset fills form fields; editing any field switches to "Custom"
   - Form fields (see [SEASON_CONFIG §5.2](DESIGN_TEAM_STATS_SEASON_CONFIG.md)):
     - Period structure: segmented control [2 Halves / 4 Quarters]
     - 1-and-1 enabled: [Yes / No]
     - Bonus threshold: number input
     - Double bonus threshold: number input
     - OT fouls reset: [Yes / No]
     - Timeouts per game: number input (blank = unlimited)
   - Validation rules from [SEASON_CONFIG §5.4](DESIGN_TEAM_STATS_SEASON_CONFIG.md)
   - Save button → upsert `seasons.team_stats_config`
   - Toast or inline confirmation on save

3. **`src/App.tsx`** — Route `/season-settings` was **not** added (use Admin instead).

4. **Navigation** — Team stat rules are reached from **Settings → Seasons**, not from Teams/Game Setup as originally sketched.

**Files touched (actual):** `src/components/SeasonTeamStatsEditor.tsx`, `src/pages/Admin.tsx`

**Test breakpoint:**
- **Settings (Admin) → Seasons** → expand basketball season → open team stat rules
- Select "NBA" preset → fields show: 4 quarters, no 1-and-1, bonus at 5
- Save → reload → config persists on the season row
- *(Optional / future: strict validation double bonus < bonus is not necessarily enforced in UI.)*

**Commit message:** `feat: add Season Settings UI for team stat rules (presets, bonus config)`

---

### WU-9: Config-Driven Bonus & Period Components

**Design docs:** [BASKETBALL §3.2, §3.3](DESIGN_TEAM_STATS_BASKETBALL.md) · [SEASON_CONFIG §6](DESIGN_TEAM_STATS_SEASON_CONFIG.md)

**Depends on:** WU-5 (bonus indicator exists with hardcoded defaults), WU-7 (config resolution exists), WU-8 (UI to set config exists — needed for full testing)

**Blocks:** Nothing — this is an integration/polish step.

**What to do:**

1. **`src/pages/GameTracker.tsx`** — Replace hardcoded bonus thresholds with values from `resolveTeamStatsConfig`:
   - Read `state.teamStatsConfig` from game context
   - Call `resolveTeamStatsConfig(sport.id, state.teamStatsConfig)` to get resolved config
   - Pass resolved thresholds to `BasketballBonusIndicator`
   - Pass resolved `periodsPerGame` and `periodLabels` to `PeriodToggle`

2. **`src/components/team-stats/BasketballBonusIndicator.tsx`** — Should already accept props for thresholds (done in WU-5). Verify `hasOneAndOne: false` path works (NBA-style: straight to "BONUS" at threshold, no 1-and-1 banner).

3. **`src/components/team-stats/PeriodToggle.tsx`** — Should already accept `periods` and `periodLabels` props (done in WU-4). Verify 4-quarter layout looks good. Verify custom labels render correctly.

**Files touched:** `src/pages/GameTracker.tsx`, minor tweaks to `BasketballBonusIndicator.tsx` and `PeriodToggle.tsx` if needed

**Test breakpoint:**
- Set season to NBA preset → start game:
  - Period toggle shows Q1, Q2, Q3, Q4
  - 5th foul shows "BONUS" (no 1-and-1)
- Set season to NFHS preset → start game:
  - Period toggle shows 1st Half, 2nd Half
  - 7th foul shows 1-AND-1, 10th shows DOUBLE BONUS
- No season config set → defaults apply (NFHS behavior)

**Commit message:** `feat: wire season config into bonus indicator and period toggle`

---

### WU-10: Cloud Sync for Team Pseudo-Players

**Design docs:** [DATA_MODEL §3](DESIGN_TEAM_STATS_DATA_MODEL.md) · [TRACKING §2.5](DESIGN_TEAM_STATS_TRACKING.md)

**Depends on:** WU-6 (migration applied — schema exists), WU-1 (types — `isTeamPlayer` flag)

**Blocks:** WU-11

**What to do:**

1. **`src/lib/cloudSync.ts`** — In `syncGameSnapshotToCloud`:
   - After ensuring the game exists, iterate over players in the snapshot
   - For each player with `isTeamPlayer === true`:
     a. Check if `games.home_team_player_id` (or `opp_team_player_id`) is already set for this game
     b. If set, use that cloud player ID
     c. If not, create a new `players` row with `is_team_placeholder = true`, `first_name = player.name`
     d. Update `games.home_team_player_id` / `games.opp_team_player_id`
     e. Add to `playerIdMap`: `playerIdMap['__team_home__'] = cloudPlayerId`
   - Skip `team_players` roster entry for team pseudo-players
   - Upsert `game_stats` for team pseudo-players identically to regular players

2. **`src/lib/cloudSync.ts`** — In `loadLatestCloudGame` / `loadCloudGameById`:
   - After loading the game row, check `home_team_player_id` and `opp_team_player_id`
   - If set, load those players' names and stats from `game_stats`
   - Include them in the returned players array as `{ ...playerData, isTeamPlayer: true, teamSide: 'home'|'opponent' }`
   - Map to local deterministic IDs (`__team_home__`, `__team_opp__`)

3. **`src/lib/cloudSync.ts`** — In `ensurePlayerId` (or equivalent), add early return for `isTeamPlayer` players to prevent `team_players` roster creation.

**Files touched:** `src/lib/cloudSync.ts`

**Test breakpoint:**
- Start a cloud game with team stats enabled
- Record some team fouls and timeouts
- Verify in Supabase DB:
  - `players` table has 2 new rows with `is_team_placeholder = true`
  - `games` row has `home_team_player_id` and `opp_team_player_id` set
  - `game_stats` has rows for team placeholder player IDs with stat_ids like `team_foul_p1`
  - `team_players` has NO rows for team placeholders
- Close and reopen the game → team stats are restored from cloud
- Check leaderboard → team placeholders do NOT appear

**Commit message:** `feat: sync team pseudo-player stats to cloud via game_stats`

---

### WU-11: Checkout Integration

**Design docs:** [TRACKING §4.2](DESIGN_TEAM_STATS_TRACKING.md)

**Depends on:** WU-10 (cloud sync — team pseudo-players have cloud IDs), WU-3 (team players exist in player list)

**Blocks:** Nothing.

**What to do:**

1. **`src/pages/GameCheckout.tsx`**:
   - Separate team pseudo-players from individual players in the render
   - Render team players at the top with distinct visual:
     - `★` icon instead of jersey number circle
     - "(Team Stats)" suffix on the name
     - Slightly different card style (e.g., dashed border or gradient background)
   - Add a thin divider between team players and individual players
   - Team players are NOT auto-checked-out (same opt-in as individuals)
   - Checkout toggle works identically to individual players

**Files touched:** `src/pages/GameCheckout.tsx`

**Test breakpoint:**
- Start a cloud game → navigate to checkout screen
- See team players at the top: `★ Champlin Rebels (Team Stats)`, `★ Osseo Brawlers (Team Stats)`
- Divider separates them from individual players
- Check out a team player → proceeds to game → team player is available in tracker
- Don't check out team players → proceed to game → team players are still injected locally (checkout is about who's "primary" in multi-parent, not about visibility)

**Commit message:** `feat: show team pseudo-players in checkout with distinct visual and opt-in`

---

### WU-12: Game Summary — Team Stats Section

**Design docs:** [TRACKING §4.3](DESIGN_TEAM_STATS_TRACKING.md) · [BASKETBALL §6](DESIGN_TEAM_STATS_BASKETBALL.md)

**Depends on:** WU-4 (team stats can be recorded with period scoping)

**Blocks:** Nothing.

**What to do:**

1. **New: `src/components/team-stats/TeamStatSummary.tsx`**:
   - Props: `homeTeamPlayer: Player | undefined`, `oppTeamPlayer: Player | undefined`, `config: TeamStatsConfig`, `sport: SportConfig`
   - Renders per-period foul table (see [BASKETBALL §6.1](DESIGN_TEAM_STATS_BASKETBALL.md)):
     - Columns: Period, Home Team, Opponent Team
     - Rows: one per period + Total row
   - Renders other team stats (timeouts, techs, turnovers) in a comparison table
   - Renders bonus event log (derived from foul counts + config)
   - Handles "Not tracked" when one side has no stats

2. **`src/pages/GameSummary.tsx`**:
   - Find team pseudo-players in the players array
   - If any team stats exist, add a "Team Stats" tab (alongside existing "Players" / "Team" tabs)
   - The "Team Stats" tab renders `TeamStatSummary`
   - For cloud (finalized) games: use `get_game_team_stats` RPC if available, else derive from local state

**Files touched:** new `src/components/team-stats/TeamStatSummary.tsx`, `src/pages/GameSummary.tsx`

**Test breakpoint:**
- Play a full game tracking team stats for both teams across 2 halves
- Navigate to Summary → see "Team Stats" tab
- Tab shows per-period foul table with correct counts
- Bonus events listed (e.g., "Rebels: 1-and-1 in 1st Half")
- Timeout/tech/turnover comparison table
- If only one team was tracked, the other column shows "Not tracked"

**Commit message:** `feat: add Team Stats section to Game Summary with foul table and bonus events`

---

## 3. Parallel Agent Strategy

The work units above can be distributed across multiple agents working in parallel. Below is the recommended phasing — each phase is a set of work units that can run concurrently, with a sync point (merge + test) between phases.

### Phase 1: Foundation (1 agent, blocks everything)

| Agent | Work Unit | Estimated Scope |
|-------|-----------|----------------|
| **Agent A** | **WU-1** Foundation Types & Config | 3 files, type additions + config |

**Sync point:** Merge WU-1 to branch. Verify `pnpm build && pnpm lint`. No visual changes.

---

### Phase 2: Core Feature + Backend (3 agents in parallel)

| Agent | Work Units | Estimated Scope |
|-------|------------|----------------|
| **Agent A** | **WU-3** Injection + Selector UI → **WU-4** Category Switching + Period Toggle | GameTracker changes, new PeriodToggle component |
| **Agent B** | **WU-6** DB Migration + **WU-7** Season Config Types | Migration file, new config helper, GameSetup wiring |
| **Agent C** | **WU-2** Filtering Guard Rails | Small changes across 5 files |

**Why parallel:** Agent A works on frontend game tracker; Agent B works on backend schema + config types; Agent C does small filter additions. No file conflicts.

**Sync point:** Merge all three. Verify:
- `pnpm build && pnpm lint`
- Basketball game: team players appear, stat switching works, period toggle works
- Existing player tracking is unaffected
- Migration applies cleanly

---

### Phase 3: Indicators + Cloud + Config UI (3 agents in parallel)

| Agent | Work Units | Estimated Scope |
|-------|------------|----------------|
| **Agent A** | **WU-5** Bonus Indicators + **WU-12** Game Summary | 2 new components + GameSummary changes |
| **Agent B** | **WU-10** Cloud Sync + **WU-11** Checkout | cloudSync.ts changes + GameCheckout changes |
| **Agent C** | **WU-8** Season Config UI | New SeasonSettings page, route, nav link |

**Why parallel:** Agent A builds frontend indicator + summary (pure UI); Agent B handles cloud data flow; Agent C builds a standalone settings page. Minimal file overlap.

**Sync point:** Merge all three. Verify:
- Bonus indicator shows at 7 and 10 fouls
- Cloud sync persists team stats; reload restores them
- Checkout shows team players; opt-in works
- Season Settings page loads, presets work, saves to cloud
- Game Summary shows team stats tab

---

### Phase 4: Integration (1 agent)

| Agent | Work Unit | Estimated Scope |
|-------|-----------|----------------|
| **Agent A** | **WU-9** Config-Driven Components | Wire config into existing components |

**Why single agent:** This connects all the pieces — config UI (WU-8) to bonus indicator (WU-5) to period toggle (WU-4). Touching files from multiple prior WUs, so conflicts are more likely with parallel work.

**Final verification:**
- End-to-end: Set NBA rules in season config → start game → 4 quarters, bonus at 5th foul, no 1-and-1
- End-to-end: NFHS rules → 2 halves, 1-and-1 at 7, double bonus at 10
- End-to-end: No config set → defaults apply correctly
- Cloud round-trip: save game → reload → config + stats preserved
- Summary shows correct bonus events based on season config

---

## 4. Phase/WU Quick Reference

| Phase | WU | Name | Depends On | Agent Slot |
|-------|-----|------|------------|------------|
| 1 | WU-1 | Foundation Types & Config | — | A (solo) |
| 2 | WU-2 | Filtering Guard Rails | WU-1 | C |
| 2 | WU-3 | Injection + Selector UI | WU-1 | A |
| 2 | WU-4 | Category Switching + Period Toggle | WU-3 | A (continued) |
| 2 | WU-6 | Database Migration | — | B |
| 2 | WU-7 | Season Config Types & Resolution | WU-1 | B (continued) |
| 3 | WU-5 | Bonus Indicators | WU-4 | A |
| 3 | WU-8 | Season Config UI | WU-6, WU-7 | C |
| 3 | WU-10 | Cloud Sync | WU-6, WU-1 | B |
| 3 | WU-11 | Checkout Integration | WU-10, WU-3 | B (continued) |
| 3 | WU-12 | Game Summary Team Stats | WU-4 | A (continued) |
| 4 | WU-9 | Config-Driven Components | WU-5, WU-7, WU-8 | A (solo) |

---

## 5. Testing Strategy Per Phase

### Phase 1 Test Checklist
- [ ] `pnpm build` — zero errors
- [ ] `pnpm lint` — zero new warnings
- [ ] Manual: start a basketball game → plays normally, no visual changes

### Phase 2 Test Checklist
- [ ] `pnpm build` + `pnpm lint` clean
- [ ] Manual: basketball game → `★ TeamName` and `★ OpponentName` buttons appear left of player buttons
- [ ] Manual: tap team button → team stat categories render (Foul, Timeout, Technical, Turnover)
- [ ] Manual: tap Foul → count increments; switch to 2nd Half → count is 0; switch back → original count
- [ ] Manual: tap individual player → normal stat categories return
- [ ] Manual: scoreboard score is unaffected by team player stats
- [ ] Manual: start baseball game → no team buttons
- [ ] Migration `027` applies to Supabase without errors
- [ ] Existing RPCs return correct data

### Phase 3 Test Checklist
- [ ] Manual: record 7 team fouls → `⚠️ 1-AND-1` banner appears
- [ ] Manual: record 10 → `🔴 DOUBLE BONUS` banner appears
- [ ] Manual: undo foul → banner updates
- [ ] Cloud: start cloud game → record team stats → check DB for `is_team_placeholder` players + `game_stats` rows
- [ ] Cloud: close and reopen game → team stats restored from cloud
- [ ] Checkout: cloud game checkout → team players visible at top with opt-in
- [ ] Season Settings: navigate → select preset → save → reload → config persists
- [ ] Game Summary: finish game → "Team Stats" tab shows foul table + bonus events

### Phase 4 Test Checklist
- [ ] Set NBA preset → start game → 4 quarters, bonus at 5, no 1-and-1
- [ ] Set NFHS preset → start game → 2 halves, 1-and-1 at 7, double bonus at 10
- [ ] No config → defaults (NFHS) apply
- [ ] Full round-trip: set config → play game → finalize → summary → leaderboard (no team player pollution)

---

## 6. Risk Checkpoints

After each phase merge, verify these invariants:

| Invariant | How to Check |
|-----------|-------------|
| Existing player tracking works | Play a full game without touching team stats; verify scoreboard, summary, undo |
| No type errors | `pnpm build` |
| No lint errors | `pnpm lint` |
| Team players excluded from score | Scoreboard shows correct score even with team stats recorded |
| Team players excluded from leaderboard | Season leaderboard shows only real players |
| Cloud sync stable | Start a cloud game, track stats, close, reopen — all stats preserved |
| localStorage doesn't break | Close browser, reopen — game state restored (including team stats and period) |

---

## 7. Notes for Implementing Agents

1. **Read the design docs first.** Each work unit references specific sections. The design docs contain UI mockups, data shapes, and edge cases that are not repeated here.

2. **Deterministic IDs.** Team pseudo-players always use `__team_home__` and `__team_opp__` as local IDs. These are constants — define them once and import everywhere.

3. **Feature flag potential.** If you want to land WU-1 without any user-visible changes, consider gating team player injection behind a check for `sport.teamCategories?.length > 0`. This is already the design — sports without `teamCategories` get no team players.

4. **Don't break the existing flow.** The most important invariant is that existing player-level stat tracking works identically. Every WU's test checklist starts with "existing flow still works."

5. **`src/components/team-stats/`** — Present in repo (`PeriodToggle`, `BasketballBonusIndicator`, `TeamStatSummary`, …).

6. **Migration numbering** — Team stats land in **`027`–`031`** alongside `027_home_team_score.sql` (standalone home score). Apply all listed files in order.

7. **Cloud sync** — Team placeholders are handled in **`cloudSync.ts`** (`ensureTeamPlaceholderPlayer`, `linkGameTeamPlaceholderIds`, hydrate merge).

8. **Tailwind classes.** The app uses Tailwind 3 with a mobile-first approach. New components should match the existing design language: `rounded-xl`, `shadow-md`, `card` utility class, sport theme colors via `sport.theme.*`.

---

*Document version: 0.2 — marked shipped; Admin vs SeasonSettings; migration file names aligned to repo.*
