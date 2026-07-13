# Design: Season-Level Configuration for Team Stats

Season-level configuration for team stat rules: timeout limits, bonus thresholds, period structure, and other sport-specific settings that vary by league, age group, or governing body.

**Parent doc:** [DESIGN_TEAM_STATS_TRACKING.md](DESIGN_TEAM_STATS_TRACKING.md)

**Status:** **Implemented** — rules are edited under **Settings -> Data & Sync -> Seasons** for basketball seasons (`team_stats_config` JSON). There is no separate `/season-settings` route.

---

## 1. Problem

Youth basketball in Minnesota plays by different rules than an NBA pickup league. A 3rd-grade rec league might use 6-minute quarters with no 1-and-1, while a high school JV game uses 18-minute halves with standard NFHS bonus rules. The same StatKeeper user may coach both leagues across different seasons.

Team stat features (bonus indicators, timeout counters, period structure) need to adapt to these differences. Hard-coding one ruleset doesn't work. The solution: **season-level configuration** that lets each season define its own rules.

---

## 2. What Gets Configured

### 2.1 Basketball Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `periodsPerGame` | number | `2` | Number of regulation periods (2 = halves, 4 = quarters) |
| `periodLabels` | string[] | `['1st Half', '2nd Half']` | Display labels for each period |
| `bonusThreshold` | number | `7` | Foul count that triggers 1-and-1 (or straight bonus if no 1-and-1) |
| `doubleBonusThreshold` | number | `10` | Foul count that triggers double bonus |
| `hasOneAndOne` | boolean | `true` | Whether 1-and-1 exists (false for NBA/FIBA) |
| `timeoutsPerGame` | number \| null | `null` | Total timeouts allowed per game. `null` = no limit displayed (counter only) |
| `timeoutsPerHalf` | number \| null | `null` | Timeouts allowed per half. `null` = not tracked per half |
| `overtimeFoulsReset` | boolean | `true` | Whether team fouls reset each OT period |

### 2.2 Future: Other Sports

Each sport will have its own config shape. Examples:

**Football:**
| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `timeoutsPerHalf` | number | `3` | Timeouts per half |
| `challengesPerGame` | number | `2` | Coach's challenges |

**Hockey:**
| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `periodsPerGame` | number | `3` | Standard 3 periods |
| `penaltyMinorMinutes` | number | `2` | Minor penalty duration |

These are placeholders — each sport's design doc will define its config when team stats are added for that sport.

---

## 3. Configuration Scope: Why Season Level?

| Scope Level | Pros | Cons |
|-------------|------|------|
| **Global app setting** | Simple | Can't handle multiple leagues |
| **Per-game** | Maximum flexibility | Tedious — coach sets rules every game |
| **Per-season** ✅ | Set once, applies to all games in the season; supports multiple concurrent leagues | Requires season config UI |
| **Per-team** | Slightly more granular than season | Redundant — a team is already 1:1 with a season |

**Decision:** Season level. A season represents one league/program with consistent rules. If a coach has two kids in different leagues, they create two seasons with different configs.

---

## 4. Data Model

### 4.1 Where to Store Config

**Option A: Column on `seasons` table** — Add a `config` JSONB column to the existing `seasons` table.

**Option B: Separate `season_config` table** — A dedicated table with a 1:1 FK to `seasons`.

**Recommendation: Option A** — simpler, fewer joins, and the config is small enough to live inline. The JSONB column is flexible for per-sport differences.

### 4.2 Schema Change

```sql
ALTER TABLE seasons
  ADD COLUMN IF NOT EXISTS team_stats_config jsonb
  DEFAULT '{}'::jsonb;
```

The column stores a sport-specific JSON object. The app validates the shape client-side based on the season's sport.

### 4.3 TypeScript Types

```typescript
interface BasketballTeamStatsConfig {
  periodsPerGame: number
  periodLabels: string[]
  bonusThreshold: number
  doubleBonusThreshold: number
  hasOneAndOne: boolean
  timeoutsPerGame: number | null
  timeoutsPerHalf: number | null
  overtimeFoulsReset: boolean
}

// Union type for all sports' configs:
type TeamStatsConfig = BasketballTeamStatsConfig
  // | FootballTeamStatsConfig
  // | HockeyTeamStatsConfig
  // | etc.

// Default configs per sport:
const BASKETBALL_DEFAULTS: BasketballTeamStatsConfig = {
  periodsPerGame: 2,
  periodLabels: ['1st Half', '2nd Half'],
  bonusThreshold: 7,
  doubleBonusThreshold: 10,
  hasOneAndOne: true,
  timeoutsPerGame: null,
  timeoutsPerHalf: null,
  overtimeFoulsReset: true,
}
```

### 4.4 Config Resolution at Game Time

When a game starts, the app resolves the team stats config:

1. Load the season's `team_stats_config` from the cloud (or local state for offline games).
2. Merge with sport-specific defaults: `{ ...BASKETBALL_DEFAULTS, ...seasonConfig }`.
3. Pass the resolved config to the bonus indicator, period toggle, and timeout counter components.

For **offline / non-cloud games**, the default config applies unless the user has set season-level config beforehand.

---

## 5. Season Config UI

### 5.1 Entry Point

The season config screen is accessible from:

1. **Teams page** → Season section → "Season Settings" or gear icon.
2. **Settings -> Data & Sync** → Under the season management section.
3. **Game Setup** → Small "League Rules" link below the season/team selector (for quick access).

### 5.2 Screen Layout

```
┌──────────────────────────────────────────────┐
│  ← Season Settings                           │
│  Spring League 2026 · Basketball             │
├──────────────────────────────────────────────┤
│                                              │
│  LEAGUE RULES                                │
│                                              │
│  Preset                                      │
│  ┌──────────────────────────────────────┐   │
│  │ NFHS / High School (default)    ▾   │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  ── Period Structure ────────────────────── │
│                                              │
│  Periods per game                            │
│  ┌────────────────────────────────┐         │
│  │  [ 2 Halves ]  [ 4 Quarters ] │         │  ← segmented control
│  └────────────────────────────────┘         │
│                                              │
│  ── Bonus Rules ────────────────────────── │
│                                              │
│  1-and-1 enabled                             │
│  ┌────────────────────────────────┐         │
│  │  [ Yes ]  [ No ]              │         │
│  └────────────────────────────────┘         │
│                                              │
│  1-and-1 threshold (fouls per period)        │
│  ┌──────────┐                               │
│  │    7     │  ← number input               │
│  └──────────┘                               │
│                                              │
│  Double bonus threshold                      │
│  ┌──────────┐                               │
│  │   10     │                               │
│  └──────────┘                               │
│                                              │
│  OT fouls reset each period                  │
│  ┌────────────────────────────────┐         │
│  │  [ Yes ]  [ No ]              │         │
│  └────────────────────────────────┘         │
│                                              │
│  ── Timeouts ───────────────────────────── │
│                                              │
│  Timeouts per game                           │
│  ┌──────────┐                               │
│  │   —      │  (blank = unlimited/counter)  │
│  └──────────┘                               │
│                                              │
│  ┌──────────────────────┐                   │
│  │     Save Settings    │                   │
│  └──────────────────────┘                   │
│                                              │
└──────────────────────────────────────────────┘
```

### 5.3 Presets

Presets provide one-tap configuration for common rulesets:

| Preset Name | Periods | 1-and-1 | Bonus | Double Bonus | Timeouts |
|-------------|---------|---------|-------|-------------|----------|
| **NFHS / High School** | 2 halves | Yes | 7 | 10 | — |
| **NCAA / College** | 2 halves | Yes | 7 | 10 | — |
| **NBA** | 4 quarters | No | 5 | 5 | — |
| **FIBA** | 4 quarters | No | 5 | 5 | — |
| **Youth Rec (halves)** | 2 halves | Yes | 7 | 10 | — |
| **Youth Rec (quarters)** | 4 quarters | Yes | 5 | 7 | — |
| **Custom** | — | — | — | — | — |

Selecting a preset fills in the form fields. The user can then customize any field, which switches the preset to "Custom." Saving stores the full config regardless of whether it matches a preset.

### 5.4 Validation Rules

| Rule | Error message |
|------|---------------|
| `periodsPerGame` must be 2 or 4 | "Periods must be 2 (halves) or 4 (quarters)" |
| `bonusThreshold` must be ≥ 1 | "Bonus threshold must be at least 1" |
| `doubleBonusThreshold` ≥ `bonusThreshold` | "Double bonus threshold must be ≥ bonus threshold" |
| `timeoutsPerGame` must be ≥ 1 if set | "Timeout limit must be at least 1" |

---

## 6. How Config Flows to Game Tracker

```
Season (cloud)                          Game Tracker
  │                                       │
  │  team_stats_config (JSONB)           │
  │  ─────────────────────────           │
  ▼                                       │
GameSetup                                 │
  │  loads season config                  │
  │  stores in GameState or               │
  │  passes via context                   │
  ▼                                       ▼
GameContext                            Components
  │  resolvedTeamStatsConfig:           │
  │    merged defaults + season         │
  │                                     ▼
  │                              BasketballBonusIndicator
  │                                reads bonusThreshold,
  │                                doubleBonusThreshold,
  │                                hasOneAndOne
  │                                     │
  │                              PeriodToggle
  │                                reads periodsPerGame,
  │                                periodLabels
  │                                     │
  │                              Timeout display
  │                                reads timeoutsPerGame
```

### 6.1 Storing Config in GameState

Two options:

**Option A: Inline in GameState** — Add `teamStatsConfig: TeamStatsConfig | null` to `GameState`. Set when loading a cloud season's config during game setup. Persisted to localStorage with the rest of the game state.

**Option B: Separate context** — A `TeamStatsConfigContext` that loads config independently.

**Recommendation: Option A** — keeps config co-located with the game. When a game is resumed from cloud or localStorage, the config comes with it. No extra fetch needed.

```typescript
interface GameState {
  // ... existing ...
  currentPeriod: number
  teamStatsConfig: TeamStatsConfig | null  // null = use defaults
}
```

### 6.2 Offline Games

For offline (non-cloud) games, `teamStatsConfig` is `null` and defaults apply. If the user later connects to cloud and syncs, the season config is loaded and applied going forward.

---

## 7. Implementation Phases

| Phase | What | Dependencies |
|-------|------|-------------|
| **1. Schema** | Add `team_stats_config` JSONB column to `seasons` table (migration) | None |
| **2. Types & Defaults** | Define `BasketballTeamStatsConfig` type; export defaults; add `teamStatsConfig` to `GameState` | Phase 1 |
| **3. Config UI** | Season settings screen with preset selector, form fields, validation, save | Phase 1–2 |
| **4. Config Loading** | Load season config in GameSetup → store in GameState → pass to components | Phase 2–3 |
| **5. Component Integration** | Bonus indicator, period toggle, timeout counter read from resolved config | Phase 4, basketball team stats phases |

### Ordering with Main Feature Phases

Season config (this doc's phases 1–4) should be completed **before** the bonus indicator (main doc Phase 4) and **before** the timeout countdown display. The period toggle (main doc Phase 3) can use defaults initially and adopt season config when it's ready.

---

## 8. Breadcrumbs for Implementing Agent

| Task | Files | Notes |
|------|-------|-------|
| Add migration for `team_stats_config` | `supabase/migrations/0XX_team_stats_config.sql` | Single `ALTER TABLE seasons ADD COLUMN` |
| Define TypeScript types | `src/types.ts` | `BasketballTeamStatsConfig`, `TeamStatsConfig` union, default constants |
| Add to GameState | `src/types.ts`, `src/context/GameContext.tsx` | `teamStatsConfig` field, include in `loadState`, persistence, `createInitialState` |
| Load config in game setup | `src/pages/GameSetup.tsx` | When season is selected, fetch `team_stats_config` from season row; dispatch to GameState |
| Season config UI | New: `src/pages/SeasonSettings.tsx` (or section in `Teams.tsx`) | Form with presets, validation, save to Supabase |
| Route | `src/App.tsx` | Add `/season-settings` route (or modal from Teams page) |
| Config resolution helper | `src/config/teamStatsDefaults.ts` or in `sports.ts` | `resolveTeamStatsConfig(sport, seasonConfig)` → merged config |
| Bonus indicator reads config | `src/components/team-stats/BasketballBonusIndicator.tsx` | Props: `foulCount`, `config` |
| Period toggle reads config | `src/components/team-stats/PeriodToggle.tsx` | Props: `periodsPerGame`, `periodLabels`, `currentPeriod`, `onPeriodChange` |

---

## 9. Open Questions

| # | Question | Recommendation | Status |
|---|----------|---------------|--------|
| 1 | Should config be editable mid-season? | Yes — a coach might realize they set the wrong rules after a few games. Past games' summaries recalculate bonus events using the updated config. | Decided: yes |
| 2 | Should config be copyable between seasons? | Nice to have. "Copy settings from: [previous season]" on the config screen. | Deferred to v2 |
| 3 | Should the config screen live at its own route or be a section/modal within Teams? | Either works. A separate route (`/season-settings?seasonId=`) is cleaner for deep linking. Could also be a modal triggered from Teams. | Open — defer to implementer |
| 4 | Should we support per-game config overrides? | No for v1. All games in a season use the same rules. If a tournament has different rules, the coach can create a separate season. | Decided: no (v1) |
| 5 | How do period labels work for 4-quarter setups? | Auto-generate: `['Q1', 'Q2', 'Q3', 'Q4']` when `periodsPerGame` is 4. Allow custom labels via `periodLabels` override. | Decided |

---

*Document version: 0.1 (design phase)*
