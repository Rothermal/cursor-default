# Plan: Admin security and access roadmap

High-level roadmap for tightening StatKeeper's admin, security, visibility, and access
model before expanding into additional sports.

This plan consolidates earlier notes from:

- `docs/archived/DESIGN_USER_PERMISSIONS_AND_ROLES.md`
- `docs/archived/DESIGN_MULTI_PARENT_INVITE_LINKS.md`
- `docs/INTEGRATION_PLAN.md`
- `docs/completed/PLAN_TEAM_INFO_DRILLDOWN_IMPLEMENTATION.md`
- `docs/completed/DESIGN_SEASONS_DATA_MODEL.md`
- `docs/completed/DESIGN_PLAYER_MERGE.md`

---

## 1. Goal

Create a clear, testable access model for:

- who can use the app,
- who can see teams, players, games, and stats,
- who can track games,
- who can manage teams, rosters, members, and invites,
- who can correct finalized stats,
- who can manage player guardianship,
- who can perform support/admin actions across the app.

The first pass should improve current basketball/team workflows while staying sport-agnostic
so soccer, baseball, football, and other future sports inherit the same permissions model.

---

## 2. Current Model

Shipped today:

- Supabase auth gates cloud usage.
- Team roles are stored in `team_members.role`: `owner`, `admin`, `scorer`.
- Team membership has accepted and pending states through `team_members.accepted_at`.
- Owner/admin users can invite members, manage roster/member surfaces, merge players,
  reassign primary recorders, and correct finalized stats.
- Scorer users can view team info and track games, but should not get privileged
  management actions.
- `player_guardians` links users to players and allows player pool reuse and player
  profile editing.
- Email invites exist. Invite links are designed but not implemented.
- App-level account management exists, but app-level approval/suspension/admin support
  does not.

---

## 3. Known Gaps

- No single access matrix documents roles, resources, and actions.
- No true read-only team role. "Scorer" is not read-only because it can track games.
- Pending invites may be treated as membership in some broad team/member policies.
- Owner/admin/scorer UI gates are repeated in several files.
- Admin member-management behavior should be made explicit across UI, RPCs, and RLS.
- Guardianship is powerful but not deeply managed or audited.
- Invite by email requires the invitee to already have an account.
- No app-level access status for private beta, suspensions, support users, or global admins.
- No unified audit trail for role changes, invite activity, guardian changes, or access changes.

---

## 4. Guiding Decisions

- Keep app-level roles separate from team roles.
- Keep team-level roles sport-agnostic.
- Treat player guardianship as a player relationship, not a team role.
- Prefer shared permission helpers over one-off UI checks.
- RLS and RPC authorization are the source of enforcement; UI gates are user experience,
  not security.
- Pending invite rows should not grant the same visibility as accepted membership unless
  a phase explicitly decides otherwise.
- Avoid broad "super admin" behavior until app-level access is planned and audited.
- Add migrations in small, reviewable phases.

---

## 5. Phase Roadmap

| Phase | Plan | Purpose | Status |
|---|---|---|---|
| SEC-0 | `PLAN_SEC_0_ACCESS_MATRIX_AND_AUDIT.md` | Define the role/action matrix and inspect current UI/RLS behavior. | Complete; see [`ACCESS_MATRIX.md`](ACCESS_MATRIX.md) |
| SEC-1 | `PLAN_SEC_1_TEAM_ACCESS_CLEANUP.md` | Clean up current owner/admin/scorer behavior without adding new roles. | Planned |
| SEC-2 | `PLAN_SEC_2_VIEWER_ROLE.md` | Add a true read-only `viewer` team role. | Planned |
| SEC-3 | `PLAN_SEC_3_INVITE_LINKS.md` | Implement DB-backed invite links and join flow. | Planned |
| SEC-4 | `PLAN_SEC_4_GUARDIANSHIP_REVIEW.md` | Make player guardianship clearer, safer, and manageable. | Planned |
| SEC-5 | `PLAN_SEC_5_APP_LEVEL_ACCESS.md` | Add optional app-level access controls such as active/pending/suspended and app admin. | Planned |
| SEC-6 | `PLAN_SEC_6_AUDIT_TRAIL.md` | Add durable audit records and an admin/support view for sensitive changes. | Planned |

Recommended order:

1. SEC-0
2. SEC-1
3. SEC-2
4. SEC-3
5. SEC-4
6. SEC-5
7. SEC-6

SEC-5 and SEC-6 can move earlier if private-beta access or support/admin workflows become
urgent.

---

## 6. Q&A Cadence

Each phase plan includes a Q&A section. Before implementing a phase, use that section to
answer one question at a time in chat.

Recommended Q&A pattern:

1. Confirm the product default.
2. Decide the strictness level.
3. Decide whether the phase needs a Supabase migration.
4. Decide which manual regression users/accounts are required.
5. Decide what is explicitly deferred.

When a Q&A answer is chosen, update the phase plan before implementation so the code pass
has stable decisions.

### Resolved Q&A defaults

- Pending invitees see invite summary only until they accept.
- Admins can invite/remove scorers/viewers, but cannot remove the owner or change
  owner/admin roles.
- Scorers can start, resume, and track games.
- Guardians keep current player profile edit behavior, narrowed in SEC-4 to player identity
  fields rather than roster/team fields.
- App-level access waits until SEC-5.
- SEC-1 may include narrow RLS fixes if pending invite visibility is too broad.
- Scorers who reach `/team/manage` get read-only/unavailable behavior or redirect to
  Team Info.
- Add a reusable access-denied/unavailable component in SEC-1.
- Viewer is a read-only accepted team member: same read visibility, in-progress games
  read-only, same member list, email-invite first, no guardian claims.
- Invite links create Scorer/Viewer only, are single-use, expire after 7 days, require
  confirmation, and show active links with Copy/Revoke.
- Guardian claims remain self-service; creator, self, and team owner/admin can remove
  guardians; durable audit waits for SEC-6.
- New signups are active by default; app-admin tools live under Settings -> Advanced ->
  App access when pending/suspended workflows ship; suspended sessions do not keep local
  app access; app admins do not broadly bypass team RLS.
- Audit is visible to team owner/admin for team-scoped events and app admins for all events;
  no personal activity page in v1; audit writes use action-specific RPCs/triggers; keep
  `player_merge_audit` separate; member and invite-link events ship first.

---

## 7. Cross-Sport Notes

All SEC phases should work for every sport.

- Basketball-specific settings stay under Settings -> Sports -> Basketball.
- Team roles should not mention basketball.
- Game tracking permission should apply to any sport tracker.
- Future soccer field/baseball diamond/football field UIs should call the same team access
  helpers that basketball uses.
- Invite links, viewer role, guardianship, and app-level access should not need sport-specific
  schema.

---

## 8. Regression Themes

Every implementation phase should add or update checks for:

- owner/admin/scorer behavior,
- pending vs accepted invite visibility,
- owner/admin-only controls hidden from lower roles,
- server/RLS denial when UI gates are bypassed,
- local/offline behavior where applicable,
- multi-sport team/game behavior once more sports ship.

---

## 9. Non-Goals

- Full organization/league hierarchy.
- Paid subscriptions.
- Public team pages.
- Email delivery service for invites.
- Cross-tenant support dashboard with direct data editing.
- Replacing Supabase Auth.
