# SOC-S24D grouped lineup history

Implementation is complete. Deployed owner regression remains pending; no new
migration is needed beyond the already-applied 069.

## Automated and local checks

- Final PR #384 validation: 201 files / 1,436 tests pass. Production build
  includes TypeScript; lint has zero errors and three existing warnings.
- Review hardening verifies one projection pass for active and removed lineup
  details, shared custom-role label diffs, defensive removed-row filtering,
  and callback isolation from replay state. Locked controls remain visible
  but disabled, including during apply; correction headers use period labels.
- Shared live/Summary Lineup filters include the one-event transition. Review
  derives entrants, exits, and retained-player role changes from preceding
  capture history, with source, time, halftime, and revision context.
- The historical manager starts from the recorded target and preceding
  participants/roles/rules. Reset restores that recorded target. The checked
  correction command re-derives halftime and validates all later history.
- Reload round-trip and historical correction tests confirm one event remains
  one revision unit. S24B coverage continues to check dependent removal,
  restoration, stale drafts, and interval/count semantics.
- One-off Playwright verification with a temporary real-component fixture:
  320px, 390px, and 1280px; historical role correction, removal, and restoration
  increment the same event through revisions 2/3/4. No horizontal overflow.
  Screenshot review found and corrected inherited Timeline spacing on the modal.
  The temporary harness is not a committed runnable suite.

## Deployed owner matrix

1. Create a lineup transition while paused, review its one Lineup row in live
   Timeline, then open local Summary and select Lineup.
2. Edit that row, change a role, and save. Verify the original time and one row
   remain, revision increases, and minutes/substitution counters still agree.
3. Remove and restore it. If a later shot depends on the entering player,
   removal must fail without changing history.
4. Park/resume and reload; verify the same target, source, roles, and revision.
5. Sync, inspect cloud-primary and alternate-recorder summaries, and verify
   remote review has no editing controls. Finalize, inspect canonical Summary,
   reopen through the authorized flow, and repeat correction/sync/publication.
6. Export/import recovery and verify the one-event target survives. Exercise a
   real competing edit and resolve it through the existing conflict workflow.
7. Test installed PWA update, offline resume, keyboard focus/Tab/Escape, reduced
   motion, and the existing light theme. Dark mode remains a separate plan.
8. Open an older game: legacy substitution/role rows keep their existing editor;
   no frozen Team Default is fabricated.

## Cross-sport boundary

The reusable interaction is a two-column desired lineup, immutable match
presets, independent role controls, review, and explicit Apply. Soccer's event
payload, goalkeeper requirement, return policy, halftime/window counting, and
interval projection stay Soccer-owned. Basketball's boundary/equal-play rules
need a separate adaptation; do not route other sports through this component.
