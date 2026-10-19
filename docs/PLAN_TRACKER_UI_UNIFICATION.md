# Plan: Shared Tracker UI and Legacy Retirement

Status: owner-approved product direction recorded 2026-10-17. TUI-1's Basketball
layout/action pass is implemented for review; event-only creation and legacy
retirement are still pending. See the [layout record](REGRESSION_TUI_1_BASKETBALL_LAYOUT.md).
No creation policy, legacy authority, migration or saved data changes in this pass.

## 1. Decisions and Scope

- One live tracker experience per sport. Do not expose a Classic/Legacy/Event
  selector or a device preference choosing the tracker version after cutover.
- Align Soccer, Basketball, Hockey and future Football around the same compact,
  surface-first order. Soccer is the closest reference, not a template to copy blindly.
- Retire legacy aggregate tracking, including for parked and unfinished games:
  **read-only stat summaries; no old tracker**. Preserve saved stats and unsynced
  local data. Do not automatically end, finalize or convert those games.
- Old Basketball shot charts are best-effort compatibility, not a cutover blocker.
  Stat summaries must remain available. Never rewrite historical points or frames
  to make a chart appear compatible.
- Start with Basketball, whose current full court has the right capabilities but
  too many controls above it. Reuse presentation where semantics match; sport
  commands, eligibility and authority remain sport-owned.
- Keep real sport settings, rules, display preferences and sport-discovery controls.
  Removing tracker-version toggles does not mean removing those settings.

The four-sport review does not authorize releasing Baseball or removing its current
preview gate. Future sports should adopt this interaction contract when ready.

### Owner Follow-Up Decisions (2026-10-17)

1. Remaining live release checks are post-deployment validation for the event-only
   Basketball cutover in the current owner-only context. The full broader-rollout
   gate remains in force; no unexecuted check is marked passed.
2. Unfinished legacy Basketball games stay strictly read-only, with no Finalize-only
   exception. Label their exclusion from season/career totals and preserve export.
   The owner accepts that they cannot become aggregate-eligible through the app
   after cutover. Previously finalized contributions remain unchanged.

## 2. Current Assessment

Source baseline: `4d7704f8` on `stattracker` (includes Basketball BKE-7D and Hockey
HKY-6C). Reassess touched code against the actual implementation head before coding.

| Sport | Shipped behavior at the baseline | Main gap |
| --- | --- | --- |
| Soccer | Event setup, clock/score, named side selector, pitch, quick capture, Lineup/Timeline and collapsed marker filters | Capture-mode controls and routine status compete above the pitch; tighten the ordering |
| Basketball | Opt-in event creation, full court, court-local attribution, Lineup/player details, Actions, Timeline, clock and cloud lifecycle | Separate score, lifecycle, bonus, recorder, clock, navigation and chart-filter blocks push the court below the first screen |
| Hockey | Every new game uses the event tracker; compact clock/score, Game menu, rink, penalties, Timeline and cloud lifecycle | No matching persistent side selector or live filter placement; retain Hockey-specific strength/goalie behavior |
| Football | Generic aggregate player strip and stat grid | No Football event tracker, field, clock or situation engine yet; FBE foundations are prerequisites, not layout work |

### Browser Evidence and Limits

The preceding audit rendered the real tracker components/providers in disposable,
offline browser fixtures at 390 x 844 and 1280 x 900. On the phone-sized fixture,
the rink started about 259 px down, Soccer's pitch about 500 px, and Basketball's
court about 925 px. Football had no playing surface. All eight renders had no page
errors. These are baseline observations, not fixed sizing requirements or coverage
of every game state.

This was desktop Chromium at mobile/desktop viewport sizes, not a real phone,
installed PWA, live Supabase session or full-game signoff. New layout-pass checks
are recorded separately in the linked regression record; neither upgrades pending
live regression rows to passed.

### Code Map

| Area | Starting points |
| --- | --- |
| Dispatch and creation policy | `src/App.tsx`, `src/lib/gameSetupRoute.ts`, `src/lib/sportAvailability.ts` |
| Basketball workspace | `src/pages/GameTracker.tsx`, `src/components/Scoreboard.tsx`, `src/components/basketball/BasketballClockStrip.tsx`, `src/components/shot-chart/ShotChartPanel.tsx` |
| Soccer and Hockey workspaces | `src/pages/SoccerGameTracker.tsx`, `src/pages/HockeyGameTracker.tsx` |
| Legacy review and mutations | `src/pages/GameSummary.tsx`, `src/pages/game-summary/`, `src/pages/GameInfo.tsx` |
| Dashboard, cloud and team entry | `src/pages/SportDashboard.tsx`, `src/pages/Games.tsx`, `src/pages/TeamInfo.tsx` |
| Local preservation and transport | `src/context/GameContext.tsx`, `src/lib/gameParking.ts`, `src/lib/gameSyncFingerprint.ts`, `src/lib/cloudSync.ts` |
| Basketball setup | `src/pages/GameSetup.tsx`, `src/pages/PlayerSetup.tsx`, `src/lib/basketball/setupDraft.ts`, `src/components/settings/BasketballSettings.tsx` |

Basketball's global individual capture strip has already been removed from its
workspace. Clock-strip player names are lineup context, not a global actor picker.
Do not repeat completed attribution/roster work or remove useful lineup context
under the mistaken assumption that it is the old player strip.

## 3. Shared Live Layout

```text
Compact navigation: Back / workspace tabs / Game menu
Score + period + game clock + Start/Pause, when supported
Compact essential sport context
Team nickname selector
Playing surface
Quick capture / Manage Lineup where supported / Undo
Collapsed display filters
Optional detail modules and recent context
Routine sync status and recovery access at the bottom
```

- Nothing optional sits between the team selector and playing surface. Move
  expanded foul/bonus panels, chart-player filters, capture options and routine
  recorder diagnostics out of that space. Keep the surface usable in the first
  phone viewport for a normal healthy game, without shrinking touch targets.
- The sticky area is compact clock/score and essential situation context, not a
  growing collection of panels. A long penalty list or lineup review opens below
  the surface or in a sheet; urgent blockers remain noticeable.
- Essential context is sport-specific: Basketball current foul/bonus state,
  Hockey strength/active penalty indication, Football possession/down/distance.
  Detail belongs in expandable sections or sheets. Clockless event games show
  their supported period/score state, not a fabricated 00:00 clock.
- Use named team buttons, with full accessible names and a wrapping/compact visual
  treatment for long nicknames. Stable internal tracked/opponent ids do not change.
- Team selection supplies capture context, not a hidden player, a chart filter,
  a possession change, goalie change or lineup mutation. Preserve surface-driven
  side inference (for example Basketball's tapped basket) and each sport's checked
  event flow; do not override it merely to make selectors look identical.
- Filters sit below the surface, collapsed by default, and change display only.
  Retain legitimate player/side/period/result review where supported. Do not add
  unsupported filter dimensions or hide an event from validation or totals.
- Keep quick capture and Undo close to the surface. Put secondary options such as
  orientation, period/lifecycle operations, notes, recorder management and settings
  in a compact Game/More menu or existing sheets. Preserve explicit confirmation
  and consequences for destructive/lifecycle actions.
- Keep lineup-card -> in-game details and separate Manage Lineup semantics. Do not
  invent Hockey shift tracking or Football substitution rules to fill a shared slot.
- Routine sync status belongs at the bottom. Conflicts, failed saves, quarantine,
  access loss and incomplete authority still need a visible actionable alert;
  moving routine status is not permission to hide a blocking error below the fold.
- Light/Dark keeps each sport's real surface colors, focus visibility and contrast.
  Mobile safe areas, keyboard operation and dialog focus remain release contracts.

## 4. Sharing Without a Universal Sport Engine

Use existing primitives first. A small layout frame can own visual slots for
navigation, scoreboard/clock, situation, side selector, surface, quick actions,
filters and footer. Extract shared presentation when Basketball and a second real
caller demonstrate compatible behavior; avoid creating a speculative framework.

Each sport owns its clock display derivation, Start/Pause/Set Clock commands,
surface mapping, eligible actors, event forms, lineup rules, lifecycle and sync
callbacks. Do not move these into a shared component with a sport-id switch.
Use explicit capabilities/slots; an absent capability omits a control rather than
falling back to aggregate capture.

Layout state, view tabs, expanded filters and selected capture side must not enter
gameplay fingerprints, event streams, setup snapshots or cloud payloads. Preserve
existing reload-safe presentation preferences where appropriate. Navigation and
opening a sheet do not stop clocks, append events or commit lineup drafts.

## 5. Legacy Retirement Contract

### Classification

Here, legacy means an aggregate-authoritative game, not an older event schema,
clockless event game, or historical half-court event location. Keep those valid
event games on their supported event paths. Unknown, corrupt or quarantined event
records must never be relabelled legacy to bypass validation.

Retirement is an explicit per-sport policy, not a global flag on the shared generic
Summary or Game Info. TUI-1 retires only Basketball aggregate capture and mutation.
Hockey follows in TUI-2, Football in its FBE/TUI-3 cutover, and Baseball retirement
is deferred to its own release plan. Until each cutover, preserve that sport's
authorized legacy capture, corrections, primary-recorder changes and finalization,
with all current permission/status guards. Shared handler changes must use both
the game's sport and authority, not disable every caller of a generic component.

### Read-Only Review

At each sport's cutover, active, parked, imported and cloud legacy records open a
read-only Summary, regardless of whether their saved status is final. Dashboard
and list actions say View Summary rather than Resume tracking. Direct `/game`,
`/players`, `/checkout`, setup-continuation and Game Info links cannot reopen the
legacy capture path or create a new legacy game. Back navigation returns to the
appropriate dashboard/list, not a redirect loop through the tracker.

The current generic Summary is not read-only: it contains stat-correction,
primary-recorder, finalization and Back to Game paths. Audit Summary, Game Info,
shared controls and handlers together. After cutover, legacy review cannot change
stats, primary selection, game metadata, roster, status or history, even for admins.
Existing corrections and source resolution remain readable; do not reset them.

Provide explicit local-active/local-parked versus cloud sources so a local-only or
unfinished game can be reviewed without a cloud id, fabricated completion or
remote hydration into the active game. Keep local unsynced facts distinct from
cloud/resolved results when they differ; do not silently replace one with the other.
Preserve stable ids, opponent/team totals, player lines and honest saved status.

### Unfinished Basketball and Aggregate Eligibility

The legacy aggregate page requires cloud `status = 'final'`
(`supabase/migrations/060_basketball_aggregate_sources.sql`,
`_basketball_legacy_aggregate_page`). Syncing existing facts does not satisfy that
condition or finalize a game. Under the owner's explicit decision above, unfinished
legacy Basketball games remain excluded from season/team/tournament/player/career
aggregate results after cutover; do not add them to official totals as a workaround.

Show an explicit notice such as "Not finalized: not counted in season or career
stats" on those summaries, with the saved stat lines and export still accessible.
Neither admins nor scorers get a Finalize exception. Preserve contributions that
were already eligible and final; this decision does not erase saved stats or remove
already-finalized legacy history from aggregates.

### Data and Sync Preservation

- No event-history synthesis, automatic authority conversion, database cleanup,
  automatic finalization, or deletion of aggregate/stat/shot compatibility readers.
- Keep existing legacy source resolution and aggregate contributions in destinations
  that already support them, including Basketball player/team/season/career totals.
  Do not promise new Hockey/Football legacy aggregation that their plans exclude
  or defer. Existing historical reads remain authorized by current access rules.
- A local record stays stored with its ids, ownership, dirty/revision metadata and
  export path. Visiting its Summary does not clear unsynced state or acknowledge
  an upload. Imports remain parked-only and preserve authority.
- Transporting already-recorded legacy data is distinct from recording new facts.
  Preserve authorized existing snapshot sync, but make retry/recovery accessible
  without the old tracker. Do not mark an unsupported, blocked or skipped upload
  successful. Keep stale-result, account, binding and final-cloud-write guards.
- If a record cannot sync safely, retain the local copy, explicit error and export;
  do not require a return to retired capture UI. Existing explicit Delete local copy
  remains a separate warned data-management action, never implicit cleanup.
- Do not erase old preferences or setup drafts on load. Stale legacy creation
  drafts cannot commit after cutover; offer an explicit new event setup with normal
  review rather than silently promoting their authority or overwriting a game.

Charts can be omitted or labelled unavailable when safe historical rendering is
not possible. Stored shot rows, exports and underlying stats remain intact.

## 6. New-Game and Release Behavior

Basketball cutover must cover all entry points, not just the Settings toggle:
Sport Dashboard, Team Info, direct setup links, drafts, capability recovery and
the final commit/start guard. Every new Basketball game uses event authority;
saved false/true preview preferences cannot choose a different tracker.

Extend the centralized Basketball creation policy with a `released` state for this
cutover: new event games are allowed independently of obsolete preview preferences,
and no tracker-version preference is available. Keep creation policy separate from
whole-sport discovery and historical-game access. The old `opt_in` behavior is
historical/transitional, not a supported post-cutover UI or rollback destination.

Replace Legacy fallback choices with supported event-only recovery: Retry, explicit
local-only event setup when permitted, or Cancel/Back. Do not bypass backend
capabilities, fresh access, account/team ownership, equal-play or cloud-binding
checks. Missing cloud support never causes aggregate writes from an event game.
Local-only creation must remain genuinely local-only unless explicitly enabled.

Hockey already defaults all new games to events with no visible tracker toggle;
its outstanding change is layout/legacy review, not a second release activation.
Soccer keeps its existing event authority. Football follows the same event-only
creation and summary-only legacy target when FBE is ready; do not disable its only
current creation path as a side effect of the Basketball PR.

Keep internal operational rollback controls, not user-facing old/new UI switches.
A creation rollback from `released` to `internal` means **no new Basketball games
in production**, including new local-only games: there is no Legacy fallback.
Existing event access, review/recovery and exact matching committed pre-start
continuation remain available; those are not new-game creation. A presentation-only
rollback may revert layout without changing authority or reviving legacy recording.
Do not restore the old `opt_in` selector or convert records. This frontend retirement
is not a server-wide revocation of old clients'
write access. Refresh browsers/PWAs before owner validation; stronger old-client
enforcement would require separately reviewed backend work.

The owner explicitly approved post-deployment validation for this cutover on
2026-10-17. This narrowly supersedes the
[BKE-5D](PLAN_BKE_5D_RELEASE_AND_EXIT.md) prerequisite to complete the live matrix
before production history depends on the event tracker, **only while access remains
owner-only**. It does not supersede the condition before access materially broadens.
The [BKE-6E broader gate](REGRESSION_BKE_6E_RELEASE.md#gono-go) remains blocked on D03,
D05-D07 and G03-G04. Those checks remain pending, not passed or permanently waived.
Record the focused cutover smoke and pending checks against the deployed candidate;
authorization, data-loss and other concrete correctness failures remain blockers.
No migration, access widening or creation-policy change occurs in the layout/action
pass. The authority cutover remains the next PR.

## 7. Delivery Proposal

These are coherent work packages, not a requirement for four or more micro-PRs.
Combine small compatible changes; split only when routing/data preservation and
visual changes cannot be reviewed and tested clearly together.

| Package | Scope | Exit |
| --- | --- | --- |
| TUI-1: Basketball first | Inventory actions; compact shared-ready layout; move filters/status; preserve full-court capture and player details; event-only setup and summary-only legacy cutover with preservation tests | New Basketball uses the single event tracker; old aggregate games can only be reviewed/exported/safely synced, with unchanged stats |
| TUI-2: Soccer and Hockey alignment | Reuse proven layout pieces, move optional pre-surface controls, add consistent Hockey side context/filter placement where supported; retire existing Hockey aggregate capture | Both sports follow the same visual order without losing sport-specific capture or lifecycle behavior |
| TUI-3: Football adoption | Build after FBE-1/FBE-2 and FBE-3 Q&A; apply the shared shell in FBE-3, carry retirement through the Football release plan | Football's new event tracker uses the same order; old Football records retain summaries, not a parallel grid tracker |

### TUI-1 Implementation Boundary

Source assessment identified two separate review surfaces within TUI-1:

- **Layout/action pass (implemented for review):** compact event header, Game menu,
  clock/lineup tools, quick court actions, collapsed chart filters/tools and bottom
  routine sync/recorder status. Existing commands, setup, release policy, legacy
  capture and cloud authority stay unchanged. The action inventory and verification
  are in the [layout record](REGRESSION_TUI_1_BASKETBALL_LAYOUT.md). Lineup Save/Cancel
  preserve the actual launcher and clock-disclosure state, including the late-player
  handoff; no navigation-only gameplay events are added.
- **Authority cutover (next PR):** event-only new-game creation and summary-only
  legacy routing, including local source review/export/safe sync, capability
  recovery, stale drafts and per-sport Summary/Game Info guards. This reaches setup,
  persistence and shared cloud-open handlers; combining it with the layout move
  would obscure the data-preservation review. All decisions in sections 1, 5 and 6
  remain binding. TUI-1 is not complete until this cutover is implemented/tested.

This is a two-PR review boundary, not additional rollout toggles or a new four-phase
program. TUI-2 remains after completion of the Basketball cutover.

Before TUI-1 implementation, map every existing action to a destination. Include
quick fouls/free throws, linked assists/rebounds, direct individual/team stats,
score corrections, bonus/timeouts, ejections, late players, lineup/boundary review,
periods, completion/reopen, Timeline, Undo/Restore, cloud recovery and export.
An action moving into a menu must retain its guards, accessibility and reachability.

The existing [Basketball workspace](PLAN_BASKETBALL_WORKSPACE_MODERNIZATION.md),
[attribution/roster](PLAN_BASKETBALL_ATTRIBUTION_AND_ROSTER.md) and
[full-court](PLAN_BKE_7_FULL_COURT.md) plans describe delivered work to preserve.
This plan supersedes their continued legacy-capture direction at cutover, not their
historical evidence. It also supersedes HKY-6's continued generic tracker access
and FBE-3's proposed legacy grid route.

At TUI-1 cutover this also supersedes the Legacy default/fallback, preview preference,
two-state policy and old rollback expectations in
[BKE-5D](PLAN_BKE_5D_RELEASE_AND_EXIT.md), particularly decisions 3-7 and 10-15, only
where they conflict with the new event-only model. Existing authority, transport and
access safeguards remain. Section 6 records the owner's specific exception to the
production-history live-matrix prerequisite; the
[BKE-6E broader-rollout requirement](REGRESSION_BKE_6E_RELEASE.md#gono-go) is retained.
Old opt-in release matrices keep their original evidence; new implementation records
must identify superseded expectations instead of retroactively marking rows passed.

## 8. Required Verification for Implementation

| Area | Required evidence |
| --- | --- |
| Authority/routing | New-game entry points and final commit ignore obsolete UI preferences; direct links, stale drafts, imports and parked/active/cloud legacy records cannot reach mutation UI; corrupt event states remain quarantined |
| Legacy data | Before/after fixtures preserve stats, corrections, ids, dirty metadata and saved status; local unfinished Summary works offline; failed sync retains data/export; terminal cloud guards and warned local deletion remain intact |
| Unfinished legacy Basketball | Nonfinal local/cloud records remain read-only and clearly labelled as excluded from aggregate totals, with export; no Finalize exception, automatic status change or aggregate-filter widening; previously finalized contributions remain unchanged |
| Historical events | Clockless/anchored and half-/full-court event records remain distinguishable, replay correctly and never fall through to aggregate sync |
| Core interactions | Both sides capture with correct actors/relationships; surface-derived side/frame mapping survives flip and filters; lineup details and Manage Lineup stay distinct; Timeline/correction/Undo preserve semantics |
| Clock/authority | Supported Start/Pause/Set Clock and lifecycle/lineup guards remain unchanged; tabs/menus/filters do not emit events or mutate fingerprints; terminal/viewer/recovery paths stay read-only |
| Summary/destinations | Local and authorized cloud legacy summaries still show recorded/resolved stats; existing Basketball canonical/legacy aggregate contributions do not collide or disappear |
| Layout/accessibility | Actual screenshots/interactions at 390px and 1280px, Light/Dark, long names, empty/opponent rosters, dense penalties/bonus, running/paused/clockless, errors/conflicts; surface visible in healthy phone first viewport, no overlap/overflow, usable focus and touch targets |
| Sibling isolation | TUI-1 retirement is Basketball-only; authorized Hockey/Football/Baseball legacy capture, correction, primary selection and finalization remain usable until their own cutovers; event routing and mixed-sport parking/recovery stay correct; Football never routes to a missing tracker |
| Release/rollback | `released` ignores obsolete preview preferences; `internal` blocks every new production Basketball game without Legacy fallback, while existing event access and exact committed pre-start continuation remain usable |
| Deployment | Owner-approved post-deployment validation: fresh event game, old unfinished local Summary with exclusion notice/export, cloud sync/review and refreshed installed-PWA checks reported separately from desktop fixtures and unit/build results; broader gate stays pending until its live evidence is recorded |

Use focused unit/component/browser coverage plus typecheck, lint, the full suite
and build for shared routing/authority changes. Record actual counts and failures.
No local test establishes live server or device signoff.

## 9. Deferred and Open

- The [timing/live-lineup assessment](PLAN_EVENT_TIMING_AND_LIVE_LINEUPS.md) remains
  separate. UI alignment does not remove current paused-substitution or clock-replay
  guards, even though live substitutions are an approved future goal.
- Football phase Q&A still owns play entry, units, clock and field-specific details.
  The shared team selector must not become its possession-change command.
- No new Hockey shift tracking, universal player-detail engine, Baseball release,
  chart-data migration, branding rollout or mass documentation archive is included.
- The two cutover questions from PR #490 are resolved by the owner decisions in
  section 1. Reassess source and implementation size at TUI-1 start; bring back any
  newly discovered requirement to drop recorded stats, bypass cloud safety or
  change sport rules rather than treating it as a layout detail.
