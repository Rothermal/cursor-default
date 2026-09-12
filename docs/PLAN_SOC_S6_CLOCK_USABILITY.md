# S6 - Soccer Clock Usability

Status: implemented; deployed mobile verification pending.

## Scope

- Fresh local matches and independent recorder streams establish Opening Lineup
  and Period 1 at zero with the clock paused. Start is an explicit recorder action.
- No participation time accrues while waiting for Start.
- Clock correction uses separate numeric Minutes and Seconds fields, retaining
  cumulative match time and existing checked correction semantics.
- Existing saved streams, later-period behavior, and historical events are unchanged.
- No database schema change or new event type. The broader event-timing and
  running-lineup proposal remains parked in PR #410.

## Related report closure

S9's marker/orientation report was confirmed as user error. Flip field view
rotates the camera view, markers and tap mapping without writing an event.
Switch attacking direction records an actual attacking-direction change without
rotating the camera. Use the explicit attacking-direction label in the menu.
View persistence remains an optional deferred enhancement, not an open bug.

## Verification

- Kickoff has two events, paused clock, zero participation and unchanged input.
- Delayed explicit Start begins timing at the click, not setup completion.
- Existing running fixtures explicitly Start and retain their historical coverage.
- New independent recorder begins paused; existing cloud adoption is unchanged.
- Mobile Minutes/Seconds accepts zero, single-digit seconds and cumulative minutes;
  rejects blank, negative, fractional or seconds above 59.
- Correction failures remain visible and do not modify history.
- Check mobile/desktop layout and keyboard labels before release.

Automated evidence: 1,736 tests across 206 files passed; TypeScript passed.
Real mobile keyboard and deployed UI checks have not been performed in this slice.
