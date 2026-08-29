# Regression: BKE-6C2 Boundary and Equal-Play Review

## Scope

BKE-6C2 replaces the same-five shortcut with explicit boundary review for anchored Basketball
games. It adds changed-five confirmation, optional-opponent coordination, advisory equal-play
presentation, authorized enforced overrides, and stale-safe atomic command composition. It adds no
Supabase migration and does not change clockless, Legacy, or historical-game authority.

## Automated Coverage

- Start checks pending sides before invoking `startBasketballClock` and the explicit Review Lineup
  action remains visible while review is pending.
- Unchanged and changed boundary candidates are confirmed through checked commands; a changed five
  appends substitution before confirmation in one timestamp, elapsed value, and capture group.
- Enforced changed candidates append substitution, override, and confirmation atomically.
- Missing authority, blank/oversized override reasons, stale current-five evidence, duplicate or
  unavailable participants, and running/unsafe clock state fail without mutation.
- Advisory violations remain confirmable without override events; equal-play-off and opponent-only
  review do not invent tracked-policy decisions.
- A pre-Start substitution after confirmation returns projection to review-required.

## Manual Smoke

1. Start an anchored event game whose second regulation segment is a lineup-change boundary.
2. End the first period and start the next period. Press Start and verify the review opens while the
   clock remains paused and no Clock Start appears in Timeline.
3. Confirm the current five for one side. With opponent lineup authority enabled, verify the other
   side remains pending until separately confirmed.
4. Reopen the flow, change one player, and confirm. Verify the current five changes once and Start is
   enabled only after every required side is complete.
5. With advisory equal play, verify warnings appear but confirmation remains available. With enforced
   equal play, verify a bounded reason is required and the current tracking role can record it.
6. Cancel each review/editor surface and verify no event is appended.

## Exit

BKE-6C2 is complete. BKE-6C3 owns roles, captain history, replacement integration, and reasoned
current-lineup recovery. BKE-6C4 owns grouped Undo and Timeline correction.
