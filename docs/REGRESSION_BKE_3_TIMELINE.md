# Regression: BKE-3 Basketball Timeline

## Scope

BKE-3A through BKE-3C provide local event review, shared shot detail and editing, arbitrary removal,
persisted capture-group removal, conservative restoration, atomic relationship correction, and
recorded-later field-goal additions. Basketball event cloud transport remains off.

## Automated Coverage

- `src/lib/basketball/timeline.test.ts` covers review grouping, filters, diagnostics, ordinals,
  relationship detail, legacy detail, and deterministic overlapping-marker activation.
- `src/lib/basketball/timelineCorrections.test.ts` covers shot/dependent and capture-group removal,
  default source-only restore, optional compatible-dependent restore, stale preview rejection,
  turnover/steal unlinking, foul/trip unlinking, lifecycle boundaries, projection effects, and
  quick-Undo receipt invalidation. Stale-preview rejection is library-level/unit-only because an
  open React dialog re-derives its preview whenever authoritative state changes.
- `src/lib/basketball/shotEditCommands.test.ts` covers made/missed and 2PT/3PT transitions,
  locate/unlocate behavior, stale-link cleanup, atomic relationship append/re-link/restore, free-throw
  constraints, stale draft rejection, and recorded-later field-goal additions.
- `src/lib/gameEvents/gameEvents.test.ts` covers the append-plus-mutate final candidate, one rebuild,
  and pre-projection duplicate id/recorder-sequence rejection.
- The full Vitest suite, TypeScript production build, and ESLint remain required for every slice.

## Manual Matrix

1. In an event Basketball game, record a made shot with an assist. Open Timeline, remove only the
   assist, and confirm score and shot remain.
2. Remove the shot. Confirm the preview names the score/stat changes and linked assist removal.
3. Expand Removed events. Restore the shot without selecting the assist, then repeat and opt in to
   restoring the assist. Confirm the two outcomes differ as previewed.
4. Remove an entire multi-event capture from its expanded Timeline group. Confirm every active
   member sharing the command id is removed atomically.
5. Remove a turnover linked to a steal, a foul linked to a free-throw trip, and a trip with recorded
   attempts. Confirm surviving facts retain totals but lose invalid source links.
6. Open a located shot from the court marker and remove it through the shared detail surface. Confirm
   no extra capture occurs and the marker disappears.
7. Confirm lifecycle/identity rows have no correction action, unhealthy streams remain review-only,
   and terminal games require Reopen before correction.
8. Create a quick-Undo restore opportunity, then apply a Timeline correction. Confirm the old quick
   restore is no longer available. Park/reload and verify current revisions and tombstones persist.
9. Open the same active shot from a court marker and Timeline detail. Edit shooter/side, result, and
   value; confirm both entry points use the same confirmation and the saved row/marker highlights.
10. Move a located field goal, deliberately override its geometry-derived value, remove its location,
    and locate an unlocated field goal. Confirm value source, zone, marker, score, and totals agree.
11. Add, remove, re-link, and explicitly restore valid assist/rebound/block relationships. Change the
    shot so a surviving link becomes invalid and confirm it remains a standalone stat as previewed.
12. Add a field goal to a previously started period with an optional relationship. Confirm it uses
    current append order, displays `Recorded later`, retains the selected period, and saves atomically.
13. Attempt an invalid free-throw location, incompatible relationship, and stale-draft save. Confirm
    every failure leaves the full stream, projected score/stats, and quick-Undo receipt unchanged.
