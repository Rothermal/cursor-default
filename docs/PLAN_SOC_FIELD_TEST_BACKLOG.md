# Soccer Field-Test Backlog

Status: living inventory after live matches. Owner-confirmed items are `S2`,
`S3`, `S6`, `S7`, `S9`, and `S11`–`S26`. This is not an implementation plan.

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
- `S25` and `S26` originate in Soccer field testing but establish cross-sport
  live-capture conventions. Each sport still owns its role vocabulary and any
  controls that serve a second sport-specific purpose.
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
   Restart capture has a completed reader-first plan with R1-R4 implemented in
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
| Tracker | Full-pitch Field tab, Tracked/Opponent side, persisted capture mode, player chips, located Shot/Defense/Foul, quick Goal/Foul/Card plus one-shot Restart, Lineup, Timeline, shootout workspace |
| Clock | Start/pause, period end, overflow clock correction, suspend/abandon/reopen |
| Events | Shots with outcomes and creators, own goals, score adjustments, tackles/interceptions/clearances/recoveries, fouls/cards, corners/offsides/throw-ins/goal kicks, substitutions, roles, late participants |
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

**Status:** implemented; pending deployed field verification

**Theme:** lineup during live play  
**Where:** `SoccerGameTracker` Field tab, `SoccerLiveActionDialog` `substitution`

Substitutions are a core youth-match action. The Field tab has Quick Goal, Foul,
Card, and Team. Substitution lives in the header overflow action sheet with
roles, clock correction, late participant, and rules.

Owner confirmation: first live matches made this the biggest workflow gap.

**Resolution:** the Field tab now has a compact match-action row immediately
below Quick capture. Its primary Substitution control opens the existing
substitution window during active play and period breaks; an icon-only overflow
keeps the remaining match actions reachable without expanding the four-slot
capture row. Optional later: tap a Lineup row to start the same window (`S8`).

**Field-shell note:** the current quick row remains Goal, Foul, Card, and Team;
the restart plan may rename Team rather than free that slot. Future Field
actions should extend the match-action/overflow treatment rather than add a
fifth or sixth capture button.

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
`S2` substitution/action-shell work now adds a primary Field-tab action and
scalable overflow without moving review controls above the pitch. Second-match
evidence supersedes the visible-player part of this layout: `S25` removes that
bar because each event sheet already owns actor selection.

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

**Status:** confirmed product request; focused plan required
**Theme:** clock  
**Where:** `prepareSoccerKickoff`; scoreboard Start/Pause; overflow
`Correct clock`

Start/Pause and End Period are on the scoreboard. Added time, a late pause,
or a one-minute drift requires the overflow dialog. Youth matches do this
often.

Second-match evidence adds two concrete failures. Kickoff currently appends
Opening Lineup, Period Start, and Clock Start atomically, so the clock runs as
soon as setup navigates to the tracker. The exact correction field displays
`MM:SS` but requests `inputMode="numeric"`; common mobile keypads therefore
provide no colon even though the parser expects one.

**Likely direction:** starting the match establishes the opening lineup and
first period with the clock paused at zero. The recorder explicitly presses
Start, matching Basketball. Keep exact correction, but use separate minute and
second controls or another keypad-safe input that does not require typing a
colon. Add a short path for common adjustments only after the exact path is
reliable. Opening-lineup minutes must not accrue before the explicit start.

**Planning note:** changing kickoff affects event order, fresh recorder-stream
creation, participation intervals, finalization tests, and every fixture that
currently assumes `clock_started` is kickoff event three. Existing streams are
historical truth and must not be rewritten.

**Not this item:** inferred possession (`M9`) or automatic referee-clock
sync.

### S7 - Offer the last restart as the next shot source

**Status:** confirmed product request; focused plan required
**Theme:** set-piece linking  
**Where:** `sourceEventId` on attacking events; live Goal/Shot sheets

Fouls already store a restart. Shots already accept an optional
`sourceEventId`. Live Goal/Shot does not make "from that corner / foul /
penalty" the default next step, so first-match set pieces are easy to
record as unrelated open-play shots.

Second-match examples make the desired presentation explicit: foul -> penalty
kick -> goal, and corner -> header -> goal/save/miss should read as one linked
sequence while preserving the actor, location, and detail of each event.

**Likely direction:** after a located corner, penalty foul, or direct free
kick, the next shot sheet defaults situation and source to that restart. The
recorder can clear it. First implement and display the relationship already
representable by `sourceEventId`. During planning, determine whether that link
is sufficient for sequence presentation before introducing a broader capture
group or chain identifier. Header remains optional metadata under `S15`.

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

**Status:** confirmed product request plus field-coordinate diagnostic
**Theme:** settings / parked match / direction
**Where:** `fieldFlipped` in `SoccerGameTracker`; `Switch direction` in the
tracker action sheet; SOC-6D soccer settings

SOC-0 called for a field-orientation preference where useful. The tracker
flip is a display-only `useState` and resets on remount. Standing on the
same sideline every week makes that noticeable.

Second-match evidence also showed that an incorrect initial attacking direction
is hard to discover and correct, and reported pins appearing tied to the
original unflipped view. These are separate concepts:

- display flip changes how the recorder sees and taps the pitch
- attacking direction is match history and changes which goal each side attacks
- stored event coordinates remain canonical and do not rotate after capture

The current field code maps flipped taps back to canonical coordinates and
rotates existing markers with the pitch. The report therefore needs a focused
reproduction, not a speculative coordinate rewrite.

**Likely direction:** persist display flip on the parked match and seed it from
the personal Soccer setting. Make current attacking direction and its existing
checked Switch direction action discoverable near the field. Add explicit
round-trip tests for tracked/opponent capture before and after display flip,
period direction changes, marker review, and edit. Only change coordinate math
if one of those cases fails.

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

**Status:** implemented; pending deployed field verification
**Theme:** correction  
**Where:** tracker Timeline (`SoccerTimeline` → `SoccerLocatedEventEditor`);
Field marker tap (`editFieldEvent` → `SoccerShotCaptureDialog`)

Owner confirmation: located shots can be edited by selecting the marker on
the pitch, but the same correction was not available or did not work from the
event tracker / Timeline during use. The reproduced case was an owned live
Tracker game with one recorder: changing a shot to another player in the
Timeline editor did not persist, while editing the same marker from the pitch
worked.

Code review found that `SoccerTimeline.editEvent` already routes every
`soccer.shot` and `soccer.own_goal` (located or unlocated) through
`SoccerLocatedEventEditor` into `SoccerShotCaptureDialog` edit mode. This is
therefore a confirmed symptom, not yet a proven missing route. Authority can
also matter: an owned local source is editable, while canonical, cloud-primary,
and alternate recordings are intentionally read-only.

**Resolution:** the Timeline wrapper rebuilt its inline correction draft on
every parent render. The live clock redraw therefore reran the shared dialog's
initialization effect and restored the original player selection before Save.
Timeline shot and incident correction drafts are now memoized by event identity,
matching the stable state-backed draft used by pitch-marker editing. A wiring
regression prevents located Timeline editors from returning to inline drafts.
Both shared dialogs also pin edit initialization by event id and revision, so a
future caller cannot reintroduce the reset by rebuilding an equivalent wrapper.

**Not this item:** out-of-order undo (`S4`) or changing revision rules.

### S13 - Opponent foul can attach a tracked player and lock the match

**Status:** implemented — pending deployed recovery verification
**Theme:** opponent attribution  
**Where:** `SoccerIncidentCaptureDialog`;
`validateIncidentActor` in `src/lib/soccer/soc4.ts`

Owner screenshot (Champlin Rebels 2026, Second Half 35:55, 2-0, Needs
Attention): Timeline diagnostic

> Committing actor cannot reference a tracked participant for the opponent.

The newest foul was `Opponent / Murdoch Rothermal / direct free kick` at
revision 2. Cloud sync showed the same truncated message, plus Retry/Export.
Live controls were locked behind Review Timeline Issues.

Cause: the affected foul was revision 2, so the invalid actor/side combination
entered through Timeline correction rather than live append. A correction
could retain tracked-player attribution after changing the event side because
the opponent ActorEditor hid the Player chip without clearing its selection.
The shared edit primitive returned the resulting incomplete rebuild for
recovery, and the Soccer tracker committed it without distinguishing a repair
from a healthy-to-incomplete change. Live append already rejects incomplete
projections before changing state.

**Implemented direction:** incident actor selection is normalized when the
sheet opens, when a historical event changes sides, and again at Save. An
opponent actor can no longer retain tracked-player attribution or a tracked
`participantId`; it becomes an unknown/labeled opponent while team and staff
attribution remain intact. The same rule applies to the optional fouled actor
on the opposite side. The tracker also rejects any correction that would turn
a healthy projection incomplete, while still permitting a correction against
an already-incomplete stream so it can be repaired in place. Edit, remove, and
restore commands surface that refusal through each dialog's local error state;
the tracker repeats the guard as defense in depth.

Opening an affected foul from Timeline **Correct** now preselects a labeled
opponent actor without the stale tracked participant. Saving the correction
revises the existing event through the checked mutation path, allowing the
stream to rebuild instead of creating a second event. Field verification must
repair the reported row and confirm that live controls and cloud sync recover.

**Not this item:** a full opponent roster (`M4` / `S5`).

### S14 - Cannot finalize a completed soccer game

**Status:** implemented — pending deployed field verification
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

**Implemented direction:** finalization now reloads the cloud-primary stream,
reconfirms its exact revisions and fingerprint even when coarse readiness says
the existing checkpoint is current, then reloads readiness before publication.
The second readiness check rejects a changed primary, newly opened conflict,
non-terminal stream, stale checkpoint, or lost manager access. Existing
projection-health and canonical-publication guards remain unchanged.

Field verification should retry one of the previously affected completed games
and one newly completed cloud game. A failure after this repair should capture
the evidence below before changing the RPC.

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

**Status:** implemented; deployed verification pending — see
[`PLAN_SOC_RESTARTS.md`](PLAN_SOC_RESTARTS.md) and
[`REGRESSION_SOC_RESTARTS.md`](REGRESSION_SOC_RESTARTS.md)

**Theme:** restarts  
**Where:** Field Quick **Restart** → main pitch tap → Restart sheet;
`soccer.team_event` `kind: 'corner'`

Owner follow-up: if corner is already an event, the gap is probably that
the UI is not clean.

The original gap was a corner hidden behind Quick Team and Left/Right
shortcuts whose save path dropped actors. The implemented path makes Restart
a visible one-shot field mode. The next canonical pitch tap opens the shared
four-kind sheet, and Save preserves an optional side-safe taker.

**Implemented direction:** keep the existing corner event. Replace Quick Team
with a one-shot Restart mode: tap Restart, tap the corner on the main field,
then confirm the kind and optional taker. `GameEvent.location` is the placement
source of truth; do not add a redundant left/right payload. Timeline can say
`Tracked corner - #7` while Field shows which corner was used. Optional taker
is the only corner data add; when omitted, store no actor and label it `Taker
not recorded`. Do not invent a second event type. `S7` can still link the next
shot to that corner.

**Not this item:** shot-source auto-linking (`S7`) or making a taker required.

### S18 - Flipped field keeps cluster counts upright

**Status:** implemented — pending deployed field verification
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

**Implemented direction:** stored coordinates and the existing pitch rotation
remain unchanged. `SoccerField` passes the display flip to individual markers
and clusters, then counter-rotates value and identity glyphs around each marker
center. Cluster counts, foul `!` glyphs, and the offside X-plus-underline stay
upright. Geometric triangle markers remain pitch-relative and rotate with the
field. Event locations, marker placement, and tap mapping do not change.

**Not this item:** persisting the flip (`S9`).

### S19 - Team formation lineup on a pitch

**Status:** implemented; migration applied, deployed verification pending — see
[`PLAN_SOC_S19_TEAM_FORMATION.md`](PLAN_SOC_S19_TEAM_FORMATION.md)

**Theme:** team settings / setup  
**Where:** Teams / Team Manage; S19A extends `SoccerTeamSettings` with the
versioned formation foundation, S19B adds the roster-backed editor, and S19C
applies the saved default once to editable Player Setup participant drafts.

Owner idea: set a soccer lineup on a pitch from the Teams page. Formations
such as 4-3-3, 4-4-2, 3-4-3. Store it as a team setting.

This is not a new event family. SOC-6D already has owner/admin team soccer
settings with compare-and-swap writes. S19A adds the optional versioned
settings field and fixed catalog. S19B adds the visual editor for choosing a
shape and placing named roster players on slots.

**Approved direction:** store one versioned template plus stable player-to-slot
assignments in revisioned team Soccer settings. Fixed 11v11, 9v9, and 7v7
templates provide tactical labels, broad roles, and editor-only coordinates.
Owners/admins edit through a visual pitch plus accessible slot list;
scorers/viewers review. Player Setup applies a matching formation once as
editable starter/role prefill and stores only the resulting existing match
participants. Live Role and Substitution events remain authoritative and
never write back to the team default.

**Not this item:** in-match formation changes, opponent formations, or
heatmaps. Team-level starter/bench defaults are `S23`; an in-match batch
formation change is `S24`.

### S20 - Throw-ins

**Status:** implemented; deployed verification pending — see
[`PLAN_SOC_RESTARTS.md`](PLAN_SOC_RESTARTS.md) and
[`REGRESSION_SOC_RESTARTS.md`](REGRESSION_SOC_RESTARTS.md)

**Theme:** restarts  
**Where:** `SoccerTeamEventKind` and the shared live/historical sheet expose
`'corner' | 'offside' | 'throw_in' | 'goal_kick'`.

SOC-0 / SOC-4 originally left throw-ins, goal kicks, and routine free kicks out
of the core catalog. R1-R4 now add optional Throw-in and Goal-kick capture to
the shared restart event while routine free kicks remain foul metadata.

Owner asked after first matches whether throw-ins can be tracked.

**Implemented direction:** reuse the one-shot Restart flow from
`S17`: tap the main field, then confirm side, kind, and optional taker. Add
`kind: 'throw_in'` and `kind: 'goal_kick'`; the existing event location is
authoritative. Do not require an event on every restart. Goal kicks are in
scope by owner decision.

**Not this item:** treating every dead ball as a core event.

### S21 - Name the season when creating it

**Status:** implemented; pending deployed verification

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

**Resolution:** Teams creation now shows separate labeled Sport and Season
name controls. The name starts empty with an example placeholder instead of
silently presenting the current year as the value. Season Info now offers an
owner-only inline rename that updates the same `seasons.name`; accepted team
members retain read-only season access. Settings → Data remains the broader
season-management path.

**Compatibility note:** legacy aggregate first-time sync still resolves an
unbound game by same-name cloud team first, then by a year-named season from
the game date. If neither exists, it creates that year-named season. Custom
season names and later renames do not change this fallback, so an unmatched
local team can still produce a separate `2027` season; Settings → Data remains
the reconciliation path. Changing that sync authority is outside `S21`.

**Not this item:** changing season sport after create, moving a team
between seasons (already rejected), or season standings (`M1`).

### S22 - Roster edits cannot invalidate game participant history

**Status:** confirmed correctness defect; highest-priority new item
**Theme:** roster identity / cloud recovery
**Where:** private event-platform v4 binding; Soccer cloud sync; Teams and
Settings/Advanced permanent player deletion

A locally intact Soccer game failed cloud binding after its source-team roster
changed:

```text
Soccer game binding failed: Participant source player is not on the source team
```

The sanitized recovery export still contained 24 participant snapshots, 84
events, and 14 referenced participants. The game-scoped history survived; a
current-roster membership check prevented it from syncing. The normal Teams
**Remove** action marks `team_players.is_active = false`, and the current binder
accepts inactive rows.

The destructive path is confirmed. Teams `handleDeletePlayer` and
Settings/Advanced `handleAdminDeletePlayer` hard-delete the shared `players`
row. The `team_players.player_id` foreign key uses `ON DELETE CASCADE`, so every
membership for that identity disappears. Neither player-delete handler checks
active or parked unsynced games. By contrast, the neighboring team/game delete
handlers already block destructive deletion when matching unsynced local work
exists. The focused plan starts from this known asymmetry; it does not need to
rediscover the reported mutation path.

**Required direction:** a source roster is setup input, not mutable authority
over an opened match. Preserve immutable participant display/number/identity
snapshots and all event references when a roster member is deactivated. Warn
before destructive identity changes and prefer archive/deactivate. Existing
cloud-bound participant mappings may be reused only when their game identity
matches exactly; new or remapped participants must still pass team access and
identity validation.

For an unbound local game whose source membership is already missing, recovery
must identify the affected participant without discarding events and offer
deliberate manager choices such as restoring the roster membership or resolving
the source identity. A retry must preserve the event count, score, participant
ids, and finalization state. Do not silently trust arbitrary client-supplied
`source_player_id` values.

**Acceptance seed:** cover Teams and Settings/Advanced permanent deletion plus
ordinary roster deactivation after opening lineup, minutes, substitution, and
stat events; first bind versus already-bound sync; active and completed games;
recovery export/import; and a successful retry with no duplicate participants
or events.

### S23 - Team-level default starter and bench status

**Status:** confirmed product request; Q&A and focused plan required
**Theme:** roster defaults / setup speed
**Where:** Soccer team settings, Team Manage roster, Soccer Player Setup

Default role (`S11`) and formation assignments (`S19`) reduce setup work, but a
team cannot independently remember who normally starts and who begins on the
bench. Backup goalkeepers are a common bench default. The status belongs to a
player's membership on one team, not to the global player identity.

**Likely direction:** add versioned per-team lineup-status defaults and apply
them only when creating an editable match setup draft. A saved formation may
provide the starter set when explicitly applied; the focused plan must define
which setting wins when formation assignments and standalone defaults differ.
Every match remains editable, and its immutable setup snapshot remains
authoritative after kickoff.

**Not this item:** changing a live lineup or writing match substitutions back
to team defaults.

### S24 - Apply a saved formation during a match

**Status:** confirmed product request; Q&A and focused plan required
**Theme:** live lineup / batch transition
**Where:** tracker Lineup tab; S19 team formation catalog and assignments

Coaches may change shape during a match or replace several players after an
injury or tactical change. Editing each substitution and role separately is
too slow. `S19` deliberately stopped at setup-only defaults, so this is a new
live-authority feature rather than unfinished S19 work.

**Likely direction:** while the clock is paused, choose a saved formation,
preview outgoing players, incoming players, and role changes, then confirm one
checked atomic transition. Reuse current participant ids and existing
substitution/role semantics so minutes, substitution windows, goalkeeper
requirements, ejections, return-sub rules, and correction history remain
valid. Applying a formation never edits the team default.

**Not this item:** opponent formations, automatic tactical inference, or a
live drag-and-drop position tracker.

### S25 - Cross-sport event-owned actor selection and role ordering

**Status:** Soccer slice implemented; cross-sport inventory remains
**Theme:** live-surface density / actor selection
**Where:** above-pitch or above-court player defaults; event actor pickers

The horizontal player bar above the Soccer pitch consumes scarce mobile height
and only provides a sticky default for the player dropdowns that already appear
in each event sheet. A hidden sticky default would be worse than no bar, so the
preference must stop influencing new live captures when the bar is removed.

**Approved cross-sport direction:** when a live event sheet already owns an
actor picker, do not reserve permanent pitch/court space for a sticky actor
default. Each capture sheet chooses a clear local default; changing a dropdown
affects only that draft. Keep Team / Unknown / Staff choices wherever the event
family supports them. A sport-specific selector may remain when it has another
visible job, such as filtering a Basketball chart or selecting the stat-grid
context, but that state must not silently preselect an event actor.

For Soccer, remove the above-pitch player selector and tolerate legacy
serialized `selectedParticipantId` preferences for compatibility without using
them to preselect future live events.

**Implemented Soccer direction:** the player bar and its initialization/update
effects are removed. Tracker, Timeline, field review, and located-event editing
no longer pass a sticky participant through the capture stack. The version-1
preference fields remain parseable for parked/imported compatibility but have
no live actor-selection authority. `sortSoccerActorParticipants` owns copied,
deterministic role/jersey/name/id ordering; shot and incident sheets use current
roles in live capture and historical roles at the edited event moment. See
[`REGRESSION_SOC_S25_ACTOR_SELECTION.md`](REGRESSION_SOC_S25_ACTOR_SELECTION.md).

Tracked-player options in Soccer event capture and edit sheets sort by the
role at that event moment:

```text
Forward -> Midfielder -> Defender -> Goalkeeper -> Custom
```

Within a role, use numeric-aware jersey number, then display name, then stable
participant id. Copy arrays before sorting, preserve historical role lookup in
edit mode, and keep lineup/substitution selectors task-specific. Every sport
should define an explicit actor-picker role order when roles exist. The shared
contract accepts a sport-owned rank/comparator; it does not create one
universal cross-sport role enum because positions and workflow priorities
differ by sport.

**Acceptance seed:** no player bar or empty gap above the pitch; a player can
still be selected for every attributed Soccer event; closing/reopening a sheet
does not inherit a prior event's actor; live and historical options use the
appropriate current/historical role; keyboard labels remain unambiguous.

### S26 - Show team nicknames in cross-sport side selectors

**Status:** confirmed product request; cross-sport naming plan required
**Theme:** live labels / team identity
**Where:** Tracked/Opponent controls above sport surfaces; game setup snapshots;
team and opponent naming

`tracked` and `opponent` are correct internal side identifiers, but they are
poor live button labels. The controls should show the teams' short display
names so the recorder does not translate domain terminology during play.

Tracked cloud teams already support editable `teams.nickname` and the shared
`teamDisplayName` fallback. That value is not currently carried into Soccer or
Basketball match setup: both use the selected team's primary `name`. Opponents
have only the game-level `opponentName`, with no separate full-name and short
display-name fields. This therefore cannot be solved reliably by relabeling one
Soccer segmented control.

**Likely direction:** define one cross-sport side-label resolver while keeping
the stored side ids unchanged. Match setup freezes optional tracked and
opponent display labels with the match; live side selectors show the short
label when present and fall back to the frozen team/opponent name. Existing
games without the new fields continue to use their current names.

For an existing tracked team, seed the label from `teams.nickname`. Personal or
local tracked teams and every opponent need an optional short-name field during
setup. The opponent nickname is initially match-scoped; a reusable opponent
directory is separate future work. Summaries and archival identity retain the
full names, while compact live controls may use the short labels.

**Planning note:** inventory every cross-sport `Tracked` / `Opponent` capture
control and every immutable setup, parking, import/export, cloud binding, and
summary reader before choosing field names. Do not derive a historical nickname
from the current mutable team row at review time.

**Acceptance seed:** Basketball and Soccer side selectors show configured short
labels with truncation; local/personal and cloud-team setup can set or inherit a
label; opponents can receive a match nickname; old games fall back cleanly;
changing a team nickname later does not rewrite an opened or completed match.

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
S22 Roster edits cannot invalidate game participant history
S13 Opponent incident cannot attach a tracked player / lock the match
S14 Finalize must succeed or explain the real checkpoint mismatch
S2  Substitution from the Field tab
S3  Keep the pitch on screen
S18 Flipped field keeps cluster counts upright
S25 Cross-sport event-owned actor selection and role ordering
S26 Show team nicknames in cross-sport side selectors
S12 Edit shots from Timeline
S11 Default player role carried between games
S21 Name the season when creating it
S19 Team formation lineup on a pitch
S23 Team-level default starter and bench status
S24 Apply a saved formation during a match
S6  Explicit clock start and usable sideline correction
S9  Persist and clarify field orientation
S1  Faster shot and goal capture
S15 Mark a goal as a header
S16 Optional goal-mouth placement after Goal
S4  Recent-events undo on Field
S8  Lineup as a live board
S5  Reusable opponent identities
S10 Defense without a mode switch
S17 Make the existing corner event obvious [implemented]
S20 Throw-ins and goal kicks [implemented]
S7  Link the last restart to the next shot sequence
M1  Team standings, only after completed-match volume exists
```

`S22` is first because it can strand an otherwise intact match before first
cloud binding. `S13` and `S14` follow because they leave a match uneditable or
unfinalizable. Owner ranking of the earlier UX was `S2` then `S3`; `S25` is the
small follow-up that removes the now-redundant Soccer player row and establishes
the shared actor-picker contract. `S26` is nearby in UX but separately touches
immutable setup and naming across sports. `S15` and `S16` come after `S1` so
extra goal metadata stays a skippable step, not another full attacking sheet.
`S17` / `S20` have finished restart capture; validate them before `S7` links
the next shot. `S23`
extends setup defaults; `S24` remains a separate live atomic-transition plan.
`M*` items stay behind a new phase name if promoted.

### 6.1 Evidence state

Use these labels before turning an item into an implementation plan:

| State | Items | Next action |
|---|---|---|
| Confirmed correctness defect | `S22` | Plan player-delete guards, durable historical binding, and recovery for already-affected games |
| Confirmed product request with open data/UX choices | `S6`, `S7`, `S9`, `S15`, `S16`, `S23`, `S24` | Short Q&A where choices remain, then a focused phase plan |
| Soccer slice implemented; cross-sport direction remains | `S25` | Verify deployed Soccer capture, then inventory each later sport without removing selectors that have another visible job |
| Confirmed cross-sport naming request | `S26` | Inventory setup/name authority, then plan additive match display labels |
| Implemented; pending deployed field verification | `S2`, `S3`, `S11`–`S14`, `S17`–`S21` | Run the linked regression rows during the next live or deployed test |
| Proposed follow-up awaiting match evidence | `S1`, `S4`, `S5`, `S8`, `S10` | Keep in backlog until confirmed or pulled into a related shell plan |

The `S12` repair preserves the shared editor route, and the `S14` repair keeps
finalization authority intact. Their deployed verification must continue to
exercise those constraints rather than bypass them.

### 6.2 Recommended work packages

- **Correctness recovery:** `S13` and `S14` are implemented; deployed recovery
  verification remains. `S22` is the next correctness plan and must preserve
  server-side identity/access validation while making game snapshots durable.
- **Field shell:** `S2` + `S3` + `S18` are implemented with room for later
  `S4`, `S6`, and `S10`. The Soccer slice of `S25` removes the redundant player
  row and role-orders event actor lists; deployed verification remains. The
  cross-sport inventory does not need to block this smaller improvement.
- **Cross-sport live labels:** `S26` shares display resolution across sports but
  needs additive immutable match labels before compact controls stop saying
  Tracked/Opponent. Keep it separate from `S25` actor selection.
- **Clock and orientation:** plan `S6` and `S9` independently. Clock changes
  event lifecycle and minutes; orientation changes display persistence,
  direction discoverability, and coordinate regression coverage.
- **Timeline correction:** `S12` is implemented; deployed live correction
  verification remains.
- **Roster defaults:** `S11` is implemented; `S19A` provides the formation
  catalog and versioned team-settings foundation, `S19B` provides the Team
  Manage editor, and `S19C` applies matching defaults once to editable setup
  drafts. Migration 065 is applied; verify current team-setting round trips and
  setup prefill in the deployed app. `S23` adds standalone starter/bench
  defaults; `S24` is a later live batch transition and should not be folded
  into the team-settings schema slice.
- **Fast attacking capture:** `S1` shell first, then optional `S15` and `S16`
  steps so metadata never blocks the primary save.
- **Restarts:** `S17` + `S20` are implemented through
  `PLAN_SOC_RESTARTS.md`; run `REGRESSION_SOC_RESTARTS.md` during deployed
  testing. `S7` follows only after restart capture is stable.
- **General season UX:** `S21` is implemented as a cross-sport Teams / Season
  Info workflow, independent of the Soccer event model.

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
  (`S17`). The original left/right wording is superseded by the implemented
  one-shot tap-to-place Restart flow; deployed verification remains.
- Two pins on the same spot correctly counted as 2. Flip reversed
  placement correctly, but the cluster number was upside down (`S18`).
- Teams page: set a soccer lineup on a pitch (4-3-3, 4-4-2, 3-4-3), stored
  as a team setting. Product decisions and a three-slice plan are approved
  (`S19`).
- Asked whether throw-ins can be tracked. They now share the optional
  tap-to-place Restart flow with Corner and Goal kick (`S20`); deployed
  verification remains.
- Creating a new soccer or basketball season has no option to name it.
  Not only later editing (`S21`).
- Second-match recovery export showed an intact game-scoped participant and
  event history, but cloud binding failed after the source roster changed with
  `Participant source player is not on the source team`. Evidence is retained
  here only as sanitized counts; player names and ids from the export are not
  planning data (`S22`).
- Match setup should open the tracker with the first period established and
  the clock paused. The recorder starts it explicitly. Clock correction also
  needs a mobile input that can actually enter minutes and seconds (`S6`).
- Display flip, attacking direction, and canonical event coordinates need
  clearer controls and a focused round-trip regression. Do not rewrite stored
  pins based only on the reported visual symptom (`S9`).
- Fouls/corners and their resulting penalty/free kick/header/shot outcome
  should present as a linked sequence. Use the existing restart-to-shot link
  before deciding that a broader chain schema is required (`S7`, `S15`).
- Clean offside capture is part of the implemented one-shot Restart flow; it is
  not a new event family (`S17`, `PLAN_SOC_RESTARTS.md` R1-R4).
- Team setup should remember normal starter/bench status, including backup
  goalkeepers, and a saved formation should later be applicable as a reviewed
  in-match batch change (`S23`, `S24`).
- Remove the sticky player-selector bar above the pitch. Each event sheet owns
  its actor, with Soccer player options ordered Forward, Midfielder, Defender,
  Goalkeeper, then Custom. Apply the event-owned actor rule to every sport,
  while preserving controls with an independent filtering or stat-context job.
  The Soccer slice is implemented; other sports define their own role order
  when their live UI is reviewed (`S25`).
- Keep `tracked` and `opponent` as internal values, but display team nicknames
  on live side selectors in every sport. Tracked cloud teams already have a
  nickname; setup needs to freeze it, and opponents need an optional
  match-scoped nickname with full-name fallback (`S26`).
