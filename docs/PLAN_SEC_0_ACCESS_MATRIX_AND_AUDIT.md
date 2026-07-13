# Plan: SEC-0 Access matrix and audit

SEC-0 is a planning and audit phase. It should produce the role/action matrix that later
phases implement.

Depends on: AUTH-2, NAV-2, Team Info drilldown.

---

## 1. Goal

Define exactly what each account, team, and player relationship can do.

The output should be a single matrix that future phases can reference when changing UI,
RPCs, RLS policies, and regression tests.

---

## 2. Current Inputs

- Team roles: `owner`, `admin`, `scorer`.
- Player relationship: `player_guardians`.
- Invite state: `team_members.accepted_at`.
- Admin correction authority: owner/admin.
- Merge authority: owner/admin on every involved team.
- Existing placeholder: `docs/archived/DESIGN_USER_PERMISSIONS_AND_ROLES.md`.

---

## 3. Scope

- Inventory current permissions by resource and action.
- Define the target role/action matrix.
- Identify mismatches between desired behavior and current UI/RLS.
- Decide which changes belong in SEC-1 through SEC-6.
- Add regression scenarios for each role.

Resources to include:

- account/profile,
- app access,
- seasons,
- teams,
- team members,
- team invites,
- invite links,
- roster rows,
- players,
- player guardians,
- games,
- game tracking,
- game finalization,
- stats and corrections,
- primary recorder reassignment,
- parked games/local data,
- settings/admin pages.

---

## 4. Out Of Scope

- Adding new roles.
- Changing migrations.
- Changing UI behavior.
- Building invite links.
- Building app-level access.

SEC-0 may create docs only.

---

## 5. Recommended Matrix Shape

Rows:

- App user states: signed out, active user, suspended user, app admin.
- Team roles: owner, admin, scorer, future viewer.
- Player relationship: guardian, creator.
- Invite states: pending invitee, accepted member.

Columns:

- View team.
- View roster.
- View schedule.
- View finalized stats.
- Track game.
- Start/resume cloud game.
- Finalize game.
- Edit roster.
- Edit player profile.
- Claim/manage guardianship.
- Invite members.
- Remove members.
- Change member role.
- Correct stats.
- Reassign primary recorder.
- Merge players.
- Delete team/game/player.
- Export/import local parked games.

Use values:

- Allow.
- Deny.
- Own only.
- Owner only.
- Owner/admin.
- Future phase.

---

## 6. Implementation Notes

Recommended files:

- `docs/PLAN_ADMIN_SECURITY_ROADMAP.md`
- `docs/PLAN_SEC_0_ACCESS_MATRIX_AND_AUDIT.md`
- `docs/REGRESSION_TESTING.md`
- optionally `docs/ACCESS_MATRIX.md` if the matrix becomes large.

Code inspection targets:

- `src/pages/Teams.tsx`
- `src/pages/TeamManage.tsx`
- `src/pages/TeamInfo.tsx`
- `src/pages/GameSummary.tsx`
- `src/pages/GameSetup.tsx`
- `src/pages/Games.tsx`
- `src/lib/mergePlayerScope.ts`
- `supabase/migrations/011_team_invites.sql`
- `supabase/migrations/013_rls_auth_uid_cached.sql`
- `supabase/migrations/018_seasons_and_roster_junction.sql`
- `supabase/migrations/024_player_merge_rpcs.sql`

---

## 7. Q&A Session

Ask these one at a time before implementation.

1. Should pending invitees see any team data before accepting?
   - Recommended: No, only enough data to decide whether to accept.
   - Option B: Yes, pending invitees can preview team name/season only.
   - Option C: Yes, pending invitees get full member visibility.

2. Should `admin` be able to remove members and change roles, or owner only?
   - Recommended: Admin can invite/remove scorers/viewers but cannot remove owner or change owner/admin roles.
   - Option B: Owner only manages all members.
   - Option C: Admin has near-owner powers except deleting/transferring team.

3. Should `scorer` be allowed to start new games?
   - Recommended: Yes, scorer can start/track games for accepted teams.
   - Option B: Scorer can only resume games created by owner/admin.
   - Option C: Scorer can only track assigned games.

4. Should player guardianship allow player profile edits by default?
   - Recommended: Yes for existing behavior, but SEC-4 reviews approval/removal.
   - Option B: Guardian edit becomes owner/admin approved.
   - Option C: Guardian can view/pool only, not edit profile fields.

5. Does app-level access control need to ship before viewer/invite links?
   - Recommended: No, keep SEC-5 later unless private beta/suspension is urgent.
   - Option B: Yes, add app access first.

---

## 8. Resolved Decisions

- Pending invitees see invite summary only before accepting.
- Admins can invite/remove scorers/viewers, but cannot remove owner or change owner/admin
  roles.
- Scorers can start, resume, and track games for accepted teams.
- Guardians keep current player profile edit behavior; SEC-4 narrows and clarifies the
  management model.
- App-level access control does not block viewer role or invite links; it remains SEC-5.

---

## 9. Acceptance Criteria

- A reviewed matrix exists.
- Every later SEC phase has stable dependencies and deferrals.
- Current mismatches are listed with file/RLS references.
- Regression checklist includes owner/admin/scorer/pending invite cases.
- No runtime behavior changes are made in SEC-0.
