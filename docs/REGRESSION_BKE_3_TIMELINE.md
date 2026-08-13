# Regression: BKE-3 Basketball Timeline

## Scope

BKE-3A through BKE-3D4 provide local event review, shared shot detail and editing, arbitrary removal,
persisted capture-group removal, conservative restoration, atomic shot and related-stat relationship
correction, value-event correction, structured foul/free-throw correction, and recorded-later additions
through every user-recorded family. The BKE-3 exit audit is complete. Basketball event cloud transport
remains off.

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
- `src/lib/basketball/relatedEventEditCommands.test.ts` covers rebound attribution/link revision,
  reverse turnover-to-steal relinking, paired historical Steal + Turnover capture, capture-order-safe
  forward-link rejection, capture-group removal after relinking, cross-period compatibility,
  recorded-later projection, stale drafts, and atomic apply behavior.
- `src/lib/basketball/shotEditCommands.test.ts` also proves new links stay period-local while an
  already-stored cross-period link remains visible and survives unrelated shot edits.
- `src/lib/basketball/valueEventEditCommands.test.ts` covers score/minutes correction and addition,
  signed input constraints, non-negative totals, started-period replay, stale previews, anchored-clock
  exclusion, unresolved participants, and narrow legacy negative-score recovery.
- `src/lib/basketball/foulFreeThrowEditCommands.test.ts` covers foul dependent-link repair, award
  shrinking without attempt renumbering, shooter/result/position correction, one-and-one downstream
  repair, consumed-position rejection, linked recorded-later foul/award addition, standalone award and
  grouped-attempt addition, stale previews, and cloud rejection.
- `src/lib/basketball/administrationEditCommands.test.ts` covers player/staff and official/automatic
  ejections, foul-link compatibility, charged/neutral timeout edits and additions, selected-period
  inventory, prior-period replay, unresolved subjects, stale previews, and cloud rejection.
- `src/lib/basketball/bke2Parity.test.ts` proves a mixed lifecycle/capture history rebuilds exactly and
  that its timeout and ejection facts open through the final D4 editor command surface.
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
14. Open assist, rebound, steal, block, and turnover rows through their shared detail sheet. Edit
    actor/side and family fields, then confirm incompatible relationships clear and totals reproject.
15. Relink an existing turnover from one later steal to another. Confirm the former steal remains a
    standalone total and the selected steal points to the turnover after one atomic Save.
16. Use Add Event for every D1 family, including unknown/team attribution and a paired Steal +
    Turnover in an earlier started period. Confirm the pair groups together and shows Recorded later.
17. Edit every structured foul field, including staff/team/player attribution and a reasoned counting
    override. Confirm incompatible trip/ejection links are repaired exactly as previewed.
18. Shrink and expand a free-throw award with active and removed attempts. Confirm out-of-range facts
    become ungrouped, tombstoned positions remain consumed, and no remaining attempt renumbers.
19. Edit a grouped attempt's shooter, result, trip, and position. Confirm duplicate positions reject;
    changing a one-and-one first attempt to Miss ungroups an existing second attempt atomically.
20. Add a foul with a linked award, a standalone award, and grouped/ungrouped attempts to a prior
    started period. Confirm append ordering, Recorded later labels, bonus validation, score, and fouls.
21. Open player and staff ejections from Timeline. Edit side, subject, reason, source, and compatible
    foul link; confirm stale or later foul links and duplicate surviving ejections reject atomically.
22. Add an official staff ejection and an automatic-threshold player ejection to a started period.
    Confirm automatic capture rejects unless the player is disqualified at the event's append point.
23. Edit a charged timeout between Full and 30-second while its side is at capacity. Confirm the edit
    does not count its existing slot twice, but an additional charged timeout rejects.
24. Add charged timeouts to both sides in regulation and overtime, including a prior started period.
    Confirm each period uses its immutable regulation/overtime cap and totals do not cross periods.
25. Add Media and Official neutral timeouts with labels. Confirm they remain attributed to game
    administration, consume no team inventory, and remain separate in detail and Timeline filters.
26. Repeat D4 edit/add from period break, terminal, cloud-bound, and diagnostic states. Confirm only
    the open healthy local state succeeds and a reasoned Reopen is required after terminal lifecycle.

## Exit Audit

- Every visible user-recorded Basketball event family has checked edit, remove/restore, and historical
  addition ownership. Lifecycle, roster, and participant-resolution events remain read-only boundaries.
- Healthy event-game correction uses the event stream and final deterministic projection, not
  `actionLog`, aggregate reducer actions, or `ShotRecord` as authority.
- Timeline mutation clears quick Undo; stale preview fingerprints and changed consequence sets reject.
- Local/internal and cloud-bound/legacy authority boundaries remain fail closed. BKE-4A is the next
  roadmap phase.
