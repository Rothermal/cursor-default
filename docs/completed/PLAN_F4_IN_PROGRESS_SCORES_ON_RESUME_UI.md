# Feature 4 Plan: In-Progress Scores on the Resume Game UI

> **For agentic workers:** Design + implementation plan. Steps use checkbox (`- [ ]`)
> syntax. See [DESIGN_SHOT_TRACKER_UI_REVAMP.md](../DESIGN_SHOT_TRACKER_UI_REVAMP.md) for
> shared context. **Independent** of F1–F3 — can land in any order.

**Goal:** Show the current score on the "resume game" surfaces so a user can tell the
state of a game before reopening it — both the home active-game card and the Cloud
Games list's in-progress entries.

**Architecture:** Two surfaces. (1) `SportSelect` active-game card uses local
`GameState` and the existing `getDisplayedHomeScore()` to render a live score. (2)
`Games.tsx` extends its score-line loader (today final-only) to in-progress games,
preferring the `games` row snapshot (`home_team_score` / `opponent_score`) and falling
back to a stats aggregate when `home_team_score` is null.

**Tech Stack:** React + TypeScript, existing `gameScore.ts` helpers, Supabase reads. No
new dependencies, no migration.

---

## 1. Problem & current state

Two places let a user resume/review a game, neither shows the in-progress score:

1. **Home active-game card** (`src/pages/SportSelect.tsx`, lines ~64–96): shows
   `teamName vs opponentName` and a sync-status label, **no score**, plus Resume/New.
2. **Cloud Games list** (`src/pages/Games.tsx`): the score line (`finalScoreLines`) is
   computed **only for `status === 'final'`** games (lines ~148–183). In-progress /
   scheduled cards show team, opponent, tournament, date — **no score**.

The data is readily available: local `GameState` for the home card; the `games` row
(`opponent_score`, `home_team_score`, `home_score_adjustment`) plus `game_stats` for the
cloud list. `gameScore.ts` already has both helpers:
- `getDisplayedHomeScore(sport, players, homeTeamScore, homeScoreAdjustment)` (local).
- `resolveFinalHomeScoreFromGameRow(sport, statsTotalsByStatId, row)` (cloud row + stats).

## 2. Design

### 2.1 Home active-game card (local state)

Compute the live score directly from `GameState`, **mirroring `Scoreboard.tsx` exactly**
— which uses roster players only (excludes team pseudo-players):

```ts
import { isTeamPseudoPlayer } from '../lib/teamPlayers'
const rosterPlayers = state.players.filter(p => !isTeamPseudoPlayer(p))
const liveHomeScore = getDisplayedHomeScore(
  state.sport!, rosterPlayers, state.homeTeamScore, state.homeScoreAdjustment
)
const liveScoreLine = `${liveHomeScore}–${state.opponentScore}`
```

Render it in the card, e.g. under "team vs opponent":

```
┌───────────────────────────────────────────┐
│ 🏀 Active Game                  [Resume]    │
│ Rebels vs Brawlers              [New]       │
│ 62 – 54                                     │   ← NEW live score
│ Cloud Sync: saved                           │
└───────────────────────────────────────────┘
```

`getDisplayedHomeScore` already handles both scoring modes (standalone `homeTeamScore`
vs. legacy player-stat sum + adjustment). **Using `rosterPlayers` (not all `players`) is
required** so the card matches the in-game scoreboard, which filters pseudo-players at
`Scoreboard.tsx:12`.

> **Post-F1 note:** F1's court popup records shots via the same `ADD_SHOT`/`INCREMENT_STAT`
> dispatches, so court-captured points already flow into player stats and thus into
> `getDisplayedHomeScore`. The live card score reflects them automatically — F4 needs no
> change for the court-capture pivot.

### 2.2 Cloud Games list (in-progress + scheduled)

Extend the existing `finalScoreLines` effect to cover non-final games. Strategy per game:

1. **If `game.home_team_score != null`** (standalone scoreboard total was synced): show
   `home_team_score–opponent_score` directly from the row. No extra query. This is the
   common, cheap path.
2. **Else (legacy null home score):** aggregate stats to compute the home score, like
   finals do — but for in-progress games stats aren't "resolved." Use a direct
   `game_stats` sum for the game, then `resolveFinalHomeScoreFromGameRow(sport, byStat, g)`.
   Reuse the exact loop already present for finals (lines ~157–178); for non-final games
   query `game_stats` instead of the resolved RPC (see §7 D6 for the multi-recorder scoping).

Rename `finalScoreLines` → `scoreLines` (or keep the name but populate for all statuses).
Render the score pill on **every** card via `renderGameCard` (today it's gated to
`status === 'final'`, lines ~310–311, ~353–356). Keep the status badge so users still
distinguish In Progress vs Final.

```
┌───────────────────────────────────────────┐
│ 🏀 Rebels                  [In Progress]    │
│ vs Brawlers   62–54  ✏️                     │   ← score now shown for in-progress too
│ 2026-05-30                                  │
│ [Resume Game]                  [🗑️]         │
└───────────────────────────────────────────┘
```

### 2.3 Accuracy & "live-ness" caveat

The Cloud Games score reflects the **last synced** state of the game, not necessarily a
real-time value (another device may have newer unsynced data). This matches how the rest
of the list works (it reads synced rows). The home card, by contrast, is truly live
because it reads local `GameState`. Acceptable for v1; no live subscription needed.

### 2.4 Scoreboard label nuance

Use an en dash `–` consistent with the existing final score line
(`${home}–${g.opponent_score}`). Keep it compact and `tabular-nums` like the current
`scoreHint` span.

### 2.5 File structure

| File | Change |
|------|--------|
| `src/pages/SportSelect.tsx` | **Modify** — compute and render `liveScoreLine` in the active-game card. |
| `src/pages/Games.tsx` | **Modify** — populate score lines for in-progress/scheduled games; show the pill on all cards. |

No new files, no migration, no helper additions (reuse `gameScore.ts`).

## 3. Implementation tasks (bite-sized)

### Task 1: Live score on the home active-game card

- [x] **Modify `src/pages/SportSelect.tsx`**: when `hasActiveGame`, compute
  `rosterPlayers = state.players.filter(p => !isTeamPseudoPlayer(p))` and
  `liveHomeScore = getDisplayedHomeScore(state.sport!, rosterPlayers, state.homeTeamScore, state.homeScoreAdjustment)`
  (import both from their libs) and render `{liveHomeScore} – {state.opponentScore}`
  in the card, near the team/opponent line.
- [x] Verify the inputs match `Scoreboard.tsx:12-13` so the card and the in-game scoreboard agree.
- [x] Run `pnpm build` + `pnpm lint`. Expected: pass. ✓
- [ ] Manual: start a basketball game, score some points, go Home → active-game card shows
  the running score; matches the Game Tracker scoreboard. *(pending user QA — see
  REGRESSION_TESTING.md §6.13)*
- [x] **Commit:** `feat: show live score on the home active-game card`

### Task 2: Score lines for in-progress cloud games

- [x] **Modify `src/pages/Games.tsx`**: generalize the `finalScoreLines` effect to all
  games:
  - For each game, if `home_team_score != null`, set the line to
    `${home_team_score}–${opponent_score}` (no query).
  - Else, for the sport, query stats and compute via `resolveFinalHomeScoreFromGameRow`:
    - `status === 'final'` → keep using `get_game_stats_resolved` (current behavior).
    - otherwise → sum `game_stats` (scoped per §7 D6) into `byStat`, then
      `resolveFinalHomeScoreFromGameRow(sport, byStat, g)`.
  - Store into the (renamed) `scoreLines` map.
- [x] **Modify `renderGameCard`**: show the score pill for the desired statuses (per §7 D7;
  default in_progress + final), keeping the status badge. *(Scheduled hides only a `0–0`.)*
- [x] Run `pnpm build` + `pnpm lint`. Expected: pass. ✓ (+ full test suite green)
- [ ] Manual (Supabase configured): an in-progress game with a synced score shows the
  score in the list; a final game still shows its resolved score. *(pending user QA — see
  REGRESSION_TESTING.md §6.14–6.15)*
- [x] **Commit:** `feat: show in-progress scores in the Cloud Games list`

## 4. Testing

- **Build/lint:** `pnpm build`, `pnpm lint`.
- **Manual (GUI, `pnpm dev`):**
  - **Home card:** start a game, add points (player stats and/or `INCREMENT_HOME_SCORE`),
    return Home → live score shown and equals the Game Tracker scoreboard; updates after
    more scoring; legacy mode (`homeTeamScore == null`) and standalone mode both correct;
    a game with team pseudo-players shows the same number as the scoreboard (pseudo-players excluded).
  - **Cloud list (Supabase + signed in):** in-progress game with synced `home_team_score`
    → score shown without extra query; in-progress legacy game (null `home_team_score`)
    → score computed from `game_stats`; final game → unchanged resolved score; scheduled
    game with 0–0 → per §7 D7.
  - No score regressions on final games; status badges still correct.
- **Edge:** game with no team mapping / unknown sport → no score line, card still renders
  (guard like the current final path which `continue`s when sport is missing).

## 5. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Extra `game_stats` queries for many in-progress games slow the list | Only query when `home_team_score == null`; the synced-snapshot path needs no query. Most active games have a synced score. Could batch later. |
| In-progress score is stale vs another device | Documented caveat (§2.3); list already reads synced rows. Home card is live. |
| Multi-recorder unresolved stats inflate the in-progress home score | Use the row's `home_team_score` when present (authoritative); scope the stats fallback per §7 D6. |
| Home card score excludes/includes team pseudo-players inconsistently | Mirror `Scoreboard.tsx:12` (roster only); §7 D1. |

## 6. Out of scope

- Real-time/live updates of the cloud list via subscriptions.
- Per-period or detailed score breakdowns on the cards (the full breakdown lives in
  Game Summary).

## 7. Pre-handoff design decisions — RESOLVED

All F4 decisions are settled (signed off; every one confirmed as the recommended default).
F4 is independent of F1–F3 and touches only `SportSelect.tsx` and `Games.tsx`.

### A. Home active-game card

- **D1 — Score inputs mirror `Scoreboard`.** `state.players.filter(p => !isTeamPseudoPlayer(p))`
  (roster only) + `getDisplayedHomeScore(...)` + `state.opponentScore` (matches `Scoreboard.tsx:12-13`).
- **D2 — Format.** `home–opp` with an en dash, `tabular-nums`, matching the final score-line style.
- **D3 — Period/quarter on the card?** **No** — score only in v1.
- **D4 — Show 0–0 for a brand-new active game?** **Yes** — the card already signals an
  active game; a live 0–0 is informative.

### B. Cloud Games list

- **D5 — Score source precedence.** Prefer the synced `games` row (`home_team_score` /
  `opponent_score`); fall back to a `game_stats` aggregate only when `home_team_score == null`.
- **D6 — Multi-recorder scoping for the stats fallback.** Scope the fallback sum to the
  game **creator's** rows (`recorded_by = game.created_by`) to avoid double-counting
  co-recorders. (Finals keep the resolved RPC.) The row's `home_team_score` is authoritative
  when present.
- **D7 — Statuses + 0–0.** Show a score for **`in_progress`** and **`final`**; for
  **`scheduled`**, hide the score when it's `0–0`. Always show the status badge.
- **D8 — Performance.** Per-game query only on the null-home fallback path; batch into one
  `in('game_id', ids)` aggregate only if profiling shows it's needed.
- **D9 — Staleness.** List scores reflect last-synced state (no realtime subscription); the
  home card is the live surface. Documented caveat.

### C. Display & edges

- **D10 — Pill placement.** Reuse the existing `scoreHint` span position (next to
  "vs {opponent}") and styling for all statuses.
- **D11 — Missing sport/team mapping.** Skip the score line but still render the card
  (matches the current final-path `continue`); never let a missing mapping break the card.

### D. Acceptance criteria & regression

- **D12 — Acceptance criteria.** Home card score equals the Game Tracker scoreboard for both
  scoring modes and with team pseudo-players present; in-progress cloud games show the synced
  score (row path) or a creator-scoped stats aggregate (legacy null-home); finals are
  unchanged; scheduled 0–0 hides the score; status badges remain.
- **D13 — Regression checklist.** Final score lines unchanged (still via
  `get_game_stats_resolved`); existing `scoreHint` span styling preserved; no new query for
  games with a synced `home_team_score`; home card still renders Resume/New correctly.

### E. Explicitly out of F4
Realtime list updates; per-period/detailed breakdowns on cards (those live in Game
Summary); any shot-tracker changes (F1–F3).
