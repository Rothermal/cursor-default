# Plan: BKE-4 Event Cloud Cutover

Status: Approved implementation plan. BKE-4A is implemented through migration 055; BKE-4B1 adds
migration 056 and the shared transport adapter; and BKE-4B2 automatic Basketball sync is
implemented. BKE-4B3 recovery and conflicts are next under
[`PLAN_BKE_4B_BASKETBALL_TRANSPORT.md`](PLAN_BKE_4B_BASKETBALL_TRANSPORT.md).
Basketball event-game creation remains internal-only through BKE-4E.

## 1. Goal

Move event-backed Basketball games from a complete local model to the same durable cloud standard
proved by Soccer without forking the event platform or weakening legacy-game compatibility.

BKE-4 generalizes the Soccer-built backend, adds Basketball transport and recorder authority,
introduces one authority-aware Basketball Summary, moves Basketball aggregates to canonical
publications, and finishes the backend capability contract needed for rollout. It does not expose
the event-game opt-in; BKE-5 owns settings and user-visible rollout.

## 2. Non-Negotiable Invariants

- Existing Soccer RPC names, parameter signatures, response shapes, permissions, and client call
  sites remain valid throughout the migration.
- Soccer definitions continue to reject `neutral`; only event definitions that explicitly opt in
  may use the widened cloud value.
- Event-backed Basketball games never enter legacy aggregate snapshot synchronization.
- Legacy Basketball games remain readable and writable through their existing aggregate path.
- Recorder streams remain isolated. No phase blends independent recorders into one projection.
- Canonical publication is derived from one locked primary stream and immutable setup/participant
  snapshots.
- Remote primary, alternate-recorder, and canonical sources are read-only. Editing requires an
  owned editable local binding.
- Incomplete or unsupported event sources fail closed and cannot present official totals,
  finalize, or contribute aggregates.
- Existing-record access is independent from new-game availability and device preferences.
- No silent fallback changes a requested event-backed game into a legacy game.

## 3. Delivery Phases

| Phase | Purpose | Exit condition |
|---|---|---|
| BKE-4A | Extract a sport-neutral SQL/RPC platform while retaining Soccer wrappers | Every current Soccer client call and tested database contract remains unchanged; `neutral` and the Soccer/Basketball publication allow-list are available, but no Basketball client transport exists |
| BKE-4B | Add Basketball binding, revision transport, pull-before-upload recovery, conflicts, and offline retry | An internally gated Basketball event game binds idempotently, round-trips its recorder stream, remains locally authoritative through failures, and fails closed if finalization is attempted before BKE-4C |
| BKE-4C | Add Basketball recorder presence, primary selection, finalization, reopen, and finalized correction integration | A healthy primary stream finalizes transactionally; reopen is audited; independent streams remain isolated |
| BKE-4D | Build one explicit-authority Basketball Summary | Local, cloud-primary, alternate-recorder, and canonical sources route through one fail-closed read model; only an owned local source is editable |
| BKE-4E | Add canonical Basketball aggregate readers, compatibility retirement rules, capability negotiation, and release evidence | All aggregate destinations agree on canonical publications and the backend can safely negotiate new event-game creation; the internal creation gate remains closed |

## 4. Authority Progression

1. During capture, the owned local event stream is authoritative and cloud rows mirror accepted
   revisions.
2. A server-verified recorder checkpoint proves the cloud holds the recorder's exact active and
   removed revision set.
3. Owners/admins select one healthy recorder as provisional primary; selection locks only during
   finalization.
4. Finalization verifies immutable setup, participants, event revisions, terminal state, and
   sport-specific score semantics in one transaction.
5. The active canonical publication becomes final review and aggregate authority.
6. Reopen invalidates the active publication, records a reason, unlocks the primary, and requires
   a later explicit finalization to publish again.

## 5. Compatibility Boundaries

### Soccer

The app continues calling the existing `*_soccer_*` RPCs. BKE-4A turns those functions into thin
wrappers over internal sport-neutral cores. Later Basketball phases consume the neutral layer;
Soccer client code does not migrate merely to prove the extraction.

### Legacy Basketball

Games without `gameDataAuthority: 'sport_events'` continue using `game_stats`, `shot_chart`, legacy
summary readers, and aggregate RPCs. They are not backfilled into event history and do not acquire
canonical event publications.

### Event Basketball

Event-backed creation remains behind the existing internal gate through BKE-4E. BKE-4 transport
may adopt healthy internally created local games without changing event ids, revisions, participant
ids, or the immutable setup snapshot. A BKE-4B cloud binding creates the event setup snapshot that
activates canonical final-state enforcement. Until BKE-4C adds trusted Basketball terminal and
score policy plus the authenticated finalization wrapper, those games must reject both direct final
status writes and finalization attempts. BKE-4B regression evidence treats that state as intentional
fail-closed behavior, not a transport defect.

## 6. Migration Sequence

BKE-4 migrations are forward-only and run after `049_soccer_release_capabilities.sql`. Function
extraction preserves existing entry points; widened checks use staged replacement rather than a
single drop/add validation scan.

| Phase | Planned migration range | Notes |
|---|---|---|
| BKE-4A | 050-055 | Neutral platform extraction in four Soccer-parity slices; two constraint swaps use separate add and validate/remove migrations |
| BKE-4B | 056+ | Basketball binding, transport, recovery, and conflict contracts |
| BKE-4C | Following 4B | Basketball recorder/finalization contracts and audit integration |
| BKE-4D | None expected | Prefer client-only Summary work unless a narrow authority read RPC is required; never infer authority from legacy rows |
| BKE-4E | Following 4C | Canonical Basketball aggregate pages and capability version |

Every migration receives a static contract test in the repository. Database-runtime behavior must
also be exercised against a Supabase test or deployed project because Vitest does not execute
PostgreSQL, RLS, triggers, or security-definer privileges.

## 7. Shared Verification Gates

Each phase must run:

- the full Vitest suite, production build, and ESLint;
- migration contract tests and SQL diff review for grants, revokes, `search_path`, RLS, trigger
  replacement, check-constraint swaps, validation scans, and lock duration;
- legacy Basketball aggregate-sync regression tests;
- Soccer transport/finalization/summary/aggregate tests appropriate to the changed boundary;
- event projection determinism and malformed-stream fail-closed tests; and
- a documented manual Supabase matrix for operations that cannot be proved by static SQL tests.

BKE-4E adds the final multi-device, multi-recorder, offline, finalization/reopen, Summary-authority,
aggregate, and stale-capability release matrix.

## 8. Reviewed Direction

The following decisions are inherited from the approved BKE-0 architecture and do not need to be
reopened for each implementation slice:

1. Generalize the existing event backend in place; do not create a parallel Basketball schema.
2. Keep Soccer-named RPCs as compatibility wrappers and leave Soccer clients untouched.
3. Use an explicit event-capable sport allow-list containing `soccer` and `basketball`.
4. Widen `game_events.team_side` to `tracked | opponent | neutral`; sport definitions remain the
   semantic authority.
5. Use canonical publications, not `stat_corrections`, for event-game final authority.
6. Require reasoned reopen before correcting a finalized event game.
7. Keep event-game creation internal through BKE-4E; ship user opt-in only with BKE-5.
8. Preserve explicit local-only and legacy fallback choices; never downgrade silently.

## 9. Deferred

- Basketball settings hierarchy, rules profiles, and visible opt-in: BKE-5.
- Anchored clock, stoppages, substitutions, and lineup intervals: BKE-6.
- Historical Basketball event backfill.
- Live collaborative editing or automatic recorder-stream merging.
- Possession-derived advanced metrics without complete source coverage.

## 10. Next Step

Before beginning BKE-4B1, apply migrations 054 and 055 separately and in order, then record the
remaining BKE-4A Soccer runtime parity in `REGRESSION_BKE_4A_PLATFORM.md`. After that gate is green,
implement BKE-4B1 from
[`PLAN_BKE_4B_BASKETBALL_TRANSPORT.md`](PLAN_BKE_4B_BASKETBALL_TRANSPORT.md): add the narrow
Basketball binding wrapper, extract the shared client transport, and prove Soccer parity before
routing live Basketball synchronization.
