# Regression: BKE-6A2 Anchored Clock Projection

Status: Implemented and automated. BKE-6A3 remains before the no-UI foundation is complete.

## Delivered

- Registered exact neutral `clock_started`, `clock_paused`, `clock_adjusted`, and `stoppage`
  event contracts without changing Basketball event or stream schema versions.
- Added nullable anchored clock projection for rules-v3 anchored setup. Existing version-1/version-2
  and rules-v3 clockless histories retain a null clock and require null event elapsed values.
- Derived running elapsed from the persisted start event `occurredAt`, capped canonical elapsed at
  period duration, and rejected backward timestamps, non-monotonic elapsed within one running
  interval, stale values, period mismatches, duplicate transitions, and unmaterialized expiration
  at the last coherent event. Intentional backward changes remain explicit reasoned adjustments.
- Made Pause source authoritative: manual and period-end pauses apply only below duration;
  expiration applies only at or beyond duration and stores the exact duration.
- Added atomic checked Start, Pause with optional linked stoppage, and Set Clock commands. Set Clock
  first pauses a running interval in the same capture group and requires a bounded reason.
- Added pure count-up/countdown display derivation. An injected time before the running anchor clamps
  for display and reports a warning but never changes persisted state or materializes expiration.
- Widened existing Basketball event factories and definitions to admit nonnegative elapsed values;
  projection remains the setup-aware authority that rejects those values in clockless histories.

## Automated Evidence

`src/lib/basketball/clockProjection.test.ts` covers explicit Start/Pause anchors, multiple running
intervals, atomic stoppage relationships, running Set Clock, authoritative expiration and source
rejection, duplicate pause rejection, backward replay versus display clamp behavior, both display
directions, exact payload validation, and clockless rejection.

Repository verification at implementation:

```text
pnpm test       170 files, 1171 tests passed
pnpm typecheck  passed
```

Build and lint are part of the final branch verification.

## Deferred Intentionally

- No scheduler, sticky tracker controls, alert behavior, production setup path, or device toggle.
- No lineup-start guards, substitutions, roles, equal-play projection, or participation intervals;
  those are BKE-6A3.
- No Timeline correction UI, cloud feature preflight call site, or release-stage change.
- Period-end command integration may atomically append its `period_end` Pause when BKE-6B wires the
  production clock controls; replay already requires the persisted Pause and never infers one.
