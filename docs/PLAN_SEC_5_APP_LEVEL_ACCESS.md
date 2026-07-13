# Plan: SEC-5 App-level access

SEC-5 adds optional platform-level access control separate from team roles.

Depends on: AUTH-2. Can happen before SEC-2/SEC-3 if private beta or suspension controls
become urgent.

---

## 1. Goal

Control who can use StatKeeper after authentication.

Supabase Auth proves identity. App-level access decides whether that identity is active,
pending approval, suspended, or allowed to perform platform support/admin actions.

---

## 2. Proposed Concepts

Account status:

- `active`
- `pending`
- `suspended`

App role:

- `user`
- `app_admin`

These should not replace team roles. A user can be app-level `user` and team-level `owner`
on one team, `scorer` on another, and `viewer` on another.

---

## 3. Scope

- Add app access table or profile extension.
- Load app access state after login.
- Gate the authenticated app shell for pending/suspended users.
- Add app-admin-only view under Settings or a new admin route.
- Allow app admin to approve/suspend/reactivate users.
- Add clear user-facing copy for pending/suspended states.
- Keep local/offline mode behavior understandable.

---

## 4. Out Of Scope

- Billing.
- Organization-level administration.
- Full support dashboard with data editing.
- Impersonation.
- Password/email management.

---

## 5. Data Model Options

Option A: add columns to `profiles`.

- `app_status text default 'active'`
- `app_role text default 'user'`

Pros: simple.

Cons: mixes profile data with access control.

Option B: new `account_access` table.

- `user_id uuid primary key references profiles(id)`
- `status text not null default 'active'`
- `app_role text not null default 'user'`
- `updated_by uuid null`
- `updated_at timestamptz not null`

Pros: clearer boundary and easier auditing.

Cons: new table/RLS/RPCs.

Recommended: Option B.

---

## 6. Q&A Session

Ask these one at a time before implementation.

1. Should new Google/email signups be active by default?
   - Recommended: Yes for now.
   - Option B: Pending by default for private beta.
   - Option C: Active only for allowlisted domains/emails.

2. Do we need app admins immediately?
   - Recommended: Only if pending/suspended workflow ships.
   - Option B: Add status table now but app-admin UI later.

3. Where should app-admin tools live?
   - Recommended: Settings -> Advanced -> App access, visible only to app admins.
   - Option B: New `/app-admin` route.

4. Should suspended users keep local/offline access?
   - Recommended: No for cloud-authenticated session; show suspended state.
   - Option B: Yes, allow offline-only local tracking.

5. Should app admins bypass team RLS?
   - Recommended: No. App admin support actions should use explicit RPCs, not broad bypass.
   - Option B: Limited read-only support RPCs.

---

## 7. Resolved Decisions

- New Google/email signups are active by default.
- App admins are only needed when pending/suspended workflow ships.
- App-admin tools live under Settings -> Advanced -> App access.
- Suspended users do not keep local/offline access through that authenticated session.
- App admins do not bypass team RLS; support/admin actions use explicit narrow RPCs if
  needed later.

---

## 8. Acceptance Criteria

- Active users can use the app normally.
- Pending users see a pending/access message.
- Suspended users see a suspended/access message and cannot access cloud app routes.
- App admins can view/manage access state if the UI ships.
- Team roles remain unchanged and separate.
