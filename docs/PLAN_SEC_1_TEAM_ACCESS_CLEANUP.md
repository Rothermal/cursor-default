# Plan: SEC-1 Team access cleanup

SEC-1 cleans up the current owner/admin/scorer model before adding new roles.

Depends on: SEC-0.

SEC-0 input: [`ACCESS_MATRIX.md`](ACCESS_MATRIX.md), especially findings SEC0-01 through
SEC0-12. The audit confirms SEC-1 requires a server-side migration; app permission helpers
alone are not sufficient.

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
- Replace broad direct self-insert/update membership policies with narrow acceptance,
  decline, role-change, and removal operations.
- Require accepted membership in team-derived policies and privileged RPCs.
- Bind recorder-owned stat, checkout, and shot writes to the referenced team/game/player
  and reject normal raw writes after game finalization.
- Add a limited accepted-member summary path that does not expose member email to
  scorers.
- Add role-safe member management operations: admins can remove scorers, owners can
  manage admins/scorers, and no generic self-delete path can remove the owner row.
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
- `src/pages/Games.tsx`
- `src/pages/Admin.tsx`
- `docs/REGRESSION_TESTING.md`

Potential migration/RLS review:

- new migration `035_team_access_hardening.sql`
- `008_player_checkouts.sql`
- `009_stat_corrections.sql`
- `011_team_invites.sql`
- `013_rls_auth_uid_cached.sql`
- `014_set_primary_recorder.sql`
- `016_tournaments.sql`
- `018_seasons_and_roster_junction.sql`
- `024_player_merge_rpcs.sql`
- `032_shot_chart.sql`

Add a new, reviewable migration rather than editing applied migration history. Keep
membership/RPC hardening and game/stat write hardening in clearly separated sections so
each policy contract can be reviewed against `ACCESS_MATRIX.md`.

---

## 6. Q&A Session

Ask these one at a time before implementation.

1. How should the mandatory SEC-1 database hardening be packaged?
   - Resolved: One new reviewable migration with separate membership/RPC and
     game/stat-policy sections.
   - Option B: Two sequential migrations, one for membership/RPCs and one for
     game/stat policies.

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

- SEC-0 confirmed the RLS/RPC mismatch. Ship the hardening in one new migration with
  separate membership/RPC and game/stat-policy sections.
- Admins cannot remove other admins; admins remove scorers/viewers only.
- Owners cannot leave or delete their own membership row until a future ownership
  transfer flow exists.
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
- Direct self-join/self-promotion and protected-member mutation paths are denied.
- Admin scorer-removal succeeds through a role-safe server action; admin/owner targets
  remain protected, and owner self-removal is denied.
- Stat/checkout/shot writes require the correct accepted team/game/player relationship,
  and normal raw writes cannot change finalized games.
- Non-manager member summaries do not expose email.
- Existing owner/admin/scorer happy paths still work.
