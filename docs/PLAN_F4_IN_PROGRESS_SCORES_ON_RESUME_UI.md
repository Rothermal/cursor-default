# Feature 4 Plan: In-Progress Scores on the Resume Game UI

> **For agentic workers:** Design + implementation plan. Steps use checkbox (`- [ ]`)
> syntax. See [DESIGN_SHOT_TRACKER_UI_REVAMP.md](DESIGN_SHOT_TRACKER_UI_REVAMP.md) for
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

Compute the live score directly from `GameState`:

```ts
const liveHomeScore = getDisplayedHomeScore(
  state.sport!, state.players, state.homeTeamScore, state.homeScoreAdjustment
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
vs. legacy player-stat sum + adjustment). Excludes team pseudo-players? It sums
`computePlayerScore` over the passed players; the existing scoreboard already passes
`state.players` and team pseudo-players have `pointValue` only on real scoring stats, so
matching the existing `Scoreboard` behavior is correct — **reuse the same inputs the
`Scoreboard` component already uses** to stay consistent. (Verify against `Scoreboard.tsx`
during implementation.)

### 2.2 Cloud Games list (in-progress + scheduled)

Extend the existing `finalScoreLines` effect to cover non-final games. Strategy per game:

1. **If `game.home_team_score != null`** (standalone scoreboard total was synced): show
   `home_team_score–opponent_score` directly from the row. No extra query. This is the
   common, cheap path.
2. **Else (legacy null home score):** aggregate stats to compute the home score, like
   finals do — but for in-progress games stats aren't "resolved." Use a direct
   `game_stats` sum for the game (creator/recorder scope), then
   `resolveFinalHomeScoreFromGameRow(sport, byStat, game)`. Reuse the exact loop already
   present for finals (lines ~157–178), just don't restrict to `status === 'final'`, and
   for non-final games query `game_stats` instead of the resolved RPC.

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

- [ ] **Modify `src/pages/SportSelect.tsx`**: when `hasActiveGame`, compute
  `liveHomeScore = getDisplayedHomeScore(state.sport!, state.players, state.homeTeamScore, state.homeScoreAdjustment)`
  (import from `src/lib/gameScore`) and render `{liveHomeScore} – {state.opponentScore}`
  in the card, near the team/opponent line.
- [ ] Verify the inputs match `Scoreboard.tsx` so the card and the in-game scoreboard agree.
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] Manual: start a basketball game, score some points, go Home → active-game card shows
  the running score; matches the Game Tracker scoreboard.
- [ ] **Commit:** `feat: show live score on the home active-game card`

### Task 2: Score lines for in-progress cloud games

- [ ] **Modify `src/pages/Games.tsx`**: generalize the `finalScoreLines` effect to all
  games:
  - For each game, if `home_team_score != null`, set the line to
    `${home_team_score}–${opponent_score}` (no query).
  - Else, for the sport, query stats and compute via `resolveFinalHomeScoreFromGameRow`:
    - `status === 'final'` → keep using `get_game_stats_resolved` (current behavior).
    - otherwise → `from('game_stats').select('stat_id,value').eq('game_id', g.id)`
      summed into `byStat`, then `resolveFinalHomeScoreFromGameRow(sport, byStat, g)`.
  - Store into the (renamed) `scoreLines` map.
- [ ] **Modify `renderGameCard`**: show the score pill for **all** statuses (remove the
  `game.status === 'final'` gate at lines ~310–311 / ~353–356), keeping the status badge.
- [ ] Run `pnpm build` + `pnpm lint`. Expected: pass.
- [ ] Manual (Supabase configured): an in-progress game with a synced score shows the
  score in the list; a final game still shows its resolved score.
- [ ] **Commit:** `feat: show in-progress scores in the Cloud Games list`

## 4. Testing

- **Build/lint:** `pnpm build`, `pnpm lint`.
- **Manual (GUI, `pnpm dev`):**
  - **Home card:** start a game, add points (player stats and/or `INCREMENT_HOME_SCORE`),
    return Home → live score shown and equals the Game Tracker scoreboard; updates after
    more scoring; legacy mode (`homeTeamScore == null`) and standalone mode both correct.
  - **Cloud list (Supabase + signed in):** in-progress game with synced `home_team_score`
    → score shown without extra query; in-progress legacy game (null `home_team_score`)
    → score computed from `game_stats`; final game → unchanged resolved score; scheduled
    game with 0–0 → shows `0–0` (or hide when both zero — see Q2).
  - No score regressions on final games; status badges still correct.
- **Edge:** game with no team mapping / unknown sport → no score line, card still renders
  (guard like the current final path which `continue`s when sport is missing).

## 5. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Extra `game_stats` queries for many in-progress games slow the list | Only query when `home_team_score == null`; the synced-snapshot path needs no query. Most active games have a synced score. Could batch later. |
| In-progress score is stale vs another device | Documented caveat (§2.3); list already reads synced rows. Home card is live. |
| Multi-recorder unresolved stats inflate the in-progress home score | Use the row's `home_team_score` when present (authoritative); the stats fallback is creator/recorder-scoped and only used when no standalone score exists — acceptable approximation for a list hint. |
| Home card score excludes/includes team pseudo-players inconsistently | Mirror `Scoreboard.tsx` inputs exactly; verify in manual test. |

## 6. Out of scope

- Real-time/live updates of the cloud list via subscriptions.
- Per-period or detailed score breakdowns on the cards (the full breakdown lives in
  Game Summary).

## 7. Open questions

1. **Q5 (umbrella):** Is the synced `games` row snapshot accurate enough for in-progress
   list scores, or must we always aggregate stats? Default: prefer the row snapshot, fall
   back to a stats aggregate only when `home_team_score` is null.
2. Show `0–0` for freshly created/scheduled games, or hide the score until there's
   scoring? Default: hide when both sides are 0 and `status === 'scheduled'`; show for
   `in_progress`.
3. Should the home card also show the period (e.g. "Q3") alongside the score? Default:
   score only for v1 (period is basketball-team-stats-specific).
