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
| 3a.18 | Park a dirty cloud-bound game A, start/open another local game B, then Cloud Games/Settings Advanced → Delete game A (or its team/season) | Delete is blocked with an unsynced-local message; parked A remains; cloud row is not deleted |
| 3a.18a | Repeat season delete with a migrated/imported dirty game whose cloud `seasonId` is absent but whose cloud `teamId` belongs to that season | Delete is still blocked by the team-to-season relationship; the local and cloud game remain |

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

## 11a. Shared event foundation (SOC-1 / BKE-1A)

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
| 11a.9 | Load or import a Soccer shell whose event stream and sport state are both null or whose setup fails normalization | It remains ineligible for legacy aggregate cloud sync; no `game_stats` write path is selected |
| 11a.10 | Check aggregate sync eligibility for configured Basketball, Baseball, Football, and Hockey games with null event/sport state, then an unknown sport id | The four configured legacy sports remain eligible; the unknown sport fails closed |
| 11a.11 | Inspect a neutral-side fixture through a default event definition, then one explicitly allowing neutral | The default definition rejects it; the opted-in definition accepts it; Soccer definitions continue to reject neutral |
| 11a.12 | Apply one atomic command containing event update, tombstone, and restore operations | Every target advances one revision at the same timestamp, projection rebuilds once, and any invalid member or final diagnostic returns the original state unchanged |

---

## 11a1. Basketball state and lifecycle foundation (BKE-1B1)

**Precondition:** No Basketball event game is exposed in the app. These checks are automated/library
proofs; ordinary Basketball games must remain on the existing aggregate path.

| Step | Action | Expected |
|------|--------|----------|
| 11a1.1 | Create and normalize a Basketball setup fixture | Rules, stable regulation/overtime identities, source metadata, and tracked/opponent participants survive; persisted projection is discarded and capture preferences normalize |
| 11a1.2 | Replay period start/end, late roster addition, participant resolution, and match end events | Projection deterministically rebuilds status, period history, effective participants, and result without mutating setup |
| 11a1.2a | Inspect each Basketball lifecycle family with neutral, tracked, and opponent event sides | Neutral is accepted; tracked/opponent variants are rejected because lifecycle facts belong to neither team |
| 11a1.3 | Start overtime after all regulation segments complete | `overtime-1` is appended with the snapshotted template label, duration, and canonical order |
| 11a1.4 | Replay an out-of-order period, duplicate recorder sequence, duplicate participant/player identity, or previous-period lifecycle action | The stream is preserved, projection fails closed, and a focused diagnostic identifies the invalid transition |
| 11a1.5 | End as suspended, then append a reasoned reopen | Status returns to the latest period state; end reason/result clear and existing events remain byte-identical |
| 11a1.6 | Change only Basketball projection/capture preferences, then change immutable setup | Runtime-only changes leave the fingerprint unchanged; setup changes alter it |
| 11a1.7 | Park and resume recognized Basketball setup with falsified persisted projection | Setup and preferences survive; projection returns to the clean event-derived baseline |
| 11a1.8 | Inspect the production event registries and start a normal Basketball game | Basketball is registered internally after BKE-1B3, but normal games continue using aggregate tracking/sync until BKE-1C |

---

## 11a2. Basketball stat-event projection (BKE-1B2)

**Precondition:** Basketball event games remain internal fixtures; ordinary game creation stays on
the aggregate path until BKE-1C.

| Step | Action | Expected |
|------|--------|----------|
| 11a2.1 | Replay located/unlocated 2PT/3PT and grouped/ungrouped free throws for tracked and opponent sides | Score and make/miss totals rebuild; only located field goals produce unchanged `ShotRecord` rows |
| 11a2.2 | Record linked/unlinked assists, offensive/defensive rebounds, steals, blocks, player turnovers, and team turnovers | Participant, side, and explicit pseudo-player totals match actor/side semantics; links never control whether a stat counts |
| 11a2.3 | Record signed scoreboard/unattributed adjustments and an official correction | Signed deltas affect only the selected side; an official correction without a non-empty note is rejected |
| 11a2.4 | Record a located geometry-derived shot with a mismatched value, then an explicit manual override | The first event is rejected; the override is accepted, retains its chosen value, and derives zone from the actual coordinates |
| 11a2.5 | Link to a missing/tombstoned/future/wrong-side/wrong-outcome event or duplicate a free-throw attempt position | The independent fact and total survive; a relationship warning is projected; authoritative stream completeness is unchanged |
| 11a2.6 | Attribute a player event to a missing participant, mismatched resolved player, or wrong side | Projection stops at the offending event, preserves later rows as unprojected diagnostics, and cannot be authoritative |
| 11a2.7 | Replay the approved reducer-equivalence fixture without score adjustments | Player/team totals, displayed score, and located shot rows match the legacy reducer |
| 11a2.8 | Inspect `gameEvents/runtime.ts` and run an ordinary Basketball game | Basketball definitions/projector are registered internally; aggregate Basketball behavior is unchanged because creation does not initialize event state |

---

## 11a3. Basketball administration and authority (BKE-1B3)

**Precondition:** Ordinary Basketball game creation remains aggregate-only. Use library fixtures for
event-authoritative Basketball checks.

| Step | Action | Expected |
|------|--------|----------|
| 11a3.1 | Replay player, staff, and team fouls across two periods | Personal/team/technical totals and per-period team fouls derive from events; explicit counting overrides replace default semantics |
| 11a3.2 | Cross the snapshotted team-foul and personal-foul thresholds | Bonus state changes at the configured thresholds and the player becomes disqualified at the configured limit |
| 11a3.3 | Record charged full/30-second and neutral media/official timeouts | Charged usage belongs to the selected side and period; neutral stoppages never fabricate side ownership |
| 11a3.4 | Apply positive and negative manual-minute adjustments | No-clock games sum signed adjustments; a negative projected total fails closed; anchored-clock rules ignore manual adjustments |
| 11a3.5 | Eject a player or staff member, including an advisory link to a stale foul | Player/staff ejection state derives correctly; stale links emit relationship warnings without discarding the independent fact |
| 11a3.6 | Initialize or mutate a Basketball event fixture | `gameDataAuthority` is stamped `sport_events`, included in fingerprints, and preserved across parking/import |
| 11a3.7 | Remove or corrupt the stream/setup of a marked fixture, then attempt aggregate writes/sync | Recovery diagnostics identify missing authoritative data; reducer writes and aggregate cloud sync fail closed |
| 11a3.8 | Create and track an ordinary Basketball game | It remains unmarked and uses the unchanged aggregate reducer/sync path until BKE-1C |

---

## 11a4. Basketball lifecycle and participants (BKE-2A)

**Precondition:** Development build with a healthy, local Basketball event game created through the
internal event-model option. Event Basketball remains unavailable for cloud/team checkout.

| Step | Action | Expected |
|------|--------|----------|
| 11a4.1 | Start a Basketball event game | Period 1 is active; the lifecycle band shows the snapshotted label and End Period; legacy free-select period tabs remain absent |
| 11a4.2 | Select a tracked player, choose Add Participant, and add a tracked individual | The sheet defaults to Tracked; one roster-added event appends; the participant is selected immediately without changing the immutable opening setup |
| 11a4.3 | Add an opponent participant with an optional number, then park and resume | The opponent participant retains stable identity, side, number, selector row, and capture selection |
| 11a4.4 | Submit a blank name or a duplicate stable id through the checked command | The command returns the original state and the focused sheet keeps its entered values with an inline error |
| 11a4.5 | End Period 1, inspect the tracker, then start the next period | Court capture and chart corrections are read-only during the break; only the sequential next-period action is offered |
| 11a4.6 | Advance through the final regulation period with a tied score | End Game is unavailable and exactly one next overtime can be started from the immutable template |
| 11a4.7 | End tied overtime and start another, then finish an overtime with a non-tied score | Overtime ids/orders remain sequential; End Game appears only after the completed non-tied period |
| 11a4.8 | Confirm End Game, then return to the tracker | The local result is projected as final; ordinary capture, Add Participant, and correction controls remain read-only; Summary stays available |
| 11a4.9 | Open Recent Events after a capture and period transition | Lifecycle rows are visible as Boundary; ordinary Undo cannot cross the newest boundary; a latest late-participant addition can still be undone and restored as one unit |
| 11a4.10 | Create and track an ordinary legacy Basketball game and a Soccer game | Legacy reducer Basketball and Soccer tracker/lifecycle behavior remain unchanged |

---

## 11a5. Basketball direct stats, score, and minutes (BKE-2B)

**Precondition:** Development build with a healthy, local Basketball event game and an active
period. Include tracked and opponent participants plus both team chips.

| Step | Action | Expected |
|------|--------|----------|
| 11a5.1 | Use every player-grid `+` action, including made/missed FT, 2PT, and 3PT | Each tap appends one checked event and updates projected totals; direct field goals/free throws have no court marker |
| 11a5.2 | Select each team chip and use Team Turnover | Team-only controls never charge a player; BKE-2C2 additionally exposes the selected side's Foul and Technical actions through its structured sheet |
| 11a5.3 | Use quick scoreboard `+1/-1` on both sides, including `-1` at zero | Score adjustments append without a sheet; a negative result is disabled/rejected and made-shot scoring remains additive |
| 11a5.4 | Open Official correction and submit blank, fractional, zero, valid positive, and valid negative adjustments | Invalid drafts remain open with no mutation; valid signed whole deltas require a note and update only the selected side |
| 11a5.5 | Record Steal + Turnover against a rostered opponent, Unknown player, and Team | Each submit atomically appends one linked two-event capture with the correct opposite-side actor; ordinary stat decrement cannot split it |
| 11a5.6 | Decrement standalone assists, rebounds, steals, blocks, turnovers, and minutes | The newest matching standalone event is corrected; minutes append `-1`; controls stop at zero |
| 11a5.7 | Decrement a field goal linked to an assist, rebound, and block | Confirmation names exact effects; shot/assist/rebound are removed atomically, the block survives unlinked, and Restore reverses the complete batch |
| 11a5.8 | Decrement a free throw with a linked rebound | Confirmation removes the attempt and rebound while preserving any trip; immediate Restore returns both |
| 11a5.9 | Perform a consequential decrement, park/reload, then Restore | The validated direct-decrement receipt survives normalization and restores only while revisions still match |
| 11a5.10 | End a period or game and inspect court, grid, score, and compound controls | All ordinary capture/correction controls are disabled; no legacy reducer fallback appears |
| 11a5.11 | Start a new period with a prior-period standalone stat but no current-period match | The game total remains visible, but quick grid decrement is disabled and cannot cross the lifecycle boundary |
| 11a5.12 | Repeat representative grid/score actions in an ordinary legacy Basketball game and open Soccer | Existing aggregate Basketball and Soccer behavior remain unchanged |

---

## 11a6. Basketball foul and free-throw domain (BKE-2C1)

**Precondition:** Library tests use a healthy local Basketball event game with an active period.
BKE-2C1 intentionally exposes no tracker controls; manual UI checks begin in BKE-2C2.

| Step | Action | Expected |
|------|--------|----------|
| 11a6.1 | Capture player, team, and staff fouls with ordinary and exceptional counting | Actors and counting overrides validate; blank override reasons, wrong-side players, unavailable players, and invalid offensive-control sides leave state unchanged |
| 11a6.2 | Capture a foul with an awarded trip | Foul and trip append atomically under one command id; the trip belongs to the opposite side and links to its source foul |
| 11a6.3 | Record one-, two-, and three-attempt trips; try one-and-one outside its configured post-foul bonus window or on a non-counting/technical foul; then separately delete made and missed valid first attempts | Award/rules and technical/foul context mismatches are rejected; attempt positions are stable; attempt 2 requires an active made attempt 1, so neither deleted outcome creates an unearned second attempt |
| 11a6.4 | Remove and restore an attempted free-throw trip | The trip is removed, attempts remain authoritative but ungrouped, and exact trip ids/positions restore after receipt serialization |
| 11a6.5 | Decrement a foul linked to a trip plus official, matching automatic-threshold, and stale other-subject ejections | Preview reports personal/team/technical, bonus, disqualification, unlink, and automatic-removal effects; correction removes only the matching invalidated automatic ejection and unlinks the surviving official/stale ejections; Restore reverses the full batch |
| 11a6.6 | Delete an attempt, then request another for the same trip | A tombstoned attempt position is never reused; exhausted trips reject further attempts |
| 11a6.7 | Attempt capture/correction during a period break, after completion, or with a cloud binding | Commands return the original state; no aggregate fallback or partial append occurs |
| 11a6.8 | Carry team fouls from one overtime into the next, add the new overtime's only foul, then preview its removal | The new overtime starts with the carried bonus state and `bonusStatusAfter` returns to that state instead of `none` |

---

## 11a7. Basketball foul and awarded-free-throw UI (BKE-2C2)

**Precondition:** Development build with a healthy, local Basketball event game and an active
period. Begin with tracked participants and both team chips; add an opponent participant when the
matrix requests one.

| Step | Action | Expected |
|------|--------|----------|
| 11a7.1 | Select a player and tap PF `+` | The foul sheet opens with that player's side/player selected and Personal + Common defaults; cancelling changes nothing |
| 11a7.1a | Reach the personal-foul limit, then inspect that player's PF controls | PF `+` is disabled so it cannot silently fall back to a team offender; PF `-` remains available for correction |
| 11a7.2 | Select each team chip and tap Foul or Technical `+` | The sheet uses that side and a team offender; Technical defaults to Technical + Administrative and, under the version-1 NFHS baseline, derives both technical and team-foul/bonus counts from the one foul event |
| 11a7.3 | Switch side/offender, use a staff label, select a drawn-by player or unknown label, and exercise offensive/non-offensive team control | Candidate lists remain side-correct, required labels are enforced, and successful captures project the chosen actors/context |
| 11a7.4 | Enable Advanced counting override with and without a reason | Submit remains disabled without a reason; valid personal/team/technical choices become the authoritative projected counts |
| 11a7.5 | Award 1, 2, 3, technical, possession-retained, and valid one-and-one trips | Foul plus award append atomically; failures remain in the foul sheet; success opens the awarded-trip workspace for the opposite side |
| 11a7.6 | With no opponent participant, award the opponent a trip; use Add player, then reopen the trip and record Made/Miss attempts | The workspace explains why capture is blocked and opens the late-participant flow on the awarded side; the resumed trip accepts the new shooter, updates projected totals, closes after its final position, and creates no court marker |
| 11a7.7 | Miss the first one-and-one attempt; separately leave a fixed trip partial, close the sheet, park/reload, and resume it | The one-and-one closes without a second attempt; the partial trip remains visible as open work with its stable next position and prior shooter suggestion |
| 11a7.7a | Decrement a trip-linked made or missed FT from the player grid | Confirmation warns that the awarded position stays consumed; after removal the corrected trip remains in the workspace for review or whole-award removal |
| 11a7.8 | Decrement player PF, team Foul, and team Technical values | Each confirmation names personal/team/technical, bonus, disqualification, unlink, and automatic-ejection effects before applying the newest current-period match |
| 11a7.8a | Trigger failures in two different capture/correction families, then complete valid work | Only the newest error is visible, and a later successful action clears stale tracker feedback |
| 11a7.9 | Remove an empty and attempted free-throw award, then use immediate Restore | The confirmation names surviving unlinked attempts; removal preserves their totals and Restore re-links the exact trip/positions |
| 11a7.10 | End the period/game, then repeat representative actions in a legacy Basketball game and open Soccer | Event foul/trip controls are disabled outside active periods; legacy Basketball and Soccer behavior remain unchanged |

---

## 11a8. Basketball official ejections (BKE-2C3)

**Precondition:** Development build with a healthy, local Basketball event game and an active
period. Include at least two tracked players; record a staff foul when testing the staff-link path.

| Step | Action | Expected |
|------|--------|----------|
| 11a8.1 | Open Official ejections, select a player, enter a reason, and record | One official-ruling event is appended; the player chip shows Ejected and the ruling appears in the focused list and Recent Events |
| 11a8.2 | Select the ejected player and try the court, made/missed grid actions, related stats, PF, minutes, and Steal + Turnover | History and decrements remain available, but every new player-stat path is disabled in the UI and rejected by checked commands |
| 11a8.3 | Reach the foul limit without an official ruling | The player chip shows DQ; no automatic ejection event is fabricated and the player is unavailable for new stats |
| 11a8.4 | Officially eject that disqualified player, then remove the official ruling | Ejected overlays the DQ label; removal clears only ejected state and confirmation warns that foul-limit disqualification remains |
| 11a8.5 | Restore the removed official ruling after parking/reload | The exact ejection id/revision returns and the player is marked ejected again |
| 11a8.6 | Record a player or staff foul, then eject the same subject with the optional foul link | Only current-period, same-side, same-subject fouls are offered and accepted; wrong-subject/stale ids are rejected without mutation |
| 11a8.7 | Record a staff ejection with a required label/reason, then remove it | The staff actor remains labeled and separate from player participants; removal keeps any linked foul and Restore reinstates the ruling |
| 11a8.8 | Try blank reasons, duplicate subjects, a period break, a completed game, and a cloud-bound event game | Capture remains in the sheet on validation failure; no partial event, aggregate fallback, or cloud write occurs |

---

## 11a9. Basketball timeouts and BKE-2C exit (BKE-2C4)

**Precondition:** Development build with a healthy, local Basketball event game and an active
period. Use one finite timeout profile and one profile with unlimited regulation inventory.

| Step | Action | Expected |
|------|--------|----------|
| 11a9.1 | Open Timeouts and record tracked/opponent Full and 30-second charged timeouts | The selected side's team actor owns each event; the inventory band and team period stat increment from projection and Recent Events shows the captured snapshot label |
| 11a9.2 | Exhaust a finite side inventory, then try one additional charged timeout | The side reads exhausted, capture is disabled/rejected, and the event stream plus projected count remain unchanged |
| 11a9.3 | Use a zero-cap profile, then an unlimited profile | Zero is exhausted before capture; unlimited remains visibly distinct, accepts repeated captures, and never displays a fabricated remaining count |
| 11a9.4 | Record Media and Official game timeouts for both team-inventory states | Neutral counts update by kind with no actor and neither side's charged inventory changes |
| 11a9.5 | Record Full then 30-second for one side and remove that side's latest timeout | Confirmation names the 30-second snapshot and restored remaining count; only the newest matching current-period charged event is removed |
| 11a9.6 | Record Media, Official, then Media and remove the latest Media timeout | The newest Media event is removed; Official and both charged inventories remain unchanged |
| 11a9.7 | Park/reload after a removal, then use Restore | The exact timeout id, kind, label, side, and active revision return; inventory reprojects exactly |
| 11a9.8 | End the period and start the next regulation period or overtime | Prior-period timeouts remain in history but cannot be removed from the quick panel; the new segment uses its immutable regulation or overtime/fallback cap |
| 11a9.9 | Try capture/correction during a period break, after completion, and with a cloud binding | Commands return the original state with no aggregate fallback or partial mutation |
| 11a9.10 | Replay a raw stream containing one more charged timeout than the snapshot permits | Projection stops at the offending event with a semantic diagnostic instead of deriving impossible inventory |
| 11a9.11 | Run representative foul/trip, ejection, and timeout capture/correction in one match | Every BKE-2C family stays event-derived, dependency-aware corrections restore exactly, and the tracker exposes no parallel aggregate authority |

---

## 11a10. Basketball complete tracker parity and BKE-2 exit (BKE-2D)

**Precondition:** Development build with a healthy, local Basketball event game. Exercise both an
active period and a period break, plus completed, suspended, and abandoned states.

| Step | Action | Expected |
|------|--------|----------|
| 11a10.1 | Select tracked/opponent team chips and individual chips | Team targets show only valid team actions/totals; individuals retain player actions; selected identity remains visible in focused sheets |
| 11a10.2 | Add fouls for both sides through a bonus threshold, then start overtime with reset on and off | Both foul totals and the opponent's resulting 1-and-1/bonus state update from one projection contract; regulation/resetting overtime starts at zero while non-resetting overtime carries the cumulative overtime foul count and matching bonus state |
| 11a10.3 | End a period and inspect court, grid, score, foul, ejection, and timeout controls | Every capture path is read-only until the next period starts; review and correction context remains visible |
| 11a10.4 | Eject or disqualify a player, then select their chip | The player remains visible with status/history but court and direct player capture are unavailable |
| 11a10.5 | Suspend during active play, then reopen with a reason | Capture stops while suspended; reopen preserves every event and resumes the active period |
| 11a10.6 | Suspend or abandon during a period break, then reopen | The stream remains intact and returns to the same period break rather than inventing an active segment |
| 11a10.7 | Complete a non-tied local game, reopen with a reason, and continue | Completion is reviewable and reasoned reopen restores the projected pre-terminal lifecycle state |
| 11a10.8 | Try blank/oversized reopen reasons and any terminal command on a cloud-bound event game | The command returns the original state with an inline error and no fallback mutation or cloud write |
| 11a10.9 | Mix court/grid capture, team actions, fouls, timeouts, staff discipline, lifecycle changes, and a period transition | Score, stats, shots, administration, lifecycle, and current-period presentation remain one coherent event projection |
| 11a10.10 | Park, JSON export/import or reload, hydrate, and rebuild the mixed game | The event stream, sport state, compatibility players, and shot chart reproduce exactly; direct legacy reducer actions remain rejected |
| 11a10.11 | Run `pnpm test`, `pnpm lint`, and `pnpm build` | Basketball event, legacy Basketball, and Soccer suites pass; lint has no new warnings and production build succeeds |

---

## 11a11. Basketball Timeline and read-only shot detail (BKE-3A)

**Precondition:** Development build with a healthy, local Basketball event game containing grouped
and independent events for both sides, at least two periods, one removed/restored event, and two
located shots with overlapping touch targets. Keep one ordinary legacy Basketball game for the
legacy-detail checks.

| Step | Action | Expected |
|------|--------|----------|
| 11a11.1 | Open the event game and switch between Track and Timeline | Track preserves the complete court/grid workspace; Timeline replaces capture controls while the scoreboard and fixed quick Undo remain available |
| 11a11.2 | Review independent events and a multi-event shot/assist or shot/rebound capture | Timeline is newest first; persisted command members share one expandable group; independent or later-linked events remain separate |
| 11a11.3 | Exercise event-family, period, side, and participant filters | Filters overlap without changing authority; active play defaults to the current period, a completed game defaults to Full match, and grouped context stays intact |
| 11a11.4 | Undo and restore an event, then inspect Timeline | Removed events stay collapsed by default with their current payload; revision metadata says Revised without claiming that values changed; companion removal counts stay visible |
| 11a11.5 | Tap each marker near its center, then tap an effectively equidistant point inside both markers' touch targets | Center taps open the nearest marker directly even when touch targets overlap; only the ambiguous tap opens the deterministic newest-first chooser; neither gesture opens capture or adds a shot |
| 11a11.6 | Open an event shot from both court and Timeline | Both paths use the same detail surface and show full-game field-goal or FT ordinal, period, shooter/side, result/value, location, relationships, revision metadata, ids, recorder, and timestamps |
| 11a11.7 | Open a legacy shot marker | Detail shows full-chart ordinal, shooter, result/value, zone/location, and timestamp only; it never guesses assist/rebound/block links or exposes editing |
| 11a11.8 | Load a malformed or semantically incomplete event stream | Timeline keeps coherent review context read-only, surfaces global or event-anchored diagnostics, and never reveals a legacy mutation fallback |
| 11a11.9 | Park/reload the event game and repeat filters/detail navigation | Timeline and detail derive again from the authoritative stream; capture groups, ordinals, relationships, revisions, and removed events remain stable |
| 11a11.10 | Repeat Timeline, overlap chooser, and detail checks on a narrow touch viewport and with keyboard navigation | Labels fit without overlap, selectors remain usable, marker Enter/Space activation works, Escape closes detail, and closing returns to the same court/filter/scroll context |
| 11a11.11 | Run `pnpm test`, `pnpm lint`, and `pnpm build` | Timeline pure tests and all Basketball, legacy Basketball, Soccer, lint, and production-build checks pass with no new warning |

---

## 11a12. Basketball score and minutes Timeline editors (BKE-3D2)

**Precondition:** Healthy local Basketball event game using manual minutes, with two players and at
least two started periods. Keep an anchored-clock fixture and a terminal game for fail-closed checks.

| Step | Action | Expected |
|------|--------|----------|
| 11a12.1 | Open a score adjustment in Timeline detail and choose Edit | Team, signed delta, reason, and note are prefilled; event id/type stay immutable |
| 11a12.2 | Change score side/delta/reason, require a note for Official correction, review, and save | One revision applies atomically, score reprojects, reason/note persist, and the row is highlighted |
| 11a12.3 | Enter zero, a fractional delta, a blank official note, or a value that would make either score negative | Review is rejected inline and state remains unchanged |
| 11a12.4 | Edit a manual-minutes row to another player/side with positive and negative whole-number deltas | Old attribution is removed, new attribution is applied, and player/side totals rebuild exactly |
| 11a12.5 | Attempt to reduce either the former or replacement participant below zero | Review is rejected with a minutes-specific error and no revision is written |
| 11a12.6 | Use Add Event for score and minutes, select a prior started period, review, and save | Each row appends with current capture ordering, selected period context, and a Recorded later badge; no fake clock is entered |
| 11a12.7 | Repeat minutes add/edit on an anchored-clock game | Manual minutes are unavailable and no event can be appended or revised |
| 11a12.8 | Open Add Event during a period break and add minutes to any started period | The checked historical flow succeeds; live fouls/timeouts/ejections retain their existing period guards |
| 11a12.9 | Change Timeline after opening an editor, bind the game to cloud, or try a terminal game without Reopen | Save fails closed for stale, cloud, or terminal state; a reasoned Reopen restores local editing |
| 11a12.10 | Park/reload and run focused tests, `pnpm test`, `pnpm lint`, and `pnpm build` | Score/minutes revisions, reasons, participants, periods, totals, and badges rederive identically; all checks pass |
| 11a12.11 | Clear a signed-adjustment input, type a leading minus and then an integer, and repeat with an unresolved participant present | The negative text remains intact through typing; Review receives the signed integer; unresolved players do not appear in the minutes picker |
| 11a12.12 | Load a pre-BKE-3D2 stream whose first semantic failure is a score adjustment below zero | Timeline identifies the flagged adjustment and retains only its Edit/Remove recovery actions; a complete repair succeeds, while unrelated diagnostics and any new negative-score mutation remain blocked |

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
| 11c.2a | Set a personal default, select a soccer team with a different shared override, then change one rule in Match Setup | Effective values and per-field labels follow built-in -> personal -> team -> match precedence; Inherit removes only the selected match override |
| 11c.2b | Change between two accessible soccer teams after adding a match override | Team-inherited fields re-resolve for the new team while the explicit match override remains |
| 11c.2c | Reopen an existing setup after changing personal/team defaults | Its saved snapshot remains unchanged until a deliberate team/rule edit or Inherit action; Continue writes the newly resolved complete snapshot |
| 11c.3 | Use a local team source, enter match information, continue, and add local players | The Match Roster step lists players and allows selecting only this match's participants |
| 11c.4 | Return to setup, choose an accessible cloud soccer team, and continue | Its active roster loads read-only; no cloud game is created and `cloudSync` remains unbound |
| 11c.5 | Add a game-only participant while using a cloud roster, then return between roster and lineup steps | The anonymous participant keeps one stable match-local identity |
| 11c.6 | Assign Starter/Bench and roles with no starting goalkeeper or with more starters than the configured maximum | Kickoff is blocked with a focused validation message |
| 11c.7 | Add or assign exactly one starting goalkeeper, leave the lineup below the maximum, and choose Start Match | A short-handed confirmation appears before kickoff |
| 11c.8 | Confirm kickoff | Opening lineup, first period, and running clock begin together; `/game` shows `MM:SS`, direction, On Field, and Bench without the legacy stat grid |
| 11c.9 | Background the tab briefly, return, park the match, then resume it | The displayed clock advances from its persisted anchor and resume returns to `/game` |
| 11c.10 | Build for production, open an existing soccer Team Info page or `/#/setup?teamId=<soccer-team>`, and attempt to reach a stale/imported active soccer setup through `/setup`, `/players`, `/checkout`, `/game`, or `/summary` | Team Info hides Start Game, the team deep-link does not create or bind a soccer session, Soccer cards are absent, and active soccer route surfaces redirect to the sport chooser |
| 11c.11 | Start and track a basketball game | Existing setup, roster, checkout, tracker, parking, and cloud behavior are unchanged |
| 11c.12 | Open Team Manage for a soccer team as owner/admin, scorer, and viewer | Owner/admin can save sparse shared defaults and copy an accessible soccer team's defaults; scorer/viewer see read-only effective values; non-soccer teams show no soccer editor |
| 11c.13 | Disconnect after loading team defaults, reopen Match Setup, then attempt to edit shared defaults | The cached team values remain available and labeled for setup; shared Save is unavailable until reconnect and refresh |

---

## 11d. Soccer live match controls and correction history (SOC-2C)

**Precondition:** Run the Vite development server and start a soccer match with starters,
bench players, at least one backup goalkeeper, and extra time enabled.

| Step | Action | Expected |
|------|--------|----------|
| 11d.1 | Leave the clock running, background the tab, then return | Match time and each on-field participant's exact `MM:SS` advance from the persisted anchor without a stream of reducer events |
| 11d.2 | Pause, resume, and correct the clock while stopped and while running | Display and canonical elapsed time use the correction; a running correction resumes automatically and history records the transition |
| 11d.3 | Exercise continuous/per-period and count-up/count-down rules through nominal period time | Display follows the selected mode; count-down clocks show zero plus overrun, and no period ends automatically |
| 11d.4 | End a running period, inspect the break, then start the next period | Pause and period end are atomic; the completed period remains visible; the next period and clock start together only after confirmation |
| 11d.5 | Record paired, exit-only, entry-only, multi-player, and halftime substitutions | On Field/Bench membership, substitution/window counts, roles, appearances, and exact minutes rebuild correctly; halftime does not consume a window |
| 11d.6 | Attempt a disallowed return, exceed a configured limit, or create zero/multiple on-field goalkeepers | The entire action is rejected without partial lineup or history changes; a valid simultaneous goalkeeper handoff succeeds |
| 11d.7 | Change one or several roles, attacking direction, and mid-match rules | Each accepted change appears in history and immediately updates the projected tracker state |
| 11d.8 | Add a late roster or anonymous participant to the bench/on field, then resolve an anonymous participant | Stable identity, role, appearance, and minutes remain coherent after projection rebuild |
| 11d.9 | Edit a historical event so a later event becomes semantically invalid | The edit remains revisioned, diagnostics identify unprojected history, and dependent live controls lock until repaired |
| 11d.10 | Repair the event, then remove and restore another history row | Projection becomes healthy after repair; removal and restore remain visible and revisioned |
| 11d.11 | Complete regulation, optionally play configured extra time, then end the match | Completed is offered only after the configured playable periods; suspended/abandoned remain available; controls lock on end |
| 11d.12 | Review the ended match and choose Reopen Match | Clock, lineup, minutes, history, corrections, and diagnostics remain readable; reopen returns to the break after the last completed period |
| 11d.13 | Repeat the tracker at narrow mobile and desktop widths | Clock, tabs, cards, dialogs, and action controls remain usable without overlap or clipped text |
| 11d.14 | Resume and track a basketball game | Basketball tracker, stat actions, parking, summary, and cloud paths are unchanged |

---

## 11e. Soccer live field and attacking capture (SOC-3B)

**Precondition:** Run the Vite development server and start a development soccer match with an
on-field goalkeeper and at least one outfield participant.

| Step | Action | Expected |
|------|--------|----------|
| 11e.1 | Open the Field tab at narrow mobile and desktop widths | Score, clock controls, capture side, participant chips, full pitch, and quick goals fit without overlap or horizontal page scrolling |
| 11e.2 | Select Tracked, choose an on-field participant, tap the field, and record each shot outcome | One checked event is appended with normalized location, capture-time attack direction, selected participant, situation, and applicable linked actors; score and totals reproject immediately |
| 11e.3 | Flip Field View, tap the same visible area, and record another shot | The display rotates 180 degrees while persisted recorder coordinates remain authoritative; flipping never rewrites existing events |
| 11e.4 | Record tracked and opponent goals with primary/secondary creators, goalkeeper links, blocked-by attribution, and opponent labels | Side-aware defaults are editable, duplicate shooter/creator attribution is rejected, and recent opponent labels can be reused without creating roster records |
| 11e.5 | Record an own goal benefiting each side | The benefiting side scores without adding a shot; tracked own-goal and goalkeeper attribution follows the event-domain rules |
| 11e.6 | Use each side's quick Goal action | A normal goal event is created with unknown location and team/unknown attribution; no raw score mutation occurs |
| 11e.7 | Park and resume after changing capture side and tracked participant | The eligible selection and capture side return; a participant removed from the field clears instead of silently selecting another |
| 11e.8 | End the period or match, then tap the field | The field remains available for review but live capture is disabled outside an active period |
| 11e.9 | Open Timeline after recording attacking events | Attacking rows are readable, revisioned, and removable/restorable |
| 11e.10 | Resume and track a basketball game | Basketball court capture, stat actions, parking, summary, and cloud behavior are unchanged |

---

## 11f. Soccer Timeline, correction, and field review (SOC-3C)

**Precondition:** Start a development soccer match and record located tracked/opponent shots,
at least one goal, one own goal, and events in more than one period.

| Step | Action | Expected |
|------|--------|----------|
| 11f.1 | Open Field with Marker side All and Marker period Current | Only active located shots/own goals from the review period appear; tracked/opponent colors and outcome shapes are distinguishable |
| 11f.2 | Switch marker side and Current/Match filters, then flip the field | Markers filter without changing events and rotate with the display while recorder coordinates remain unchanged |
| 11f.3 | Select a marker and correct outcome, side, actors, goalkeeper/blocker, time, and location | The shared editor is prefilled; save creates one revision and score/stat/marker projections rebuild |
| 11f.4 | Open Timeline and switch All, Attacking, and Match Control | Events remain newest first with period-local `MM:SS`; each filter shows only its event family |
| 11f.5 | Remove an event, expand Removed Events, then restore it | Removed rows are collapsed by default; removal and restoration update score, totals, and markers through revisions |
| 11f.6 | Choose Add missed event, select a started period and time, then record a shot/own goal | The event appends at canonical period time without moving the live clock and projects only when historical lineup/role rules pass |
| 11f.7 | Attempt a historical add outside the period bounds or with an ineligible tracked participant | Save is blocked or rejected without appending partial history |
| 11f.8 | Tap either score, inspect scoring history, and add `+1` then `-1` with reasons | Only goals, own goals, and adjustments appear; score changes without inventing shot/player stats and cannot be adjusted below zero on append |
| 11f.9 | Revise an event into a semantic conflict, then repair it from Timeline | The revision remains stored, diagnostics identify the issue, live/add controls lock, and repair restores a complete projection |
| 11f.10 | Park/resume and repeat at 390px mobile plus desktop width | Raw revisions, filters' source data, scores, markers, and Timeline survive; controls do not overlap or create page-level horizontal scrolling |
| 11f.11 | Resume and track a basketball game | Basketball capture, action log, parking, summary, and cloud paths are unchanged |

---

## 11g. Soccer match event domain (SOC-4A)

**Precondition:** No new UI is exposed in this phase. Run the automated domain suite against a
development checkout; soccer remains local-only and production-disabled.

| Step | Action | Expected |
|------|--------|----------|
| 11g.1 | Run `pnpm exec vitest run src/lib/soccer` | Soccer v1-to-v2 normalization, all 25 schemas, defensive/team totals, discipline consequences, restart links, shootout sequencing, and structured outcomes pass |
| 11g.2 | Normalize a parked SOC-2/SOC-3 state without SOC-4 rule fields or capture mode | State advances to version 2, legacy availability maps to one tie-resolution path, and defaults are added without rewriting events |
| 11g.3 | Project tackle outcomes, interceptions, clearances, recoveries, fouls, cards, corners, offsides, and linked shot blocks | Participant credit requires valid tracked attribution; Team/Unknown changes side totals only; blocks are counted once from the linked shot |
| 11g.4 | Revise a card to occur before a later shot/substitution involving the recipient | Raw revision is preserved, the dependency is diagnosed, and an append that would create incomplete history remains atomic |
| 11g.5 | Exercise stay-on yellow, must-leave yellow replacement, second-yellow red, and goalkeeper-red handoff | Card totals and lineup intervals rebuild together; goalkeeper handoff preserves one goalkeeper and the required one-player reduction |
| 11g.6 | Project direct-shootout setup, retake, forfeit, repeated-kicker rejection, and a deciding kick | Shootout attempts/score/saves remain separate from normal stats; order and eligibility are deterministic; result derives only after an explicit completed event |
| 11g.7 | Run `pnpm build`, `pnpm lint`, and `pnpm test` | TypeScript, production build, lint, and the full regression suite pass; SOC-4A domain behavior remains deterministic |

---

## 11h. Soccer normal-match capture (SOC-4B)

**Precondition:** Run a development build, create a soccer game, select a starting lineup, and
start the match. Soccer remains development-only through SOC-6.

| ID | Action | Expected |
|---|---|---|
| 11h.1 | At 390x844 and desktop widths, switch among Shot, Defense, and Foul field modes and Tracked/Opponent sides | Controls remain usable without overlap or page-level horizontal scrolling; side/player/mode defaults remain stable |
| 11h.2 | Log each defensive action, a foul, a card, a corner, and an offside through field taps and quick actions | Events append atomically, use the selected side/actor defaults, and update derived match totals |
| 11h.3 | Exercise IFAB stay-on yellow, High School replace-now/play-short, a non-goalkeeper red, and goalkeeper-red handoff | The card and required lineup consequence save together and rebuild the same on refresh |
| 11h.4 | Switch marker family, side, and Current/Match filters; create overlapping markers and select a cluster | Marker shapes/colors distinguish event families and sides; cluster selection opens the intended event without moving the field |
| 11h.5 | Use Timeline Add Event in a prior started period, edit it, remove it, and restore it | Historical bounds and actor eligibility are enforced; revision history and removed-event state remain visible and deterministic |
| 11h.6 | Log a direct-free-kick, penalty, or corner-sequence shot after a compatible restart; change and clear its source | Suggested source is optional, side/time compatible, editable, and invalidated visibly if its source is later removed |
| 11h.7 | Park and resume the soccer game, then run `pnpm build`, `pnpm lint`, and `pnpm test` | Capture preferences and event history survive; no shootout controls appear; basketball and shared parking regressions remain green |

---

## 11i. Soccer shootout and structured outcomes (SOC-4C)

**Precondition:** Run a development build and complete regulation in a tied soccer match whose
snapshotted rules require a winner. Soccer remains local-only and production-disabled.

| ID | Action | Expected |
|---|---|---|
| 11i.1 | Complete regulation under draw-allowed, direct-shootout, and extra-time-then-shootout rules | Only the valid next lifecycle action appears; a draw can complete, direct rules offer Shootout, and begun extra time must finish before a shootout |
| 11i.2 | Start a shootout and review first side, kick count, tracked eligibility/exclusions, opponent count, and both goalkeepers | The workspace opens only when counts and goalkeepers are valid; normal score remains unchanged and shootout score starts at zero |
| 11i.3 | Record scored, saved, missed, woodwork, retake, and forfeited outcomes for both sides | Order alternates correctly, retakes preserve the kicker, attempts/saves/scores derive correctly, and no kick changes normal player or match totals |
| 11i.4 | Attempt to reuse a kicker before every eligible slot has kicked, then continue into sudden death | Early reuse is blocked; a completed cycle permits reuse; early clinch and sudden-death decisions follow the snapshotted kick count |
| 11i.5 | Record shootout yellow/red cards, equalize eligibility, and send off the current goalkeeper | Shootout discipline stays separate; counts must remain equal; another kick is blocked until the sent-off goalkeeper is replaced |
| 11i.6 | Change each goalkeeper, including an allowed unused tracked replacement, then park and resume | The designated goalkeeper and paired eligibility change rebuild atomically and survive parking without altering normal lineup history |
| 11i.7 | Select a kick and correct its outcome; use Timeline to revise, remove, and restore shootout events | The kick sequence, decision, score, diagnostics, and structured result reproject from active revisions; normal Add Event stays hidden once a shootout exists |
| 11i.8 | Complete a decided shootout, reopen it, suspend/resume normal play, and abandon/reopen with a reason | Completion is unavailable before a decision; suspended play resumes its exact context; abandoned matches require a reopen reason and return to their existing shootout or normal-match break |
| 11i.9 | Repeat the workspace at 390x844 and desktop widths, then run `pnpm build`, `pnpm lint`, and `pnpm test` | Score, kick strip, controls, dialogs, Timeline, and review-only field remain readable without page-level horizontal scrolling; basketball regressions remain green |

---

## 11j. Soccer cloud event transport (SOC-5A)

**Precondition:** Signed in, migration `043_soccer_event_cloud_transport.sql` applied, and
the development Soccer workspace available. Soccer remains production-disabled. Use one
local-roster match and one existing cloud-team match.

| ID | Action | Expected |
|---|---|---|
| 11j.1 | Start a local-roster match while online and wait for sync | One personal cloud game binds to the local game id; no season, team, roster, or permanent player rows are created; participant snapshots and all kickoff events exist |
| 11j.2 | Start from a cloud soccer team while online | The game binds to the selected team/season, snapshots selected and game-only participants, and source-player links exist only for team roster players |
| 11j.3 | Record events, revise one, and remove one | The recorder's cloud rows contain the latest revisions/tombstone; the checkpoint count, max sequence, revision set, and fingerprint update before the local status becomes synced |
| 11j.4 | Go offline, record several event families, park the game, and reconnect | Tracking remains usable; the active game syncs first, parked dirty games follow oldest-first, and local data remains present through retries |
| 11j.5 | Open a healthy soccer game parked before SOC-5A and reconnect | It binds with the existing local id and uploads unchanged event ids, revisions, sequences, and timestamps without history migration |
| 11j.6 | Import or create a soccer stream with an invalid envelope or projection diagnostic | Upload is rejected as a whole, the game remains local/dirty with a visible error, and no partial checkpoint is confirmed |
| 11j.7 | Edit the game while an upload is in flight | Completion of the older upload does not clear the newer dirty state; a following queue pass uploads and confirms the latest fingerprint |
| 11j.8 | Reload with a synced personal soccer game plus an older aggregate cloud game | The personal soccer row does not enter the legacy aggregate hydrator or overwrite the local soccer event workspace |
| 11j.9 | Record and sync a basketball game after SOC-5A | Aggregate stats and shot-chart sync behave unchanged and never write soccer participant/checkpoint rows |

---

## 11k. Soccer offline recovery and same-recorder conflicts (SOC-5B)

**Precondition:** Signed in on two browser profiles/devices with migrations 043 and 044 applied.
Soccer remains development-only.

| ID | Action | Expected |
|---|---|---|
| 11k.1 | Sync on device A, then open Soccer Cloud Games on device B and resume | Rules, opening roster, participants, event history, clock/match state, and same-recorder projection rebuild in a new parked game |
| 11k.2 | Add an event offline on B, reconnect, then sync A | The unrelated event merges on both devices without a conflict and the checkpoint contains the union |
| 11k.3 | Edit different events offline on A and B, then reconnect | Both revisions survive and sync; neither device silently replaces the other event |
| 11k.4 | Edit the same event differently offline on A and B, then reconnect | Needs Attention appears; side-by-side local/cloud revisions are available and automatic retry pauses while the parked game stays dirty |
| 11k.5 | Choose **Keep This Device** | A new revision above both copies uploads, the conflict audit resolves as local, and the checkpoint confirms |
| 11k.6 | Reproduce and choose **Use Cloud Version** | The remote revision is adopted exactly, the audit resolves as remote, and the checkpoint confirms |
| 11k.7 | Resolve while offline, reload, then reconnect | The choice and pending audit closure persist locally and complete on reconnect |
| 11k.8 | Add and resolve a late participant on A, then resume/sync on B | Participant metadata is adopted before projection and all attributed events remain valid |
| 11k.9 | Open another recorder's team soccer row without having a stream | The app does not create or open an empty aggregate/same-recorder soccer shell |
| 11k.10 | Force a sync error and use **Export** | A one-game JSON recovery file downloads while local capture and discard protection remain intact |

---

## 11l. Soccer independent recorders and primary resolution (SOC-5C)

**Precondition:** Two accepted team users plus one viewer, migrations 043 through 045 applied,
and Soccer running in development.

| ID | Action | Expected |
|---|---|---|
| 11l.1 | Recorder B checkpoints first, then creator A records and syncs the team soccer game | B is the temporary default only until A has a healthy checkpoint; presence then resolves A as default primary regardless of checkpoint race |
| 11l.2 | Recorder B opens the same Cloud Game and confirms **Start your own independent recorder stream** | B receives the immutable setup/participants and three new kickoff events bound to the same game id; no A event is copied |
| 11l.3 | A and B record different events and sync | Two recorder rows remain separate; each projection has its own score/timeline and event ownership |
| 11l.4 | Open recorder streams from the tracker without enabling details | Compact count, primary name, checkpoint state, and conflict count appear; no other-recorder events enter the live timeline |
| 11l.5 | Enable **Show stream details** and inspect the other recorder | A read-only score/status/timeline projection appears and the active recorder stream remains unchanged |
| 11l.6 | As owner/admin, select B as primary | B must have a current conflict-free checkpoint and healthy projection; primary changes immediately and history records actor, old primary, new primary, and time |
| 11l.7 | As scorer or viewer, attempt the primary RPC directly | Server denies the change; scorer may still write only their own stream and viewer remains read-only |
| 11l.8 | Make B's stream dirty or create an unresolved B conflict after selection | B remains provisionally selected but shows Needs Attention; the stream is not finalization-ready |
| 11l.9 | As viewer, open the soccer game from Cloud Games | `/#/soccer/review` shows only the primary projection with no live capture controls |
| 11l.10 | Open a finalized soccer row before SOC-5D UI is enabled | Cloud Games routes to read-only primary review; no recorder stream is resumed or edited |
| 11l.11 | Attempt to add another recorder to a personal soccer game | Server rejects the v3 bind |
| 11l.12 | Record and sync basketball after migration 045 | Basketball aggregate sync, checkout primary behavior, and shot-chart review are unchanged |
| 11l.13 | Recorder B has unsynced active or parked work bound to the game, then opens it from Cloud Games while their cloud stream is empty | The matching local slot resumes without a cloud load or new kickoff; active wins over parked, otherwise dirty work wins |
| 11l.14 | Force the recorder cloud load or projection to fail, then open the game | The error is shown and no independent-stream prompt or replacement kickoff appears |
| 11l.15 | A and B sync divergent substitutions/roles; B also changes their local game labels | Shared participant snapshots do not store either recorder's live role/status; B cannot replace shared names/numbers or game headers, while creator A can refresh header/profile metadata |

## 11m. Soccer canonical finalization and recovery (SOC-5D)

**Precondition:** Two accepted team recorders, one owner/admin, one scorer, one viewer,
migrations 043 through 046 applied, and Soccer running in development.

| ID | Action | Expected |
|---|---|---|
| 11m.1 | End the healthy primary match, sync it, then finalize as owner/admin | One canonical publication is created, primary locks, game status and final scores update atomically, and review opens the canonical result |
| 11m.2 | Finalize the same snapshot again | The RPC returns the existing publication id/number without creating a duplicate |
| 11m.3 | Retry finalization with a changed primary, revision set, fingerprint, or snapshot after the game is final | Server rejects the non-idempotent request |
| 11m.4 | Attempt finalization as scorer/viewer or by directly updating a soccer game to `final` | UI omits the action and server rejects both RPC and direct status bypass |
| 11m.5 | Leave the primary match running, suspended, reopened, or in period break and attempt finalization | Finalization stops; the verified primary cloud stream must end with a completed or abandoned match event |
| 11m.6 | Make the active user's primary stream dirty, then finalize | Tracker flushes and confirms that exact primary stream before publishing |
| 11m.7 | Leave unresolved conflicts on the primary | Finalize remains disabled and manager conflict review shows the durable device/cloud versions |
| 11m.8 | As owner/admin, choose a primary conflict version | Selected version receives a new revision, resolution is audited, projection/checkpoint refresh, and finalization can proceed when healthy |
| 11m.9 | Leave a non-primary checkpoint stale or conflicted while primary is healthy | Readiness warns about the other stream but does not block finalization |
| 11m.10 | Keep pre-finalization non-primary events queued, finalize, then reconnect that recorder | Their own pre-finalization events/participants/checkpoint finish as audit-only history; canonical publication and scores do not change |
| 11m.11 | Create a new event or revision after finalized time, or attempt a primary write | Server rejects it; finalized capture remains locked |
| 11m.12 | Open a finalized game as viewer, scorer, and manager | All see the same canonical primary score/timeline; other recorder streams remain optional read-only details |
| 11m.13 | Add a client projection to the canonical payload, forge its score, or replace the terminal match event in test/staging | Server rejects projection-bearing source payloads and non-final streams; published scores are derived from stored primary events |
| 11m.14 | Reopen without a reason, as scorer/viewer, or through direct status update | Server rejects the request |
| 11m.15 | Reopen as owner/admin with a reason, then resume a matching local binding | Active publication is invalidated but retained, primary unlocks, published score columns clear, cloud and local status return to in progress, and audit history records actor/reason |
| 11m.16 | Change primary after reopen, correct the match, and finalize again | Publication number increments; the old invalidated publication remains queryable in database history |
| 11m.17 | Finalize and reopen a personal soccer game | Only the personal game creator may perform either action |
| 11m.18 | Finalize a basketball game after migration 046 | Existing aggregate finalization, checkout, summary, and correction behavior are unchanged |

## 11n. Soccer summary foundation and Overview (SOC-6A)

**Precondition:** Migrations 043 through 046 applied for cloud cases, Soccer running in
development, and at least one local match plus one team cloud match available.

| ID | Action | Expected |
|---|---|---|
| 11n.1 | End a local-only match, remain in Tracker, then choose **View Summary** | `/summary?tab=overview&from=tracker` opens the local Overview without a cloud read; score, result, comparison, leaders, and match details match the local projection |
| 11n.2 | Reopen the completed local match from Overview | Summary remains local and refreshes to non-final match context; an abandoned match requires a reason |
| 11n.3 | Keep a local binding after its cloud game is final, then open `/summary` without `gameId` | Summary resolves the active canonical publication through the binding and exposes no local edit or local-reopen action |
| 11n.4 | Open a non-final soccer game as a viewer from Cloud Games and Game Info | Direct `/summary?gameId=...` review uses the SOC-5C effective primary and does not activate, replace, or create a parked game |
| 11n.5 | Open a canonical final while another basketball or soccer game is active | The active game id and parked-game list remain unchanged; Back returns through the constrained `from` context |
| 11n.6 | Finalize an ended healthy primary from Overview as owner/admin, then hard-refresh after clean final parking is discarded | URL retains `gameId`; Summary remounts as `Canonical Final` without local sport state, while scorer/viewer users do not see the action |
| 11n.7 | Reopen a canonical final from Overview with a reason, including once after removing its parked local copy | Summary refreshes in place to `Synced Primary`; a matching parked stream offers **Resume Tracker**, while an owned cloud stream offers **Open Tracker** and recreates a safe local binding |
| 11n.8 | Remove or invalidate the active canonical publication while the game remains final | Summary fails closed with canonical recovery guidance and never falls back to a live recorder or score-only row |
| 11n.9 | Introduce a projection diagnostic in a local, primary, or canonical stream | Last coherent score/context and recovery/Resume actions remain visible, while team comparison, leaders, and finalization are suppressed and diagnostics are shown |
| 11n.10 | Leave the non-final cloud summary open, focus another window and return, then wait 30 seconds; force one refresh request to fail | Focus, manual Refresh, and the active-page interval reload only the effective primary; a transient failure keeps the last good Overview with a retry warning, and canonical finals do not poll |
| 11n.11 | Use long team/player names, tied leaders, all-zero optional rows, extra time, penalties, suspended, and abandoned results at narrow mobile and desktop widths | Header columns remain stable, text wraps/truncates safely, ties remain visible, optional both-zero rows hide, and result context is explicit |
| 11n.12 | Open `tab=players`, `tab=timeline`, `tab=field`, conditional `tab=shootout`, then a future or invalid tab value | Shipped tabs open their views; Shootout requires a started shootout; unavailable Shootout and unknown values normalize to Overview |
| 11n.13 | Open legacy `/#/soccer/review` with `gameId`, `from`, `teamId`, and an unrelated parameter | It redirects to `/summary`, preserving only supported context and normalizing the tab to Overview |
| 11n.14 | Re-run basketball local and cloud summary entry paths | Basketball still renders `GameSummary`; soccer source loading and direct cloud review are not invoked |

## 11o. Soccer summary Players (SOC-6B1)

> **Scope:** URL-backed Players review for local/current-recorder, remote primary, isolated other
> recorder, and canonical authority. Soccer remains development-only until SOC-6E.

| # | Action | Expected |
|---|--------|----------|
| 11o.1 | Open `/#/summary?tab=players` for a healthy local, effective-primary, and canonical match | The same Players surface loads from the selected authority without activating or replacing another parked game |
| 11o.2 | Review starters, return substitutes, a player with a zero-second appearance, a late participant, and an unused substitute | Rows use stable match identity; starters come first in opening order, used substitutes follow first appearance, `0:00` is an appearance, and unused players show `DNP` |
| 11o.3 | Switch Attack, Defense, Discipline, and Goalkeeping categories, move to Overview, then return | Identity, lineup status, role, and minutes remain fixed; the selected category and side survive tab changes but reset for a different game |
| 11o.4 | Open Player Detail for a participant who changed roles and re-entered | Complete normal-match totals, real appearance count, rates, on-field intervals, and role intervals retain second precision and correct period-local times |
| 11o.5 | Verify shots, goals, tackles, saves, normal penalties, and zero denominators | Rates show rounded percentage plus raw numerator/denominator; regulation/extra-time penalties count, shootout activity does not, and zero-denominator rates show no percentage |
| 11o.6 | Complete a clean sheet with one and then two goalkeepers who played | One qualifying goalkeeper receives `Clean sheet`; multiple qualifying goalkeepers each receive `Shared clean sheet`; DNP keepers receive none |
| 11o.7 | Concede before or after a goalkeeper substitution, record an own goal at the same timestamp as a substitution, and leave one concession unattributed | Canonical event order/link attribution denies the responsible keeper; overlapping fallback denies every overlapping keeper; no identifiable interval marks individual credit unavailable |
| 11o.8 | Add an opponent score adjustment, then remove/correct it | Team context follows corrected normal score; individual goalkeeper credit is unavailable while attribution is unreliable and recomputes after correction |
| 11o.9 | Open Players during a live, suspended, abandoned, and completed match | Live zero-concession context is provisional; suspended/abandoned matches award no final credit; completed matches derive final credit |
| 11o.10 | Select Opponent in a current match | Team clean-sheet context remains truthful and the UI shows a team-only state rather than inventing player lineup, role, or minutes from actor labels |
| 11o.11 | On a non-final cloud game with multiple recorders, choose **Other recordings** and select a non-primary stream | Header and every summary tab show one clearly labeled `Other Recording`; totals never blend, tab/refresh retain selection, and changing games resets to Primary |
| 11o.12 | While viewing Other Recording, inspect Overview as owner/admin | Finalize is absent; returning to Primary reloads effective-primary authority before Finalize can appear |
| 11o.13 | Select the current user's non-primary recording with and without a parked copy | Summary remains read-only; **Resume Tracker** uses the matching binding, while **Open Tracker** creates a local binding before edits |
| 11o.14 | Introduce projection diagnostics while Players is selected | Players disappears and the route normalizes to Overview; diagnostics and recovery/source controls remain available |
| 11o.15 | Test long names, missing numbers, all four categories, rate fractions, and detail sheets at narrow mobile and desktop widths | Names truncate without covering stats, table dimensions remain stable, controls remain tappable, and the detail sheet fits without page-level horizontal overflow |

### 11p. Soccer summary Timeline (SOC-6B2)

| # | Action | Expected |
|---|--------|----------|
| 11p.1 | Open `/#/summary?tab=timeline` for a healthy local, effective-primary, selected-recorder, and canonical match | Every source uses the same Timeline surface without activating, hydrating, or blending another game or recorder |
| 11p.2 | Review a match with regulation and extra-time events recorded out of storage order | Effective rows display oldest-first under setup-order period headings with period-local `M:SS` |
| 11p.3 | Switch All, Scoring, Attack, Defense, Restarts, Discipline, Lineup, and Match Control | Each chip updates in place; scoring/restart/discipline/lineup overlaps remain visible in every meaningful family |
| 11p.4 | Review a match that entered a shootout | Shootout start and lifecycle/final context remain in Timeline; individual kicks are absent pending the Shootout tab |
| 11p.5 | Correct an event more than once, then expand **Corrected** | Only current revision number and timestamps appear; the UI does not invent prior payload snapshots |
| 11p.6 | Remove events in multiple periods and expand **Removed Events** | Removed rows stay separate, period-grouped, filter-aware, visually subdued, and restorable only when local editing is allowed |
| 11p.7 | From an editable local summary, add a missed shot/incident, revise generic and specialized events, remove one, and restore it | Existing checked helpers and shared dialogs update GameContext/local parking and recompute the same selected summary source |
| 11p.8 | Trigger a validation failure while adding, correcting, or removing an event | Prior state remains intact, the active dialog/confirmation stays open where applicable, and the domain error is shown |
| 11p.9 | Repeat correction review on remote primary, selected Other Recording, and canonical final sources | Add, Edit, Remove, and Restore controls are absent; owned cloud streams require **Open Tracker** before editing |
| 11p.10 | Switch Overview/Players/Timeline, refresh, and test narrow mobile plus desktop widths | URL context and selected recorder persist, chips scroll without page overflow, rows remain readable, and basketball Summary is unchanged |
| 11p.11 | Save a valid revision that makes later history semantically incomplete | The revision remains stored, Summary normalizes to Overview under the shared unhealthy-source policy, and diagnostics plus recovery/Open Tracker actions remain available |

### 11q. Soccer summary Field (SOC-6B3)

| Step | Action | Expected |
|------|--------|----------|
| 11q.1 | Open `/#/summary?tab=field` for a healthy local, effective-primary, selected-recorder, and canonical match | Every source renders the same field review without activating, hydrating, or blending another game or recorder |
| 11q.2 | Review located shots, own goals, blocked shots, defensive actions, fouls, cards, corners, and offsides | Every normal-match family appears with side color and an event-specific marker; blocked shots appear under both Attack and Defense filters |
| 11q.3 | Switch Normalized and Original orientation with both sides represented | Normalized mode rotates each event independently into a left-to-right attack; Original preserves each stored coordinate without rewriting history |
| 11q.4 | Combine Both/Tracked/Opponent, multiple family chips, participant, Full Match/Regulation/Extra Time, and individual period filters | Filters update the loaded read model in place without a cloud reload; participant choices remain scoped to the selected side |
| 11q.5 | Record overlapping locations in different storage orders, then select the cluster | Cluster membership/count remains deterministic and its event list is oldest first |
| 11q.6 | Record matching events without locations, change filters, then select **Unknown location** | The count reflects every active filter and opens the matching unlocated event list; totals and Timeline still include those events |
| 11q.7 | Select a marker on an editable local summary and correct its location or event details | Shared checked shot/incident editors update GameContext and every Summary tab; a failed correction preserves prior state and remains actionable |
| 11q.8 | Repeat marker and cluster review on remote primary, selected Other Recording, and canonical final sources | Event detail remains available, but Edit is absent and no source is hydrated locally |
| 11q.9 | Review a match containing score adjustments, lifecycle events, and shootout activity | Those events create no Field markers; normal-match located events remain complete and shootout stays isolated for SOC-6B4 |
| 11q.10 | Test long participant labels, all filters, clusters, details, and the pitch at narrow mobile and desktop widths | Controls remain tappable, text does not overlap, the page has no horizontal overflow, and pitch dimensions remain stable |

### 11r. Soccer summary Shootout (SOC-6B4)

| Step | Action | Expected |
|------|--------|----------|
| 11r.1 | Open Summary before and after a shootout starts | Shootout is absent before the start event and appears as a sticky URL-backed tab afterward, including incomplete, suspended, reopened, or abandoned shootouts |
| 11r.2 | Review a normal initial series and an early decision | Attempts pair by official round; an unneeded final-side attempt stays blank; score, initial progress, first side, winner, and next side are explicit |
| 11r.3 | Record one or more retakes before the advancing attempt | Retakes remain beneath the same side/round, say **Retake - did not advance**, and do not increase official attempt or kick numbering |
| 11r.4 | Record saved, missed, woodwork, and forfeited attempts | Every outcome remains visible with distinct treatment; forfeits count as official attempts and are explicitly labeled |
| 11r.5 | Continue into sudden death | Round labels switch to Sudden Death numbering at the initial-series boundary and preserve paired attempts through the decision |
| 11r.6 | Use two anonymous opponent slots with the same display text | The slots remain distinct in attempts and kicker summaries rather than merging by label |
| 11r.7 | Review kicker and goalkeeper summaries | Kicker official attempts, goals, saved-against, misses, woodwork, retakes, and forfeits are correct; goalkeeper official attempts faced and saves are correct |
| 11r.8 | Compare Overview score, Players rates/clean sheets, and Shootout before and after kicks | Shootout values remain scoped to Shootout and never enter normal score, player categories/rates, or clean-sheet calculations |
| 11r.9 | Open local, primary-cloud, selected-recorder, and canonical-final Shootout attempts | All authorities show isolated read-only attempt detail; no direct Summary mutation path appears and correction remains in the owned local tracker |
| 11r.10 | Refresh, Finalize, Reopen, force diagnostics, and test narrow mobile plus desktop widths | Valid Shootout URL context survives source transitions; diagnostics normalize to Overview; tabs, rounds, tables, and detail fit without page-level overflow; basketball Summary is unchanged |

### 11s. Soccer canonical aggregate engine (SOC-6C1)

| Step | Action | Expected |
|------|--------|----------|
| 11s.1 | Run `pnpm exec vitest run src/lib/soccer/aggregateStats.test.ts src/lib/soccer/aggregateProjection.test.ts` | The canonical catalog, aliases, formatting, projection, identity, quality, and combined-rate fixtures pass |
| 11s.2 | Project a completed canonical fixture with one event goal plus a positive official score adjustment | Team W-D-L and goals for use the adjusted final score; player goals and assists include only attributed events |
| 11s.3 | Aggregate two completed publications whose match participants map to the same stable cloud player id | Raw totals combine into one player row before rates are calculated; an active roster player with no appearance remains at `0 APP` |
| 11s.4 | Remove the stable mapping from equivalent-looking participants in two matches | The instances never merge by name or number, their contributions are excluded, and aggregate quality is explicitly partial |
| 11s.5 | Project abandoned, malformed, duplicate, and shootout-bearing sources | Abandoned and malformed sources do not enter normal totals; exact duplicates deduplicate; conflicting content is partial; shootout activity does not alter normal player stats |
| 11s.6 | Re-run existing basketball config and aggregate tests | Basketball ids, categories, and legacy aggregate behavior remain unchanged |

### 11t. Soccer canonical aggregate transport (SOC-6C2)

**Precondition:** Run `supabase/scripts/audit_soccer_participant_sources_pre_047.sql`, review its
classifications, then apply migration 047 in a development Supabase project.

| Step | Action | Expected |
|------|--------|----------|
| 11t.1 | Run `pnpm exec vitest run src/lib/soccer/migration047.test.ts src/lib/soccer/aggregateTransport.test.ts` | RPC contracts, parsing, keyset cursors, deduplication, cancellation, typed failures, metrics, partial quality, and the 50-match fixture pass |
| 11t.2 | Call each RPC with limit 0/51 and with only one cursor field | The server rejects invalid limits and incomplete cursor pairs |
| 11t.3 | Create active/inactive, completed/abandoned/reopened, team/personal, and readable/unreadable publications | Only readable active completed team publications enter results |
| 11t.4 | Finalize publications with equal timestamps, then drain pages at a small limit | Every publication appears once in stable `(finalized_at, publication_id)` descending order |
| 11t.5 | Query a multi-team season as a user who can read only one team | Only that team's publications return; no inaccessible team names or counts leak |
| 11t.6 | Query a player with optional team/season filters | Results use `game_participants.source_player_id`, contain no duplicate publications, and filters only narrow visibility |
| 11t.7 | Merge a player referenced by a finalized soccer participant | The source link remounts to the survivor before duplicate deletion and remains aggregate-eligible |
| 11t.8 | Seed one audited historical null source and one unprovable null, then apply 047 | The audited chain repairs only when its survivor exists on the game team; the unprovable row remains unresolved and visible as partial quality |
| 11t.9 | Run the client before applying 047 | It returns `backend_update_required` and never falls back to legacy `game_stats` or resolved-stat RPCs |
| 11t.10 | Start two identical loads, cancel one, then change scope during another load | Identical work shares one request, one consumer abort does not cancel the other, and only the newest scope may publish |
| 11t.11 | After applying 047, repeat basketball merge regression 4a.13 | Migration 047's replacement merge RPC retains migration 041 behavior: duplicate-player shot rows remount to the survivor before deletion |

### 11u. Soccer aggregate destinations (SOC-6C3)

| # | Scenario | Expected |
|---|---|---|
| 11u.1 | Open Soccer Season Stats with two readable teams and one inaccessible team in the season | Only readable canonical publications and roster rows appear; the page labels the readable-team boundary and reveals no inaccessible-team metadata |
| 11u.2 | Open a Soccer Team Stats route with completed matches | Overview shows M, W-D-L, GF, GA, GD, CS and the eight For/Against totals; Players and Games match the canonical fixture |
| 11u.3 | Open Soccer Tournament Stats, then edit placement as owner/admin | Overview/Players/Games use only the tournament canonical scope; placement and tournament/team navigation remain available |
| 11u.4 | Add an active roster player with no appearance and retain a historical contributor no longer active | Participation includes the active player at 0 APP and the historical contributor with canonical totals |
| 11u.5 | Review every category and Rank by option on a narrow mobile viewport | Attack opens first and ranks by Goals; every canonical stat and reviewed rate is selectable; tables expose at most five value columns and remain horizontally usable |
| 11u.6 | Introduce one malformed or unresolved source and compare owner/admin with scorer/viewer | All roles see a generic partial notice; only a current manager of the affected team sees its detailed diagnostic and game link |
| 11u.7 | Refresh manually, switch scope during loading, then return focus after a completed load | Progress advances through loading/projection, stale work cannot publish, focus reloads, and a failed refresh retains the last coherent result with a visible warning |
| 11u.8 | Repeat Season, Team, and Tournament routes for Basketball | Existing resolved-stat and game-log RPC behavior and components remain unchanged |
| 11u.9 | Fail the active-roster read while canonical publications remain readable | Canonical totals still render with a warning that zero-appearance players may be missing |

### 11v. Soccer player and career aggregates (SOC-6C4)

| # | Scenario | Expected |
|---|---|---|
| 11v.1 | Open a soccer player from Season Stats and from Team roster | Player Profile uses the team/season-filtered canonical player scope; back and Career navigation retain their existing route context |
| 11v.2 | Open a soccer player with no finalized appearance | Participation renders at zero; Attack, Defense, Discipline, and Goalkeeping stay hidden while all-zero |
| 11v.3 | Open a player with values in several categories and reviewed rate denominators | Participation always renders, only nonzero additional categories render, and rates use combined canonical numerators/denominators |
| 11v.4 | Open Career Stats for a player with multiple seasons or team stints | Career totals use one stable player identity; By season keeps team stints separate and each expanded stint agrees with its canonical games |
| 11v.5 | Open a Profile or Career game row | The canonical Soccer Summary Players tab opens directly without parking or hydrating a legacy aggregate snapshot |
| 11v.6 | Merge a finalized-match player into a survivor, then reopen Profile and Career | All historical credit appears once under the surviving player id and current player display name; the deleted id has no route totals |
| 11v.7 | Test owner/admin/scorer/viewer plus malformed, unresolved, abandoned, reopened, personal, and shootout sources | RLS never broadens visibility; generic/manager diagnostics follow role; excluded source families do not enter player totals or history |
| 11v.8 | Repeat Basketball Player Profile and Career Stats, including Best game links | Existing resolved-stat, game-log, high-game, cloud hydration, and Summary behavior remains unchanged |
| 11v.9 | Open Career for a player rostered in both soccer and basketball, then switch sports in both directions | Both sports remain selectable; Soccer uses canonical publications only, while Basketball loads the existing resolved career rows |

### 11w. Soccer settings and default hierarchy (SOC-6D)

**Precondition:** Apply migration 048 before cloud-sync or shared-team checks. SOC-6D4 adds no
additional migration.

| # | Scenario | Expected |
|---|---|---|
| 11w.1 | Run `pnpm test`, `pnpm lint`, and `pnpm build` | Settings schema, hierarchy, cache, cloud/RPC, migration, snapshot, production-gate, and existing sport regressions pass |
| 11w.2 | Edit personal defaults anonymously, sign in to an account with established cloud defaults, then sign out | Established cloud values win while signed in; anonymous values return after sign-out; account caches never cross users |
| 11w.3 | Edit personal defaults offline, reconnect, and create a two-session revision conflict | Pending edits remain account-scoped; reconnect retries; Use Cloud and Keep This Device each produce the selected coherent result |
| 11w.4 | Corrupt a Soccer cache, block browser storage, or return schema version 2 | The invalid object is not partially applied; the app remains usable and reports inherited/session-only behavior |
| 11w.5 | Review/save team defaults as owner, admin, scorer, and viewer | Owner/admin may save; scorer/viewer remain read-only; migration/RLS enforcement agrees with the UI |
| 11w.6 | Fail the audit helper during a shared settings save | The settings write rolls back in the same transaction and no unaudited shared value is reported as saved |
| 11w.7 | Use Settings and Match Setup at 320 px and desktop widths with long period labels | Inputs and actions remain visible without incoherent overlap; team Save stacks on narrow screens |
| 11w.8 | Navigate personal setting tabs by keyboard and trigger Reset All | Arrow/Home/End move tab focus and selection; status/errors announce; Reset All confirms and remains unsaved until Save |
| 11w.9 | Park a Soccer setup, change personal/team defaults, then resume it | The parked match retains its fixed snapshot; a new setup resolves current built-in -> personal -> team -> match values |
| 11w.10 | Run production availability tests and repeat Basketball settings/setup/park/sign-out smoke checks | Soccer is hidden by default, becomes available after device opt-in, existing records remain reachable when disabled, and Basketball is unchanged |

See [the detailed SOC-6D matrix](REGRESSION_SOC_6D_SETTINGS.md) for automated evidence and the
full operator checklist.

---

## 11x. Soccer release hardening and enablement (SOC-6E)

SOC-6E separates production release, device discovery/new-game permission, and existing-record
access. Its consolidated matrix covers development preview, unreleased and released production,
capabilities through migration 049, PWA/offline recovery, multi-sport parking, roles, recorders,
finalization, summaries, aggregates, settings, responsive/accessibility checks, and Basketball.

Use [the SOC-6E release matrix](REGRESSION_SOC_6E_RELEASE.md) as the operator record. SOC-6E2
requires the development/staging and unreleased-production passes; SOC-6E3 repeats release-sensitive
rows against the deployed released build. CI alone is not release sign-off.

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
- **Migrations:** If a cloud feature fails, confirm the migrations listed in [README.md](../README.md) through **`048_soccer_settings_foundation.sql`** are applied in order. Seasons and roster integrity need **019** (run `supabase/scripts/audit_data_integrity_pre_019.sql` first on legacy DBs). Player merge needs **024**/**025** and **041**; team stats **028–031**; shot chart **032**; diagnostics **033**; Google profiles **034**; team security **035–038**; app access **039**; access audit **040**; shared events **042**; soccer cloud lifecycle **043–046**; soccer aggregate transport **047** (run its participant-source audit first); soccer settings cloud sync and team defaults need **048**.

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
