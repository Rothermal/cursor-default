# Plan: SEC-1 Team access cleanup

SEC-1 cleans up the current owner/admin/scorer model before adding new roles.

Depends on: SEC-0.

---

## 1. Goal

Make the existing role model consistent across UI, RPCs, RLS, and docs.

SEC-1 should not add `viewer`, invite links, or app-level access. It should reduce risk in
the current behavior before expanding the access model.

---

## 2. Current Behavior To Preserve

- Owner/admin can manage roster and members.
- Owner/admin can invite users by email.
- Owner/admin can merge players when authorized for every involved team.
- Owner/admin can correct finalized stats and reassign primary recorder.
- Scorer can view accepted teams and track games.
- Lower roles should not see or successfully call privileged actions.

---

## 3. Scope

- Create shared role/permission helpers in app code.
- Replace repeated inline owner/admin checks where practical.
- Make member-management UI use the same permission helper.
- Review `team_members.accepted_at` behavior in client queries and RLS.
- Ensure pending invites do not accidentally grant full accepted-member visibility.
- Confirm admin member removal/changing behavior is intentional.
- Improve unavailable/error copy when an action is denied by RLS.
- Add targeted tests for pure permission helpers.
- Update regression docs.

---

## 4. Out Of Scope

- New database role values.
- Invite links.
- Guardian approval flow.
- App-level user access.
- Audit table.
- Big UI redesign.

---

## 5. Suggested Implementation

Potential helper:

```ts
type TeamRole = 'owner' | 'admin' | 'scorer'

canManageTeam(role)
canManageMembers(role)
canInviteMembers(role)
canTrackGames(role)
canCorrectStats(role)
canMergePlayers(role)
canDeleteTeam(role)
```

Potential files:

- `src/lib/teamPermissions.ts`
- `src/lib/teamPermissions.test.ts`
- `src/pages/Teams.tsx`
- `src/pages/TeamManage.tsx`
- `src/pages/TeamInfo.tsx`
- `src/pages/GameSummary.tsx`
- `docs/REGRESSION_TESTING.md`

Potential migration/RLS review:

- `011_team_invites.sql`
- `013_rls_auth_uid_cached.sql`
- `018_seasons_and_roster_junction.sql`

If SEC-1 reveals that accepted-member filtering must change in RLS, split the SQL change
into a small migration rather than burying it in a broad UI cleanup.

---

## 6. Q&A Session

Ask these one at a time before implementation.

1. Should SEC-1 include RLS changes if pending invites currently see too much?
   - Recommended: Yes, if the mismatch is confirmed and can be fixed narrowly.
   - Option B: Document only and defer RLS to SEC-2.

2. Should admins be allowed to remove other admins?
   - Recommended: No, owner-only for removing/changing admin roles.
   - Option B: Yes, admins can remove any non-owner.
   - Option C: Owner-only for all removal.

3. Should owners be transferable in SEC-1?
   - Recommended: No, owner transfer is a later dedicated phase.
   - Option B: Add owner transfer now.

4. Should scorer users see `/team/manage` at all?
   - Recommended: They may reach it, but it should be read-only or redirect to Team Info.
   - Option B: Hide/redirect entirely.

5. Should SEC-1 add an access-denied component?
   - Recommended: Yes, a small reusable "You do not have access" state.
   - Option B: Keep page-specific copy only.

---

## 7. Resolved Decisions

- Include narrow RLS fixes if audit confirms pending invites see too much.
- Admins cannot remove other admins; admins remove scorers/viewers only.
- Owner transfer is not part of SEC-1.
- Scorers reaching `/team/manage` get read-only/unavailable behavior or redirect to Team
  Info.
- Add a reusable access-denied/unavailable component.

---

## 8. Acceptance Criteria

- Shared permission helper exists and is tested.
- Owner/admin/scorer gates use the helper on key pages.
- Scorer cannot see privileged controls.
- Bypassing UI still fails server-side for privileged writes.
- Pending invite behavior is documented and tested.
- Existing owner/admin/scorer happy paths still work.
