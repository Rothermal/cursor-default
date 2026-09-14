# S15/S16 Shot Details Regression

Status: implementation and local automated/browser checks complete; deployed
owner smoke pending. Reader foundation PR #414 is merged, and the owner confirmed
all participating browsers and installed PWAs refreshed before writer enablement.

## Local verification

Full suite: 1,809 tests across 211 files passed. Production build (including
TypeScript) passed; existing asset/chunk-size build warnings remain unchanged.

- Writer tests cover live/historical shot and own-goal capture, correction and
  explicit clear, plus shootout capture and correction. Existing tests cover
  outcome clearing, omitted-field preservation, malformed data, projection and
  JSON/cloud serialization compatibility.
- Component rendering tests cover collapsed optional controls, absent placement,
  Header exclusion for shootouts and suppression of non-goal placement/approach.
- Isolated Playwright/Edge harness mounted the real SoccerField and capture dialog
  over a local running match. It selected Own goal, entered Right foot and placement,
  and saved through the real command for both beneficiary sides, with and without
  field flip, at 390px and 1280px widths (eight combinations).
- Saved direction and derived goal end matched the beneficiary, placement survived,
  and canonical origin remained stable within pointer-coordinate tolerance. No
  browser errors or horizontal page overflow. Screenshots inspected in Light/mobile
  and Dark/desktop; goal graphics, marker and controls rendered correctly.
- The shared shootout editor was exercised for foot selection, no Header/no inferred
  approach, and disappearance of placement when toggled to non-scored. Full live
  shootout sequence and cloud transport were not browser-tested in this harness.

## Deployed owner smoke

1. In a Soccer match, tap the pitch and save a shot without opening Shot details.
   Existing capture should remain unchanged. Add shots with Left foot, Right foot
   and Header; non-goals should not offer placement.
2. Log a Goal, open Shot details and tap the goal mouth or use its horizontal and
   vertical sliders. Verify the saved marker and angle in Timeline and Field review.
   Use an unlocated goal too: placement is allowed, angle is unavailable.
3. Edit the shooter and confirm details remain. Change a regular Goal to Saved:
   placement disappears but body part remains. Explicitly clear Body part and
   placement, save and reopen to verify they stay absent.
4. Log an own goal credited to each side. Flip the field display and verify the
   stored origin, entered goal and placement viewpoint are unchanged. Placement is
   always facing the entered goal, not relative to the current field rotation.
5. In a shootout, try both immediate outcome buttons and optional detailed capture.
   Only feet are offered; only scored kicks allow placement. Correct a kick and
   inspect Summary shootout review. No approach angle should be fabricated.
6. Sync an enriched match, reload/resume, and inspect its cloud Summary on a refreshed
   browser/PWA. Verify metadata survives, scores are unchanged and finalization does
   not introduce validation/conflict errors. Stop and export recovery data if it does.

No new Supabase migration is required. This checklist does not claim a live database
verification or broaden the current owner-only refreshed-client rollout.
