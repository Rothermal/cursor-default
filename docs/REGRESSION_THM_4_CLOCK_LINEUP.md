# THM-4 Clock and Lineup Verification

## Scope

BasketballClockStrip, BasketballLineupSheet, BasketballBoundaryReviewDialog,
BasketballLifecycleControls, and BasketballEventBonusPanel use semantic colors.
This includes clock forms, running/paused actions, lineup selection and roles,
boundary review, warnings/errors, disabled controls, and foul/bonus badges.
Dialog overlays remain translucent. Long result/boundary player chips and bonus
labels are bounded; bonus rows may wrap rather than overflow the viewport.

No clock, event, substitution, equal-play, lifecycle, or permission logic changed.
No migration. Production Dark remains gated. The GameTracker host and its other
children, legacy controls, court/corrections, Timeline, and Summary remain outside
this batch; this is not a THM-4 completion or release signoff.

## Verification

- Appearance inventory covers all five components. Targeted guards cover
  standalone disabled fill/text, translucent overlays, and unique long-label
  elements in bonus/results/boundary review.
- Isolated actual-component Edge fixture used a local event game built through
  the existing Basketball setup/projector with five starters, a bench player,
  and a DNP per side. No auth, cloud, or persisted owner game was involved.
- 390px and 1280px, Light and Dark: paused clock; invalid Set Clock reason;
  running clock with Suspend disabled; lineup entry; balanced outgoing/incoming
  selection with Commit enabled; expanded roles; two-side boundary review.
  All 28 state/viewport/theme checks passed without page errors or document
  overflow. Escape closed the dialogs. Clock start/pause used real commands;
  substitution selection was staged, not committed.
- Mobile Dark paused/lineup and Light boundary screenshots were inspected.
  The initial opaque-overlay issue was corrected and the complete browser pass
  repeated. Temporary fixtures/screenshots were removed.

## Release Follow-up

Still verify real tracker composition, lifecycle end/start/overtime/final/reopen
branches, clock expiration/recovery, stoppage submission, substitution commits,
role saves, replacement-required cases, equal-play advisory/enforced overrides,
boundary confirm/change, and keyboard/PWA/offline behavior in the release matrix.
These are not all exercised by the focused presentation fixture above.

Full automated suite, build, and lint results are recorded in the PR.
