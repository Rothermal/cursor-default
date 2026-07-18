# Regression Testing — StatKeeper

High-level test scripts for features built so far. Use these to sanity-check after changes or before release. Run against local dev (`pnpm dev`) or the deployed GitHub Pages site; for cloud features, Supabase must be configured and migrations applied.

---

## 1. Offline / local-only mode

**Precondition:** No `.env` with Supabase vars, or use a build without env (e.g. `VITE_SUPABASE_URL` empty).

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Open app | No auth screen; sport choice page shows enabled sports |
| 1.2 | Open console | Warning: "Supabase credentials not found... Running in offline-only mode." |
| 1.3 | Choose Basketball -> New Game -> Game Setup -> enter team, opponent, date -> Continue | Player setup |
| 1.4 | Add 2+ players → Start Game | Game Tracker loads; scoreboard shows 0–0 |
| 1.5 | Tap stat buttons (e.g. 2PT, AST) | Home score updates; opponent can be adjusted manually |
| 1.6 | Tap Undo -> top-row **Undo** in Recent events | Last action reverted |
| 1.7 | Game Summary | Totals per player and team; no cloud sync UI |
| 1.8 | Reload page | Same game state (localStorage); no cloud games or teams |

---

## 2. Settings

**Precondition:** App loaded (signed in if Supabase configured).

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | From sport choice or a sport dashboard, tap Settings in the app shell | `/#/settings` opens the Account section with profile/session controls |
| 2.2 | Open `/#/settings/app` | App/general settings show enabled sport toggles |
| 2.3 | Disable a sport (e.g. Basketball) | Toggle off |
| 2.4 | Return to sport choice | Disabled sport no longer in grid |
| 2.5 | Re-enable sport | Sport reappears on sport choice |
| 2.6 | Open `/#/settings/sports` | Sport settings index lists every configured sport |
| 2.7 | Open `/#/settings/sports/basketball` | Basketball-specific settings show the missed-shot rebound prompt toggle |
| 2.8 | Open `/#/settings/data` | Local parked games, cloud shortcuts, and Seasons are available |
| 2.9 | Open `/#/settings/advanced` | Player merge and destructive data-management tools are available when signed in/configured, otherwise an unavailable-state card is shown |
| 2.10 | Open legacy `/#/admin` | Redirects to `/#/settings` |
| 2.11 | Reload | Settings persist (localStorage) |

---

## 3. Auth (Supabase)

**Precondition:** `.env` has `VITE_SUPABASE_URL` and **`VITE_SUPABASE_PUBLISHABLE_KEY`** or **`VITE_SUPABASE_ANON_KEY`** (see `.env.example`); migrations 001+ applied.

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Open app (no session) | Auth page (sign in / sign up) |
| 3.2 | Auth page | **Continue with Google** is the primary CTA above email/password fallback |
| 3.3 | Sign up with email + password (+ optional display name) | Success message or redirect; check email if confirmation enabled |
| 3.4 | Sign in with same credentials | Sport choice appears; Basketball dashboard exposes Cloud Games / Teams / Season Stats |
| 3.5 | Sign out (app shell) | Back to Auth page |
| 3.6 | Sign in again | Home; session restored |
| 3.7 | With Google provider configured: tap **Continue with Google** | Browser starts Supabase Google OAuth flow |
| 3.8 | Complete Google OAuth locally | Redirect returns to `http://localhost:5173/`; signed-in app loads |
| 3.9 | Complete Google OAuth on GitHub Pages | Redirect returns to `https://rothermal.github.io/cursor-default/`; signed-in app loads |
| 3.10 | Cancel or fail Google OAuth | Auth page shows the returned provider error once and cleans the URL back to the app base |
| 3.11 | New Google user after migration 034 | `profiles.display_name` uses Google/display metadata fallback, `profiles.email` is populated, `profiles.avatar_url` uses Google avatar metadata when present |
| 3.12 | Existing confirmed email/password Gmail account -> sign out -> Continue with Google using same Gmail | Existing teams/games remain visible; verify Supabase kept/linked the same user/profile ownership |
| 3.12a | Open `/#/settings/account` while signed in | Signed-in email, StatKeeper display name, connected sign-in methods, and Sign Out are visible |
| 3.12b | Edit display name on `/#/settings/account`, save, refresh | `profiles.display_name` persists and remains independent from the Google profile name |
| 3.12c | Email/password account without Google identity -> Settings -> Account -> Link Google | Browser starts Google linking; after OAuth, app returns to Account and Google appears connected. Supabase manual identity linking must be enabled. |
| 3.12d | Supabase configured but no active session | Auth gate appears; Account page remains unavailable until sign-in |
| 3.13 | Console | "[StatKeeper] Supabase connected: … | key length: …" (key length >> 40) |

---

## 3a. Multi-game parking, queue, and cloud hardening

**Precondition:** Signed in with Supabase configured for cloud checks. For local-only checks, repeat 3a.1-3a.5 with Supabase disabled.

| Step | Action | Expected |
|------|--------|----------|
| 3a.1 | Start a basketball game, add two players, record several stats and at least one court shot | Game is active; home score, stats, action log, and shot marker persist |
| 3a.2 | Return to a sport dashboard, choose another enabled sport or start another basketball game, and confirm parking the current game | First game appears under Parked Games with sport/team/opponent/date and a pending/offline/saved sync label; new setup flow starts with a different local game id |
| 3a.3 | Record stats in game B, then resume game A from Parked Games | Game A restores its own sport, players, stats, shots, score, and action log; game B remains parked and unchanged |
| 3a.4 | With network offline or Supabase unreachable, dirty both games | Each parked row remains dirty/offline; neither record overwrites the other |
| 3a.5 | Restore network and wait for sync | Dirty records drain through the queue: active game first, then parked games by older update time; each record keeps its own cloud `gameId` / `playerIdMap` |
| 3a.6 | During a cloud sync failure after a new game row is inserted (simulate by forcing `game_stats` or `shot_chart` write failure in dev tools/test env) | The local parked record stays dirty/error and retryable; the just-created in-progress cloud game is best-effort deleted rather than left as a new orphan |
| 3a.7 | Existing cloud game sync fails after the game already has a persisted `cloudSync.gameId` | Existing game is not deleted; local row remains dirty/error for retry |
| 3a.8 | Settings -> Data & Sync -> Local parked games -> Export | Downloads a JSON file containing the parked game records for this device |
| 3a.9 | Settings -> Data & Sync -> Local parked games -> Import the exported JSON | Parked games are restored as parked games only, then the app reloads from the updated manifest; the import result separates imported, existing/skipped, invalid, and at-limit counts |
| 3a.10 | Fill all 12 parked-game slots, then try to start another game | App stays on the current screen and shows a storage/max-count message instead of navigating into setup |
| 3a.11 | Simulate localStorage quota failure while saving a game | App shows a storage/quota message and does not silently discard the active game |
| 3a.12 | Import a file that contains a game already parked on this device | Existing local game is kept; the duplicate imported row is skipped and counted as existing |
| 3a.13 | Import a file with more valid games than open parked-game slots | The app imports what fits, skips the remaining valid rows at the cap, and does not exceed 12 parked games |
| 3a.14 | Simulate quota failure during Settings import after some records write but before the manifest write | The attempted import batch is rolled back; pre-existing parked games remain unchanged |
| 3a.15 | Park a cloud-team game with unsynced stats (or pre-first-sync `teamId` without `gameId`) → Discard → confirm | Discard is blocked with a sync message; parked row remains (same guard as dashboard 3b.12a) |
| 3a.16 | With an active local game bound to cloud game A, trigger sign-in auto-hydrate that would resume cloud game B | Auto-hydrate is skipped; game A stays mounted and is not overwritten |
| 3a.17 | While syncing a cloud game that is already `final`, edit stats mid-flight (or leave unsynced local edits) | Flush/sync does **not** report success; local edits are not treated as uploaded; discard of that cloud-bound game remains blocked |

---

## 3b. Navigation shell and sport dashboards

**Precondition:** App loaded (signed in if Supabase configured). Basketball enabled.

| Step | Action | Expected |
|------|--------|----------|
| 3b.1 | Open `/#/` | Sport choice page appears; Basketball is a tile/card; Settings is available in the app shell |
| 3b.2 | Open `/#/sports` | Same sport choice page appears |
| 3b.3 | Tap Basketball | Opens `/#/sport/basketball` |
| 3b.4 | Basketball dashboard -> New Game | Existing setup flow opens at `/#/setup` |
| 3b.5 | Return to `/#/sport/basketball` with an active basketball game | Dashboard shows the active game and Resume returns to the correct game-flow route |
| 3b.6 | Park at least one basketball game | Basketball dashboard lists only basketball parked games; Resume restores setup/players/game based on saved progress |
| 3b.7 | Basketball dashboard -> Teams | Opens `/#/teams?sport=basketball`; list/create context is basketball-scoped |
| 3b.8 | Basketball dashboard -> Cloud Games | Opens `/#/games?sport=basketball`; non-basketball games are hidden from the list |
| 3b.9 | Basketball dashboard -> Season Stats | Opens `/#/leaderboard?sport=basketball`; season/team choices are basketball-scoped |
| 3b.10 | Open `/#/game` | Live tracker does not show the compact app shell header |
| 3b.11 | Enable another sport, park one game for each sport, then open `/#/sport/basketball` | Only basketball parked games appear; the other sport remains visible only on its own dashboard |
| 3b.12 | Basketball dashboard -> Discard on a parked **local-only** game -> confirm | Parked row is removed; other parked games remain |
| 3b.12a | Park a cloud-team game with unsynced stats (or pre-first-sync) -> Discard -> confirm | Discard is blocked with sync message; parked row remains |
| 3b.13 | Supabase unconfigured/local mode -> open `/#/sport/basketball` | Dashboard works locally; cloud management actions are disabled with local-mode copy |
| 3b.14 | Open `/#/teams?sport=soccer` while Soccer is disabled | Teams list is soccer-scoped; create flow is blocked with a Settings CTA instead of falling back to another enabled sport |

---

## 4. Cloud Teams & Roster

**Precondition:** Signed in; migrations 002, 004–006, 011 applied.

> Team Info hub smoke (overview, drill-downs, Start Game, `from=team`) is consolidated in **§4h**.

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | Home → Teams | Cloud Teams page; Create Team form; no team row is pre-selected/highlighted |
| 4.1b | Stay on Cloud Teams list (do not open Manage) | Network: no `team_players` / `get_team_members_with_profiles` for a default first team |
| 4.1c | Settings -> App -> disable a sport -> Teams Create Team / Settings -> Data & Sync -> Seasons New Season | Sport dropdown lists only enabled sports (same filter as Home SportSelect) |
| 4.2 | Create team (name, sport, season) | Opens `/team/manage?teamId=<id>` for the created team |
| 4.3 | Team Manage → add players (number, first, last) | Players appear in Roster |
| 4.4 | Edit team name (pencil) → change primary name → Save | Team name updates in list; reflected in Game Setup dropdown and Games page |
| 4.4b | Edit team nickname (pencil) → set or clear display name → Save | If set: display name shown in list with primary name in parens; if cleared: primary name shown directly |
| 4.5 | Edit player (pencil) → change first name, last name, jersey number → Save | Player row updates with new values; reflected in cloud roster |
| 4.5b | Edit player nickname | Display name updates; primary name shown in parentheses if nickname set |
| 4.6 | Remove player | Player removed from roster (soft deactivate) |
| 4.7 | Team Manage → Season Stats link | Opens `/leaderboard?teamId=<id>&seasonId=<id>&from=team`; back arrow returns to Team Info |
| 4.8 | Reload → Teams | Same teams and roster (from Supabase) |
| 4.9 | Teams → tap a team card's primary name area | Opens `/team?teamId=<id>`; Team Info shows display name, season, sport, record, roster count, game count, and links back to Season Stats, Team Stats, and Manage Team |
| 4.10 | Teams → tap **Manage** on a team card | Opens `/team/manage?teamId=<id>` (`TeamManage` page) with roster and member management for that team |
| 4.10b | Open legacy `/teams?teamId=<id>` link | Redirects to `/team/manage?teamId=<id>` |
| 4.10c | Open `/team/manage` without a team id or with an invalid id | Shows Team unavailable state; does not auto-select or manage another team |
| 4.11 | Team Info → switch **Overview / Roster / Schedule** segments | Segment content changes in place; URL stays `/team?teamId=<id>`; Manage links open `/team/manage?teamId=<id>` |
| 4.12 | Team Info → Overview | Shows stat links, roster preview, schedule preview, recent results, tournaments, and read-only team members when data exists |
| 4.13 | Team Info → Roster | Shows the full active roster and read-only member list; player rows link to `/player-info?playerId=<id>&teamId=<id>` |
| 4.14 | Team Info → Overview roster preview → View roster | Opens `/team/roster?teamId=<id>`; shows the same active roster as a read-only Team Roster page |
| 4.15 | Team Roster → Back to Team | Returns to `/team?teamId=<id>` |
| 4.15b | Team Manage → Back | Returns to `/team?teamId=<id>` |
| 4.16 | Team Info → Schedule | Shows upcoming/live games, recent finalized results, and tournament links; game rows open Game Info |
| 4.17 | Team Info → Schedule preview → View schedule | Opens `/team/schedule?teamId=<id>`; groups games into live, upcoming, and finals with final scores/results |
| 4.18 | Team Schedule → tap a scheduled/live/final game | Opens `/game-info?gameId=<id>&teamId=<id>`; shows game details, status/score, and stat leaders when resolved stats exist |
| 4.19 | Game Info → View full summary on a finalized game | Hydrates the cloud game through the existing flow and opens `/summary`; pending local sync still blocks hydration |
| 4.20 | Team Roster → tap a player | Opens `/player-info?playerId=<id>&teamId=<id>` with **Player Info**, season totals, game log, career link, and **Back to Team** returning to `/team?teamId=<id>` |
| 4.21 | Team Info → Season Stats → back arrow | Opens Leaderboard with that team selected; back arrow returns to `/team?teamId=<id>` |
| 4.21b | Global Leaderboard (not from team) → tap a player row | Existing `/player?teamId=<id>&playerId=<id>&seasonId=<id>` route still opens **Player Profile** and backs to Leaderboard (team-origin rows use `/player-info` — see **4h.8b**) |
| 4.22 | Team Info hero → season name | Opens `/team/season?seasonId=<id>` with season name, sport, team count, and teams in that season |
| 4.23 | Season Info → tap a team name / Season Stats | Team name opens `/team?teamId=<id>`; Season Stats opens `/leaderboard?teamId=<id>&seasonId=<id>&from=team`; back arrow returns to Team Info |
| 4.24 | Team Info → Start Game | Opens `/setup?teamId=<id>` with the team's sport and existing team preselected |
| 4.25 | Open `/setup?teamId=<id>` directly | Loads the team sport when possible and preselects the team; invalid/inaccessible team shows Team unavailable and does not auto-select another team |
| 4.26 | Team Stats / Tournament Stats / Game Info / Player Info → back action | Returns to `/team?teamId=<id>` when opened with team context |

---

## 4a. Merge duplicate players (migration 024)

**Precondition:** Signed in; migration **`024_player_merge_rpcs.sql`** applied (`merge_players_preview`, `merge_players_execute`). Two **distinct** `players` rows you intend to merge, each on at least one roster for a team where you are **owner** or **admin** (so you pass RPC authorization for all teams involved).

| Step | Action | Expected |
|------|--------|----------|
| 4a.1 | As **scorer-only** (not owner/admin): Teams → Manage a team | **Merge players** link next to Season Stats is **not** shown |
| 4a.2 | As **owner** or **admin**: Teams → Manage that team; ensure ≥2 players exist across teams you admin | **Merge players** (amber) appears in Roster header |
| 4a.3 | Tap **Merge players** → read intro → **Continue** | Pick survivor / duplicate step |
| 4a.4 | Choose **survivor** (keep) and **duplicate** (remove) → **Load conflicts** | Either conflict sections appear, or message that there are no overlapping stat/roster conflicts |
| 4a.5 | If **game_stats** conflicts: pick **keep survivor** vs **keep duplicate** row for each | Radios work; one choice per conflict |
| 4a.6 | If **stat_corrections** conflicts: pick survivor / duplicate / **discard both** per row | Choices stick |
| 4a.7 | If **team_players** conflicts (same team on both profiles): set jersey, **Active**, position → **Continue to confirm** | Confirm step shows summary |
| 4a.8 | Type **MERGE** (all caps) → **Merge players** | Success: modal closes; duplicate gone from candidate pool / roster lists after refresh |
| 4a.9 | Team Manage roster / Leaderboard / Player profile for **survivor** | Stats and games that belonged to duplicate now attribute to survivor (where applicable) |
| 4a.10 | (Optional) Supabase Table Editor → `player_merge_audit` | New row with `duplicate_player_id`, `survivor_player_id`, `merged_by`, `resolutions` json |
| 4a.11 | Settings -> Advanced -> **Player merge (advanced)** | Section opens; **Your recent merges** loads or shows migration **025** hint if RLS blocks reads |
| 4a.12 | **Open merge wizard** from Settings -> Advanced (with ≥2 candidates) | Same modal as Teams; complete a test merge → row appears under **Your recent merges** (after **025** applied) |
| 4a.13 | Basketball: duplicate player has ≥1 `shot_chart` row; merge into survivor (migration **041** applied) | After merge, those shots remain under survivor (`player_id` remounted); Cloud Games / Summary shot chart still shows them. Without **041**, CASCADE delete wiped shots silently. |

**Negative / edge:** If another user edits roster or stats between **Load conflicts** and **Merge players**, execute may error (resolution counts mismatch); run **Load conflicts** again from the pick step.

**Migrations:** Merge UI works with **024** only; **Settings -> Advanced -> recent merges** needs **025** (`player_merge_audit` readable for own `merged_by`). Shot-chart preservation on merge needs **041**.

---

## 4b. Tournaments (cloud teams)

**Precondition:** Signed in; existing cloud team; migration 016 applied.

| Step | Action | Expected |
|------|--------|----------|
| 4b.1 | Game Setup → select existing team | Tournament dropdown appears (replaces free-text); options: "No tournament", any existing tournaments, "+ Add new tournament…" |
| 4b.2 | Select an existing tournament → Next | Game info includes tournament name; Scoreboard subtitle shows tournament |
| 4b.3 | Select "+ Add new tournament…" → type name → Next | Tournament created in Supabase; game linked via `tournament_id`; name shown in Scoreboard |
| 4b.4 | Leave dropdown at "No tournament" → Next | No tournament linked; Scoreboard shows no subtitle |
| 4b.5 | Cloud Games page | Game cards show 🏆 tournament name when set |
| 4b.6 | Reload app → resume game | Tournament name and ID preserved (loaded from cloud) |
| 4b.7 | New team / offline flow: Game Setup | Tournament field remains free-text (no dropdown) |

---

## 4c. Missed shots (basketball)

**Precondition:** Basketball selected (enabled). Works in both offline and cloud modes.

| Step | Action | Expected |
|------|--------|----------|
| 4c.1 | Start a basketball game → Game Tracker → Scoring section | Six buttons in 2-column grid: FT / FT Miss, 2PT / 2PT Miss, 3PT / 3PT Miss. Made buttons are amber; Miss buttons are slate/gray |
| 4c.2 | Tap 2PT (+) twice → tap 2 Miss (+) once | 2PT shows 2, 2 Miss shows 1; scoreboard shows 4 pts (only makes score) |
| 4c.3 | Tap Undo -> top-row **Undo** in Recent events | Last miss action reversed; 2 Miss back to 0 |
| 4c.4 | Navigate to Game Summary | Scoring table shows "FT M/A", "2PT M/A", "3PT M/A" columns — each cell displays made/total (e.g. "2/3") and percentage (67%) |
| 4c.5 | Team totals row | Same M/A format with team-level percentage |
| 4c.6 | Miss buttons do not affect home team score | Scoreboard points unchanged when Miss is tapped |

---

## 4d. Shot chart — dev preview (SVG / layout QA)

**Purpose:** Quickly verify **half-court SVG** geometry and markers **without** signing in or starting a game. **Dev only** (`pnpm dev`).

| Step | Action | Expected |
|------|--------|------------|
| 4d.1 | `pnpm dev` → open `http://localhost:5173/#/dev/shot-chart` (HashRouter) | **Shot chart preview (dev)** page with sample made/miss markers on the court |
| 4d.2 | (Optional) With Supabase configured | App **skips the auth screen** when the URL hash contains `/dev/shot-chart` so the preview loads immediately |
| 4d.3 | Production build (`pnpm build` + `pnpm preview`) | The `/dev/shot-chart` route is **not** registered in production bundles; use a **real** basketball game and the inline court on `#/game` for end-user testing |

**Related:** Full court capture flow (stats, cloud) — start a basketball game → court is inline on Game Tracker (`#/game`), see **§4e**. See [completed/DESIGN_SHOT_CHART_IMPLEMENTATION.md](completed/DESIGN_SHOT_CHART_IMPLEMENTATION.md) and [completed/PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md](completed/PLAN_F1_GAME_TRACKER_COURT_CAPTURE.md).

---

## 4e. Court event capture (basketball Game Tracker)

**Precondition:** Basketball selected (enabled). Works in both offline and cloud modes. The court is **inline** on Game Tracker — one scrollable page: Score → sticky player strip → court → full stat grid → notes.

| Step | Action | Expected |
|------|--------|----------|
| 4e.1 | Start a basketball game → Game Tracker | Single scroll page; half-court below the player strip; **no** separate "Shot chart" button |
| 4e.2 | Scroll down to the stat grid | Player-select strip stays **pinned** at the top (score scrolls away); active player always visible |
| 4e.3 | Tap the court (inside the paint) | `CourtEventPopup` opens: Log for player switcher with compact live stat line, **2PT / 3PT** shot-value segmented control defaulted to **2PT**, **Made / Missed** buttons, Off Reb · Def Reb · Steal · Block · Assist, Cancel. Nothing is logged yet |
| 4e.4 | Tap **Made** | Popup closes; green marker at tap point; selected player's `2PT` +1; scoreboard +2 |
| 4e.5 | With **Settings -> Sports -> Basketball -> Missed-shot rebound prompt** off, tap the court beyond the arc → **Missed** | "Detected: 3-pointer"; red ✕ marker; `3 Miss` +1; score unchanged |
| 4e.6 | Tap court → **Off Reb** (repeat for Def Reb / Steal / Block / Assist) | Popup closes; the matching stat (`OFF`/`DEF`/`STL`/`BLK`/`AST`) +1; **no marker** on the court |
| 4e.7 | Tap court → **Cancel** (or tap outside the popup) | Popup dismisses; no stat, no marker |
| 4e.8 | Start a scroll gesture with the finger **on the court** | Page scrolls; no popup opens (tap-vs-scroll discrimination, ~18px tolerance — slightly wobbly taps still count as taps) |
| 4e.9 | Select the opponent team chip (★) → tap court → Made | Shot attributed to the opponent pseudo-player |
| 4e.10 | Tap bottom **Undo** -> Recent events opens -> top-row **Undo** after a popup shot, or tap **↩ Undo last shot** | Marker removed and stat reverted |
| 4e.11 | Log a made 2 via popup, then tap the `2PT` grid button | Both increment the same stat (additive — dual input by design); correct with the button's − or Undo |
| 4e.12 | Open `#/shot-chart` directly | Redirects to `#/game` (or home when no basketball game) |
| 4e.13 | Non-basketball sport (e.g. soccer) → Game Tracker | Page unchanged: no court, full grid only |
| 4e.14 | Reload mid-game | Shots/stats restored from `localStorage`; markers still on the court |
| 4e.15 | Tap the court at a spot where a popup button will appear (e.g. where Def Reb renders) | Popup opens and **waits** — the opening tap never activates the button under the finger (ghost-tap guard: presses count only when begun on the popup, ≥300ms after it opened). A deliberate second tap then works normally |
| 4e.16 | Tap just inside the arc → switch the chip to **3PT** → **Made** | Shot records as `3pt`, score +3, marker remains at the tapped location, and the zone summary counts it under 3-Point |
| 4e.17 | Tap clearly beyond the arc → switch the chip to **2PT** → **Made** | Shot records as `2pt`, score +2, marker remains at the tapped location, and the zone summary counts it under a 2-point zone (mid-range when the raw location was `three`) |
| 4e.18 | Tap court while #A is active → open **Log for** picker → choose #B → **Made** | Popup stays open after choosing #B; shot is credited to #B; sticky strip highlights #B; the inline court filters to #B |
| 4e.19 | Tap court → switch to another player/team → **Cancel** | No stat or marker is recorded, but the active player remains the switched selection |
| 4e.20 | Log a mix of shots, rebounds, steals, blocks, assists, and score changes -> tap bottom **Undo** | Recent events lists the last ~5 events, newest first, using player/team + event labels |
| 4e.21 | With Recent events open, tap **Undo** on the newest row repeatedly | Each tap reverts the next newest event; older rows are disabled until they become newest; shot markers disappear when their linked shot is undone |
| 4e.22 | Tap court as #A → **Made** → **Assisted by?** choose #B | #A gets the made shot + marker + score; #B gets `AST +1`; active player remains #A |
| 4e.23 | Open bottom **Undo** after an assisted made shot | Recent events shows the assist and shot as adjacent newest rows; undo once removes the assist; undo again removes the shot + marker |
| 4e.24 | Tap court as #A → **Made** → **No assist** | Only the shot is logged; no player's `AST` changes |
| 4e.25 | Tap court → **Missed**, Off Reb, Def Reb, Steal, Block, or standalone Assist | No **Assisted by?** step appears |
| 4e.26 | Tap court as #A → **Made** | The **Assisted by?** choices exclude #A; opponent pseudo-player shots skip the assist step |
| 4e.27 | Tap court for a player with stats, then use **Log for** to switch players | The compact stat line under the player name updates with the selected player's live stats |
| 4e.28 | Settings -> Sports -> Basketball -> turn **Missed-shot rebound prompt** on; return to Game Tracker; tap court as #A → **Missed** | Popup advances to **Rebound?**; the Log for picker and shot-value controls are read-only for the pending miss |
| 4e.29 | On the Rebound? step after #A misses, leave the offensive row on the home team default → **Off Reb** | Popup closes; red miss marker is saved for #A; home team pseudo-player gets `OFF +1`; score unchanged |
| 4e.30 | Repeat #A miss → choose a player chip in the offensive row → **Off Reb** | Popup closes; red miss marker is saved for #A; selected player gets `OFF +1` |
| 4e.31 | Select the opponent team chip → tap court → **Missed** → **Off Reb** | Opponent miss marker is saved; opponent team pseudo-player gets `OFF +1` |
| 4e.32 | Select the opponent team chip → tap court → **Missed** → choose a home player in the defensive row → **Def Reb** | Opponent miss marker is saved; selected home player gets `DEF +1` |
| 4e.33 | With rebound prompt on, tap court → **Missed** → **No rebound** | Popup closes; only the miss is logged; no `OFF`/`DEF` stat changes |
| 4e.34 | Open bottom **Undo** after a missed shot with rebound | Recent events shows rebound above the miss; undo once removes the rebound; undo again removes the shot + marker |

---

## 4f. Per-player / team shot views (F2)

**Precondition:** Basketball game with court shots recorded for 2+ individuals **and** the opponent pseudo-player (via the court popup, §4e).

| Step | Action | Expected |
|------|--------|----------|
| 4f.1 | Game Tracker → select **#A** (individual chip) | Court shows **only** #A's markers; context label "Shot chart — #A {name}" + #A's made/att (FG%); zone summary matches |
| 4f.2 | Select **#B** | Only #B's markers/numbers |
| 4f.3 | Select the **home team** chip (★) | Union of every home-side shot (**all individuals + home pseudo**); **no** opponent markers; label "{team} (team)" |
| 4f.4 | Select the **opponent** chip (★) | Only opponent pseudo shots |
| 4f.5 | Tap the leading **All** chip | Every marker shown; label "All shots"; `activePlayerId` unchanged — a court tap still opens the popup for the **last active player** (named in the popup header) and the new shot appears |
| 4f.6 | While in All view, select a player chip | All view exits; that player becomes both the view and the recording target |
| 4f.7 | Select a player with no shots | Court shows the tap hint; zone summary shows "No shots for {name}." (team: "No shots recorded for {team} yet.") |
| 4f.8 | Game Summary → Shot chart tab | Same selector strip (read-only, no `+`); defaults to **All**; switching chips filters the chart + zone numbers identically; selections here do **not** change the tracker's active player |

---

## 4g. Cloud shot chart review — all recorders (F3)

**Precondition:** Supabase configured, migration `032_shot_chart.sql` applied. Two users (A and B) on the same team. User A records a basketball game with court shots (§4e).

| Step | Action | Expected |
|------|--------|----------|
| 4g.1 | User B → Cloud Games → open A's **final** game → Game Summary → Shot chart tab | A's shots render for B (read-only), even though B recorded none; note under the header: "Combined from all recorders…" |
| 4g.2 | Filter with the selector strip (F2) | Per-player / team / All filtering works on the review shots |
| 4g.3 | User B opens A's **in-progress** game → Game Tracker → "Summary →" → Shot chart tab | Same all-recorder chart via the Summary (the live tracker still shows only B's own shots) |
| 4g.4 | Two recorders chart the same game | No duplicate markers — each player's shots come from **one** recorder (primary → game creator → lowest recorder id) |
| 4g.5 | Admin reassigns the primary recorder (Game Summary, final game) | Review chart refetches and reflects the new primary's shots |
| 4g.6 | Return to Game Tracker after viewing the review chart | Tracker court unchanged (viewer's own shots only); review shots are never written into game state and never sync |
| 4g.7 | Cloud Games list | Basketball games with any `shot_chart` rows show a small **🏀 chart** pill; non-basketball and chartless games show none |
| 4g.8 | DB without migration `032` | No errors; Shot chart tab absent/empty; no pill |

---

## 4h. Team Info drill-down smoke

**Precondition:** Signed in; at least one cloud team with active roster players, at least one scheduled or finalized game, and Supabase migrations through the current app schema applied.

| Step | Action | Expected |
|------|--------|----------|
| 4h.1 | Home → Teams → tap a team name | Opens `/team?teamId=<id>`; hero shows display name, season, sport, record, roster count, and game count |
| 4h.2 | Team Info → Overview | Stats, roster, schedule, recent results, tournaments, and team members cards render without horizontal overflow |
| 4h.3 | Overview → Roster card **View roster** | Opens `/team/roster?teamId=<id>`; Back to Team returns to `/team?teamId=<id>` |
| 4h.4 | Overview → Schedule card **View schedule** | Opens `/team/schedule?teamId=<id>`; games group into live/upcoming/final sections and link to Game Info |
| 4h.5 | Schedule or recent result → game row | Opens `/game-info?gameId=<id>&teamId=<id>`; Back to Team returns to Team Info; finalized games can open full Summary |
| 4h.6 | Roster → player row | Opens `/player-info?playerId=<id>&teamId=<id>`; Back to Team returns to Team Info; Career link still opens `/career` |
| 4h.7 | Hero season link | Opens `/team/season?seasonId=<id>&teamId=<id>`; Back to Team returns to Team Info; team rows link back into Team Info |
| 4h.8 | Overview → Season Stats | Opens `/leaderboard?teamId=<id>&seasonId=<id>&from=team`; back arrow returns to Team Info |
| 4h.8b | Leaderboard (from team) → tap a player row | Opens `/player-info?playerId=<id>&teamId=<id>&seasonId=<id>`; **Back to Team** returns to Team Info |
| 4h.9 | Basketball dashboard -> Season Stats | Opens `/leaderboard?sport=basketball`; back arrow returns to the Basketball dashboard, even after the URL auto-fills `teamId` |
| 4h.10 | Team Info → Start Game | Opens `/setup?teamId=<id>` with the team's sport and existing team preselected; continuing loads the team's active roster |
| 4h.11 | Open `/setup?teamId=<id>` while another active game exists | If the requested team has a different sport **or a different cloud team** than the active game, confirmation appears (and unsynced local progress is blocked until sync finishes); cancel returns to that sport dashboard and preserves the active game. Same-team links continue into setup without that reset prompt. |
| 4h.12 | Scorer-only account opens Team Info | Team Info, roster, schedule, player, game, and season views are visible; `/team/manage` remains reachable, while invite/merge actions and roster writes stay protected by existing owner/admin checks and server/RLS enforcement. |

---

## 5. Game flow (local state)

**Precondition:** Any mode (offline or signed in).

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | Home → choose sport | Game Setup |
| 5.2 | Enter team name, opponent, tournament, date → Continue | Player Setup |
| 5.3 | Add 3+ players → Start Game | Game Tracker; scoreboard 0–0 |
| 5.4 | Select player A; tap 2PT twice, FT once | Player A: 2PT=2, FT=1; home score reflects point value |
| 5.5 | Select player B; tap AST, REB | Player B stats increment; home score unchanged for non-scoring stats |
| 5.6 | Increment opponent score | Opponent score +1 |
| 5.6a | On Scoreboard: tap + or − under home team score | Home score increases or decreases by 1 (stays ≥ computed from stats); Undo restores |
| 5.7 | Tap Undo -> top-row **Undo** in Recent events | Previous value restored |
| 5.8 | Game Summary | Tables show per-player and team totals; categories correct |
| 5.9 | New Game (from sport dashboard with active **local** game) | Confirm -> reset; can start new game (offline-only must not show a permanent "Finish syncing..." block) |
| 5.9a | Summary → New Game with **unsynced** cloud stats | Blocked with sync message; synced/clean cloud game confirms then resets |
| 5.9b | Summary → Finalize while in progress | Header ←, Back to Game, and New Game disabled until finalize finishes |
| 5.9c | During Finalize (slow network), if local edits arrive after cloud `status=final` succeeds | Local game is **not** wiped; error explains cloud is final and local edits were kept for export |

---

## 6. Cloud game lifecycle

**Precondition:** Signed in; team with roster exists; migrations 003, 007 applied.

| Step | Action | Expected |
|------|--------|----------|
| 6.1 | Home → Cloud Games | List of games (or empty) |
| 6.2 | Start new game: Game Setup → choose existing team → Continue | Roster preloaded from cloud |
| 6.3 | Complete Player Setup → Start Game | Game Tracker; scoreboard shows sync status (e.g. "Cloud Sync: saved" after actions) |
| 6.4 | Record some stats; leave Game Tracker (e.g. back to the sport dashboard) | Sync runs; game saved to cloud |
| 6.5 | Cloud Games | Game appears (e.g. "In Progress") |
| 6.6 | Open same game → Resume | Game Tracker with same state |
| 6.7 | Game Summary → Finalize Game (if available) | Game status → Final |
| 6.8 | Cloud Games → open finalized game | View Summary (read-only) |
| 6.9 | Second device/session: sign in → Cloud Games | Same game list; resume same game if in progress |
| 6.10 | Cloud Games → tap ✏️ next to opponent name on any game card | Inline input appears; type new name → Save | Opponent name updates on card; persists after reload |
| 6.11 | Cloud Games → **Final** game card | Shows home–away score (from resolved stats + adjustment) when RPC succeeds |
| 6.12 | Cloud Games → game with `tournament_id` | **Tournament stats** link next to tournament name opens `/tournament-stats` |
| 6.11 | Cloud Games → Edit opponent name → press Escape or ✕ | Edit cancelled; original name restored |
| 6.13 | (F4) Home page with an active game → score some points → back Home | Active-game card shows the live score (e.g. "62–54"), equal to the Game Tracker scoreboard in both scoring modes; team pseudo-players excluded |
| 6.14 | (F4) Cloud Games → **In Progress** game card | Shows the last-synced score next to "vs {opponent}" (row `home_team_score` when synced; else the viewer's `game_stats` sum). Final cards unchanged |
| 6.15 | (F4) Scheduled game with no score yet | No score shown (0–0 hidden for scheduled); status badge still present |

---

## 7. Player checkout (cloud teams)

**Precondition:** Signed in; team with roster; migrations 008 applied; multi-parent scenario optional.

| Step | Action | Expected |
|------|--------|----------|
| 7.1 | Game Setup with existing cloud team → Continue | If checkout supported: route to Checkout |
| 7.2 | Checkout: assign primary scorer per player (or leave defaults) | Selections saved |
| 7.3 | Continue to Game Tracker | Game starts; stats recorded under current user |
| 7.4 | Complete game → Finalize | Summary shows resolved stats (primary recorder per player/stat) |

---

## 8. Game Summary & admin corrections

**Precondition:** Signed in as owner or admin of team; finalized game; migrations 009–010 applied.

| Step | Action | Expected |
|------|--------|----------|
| 8.1 | Open finalized game → Summary | Resolved stats per player (from checkouts/corrections) |
| 8.2 | Toggle "Primary" / "All submissions" (finalized cloud games only) | Primary: resolved values; All submissions: per-recorder values (e.g. "12 (Mom), 14 (Dad)") |
| 8.3 | In Primary view: if a stat had multiple recorders or was averaged | Warning icon (⚠️) with tooltip "Multiple recorders – review" on that cell |
| 8.4 | As owner/admin: enable Review / Correct stats | Correction controls visible; tap pencil on stat to correct |
| 8.5 | Correct a stat (value + reason) → Save | Value updates; reason stored |
| 8.6 | Reload Summary | Corrected value and reason shown |
| 8.7 | As scorer (non-admin): open same game | No correction controls (or read-only) |
| 8.8 | As owner/admin: Primary view → "Primary recorder" section | Dropdown per player listing who checked out; select different recorder → resolved stats and season totals update after refetch |
| 8.9 | When any stat is averaged or has multiple recorders | "Stats needing review" section appears (amber card) with list; each row has Correct and "Set primary recorder" (scrolls to Primary recorder section) |

---

## 9. Season stats (Leaderboard & Player Profile)

**Precondition:** Signed in; at least one finalized game with stats; migrations 010 applied.

| Step | Action | Expected |
|------|--------|----------|
| 9.1 | Home → Season Stats (or Teams → Season Stats) | Leaderboard; team selector |
| 9.2 | Select team with finalized games | List of players with season totals; sortable (e.g. by Points) |
| 9.3 | Tap a player row | Player Profile (season totals, per-game avg, games played) |
| 9.4 | Game Log section | List of finalized games for that player |
| 9.5 | View (on a game) | Loads game and navigates to Summary |
| 9.6 | Leaderboard: change "Sort by" | Order updates (e.g. by Assists) |
| 9.7 | Leaderboard: change **Season** dropdown | Team list filters; URL updates `seasonId` |
| 9.8 | Leaderboard: **Team stats →** | Opens `/team-stats` with W/L and game list; header back returns to Team Info when opened with `teamId` |
| 9.9 | Player Profile: **Career →** | Opens `/career` with totals; migration **020** applied for RPC |
| 9.10 | Teams → roster **Career** on a player | Same as 9.9 |
| 9.11 | Team stats → tournament row **Stats →** | Opens tournament stats; W/L and leaderboard when games have `tournament_id`; header back returns to Team Info and inline Team stats returns to `/team-stats` |
| 9.12 | Game Summary → **Team** tab | Only team totals tables + score card; **Players** shows full grid |
| 9.13 | Team stats → **By opponent** | Table lists opponents with W-L-T and PF-PA when multiple finals exist |
| 9.14 | Leaderboard: tap **Career** on a row (not the main row) | Opens `/career` with that `playerId` and the season’s sport |
| 9.15 | Tournament stats (as owner/admin): **Placement** → enter place (e.g. 2) → **Save placement** | Record card shows placement (e.g. 2nd); blank + save clears placement |
| 9.16 | `/career` (basketball, player with FT/2PT/3PT stats); migration **026** applied | **Career totals** category tables: M/A + %, **Per game**, **Best game** as links → open **Game Summary** for that final |
| 9.17 | Player Profile (team with finals); **026** applied | **Season totals** same table layout; **Best game** links load summary |

---

## 10. Team invites

**Precondition:** Signed in; migrations 011 applied; two distinct user accounts (inviter = owner/admin, invitee = other).

| Step | Action | Expected |
|------|--------|----------|
| 10.1 | As owner: Teams → Manage team → Team Members | Member list; "Invite by email" section |
| 10.2 | Enter invitee email → Lookup | User found; display name shown |
| 10.3 | Choose role (Scorer / Admin) → Send Invite | Invite sent; member row shows "Pending" |
| 10.4 | As invitee: sign in → Teams | "Pending invites" banner with team name |
| 10.5 | Accept | Banner clears; team appears in list; member shows "Accepted" |
| 10.6 | As invitee: open team | Can see roster; can start games for that team |
| 10.7 | As owner: Team Manage → Team Members | Invitee listed with role; Remove available |
| 10.8 | As invitee: Decline (alternative flow) | Invite removed; team no longer in list |
| 10.9 | As admin (invited as admin): same team → Invite by email | Can lookup and send invite |

---

## 10a. Security role baseline (SEC-1)

**Precondition:** Four accounts: team owner, accepted admin, accepted scorer, and a user
with a pending invite. Use test data only. The full approved contract and API-level cases
live in [`ACCESS_MATRIX.md`](ACCESS_MATRIX.md). Apply migration
`035_team_access_hardening.sql` before running these cases.

| Step | Action | Expected |
|---|---|---|
| 10a.1 | Pending invitee opens direct Team Info, roster, game, and stats URLs | Invite summary remains visible, but all team data is denied until acceptance (SEC-1) |
| 10a.2 | Pending invitee attempts a direct team member, game, stat, correction, or merge write | Server denies every write (SEC-1) |
| 10a.3 | Owner invites an admin and a scorer | Both invites are created without changing any existing owner/admin membership |
| 10a.4 | Admin invites and then removes a scorer | Both actions succeed; the scorer loses team access (SEC-1) |
| 10a.5 | Admin attempts to remove or change owner/admin membership | Controls are absent and direct API calls are denied (SEC-1) |
| 10a.6 | Accepted scorer opens Team Info and starts, resumes, tracks, and finalizes a game | Game workflow succeeds |
| 10a.7 | Accepted scorer opens Team Manage and Advanced settings | Read-only/unavailable state; roster/member/destructive controls are absent (SEC-1) |
| 10a.8 | Scorer attempts stat correction, primary-recorder reassignment, player merge, team delete, or game delete | UI does not offer action and server denies direct call |
| 10a.9 | Accepted scorer views the team member summary | Names and roles are visible; member email addresses are not exposed (SEC-1) |
| 10a.10 | Recorder attempts to write a stat or shot to an unrelated or final game | Server denies the write (SEC-1) |
| 10a.11 | Owner attempts Leave Team or directly deletes their own membership row | Denied until a future ownership-transfer flow exists (SEC-1) |

---

## 10b. Viewer role (SEC-2)

**Precondition:** Apply `036_viewer_team_role.sql`. Use owner, admin, scorer, and viewer
accounts on the same test team, with one in-progress and one finalized cloud game.

| Step | Action | Expected |
|---|---|---|
| 10b.1 | Owner or admin invites Viewer by email; invitee accepts | Viewer appears accepted in the shared member list |
| 10b.2 | Viewer opens Team Info, roster, schedule, season/player/team stats, and member list | Reads load; member emails remain hidden |
| 10b.3 | Viewer opens Cloud Games and selects an in-progress game | Read-only Game Info opens with no Resume/Open Game action |
| 10b.4 | Viewer selects a finalized game | Full summary loads; correction and primary-recorder controls are absent |
| 10b.5 | Viewer opens direct setup or live-tracker URLs for the accepted team | Start/tracking controls are unavailable; the tracker shows a read-only access state |
| 10b.6 | Viewer directly calls game/stat/checkout/shot/tournament-create writes | RLS denies each write |
| 10b.7 | Viewer opens Team Manage | Roster/member controls and Claim guardianship are absent; Leave Team remains available |
| 10b.8 | Admin changes scorer to viewer, viewer to scorer, and removes a viewer | All succeed; admin still cannot change/remove owner or admin |
| 10b.9 | Viewer directly attempts a guardian claim for a player on the viewed team | RLS denies the insert pending SEC-4 |

---

## 10c. Team invite links (SEC-3)

**Precondition:** Apply `037_team_invite_links.sql`. Use owner, admin, scorer, viewer,
pending-invite, and unrelated signed-out/signed-in test accounts.

| Step | Action | Expected |
|---|---|---|
| 10c.1 | Owner creates Viewer and Scorer links in Team Manage | Both active links appear with role, expiry, Copy, and Revoke |
| 10c.2 | Admin creates and revokes a link | Both actions succeed; opening the revoked link shows unavailable |
| 10c.3 | Scorer/viewer calls create, list, or revoke RPCs directly | Server denies each call |
| 10c.4 | Signed-out user opens a valid link, signs in with email/password, and confirms | User returns to the invite, joins with the fixed role, and reaches Team Info |
| 10c.5 | Signed-out user opens a valid link and signs in with Google | OAuth returns to the same invite for confirmation |
| 10c.6 | A second user opens an already redeemed link | Link is unavailable and cannot create another membership |
| 10c.7 | Invitee opens an expired link or a manager revokes it before redemption | Link is unavailable and redemption is denied |
| 10c.8 | Existing accepted member or team owner tries an active link | Redemption is denied and the link remains available for its intended recipient |
| 10c.9 | User with a pending email invite tries a link for the same team | Redemption is denied with direction to resolve the pending email invite; link remains active |
| 10c.10 | Owner/admin continues using Invite by email | Existing lookup, invite, accept, and decline flow still works |

---

## 10d. Player guardianship (SEC-4)

**Precondition:** Apply `038_guardianship_hardening.sql`. Use creator, unrelated guardian,
team owner, admin, scorer, viewer, pending-member, and non-member test accounts. Include an
active roster player and a removed/inactive roster player.

| Step | Action | Expected |
|---|---|---|
| 10d.1 | Create players through Team Manage, Player Setup, and first cloud sync | Each non-placeholder player gets one creator guardian link; no duplicate links appear |
| 10d.2 | Accepted scorer claims an active roster player from Team Manage | Claim succeeds, Guardian status appears, and the player is immediately available in the scorer's player pool |
| 10d.3 | Viewer, pending member, non-member, or accepted member using an unrelated team/player pair calls the claim RPC | Every claim is denied; knowing player and team UUIDs is insufficient |
| 10d.4 | Accepted scorer calls claim for an inactive roster entry | Claim is denied because the player is not active in that team context |
| 10d.5 | Creator/guardian opens Edit on a roster where they are only scorer or viewer | First name, last name, and nickname are editable; jersey remains disabled |
| 10d.6 | Guardian calls direct `players` UPDATE or attempts to change `created_by` / `is_team_placeholder` | Direct update is denied; identity changes succeed only through `update_player_identity` |
| 10d.7 | Owner/admin without a player relationship edits the roster row | Jersey edit succeeds; identity fields remain disabled and direct identity RPC is denied |
| 10d.8 | Creator opens Guardians and removes another guardian | Removal succeeds and the creator retains identity/pool access |
| 10d.9 | Owner/admin of a team containing the player removes a guardian | Removal succeeds; a scorer, viewer, or unrelated manager cannot remove another guardian |
| 10d.10 | Current guardian removes their own relationship | Relationship disappears and a non-creator player leaves their pool; team membership and roster entry are unchanged |
| 10d.11 | Existing guardian is changed to viewer | Guardian identity/pool rights remain relationship-based, but the viewer cannot claim another player |
| 10d.12 | Open the guardian dialog as manager, creator, or guardian | Guardian display names and Creator/you labels appear; no guardian email is returned or shown |

---

## 10e. App-level access (SEC-5)

**Precondition:** Apply `039_app_level_access.sql`. Replace the email placeholder and run
`supabase/scripts/bootstrap_app_admin.sql`. Use active regular, pending, suspended, and app-admin
accounts; keep one team that the app admin does not belong to.

| Step | Action | Expected |
|---|---|---|
| 10e.1 | Existing active account signs in after migration 039 | App routes load normally; existing profile/team access is unchanged |
| 10e.2 | App admin opens Settings -> Advanced -> App access and searches by name/email | Matching accounts load with status and app role; ordinary users do not see this section |
| 10e.3 | App admin sets a test account to Pending; that account signs in or selects Check again | Access pending replaces the app shell; parked-game/settings providers and normal routes do not mount |
| 10e.4 | Pending account directly calls a table or any RPC except `get_my_app_access` through the Data API | Request fails with `APP_ACCESS_PENDING` before the table/RPC operation runs |
| 10e.5 | App admin changes the test account to Suspended; account checks again | Suspended gate appears; cloud routes and authenticated local/offline continuation remain unavailable |
| 10e.6 | App admin reactivates the test account; account selects Check again | Normal sport/app shell loads without signing in again |
| 10e.6a | Change an open active session to Pending, then refocus its window | The access gate replaces the app without a full page reload |
| 10e.6b | While the changed account remains focused, trigger any cloud read/write | The first `APP_ACCESS_*` response immediately replaces the mounted app with the access gate |
| 10e.7 | Ordinary user calls `list_account_access` or `set_account_access` directly | RPC denies the request; direct `account_access` table access is also denied |
| 10e.8 | App admin tries to suspend/demote self or opens a team without membership | Self-lockout is denied; unrelated team data remains denied by team RLS |
| 10e.9 | Create a new email or Google account | Account access row is created as active/user and the app loads normally |
| 10e.10 | Run without Supabase configuration | Existing local-only mode remains available without app-access checks |

---

## 10f. Access audit trail (SEC-6)

**Precondition:** Apply `040_access_audit_trail.sql`. Use team owner, admin, scorer, viewer,
pending, unrelated, and app-admin accounts. New history starts after migration 040; no earlier
actions are backfilled.

| Step | Action | Expected |
|---|---|---|
| 10f.1 | Owner/admin opens Team Manage -> Access activity | Recent events for only that team load; scorer/viewer users do not see the panel |
| 10f.2 | Invite by email, accept/decline an invite, cancel a pending invite, remove/leave, and change an accepted role | Each successful mutation creates one appropriately labeled event with actor, target, role metadata, and timestamp |
| 10f.2a | Change the role on a pending email invite without resending it | One role-change event records previous/new roles and `pending: true` |
| 10f.3 | Create, redeem, and revoke invite links | Each action creates an event containing link id/role but no invite token |
| 10f.4 | Attempt a member/link action that server authorization rejects | The action fails and no audit event is committed |
| 10f.5 | Scorer, viewer, pending, or unrelated user calls `get_access_audit_events` for the team | RPC denies every call; direct audit-table writes are also denied |
| 10f.6 | Team owner/admin requests audit history for another team | RPC and table RLS deny access unless the account is also owner/admin there |
| 10f.7 | App admin opens Settings -> Advanced -> Audit activity | Global member, invite-link, and app-access events load across teams |
| 10f.8 | App admin changes an account status or app role | A global `app_access_changed` event appears without granting team access |
| 10f.9 | Inspect `access_audit_events.metadata` after all scenarios | No email secrets, invite tokens, access tokens, or refresh tokens are stored |

---

## 11. PWA & offline

**Precondition:** Production build or deployed site (HTTPS or localhost).

| Step | Action | Expected |
|------|--------|----------|
| 11.1 | Open app in supported browser (e.g. Chrome Android, Safari iOS) | Install prompt or menu option "Install" / "Add to Home Screen" |
| 11.2 | Install | App icon on home screen; opens in standalone window |
| 11.3 | Load app → go offline (devtools or airplane) | Cached shell loads; existing UI works where data is cached |
| 11.4 | Go back online | Sync resumes (if Supabase); no crash |

---

## 11a. Shared event foundation (SOC-1)

**Precondition:** Existing basketball local/parked games; migration
`042_game_events.sql` applied only when testing the isolated cloud repository. Soccer remains
disabled in production; SOC-2A later installs production soccer match-state definitions.

| Step | Action | Expected |
|------|--------|----------|
| 11a.1 | Resume a basketball game saved before SOC-1 | Game loads and tracks normally; its missing event field normalizes to `eventStream: null` |
| 11a.2 | Export and re-import legacy plus current parked games | All valid games import; legacy games remain aggregate-only and event stream data is preserved unchanged |
| 11a.3 | Track, undo, park, resume, sync, and summarize basketball | Existing stats, action log, shot chart, and cloud behavior are unchanged |
| 11a.4 | Inspect sport selection and tracker routes | Soccer remains disabled; SOC-1 adds no visible tracker controls |
| 11a.5 | As owner/admin/scorer, call the isolated event write helper twice with identical id/revision/data | First response is `applied`; second is `idempotent` |
| 11a.6 | Write a lower revision, then an equal revision with changed payload | RPC reports `stale`, then `conflict`; existing cloud row is unchanged |
| 11a.7 | As viewer or with another recorder's row id, attempt an event write | RLS/RPC rejects the write; accepted viewers can read team event rows |
| 11a.8 | Attempt an ordinary SQL/client delete | No client delete policy exists; revisioned tombstone update is the supported path |

---

## 11b. Soccer match-state foundation (SOC-2A)

**Precondition:** Development branch with SOC-2A. Soccer remains hidden from production
navigation; these checks primarily protect persistence and event authority before SOC-2B UI.

| Step | Action | Expected |
|------|--------|----------|
| 11b.1 | Run `pnpm test` | Soccer rules, all 14 match-state schemas, lifecycle replay, exact participation, batch atomicity, and semantic-stop tests pass |
| 11b.2 | Initialize a soccer event stream in a test/dev state with a resolved `sportGameState` setup | Opening lineup, period start, and clock start can append as one batch and produce one coherent projection |
| 11b.3 | Introduce an invalid historical substitution followed by later events | Raw events remain stored; projection stops before the invalid substitution; the offending and later rows have diagnostics |
| 11b.4 | Park, export, import, and resume an event-backed soccer state | Setup and raw events survive; projection rebuilds; the parked record is not queued for aggregate cloud sync |
| 11b.4a | Configure soccer setup before stream initialization, then allow persistence/sync processing to run | The setup-only game remains local and aggregate sync does not create a cloud game |
| 11b.5 | Dispatch a legacy stat, score, shot, undo, or period action after event-stream initialization | Reducer returns the unchanged event-backed state |
| 11b.6 | Resume a legacy basketball game and track/sync normally | `sportGameState` normalizes to `null`; aggregate reducer and cloud behavior remain unchanged |

---

## 11c. Soccer setup, roster, lineup, and kickoff (SOC-2B)

**Precondition:** Run the Vite development server. Soccer remains unavailable in production
builds until SOC-6. Use a soccer cloud team with at least two active players for cloud-source
checks.

| Step | Action | Expected |
|------|--------|----------|
| 11c.1 | Open the sport chooser with Soccer disabled in persisted settings | A Soccer development-preview card is available; Settings labels it Preview and does not offer a toggle |
| 11c.2 | Start a new Soccer match and edit regulation preset/count, period labels/durations, clock display, player maximum, substitution limits, extra time, and shootout availability | Valid rules remain stable while segment count changes; Continue blocks invalid or incomplete match rules |
| 11c.3 | Use a local team source, enter match information, continue, and add local players | The Match Roster step lists players and allows selecting only this match's participants |
| 11c.4 | Return to setup, choose an accessible cloud soccer team, and continue | Its active roster loads read-only; no cloud game is created and `cloudSync` remains unbound |
| 11c.5 | Add a game-only participant while using a cloud roster, then return between roster and lineup steps | The anonymous participant keeps one stable match-local identity |
| 11c.6 | Assign Starter/Bench and roles with no starting goalkeeper or with more starters than the configured maximum | Kickoff is blocked with a focused validation message |
| 11c.7 | Add or assign exactly one starting goalkeeper, leave the lineup below the maximum, and choose Start Match | A short-handed confirmation appears before kickoff |
| 11c.8 | Confirm kickoff | Opening lineup, first period, and running clock begin together; `/game` shows `MM:SS`, direction, On Field, and Bench without the legacy stat grid |
| 11c.9 | Background the tab briefly, return, park the match, then resume it | The displayed clock advances from its persisted anchor and resume returns to `/game` |
| 11c.10 | Build for production, open an existing soccer Team Info page or `/#/setup?teamId=<soccer-team>`, and attempt to reach a stale/imported active soccer setup through `/setup`, `/players`, `/checkout`, `/game`, or `/summary` | Team Info hides Start Game, the team deep-link does not create or bind a soccer session, Soccer cards are absent, and active soccer route surfaces redirect to the sport chooser |
| 11c.11 | Start and track a basketball game | Existing setup, roster, checkout, tracker, parking, and cloud behavior are unchanged |

---

## 12. GitHub Pages deploy

**Precondition:** Repo has Actions workflow; Pages source = GitHub Actions; secrets set.

| Step | Action | Expected |
|------|--------|----------|
| 12.1 | Push to branch that triggers workflow (e.g. `stattracker`) | Actions run: install, build, deploy |
| 12.2 | Settings → Pages | Build from Actions; URL shown (e.g. `https://<user>.github.io/cursor-default/`) |
| 12.3 | Open deployed URL | App loads; correct base path (e.g. `/cursor-default/`) |
| 12.4 | Sign in on deployed site | Auth works (Supabase secrets baked into build) |
| 12.5 | Console on deployed site | "[StatKeeper] Supabase connected" (no "credentials not found") |

---

## Quick smoke (minimal path)

1. **Offline:** Sport → Setup → 2 players → Game → tap stats → Summary.  
2. **Cloud:** Sign in → Teams → create team + 2 players → Cloud Games → new game from that team → record stats → Summary → Finalize.  
2b. **Merge (024):** Teams as owner/admin → **Merge players** → complete wizard with **MERGE** confirm (use test duplicates only).  
3. **Season:** Season Stats → pick team → open a player → View a game from Game Log.  
4. **Invite:** Owner invites by email → Invitee accepts in Teams → both see same team.

---

## Notes

- **App access migration:** SEC-5 requires `039_app_level_access.sql` plus one manual run of `supabase/scripts/bootstrap_app_admin.sql` with an existing profile email.
- **Access audit migration:** SEC-6 requires `040_access_audit_trail.sql`; history begins when the migration is applied.
- **HashRouter:** In-app links use hash routes (e.g. `/#/game`, `/#/teams`).  
- **Shot chart SVG (dev QA):** `/#/dev/shot-chart` — see **§4d** above (`ShotChartPreview.tsx` + optional auth bypass in `App.tsx` only in dev). End-user court capture is inline on `/#/game` — see **§4e**; legacy `/#/shot-chart` redirects there.
- **localStorage:** Game and settings key `statkeeper_game`; clear to reset local state.  
- **Migrations:** If a cloud feature fails, confirm the migrations listed in [README.md](../README.md) through **`042_game_events.sql`** are applied in order. Seasons and roster integrity need **019** (run `supabase/scripts/audit_data_integrity_pre_019.sql` first on legacy DBs). Player merge needs **024**/**025** and **041**; team stats **028–031**; shot chart **032**; diagnostics **033**; Google profiles **034**; team security **035–038**; app access **039**; access audit **040**; shared events **042**.

---

## 13. Data integrity (after migration 019)

**Precondition:** Migration `019` applied; no duplicate-team or duplicate-jersey violations in DB.

| Step | Action | Expected |
|------|--------|----------|
| 13.1 | Teams → create new season **without** season name → Create Team | Button disabled or error: season name required |
| 13.2 | Teams → create team in a season, then create **another** team same name same season | Error: duplicate team name in season |
| 13.3 | Teams → roster: two active players with same non-empty jersey number | Second add fails with friendly error |
| 13.4 | Game Setup → existing team → tournament **+ Add new** → leave name empty → Next | Error: enter tournament name |
| 13.5 | Game Setup → New Team (cloud) → pick **Season for new team** matching an existing season → complete game → sync | Cloud team attaches to that season (not only year-from-date) |
