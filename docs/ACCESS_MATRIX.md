# StatKeeper access matrix

Status: SEC-0 approved baseline with implementation through SEC-6 (2026-07-16).

This document is the product and security contract for SEC-1 through SEC-6. It records
the intended access model separately from the current implementation so later phases can
change UI gates, RPCs, and RLS policies without re-deciding the role model.

Audit snapshot:

- App source at `d4b8536` on `stattracker`.
- Supabase migrations through `034_google_auth_profile_defaults.sql`.
- SEC-0 changes documentation only. Findings below are not fixed by SEC-0.

---

## 1. Access model

Access is composed from three independent layers:

1. Account access: signed out, active, suspended, or app admin.
2. Team relationship: owner, admin, scorer, viewer, or pending invitee.
3. Player relationship: creator or guardian.

The layers do not replace each other. For example, an app admin does not automatically
become a team admin, and a team owner does not automatically become a player's guardian.

Server-side authorization is authoritative. UI visibility is a usability layer and must
match the server, but hiding a control is never the security boundary.

### Terms

- **Accepted member**: a `team_members` row with non-null `accepted_at`.
- **Pending invitee**: a `team_members` row with null `accepted_at`.
- **Own**: the authenticated account owns or created the resource.
- **Relationship required**: access comes from creator/guardian status, not team role.
- **Future**: the behavior is approved but ships in the named SEC phase.

---

## 2. Target team-role matrix

This is the target contract. `viewer` becomes available in SEC-2. Until then, its column
describes the approved future behavior.

| Resource or action | Owner | Admin | Scorer | Viewer | Pending invitee |
|---|---|---|---|---|---|
| View team, roster, and schedule | Allow | Allow | Allow | Allow (SEC-2) | Deny |
| View in-progress game listing | Allow | Allow | Allow | Read-only (SEC-2) | Deny |
| View finalized games and stats | Allow | Allow | Allow | Allow (SEC-2) | Deny |
| View member names, roles, and invite status | Allow | Allow | Allow | Allow (SEC-2) | Own invite summary only |
| View member email addresses | Allow for management | Allow for management | Deny | Deny | Deny |
| Start a team game | Allow | Allow | Allow | Deny | Deny |
| Resume and track an in-progress game | Allow | Allow | Allow | Deny | Deny |
| Finalize an in-progress basketball game | Allow | Allow | Allow | Deny | Deny |
| Finalize or reopen a soccer game | Allow | Allow | Deny | Deny | Deny |
| Edit team name or nickname | Allow | Allow | Deny | Deny | Deny |
| Delete team | Allow | Deny | Deny | Deny | Deny |
| Add, reactivate, or remove a roster entry | Allow | Allow | Deny | Deny | Deny |
| Edit team-specific jersey/position fields | Allow | Allow | Deny | Deny | Deny |
| Edit player identity fields | Relationship required | Relationship required | Relationship required | Relationship required | Relationship required |
| Permanently delete a player record | Creator only | Creator only | Creator only | Creator only | Creator only |
| Create a tournament while setting up a game | Allow | Allow | Allow | Deny | Deny |
| Rename or delete a tournament | Allow | Allow | Deny | Deny | Deny |
| Invite a scorer | Allow | Allow | Deny | Deny | Deny |
| Invite an admin | Allow | Deny | Deny | Deny | Deny |
| Invite a viewer | Allow (SEC-2) | Allow (SEC-2) | Deny | Deny | Deny |
| Remove a scorer or viewer | Allow | Allow | Deny | Deny | Deny |
| Remove or change an admin | Allow | Deny | Deny | Deny | Deny |
| Remove or change the owner | Deny; transfer needs a future flow | Deny | Deny | Deny | Deny |
| Change scorer/viewer role | Allow | Allow | Deny | Deny | Deny |
| Correct finalized stats | Allow | Allow | Deny | Deny | Deny |
| Reassign primary recorder | Allow | Allow | Deny | Deny | Deny |
| Merge players | Allow when owner/admin on every involved team | Same | Deny | Deny | Deny |
| Delete a cloud game | Allow | Allow | Deny | Deny | Deny |
| Accept or decline invite | Not applicable | Not applicable | Not applicable | Not applicable | Own invite only |
| Leave team | Deny until ownership is transferred | Allow | Allow | Allow (SEC-2) | Decline instead |

Rules that cut across the table:

- Accepted membership is required for every team-derived read or write.
- Finalization ends normal raw game/stat writes. Later changes use explicit correction or
  admin actions rather than editing recorder submissions in place.
- Soccer finalization is publication-backed: owner/admin only, one locked healthy primary,
  canonical snapshot, and reason-required audited reopen. Scorers may finish only queued
  pre-finalization non-primary audit uploads.
- Team role alone never grants permission to edit a player's global identity or delete
  the global player record.
- Owner transfer is not implied by role editing and needs a dedicated future design.

---

## 3. Target player-relationship matrix

Player identity and roster membership are separate resources. A global player can appear
on more than one team, while jersey number, position, and active status belong to each
`team_players` row.

| Resource or action | Creator | Guardian | Team owner/admin only | Scorer | Viewer | Pending invitee |
|---|---|---|---|---|---|---|
| View player identity outside a team | Allow | Allow | No relationship from role alone | Deny | Deny | Deny |
| View player through an accepted team | Allow if related | Allow if related | Allow | Allow | Allow (SEC-2) | Deny |
| Edit first/last/nickname identity fields | Allow | Allow | Only if also creator/guardian | Only if creator/guardian | Only if creator/guardian | Only if creator/guardian |
| Edit jersey, position, or active status | Only if team owner/admin | Only if team owner/admin | Allow | Deny | Deny | Deny |
| Add known player to a team | Only if team owner/admin | Only if team owner/admin | Allow when player is available in pool | Deny | Deny | Deny |
| Claim guardianship | Allow if not already linked | Allow if not already linked | Allow (SEC-4) | Allow (SEC-4) | Deny | Deny |
| Remove own guardianship | Allow | Allow | Not applicable | Not applicable | Not applicable | Not applicable |
| Remove another guardian | Allow | Deny | Allow for a team containing player (SEC-4) | Deny | Deny | Deny |
| Delete global player | Allow | Deny unless creator | Deny unless creator | Deny unless creator | Deny unless creator | Deny |
| Merge player records | Relationship does not grant merge | Same | Owner/admin on every involved team | Deny | Deny | Deny |

Guardian claims remain self-service in SEC-4, but they must be made from an authorized
player context. Knowing a player UUID alone must not be sufficient. Guardianship does not
grant team management, stat correction, or game tracking rights.

---

## 4. Account and app-level matrix

| Resource or action | Signed out | Active user | Suspended user | App admin |
|---|---|---|---|---|
| Authenticate or recover account | Allow | Allow | Allow | Allow |
| Use configured cloud app routes | Deny | Allow subject to relationships | Deny | Allow subject to relationships |
| Edit account profile and identities | Deny | Own account | Own account access flow only | Own account |
| Use local app/sport preferences | Local-only mode only | Allow | Deny during authenticated suspended session | Allow |
| Export/import device parked games | Local-only mode only | Own device data | Deny during authenticated suspended session | Own device data |
| Manage owned seasons | Deny | Own seasons | Deny | Own seasons unless an explicit support RPC exists |
| Manage app access state | Deny | Deny | Deny | Allow through narrow RPCs |
| Bypass team RLS | Deny | Deny | Deny | Deny |
| Read all audit events | Deny | Team-scoped owner/admin only | Deny | Allow |

When Supabase is not configured, StatKeeper's existing local-only mode remains available
without an account. SEC-5 applies to authenticated cloud sessions and must not silently
turn app-admin status into broad team-data access.

---

## 5. Pre-SEC-1 implementation inventory

This retained audit snapshot describes the effective model before SEC-1. Unless stated otherwise,
current team policies treat any `team_members` row as membership and do not require
`accepted_at`.

SEC-1 closed findings SEC0-01 through SEC0-12 in migration 035 and the corresponding
client permission cleanup. SEC-2 closed SEC0-14 in migration 036. SEC-3 shipped the
approved invite-link contract in migration 037. SEC-4 closed SEC0-13 in migration 038
with contextual claims, bounded identity edits, and authorized guardian removal. SEC-5
closed SEC0-15 in migration 039 with a PostgREST request gate and app-admin-only RPCs.

| Resource | Current effective access | Primary source |
|---|---|---|
| `profiles` | Own profile plus rows allowed through the team-share policy; every visible row includes email, and owners can resolve owned-team profiles | `013_rls_auth_uid_cached.sql` |
| `teams` | Owner or any membership row reads; owner/admin updates; owner deletes | `013_rls_auth_uid_cached.sql` |
| `team_members` | User reads/updates/deletes own row; owner reads/deletes all; direct self-insert is allowed | `011_team_invites.sql`, `013_rls_auth_uid_cached.sql` |
| Member profile RPC | Owner/admin role can list all members and emails | `get_team_members_with_profiles` in migration 011 |
| Invite RPCs | Owner/admin role can look up and invite; accepted state is not checked | `lookup_user_by_email`, `invite_team_member` in migration 011 |
| `seasons` | Owner and members of a season's teams read; owner alone writes/deletes | `018_seasons_and_roster_junction.sql` |
| `team_players` | Team members read; owner/admin writes | `018_seasons_and_roster_junction.sql` |
| `players` | Creator, guardian, or team member reads; creator/guardian updates; creator deletes | `018_seasons_and_roster_junction.sql` |
| `player_guardians` | Self and team members read; anyone can insert a link for self; self/creator deletes | `018_seasons_and_roster_junction.sql` |
| `games` | Team members read/insert/update; owner/admin deletes | `013_rls_auth_uid_cached.sql` |
| `game_stats` | Team members read; recorder inserts/updates own rows | `013_rls_auth_uid_cached.sql` |
| `player_checkouts` | Team members read; user writes/deletes own rows | `013_rls_auth_uid_cached.sql` |
| `stat_corrections` | Team members read; owner/admin writes | `013_rls_auth_uid_cached.sql` |
| Primary recorder RPC | Owner/admin role can reassign | `014_set_primary_recorder.sql` |
| `tournaments` | Team members read/create; owner/admin updates/deletes | `016_tournaments.sql` |
| Player merge RPCs | Owner/admin on every involved team can preview/execute | `024_player_merge_rpcs.sql` |
| `player_merge_audit` | User reads only merges they performed | `025_player_merge_audit_select_policy.sql` |
| `shot_chart` | Team members read; recorder writes/deletes own rows | `032_shot_chart.sql` |
| Soccer `game_events` / checkpoints | Team members read; owner/admin/scorer writes only their own non-final recorder stream; after final, a non-primary recorder may finish only pre-finalization audit uploads; viewers read only | Migrations 042-046 |
| Soccer primary recorder RPC | Team owner/admin or personal-game owner selects a current conflict-free stream; scorer/viewer denied | `set_soccer_primary_recorder` in migration 045 |
| Soccer primary history | Game readers can inspect immutable selection history; direct writes denied | Migration 045 |
| Soccer canonical publications | Game readers inspect the active canonical snapshot; history is append-only and client writes are denied | Migration 046 |
| Soccer finalize/reopen RPCs | Team owner/admin or personal-game owner only; exact primary checkpoint and final projection required; reopen requires reason | Migration 046 |
| `client_sync_errors` | User inserts/reads own rows | `033_client_sync_errors.sql` |
| Authenticated app shell | Any authenticated Supabase user enters; no app status exists | `src/App.tsx`, `src/context/AuthContext.tsx` |
| Local parked games | Device-local records scoped by stored owner id | `src/lib/gameParking.ts` |
| App-level access | Active accounts enter; pending/suspended accounts stop before app providers; app-admin changes use narrow RPCs | Migration 039, `src/App.tsx`, `src/lib/appAccess.ts` |
| Access audit history | Team owner/admin reads own team events; app admin reads all; direct writes denied | Migration 040, `src/components/AuditTrailPanel.tsx` |

---

## 6. Audit findings and phase ownership

Severity describes authorization impact if a caller bypasses the UI and uses the
Supabase API directly.

| ID | Severity | Finding | Evidence | Owner phase |
|---|---|---|---|---|
| SEC0-01 | Critical | Pending invites currently satisfy team membership checks and can inherit team reads/writes before acceptance. | Membership subqueries in migrations 013, 016, 018, and 032 omit `accepted_at`. | SEC-1 |
| SEC0-02 | Critical | `team_members_insert_self` permits a signed-in user to insert their own membership row for a known team and choose any currently valid role. | Migration 013 checks only `user_id = auth.uid()`. | SEC-1 |
| SEC0-03 | Critical | `team_members_update_accept` permits changes to the caller's whole membership row, not only `accepted_at`; role and team reassignment are not constrained by the policy. | Migration 013 `USING`/`WITH CHECK` only constrain `user_id`. | SEC-1 |
| SEC0-04 | Critical | `invite_team_member` upserts any existing member without target hierarchy checks, so an authorized admin call can reset an owner/admin row to a pending lower role. | Migration 011 unconditional `ON CONFLICT ... UPDATE role, accepted_at`. | SEC-1 |
| SEC0-05 | High | Pending owner/admin rows also satisfy privileged correction, primary-recorder, invite, member-list, and merge RPC checks. | Migrations 009/011/014/024 check role but not acceptance. | SEC-1 |
| SEC0-06 | High | Recorder-owned stat, checkout, and shot writes verify the actor column but do not verify accepted membership, game/team relationship, player/game relationship, or final-game immutability. | Policies in migrations 013 and 032. | SEC-1 |
| SEC0-07 | High | Any membership row can update any column on a team game, including final games; finalization and raw-stat immutability are client conventions only. | `games_update_member` in migration 013; `useFinalizeGame.ts`. | SEC-1 |
| SEC0-08 | High | There is no display-only member identity surface: any visible `profiles` row includes email, and the member RPC returns email to owner/admin roles, including pending admins. | `profiles_select_own` in migration 013; `profiles.email` and `get_team_members_with_profiles` from migration 011. | SEC-1 |
| SEC0-09 | Medium | Admin member removal is approved and shown by the UI, but direct RLS allows only owner or self deletion; admins receive an RLS error. The UI also offers removal for admin targets. | `Teams.tsx`; `team_members_delete` in migration 013. | SEC-1 |
| SEC0-10 | Medium | `/team/manage` shows add/edit/remove roster controls to scorers even though roster RLS rejects them; team list and Advanced settings similarly show edit/delete controls beyond the caller's authority. | `Teams.tsx`, `Admin.tsx`. | SEC-1 |
| SEC0-11 | Medium | Cloud Games lists only games created by the current user, so accepted scorers/admins cannot discover and resume teammates' games from that page. Other team pages can display those games. | `Games.tsx` filters `created_by`; `TeamInfo.tsx` loads by `team_id`. | SEC-1 |
| SEC0-12 | Medium | Team Info asks an owner/admin-only RPC for member data for every role; scorers receive an unavailable member card instead of an accepted-member-safe summary. | `TeamInfo.tsx`; `get_team_members_with_profiles` in migration 011. | SEC-1 |
| SEC0-13 | Medium | Guardian self-insert requires only `user_id = auth.uid()` and can target any known player UUID; team owner/admin removal is not implemented. | Closed by RPC-only guardian writes in migration 038. | SEC-4 (closed) |
| SEC0-14 | Planned | There is no read-only viewer role, and existing policies assume every member may write games. | Team role check and game policies in migrations 002/013. | SEC-2 |
| SEC0-15 | Closed | Active/pending/suspended status and a separate app-admin role are enforced at the Data API boundary and app shell. | Migration 039, `App.tsx`, `AuthContext.tsx`. | SEC-5 (closed) |
| SEC0-16 | Closed for approved first scope | Member, invite-link, and app-access changes now have a unified durable trail; player merge remains separate and other event families are documented follow-ups. | Migration 040. | SEC-6 (closed) |

### SEC-1 minimum server-side scope

The audit makes a migration mandatory for SEC-1. UI helpers alone cannot close findings
SEC0-01 through SEC0-08. SEC-1 should, at minimum:

1. Replace direct self-insert/update/delete member policies with narrow invite acceptance,
   decline, leave, and role-safe member-management RPCs; owner self-removal is denied.
2. Require accepted membership in every team-derived policy and privileged RPC.
3. Enforce target-role hierarchy for invite, role-change, and removal operations.
4. Bind stat, checkout, and shot writes to an accepted team member, the referenced game,
   and an appropriate player; reject normal raw writes after finalization.
5. Give accepted members a limited member-summary read path without exposing email.
6. Make the app permission helper and controls match the server contract.

---

## 7. Phase boundaries

| Phase | Takes ownership of |
|---|---|
| SEC-1 | Accepted-membership enforcement, current role hierarchy, member/profile privacy, game/stat write hardening, shared UI permission helpers, and current owner/admin/scorer UI drift. |
| SEC-2 | `viewer` DB role, read-only RLS paths, and removal of start/resume/track/finalize controls for viewers. |
| SEC-3 | Expiring single-use scorer/viewer invite links and their create/redeem/revoke RPCs. |
| SEC-4 | Authorized guardian claims, guardian removal, identity-field boundaries, and viewer exclusion. |
| SEC-5 | Account status, app-admin role, suspended-session gate, and narrow app-access RPCs. |
| SEC-6 | Durable action-specific audit writes and team/app-admin audit views. |

SEC-1 should not add viewer, invite-link, app-status, or unified audit schema. It may add
small RPCs needed to make the existing three-role model safe.

---

## 8. Security regression scenarios

These are the stable cross-phase scenarios. The SEC-0 branch documents them; rows owned
by SEC-1 or later may fail until that phase ships.

| Scenario | Expected result | First enforcing phase |
|---|---|---|
| Pending scorer opens a direct Team Info or game URL | Invite summary remains available, but team/game data is denied until acceptance. | SEC-1 |
| Pending admin calls member, correction, primary-recorder, or merge APIs | Every call is denied. | SEC-1 |
| Authenticated non-member inserts or rewrites their own `team_members` row | Denied; joining happens only through an invite acceptance/redeem action. | SEC-1 |
| Owner invites an admin or scorer | Invite is created without changing protected existing owner/admin memberships. | SEC-1 |
| Admin invites or removes a scorer | Allowed. | SEC-1 |
| Admin attempts to invite, remove, or change an owner/admin | Denied in UI and server. | SEC-1 |
| Scorer opens Team Info and starts/resumes/tracks/finalizes a game | Allowed after acceptance. | SEC-1 |
| Scorer opens Team Manage or Advanced destructive tools | Read-only/unavailable state; no privileged controls or successful writes. | SEC-1 |
| Scorer attempts correction, primary reassignment, merge, team delete, or game delete | Denied in UI and server. | SEC-1 |
| Recorder submits a stat/shot for an unrelated or final game | Denied. | SEC-1 |
| Accepted member reads team member summary | Names/roles are visible; email is withheld from non-managers. | SEC-1 |
| Viewer opens team, roster, schedule, in-progress list, and final stats | Read-only views load; Start/Resume/Track/Finalize are absent and direct writes fail. | SEC-2 |
| Viewer attempts guardianship claim | Denied. | SEC-4 |
| Guardian edits player identity but attempts roster-field edit | Identity update succeeds; roster update is denied without owner/admin team role. | SEC-4 |
| Suspended user returns with an authenticated session | Suspended state replaces cloud app routes; no team bypass or offline continuation. | SEC-5 |
| App admin opens a team without membership | Team data remains denied unless a narrow support action explicitly applies. | SEC-5 |
| Member role/removal or invite-link action succeeds | Action-specific audit event records actor, target, team, action, and timestamp without token secrets. | SEC-6 |

---

## 9. Review rule for later phases

Every SEC implementation PR should link this matrix and state:

- which rows it begins enforcing,
- which current findings it closes,
- which rows remain future behavior,
- which UI and server tests prove the same decision.

If a later implementation needs a different product decision, update this matrix in the
same PR and call out the decision explicitly. Do not silently encode a different rule in
UI code or SQL.
