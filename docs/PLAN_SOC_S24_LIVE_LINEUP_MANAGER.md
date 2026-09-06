# SOC-S24 - Live lineup manager and match presets

**Status:** S24A implemented; S24B-S24D approved and pending
**Scope:** Soccer match setup authority, live tracked-team lineup changes,
Timeline correction, and a reusable cross-sport interaction pattern
**Depends on:** Soccer event authority, anchored clock, S11 roster roles, S19
team formations, S23 lineup defaults, and migration 068

## 1. Goal

Make single and batch lineup changes fast enough for live use. The primary
field case is restoring the normal starters at halftime after several players
received a break near the end of the first half. The same surface must also
handle an ordinary one-for-one substitution, several simultaneous changes,
and tactical role changes without pairing rows manually.

S24 replaces the current repeated Player out / Player in form with a target-
lineup editor. The recorder edits the desired final on-field group, reviews one
derived transition, and confirms one atomic event.

## 2. Approved decisions

1. Offer both **Opening Lineup** and **Team Default** presets.
2. Opening Lineup comes from the immutable opening-lineup event and is always
   the primary reliable reset for an opened match.
3. Resolve and freeze Team Default into the match before kickoff. Later team-
   settings edits never change an active or historical match.
4. Existing matches without a frozen Team Default offer Opening Lineup only.
5. Replace paired substitution rows with one target-lineup editor.
6. Show On Field and Bench side by side, including on narrow phones.
7. A player row shows jersey number, truncated name, and compact Soccer role.
8. Tapping a player moves that player between columns in the uncommitted
   draft. Nothing records until **Apply Lineup**.
9. Presets restore both their player set and their saved roles.
10. An unavailable or ineligible preset player creates a visible unresolved
    vacancy. The app never guesses a replacement.
11. The editor is available only while the clock is paused or during a period
    break. Opening and canceling it never mutate match history.
12. Replace the current Substitution dialog. Field and Lineup tabs both open
    the same **Manage Lineup** surface.
13. Route per-player Role actions into the same manager with that participant
    focused. Remove duplicate Substitutions and Roles entries from More once
    direct access is present.
14. Applying fewer than the configured on-field maximum requires explicit
    short-handed confirmation. Eligibility, goalkeeper, maximum, return-sub,
    substitution-total, and substitution-window failures remain hard blocks.
15. A change at the deterministic halftime break is classified as halftime
    automatically. For an even regulation-segment count, halftime is the break
    after exactly half of those segments; two halves and four quarters therefore
    resolve correctly. Odd segment counts have no inferred halftime, and extra-
    time breaks are never halftime. A halftime change does not consume a
    substitution window, but incoming players still count against any configured
    total-substitution limit.
16. One Apply action appears as one grouped **Lineup change** Timeline entry
    and is edited, removed, or restored as one unit.
17. Implement Soccer first. Document the target-lineup interaction contract
    for later sports, but do not force different sport rule engines through a
    shared lineup component now.

## 3. Experience

### 3.1 Entry points

- Rename the direct Field action from **Substitution** to **Manage Lineup**.
- Add a prominent **Manage Lineup** command to the Lineup tab.
- Keep the command visible but disabled with **Pause clock to manage lineup**
  when the anchored clock is running.
- A participant Role action opens the same manager and focuses that row's role
  control; it is not a second editing workflow.
- Remove the duplicate More-menu Substitutions and Roles actions after both
  direct routes are wired.

The manager is local editable authority only. Final cloud games, read-only
recordings, unhealthy streams, shootouts, and unauthorized contexts retain
their existing non-editable behavior.

### 3.2 Full-screen target editor

Use a nearly full-viewport mobile sheet instead of the current compact dialog:

```text
Manage Lineup

[ Opening Lineup ] [ Team Default ] [ Reset ]

ON FIELD 7/7                 BENCH 5
#1 Morgan   GK       ->      <- #12 Riley  GK
#4 Jordan   DEF      ->      <- #8  Casey   MID
#6 Taylor   MID      ->      <- #11 Avery  FWD

3 entering | 3 leaving | 1 role change
Subs 6/- | Windows 2/- | Halftime

[ Cancel ]                         [ Apply Lineup ]
```

Both columns remain visible at supported mobile widths. Use stable column
dimensions, compact `GK` / `DEF` / `MID` / `FWD` / `CUSTOM` role labels,
numeric-aware jersey ordering, accessible full-name labels, and truncation
that never changes row height. Rows are buttons; role controls are separately
focusable and must not also trigger a move.

Taps update only editor state. **Reset** restores the actual current projected
lineup. Selecting a preset replaces the whole draft target rather than
supplementing it. Display the selected source and all differences immediately.

### 3.3 Preset preview and unavailable players

Opening Lineup contains the kickoff participant ids and roles. Team Default
contains the formation-first result frozen for this match:

- a valid applicable formation owns the complete default on-field set and its
  slot-derived roles;
- otherwise S23 starter ids intersect the selected match participants and use
  their roster-derived initial roles; and
- stale, absent, deselected, or unavailable team players are never fabricated.

If a preset participant cannot currently enter because the participant is not
in this match, was ejected, or return substitutions are disabled, show that
preset entry as unavailable and leave one target vacancy. Do not silently keep
a displaced current player or select another bench player. The recorder must
fill the vacancy or explicitly confirm an otherwise-valid short-handed target.

### 3.4 Review and confirmation

Derive and show:

- entering and leaving participants;
- role changes for incoming players and on-field survivors;
- resulting on-field and goalkeeper counts;
- substitution total and window effects;
- preset source or Manual;
- unavailable preset entries; and
- whether short-handed confirmation is required.

Applying a full valid target uses one confirmation. A valid target below
`maxOnFieldPlayers` opens a second confirmation that names the resulting
count. Never combine short-handed confirmation with a hard validation error.

## 4. Authority and data contracts

### 4.1 Versioned frozen Team Default

Introduce Soccer match setup version 2 rather than adding an unversioned
optional key to setup version 1:

```ts
interface SoccerMatchLineupPresetV1 {
  version: 1
  source: 'formation' | 'lineup_defaults'
  entries: SoccerLineupEntry[]
}

interface SoccerMatchSetupV2 {
  version: 2
  // existing version-1 fields
  teamDefaultLineup: SoccerMatchLineupPresetV1 | null
}
```

`entries` use stable match `participantId`, not team player ids. They contain
only the resolved target starters and broad/custom roles needed to restore the
lineup. Do not persist the full team settings record, formation template,
formation slots, stale team ids, cache metadata, or settings revision.

The one-time S23 Player Setup decision must produce both its editable draft
and, when team settings resolved coherently, an independent frozen preset.
Later recorder edits change the opening lineup but not Team Default. Removing
a participant from the match removes that participant from the persisted
preset before kickoff and surfaces the reduced preset during final setup
review. Local/personal games store `teamDefaultLineup: null`.

Existing setup version 1 normalizes in memory with `teamDefaultLineup: null`
without rewriting raw cloud history. Increment `SOCCER_GAME_STATE_VERSION`
and explicitly continue accepting every previously supported Soccer state
version; do not accidentally drop state version 2 while adding the new one.

The setup snapshot remains immutable after first cloud binding and remains in
the game fingerprint, parking, export/import, finalization, and recovery paths.

### 4.2 Cloud setup compatibility

The shared event binder currently accepts only setup snapshot version 1 even
though reviewed anchored Basketball setup emits version 2 and migration 064
requires Basketball setup version 2 for anchored finalization. Migration 069
must reconcile that existing first-bind mismatch while widening the same
private/revoked binding core to accept these explicit sport/version pairs:

- Soccer setup versions 1 and 2; and
- Basketball setup versions 1 and 2.

Every other sport/version pair fails closed. Basketball version-2 acceptance is
a compatibility repair for its already-shipped setup/finalization contract; it
does not change Basketball release stage, creation policy, capabilities, or any
client surface.

Keep every public Soccer and Basketball wrapper fixed to its sport. Do not
grant the generic binder, loosen immutable snapshot equality, or reinterpret
old snapshots. Add an exact Soccer capability response for setup version 2 so
the new client can fail before mutating local/cloud binding state when migration
069 is absent. Preserve existing-game access and version-1 sync regardless of
new-game capability.

Migration 069 deploys before the Soccer setup-v2 client. Its own focused SQL
contract test must read migration 069 and pin the sport-specific v1/v2 allow-
lists plus rejection of unsupported pairs. `migration052.test.ts` continues to
describe immutable migration 052 and its historical v1-only definition; do not
rewrite the old migration or pretend that test validates the new live
replacement. The migration and client tests must also prove Soccer version-1
binding, Basketball version-1/version-2 first binding, late audit upload,
deleted-source recovery through v5, and setup immutability remain intact.

### 4.3 One target-lineup event

Add a version-1 `soccer.lineup_transition` event instead of appending adjacent
substitution and role-change events:

```ts
interface SoccerLineupTransitionPayload extends JsonObject {
  source: 'manual' | 'opening_lineup' | 'team_default'
  onField: SoccerLineupEntry[]
  halftime: boolean
}
```

The payload stores the complete desired final on-field group. Replay compares
that target with the immediately preceding projection and derives outgoing,
incoming, retained, and role-changed participants deterministically. This
makes one user confirmation one event, one revision, and one correction unit.

Do not rewrite or migrate historical `soccer.substitution_window` and
`soccer.role_changed` events. Extract shared projection helpers so old events
and the new transition enforce the same status, interval, count, return,
goalkeeper, and substitution-limit rules without duplicating semantics.

For a transition with membership changes:

- each newly on-field participant increments the substitution total;
- one non-halftime transition increments the substitution-window total;
- deterministic halftime consumes no window;
- outgoing-only transitions still consume a non-halftime window, matching the
  existing substitution-window behavior; and
- role-only transitions change no substitution counters.

All outgoing intervals close and all incoming/surviving role intervals update
at the one canonical event time. Validate the final lineup as a whole; do not
reject a valid swap because an intermediate mutation temporarily has too many
players or no goalkeeper.

### 4.4 Checked command

Create one pure target-lineup draft/preview module and one checked live command.
The command must:

- require a healthy Soccer event stream and editable tracked-team authority;
- require `in_progress` with a stopped clock or `period_break`;
- reject a target outside the current participant set;
- reject duplicate participant ids and malformed roles;
- reject ineligible entrants and disabled return substitutions;
- enforce maximum players and exactly one on-field goalkeeper;
- use a corrected `isSoccerHalftimeBreak` that returns true only during a period
  break after exactly half of an even, at-least-two regulation-segment list;
  require the completed regulation ids to be that ordered first half, return
  false for odd segment counts and every extra-time break, and never expose a
  recorder checkbox;
- enforce total substitutions and windows before append;
- reject a no-op target; and
- append one event only after full projection succeeds.

UI preview is advisory. Apply recomputes from the latest state so a stale open
sheet cannot overwrite a newer event, clock transition, correction, or cloud
adoption.

### 4.5 Timeline correction

Timeline and Summary classify the event in the existing Lineup family and show
one **Lineup change** row with source, entering/leaving counts, role-change
count, time, and halftime context.

Edit reconstructs the projection immediately before the selected event and
opens the same target editor in historical mode. Save re-derives `halftime`
from that candidate pre-event projection and revises the one complete target
payload; the persisted flag is never copied blindly or made editable. The new
event projector independently derives the same value during replay and rejects
a payload whose flag does not match, so imports, cloud rows, and corrections
cannot retain a stale window exemption. Remove and restore target only that
event. Every mutation must rebuild the full later stream and fail if dependent
history becomes invalid. Successful correction clears any quick-undo receipt
under the existing Soccer correction rules.

Old substitution/role rows keep their current editor and independent history.
S24 does not retroactively infer that adjacent old rows were one action or
reinterpret a legacy substitution event's recorded halftime flag.

## 5. Implementation slices

```text
[x] S24A  Frozen preset and compatibility foundation
      Setup v2 + old-state normalization, formation-first preset derivation,
      migration 069, exact capability/preflight, cloud/parking/recovery tests

[ ] S24B  Target transition domain
      Pure draft/diff/preview helpers, one lineup_transition event, atomic
      projection, limits/halftime/interval semantics, correction primitives

[ ] S24C  Live Manage Lineup experience
      Full-screen two-column editor, direct movement, role controls, presets,
      stale revalidation, short-handed confirmation, Field/Lineup entry points

[ ] S24D  Timeline, regression, and portability notes
      Grouped live/Summary presentation, historical edit/remove/restore,
      narrow/keyboard/PWA checks, deployed cloud matrix, cross-sport contract
```

Each slice uses its own feature branch and PR. S24B may be developed after the
S24A TypeScript contracts are fixed, but setup-v2 cloud creation must not ship
before migration 069 and the capability parser are deployed. S24C does not
ship before the one-event transition projector is authoritative.

S24A now writes exact Soccer setup version 2, freezes a clone-safe Team Default
from the one-time formation-first prefill, removes deselected participants from
that preset, and normalizes setup version 1 plus Soccer state versions 1/2 into
the current in-memory shape. Migration 069 and release contract version 2 must
be deployed before the setup-v2 client reaches cloud-team creation. See
`REGRESSION_SOC_S24A_FROZEN_PRESET.md`.

## 6. File map

### S24A

- `src/lib/soccer/types.ts`
- `src/lib/soccer/state.ts` and state/normalization tests
- `src/lib/soccer/teamLineupPrefill.ts`
- `src/pages/SoccerPlayerSetup.tsx`
- `src/lib/soccer/cloudSync.ts` and transport/adoption tests
- `src/lib/soccer/releaseCapabilities.ts`
- migration 069 plus SQL contract tests
- parking, fingerprint, import/export, and recovery fixtures

### S24B

- new focused target-lineup module under `src/lib/soccer/`
- `src/lib/soccer/events.ts`
- `src/lib/soccer/projector.ts`
- `src/lib/soccer/live.ts`
- event, projection, interval, limit, and correction tests

### S24C

- replace `SubstitutionForm` in
  `src/components/soccer/SoccerLiveActionDialog.tsx`
- new focused `SoccerLineupManager` component and UI-state tests
- `src/pages/SoccerGameTracker.tsx`
- shared confirmation and focus utilities where already established

### S24D

- `src/components/soccer/SoccerTimeline.tsx`
- `src/lib/soccer/summaryTimeline.ts`
- live and Summary Timeline tests
- focused S24 regression documents and shared regression index
- README, backlog, overview, and agent operational notes

## 7. Automated coverage

### Setup and cloud

- setup v1 reads as no Team Default and remains cloud-compatible;
- setup v2 exact parsing rejects unknown keys, duplicate ids, invalid roles,
  oversized entries, and participants outside the match setup;
- current Soccer state accepts legacy versions 1/2 plus the new version;
- formation-first derivation matches S23C without sharing mutable references;
- recorder edits affect Opening Lineup but not the frozen Team Default;
- deselected participants cannot survive in the frozen preset;
- local/personal and unresolved settings produce no Team Default;
- setup fingerprint, bind, pull, adoption, conflict, recovery export/import,
  finalization, and reopen preserve the exact preset;
- migration 069's own test accepts only Soccer v1/v2 and Basketball v1/v2,
  rejects every unsupported pair, and leaves migration 052's historical test
  unchanged;
- missing capability blocks setup-v2 cloud creation before local mutation.

### Transition domain

- single swap, batch swap, outgoing-only, incoming-only, and role-only targets;
- preset and manual sources project identically apart from metadata;
- atomic swaps validate only the final lineup;
- duplicate, unknown, exited, ejected, and no-return entrants fail;
- max-player, goalkeeper, substitution-total, and window limits fail closed;
- two-half and four-quarter matches identify only their actual midpoint break
  as halftime; odd regulation counts and extra-time breaks never do;
- new-event replay rejects a persisted halftime flag that differs from the
  value derived from the pre-event projection;
- historical correction re-derives halftime instead of retaining the old flag;
- halftime changes skip one window but count entrants;
- non-halftime membership changes count one window regardless of batch size;
- role-only transition counts no substitution or window;
- intervals and minutes close/open once at the canonical event time;
- stale preview revalidation catches changed clock/lineup state; and
- no-op targets append nothing.

### UI and correction

- both columns remain mounted and usable at supported mobile widths;
- row and role controls have separate keyboard behavior and accessible names;
- Opening Lineup and Team Default replace the entire draft;
- unavailable preset entries remain visible and no replacement is inferred;
- Reset restores the latest projected lineup;
- running clock, unhealthy stream, final game, and read-only source disable edit;
- short-handed apply requires explicit second confirmation;
- Field, Lineup, and focused Role entry points use one manager;
- one Apply creates one Timeline row;
- edit/remove/restore operate on one event and validate all later history; and
- old substitution and role events retain current presentation/correction.

## 8. Manual regression

1. Start a cloud-team match whose team formation and standalone lineup defaults
   disagree; confirm the frozen Team Default uses formation-first precedence.
2. Manually change the kickoff lineup, begin the match, and confirm Opening
   Lineup and Team Default remain distinct presets.
3. Make several first-half substitutions in a two-half match, end the half,
   choose Opening Lineup, review the complete changes, apply, and confirm no
   window is consumed.
4. Repeat with Team Default and confirm players and roles both restore.
5. Change the team formation/defaults from another session after kickoff and
   confirm the active match's Team Default does not change.
6. Disable connectivity after opening the match and confirm both frozen presets
   remain available.
7. Eject a preset player, select that preset, and confirm a named unavailable
   entry and vacancy appear without an automatic replacement.
8. Fill that vacancy manually and apply; then repeat short-handed and confirm
   the extra warning.
9. With return substitutions disabled, try restoring a previously exited
   player and confirm Apply is blocked.
10. Run limited-substitution and limited-window matches at, below, and beyond
    each boundary, including multi-player halftime transitions in two-half and
    four-quarter matches. Confirm Q1/Q2 and Q3/Q4 breaks consume a window, the
    Q2/Q3 break does not, odd regulation counts infer no halftime, and extra-
    time breaks consume a window.
11. Change only an on-field role and confirm no substitution counters move.
12. Use Manage Lineup from Field, Lineup, and a participant Role action; confirm
    every entry opens the same draft and More has no duplicate controls.
13. Open while paused, resume or mutate lineup elsewhere before Apply, and
    confirm stale revalidation refuses the old draft.
14. Edit, remove, and restore a grouped transition from live Timeline. Confirm
    dependent later events either rebuild correctly or block the correction.
15. Review the same match through local Summary, cloud primary, canonical final,
    parked resume, recovery export/import, and reopen.
16. Open a pre-S24 cloud match and confirm Opening Lineup works while Team
    Default is absent without warning or corruption.
17. Verify 320px, 390px, and desktop layouts, keyboard/focus behavior, reduced
    motion, PWA update, and light/dark token compatibility without implementing
    the separate theming plan here.
18. After migration 069, first-bind one eligible Soccer setup-v1 game, Soccer
    setup-v2 game, Basketball setup-v1 game, and reviewed anchored Basketball
    setup-v2 game. Confirm unsupported setup versions still fail before writes.

## 9. Exit criteria

- Migration 069 and the exact setup-v2 capability are deployed before the new
  cloud setup writer.
- Old Soccer setup/state versions remain compatible, and Basketball setup v1/v2
  both pass first binding without changing Basketball release policy.
- Every new lineup Apply is one checked, replayable, correctable event.
- Opening Lineup and frozen Team Default remain distinct and immutable.
- One editor replaces paired substitution rows without losing single-swap,
  outgoing-only, role-only, short-handed, or limited-substitution behavior.
- Halftime uses the exact even regulation midpoint and is re-derived during
  replay/correction; counts, roles, intervals, eligibility, and goalkeeper
  authority remain projection-derived and covered by tests.
- Local, parked, cloud-primary, canonical, finalization, reopen, conflict, and
  recovery paths preserve the new contracts.
- Focused and full tests, typecheck, lint, production build, SQL checks, and the
  deployed manual matrix pass.

## 10. Cross-sport interaction contract

Later sports may reuse these product concepts:

- edit a desired final lineup rather than pairing substitutions;
- show active and inactive groups simultaneously where screen size permits;
- offer immutable match presets;
- preview one derived transition before Apply; and
- keep one confirmation as one correction unit.

They must not reuse Soccer's player limits, roles, clocks, substitution counts,
return eligibility, goalkeeper rule, halftime rule, or event payload. Basketball
already has period-boundary and equal-play authority; future Baseball, Football,
and Hockey lineups will each require their own domain plan.

## 11. Deferred follow-ups

- multiple named team lineup/formation presets
- opponent lineup management
- drag-and-drop pitch positioning
- automatic replacement recommendations
- injury status and return-to-play workflow
- writing match changes back to team defaults
- tactical formation analytics or possession inference
- a generic cross-sport lineup component before a second sport validates the
  interaction contract
