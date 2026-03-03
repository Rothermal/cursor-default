# Regression Testing — StatKeeper

High-level test scripts for features built so far. Use these to sanity-check after changes or before release. Run against local dev (`pnpm dev`) or the deployed GitHub Pages site; for cloud features, Supabase must be configured and migrations applied.

---

## 1. Offline / local-only mode

**Precondition:** No `.env` with Supabase vars, or use a build without env (e.g. `VITE_SUPABASE_URL` empty).

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Open app | No auth screen; home shows sport selection |
| 1.2 | Open console | Warning: "Supabase credentials not found... Running in offline-only mode." |
| 1.3 | Choose sport → Game Setup → enter team, opponent, date → Continue | Player setup |
| 1.4 | Add 2+ players → Start Game | Game Tracker loads; scoreboard shows 0–0 |
| 1.5 | Tap stat buttons (e.g. 2PT, AST) | Home score updates; opponent can be adjusted manually |
| 1.6 | Tap Undo | Last action reverted |
| 1.7 | Game Summary | Totals per player and team; no cloud sync UI |
| 1.8 | Reload page | Same game state (localStorage); no cloud games or teams |

---

## 2. Settings / Admin

**Precondition:** App loaded (signed in if Supabase configured).

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | From home, tap Settings (gear) | Admin page with sport toggles |
| 2.2 | Disable a sport (e.g. Basketball) | Toggle off |
| 2.3 | Return home | Disabled sport no longer in grid |
| 2.4 | Re-enable sport | Sport reappears on home |
| 2.5 | Reload | Settings persist (localStorage) |

---

## 3. Auth (Supabase)

**Precondition:** `.env` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; migrations 001+ applied.

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Open app (no session) | Auth page (sign in / sign up) |
| 3.2 | Sign up with email + password (+ optional display name) | Success message or redirect; check email if confirmation enabled |
| 3.3 | Sign in with same credentials | Home with sport selection; Cloud Games / Teams / Season Stats visible |
| 3.4 | Sign out (home footer) | Back to Auth page |
| 3.5 | Sign in again | Home; session restored |
| 3.6 | Console | "[StatKeeper] Supabase connected: … | key length: …" (key length >> 40) |

---

## 4. Cloud Teams & Roster

**Precondition:** Signed in; migrations 002, 004–006, 011 applied.

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | Home → Teams | Cloud Teams page; Create Team form |
| 4.2 | Create team (name, sport, season) | Team appears in list; selected |
| 4.3 | Add players (number, first, last) | Players appear in Roster |
| 4.4 | Edit team nickname (pencil) | Save; display name updates |
| 4.5 | Edit player nickname | Save; display name updates |
| 4.6 | Remove player | Player removed from roster (soft deactivate) |
| 4.7 | Season Stats link (when team selected) | Navigate to Leaderboard with that team pre-selected |
| 4.8 | Reload → Teams | Same teams and roster (from Supabase) |

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
| 5.7 | Undo last action | Previous value restored |
| 5.8 | Game Summary | Tables show per-player and team totals; categories correct |
| 5.9 | New Game (from home with active game) | Reset; can start new game |

---

## 6. Cloud game lifecycle

**Precondition:** Signed in; team with roster exists; migrations 003, 007 applied.

| Step | Action | Expected |
|------|--------|----------|
| 6.1 | Home → Cloud Games | List of games (or empty) |
| 6.2 | Start new game: Game Setup → choose existing team → Continue | Roster preloaded from cloud |
| 6.3 | Complete Player Setup → Start Game | Game Tracker; scoreboard shows sync status (e.g. "Cloud Sync: saved" after actions) |
| 6.4 | Record some stats; leave Game Tracker (e.g. back to home) | Sync runs; game saved to cloud |
| 6.5 | Cloud Games | Game appears (e.g. "In Progress") |
| 6.6 | Open same game → Resume | Game Tracker with same state |
| 6.7 | Game Summary → Finalize Game (if available) | Game status → Final |
| 6.8 | Cloud Games → open finalized game | View Summary (read-only) |
| 6.9 | Second device/session: sign in → Cloud Games | Same game list; resume same game if in progress |

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

---

## 10. Team invites

**Precondition:** Signed in; migrations 011 applied; two distinct user accounts (inviter = owner/admin, invitee = other).

| Step | Action | Expected |
|------|--------|----------|
| 10.1 | As owner: Teams → select team → Team Members | Member list; "Invite by email" section |
| 10.2 | Enter invitee email → Lookup | User found; display name shown |
| 10.3 | Choose role (Scorer / Admin) → Send Invite | Invite sent; member row shows "Pending" |
| 10.4 | As invitee: sign in → Teams | "Pending invites" banner with team name |
| 10.5 | Accept | Banner clears; team appears in list; member shows "Accepted" |
| 10.6 | As invitee: open team | Can see roster; can start games for that team |
| 10.7 | As owner: Team Members | Invitee listed with role; Remove available |
| 10.8 | As invitee: Decline (alternative flow) | Invite removed; team no longer in list |
| 10.9 | As admin (invited as admin): same team → Invite by email | Can lookup and send invite |

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
3. **Season:** Season Stats → pick team → open a player → View a game from Game Log.  
4. **Invite:** Owner invites by email → Invitee accepts in Teams → both see same team.

---

## Notes

- **HashRouter:** In-app links use hash routes (e.g. `/#/game`, `/#/teams`).  
- **localStorage:** Game and settings key `statkeeper_game`; clear to reset local state.  
- **Migrations:** If a script fails on cloud features, confirm all migrations through 011 are applied in Supabase SQL Editor.
