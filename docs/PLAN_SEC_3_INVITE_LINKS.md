# Plan: SEC-3 Invite links

SEC-3 implements shareable team invite links.

Depends on: SEC-0, SEC-1, SEC-2.

---

## 1. Goal

Let owner/admin users add parents or team helpers without knowing their email in advance.

The inviter creates a link, shares it externally, and the invitee signs in or signs up to
join the team.

---

## 2. Recommended Model

Use a DB-backed token table rather than signed stateless links.

Reasons:

- revocable,
- expirable,
- auditable later,
- listable in team management,
- easier to extend to multi-use links.

Default v1:

- URL: `/#/invite/:token`
- single-use token,
- default expiry: 7 days,
- fixed role selected when link is created,
- owner/admin can create link,
- owner/admin can revoke link.

---

## 3. Scope

- Add `team_invite_links` table.
- Add RPCs to create, resolve, redeem, and revoke links.
- Add Team Manage UI for create/copy/revoke invite links.
- Add route/page `/#/invite/:token`.
- Support signed-out users returning to the invite after auth.
- Preserve existing email invite flow.
- Add regression tests for owner/admin/link/invitee cases.

---

## 4. Out Of Scope

- Sending email/SMS.
- Multi-use/unlimited links in v1.
- Public team pages.
- Org/league invites.
- QR codes.
- Invite analytics beyond basic audit fields.

---

## 5. Data Model Sketch

Table: `team_invite_links`

Columns:

- `id uuid primary key`
- `team_id uuid not null references teams(id) on delete cascade`
- `role text not null`
- `token text not null unique`
- `created_by uuid not null references profiles(id)`
- `expires_at timestamptz not null`
- `redeemed_by uuid null references profiles(id)`
- `redeemed_at timestamptz null`
- `created_at timestamptz not null default now()`

RPCs:

- `create_team_invite_link(p_team_id uuid, p_role text, p_expires_in_days int)`
- `get_team_invite_link(p_token text)`
- `redeem_team_invite_link(p_token text)`
- `revoke_team_invite_link(p_link_id uuid)`

Security:

- token must be cryptographically random and URL-safe.
- create/revoke require owner/admin.
- redeem requires signed-in user.
- resolve can return only limited team info for signed-out users.
- expired/redeemed/revoked links cannot be redeemed.

---

## 6. Q&A Session

Ask these one at a time before implementation.

1. Which roles can invite links create?
   - Recommended: Scorer and Viewer if SEC-2 shipped; otherwise Scorer only.
   - Option B: Scorer/Admin/Viewer.
   - Option C: Scorer only for v1.

2. Should links be single-use or multi-use?
   - Recommended: Single-use for v1.
   - Option B: Multi-use with max uses.
   - Option C: Unlimited until expiry.

3. What should default expiry be?
   - Recommended: 7 days.
   - Option B: 24 hours.
   - Option C: 30 days.

4. Should signed-in invitees auto-join or confirm first?
   - Recommended: Confirm first: "Join Team as Role?"
   - Option B: Auto-join after opening valid link.

5. Should link creation show active links in v1?
   - Recommended: Yes, list active links with Copy/Revoke.
   - Option B: Only show the last created link.

---

## 7. Resolved Decisions

- Invite links can create Scorer and Viewer only.
- Invite links are single-use in v1.
- Default expiry is 7 days.
- Signed-in invitees confirm before joining.
- Team Manage shows active invite links with role, expiry, Copy, and Revoke.

---

## 8. Acceptance Criteria

- [x] Owner/admin can create and copy an invite link.
- [x] Unauthorized users cannot create/revoke links.
- [x] Signed-out invitee can authenticate and return to invite.
- [x] Signed-in invitee can redeem link and join team.
- [x] Redeemed/expired/revoked links cannot be reused.
- [x] Existing email invite flow still works.

---

## 9. Implementation Result

- Added migration `037_team_invite_links.sql` with a direct-access-denied token table and
  narrow create, list, resolve, redeem, and revoke RPCs.
- Links are cryptographically random, single-use, scorer/viewer only, and expire after
  7 days in the UI. The create RPC bounds expiry to 1-30 days.
- Team Manage lists active links with role, expiry, Copy, and Revoke controls while
  preserving the existing email-invite flow.
- `/#/invite/:token` resolves limited team context before authentication, preserves the
  invite route through email/password or Google OAuth, and asks the signed-in user to
  confirm before joining.
- Redemption locks the link row and creates accepted membership atomically. Existing
  owners, accepted members, and users with a pending email invite cannot consume a link.
- Added focused token/URL/auth-return tests and manual regression cases. Database role and
  concurrency scenarios remain manual because the repository has no local Supabase
  integration-test harness.
