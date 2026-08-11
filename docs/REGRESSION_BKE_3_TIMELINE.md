# Regression: BKE-3 Basketball Timeline

## Scope

BKE-3A and BKE-3B provide local event review, shared shot detail, arbitrary removal, persisted
capture-group removal, and conservative restoration. Basketball event cloud transport remains off.

## Automated Coverage

- `src/lib/basketball/timeline.test.ts` covers review grouping, filters, diagnostics, ordinals,
  relationship detail, legacy detail, and deterministic overlapping-marker activation.
- `src/lib/basketball/timelineCorrections.test.ts` covers shot/dependent and capture-group removal,
  default source-only restore, optional compatible-dependent restore, stale preview rejection,
  turnover/steal unlinking, foul/trip unlinking, lifecycle boundaries, projection effects, and
  quick-Undo receipt invalidation. Stale-preview rejection is library-level/unit-only because an
  open React dialog re-derives its preview whenever authoritative state changes.
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
