# Plan: SEC-4 Guardianship review

SEC-4 clarifies and hardens player-level guardianship.

Depends on: SEC-0, SEC-1, SEC-2.

---

## 1. Goal

Make player guardianship understandable and safe.

Guardianship is separate from team roles. It controls a user's relationship to a player
across teams/seasons, especially player pool reuse and player profile editing.

---

## 2. Current Behavior

- `player_guardians` links users to players.
- Player creators are backfilled/created as guardians.
- A user can claim guardianship from roster UI.
- Guardians can edit player profile fields.
- Guardians can find players in their player pool for future rosters.
- Player merge preserves guardian links.

---

## 3. Scope

- Decide whether guardian claims stay self-service or require approval.
- Add clearer UI for who is a guardian of a player.
- Add remove guardian action for appropriate users.
- Decide whether guardian edit rights should be full or limited.
- Add regression checks for creator, guardian, team admin, scorer, and future viewer.
- Document how guardianship interacts with team roles.

---

## 4. Out Of Scope

- Legal/identity verification.
- Child account support.
- Public profile sharing.
- Org-level player ownership.
- Split/undo player merge.

---

## 5. Implementation Options

Option A: keep self-service claim, improve management.

- Lowest friction.
- Current behavior mostly stays.
- Add guardian list and remove action.

Option B: owner/admin approval required.

- Safer for data control.
- Requires pending guardian claims.
- More UI and migration work.

Option C: guardian code/link.

- Team owner gives a claim code or link for a player.
- Safer than self-service but less heavy than full approval workflow.
- Could share mechanics with invite links.

Recommended first pass: Option A unless user trust/privacy concerns are high.

---

## 6. Q&A Session

Ask these one at a time before implementation.

1. Should guardian claims remain self-service?
   - Recommended: Yes for now, with clearer UI and removal controls.
   - Option B: Require owner/admin approval.
   - Option C: Use player-specific claim links/codes.

2. Who can remove a guardian?
   - Recommended: player creator, current guardian removing self, and owner/admin of a team the player is on.
   - Option B: creator only plus self-remove.
   - Option C: owner/admin only.

3. What can guardians edit?
   - Recommended: player profile identity fields only, not roster/team fields.
   - Option B: full player edits as today.
   - Option C: read/pool only, no edits.

4. Should viewers be allowed to become guardians?
   - Recommended: No by default; require scorer/admin or explicit approval.
   - Option B: Yes if they can see roster.

5. Should guardianship changes be audited immediately?
   - Recommended: Defer durable audit to SEC-6 but add enough UI history/copy now.
   - Option B: Add audit table in SEC-4.

---

## 7. Resolved Decisions

- Guardian claims remain self-service.
- Player creator, current guardian removing self, and owner/admin of a team the player is on
  can remove guardians.
- Guardians can edit player profile identity fields only, not roster/team fields.
- Viewers cannot become guardians by default.
- Durable guardianship audit is deferred to SEC-6.

---

## 8. Acceptance Criteria

- [x] Users can understand whether they are a guardian or creator of a player.
- [x] Authorized users can remove guardian links according to selected policy.
- [x] Guardian edit behavior is documented and tested.
- [x] Team role and guardian relationship are not conflated.
- [x] Player pool behavior still works.

---

## 9. Implementation Result

- Added migration `038_guardianship_hardening.sql` with RPC-only guardian claims,
  guardian listing/removal, and identity-only player updates.
- Claims require an active roster entry plus an accepted owner/admin/scorer role for that
  specific team. Viewers, pending members, non-members, and known-player-UUID calls fail.
- Player creators, current guardians removing themselves, and accepted owner/admin users
  of a team containing the player can remove guardian relationships.
- Guardian names are returned without email addresses to managers, creators, and current
  guardians. Direct guardian-row reads are narrowed to self or management relationships.
- Direct player updates are removed. Creator/guardian updates can change only first name,
  last name, and nickname through `update_player_identity`; jersey and roster fields remain
  owner/admin-only `team_players` updates.
- A database migration backfills creator guardian links and a trigger creates them for new
  non-placeholder players, replacing fragile client-side follow-up inserts.
- Team Manage now shows Creator/Guardian status, a guardian-management dialog, self/manager
  removal controls, and identity editing for creator/guardian scorers or existing viewer
  guardians without granting roster management.
- Permission-helper tests and manual role/RPC regression cases cover the client contract.
  Database role scenarios remain manual because the repository has no local Supabase
  integration-test harness. Durable guardian audit events remain deferred to SEC-6.
