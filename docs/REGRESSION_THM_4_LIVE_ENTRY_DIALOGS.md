# THM-4 Live-entry Dialog Verification

## Scope

Eight Basketball dialogs: Reopen, Timeout, Ejection, LateParticipant,
ScoreCorrection, StealTurnover, Foul, and FreeThrowTrip. Semantic tokens cover
surfaces, borders, labels, selection, errors, warnings, and disabled states.
Made/Miss retain distinct success/danger colors plus their existing icons and
labels. Overlays preserve 40-percent opacity, and close controls retain fixed
dimensions. No submission, eligibility, event, rule, or permission logic changed.

No migration. Production Dark remains gated. The live tracker host, court,
legacy controls, remaining recorder/recovery surfaces, Timeline/historical
editors, and Summary still need their remaining THM-4 work.

## Evidence

- Appearance guards inventory all eight dialogs, uniquely select each close
  control and overlay, reject faded disabled styles, and pin the free-throw
  outcome buttons' semantic and disabled fill/text.
- Actual-component Edge fixtures used synthetic candidate/inventory/trip props
  and callback spies, without GameContext, auth, saved games, or cloud writes.
- Final pass: 40 cases across 390px/1280px widths and Light/Dark at 640px height.
  All dialogs, plus empty-player and closed free-throw variants, fit the viewport
  without document overflow or page errors. An earlier 800px-height pass also
  completed; the final pass corrected synthetic timeout cap/used property names.
- Checked reasoned reopen, neutral timeout after verifying charged exhaustion,
  staff ejection, late-player entry, signed score correction, unknown turnover
  actor, advanced foul override, and Made callback. These submitted only to
  fixture callbacks. Empty/closed trip Made controls stayed disabled; Escape
  dismissed every dialog. Synthetic inline errors were shown throughout.
- Inspected mobile Dark free-throw and Light expanded-foul screenshots.
  Temporary fixtures and screenshots were removed.

## Release Follow-up

Verify real tracker integration and persisted event results, charged timeout
variants, player/staff foul links, all free-throw outcomes and one-and-one
closure, actual server errors, keyboard traversal, virtual-keyboard resizing,
and PWA/offline behavior. The fixture is presentation/callback evidence, not
full live gameplay or release signoff. Automated suite/build/lint results are
recorded in the PR.
