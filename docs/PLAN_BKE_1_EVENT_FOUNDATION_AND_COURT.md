# Plan: BKE-1 Basketball Event Foundation and Court

Parent plan for the first Basketball event-model implementation program. BKE-1 extracts the
remaining sport-neutral seams, installs a deterministic Basketball event foundation, and then
moves the existing court workflow onto that foundation behind an internal-only gate.

Status: In progress. BKE-1A and all BKE-1B slices are complete. The detailed BKE-1C plan is
approved and split into BKE-1C1 through BKE-1C3; BKE-1C1 is next.

Architecture: [PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md](PLAN_BKE_0_BASKETBALL_EVENT_ARCHITECTURE.md)

---

## 1. Goal

BKE-1 exits when an internally created Basketball event game can capture the existing court flow
through one authoritative event stream while preserving Soccer and every legacy Basketball game.

The program must prove three things independently:

1. the shared engine can host more than one sport without changing Soccer behavior;
2. Basketball events deterministically rebuild setup, participants, scores, stats, and shots; and
3. the existing court gestures, prompts, filters, undo, and clear behavior retain approved parity.

No BKE-1 phase exposes event-game creation to normal users or connects Basketball events to the
cloud lifecycle.

## 2. Phase Map

| Phase | Scope | Exit condition |
|---|---|---|
| BKE-1A | Sport-neutral state extraction, definition-scoped neutral sides, atomic multi-event mutation | Soccer behavior is unchanged and the generic capabilities are independently tested |
| BKE-1B | Basketball setup, participants, immutable rules snapshot, definitions, projector, parity fixtures. **Splits into BKE-1B1-1B3** | Internal fixture games rebuild deterministic Basketball state without a live UI cutover |
| BKE-1C | Court shots, assists, rebounds, recent-event undo/restore, clear chart, filters, and popup parity | Existing court workflows round-trip through Basketball events behind the internal gate |

Detailed plans:

- [PLAN_BKE_1A_SHARED_EVENT_ENGINE.md](PLAN_BKE_1A_SHARED_EVENT_ENGINE.md)
- [PLAN_BKE_1B_BASKETBALL_EVENT_FOUNDATION.md](PLAN_BKE_1B_BASKETBALL_EVENT_FOUNDATION.md)
- [PLAN_BKE_1C_COURT_EVENTS.md](PLAN_BKE_1C_COURT_EVENTS.md)

## 3. Program Guardrails

- Existing unmarked Basketball games remain legacy aggregate games. Event-game creation must stamp
  the top-level `gameDataAuthority: 'sport_events'` marker before game information can enter
  aggregate sync, independently of the nested stream/setup payloads.
- Existing and in-progress games never convert to events.
- Event-backed Basketball games remain internal-only through BKE-4E. The user opt-in belongs to
  BKE-5 after capture, cloud, Summary, aggregates, capabilities, and settings are complete.
- One user action has one source of truth. Compatibility counters and shot rows are projections,
  never a second write path.
- Soccer event payloads and product rules remain Soccer-owned.
- Basketball owns its participants, rules, payload validation, relationships, and projection.
- `elapsedMs` remains `null` through BKE-5. BKE-6 owns the Basketball clock and lineups.
- BKE-1 adds no Supabase migration and does not wire Basketball events into automatic cloud sync.
- BKE-1B registers neutral Basketball definitions for local fixtures, but those events cannot enter
  cloud transport before BKE-4A widens the database constraint and proves Soccer RPC parity.
- Cloud authority fails closed: `gameDataAuthority: 'sport_events'` always denies aggregate sync.
  If its stream or sport-owned snapshot fails normalization, hydration quarantines the game and
  exposes recovery diagnostics; it never silently reclassifies the game as legacy.
- Projection diagnostics fail closed. Incomplete streams cannot present authoritative totals or
  pass release gates.

## 4. Compatibility Contract

BKE-1 must preserve:

- aggregate-only Basketball tracking and sync;
- historical cloud game review and corrections;
- local parking, resume, import/export, quota, and cross-sport behavior;
- Soccer setup, tracking, correction, sync, summary, finalization, aggregates, settings, and release;
- current Basketball court geometry, player switching, prompts, stat line, and shot filters until
  BKE-1C deliberately changes their data source; and
- current production route availability.

The reducer's legacy-action no-op behavior when `eventStream !== null` remains unchanged. That
all-or-nothing gate is why BKE-1B fixtures cannot become a user-facing game mode and BKE-1C remains
internal even after court capture works.

## 5. Proof Strategy

### BKE-1A

- Focused shared-engine unit tests.
- Existing Soccer event, parking, fingerprint, cloud, and release tests.
- Full test, lint, and production build.

### BKE-1B

- Pure Basketball setup, validation, event-definition, and projector tests.
- Named legacy-reducer equivalence fixtures for every event family in scope.
- Parking/import/fingerprint round trips for both legacy and event games.

### BKE-1C

- Court capture parity fixtures for made/missed shots, value override, player switch, optional
  assist/rebound links, grouped undo/restore, and clear chart.
- Atomic batches require a complete final projection, unlike the permissive single-event revision
  helpers. BKE-1C must not replace a single helper with a one-item batch without handling that
  stricter contract explicitly.
- Individual, team, and All shot filters.
- Mobile interaction regression for the popup and inline court.

Intentional product changes receive named expectations. They are not hidden as parity exceptions.

## 6. Delivery Sequence

1. Implement and merge BKE-1A.
2. Audit the resulting engine API and write the detailed BKE-1B plan.
3. Implement and merge BKE-1B with no live Basketball cutover. **Complete.**
4. Audit the Basketball projector and write the detailed BKE-1C plan. **Complete.**
5. Implement BKE-1C1 through BKE-1C3 behind a development/internal creation gate.
6. Keep the gate closed and proceed to BKE-2 complete live capture.

Each child phase gets its own feature branch and PR. Documentation status and regression notes are
updated in the same PR as the implementation they describe.
