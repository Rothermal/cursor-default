# Plan: SEC-2 Viewer role

SEC-2 adds a true read-only team role.

Depends on: SEC-0, SEC-1.

---

## 1. Goal

Allow a user to see team information without being able to track games or manage team data.

This supports parents, family, or supporters who should follow roster/schedule/results but
should not affect stats or game operations.

---

## 2. Proposed Role

Add `viewer` to `team_members.role`.

Viewer can:

- view accepted team,
- view Team Info,
- view roster,
- view schedule,
- view finalized game summaries,
- view season/player/team stats where already visible to team members.

Viewer cannot:

- start games,
- resume/track games,
- finalize games,
- edit roster,
- edit team metadata,
- invite/remove members,
- correct stats,
- reassign primary recorder,
- merge players,
- delete teams/games/players,
- claim guardianship unless SEC-4 explicitly allows it.

---

## 3. Scope

- Add `viewer` role support in DB constraints/RPC validation.
- Update invite dropdowns to include Viewer.
- Update permission helper from SEC-1.
- Hide or disable track/start/manage actions for viewer.
- Ensure RLS allows read paths but denies write paths.
- Add regression checks for viewer.

---

## 4. Out Of Scope

- Public/no-login team pages.
- Partial player visibility.
- Guardian approval changes.
- App-level suspension/approval.
- Org/league roles.

---

## 5. Suggested Implementation

Migration:

- Update any role CHECK constraints if present.
- Update `invite_team_member` role validation.
- Update invite-link role validation later in SEC-3.
- Review policies that assume all team members can write.

App:

- Update `TeamRole` union.
- Update permission helper.
- Add Viewer option to invite UI.
- Remove or disable start/track actions when role is viewer.
- Ensure Team Info read paths still work.

Tests:

- Permission helper tests.
- Manual user flow with owner/admin/scorer/viewer.

---

## 6. Q&A Session

Ask these one at a time before implementation.

1. Should viewer see in-progress games?
   - Recommended: Yes, list them as read-only, but no Resume/Track action.
   - Option B: Only finalized games.
   - Option C: No cloud games, only roster/schedule.

2. Should viewer see all player profiles/stats?
   - Recommended: Yes, same read visibility as accepted team members.
   - Option B: Only roster and game summaries.
   - Option C: Only team-level stats.

3. Should viewer appear in the same member list?
   - Recommended: Yes, with role label "Viewer".
   - Option B: Separate "Viewers" section.

4. Should viewer be inviteable by email only at first?
   - Recommended: Yes, then invite links support viewer in SEC-3.
   - Option B: Wait for SEC-3 and ship viewer with invite links.

5. Should viewer be allowed to claim player guardianship?
   - Recommended: No, defer to SEC-4.
   - Option B: Yes, if they can see the player.

---

## 7. Resolved Decisions

- Viewer can see in-progress games read-only, with no Resume/Track action.
- Viewer gets the same read visibility as accepted team members.
- Viewer appears in the same member list with role label "Viewer".
- Viewer is inviteable by email first; invite-link support follows in SEC-3.
- Viewer cannot claim guardianship.

---

## 8. Acceptance Criteria

- [x] Owner/admin can invite a viewer.
- [x] Viewer can accept invite and see team read-only pages.
- [x] Viewer cannot track/start/resume/finalize games.
- [x] Viewer cannot manage roster/members/invites.
- [x] Viewer cannot correct stats, merge players, or reassign primary.
- [x] Server-side checks deny viewer writes even if UI is bypassed.

---

## 9. Implementation Result

- Added migration `036_viewer_team_role.sql`: viewer role constraint and membership RPC
  support, a shared `can_track_team_games` server predicate, and viewer-denying game,
  stat, checkout, shot-chart, tournament-create, and guardian-claim policies.
- Owner/admin can invite viewers; admins can remove viewers and switch scorer/viewer
  roles without gaining authority over admins or owners.
- Cloud Games sends viewers to read-only Game Info for live/scheduled games. Final games
  remain available through the full read-only summary.
- Team Info, roster, schedule, stats, and member summaries retain accepted-member read
  access, while setup, live tracking, finalization, corrections, and management controls
  remain unavailable.
- Added viewer permission tests and manual regression cases. Database role scenarios
  remain manual because the repository has no local Supabase integration-test harness.
