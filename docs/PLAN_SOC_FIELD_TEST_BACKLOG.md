# Soccer Field-Test Backlog

Status: living inventory after first live matches. Owner-confirmed items are
`S2`, `S3`, `S11`–`S21`. This is not an implementation plan.

Soccer SOC-1 through SOC-6E3 are implemented. The next soccer work is no longer "finish
the first release." It is the same kind of post-use backlog basketball used after court
capture: numbered items that wait for owner confirmation, then expand into a focused
`PLAN_*.md` before code.

```text
docs/PLAN_COURT_CAPTURE_ENHANCEMENTS_ROADMAP.md
```

is the basketball analog (F5-F13). Soccer items here use `S*` for first-match tracker
and review friction, and `M*` for modules already reserved beyond SOC-6.

## 1. Purpose

Track issues and future StatKeeper features that first soccer matches make visible.

- `S*` items are near-term product gaps in the shipped tracker, lineup, clock, and
  summary. They do not change the event-authoritative model.
- `M*` items are SOC-0 / SOC-6 deferred modules. They stay out of the first soccer
  release and need their own phase plan if promoted.
- Do not reopen SOC-0 through SOC-6 high-level decisions unless an item explicitly
  says the decision should be revisited.
- Do not implement from this document. Expand one confirmed item at a time.

The GitHub issue tracker is not the source of truth for this program. One open
identity issue exists (`#254`); soccer field-test work lives in this doc until an
item is planned.

## 2. How to use

1. Confirm, rewrite, split, or drop `S*` items from actual match notes.
2. Keep `M*` items listed so later season/coach requests do not get lost.
3. When an item is confirmed, write a focused plan and Q&A the way SOC-4 / F5-F12
   were planned. File lists, acceptance, and regression belong in that plan.
   Restart capture has an approved plan in
   [`PLAN_SOC_RESTARTS.md`](PLAN_SOC_RESTARTS.md).
4. After a plan ships, mark the item implemented here and link the plan.

Owner match notes live in [Section 8](#8-owner-match-notes). Confirmed items
keep their code-backed likely direction so the next plan can start from a
real screenshot or file path.

## 3. Shipped baseline

First matches already have:

| Surface | What is already there |
|---|---|
| Setup | Immutable rules snapshot, IFAB / U.S. High School / Custom profiles, local or cloud roster |
| Tracker | Full-pitch Field tab, Tracked/Opponent side, persisted capture mode, player chips, located Shot/Defense/Foul, quick Goal/Foul/Card/Team, Lineup, Timeline, shootout workspace |
| Clock | Start/pause, period end, overflow clock correction, suspend/abandon/reopen |
| Events | Shots with outcomes and creators, own goals, score adjustments, tackles/interceptions/clearances/recoveries, fouls/cards, corners/offsides, substitutions, roles, late participants |
| Cloud | Independent recorder streams, conflicts, checkpoints, manager finalization/reopen |
| Summary | Overview, Players, Timeline, Field, Shootout; local / primary / canonical sources |
| Aggregates | Canonical `soc_*` player and team scopes; no standings |
| Release | Production opt-in, default off; existing records stay reachable |

Current tracker files: `src/pages/SoccerGameTracker.tsx`,
`src/components/soccer/SoccerShotCaptureDialog.tsx`,
`src/components/soccer/SoccerIncidentCaptureDialog.tsx`,
`src/components/soccer/SoccerLiveActionDialog.tsx`,
`src/components/soccer/SoccerField.tsx`.

## 4. First-match issues (`S*`)

These are the items first sideline use makes urgent. Recommended planning order is
in [Section 6](#6-recommended-planning-order).

### S1 - Faster shot and goal capture

**Status:** proposed  
**Theme:** sideline speed  
**Where:** `SoccerShotCaptureDialog`, Field tap, Quick Goal

A field tap or Quick Goal opens the full attacking sheet: outcome, situation,
shooter, optional primary/secondary creator, blocker, goalkeeper, own-goal
toggle, and location editor. That is correct for complete attribution. During a
match it is too many decisions before the next play.

Basketball solved the same problem with F6-F9: confirm player, log the result,
then optional linked steps. Soccer already stores a linked shot event; the gap
is the live gesture, not the schema.

**Likely direction:** outcome-first sheet; remember last shooter; prompt assist
or save only after Goal / Saved; keep the full sheet for edit and Timeline add.

**Not this item:** new shot outcomes, xG, header (`S15`), placement (`S16`),
or the rest of detailed goal metadata (`M5`).

### S2 - Substitution from the Field tab

**Status:** confirmed — largest first-match challenge

**Theme:** lineup during live play  
**Where:** `SoccerGameTracker` Field tab, `SoccerLiveActionDialog` `substitution`

Substitutions are a core youth-match action. The Field tab has Quick Goal, Foul,
Card, and Team. Substitution lives in the header overflow action sheet with
roles, clock correction, late participant, and rules.

Owner confirmation: first live matches made this the biggest workflow gap.

**Likely direction:** a Field-tab Sub control that opens the existing
substitution window. Optional later: tap a Lineup row to start the same window
(`S8`).

**Planning note:** the current quick row is already full (Goal, Foul, Card,
Team), and the restart plan renames Team rather than freeing that slot. Plan
`S2` with `S3` as one Field-shell pass that defines compact primary actions and
an overflow/review treatment. Do not keep adding one-off fifth and sixth
buttons to the four-column row.

**Not this item:** changing substitution-window or return-sub rules.

### S3 - Keep the pitch on screen

**Status:** implemented — focused field-priority slice; see
[`PLAN_SOC_MATCH_READINESS_S11_S3.md`](PLAN_SOC_MATCH_READINESS_S11_S3.md)

**Theme:** mobile layout  
**Where:** Field tab chrome in `SoccerGameTracker`

Before this slice, the Field tab stacked:

- Tracked / Opponent
- player chips
- Shot / Defense / Foul
- marker family All / Shots / Defense / Incidents
- marker side
- marker period Current / Match

On a phone the pitch and quick actions sit below that chrome. Marker filters
are review controls; they do not need to stay expanded while recording.

**Implemented direction:** side, player, and capture mode remain visible. The
pitch and quick capture now precede a collapsed, native Marker filters
disclosure. Marker meaning and saved filter state did not change. The broader
`S2` substitution/action-shell work remains open.

**Not this item:** application-wide reskin (`M14`).

### S4 - Recent-events undo on Field

**Status:** proposed  
**Theme:** last-action correction  
**Where:** Field tab; `SoccerTimeline` already owns revisioned correction

Soccer Timeline is stronger than basketball's newest-only undo. Sideline use
still needs a one-gesture "undo that last Goal / Sub / Card" without leaving
Field and finding the row.

Basketball F12 is the product analog: show recent events, unwind only the
newest. Soccer should label recent events and still apply correction through
the existing checked helpers, not a second undo stack.

**Likely direction:** a Field-tab Undo that lists recent user-recorded events
and undoes the newest through current soccer correction commands.

**Not this item:** out-of-order undo, or weakening Timeline as the complete
review surface.

### S5 - Reusable opponent identities

**Status:** proposed  
**Theme:** opponent attribution  
**Where:** shot/incident actor pickers, SOC-0 simplified opponent

SOC-0 rejected a full opponent roster for first release. First matches still
need the same opponent name more than once: #9 shot, #9 foul, #9 card. Today
those are typed labels per event, with a recent-label helper on some sheets.

**Likely direction:** a match-scoped lightweight opponent list (number +
label) that chips can reuse. Do not add opponent lineup, minutes, or
permanent player-pool rows.

**Not this item:** full opponent roster management (`M4`) or name-based
season merges (still forbidden).

### S6 - Sideline clock correction

**Status:** proposed  
**Theme:** clock  
**Where:** scoreboard Start/Pause; overflow `Correct clock`

Start/Pause and End Period are on the scoreboard. Added time, a late pause,
or a one-minute drift requires the overflow dialog. Youth matches do this
often.

**Likely direction:** keep exact clock correction; add a short path for
common adjustments (nudge, mark added time) without hiding the current
dialog.

**Not this item:** inferred possession (`M9`) or automatic referee-clock
sync.

### S7 - Offer the last restart as the next shot source

**Status:** proposed  
**Theme:** set-piece linking  
**Where:** `sourceEventId` on attacking events; live Goal/Shot sheets

Fouls already store a restart. Shots already accept an optional
`sourceEventId`. Live Goal/Shot does not make "from that corner / foul /
penalty" the default next step, so first-match set pieces are easy to
record as unrelated open-play shots.

**Likely direction:** after a located corner, penalty foul, or direct free
kick, the next shot sheet defaults situation and source to that restart.
The recorder can clear it.

**Not this item:** implementing new restart capture. That belongs to `S17` /
`S20` and the dedicated restart plan.

### S8 - Lineup as a live board

**Status:** proposed  
**Theme:** on-field management  
**Where:** tracker Lineup tab

Lineup shows on-field / bench, minutes, and Role / Resolve. There is no
row action to substitute, and adding a late participant is overflow-only.
Coaches think in "this player off, that player on."

**Likely direction:** row-level Sub and a visible Add participant control
that reuse `SoccerLiveActionDialog`.

**Not this item:** formation drawings or position heatmaps.

### S9 - Persist field orientation

**Status:** proposed  
**Theme:** settings / parked match  
**Where:** `fieldFlipped` in `SoccerGameTracker`; SOC-6D soccer settings

SOC-0 called for a field-orientation preference where useful. The tracker
flip is a display-only `useState` and resets on remount. Standing on the
same sideline every week makes that noticeable.

**Likely direction:** persist flip on the parked match, and optionally as
a personal soccer setting. Do not change stored coordinates or attacking
direction events.

**Not this item:** automatic end-switch rules (already event-owned).
Upside-down cluster counts after flip are `S18`.

### S10 - Defense without a mode switch

**Status:** proposed  
**Theme:** sideline speed  
**Where:** Field capture mode `shot` / `defense` / `foul`

Defense is a first-class field mode. A tackle still requires switching
mode, then tapping. Quick actions cover Goal, Foul, Card, and Team, but
not Defense. Basketball still holds F11 for the same class of hybrid
1-tap buttons.

**Likely direction:** a Quick Defense control, or a short outcome-first
defense sheet from the current location/player. Keep one
`soccer.defensive_action` event.

**Not this item:** pressures, duels, or dribbled-past (`M8`).

### S11 - Default player role that carries between games

**Status:** implemented; see
[`PLAN_SOC_MATCH_READINESS_S11_S3.md`](PLAN_SOC_MATCH_READINESS_S11_S3.md)

**Theme:** roster / setup  
**Where:** `SoccerPlayerSetup` `initialRole`; in-game `soccer.role_changed`; no player- or roster-level soccer role

SOC-0 already says position stays off permanent player identity and that
in-game role can change. Setup still defaults every new player to midfielder.
`team_players.position` exists for basketball-style roster text and is unused
by soccer setup.

Owner confirmation: role may still change during a match, but the default
should be assignable on the player/roster and reused the next time that
player is in a soccer lineup.

**Implemented direction:** Soccer team roster entries store one strict
`soccer:*` role in `team_players.position`. Team management defaults new rows
to Midfielder and lets roster managers edit the value. Fresh cloud-team match
setup prefills `initialRole`; setup and live Role changes remain match-only.
Null, unknown, and legacy free text safely fall back to Midfielder.

**Storage note:** `SoccerTeamSettings` remains exactly `{ rules }`; role data is
team-roster scoped, not global player identity or team settings. Player merges
preserve untouched raw legacy values and expose strict Soccer labels/options
when a roster conflict needs a decision. `S19` may consume these stable
defaults later without changing live role-event authority.

**Not this item:** formation drawings (`S19`), minutes-by-role analysis, or
treating role as a second player identity.

### S12 - Edit shots from Timeline, not only from the pitch

**Status:** confirmed  
**Theme:** correction  
**Where:** tracker Timeline (`SoccerTimeline` → `SoccerLocatedEventEditor`);
Field marker tap (`editFieldEvent` → `SoccerShotCaptureDialog`)

Owner confirmation: located shots can be edited by selecting the marker on
the pitch, but the same correction was not available or did not work from the
event tracker / Timeline during use.

Code review found that `SoccerTimeline.editEvent` already routes every
`soccer.shot` and `soccer.own_goal` (located or unlocated) through
`SoccerLocatedEventEditor` into `SoccerShotCaptureDialog` edit mode. This is
therefore a confirmed symptom, not yet a proven missing route. Authority can
also matter: an owned local source is editable, while canonical, cloud-primary,
and alternate recordings are intentionally read-only.

**Likely direction:** reproduce first and record the exact surface/source:
live Tracker Timeline versus post-game Summary Timeline, local versus cloud,
whether the Correct pencil is absent, and whether the sheet opens but save
fails. Add a focused regression for the failing branch. Only then change the
route, visibility gate, busy wrapper, or error presentation that is actually
responsible.

**Not this item:** out-of-order undo (`S4`) or changing revision rules.

### S13 - Opponent foul can attach a tracked player and lock the match

**Status:** confirmed — live correctness bug  
**Theme:** opponent attribution  
**Where:** `SoccerIncidentCaptureDialog`;
`validateIncidentActor` in `src/lib/soccer/soc4.ts`

Owner screenshot (Champlin Rebels 2026, Second Half 35:55, 2-0, Needs
Attention): Timeline diagnostic

> Committing actor cannot reference a tracked participant for the opponent.

The newest foul was `Opponent / Murdoch Rothermal / direct free kick` at
revision 2. Cloud sync showed the same truncated message, plus Retry/Export.
Live controls were locked behind Review Timeline Issues.

Cause: new incident sheets default `attribution` to `participant` even when
`teamSide` is `opponent`. Opponent ActorEditor hides the Player chip, but
save still sends the selected tracked participant. Projection then fails
closed and parks the raw event.

**Likely direction:** when the event side is opponent, never keep a tracked
`participantId` on the committing actor. Default opponent incidents to
unknown/label or team. Reject in the sheet before append. After a bad
historical row exists, Timeline Correct must be able to convert it to an
opponent label without leaving the stream incomplete.

**Not this item:** a full opponent roster (`M4` / `S5`).

### S14 - Cannot finalize a completed soccer game

**Status:** confirmed — cloud blocker  
**Theme:** finalization  
**Where:** `SoccerFinalizationPanel`; `finalizeSoccerGame` in
`src/lib/soccer/finalization.ts`;
`finalize_soccer_event_game` in `046_soccer_finalization_recovery.sql`

Owner screenshot (same club, ended 3-1, Overview, Local, Cloud
Finalization / Primary: Mark):

> Soccer finalization failed: Primary recorder changed; reload before finalizing

Finalize and Lock stayed enabled. Reopen Match was also shown. The owner
reports this on more than one game.

The RPC text is misleading. `Primary recorder changed; reload before
finalizing` is raised when the stored primary checkpoint is missing or its
`event_revisions` / `stream_fingerprint` do not match the submitted
snapshot. A real primary change uses `refresh finalization readiness`.
The panel has no Reload control.

`S13` may have prevented a healthy checkpoint on the affected match, but that
relationship is not proven. The finalization client already reloads the cloud
primary, rejects an incomplete projection, and confirms a stale checkpoint
before submitting. The active server implementation now runs through the
shared `finalize_event_game` core introduced by migrations 055 and 058; the
public Soccer RPC name remains stable. A mismatch after that preparation is a
race, stale readiness/checkpoint detail, or fingerprint/revision disagreement
that needs captured evidence rather than another speculative retry.

**Likely direction:** show the real mismatch (checkpoint stale, stream
incomplete, or primary changed). Offer Sync / reload readiness before
submit. Do not offer Finalize when the local or primary projection is
incomplete. After `S13` is repaired, re-test this match path before
changing the RPC.

**Investigation evidence to capture:** game id, current user id, selected
primary id, readiness before/after preparation, recorder checkpoint count and
timestamp, primary event revisions/fingerprint, and whether any event changed
between checkpoint confirmation and finalization. Add a deterministic test for
the prepare-confirm-finalize sequence and a specific UI state for stale
checkpoint versus changed primary. Do not expose raw fingerprints in ordinary
user-facing copy.

**Not this item:** changing canonical publication rules or allowing
finalize from an incomplete stream.

### S15 - Mark a goal as a header

**Status:** confirmed — new capture feature  
**Theme:** goal metadata  
**Where:** `soccer.shot` payload today is only `outcome`, `situation`, and
optional `sourceEventId`; SOC-0 reserved body part under detailed goal
metadata (`M5`)

Owner request after first matches: the recorder needs to mark when a goal
is a header. That is the first slice of `M5` body part, not a new event
type.

**Likely direction:** after Goal is chosen, show an optional Header chip
(skip allowed). Store it on the existing `soccer.shot` event. Keep the
core goal/shot totals unchanged. Own goals and non-goal shots can omit it
until a later `M5` body-part catalog exists. Timeline and Summary should
show Header when present.

**Planning note:** prefer an optional extensible value such as
`bodyPart: 'header' | null` over a one-off `isHeader` boolean, even if the first
UI exposes only Header. Existing schema-version-1 shots must remain valid, and
reader support must deploy before the capture control writes the new payload.

**Not this item:** foot / left-right / volley / rebound / build-up (`M5`),
or making header a required field on every goal.

### S16 - Shot and goal placement

**Status:** confirmed — new capture feature  
**Theme:** shot location  
**Where:** `GameEvent.location` is the take/origin pin only; no end or
goal-mouth location exists

Owner request: track where the ball went, not only where it was struck.
Example: shot from the left side that landed on the right. Two UX options
were offered:

1. A second pin on the same pitch (origin plus landing).
2. After a goal, open a second view of the goal mouth and tap placement.

Those capture different things. A second field pin is an on-pitch end
location (wide right, far-post run). A goal-mouth view is where it
entered the net (high left, low right).

**Likely direction:** keep the existing field tap as origin. After Goal,
open an optional goal-mouth sheet (skip allowed) and store a normalized
goal placement. That matches "landed in the right side" for scored balls
without a second map gesture on every shot. A secondary field pin can
wait for Saved / Off target / Blocked if first matches still need
on-pitch end location. Do not infer xG. Do not require placement to save
the shot (`S1`).

**Planning note:** the focused plan must define normalized goal-mouth axes,
whose viewpoint left/right uses, field-flip behavior, edit/remove behavior,
and whether normal goals only or own goals can carry placement. Treat origin
and placement as two named coordinates; never overload `GameEvent.location`.
As with Header, merge reader support before enabling the writer.

**Not this item:** expected-goals models, heatmaps as a separate product,
or treating placement as a second shot event.

### S17 - Make the existing corner event obvious

**Status:** approved plan — see [`PLAN_SOC_RESTARTS.md`](PLAN_SOC_RESTARTS.md)
**Theme:** restarts  
**Where:** Field Quick **Team** → Team Event sheet → Corner / Offside;
Left/Right shortcuts; `soccer.team_event` `kind: 'corner'`

Owner follow-up: if corner is already an event, the gap is probably that
the UI is not clean.

That matches the current path. Corner is not a Field-tab control. It is
hidden behind Quick Team, then a Corner/Offside toggle. Left/Right only
set a corner-arc pin; they are not presented as “this corner, this side.”
Save then drops actors, so even if a taker were chosen, it would not
stick. Timeline/Field just say Team Event / Restart.

**Approved direction:** keep the existing corner event. Replace Quick Team
with a one-shot Restart mode: tap Restart, tap the corner on the main field,
then confirm the kind and optional taker. `GameEvent.location` is the placement
source of truth; do not add a redundant left/right payload. Timeline can say
`Tracked corner - #7` while Field shows which corner was used. Optional taker
is the only corner data add; when omitted, store no actor and label it `Taker
not recorded`. Do not invent a second event type. `S7` can still link the next
shot to that corner.

**Not this item:** shot-source auto-linking (`S7`) or making a taker required.

### S18 - Flipped field keeps cluster counts upright

**Status:** confirmed — display bug  
**Theme:** field review  
**Where:** `SoccerField` applies `rotate-180` to the whole SVG when
`fieldFlipped` is true; `SoccerMarkerCluster` draws the count as SVG
`<text>`

Owner confirmation: two pins on the same spot correctly counted as 2
events. Flip reversed placement correctly. The cluster number was then
upside down.

Tap mapping already remaps through `soccerFieldLocation(..., flipped)`.
The count (and other in-SVG text such as a foul `!`) rotates with the
pitch.

**Likely direction:** keep stored coordinates. Counter-rotate marker
labels/counts when the pitch is flipped, or flip by remapping display
coordinates instead of rotating the entire SVG. Do not change event
locations.

**Not this item:** persisting the flip (`S9`).

### S19 - Team formation lineup on a pitch

**Status:** confirmed idea — later than live-tracker fixes  
**Theme:** team settings / setup  
**Where:** Teams / Team Manage; `SoccerTeamSettings` today is only a sparse
rules override; Player Setup has starter/bench plus `initialRole`, no
pitch

Owner idea: set a soccer lineup on a pitch from the Teams page. Formations
such as 4-3-3, 4-4-2, 3-4-3. Store it as a team setting.

This is not a new event family. SOC-6D already has owner/admin team soccer
settings with compare-and-swap writes. A formation would be a new optional
settings field plus a visual editor: pick a shape, place named roster
players on slots, save for the team.

**Likely direction:** persist `{ formation, slots[] }` on team soccer
settings. Player Setup can prefill starters and default roles (`S11`) from
those slots. Live Role / substitution still override the match. Do not
treat the formation as a live tactical board, and do not write every sub
back to the team default.

**Not this item:** in-match formation changes, opponent formations, or
heatmaps.

### S20 - Throw-ins

**Status:** approved plan — see [`PLAN_SOC_RESTARTS.md`](PLAN_SOC_RESTARTS.md)
**Theme:** restarts  
**Where:** `SoccerTeamEventKind` is only `'corner' | 'offside'`

There is no throw-in event, quick action, or stat. SOC-0 / SOC-4 left
throw-ins, goal kicks, and routine free kicks out of the core catalog on
purpose. Corners are the restart that did ship; they are just hard to
find (`S17`).

Owner asked after first matches whether throw-ins can be tracked.

**Approved direction if promoted:** reuse the one-shot Restart flow from
`S17`: tap the main field, then confirm side, kind, and optional taker. Add
`kind: 'throw_in'` and `kind: 'goal_kick'`; the existing event location is
authoritative. Do not require an event on every restart. Goal kicks are in
scope by owner decision.

**Not this item:** treating every dead ball as a core event.

### S21 - Name the season when creating it

**Status:** confirmed — create-and-edit gap, soccer and basketball  
**Theme:** seasons / teams  
**Where:** Teams Create Team (`src/pages/Teams.tsx`); Season Info
(`src/pages/SeasonInfo.tsx`); Settings → Data → Seasons (`src/pages/Admin.tsx`)

Owner confirmation: when creating a new season there is no option to name
it. Same for soccer and basketball. This is not only a later rename
problem.

The Teams create path is the one sport dashboards open
(`/teams?sport=soccer` or `?sport=basketball`). Choosing **Create new
season...** shows a two-column row: sport picker plus a text input that
defaults to `new Date().getFullYear()` (`Teams.tsx:157`). That input has
no label. The placeholder `Season name (required)` is hidden as soon as
the year is prefilled, so the control reads as a locked year, not a name
field.

After create, Season Info only displays `season.name`. Team rows can be
renamed; the season cannot. Settings → Data → Seasons has a labeled New
Season name field and a pencil edit, but that is not the Teams create
path the owner used.

**Likely direction:** on Teams create, show a labeled Season name field
(empty or clearly editable, not a silent year). Keep sport as its own
control. Add rename on Season Info or keep Settings edit as a second
path. Do not invent a second season identity besides `seasons.name`.

**Not this item:** changing season sport after create, moving a team
between seasons (already rejected), or season standings (`M1`).

## 5. Future modules (`M*`)

Reserved in SOC-0 §8 and SOC-6 §9. First matches may request these; they
are not S-series polish.

| Id | Module | Why it stays later |
|---|---|---|
| M1 | Team standings (W-D-L, points, tiebreakers) | Per-game result is core; season tables were deferred on purpose |
| M2 | Per-90 and per-standard-match rates | First-release aggregates are totals and read-time rates with a real denominator |
| M3 | Season shootout leaderboards | Shootout totals stay match-scoped |
| M4 | Full opponent roster, lineup, and minutes | Simplified opponent is an SOC-0 decision |
| M5 | Detailed goal metadata | Header is pulled forward as `S15`. Remaining: other body parts, delivery, rebound, error, build-up. Goal-mouth / end placement is `S16`, not this row |
| M6 | Technical actions | Dribbles, crosses, dispossessions |
| M7 | Passing | Completion, start/end, type |
| M8 | Advanced defending | Pressures, aerial/ground duels, dribbled past, errors |
| M9 | Possession timer | Dedicated live timer; never inferred from sparse events |
| M10 | Advanced goalkeeping | Claims, punches, distribution, sweeper actions |
| M11 | Discipline eligibility | Accumulation, reset, automatic suspension |
| M12 | Post-game review | Coach ratings, notes, Player of the Match |
| M13 | Collaborative live capture | Shared stream, dedup, multi-writer conflict handling |
| M14 | Application-wide reskin | SOC-6E ships functional polish only |
| M15 | Unresolved-name season merges | Still forbidden; identity remains stable-player only |

`M1` is the first module to promote if season use starts after a handful of
completed matches. It still needs its own plan.

## 6. Recommended planning order

Correctness blockers first, then the confirmed sideline layout gaps, then
setup/correction, then the rest.

```text
S13 Opponent incident cannot attach a tracked player / lock the match
S14 Finalize must succeed or explain the real checkpoint mismatch
S2  Substitution from the Field tab
S3  Keep the pitch on screen
S18 Flipped field keeps cluster counts upright
S12 Edit shots from Timeline
S11 Default player role carried between games
S21 Name the season when creating it
S19 Team formation lineup on a pitch
S1  Faster shot and goal capture
S15 Mark a goal as a header
S16 Optional goal-mouth placement after Goal
S4  Recent-events undo on Field
S8  Lineup as a live board
S5  Reusable opponent identities
S6  Sideline clock correction
S9  Persist field orientation
S10 Defense without a mode switch
S7  Last restart as next shot source
S17 Make the existing corner event obvious
S20 Throw-ins, only if we want them in the same sheet as corners
M1  Team standings, only after completed-match volume exists
```

`S13` and `S14` are first because they leave a match uneditable or
unfinalizable. Owner ranking of the remaining UX is `S2` then `S3`. `S14`
should be re-tested on the same games after `S13` is fixed. `S15` and `S16`
come after `S1` so extra goal metadata stays a skippable step, not another
full attacking sheet. `S18` rides with the Field-tab work. `S17` is UI
for the corner event that already exists, then `S7` can link the next
shot. `S19` waits until default roles (`S11`) exist so a 4-3-3 slot can
carry a player and a role. `M*` items stay behind a new phase name if
promoted.

### 6.1 Evidence state

Use these labels before turning an item into an implementation plan:

| State | Items | Next action |
|---|---|---|
| Code-confirmed defect or constraint | `S2`, `S13`, `S18`, `S21` | Plan the smallest repair with regression coverage |
| Confirmed symptom; reproduce the exact branch | `S12`, `S14` | Capture source/authority and failure details before choosing a fix |
| Confirmed product request with open data/UX choices | `S15`, `S16`, `S19` | Short Q&A, then a focused phase plan |
| Implemented focused follow-up | `S3`, `S11` | Validate during the next live match and iterate from evidence |
| Approved implementation plan | `S17`, `S20` | Deliver the reader-first restart slices in `PLAN_SOC_RESTARTS.md` |
| Proposed follow-up awaiting match evidence | `S1`, `S4`–`S10` | Keep in backlog until confirmed or pulled into a related shell plan |

`S12` must not be implemented as a second editor path: the shared editor route
already exists. `S14` must not weaken finalization authority to make the error
go away. Both begin with evidence.

### 6.2 Recommended work packages

- **Correctness recovery:** `S13`, then reproduce and repair `S14`.
- **Field shell:** `S2` + `S3` + `S18`; reserve a scalable action layout for
  later `S4`, `S6`, and `S10` without implementing those unconfirmed items.
- **Timeline correction:** `S12` as a verify-first focused repair.
- **Roster defaults:** `S11`; `S19` follows only after role storage is stable.
- **Fast attacking capture:** `S1` shell first, then optional `S15` and `S16`
  steps so metadata never blocks the primary save.
- **Restarts:** `S17` + `S20` through `PLAN_SOC_RESTARTS.md`; `S7` follows only
  after restart capture is stable.
- **General season UX:** `S21` is cross-sport and should not ride in a Soccer
  event-model PR.

These packages are planning boundaries, not a requirement to combine every
item into one large PR. Each may still ship in reader/domain/UI slices.

## 7. Out of scope

Do not use this backlog to:

- convert Soccer off the event stream or dual-write `game_stats`
- blend independent recorder streams
- finalize without the SOC-5D / SOC-6A authority path
- enable Soccer by default or hide historical soccer records
- migrate basketball inside a soccer PR (see the BKE roadmap)
- infer possession, ratings, or xG from the current event set
- treat routine free kicks as separate team events; throw-ins and goal kicks
  belong only to the dedicated restart plan

Release evidence still belongs in `docs/REGRESSION_SOC_6E_RELEASE.md`.
Broader Basketball event work continues in
`docs/PLAN_BKE_4E_AGGREGATES_AND_RELEASE_READINESS.md` and is independent.

## 8. Owner match notes

- First live soccer matches are the reason this backlog exists.
- `S2` and `S3` were the biggest sideline challenges.
- Default role should live on the player/roster and carry between games;
  in-game role updates stay allowed (`S11`).
- Shots can be edited from the pitch marker, not from the event tracker
  (`S12`).
- Champlin Rebels 2026 vs tryouts, Second Half 35:55, 2-0, Needs Attention:
  opponent foul attributed to Murdoch Rothermal;
  `Committing actor cannot reference a tracked participant for the opponent`
  (`S13`). Sync toast showed the same truncated message with Retry / Export.
- Same club, ended 3-1, Overview, Local, Cloud Finalization / Primary Mark:
  `Soccer finalization failed: Primary recorder changed; reload before
  finalizing`. Finalize stayed offered. Owner cannot finalize games (`S14`).
- Need to mark when a goal is a header (`S15`).
- Want shot/goal placement: shot from the left that landed on the right.
  Either a second field pin, or a goal-mouth view after a goal (`S16`).
- Track corner kicks by tapping the corner and optionally recording the taker
  (`S17`). The original left/right wording is superseded by tap-to-place. The
  event already exists; the Field UI is not clean (Quick Team ->
  Corner/Offside, no taker, weak Timeline label).
- Two pins on the same spot correctly counted as 2. Flip reversed
  placement correctly, but the cluster number was upside down (`S18`).
- Teams page: set a soccer lineup on a pitch (4-3-3, 4-4-2, 3-4-3), stored
  as a team setting. Just an idea (`S19`).
- Asked whether throw-ins can be tracked. They cannot today (`S20`).
- Creating a new soccer or basketball season has no option to name it.
  Not only later editing (`S21`).
