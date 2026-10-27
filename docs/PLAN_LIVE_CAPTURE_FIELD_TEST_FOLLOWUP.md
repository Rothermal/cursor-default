# Live Capture Field-Test Follow-Up

Status: LCF-1 sync correction merged in #510. LCF-2 unattributed opponent free
throws implemented for review on 2026-10-26; surface interaction/focus mode remains
planned, not implemented. The scoring report remains open for a second game whose
export is pending. Football development is paused while these owner-reported
issues are addressed. This is not a clock/substitution redesign.

Related direction: [shared product decisions](PRODUCT_AND_INTERACTION_DECISIONS.md),
[Basketball attribution](PLAN_BASKETBALL_ATTRIBUTION_AND_ROSTER.md),
[full court](PLAN_BKE_7_FULL_COURT.md), and
[tracker alignment](PLAN_TRACKER_UI_UNIFICATION.md).

## Work Packages

| Package | Status | Scope and exit |
| --- | --- | --- |
| LCF-1: Late-player sync and scoring audit | Sync correction merged #510; second-game scoring investigation open | Bind replayed participant identities; first export verifies 17-17, not the separate reported scoring interaction |
| LCF-2: Unattributed opponent free throws | Implemented for review | Standalone and awarded opponent attempts use explicit team credit without creating a player; local verification and pending owner checks are in the [regression record](REGRESSION_LCF_2_OPPONENT_FREE_THROWS.md) |
| LCF-3: Capture-first gestures and focused surface | Requested target; interaction details below are recommendations | Short tap opens capture even over an existing marker; long press opens review; focused landscape layout with score and menu. Basketball first, then relevant sibling surfaces |

These are cohesive feature PRs, not a new foundation/micro-phase ladder. Do not
delay the confirmed sync fix behind the UI work. FBE-1 remains an approved plan;
none of these packages starts Football's event implementation.

## LCF-1: Confirmed Sync Failure

### Evidence and cause

The owner supplied `statkeeper-basketball-recovery-2026-10-24.json`. It contains 61
events, ten setup participants, and an eleventh participant added during play.
The stored failure is an unmapped player on the first opponent free throw after
that addition (sequence 57). The private export is not committed to the repository.

`gameParking.ts` normalizes persisted sport state, intentionally recreating an
empty derived projection from immutable setup. In `GameContext.syncParkedRecord`,
that normalized snapshot goes to event sync. The shared health helper replayed
the complete stream, but discarded its rebuilt state; the Basketball adapter then
enumerated the original setup-only projection for binding. The late participant
was omitted, so event serialization could not map the shooter's player identity.

Deleting an attempt does not erase its revisioned history: the tombstone still
needs its actor mapping. This explains why deleting shots is not a sync repair.
Never solve this by dropping history, inventing a new player, or acknowledging an
incomplete upload as synced.

### Implemented correction

- Return the validated rebuilt state from `assertHealthyEventGame` and consume its
  sport state in every event-cloud adapter health wrapper.
- Basketball and Soccer now bind replayed late/resolved participants after parked
  normalization. Preserve each sport's source-team identity policy and frozen setup.
- Hockey and Baseball follow the same return contract; their participant binders
  remain setup-based. No new late/opponent identity model is introduced for them.
- Keep corrupt-stream rejection, account cancellation, recorder independence,
  conflict handling, final-state policy and checkpoint ordering unchanged.
- No SQL migration, authorization expansion, history rewrite or automatic cloud
  operation against the supplied game is included.

### Scoring audit

The supplied stream replays to **17-17**:

| Side | Made free throws | Made twos | Made threes | Points |
| --- | --- | --- | --- | --- |
| Tracked | 3 | 4 | 2 | 3 + 8 + 6 = 17 |
| Opponent | 0 | 7 | 1 | 0 + 14 + 3 = 17 |

There are no assist events in this export. On 2026-10-26 the owner clarified that
the suspected scoring problem occurred in the **second game**, not this 17-17
game. The second game's full export is pending once sync is available. Keep that
report open: this audit cannot establish what happened there. No scoring defect
has been reproduced, and no speculative scoring change is made.

Source trace: `commands.ts` appends one shot and one separately linked assist or
rebound in an atomic capture. `statProjection.ts` changes score only for a made
shot or explicit score adjustment; related statistics do not add points.
`summaryDetails.ts` computes player points from FT + 2 * twos + 3 * threes.

New full-court tests cover both sides and both shot values, a linked assist,
a missed shot with linked rebound, and grouped Undo. Existing historical edit,
restore, summary, finalization and aggregate tests remain required. A future
scoring report should include the event/shot ids and displayed score before and
after capture; an export alone may not capture an unintended UI gesture.

### Cross-Sport Assessment

| Sport | Identity/sync relevance | Score/interaction relevance |
| --- | --- | --- |
| Basketball | Confirmed missing mapping after parked normalization; reproduced with active and deleted attempts | New full-court linked-event regressions pass; marker hit areas currently intercept capture taps |
| Soccer | Same discarded-replay pattern affected late resolved participants; added a parked-normalization regression | Goal scoring is separate from related attribution; markers/clusters currently open review on a short tap |
| Hockey | Uses the shared health helper but binds immutable tracked setup participants; opponents are labels | Goals alone change match score; marker review also intercepts short taps |
| Baseball | Uses the helper with immutable tracked setup participants; opponents are labels/slots | Runs change score separately from RBI credit. Diamond runner/position controls have distinct meanings; do not blindly convert them to shot-marker gestures |
| Football | Generic aggregate path; not affected by event participant binding | Preserve existing tracker. Apply the future field interaction contract only after its sport-owned event/setup foundations |

### Verification and Remaining Owner Replay

- Before the fix: three new automated cases fail (two Basketball upload paths and
  one Soccer binder path). A local-only replay of the private export also fails
  at sequence 57 with the missing mapping.
- After the fix: focused cross-sport checks pass (6 files / 111 tests), and local
  replay maps every exported event with all eleven participants while preserving
  the 17-17 score. No live cloud write was made by that replay.
- Full suite: 339 files / 3,493 tests pass. `pnpm build` passes TypeScript and PWA
  generation; source lint passes with zero errors and the three existing
  Fast Refresh warnings. These checks are not device/cloud signoff.
- After deployment, keep an export, reload the affected local game and retry sync
  once. Verify the late opponent's name, four missed free throws, unchanged score,
  complete checkpoint and subsequent reload. Do not import a duplicate recording
  or delete the original to work around mapping. If a different error appears,
  retain the new export and diagnose it separately.
- Owner live Supabase replay, physical-mobile and installed-PWA checks remain
  pending. Broader rollout gates do not change.

## LCF-2: Unattributed Opponent Free Throws

This intentionally changes the earlier BAR-2 opponent individual-required policy;
it is not just an empty-option label fix. Quick and awarded capture and historical
edit/add now accept an explicit opponent team shooter. Tracked free throws still
require a resolved player. The existing version-1 shot event already represents
team actors; no event schema change or Supabase migration is included.

### Implemented contract

- Opponent standalone free throws default to an explicit **Unattributed** choice
  on the selected opponent side. Made adds exactly one point and one team FTM/FTA;
  missed adds one team FTA. Neither creates a participant nor credits an individual.
- Permit the same team actor for opponent awarded attempts. Retain trip id,
  attempt number, one-and-one closure, consumed removed positions, technical
  exceptions, same-period checks and stale-dialog validation.
- Empty-roster awarded trips keep an optional Add player shortcut on either side.
  Only tracked trips require the player warning; opponent Unattributed capture
  remains enabled. The add form starts on the awarded side, even when a foul on
  the other side opened the trip.
- Preserve a trip's existing explicit shooter. Do not silently convert a named
  attempt to team attribution or switch shooters. Make any permitted correction
  explicit and revalidate the complete trip/history. Unknown is not a real player.
- Keep tracked-player eligibility/disqualification and current individual-required
  policy unchanged unless separately approved; this request targets opponents.
- Update quick and awarded dialogs, player-context entry, command validation,
  Timeline edit/add/restore, trip status/prefill, summary attribution, cloud
  serialization/canonical review and aggregates together. Team attempts must not
  leak into individual leaderboards or acquire invented position/minutes credit.
- Preserve recorded old events; do not backfill or relabel historical shooters.
  If a server/client contract change is needed, assign the next migration only
  after validating the complete read/write/finalization path. Never edit an applied
  migration to enable this.
- Other sports do not have Basketball free throws. Reuse the principle of valid
  side-level attribution for opponent events, not the Basketball trip model.

The UI-only opponent team target is serialized as `{ role: 'shooter', kind: 'team' }`
with its display label, never as a player/participant identity. Existing player
mapping, shared event transport and server shot-score policy already support this
representation. Canonical parsing, summary attribution and aggregate replay tests
cover its read path. Named trip shooters retain prefill priority; an explicit
selection changes only the newly recorded attempt, not previous player credit.

Acceptance: zero opponent players, made/miss standalone and awarded trips, named
shooter continuity, multiple open trips, one-and-one, stale selection, Undo,
remove/restore/edit, normalized reload, cloud serialization and summary/canonical
aggregate replay pass locally. The [regression record](REGRESSION_LCF_2_OPPONENT_FREE_THROWS.md)
contains actual counts and the separate pending live sync/checkpoint/finalization,
physical-mobile and installed-PWA checks. No tracked eligibility expansion or
fabricated participants is permitted.

## LCF-3: Capture-First Gestures and Focus Mode

### Requested target and recommended details

- In a writable live surface, a short tap opens the existing capture dialog at
  that canonical point, even over existing markers. It does not immediately save
  an event with guessed result/player. Repeated shots may share exact coordinates;
  never jitter stored locations or overwrite an existing event to fit a marker.
- A stationary long press opens the existing marker/cluster review chooser. Editing
  remains explicit, checked and subject to current authority. It must not also
  trigger capture on release or a synthetic click. Keep overlap selection stable.
- Recommendation: a shared pointer gesture recognizer with a configurable initial
  hold threshold around 500 ms; cancel on drag, scroll, pointer cancellation,
  multi-touch and teardown. Keep coordinate transforms sport-owned. Verify the
  threshold on a physical device before calling it tuned.
- Preserve browser zoom and ordinary scrolling. Provide an accessible non-gesture
  route through Timeline/review and keyboard activation. In read-only Summary or
  retired games, short tap still reviews; it never offers live capture.
- Focused landscape target: a thin score/period/clock strip above the court, team
  context and a three-dot menu in a top corner; the surface takes the remaining
  viewport (roughly 90% where space permits), preserving its aspect ratio and full
  bounds. Do not hide essential failure/access/conflict warnings to hit a percentage.
- Recommendation: automatically use the focused layout in phone-like landscape
  tracker viewports, plus an explicit Expand/Exit control. Exiting suppresses
  automatic re-entry until a later orientation cycle. A wide desktop window is not
  permission to steal fullscreen or change route/tab. No second GameContext or
  recorder is mounted when expanding.
- The button may request browser fullscreen and landscape orientation where
  available; denial falls back to an in-app viewport-filling layout. Automatic
  layout changes must not depend on browser fullscreen permission. Do not rotate
  the entire UI with CSS to fake an orientation lock.
- Current `vite.config.ts` sets PWA manifest orientation to `portrait`. Review a
  rotation-permitting manifest value as part of this package; a media query alone
  cannot establish the installed-PWA behavior. Check all setup/settings pages,
  normal portrait navigation and existing installed apps after the manifest update.
- Menus/dialogs must stay within the fullscreen subtree when real fullscreen is
  active; retain focus management, Escape/Back/Exit, safe areas and focus return.
  Rotation, resize, expand/exit and menu navigation never change a clock, lineup,
  event, attacking direction or sync fingerprint. Leaving the game still uses
  the existing explicit workflow policy.

### Delivery and reuse

Implement and verify Basketball's capture-first gestures and focus layout together.
Then adopt the same presentation/gesture primitive in Soccer and Hockey as one
cohesive sibling pass if small; keep each sport's dialogs, eligibility and location
conversions. Baseball needs a separate review of play-location taps versus runner
and fielder controls. Football consumes the contract when its field exists, not
by altering today's generic grid. No per-sport legacy/new-UI toggles are introduced.

Acceptance includes repeated captures on the same spot, nearby/overlapping marker
review, cancelled holds, no hold-plus-capture double action, flip/coordinate
accuracy, keyboard/review alternatives, zero events from resize/navigation,
portrait/landscape in both themes, real fullscreen and denied/unavailable fallback,
menus/dialog focus, score and alerts, physical touch, installed PWA rotation and
long-name/small-landscape layout. Screenshots alone do not prove touch/PWA support.

### Browser references

The browser APIs are optional enhancements, not gameplay dependencies. Check
current target-browser behavior during implementation:

- [Fullscreen API](https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API)
- [Screen orientation lock](https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock)
- [Manifest orientation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/orientation)
