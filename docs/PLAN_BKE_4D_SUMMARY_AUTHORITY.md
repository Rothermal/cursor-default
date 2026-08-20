# Plan: BKE-4D Basketball Summary Authority

Status: Product and delivery Q&A approved. BKE-4D1 is implemented; BKE-4D2 is next. Basketball
event-game creation remains internal-only through BKE-4E, and the combined BKE-4B/BKE-4C live
Supabase matrix remains required before broader enablement.

Parent roadmap: [PLAN_BKE_4_EVENT_CLOUD_CUTOVER.md](PLAN_BKE_4_EVENT_CLOUD_CUTOVER.md)

Depends on:
[PLAN_BKE_4C_RECORDERS_AND_FINALIZATION.md](PLAN_BKE_4C_RECORDERS_AND_FINALIZATION.md)

## 1. Goal

Give event-backed Basketball one truthful Summary for five compatible contexts without weakening
legacy games or mixing recorder authority:

- an owned local event stream;
- the effective non-final cloud primary;
- an explicitly selected alternate cloud recording;
- an active canonical final publication; and
- the existing aggregate-only Basketball Summary.

The event Summary provides Overview, Players, Timeline, Shot Chart, and Team Stats tabs. Every event
tab derives from one explicit source. Only a healthy, owned, non-final local source may expose the
existing BKE-3 correction commands. Remote and canonical sources remain read-only.

BKE-4D does not add canonical cross-game aggregates, backend capability negotiation, Basketball
settings or rollout, an anchored clock, substitutions, lineup intervals, possession metrics, or
historical event backfill.

## 2. Required Invariants

- The `/summary` route retains the existing legacy Basketball path and selects the event path only
  after proving `gameDataAuthority = 'sport_events'`.
- Components consume one discriminated authority. They never infer authority from a loose mixture
  of route shape, game status, local state, and cached score columns.
- A cloud-final event game requires one healthy active canonical publication. Missing or malformed
  canonical authority fails closed and never falls back to local, primary, alternate, legacy, or
  score-only totals.
- A retained local copy of a cloud-final game is not final authority.
- Recorder streams are isolated. Switching sources replaces the complete review source; no event,
  participant, shot, total, or diagnostic is blended across recorders.
- Cached aggregate counters are not authoritative for event games. Every healthy event Summary is
  deterministically rebuilt from immutable setup, participants, and the selected event stream.
- Remote source inspection never hydrates `GameContext`, replaces the active game, resumes a parked
  game, or grants mutation rights.
- Existing-record access is independent of development gates, future rollout settings, and device
  preferences. Those controls govern creation, not known-record review.
- Legacy Basketball and Soccer Summary behavior remain regression boundaries.

## 3. Route and Authority Contract

### 3.1 One Summary route

Keep `/#/summary` as the canonical post-game route.

- Without `gameId`, a healthy active local Basketball event game supplies `local` authority.
- With `gameId`, or when the local binding reports the cloud game as final, load cloud game identity
  before resolving authority.
- A final event game loads only its active canonical publication.
- A non-final event game loads its effective primary unless an authorized manager explicitly
  selects another recording for review.
- An aggregate-only Basketball game continues through the existing `GameSummary` implementation.
- Invalid or unsupported event markers fail closed. They never enter the aggregate path.

Cloud Games, Game Info, parked-game review, and local completion may link to Summary. Cloud-bound
completion continues handing off to Game Info for explicit finalization before canonical Summary
becomes available. Finalize and cloud Reopen remain Game Info responsibilities; Summary links there
rather than duplicating authority-changing controls.

### 3.2 Explicit source model

Use a discriminated source boundary equivalent to:

```ts
type BasketballSummarySource =
  | {
      kind: 'local'
      state: GameState
      editable: boolean
      recorder: null
      publication: null
    }
  | {
      kind: 'cloud_primary'
      state: GameState
      editable: false
      recorder: BasketballRecorderSummary
      publication: null
    }
  | {
      kind: 'cloud_recording'
      state: GameState
      editable: false
      recorder: BasketballRecorderSummary
      publication: null
    }
  | {
      kind: 'canonical'
      state: GameState
      editable: false
      recorder: BasketballRecorderSummary
      publication: BasketballCanonicalPublication
    }
```

Exact names may follow local conventions, but source kind, health, editability, recorder identity,
and publication identity must remain explicit.

Source precedence is:

1. active canonical publication for a final cloud game;
2. healthy owned local source when the cloud game is not final;
3. effective healthy cloud primary for a direct non-final cloud review; and
4. an alternate recording only after explicit authorized selection.

Selecting an alternate never changes the effective primary. Managers may reveal an
`Other recordings` control and inspect one isolated source. Other permitted readers receive only
the compact authority information already allowed by BKE-4C. Returning to Primary reloads normal
`cloud_primary` authority.

### 3.3 URL contract

Preserve deterministic refresh and back navigation with validated query parameters:

- `gameId` for direct cloud review;
- `tab=overview|players|timeline|shots|team`;
- source/recorder selection for an authorized alternate review;
- `from` for Tracker, Games, Game Info, Team, or sport-dashboard return context; and
- `teamId` when Team Info supplied the route context.

Invalid tabs fall back to Overview with replace navigation. Invalid, unauthorized, or unavailable
alternate selections return to normal primary authority without leaking recorder detail. Source
changes preserve the selected top-level tab where that tab is valid, but reset participant,
period, family, marker, and detail-sheet state so filters cannot cross-contaminate sources.

## 4. Health, Freshness, and Failure Behavior

### 4.1 Healthy rebuild

Every event source passes through the same Basketball normalization, migration, validation, and
projection rebuild used by the tracker and BKE-4C finalization preview. Pure Summary readers consume
the rebuilt source; presentation components do not query event tables or recalculate authority.

Canonical parsing validates the publication envelope, Basketball payload schema, game id, primary
recorder id, immutable setup, participants, source stream, and complete projection. Remote primary
and alternate loaders use isolated cloud shells and strict participant mapping.

### 4.2 Fail closed

When a requested source is missing, malformed, unsupported, or incompletely projected:

- retain safe game identity, navigation, source label, refresh, Game Info, and recovery actions;
- show a compact needs-attention state;
- give managers actionable recorder/checkpoint diagnostics while limiting other readers to the
  permitted compact status;
- suppress official score/result, comparisons, leaders, Players, Timeline, Shot Chart, Team Stats,
  finalization suggestions, and edit controls; and
- never derive apparently official output from the last coherent partial projection.

A transient refresh failure may retain the last fully healthy rendering with a visible freshness
warning. It must not retain a primary after the cloud game transitions to final or retain a
canonical source after reopen invalidates its publication.

### 4.3 Refresh policy

- Local authority follows the mounted local state.
- Non-final remote authority supports manual refresh plus bounded focus, visibility, and online
  refresh. Realtime is not required.
- Canonical authority is static except for manual refresh or an observed final/reopen transition.
- Remote state remains page-local and read-only; refresh never dispatches into or parks
  `GameContext` state.

## 5. Shared Basketball Summary Model

Keep source loading near the page/source module, pure derivation under `src/lib/basketball`, and
rendering in focused Basketball Summary components. A suitable boundary is:

```ts
interface BasketballDetailedSummary {
  overview: BasketballOverviewReview
  players: BasketballPlayerReview
  timeline: BasketballTimelineReview
  shots: BasketballShotReview
  team: BasketballTeamReview
}
```

Tabs may derive lazily, but every helper receives exactly one healthy source state or its immutable
projection. Helpers never read a second recorder or legacy aggregate tables.

### 5.1 Overview

Overview includes:

- tracked/opponent names, score, terminal state, and Win/Loss/Abandoned context;
- date, competition, rule profile/format, regulation/overtime structure, recorder, and publication
  metadata as applicable;
- an always-visible authority badge: `Local Recording`, `Primary Recording`, `Other Recording`, or
  `Final Publication`, with read-only and health state;
- period scoring derived from effective scoring events and score adjustments rather than stored
  cloud score columns;
- compact tracked/opponent comparisons for shooting, rebounding, playmaking, defense, turnovers,
  fouls, and timeout context; and
- all tied nonzero leaders for points, rebounds, assists, steals, and blocks.

Key traditional rows remain visible at zero. Optional rows may hide only when both sides are zero.
Abandoned games retain their score and terminal label without manufacturing a competitive result.

### 5.2 Players

Include every immutable setup participant plus valid late participants. Use `participantId` as the
match identity; never merge by name, jersey, or cloud player id. Show tracked and opponent sides
separately.

- Tracked participants always receive rows, including zero-stat participants.
- Explicitly recorded complete or partial opponent participants receive their own rows.
- Team/unknown opponent activity remains in authoritative team totals and never fabricates an
  opponent player.
- Preserve setup order, then append late participants by stable event order.
- Clockless BKE-4D displays manual minute-event totals only. It does not infer appearances, DNP,
  game time, or lineup intervals that belong to BKE-6.

The traditional box score includes points; FGM/FGA/FG%; 2PM/2PA; 3PM/3PA; FTM/FTA/FT%; offensive,
defensive, and total rebounds; assists; steals; blocks; turnovers; personal fouls; and manual
minutes. Read-time derived values include denominator-safe eFG%, true-shooting percentage, and
assist-to-turnover ratio. Keep raw values beside rates where useful and hide a rate when its
denominator is zero.

Possession, lineup, plus-minus, usage, pace, and similar metrics remain hidden unless a later
complete event module proves every required input.

### 5.3 Team Stats

Read the projector's authoritative side totals, including player-, team-, staff-, neutral-, and
unknown-attributed effects where their event definitions contribute. Do not sum visible player
rows as a substitute; that would omit team-kind activity and can double-count foul contributions.

Team review covers:

- complete traditional side totals and safe shooting/rate derivations;
- period scoring;
- period team fouls and bonus state from structured foul projection;
- player/team/staff technical and ejection context without assigning staff incidents to players;
- charged timeout inventory and neutral official/media timeout history; and
- an attribution detail that distinguishes participant totals from team/unknown activity where the
  distinction helps explain why the team row differs from visible player sums.

### 5.4 Timeline

Reuse the complete BKE-3 event-family review rather than creating a reduced Summary timeline.

- Group oldest-first by period while preserving canonical capture order.
- Retain overlapping event-family filters and capture groups.
- Show effective events by default and removed events in a collapsed review.
- Expose only current revision/removal metadata; BKE-4D does not add a second audit store.
- Preserve `Recorded later` context and deterministic sequence labels.
- Because BKE-4D games are clockless, show period plus capture order and never invent elapsed game
  times from event timestamps or sequence.

A healthy editable `local` source may reuse BKE-3 add, revise, remove, and restore dialogs. Terminal
local streams still require the existing reasoned local Reopen before mutation. Cloud primary,
alternate, and canonical sources render identical details without mutation controls and may offer
`Open Owned Recording` when the current user owns a resumable local binding.

### 5.5 Shot Chart

Derive shot review from active field-goal events only. Free throws retain trip/attempt presentation
in Timeline and box score rather than court markers.

- Plot active located field goals for tracked and opponent sides.
- Filter by side, participant, period, result, and 2PT/3PT value without reloading authority.
- Use corrected normalized location and the snapshotted court geometry.
- Preserve event-id marker identity, deterministic overlap handling, field-goal ordinal, and shared
  BKE-3 shot detail.
- Keep unlocated field goals authoritative in totals and provide a filter-aware unlocated review
  list instead of hiding them.
- Pair every marker interaction with an equivalent keyboard-accessible list/detail path.

Only an editable local source exposes the shared shot editor. Selecting a marker in a remote or
canonical source is review-only.

## 6. UI and Access Behavior

- Use a compact score/authority header and top-level tabs rather than one long scrolling Summary.
- Keep tab dimensions stable and allow controlled horizontal tab scrolling on narrow devices.
- Use segmented controls, menus, and filter sheets appropriate to each option set; do not stack
  decorative cards or put cards inside cards.
- Tables prioritize core columns on narrow screens and move complete detail into an accessible
  row/detail sheet instead of creating page-level horizontal overflow.
- Tabs, filters, source controls, markers, rows, and dialogs are keyboard operable with visible
  focus, appropriate labels, restored focus on close, and live status for refresh/source changes.
- Managers may inspect alternate recordings and detailed diagnostics. Scorer/viewer/non-manager
  output remains within the BKE-4C limited recorder contract.
- Summary never grants editing because a reader is an app admin or team manager. Mutation requires
  ownership of the mounted local recorder stream.

## 7. Delivery Slices

Each slice uses its own branch and PR. Later tabs stay hidden until their complete slice lands.

### BKE-4D1: Authority Shell and Overview

1. Add strict local, cloud-primary, cloud-recording, and canonical source loading without hydrating
   remote state into `GameContext`.
2. Route marked event games through one Basketball Summary shell while preserving the legacy
   aggregate branch.
3. Add validated URL tab/source/return context, authority labeling, health/failure behavior,
   refresh policy, and Game Info recovery links.
4. Add pure Overview result, period scoring, comparison, leaders, and metadata readers plus the
   responsive Overview UI.
5. Add manager-only optional alternate recording review with no primary mutation or stream blend.

Exit: every authority kind produces one truthful Overview; final canonical failure is closed and
legacy Basketball remains unchanged.

Implementation record (August 2026): `src/lib/basketball/summarySource.ts` owns strict local,
isolated cloud-primary, manager-selected alternate, and canonical source loading. Remote review
never dispatches into `GameContext`; final games require a healthy canonical publication; and
incomplete projections suppress official output. `src/lib/basketball/summary.ts` owns URL/back
contracts plus pure result, period scoring, comparison, and tied-leader derivation. Marked event
games route through `BasketballSummary`, while a narrow setup-snapshot authority probe preserves
the legacy aggregate Summary path. Only Overview is visible until BKE-4D2 adds Players and Team
Stats. No migration was required.

### BKE-4D2: Players and Team Stats

1. Add participant and authoritative team read models.
2. Add tracked and explicit-opponent player tables, traditional box score, safe rates, stable
   ordering, and complete detail sheets.
3. Add team totals, period scoring/fouls/bonus, timeout/discipline context, and attribution detail.
4. Complete narrow-screen tables, zero/partial-opponent behavior, and source-transition tests.

Exit: Players and Team Stats agree with the selected projection without fabricating opponent rows,
losing team-kind activity, or deriving unsupported advanced metrics.

### BKE-4D3: Timeline

1. Adapt the complete BKE-3 Timeline reader and family filters to one Summary source.
2. Extract/reuse correction surfaces instead of copying command logic.
3. Enable mutation only for a healthy owned local source; keep all remote/canonical review
   read-only with explicit owned-recording handoff where available.
4. Add removed-event review, recorded-later context, source reset behavior, and keyboard/focus
   coverage.

Exit: all event families are reviewable for every healthy authority and correction never crosses a
recorder or terminal boundary.

### BKE-4D4: Shot Chart, Routing, and Exit Audit

1. Add located field-goal markers, filters, overlap handling, shared detail, and unlocated review.
2. Reuse local shot correction only for editable local authority.
3. Finish Cloud Games, Game Info, tracker, parked-game, refresh, and return-context entry points.
4. Complete mobile/desktop accessibility, malformed/deep-link/source-transition coverage, legacy
   Basketball and Soccer regression, documentation, and the BKE-4D manual matrix.

Exit: Overview, Players, Timeline, Shot Chart, and Team Stats all consume one explicit authority;
remote sources remain read-only; final sources fail closed; and BKE-4E can build canonical
aggregates without revisiting match-summary authority.

No Supabase migration is expected. If a missing authorized read contract is discovered, amend this
plan and isolate the narrow fixed Basketball RPC before adding SQL. Do not add speculative Summary
tables or broad direct-table reads.

## 8. Automated Verification

Every slice runs focused tests, the full Vitest suite, production build, ESLint, and
`git diff --check`. Coverage includes:

- strict source parsing and precedence for local, primary, alternate, canonical, and legacy;
- final canonical success, missing publication, malformed payload, invalid identity, invalid
  projection, reopen transition, and no fallback;
- remote inspection that never dispatches, parks, activates, or mutates local state;
- manager alternate access versus limited-reader status and unauthorized query parameters;
- URL refresh/back behavior, invalid tab/source fallback, source transitions, and stale selection
  reset;
- exact Overview result, period scoring, comparison, ties, and all-zero behavior;
- tracked/optional-opponent participants, team/unknown attribution, traditional totals, and safe
  derived rates;
- complete Timeline family classification, removed rows, recorded-later context, local-only
  correction, and terminal mutation guards;
- located/unlocated shots, side/player/period/result/value filters, ordinal identity, overlap, and
  marker/list parity;
- healthy, incomplete, malformed, and transient-refresh source behavior;
- personal creator, owner/admin, scorer, viewer, non-member, and app-admin-without-team-role;
- narrow/mobile layout, keyboard controls, focus restoration, and live status; and
- unchanged legacy Basketball Summary and Soccer Summary authority.

## 9. Manual Runtime Matrix

Record route, game id, source kind, account/role, viewport, and pass/fail evidence for:

1. local personal and team event games across in-progress, period break, completed, abandoned,
   reopened, and unhealthy states;
2. direct non-final primary review without touching a different active/parked game;
3. manager alternate selection and return to Primary with visibly isolated totals;
4. scorer/viewer limited status and denied alternate internals;
5. canonical final review, refresh, publication history transition, reopen invalidation, and no
   fallback when canonical data is unavailable;
6. owned-local Timeline and shot correction versus read-only remote/canonical detail;
7. partial opponent roster, team/unknown events, unlocated shots, removed events, score
   adjustments, overtime, and abandoned results;
8. refresh/deep-link/back behavior from Tracker, Cloud Games, Game Info, Team, and parked games;
9. phone and desktop keyboard/pointer review for every tab; and
10. unchanged representative legacy Basketball and canonical Soccer summaries.

The deferred BKE-4B/BKE-4C two-device, recorder, finalization, and reopen evidence remains a
separate release gate. It does not block BKE-4D implementation while creation remains internal.

## 10. Rollback and Failure Handling

- BKE-4D is expected to be client-only. If a slice regresses event review, disable only the marked
  event Summary entry while preserving local games, cloud rows, publications, and legacy Summary.
- A failed remote load or rebuild never changes active or parked local state.
- A failed local correction retains the prior healthy state and source selection.
- A cloud-final game without healthy canonical authority remains unavailable rather than showing a
  stale local or primary result.
- Shared Soccer or legacy Basketball regressions block the affected slice.

## 11. Explicitly Out of Scope

- Canonical season, career, player, team, tournament, and leaderboard readers: BKE-4E.
- Capability negotiation, compatibility retirement, and release evidence: BKE-4E.
- Basketball personal/team/match settings and user-visible event rollout: BKE-5.
- Anchored clocks, stoppages, substitutions, on-court-five, lineup intervals, and derived minutes:
  BKE-6.
- Possession, pace, usage, plus-minus, and lineup metrics without complete source events.
- Historical aggregate-to-event conversion or backfill.
- Cross-recorder merge, consensus, deduplication, comparison totals, or collaborative editing.
- Direct Summary finalization/reopen controls or mutation of another recorder's stream.
- Print, share, export, or public unauthenticated game pages.

## 12. Approved Decision Register

The August 2026 Q&A approved all 32 recommended choices:

- one `/summary` route with an explicit event authority and unchanged legacy branch;
- Overview, Players, Timeline, Shot Chart, and Team Stats delivered in slices;
- canonical-final precedence, owned-local non-final precedence, effective-primary cloud review, and
  opt-in manager alternate review;
- owned-local-only correction and read-only remote/canonical sources;
- fail-closed canonical and unhealthy-source behavior with role-limited diagnostics;
- Game Info ownership of Finalize/Reopen and deterministic URL-backed navigation;
- traditional player box score, denominator-safe rates, authoritative team totals, optional
  opponent participants without fabricated rows, and completeness-gated advanced metrics;
- complete BKE-3 Timeline reuse, located plus unlocated shot review, and no invented clock times;
- isolated remote shells, no `GameContext` hydration, and source-specific UI-state reset;
- compact tabbed mobile structure, visible authority labeling, keyboard and list equivalents;
- four implementation slices, no speculative migration, complete source/role/health regression,
  and strict BKE-4D/BKE-4E/BKE-5/BKE-6 boundaries.

## 13. Next Step

Begin BKE-4D2 on a fresh implementation branch after BKE-4D1 merges. Keep event-game creation
internal and carry the combined BKE-4B/BKE-4C live matrix forward to the BKE-4E release evidence.
