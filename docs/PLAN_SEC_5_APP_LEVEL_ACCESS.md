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

- [x] Active users can use the app normally.
- [x] Pending users see a pending/access message.
- [x] Suspended users see a suspended/access message and cannot access cloud app routes.
- [x] App admins can view/manage access state.
- [x] Team roles remain unchanged and separate.

---

## 9. Implementation Result

- Added migration `039_app_level_access.sql` with a separate `account_access` table,
  active-by-default profile trigger, status/role helpers, self-access RPC, and narrow
  app-admin list/update RPCs.
- Registered `enforce_app_access_request` as the PostgREST pre-request hook. It blocks
  pending, suspended, and missing access records before current Data API table or RPC
  requests run while leaving the self-access RPC available to render the gate.
- Added `supabase/scripts/bootstrap_app_admin.sql` as the reviewed manual path for the
  first app administrator. The public API has no first-user or first-caller promotion path.
- `AuthContext` loads app access after authentication. Pending, suspended, or unverifiable
  sessions stop before `SettingsProvider`, `GameProvider`, the app shell, and OAuth return
  navigation mount. A shared Data API response interceptor locks an open session as soon as
  any request returns `APP_ACCESS_*`; sessions also recheck on focus, reconnect, and every
  minute as a bounded fallback.
- Settings -> Advanced shows App access only to active app admins. Admins can search up to
  200 accounts and set status/role; the server prevents self-suspension or self-demotion.
- App-admin authority does not alter team roles or bypass team RLS. The pre-request hook
  covers the current PostgREST Data API; adding Supabase Realtime, Storage, or another API
  requires equivalent access enforcement in that service.
- The client treats a missing `get_my_app_access` RPC as active/user only to preserve the
  deployment window before migration 039 is applied. Once 039 exists, all other access
  verification errors fail closed.
