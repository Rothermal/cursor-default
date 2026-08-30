# Plan: BKE-6D Cloud Summary, Aggregates, and Lifecycle

Status: Approved. All 32 product and implementation decisions are complete. Delivery is split into
BKE-6D1 through BKE-6D4; implementation has not started. BKE-6D1 is next.

Parent: [PLAN_BKE_6_CLOCK_AND_LINEUPS.md](PLAN_BKE_6_CLOCK_AND_LINEUPS.md)

---

## 1. Goal

Carry complete anchored-clock and lineup authority from one coherent Basketball recorder through
Summary, canonical aggregates, cloud transport, finalization, reopen, correction, resume, and
republication. Preserve clockless Event games, Legacy Basketball games, Soccer transport, existing
publications, and the BKE-4 recorder-authority model.

---

## 2. Inherited Contracts

- Canonical elapsed time is exact forward-counting milliseconds even when the display counts down.
- Every recorder owns one complete event stream. Recorder histories are never blended.
- Primary selection and canonical publication choose one coherent source.
- Anchored cloud operations require both the existing Basketball release capability and the fixed
  clock/lineup capability.
- Finalization requires a terminal paused clock, completed expected periods, complete primary clock
  and tracked-lineup authority, no unresolved replacement, reasoned equal-play overrides, and an
  exact current checkpoint.
- Reopen invalidates the active publication without deleting audit history. Correct records and
  Resume game remain distinct paths.
- Clockless manual minutes and historical canonical publications keep their established semantics.

---

## 3. Approved Decisions

### Batch A: Delivery and authority

1. Deliver BKE-6D as presentation/projection first, then canonical aggregates, cloud transport, and
   finalization/reopen. The intended slices are BKE-6D1 Summary detail, BKE-6D2 aggregates,
   BKE-6D3 cloud transport, and BKE-6D4 finalization and reopen/republication.
2. An incomplete lineup history does not hide otherwise trustworthy review. Summary displays valid
   source data with explicit quality disclosure and suppresses only metrics whose prerequisites are
   unproven, including affected plus-minus values.
3. Remote and canonical review use exactly one coherent recorder source. A manager-selected
   alternate remains explicit read-only inspection and is never merged with another recorder.
4. Aggregate evolution is additive: preserve historical clockless/manual-minute behavior while
   adding exact participation seconds, starts, appearances, DNP, and quality-gated plus-minus for
   anchored authority.

### Batch B: Summary and quality

5. Players keeps a stable roster order with separate tracked and opponent sections. Explicit sort
   controls may order by participation time or statistics without making a changing minutes rank
   the default identity of the page.
6. Each player row leads with total `MM:SS` and stint count. Period-by-period intervals remain
   available through an expandable detail rather than forcing every interval into the initial
   scrolling surface.
7. Incomplete authority produces both a concise page-level quality notice and a specific reason at
   each suppressed dependent metric. Valid source facts remain visible.
8. Remote and canonical Timeline sources retain complete filters and event detail but remain
   read-only. Correction requires an explicit matching-local-binding handoff or an authorized
   reopen path; remote review never mutates `GameContext` directly.

### Batch C: Aggregate semantics

9. Participation intervals remain authoritative in milliseconds. Aggregate projection sums the
   full interval total first and truncates once to whole seconds for `bk_min_sec`; individual stints
   are never independently rounded.
10. Entry into a valid on-court lineup proves an appearance even when no running-clock time elapses.
    DNP means a participant belonged to the match roster but never entered a valid lineup.
11. Scoped plus-minus sums only eligible games and reports explicit `eligible games / total games`
    coverage. Partial-coverage values may appear in individual review but are excluded from
    comparative rankings.
12. Tracked-player plus-minus requires complete tracked-lineup and scoring authority but does not
    require optional opponent-player lineups. Opponent-player and opponent-lineup metrics require
    complete opponent lineup coverage.

### Batch D: Cloud transport and capability

13. Anchored Enable Cloud Sync extends the existing confirmation transaction rather than creating
    a second binding workflow. It adds fresh checks for both capabilities, stream health, duplicate
    bindings, and checkpoint-first activation.
14. Structurally valid anchored streams may upload and checkpoint while the clock is running.
    Remote review labels that authority as live; publication remains blocked until the clock is
    terminal and paused.
15. Account-isolated capability caches may support presentation, but bind, finalization, reopen,
    and every other cloud-authority mutation freshly verify both capability contracts.
16. A structurally valid stream with disclosed lineup-quality gaps may upload for recovery while
    remaining unready for publication. Malformed payloads, unknown event families, or streams that
    cannot produce the required coherent projection remain quarantined and unsynced.

### Batch E: Primary and reopen lifecycle

17. A manager may select any structurally valid recorder as primary even when disclosed quality
    gaps remain. Selection and publication readiness stay separate, and readiness explains every
    remaining blocker.
18. Finalization independently reprojects and enforces anchored readiness in the client preview and
    trusted server transaction. The checks include clock and period completion, tracked-lineup
    quality, replacement state, equal-play overrides, recorder conflicts, exact checkpoint, access,
    and both fresh capabilities.
19. Reopen requires a reason and an explicit `Correct records` or `Resume game` mode. Both values
    survive in audit and publication history; intent is never inferred from a later action.
20. Resume restores the last authoritative period and canonical clock position paused, then requires
    lineup review and explicit Clock Start. A period already at `0:00` requires reasoned Set Clock
    or the established next-period/overtime workflow; Resume never manufactures time or overtime.

### Batch F: Conflicts, ownership, and republication

21. Conflicting revisions of the same clock or lineup event are never merged or resolved by wall
    time. Sync pauses for that recorder and uses the existing explicit conflict-resolution workflow.
22. Correct records and Resume prefer the matching primary-recorder owner's parked binding. When it
    is absent, strict same-recorder adoption may create a parked slot after ownership, capacity,
    capability, and duplicate-binding checks. Managers cannot clone another recorder's history into
    their own editable stream.
23. Reopen defaults to the prior publication's primary for continuity but unlocks manager primary
    selection before the next publication. The prior primary is not permanently privileged.
24. Correction and resumed play always require a fresh readiness review and explicit Finalize
    action. Upload or checkpoint success never republishes automatically.

### Batch G: Compatibility and migration

25. Structurally healthy local-only anchored games created before BKE-6D may enable cloud without
    conversion after fresh dual-capability, ownership, capacity, and duplicate-binding checks.
26. Clockless Event and Legacy Basketball retain their established cloud routes and do not require
    the clock/lineup capability. Their aggregate and publication behavior remains unchanged.
27. The existing canonical envelope and payload schema versions remain sufficient because immutable
    setup and event payloads already carry their own versions. Anchored detail is reprojected from
    the selected coherent stream instead of adding a parallel canonical representation.
28. Supabase changes are additive extensions behind private event-platform cores and fixed
    Basketball wrappers. Existing RPC names, exact response shapes, grants, and Soccer behavior stay
    compatible; anchored support does not replace the established recorder/finalization surfaces.

### Batch H: Destinations and exit

29. Player plus-minus appears in Summary Players and aggregate Participation destinations.
    Five-person lineup plus-minus appears in a Summary Lineups section; cross-game lineup rankings
    remain deferred.
30. Eligibility, coverage counts, and suppression reasons are structured provenance beside numeric
    aggregate values. Sentinel numbers never represent unavailable or partial metrics.
31. Every cloud slice requires full automation plus focused one-device Supabase smoke. The broader
    two-device, role, offline, PWA, and mixed-sport matrix remains BKE-6E release evidence.
32. Anchored mode remains default-off and owner-only throughout BKE-6D. No rollout-stage or broader
    access change belongs in this phase.

---

## 4. Authority and Compatibility Matrix

| Source | Review | Mutation | Aggregate behavior |
|---|---|---|---|
| Matching healthy local binding | Full detail | Existing live controls or explicit reopened correction mode | Uses the same pure projection as remote sources |
| Local binding with recoverable lineup gaps | Valid facts plus quality disclosure | Recovery/correction only where current policy permits | Safe stats remain; dependent metrics are suppressed |
| Current recorder cloud stream | Full read-only detail unless explicitly adopted | Strict same-recorder adoption only | Never combines with another recorder |
| Manager-selected alternate | Explicit alternate, read-only | No direct mutation or cloning | Inspection only; not canonical until selected and published |
| Active canonical publication | Official read-only detail | Requires manager reopen and recorder-owner handoff | Sole event authority for finalized aggregate pages |
| Clockless Event publication | Existing BKE-4 behavior | Existing behavior | Recorded/manual-minute semantics remain unchanged |
| Legacy Basketball game | Existing aggregate/Game Info behavior | Existing behavior | Never enters event or anchored authority |
| Malformed or unknown-family stream | Quarantined diagnostic context | No mutation, upload, checkpoint, or finalization | Excluded with structured provenance |

Remote review never dispatches a hydrated stream into `GameContext`. A local handoff must match the
cloud game id, recorder owner, and parked binding, or pass the existing strict adoption transaction.
No route may fall back from an anchored event game to Legacy snapshots or aggregate writes.

---

## 5. BKE-6D1: Summary Detail and Quality

Extend the existing authority-aware `BasketballSummary` rather than adding an anchored Summary.
`summarySource.ts` continues selecting exactly one local, primary, alternate, or canonical source.

### Player review model

`summaryDetails.ts` should add one projection-derived participation block to each player row:

- opening Starter, Bench, or DNP assignment and final appeared/DNP result;
- exact `participationMs`, display `MM:SS`, stint count, and period-local intervals;
- start and appearance evidence, late-roster status, position/captain history, and eligibility state;
- tracked or opponent lineup-completeness state with structured suppression reasons; and
- player plus-minus only when its tracked/opponent prerequisites are proven.

Opening assignment and final participation result are separate facts. Entering any valid on-court
lineup proves an appearance even if the interval contributes zero milliseconds. DNP means the
participant never entered a valid lineup. Manual-minute events stay visible but inert for anchored
games and remain the displayed source for clockless games.

Players defaults to stable setup/late-roster order within separate tracked and opponent sections.
Explicit controls may sort by name, `MM:SS`, or an available statistic. Each compact row shows time
and stint count; interval and role history expand in place without nesting cards or forcing all
history into the initial page.

### Overview, Team Stats, and Timeline

- Overview discloses clock model/direction, terminal or live clock state, tracked and opponent
  lineup coverage, unresolved replacements, boundary/equal-play state, and source authority.
- A concise quality notice lists affected sides/periods. Every hidden dependent metric also carries
  its specific reason; valid score and stat facts remain visible.
- Team Stats adds a Lineups section for tracked five-person combinations and optional opponent
  combinations. It shows running time and eligible plus-minus, not a cross-game ranking.
- Timeline keeps its current complete event-family filters and detail. Remote/canonical clocks may
  derive a display-only live value from the persisted anchor, clearly labelled as remote and never
  written back.
- Existing local nonterminal corrections remain available. Remote, canonical, terminal, and
  nonmatching local sources stay read-only until the explicit handoff/reopen contract applies.

### BKE-6D1 exit tests

- stable tracked/opponent order, sort controls, keyboard expansion, and compact responsive rows;
- exact `MM:SS` and stint rendering across period boundaries, zero-duration appearances, late
  participants, short-handed intervals, and count-up/countdown display;
- complete versus incomplete tracked/opponent quality and metric-specific suppression;
- player and five-person plus-minus eligibility without requiring opponent participants for tracked
  metrics;
- local, current-recorder, alternate, canonical, malformed, and incomplete source isolation; and
- unchanged clockless Summary, Legacy Summary/Game Info routing, Soccer, Timeline correction, and
  no-`GameContext`-hydration guards.

No migration is expected in BKE-6D1.

---

## 6. BKE-6D2: Exact-Second Aggregates

Extend the pure BKE-4E aggregate engine. Canonical snapshots continue rebuilding through the shared
registry/projector and produce one match contribution; no aggregate table or denormalized lineup
window becomes a second authority.

### Match projection

- Sum authoritative participation intervals in milliseconds and truncate once after the game total
  to produce whole `bk_min_sec` seconds. Never round each stint.
- Add DNP and signed player plus-minus to the canonical stat catalog using stable additive metric
  ids. Existing `bk_app`, `bk_start`, and `bk_min_sec` retain their identities.
- Anchored appearance comes from valid lineup entry, start from opening-lineup authority, and DNP
  from match-roster presence without an appearance.
- Player plus-minus requires complete tracked lineup and scoring history. Opponent participant
  lineups are not required for tracked-player values.
- Five-person lineup combinations use sorted stable participant/player identities and remain
  Summary detail rather than cross-game ranking data in this phase.
- Optional opponent-player values require complete opponent lineup coverage. Team-only opponent
  score remains valid independently.

### Composition and provenance

Aggregate results carry a participation basis of recorded/manual or interval-derived, plus metric
eligibility, included-game count, total-game count, and suppression reasons. Numeric stats never use
sentinel values. Individual profile/career review may sum plus-minus across eligible games and show
`N of M games`; Leaderboard, Team Stats, and Tournament comparative ranking suppress that metric
unless the selected scope has complete coverage.

Unresolved stable-player mappings remain isolated by the existing contribution policy. A rostered
DNP with no contribution does not become a harmful unresolved exclusion. Authority collision,
duplicate source, abandoned game, and malformed-source behavior remain unchanged.

### BKE-6D2 exit tests

- millisecond totals with fractional-second stints proving sum-then-truncate behavior;
- zero-duration appearance, starter, bench appearance, DNP, late player, and merged stable-player
  semantics;
- complete and incomplete tracked/opponent plus-minus fixtures, score adjustment, correction,
  removed/revised event, overtime, and short-handed lineups;
- mixed clockless/anchored Personal, Team, Season, Tournament, Player Profile, and Career scopes;
- partial coverage display versus comparative-ranking exclusion;
- stable canonical metric parsing/formatting and unchanged legacy/manual-minute publications; and
- aggregate transport pagination, cancellation, account isolation, malformed-item isolation, and
  Soccer parity.

No migration is expected in BKE-6D2 unless the implementation audit proves a fixed RPC response
must carry new provenance. Any such change must be additive and use a new versioned surface rather
than widening an existing exact response.

---

## 7. BKE-6D3: Anchored Cloud Transport

The shared event transport is payload-agnostic and remains the only row-level sync engine. BKE-6D3
removes anchored client policy blocks only after it proves the following route:

1. classify a complete marked Basketball setup-v2/rules-v3 anchored stream;
2. freshly verify app/team access, the existing Basketball release capability, and
   `clockAndLineupsVersion: 1` before a cloud-authority mutation;
3. preserve Personal/existing-team source identity and recorder ownership;
4. reject duplicate cloud bindings before pull or upload;
5. bind or adopt using the existing Basketball v4 event route;
6. pull/merge one recorder stream without blending another recorder;
7. upload revisions and confirm an exact checkpoint; and
8. install automatic cloud policy only after the checkpoint succeeds, rolling back local binding
   metadata on failure.

Cloud-backed anchored creation and later Enable Cloud Sync use the same transaction. Existing local
anchored games need no conversion. Structurally valid streams may sync while the clock runs and may
upload disclosed quality gaps for recovery; their readiness remains false. Unknown families,
malformed setup/events, mixed ownership, or non-projectable streams stay quarantined and dirty with
recovery export available.

Presentation may use account-isolated capability caches, but creation, bind/adoption, checkpoint
activation, finalization, and reopen call both capabilities freshly before mutation. Clockless
Event and Legacy routes never call the clock/lineup capability. Sync-start and post-await stale
result guards, queue recovery state, conflict controls, binding uniqueness, local capacity, and
parked-game rollback remain unchanged.

### BKE-6D3 exit tests

- automatic Personal and existing-team anchored creation plus local-only later binding;
- unavailable, stale, malformed, denied, and account-switched dual-capability states before any
  active-game replacement or cloud mutation;
- paused/running/terminal upload, remote live review, recoverable incomplete lineup upload, and
  corrupt-stream quarantine;
- same-recorder matching parked resume, strict adoption, capacity failure, duplicate binding, and
  another-recorder rejection;
- offline queue replay, revision conflict, checkpoint mismatch, stale async result, rollback, and
  recovery export/import persistence; and
- byte-compatible clockless Event, Legacy Basketball, Soccer, and aggregate routes.

No event-row migration is expected. If the existing fixed binder rejects immutable setup version 2
or anchored event families despite the payload-agnostic contract, stop and add the narrowest fixed
Basketball wrapper in this slice without widening Soccer or shared grants.

---

## 8. BKE-6D4: Readiness, Finalization, and Reopen

BKE-6D4 extends the BKE-4C policy; it does not create a second publication system.

### Readiness and finalization

Primary selection accepts any structurally valid recorder and remains separate from readiness.
Client preview reprojects the isolated primary and returns ordered, actionable blockers. For an
anchored stream, readiness requires:

- both fresh capabilities and current manager/personal-creator access;
- no unresolved primary conflicts and an exact current checkpoint;
- expected periods complete, terminal paused clock, and no unsafe/stale anchor;
- complete tracked lineup intervals, no unresolved replacement or boundary review, and no invalid
  participant transition;
- a complete reasoned record for each enforced equal-play override; and
- the existing untied-completed or abandoned Basketball score/end policy.

The trusted finalization transaction independently validates the same persisted setup and event
rows before accepting the unchanged canonical snapshot envelope. Existing fixed RPC signatures and
response shapes stay intact. If actionable anchored readiness cannot fit an existing exact response,
add a fixed `v1` companion wrapper rather than widening it. Canonical finalization remains one
transaction and one active publication.

### Reopen modes

Anchored reopen adds a fixed mode-aware wrapper with exact `correct_records | resume_game` values and
a reason. The established `reopen_basketball_event_game(uuid, text)` contract stays available and
unchanged for older/clockless clients. Private reopen policy invalidates the active publication,
records reason and mode in append-only audit metadata, defaults primary selection to the prior
publication's recorder, and unlocks manager reselection.

The Basketball `match_reopened` payload may gain a strictly validated optional mode. Existing events
without it retain their current legacy resume semantics. For anchored authority:

- **Correct records** preserves the terminal paused clock and end context, enables only authorized
  Timeline correction on the matching recorder binding, and never exposes live capture.
- **Resume game** restores the last period and exact clock position paused, requires lineup review,
  and requires explicit Start. At `0:00`, the recorder must use reasoned Set Clock or the existing
  next-period/overtime command; reopen never resets time.

Manager cloud reopen and recorder-stream mutation remain distinct authorities. The prior recorder
owner resumes their matching parked binding or performs strict same-recorder adoption. A manager
cannot clone another user's stream. After correction/resume, sync and checkpoint do not publish;
the manager must run a fresh preview and explicit Finalize. Publication history remains immutable
and identifies reason, mode, prior publication, recorder, actor, invalidation, and replacement
publication.

### BKE-6D4 migration boundary

One or more additive migrations may:

- add private anchored readiness/finalization policy helpers;
- add mode-aware reopen audit storage with a safe legacy default;
- add fixed anchored readiness/reopen/history wrappers where exact existing responses cannot grow;
- preserve the existing canonical envelope, fixed Basketball RPCs, role grants, RLS, and Soccer
  wrappers byte-for-byte; and
- avoid destructive backfill or reinterpretation of historical publications.

Every new public function must be fixed-sport, schema/version bounded, authenticated only where
needed, and backed by source tests proving no broad shared core is executable directly.

### BKE-6D4 exit tests

- every anchored readiness blocker independently and in combination, including stale preview and
  post-checkpoint change;
- server/client parity fixtures for complete, incomplete, corrupt, clockless, abandoned, tied,
  overtime, equal-play, and replacement histories;
- primary selection before readiness, manager-limited alternate inspection, conflict resolution,
  and exact checkpoint confirmation;
- Correct records versus Resume game, old mode-less reopen compatibility, recorder-owner handoff,
  no cross-recorder cloning, and paused `0:00` behavior;
- explicit republication, active-publication replacement, immutable history, and failure rollback;
- strict RPC shape/grant/migration tests plus Soccer and clockless finalization parity; and
- focused one-device Supabase bind, upload, select, finalize, canonical review, reopen-correct,
  republish, reopen-resume, sync, and republish smoke.

---

## 9. Delivery Slices

| Slice | Scope | Exit condition |
|---|---|---|
| BKE-6D1 | Anchored Players, Overview, and Timeline detail with source and quality disclosure | Local and fixture-backed remote authorities present truthful detail without hydrating review state into the live game |
| BKE-6D2 | Exact-second canonical aggregate projection and quality-gated plus-minus | Anchored and clockless sources coexist without changing historical output semantics |
| BKE-6D3 | Dual-capability bind, sync, recorder readiness, and remote/canonical source integration | One complete anchored recorder can bind and checkpoint without blending streams or entering legacy sync |
| BKE-6D4 | Finalization, publication, correction/reopen, resume, and explicit republication | A ready primary can publish, reopen into the selected mode, repair or resume, and republish with immutable audit history |

Each slice receives its own regression record and implementation PR. The plan document is updated as
the exact code/RPC names settle, but authority may not move between slices implicitly.

---

## 10. Cross-Slice Engineering Rules

- Extend `summarySource.ts`, `summaryDetails.ts`, `aggregateProjection.ts`, `aggregateStats.ts`,
  `aggregateComposition.ts`, `cloudTransport.ts`, `recorders.ts`, and `finalization.ts` in place.
- One pure Basketball projection supplies local, recorder, canonical, Summary, and aggregate truth.
  Components and SQL never invent elapsed time, lineups, substitutions, or plus-minus.
- Persisted ordering remains recorder sequence then event id. Wall-clock timestamps never resolve a
  revision conflict.
- Every cloud mutation performs access/capability checks before storage or active-game replacement.
- Existing exact RPCs and canonical versions do not grow fields. New information uses a narrow
  additive versioned companion surface.
- Remote review is read-only. Any editable handoff proves game id, recorder id, account, binding
  uniqueness, capacity, and current revision before `GameContext` hydration.
- Quality is structured provenance. A warning never becomes a fabricated zero, and one unavailable
  metric never hides independent valid facts.
- Full automated gates and focused one-device Supabase smoke are recorded per cloud slice. Missing
  manual evidence is marked Not run, never implied.

---

## 11. Compatibility and Deferrals

BKE-6D must not:

- initialize, infer, or convert historical lineups, clock intervals, appearances, or plus-minus;
- alter clockless Event, Legacy Basketball, Soccer, existing canonical snapshots, or old reopen
  semantics;
- blend recorder streams, clone another recorder's authority, or enable collaborative live editing;
- use opponent player tracking as a prerequisite for valid tracked-player metrics;
- add possession ratings, shot clock, automated lineup scheduling, cross-game five-person lineup
  rankings, or a broad Summary/tracker reskin;
- auto-republish after sync or auto-reset time when resuming; or
- broaden the anchored owner-only/default-off release stage.

BKE-6E owns release-entry audit, older-client/PWA/responsive hardening, rollback evidence, owner
smoke consolidation, and disposition of the complete multi-device/role/offline/mixed-sport matrix.

---

## 12. Documentation and Completion

Each implementation slice updates this plan, the parent roadmap, README checklist, AGENTS runtime
summary, codebase overview, regression index, migration notes where applicable, and a slice-specific
regression record. A slice is complete only when:

- focused and full automated gates pass;
- any migration is applied manually and its focused Supabase smoke is recorded;
- accepted review findings are fixed in scope or assigned to a named later slice;
- no compatibility contract or release stage changes accidentally; and
- the next slice can begin from a clean merged `stattracker` branch.
