# Plan: BKE-6C Live Lineups and Corrections

Status: Product and delivery Q&A complete. All 16 implementation decisions are approved. BKE-6C1
through BKE-6C3 are implemented; BKE-6C4 is next.

Parent: [PLAN_BKE_6_CLOCK_AND_LINEUPS.md](PLAN_BKE_6_CLOCK_AND_LINEUPS.md)

---

## 1. Goal

Complete the local anchored Basketball lineup workflow: atomic multi-player substitutions,
lineup-changing boundary review, optional roles and captain history, short-handed and replacement
recovery, equal-play evaluation and authorized overrides, Set Current Lineup, Recent Events, and
Timeline correction. The resulting projection must preserve truthful complete or explicitly
incomplete intervals and exact derived playing time without changing clockless or legacy games.

## 2. Locked Boundaries

- The clock must be paused for every lineup mutation.
- A supported side may have at most five on-court participants and may not have zero.
- One through four requires a structured reason; ejection and disqualification never infer exits or
  replacements.
- Every configured lineup boundary requires explicit review before Clock Start.
- Setup remains the opening-lineup authority. Live events never rewrite immutable setup.
- Projection derives intervals and minutes from lineup and running-clock intersections.
- Opponent lineup authority remains optional and independent from tracked-team completeness.
- Clockless Event and Legacy Basketball behavior remains unchanged.
- Cloud lifecycle, finalization, Summary expansion, aggregates, and broad release evidence remain
  BKE-6D/BKE-6E scope.

## 3. Approved Implementation Decisions

### Batch 1: Substitution workflow

1. Build one side-aware substitution workflow. Tracked controls are always available; opponent
   controls appear only when the match has opponent lineup authority.
2. Use one focused sheet with Current Five and Bench groups, outgoing/incoming selection, a live
   resulting-lineup preview, and one atomic Commit action.
3. Keep BKE-6C1 focused on lineup substitution. BKE-6C3 adds role and captain editing using the same
   sheet infrastructure.
4. Unbalanced transitions use fixed Injury, Eligibility, Short-handed, Recovery, and Other reasons.
   Other requires a note, and every resulting lineup below five requires a reason.

### Batch 2: Boundaries and equal play

5. Pressing Clock Start when lineup review is required opens the focused review workflow. The sticky
   strip also keeps an explicit Review Lineup action visible until the boundary is resolved.
6. When the resolved policy permits it, Confirm Current Five records the required complete boundary
   snapshot without forcing the recorder to rebuild the same lineup manually.
7. Advisory equal-play failures show the affected constraints but may be confirmed without a reason
   and do not append an override event. Enforced failures require the authorized override path.
8. The UI evaluates the proposed lineup live and explains failed constraints. It does not generate
   or prescribe a replacement lineup.

### Batch 3: Roles and recovery

9. Position editing offers PG, SG, SF, PF, C, None, and Custom while persisting the game-specific
   string already supported by the event contract.
10. Captain is independent optional metadata per participant. Zero or multiple captains are valid;
    captain status does not constrain lineup eligibility.
11. Recover Current Lineup is a secondary lineup-sheet action with an explicit warning that unknown
    earlier timing in the current period will become incomplete. It is not presented as an ordinary
    substitution.
12. Set Current Lineup begins truthful tracking at the command time and marks only the affected
    current period incomplete. It never rewrites or degrades earlier periods.

### Batch 4: Undo and Timeline correction

13. One user command is one capture group. Substitution plus optional role changes share one group;
    an enforced equal-play override plus boundary confirmation share another.
14. Historical editing uses the period's familiar displayed clock value and direction. Detail and
    preview also disclose canonical elapsed `MM:SS`; persisted authority remains elapsed
    milliseconds.
15. Historical lineup edits are allowed when one final atomic candidate reprojects completely.
    Preview discloses changed intervals, participation, completeness, later lineups, and equal-play
    consequences rather than rejecting every event with later history.
16. Remove and Restore use the same stale-safe preview engine. They reject only when the resulting
    history is invalid or required dependencies cannot be resolved.

## 4. Approved Delivery Slices

| Slice | Scope | Exit condition |
|---|---|---|
| BKE-6C1 (complete) | Side-aware multi-player substitution sheet, balanced/unbalanced checked commands, resulting-lineup review, and replacement-required entry | Paused tracked and optional opponent lineups can transition atomically without inventing eligibility changes |
| BKE-6C2 (complete) | Configured-boundary review, lineup-changing confirmations, equal-play evaluation, enforced override authorization, and Clock Start gating | Every required boundary has explicit lineup evidence and no unresolved enforced decision can start the clock |
| BKE-6C3 (complete) | Position/captain history, late-player entry integration, short-handed/replacement recovery, and reasoned Set Current Lineup | Present lineup authority can recover truthfully while uncertain prior time remains explicitly incomplete |
| BKE-6C4 | Grouped Recent Events behavior, consequence-aware Timeline correction, stale preview rejection, diagnostics, accessibility/responsive hardening, and exit audit | Complete and incomplete histories correct atomically and derive trustworthy intervals/minutes without compatibility regressions |

The slices are intentionally sequential. Each receives its own feature branch, implementation PR,
regression record, and review cycle.

## 5. Existing Foundation

BKE-6A and BKE-6B already provide:

- strict version-3 anchored rules and setup-version-2 opening lineup authority;
- `basketball.substitution`, `basketball.role_changed`, `basketball.lineup_confirmed`, and
  `basketball.equal_play_override` definitions;
- `substituteBasketballLineup`, `changeBasketballParticipantRoles`, and the original checked
  same-current-five confirmation contract replaced by BKE-6C2;
- side-aware lineup projection, running-clock intersections, exact participation milliseconds,
  boundary state, replacement requirements, equal-play evaluation, and incomplete-period evidence;
- paused-only lineup commands, current-lineup recovery mode, and late participant support;
- one sticky `BasketballClockStrip` with current-five display and existing same-five confirmation;
- capture-command grouping, one-candidate event mutation helpers, generalized Basketball Timeline,
  and reload-safe quick-Undo receipts.

BKE-6C must extend these contracts in place. It must not create a second lineup store, derive minutes
in React components, duplicate projection rules in UI validation, or silently reinterpret existing
lineup events.

## 6. BKE-6C1: Live Substitution Capture

### Command and event work

- Add a pure lineup-sheet model that derives current, bench, ineligible, selected, and resulting
  participant groups from one projected side. React owns only transient selection state.
- Keep `participantId` as the selection and event identity. `playerId`, display name, and number are
  presentation data and never identify a transition.
- Reuse `substituteBasketballLineup` as the checked authority and add a command composer only where
  one user commit must append multiple events. One command gets one timestamp, elapsed value,
  capture-command id, candidate rebuild, and undo boundary.
- Finalize the exact lineup-family payload contracts before the first production substitution,
  role-change, or equal-play-override emitter. Those three families have no shipped user data, so
  C1 updates their registered test-only shapes directly instead of retaining the current reason
  string as a permanent compatibility form. Substitution stores the approved structured reason code
  and bounded note without parsing display strings back into authority.
- Add one explicit exact `recordedLater: true` payload form for each lineup family while retaining
  the ordinary live form without the marker. The already-shipped three-key `lineup_confirmed` form
  must continue to validate exactly; the other three families may move directly to their final
  forms. C1 does not emit historical lineup events, but it locks the payload shape once so C4 does
  not require a second schema transition.
- Derive `balanced`, `exit_only`, `entry_only`, and unequal `mixed` transitions from the previous
  and resulting lineup. `mixed` preserves one atomic dead-ball transition when nonzero exits and
  entries differ instead of recording an intermediate lineup that never played. The UI does not
  choose a contradictory mode. `boundary` and `current_lineup_recovery` remain explicit specialized
  workflows owned by later slices.
- Require a structured reason for every exit-only, entry-only, mixed, current-lineup-recovery, or
  below-five result. A `boundary` transition that leaves a full five needs no reason; its mode and
  adjacent confirmation provide the authority without misclassifying a routine rotation as Other.
- Keep mode validation, reason-code validation, ordered options, and presentation labels on one
  exhaustive typed catalog. Projection retains short-handed reason code and note separately;
  opening-setup free text remains an unclassified note rather than being parsed or relabeled.
- Keep all command guards: initialized healthy anchored stream, active period, paused clock, enabled
  side, unique same-side eligible participants, one through five on court, reason when required, and
  complete final reprojection.

### Tracker workflow

- Add `BasketballLineupSheet` as one focused modal surface shared by tracked and optional opponent
  sides. Use a mobile bottom sheet and constrained desktop dialog without duplicating form state.
- `BasketballClockStrip` opens the sheet from its Users/Bench action only while paused. While the
  clock runs, the action is disabled with an accessible reason; it never pauses implicitly.
- Show Current Five and Bench as stable-height participant rows with selected outgoing/incoming
  states. The resulting-lineup summary remains visible and announces changes through a polite live
  region.
- Show ineligible, ejected, and disqualified participants as unavailable context, not selectable
  inputs. A replacement-required player remains visibly on court until the explicit transition.
- For an unbalanced result, show the approved reason catalog and bounded note. Other and every
  below-five result require the appropriate detail before Commit.
- On success, close the sheet, update `GameContext` once, return focus to the opener, clear the quick
  Undo receipt as required by existing mutation policy, and announce the resulting lineup.
- Opponent controls appear only when `projection.lineup.sides.opponent` exists. BKE-6C does not
  fabricate opponent participants or infer opponent authority.

### BKE-6C1 tests

- pure sheet-model tests for tracked/opponent, current/bench/ineligible, balanced, exit-only,
  entry-only, mixed unequal, one-through-four, zero, duplicate, wrong-side, and more-than-five
  candidates;
- checked command tests for one timestamp/capture group/rebuild, final structured reason payloads,
  exact live/recorded-later forms, and shipped `lineup_confirmed` compatibility;
- replacement-required players remaining active until explicit exit;
- paused-only behavior and no implicit clock event;
- source-contract tests that the clock strip mounts one shared sheet and clockless/Legacy paths do
  not expose it; and
- keyboard focus, Escape/cancel no-mutation, narrow width/height, and live-region smoke.

Implementation record: BKE-6C1 is complete. `lineupSheetModel.ts` derives one stable candidate
model, `BasketballLineupSheet` supplies the shared tracked/opponent surface, and
`substituteBasketballLineup` derives the transition mode, including one atomic unequal mixed
transition, and appends one final structured event. Full-five boundary rotations remain reason-free,
and short-handed reason code/note authority stays structured in projection.
The final lineup-family validators accept exact ordinary and `recordedLater: true` forms while
retaining the shipped three-key confirmation payload. See
[REGRESSION_BKE_6C1_LIVE_SUBSTITUTIONS.md](REGRESSION_BKE_6C1_LIVE_SUBSTITUTIONS.md).

## 7. BKE-6C2: Boundary and Equal-Play Workflow

### Boundary composition

- Replace the BKE-6B same-five-only loop with one side-by-side boundary coordinator. Tracked is
  required when projected; opponent is required only when opponent authority says review is pending.
- Pressing Start with a pending boundary opens review and performs no clock mutation. The strip also
  exposes Review Lineup until all required sides are confirmed.
- Confirm Current Five remains a one-tap path. A changed lineup uses the C1 selection surface and
  commits the boundary substitution plus confirmation as one atomic command group.
- If the confirmed candidate changes before the first Clock Start, projection returns the side to
  review-required exactly as the existing foundation contract specifies.
- Never auto-confirm a side, select a player, or generate a lineup merely because the prior period
  ended or a profile contains equal-play constraints.

### Equal-play behavior

- Evaluate the tracked candidate through `evaluateBasketballEqualPlayCandidate`; UI formatting is a
  pure mapping of projector violation codes and never reimplements constraint math.
- `off` confirms normally. `advisory` shows failed constraints and allows confirmation without an
  override event. `enforced` blocks ordinary confirmation and offers the existing authorized,
  bounded reason path.
- Owner, admin, and scorer tracking authority may record an enforced override; viewers and users who
  cannot track the team never receive mutation controls. Personal local games use the owning
  recorder's existing mutation authority.
- Enforced override and lineup confirmation share one timestamp, elapsed value, capture-command id,
  final candidate rebuild, and Undo boundary.
- The UI explains that evaluation follows the snapshotted policy and is not a universal league
  compliance ruling. It shows violations but does not prescribe a replacement five.

### BKE-6C2 tests

- Start opens review without adding Clock Start when any required side is pending;
- unchanged-five and changed-five tracked/opponent confirmation ordering;
- off/advisory/enforced evaluation for minimum periods, consecutive periods, and imbalance;
- role authorization, missing/blank/oversized override reasons, stale candidate, and atomic
  override-plus-confirmation behavior;
- substitution after confirmation reopens review before first Start; and
- clockless, Legacy, equal-play-off BKE-6B, and optional-opponent compatibility fixtures.

Implementation record: BKE-6C2 is complete. `BasketballBoundaryReviewDialog` coordinates only the
tracked and optional-opponent sides whose projection requires review, while changed candidates reuse
the C1 lineup sheet. `confirmBasketballBoundaryLineup` rejects stale current-five evidence and appends
boundary substitution, authorized enforced override when required, and confirmation in one timestamp,
elapsed value, capture-command group, and final rebuild. Start opens review before calling the clock
command, advisory policy remains nonblocking, and the UI labels snapshotted-policy results without
prescribing a replacement five. The replaced same-five command was removed so override authority and
reason validation have one production command path. See
[REGRESSION_BKE_6C2_BOUNDARY_EQUAL_PLAY.md](REGRESSION_BKE_6C2_BOUNDARY_EQUAL_PLAY.md).

## 8. BKE-6C3: Roles and Current-Lineup Recovery

### Roles and captain

- Extend the shared sheet with an optional Roles section after substitution capture is stable.
  Position controls use PG, SG, SF, PF, C, None, and Custom; the event continues to store the bounded
  resulting string or null.
- Captain is one independent toggle per participant. No uniqueness, on-court-only, or eligibility
  rule is inferred from captain metadata.
- A substitution with role changes appends substitution then `basketball.role_changed` with one
  capture-command id and one final rebuild. A role-only action remains available for a paused side
  and appends only the role event.
- Projection remains the sole owner of current metadata and timestamped role history. Setup values
  remain the first history entry and are never rewritten.

### Recovery and replacement

- Keep Recover Current Lineup visually secondary and require an explicit warning/confirmation.
  It uses `current_lineup_recovery`, a bounded reason, and the current command time.
- The recovery preview lists the current period that will become incomplete and explains that
  earlier uncertain intervals/minutes will not be estimated. Commit starts a new incomplete interval
  at the exact current elapsed value.
- Only the affected current period is marked incomplete. Earlier periods and a complete opponent
  side retain their existing quality.
- Ejected/disqualified on-court participants stay in replacement-required diagnostics until an
  explicit substitution or recovery removes them. Start remains blocked.
- Late participants remain Bench after creation. When the add flow returns to the lineup sheet, the
  new stable participant may be selected through the ordinary substitution path; no automatic entry
  event is appended.
- Entry-only short-handed recovery and exit-only injury/eligibility flows use the C1 reason model and
  remain distinguishable from uncertain-history recovery.

### BKE-6C3 tests

- preset/custom/none position and zero/multiple captain histories;
- substitution-plus-role atomic ordering and role-only capture;
- replacement blocking and explicit replacement transition;
- late participant remains Bench and can enter normally;
- current-lineup recovery marks only the current period incomplete at the command time;
- complete opponent/earlier-period evidence remains complete; and
- refresh, park/resume, Timeline display, and fingerprint behavior preserve all metadata.

Implementation note: `updateBasketballLineup` is the one checked ordinary lineup composer. It appends
an optional substitution before the role event with one command time, elapsed value, capture id,
and final rebuild; role-only changes use the same normalized metadata contract. The shared sheet
offers PG/SG/SF/PF/C/None/Custom plus independent captain toggles for every participant on the side.
Recover Current Lineup is a separate acknowledged mode that may reassert the same five, records a
structured reason, and starts incomplete current-period evidence at the exact command time without
degrading prior periods or the other side. Late additions remain Bench and the add flow returns to
the originating side's lineup sheet. See
[REGRESSION_BKE_6C3_ROLES_AND_RECOVERY.md](REGRESSION_BKE_6C3_ROLES_AND_RECOVERY.md).

## 9. BKE-6C4: Undo, Timeline Correction, and Exit

### Timeline model and detail

- Extend `timeline.ts`, labels, filters, and `BasketballEventDetailDialog` for confirmation,
  substitution, role, override, and current-lineup recovery detail. Removed/revised rows follow the
  existing BKE-3 presentation contract.
- Show period, familiar displayed clock, canonical elapsed `MM:SS`, side, outgoing/incoming/current
  participants, mode/reason, role changes, violation codes, override reason, capture group, revision,
  and completeness consequences as applicable.
- Use one reusable historical time field that translates count-up/count-down display input to
  canonical elapsed milliseconds through the immutable period rules.

### Correction engine

- Add a dedicated `lineupCorrectionCommands.ts` following existing BKE-3 draft -> preview -> apply
  ownership. Drafts retain stable event ids and participant ids; UI does not construct mutations.
- Preview uses the current stream fingerprint/revisions, applies all required appends/mutations to
  one candidate, reprojects once, and returns structured consequence lines plus before/after
  participation and quality summaries.
- Edit may change resulting lineup, mode/reason, effective period time, role values, boundary
  candidate, or override reason within the event family's authority. It may not move events across
  lifecycle boundaries, change sport/side/recorder identity, or rewrite setup.
- C4 adds all four lineup families to the explicit recorded-later clock contract. A marked
  historical correction may target a started current period at or before its authoritative
  watermark or a completed period within segment bounds; an unmarked live lineup event still
  requires the active paused period.
- Accepting the marker is not enough: add a deterministic lineup-history replay path that applies
  marked historical lineup effects at their effective period/elapsed position and then re-derives
  later lineups, role history, intervals, boundary state, equal-play state, and completeness. The
  generic event stream and non-lineup projection retain recorder capture order; a late sequence may
  never cause a backdated substitution to mutate only the present lineup.
- Removal/restoration includes every event in the user capture group when separating the group would
  leave false authority. Dependency-aware cleanup may repair exact stale links, but it never deletes
  unrelated later events merely to force validity.
- Apply rejects stale previews, changed revisions, invalid relationships, incomplete final
  projection where the edit did not explicitly create current-lineup recovery quality, and every
  impossible interval/lineup/equal-play result.
- Successful Timeline correction clears the quick-Undo receipt and preserves existing local-only,
  nonterminal correction policy. BKE-6D owns cloud/reopened correction modes.

### Recent Events and diagnostics

- Group rows by capture-command id and label the user action, not each implementation event.
  Substitution plus roles and override plus confirmation therefore produce one newest-first row.
- Quick Undo remains newest dependency-free only. If later events depend on a group, Recent Events
  sends the recorder to Timeline rather than attempting partial removal.
- A reload-safe restore receipt stores only the exact validated group/revisions allowed by existing
  policy. Restore rechecks the candidate before applying.
- Invalid streams retain last coherent display context but disable Clock Start and new lineup
  capture. Diagnostics distinguish missing confirmation, duplicate/wrong-side/ineligible/oversized
  lineup, unresolved replacement, impossible transition, invalid role target, stale override, and
  deliberately incomplete current-lineup recovery.

### BKE-6C4 exit tests

- grouped Undo/Restore for substitution plus roles and override plus confirmation;
- dependency boundary routing to Timeline;
- edit/remove/restore with stale preview, later valid history, invalid final candidate, and exact
  one-rebuild assertions;
- count-up/count-down historical time conversion and segment bounds;
- recorded-later exact-key round trips, current-watermark/completed-period acceptance, unmarked
  historical rejection, deterministic same-moment ordering, and no present-only lineup mutation;
- backdated known-time substitutions across later substitutions, period boundaries, role changes,
  confirmations, and equal-play overrides with exact interval/minute consequences;
- interval/minute before/after consequences, incomplete recovery, and replacement diagnostics;
- terminal/local-only mutation policy and quick-Undo receipt clearing;
- full hydration/reprojection, parking/import/export, and mixed-sport compatibility suites; and
- phone/tablet/desktop, narrow-height, keyboard/focus, screen-reader announcements, reduced motion,
  and no-overlap visual smoke.

## 10. Cross-Slice Engineering Rules

- Every live command captures `occurredAt` once and resolves canonical elapsed once. Multi-event
  commands share both values and one capture-command id.
- Use `addGameEvents` or `applyGameEventAppendsAndMutations` for one final candidate rebuild. Never
  dispatch a sequence of individually committed events from a component.
- Components receive projected models and checked command results. They do not mutate events,
  calculate authoritative intervals, or infer eligibility.
- Stable participant ids survive edits, merge resolution, parking, and future cloud transport.
- Persisted event ordering remains recorder sequence then event id; array order is not authority.
- Accessibility includes focus trap/return, semantic grouped selection, visible and announced error
  state, 44px primary targets, scroll containment, and no dynamic layout shift in the clock strip.
- No Supabase migration is expected. If implementation discovers a genuine server contract need,
  stop that slice and amend the plan rather than smuggling cloud scope into BKE-6C.

## 11. Compatibility and Deferrals

BKE-6C must not:

- initialize or infer lineups for Legacy or clockless Event games;
- infer missed historical substitutions, starters, roles, or minutes;
- combine manual-minute events with anchored interval-derived participation;
- require opponent lineup authority or suppress complete tracked minutes because opponent is absent;
- enable anchored cloud binding, sync, recorder readiness, finalization, or publication;
- expand Summary/aggregate output beyond the minimum diagnostic context needed to verify local
  projection; or
- implement shot clock, possession, automated lineup scheduling, or a broad tracker reskin.

BKE-6D owns full Players/Overview/Timeline remote detail, exact-second canonical aggregates,
plus-minus quality destinations, both capability preflights, anchored cloud lifecycle,
finalization, correction/resume reopen, and republication. BKE-6E owns release-entry audit and the
broader manual matrix.

## 12. Documentation and Completion

Each implementation slice updates this plan, the parent roadmap, README checklist, AGENTS runtime
summary, and a slice-specific regression record. A slice may be marked complete only when:

- focused and full automated gates pass;
- no unexpected migration or authority widening is introduced;
- manual checks are recorded as Pass, Fail, Blocked, or Not run rather than implied;
- accepted PR findings are fixed in-scope or explicitly assigned to a later named slice; and
- the next slice can begin from a clean merged `stattracker` branch without undocumented decisions.
