# Plan: AUTH-2 Account management

Status: implemented.

Execution plan for the second authentication slice from
[PLAN_APP_FOUNDATION_ROADMAP.md](PLAN_APP_FOUNDATION_ROADMAP.md). AUTH-2 fills in the
Account section created by NAV-2 with profile editing, connected sign-in method display, and
manual Google account linking.

AUTH-2 depends on AUTH-1 because the Google provider, OAuth redirect behavior, and profile
defaults must exist before account management can link or display Google identity state.

---

## 1. Goal

Give signed-in users a focused Account page where they can understand and manage their
StatKeeper account identity without mixing account controls into sport settings or advanced
admin tools.

Primary requirements:

- Show the signed-in email.
- Show and edit StatKeeper display name.
- Show connected sign-in methods.
- Allow a logged-in user to manually link Google.
- Keep Google profile data default-only; StatKeeper display name remains editable.
- Keep all account identity sport-agnostic.

---

## 2. Current and expected prerequisites

Current repo state before the auth roadmap:

- `profiles.display_name`, `profiles.avatar_url`, and `profiles.email` exist through
  migrations.
- Profile rows are keyed by Supabase auth user id.
- RLS allows users to update their own profile.
- Current `AuthContext` exposes `user`, `session`, `signOut`, and auth loading state.

Expected after NAV-2:

- `/settings/account` exists as the account destination.
- Account page currently shows basic signed-in email/sign-out/local-mode state.

Expected after AUTH-1:

- Google OAuth sign-in/sign-up exists.
- Same-Gmail automatic linking has been tested.
- Google-friendly profile defaults are handled on new profile creation.
- Google provider and redirect URLs are configured in Supabase/Google.

---

## 3. Product decisions

- Account is a separate Settings tab/page.
- StatKeeper display name is independent from team/player names.
- Google name/avatar can seed defaults but should not overwrite user-edited StatKeeper
  profile fields after account creation.
- Manual Google linking belongs in AUTH-2.
- Account management applies across all sports. No Basketball/Soccer-specific account
  behavior.
- Do not build account deletion in AUTH-2.
- Do not build sign-in method unlink/removal in AUTH-2 unless explicitly requested later.

> **Callout: linked identity safety**
>
> AUTH-2 should show connected methods and allow adding Google. It should not remove sign-in
> methods yet. Unlinking is technically supported by Supabase, but a rushed unlink flow can
> strand a user if they remove their only practical sign-in path. Treat unlink/removal as a
> future phase with recovery rules and confirmation copy.

---

## 4. Account page target UX

Route:

```text
/#/settings/account
```

Recommended sections:

```text
Account
  Profile
    Email
    Display name [editable]
    Avatar [display-only or deferred]

  Sign-in methods
    Email/password: connected or unavailable
    Google: connected / link Google

  Session
    Sign out
```

The page should stay short. Account should not become a second admin page.

---

## 5. Data model and profile behavior

Source of truth:

- `profiles.display_name` is the app-facing display name.
- `profiles.email` is used for invite lookup/display support.
- `profiles.avatar_url` may display a Google/default avatar if available.
- `auth.user.email` remains the current authenticated email from Supabase Auth.
- `auth.user.user_metadata` can mirror display/profile values, but app UI should prefer
  `profiles`.

Recommended behavior:

- Load the current user's profile row on Account page mount.
- If no profile row exists, create/repair a minimal row for the current user:
  - `id = user.id`
  - `email = user.email`
  - `display_name = user.user_metadata.display_name/full_name/name/email fallback`
  - optional `avatar_url`
- Editing display name updates `profiles.display_name`.
- Optionally update auth metadata through `supabase.auth.updateUser({ data })` after the
  profile update succeeds, but do not make auth metadata the only source of truth.
- Do not overwrite display name from Google on every sign-in.

No schema migration is expected for AUTH-2 if AUTH-1 has already updated profile defaults.

---

## 6. Connected methods behavior

Use Supabase Auth identities for connected-method display.

Recommended display:

- `email`: "Email/password" or "Email" depending on provider label returned by Supabase.
- `google`: "Google".
- Unknown providers: render provider id as a fallback.

Manual Google link:

- If Google identity is not connected, show "Link Google".
- Clicking "Link Google" calls Supabase identity linking for provider `google`.
- Use the same OAuth redirect strategy from AUTH-1 so GitHub Pages/local paths return
  cleanly.
- After OAuth completes and returns to the app, reload identities/profile state.
- If Google is already connected, show "Connected" and do not offer another link action.

Unlinking:

- Deferred.
- If it is added later, require at least one other usable sign-in method and strong
  confirmation.

---

## 7. Implementation tasks

### D1: Account profile service

- [x] Add a small helper module for current-user profile load/update/repair.
- [x] Load `profiles.id`, `display_name`, `email`, and `avatar_url` for `auth.user.id`.
- [x] Repair missing profile row if needed.
- [x] Update `profiles.display_name` with trim/validation.
- [x] Defer auth metadata mirroring; `profiles.display_name` remains the app source of truth.
- [x] Keep errors user-visible but concise.

Suggested file:

- `src/lib/accountProfile.ts`

### D2: Auth context account helpers

- [x] Add or expose account methods only if they are broadly useful:
  - `getUserIdentities()`
  - `linkGoogleIdentity()`
  - `refreshUser()` if needed after metadata changes.
- [x] Keep low-level profile CRUD outside `AuthContext` unless the existing architecture
  clearly favors context methods.
- [x] Reuse AUTH-1 redirect helper for manual Google linking.

Potential APIs:

```ts
supabase.auth.getUserIdentities()
supabase.auth.linkIdentity({ provider: 'google' })
supabase.auth.updateUser({ data: { display_name: nextName } })
```

Implementation should confirm exact `linkIdentity` option typing against the installed
`@supabase/supabase-js` version before coding redirect options.

### D3: Account settings UI

- [x] Expand the NAV-2 Account section/page.
- [x] Show signed-in email.
- [x] Show editable display name field.
- [x] Save display name with loading/success/error states.
- [x] Show avatar only if available and it does not complicate layout.
- [x] Show connected methods from `getUserIdentities()`.
- [x] Show "Link Google" when Google is not connected.
- [x] Show "Google connected" when present.
- [x] Keep Sign Out on the Account page.
- [x] Show local/offline mode message when Supabase is not configured.

### D4: Manual Google linking flow

- [x] Add "Link Google" action for logged-in users.
- [x] Use Supabase `linkIdentity({ provider: 'google' })`.
- [x] Ensure manual linking is enabled in Supabase project auth configuration.
- [x] Return to the Account page when possible.
- [x] Reload identities after return.
- [x] Show clear failure messaging if linking is disabled or provider setup is incomplete.

### D5: Documentation

- [x] Update README auth/account feature notes.
- [x] Update `docs/REGRESSION_TESTING.md` with account management checks.
- [x] Update `docs/AGENT_CODEBASE_OVERVIEW.md` auth/account route notes.
- [x] Update `AGENTS.md` only if there is an operational gotcha agents should see quickly.
- [x] Update `docs/PLAN_APP_FOUNDATION_ROADMAP.md` if AUTH-2 decisions change.

---

## 8. Suggested file list

Likely touched:

- `src/components/settings/AccountSettings.tsx`
- `src/context/AuthContext.tsx`
- `src/lib/accountProfile.ts`
- `src/lib/authRedirect.ts` or the AUTH-1 redirect helper location
- `docs/REGRESSION_TESTING.md`
- `docs/AGENT_CODEBASE_OVERVIEW.md`
- `README.md`

Possibly touched:

- `src/pages/Settings.tsx`
- `src/lib/settingsNavigation.ts`
- `src/lib/accountProfile.test.ts`
- `AGENTS.md`

No Supabase migration should be required unless implementation reveals that profile defaults
or RLS still need adjustment after AUTH-1.

---

## 9. Acceptance criteria

- `/settings/account` shows current signed-in email.
- `/settings/account` shows current StatKeeper display name from `profiles`.
- User can edit and save display name.
- Saved display name persists after refresh/sign-out/sign-in.
- Existing team/member displays that read `profiles.display_name` reflect the updated name
  where appropriate.
- Connected sign-in methods are listed.
- Google-connected users see Google as connected.
- Email/password-only users can start manual Google linking from Account.
- Manual Google linking returns to the app and updates connected-method display.
- Sign out still clears persisted game storage as it does today.
- Supabase-unconfigured mode shows a local/offline account state and does not crash.
- No sport-specific account behavior is introduced.

---

## 10. Regression tests

Automated:

- Run `pnpm test`.
- Run `pnpm build`.
- Run `pnpm lint` and note existing Fast Refresh warnings if unchanged.
- Add tests for profile helper fallback/repair logic if extracted.

Manual:

- Supabase disabled:
  - open `/settings/account`.
  - verify local/offline state renders without cloud calls.
- Email/password account:
  - open `/settings/account`.
  - edit display name.
  - refresh and verify persisted display name.
  - sign out and sign back in.
- Google-created account:
  - verify profile defaults display.
  - edit display name.
  - sign out/in with Google and verify Google does not overwrite edited name.
- Connected methods:
  - email/password account shows email method.
  - Google account shows Google method.
  - same-Gmail linked account shows both if Supabase returns both identities.
- Manual link:
  - start from email/password account.
  - click Link Google.
  - complete Google OAuth.
  - return to account page.
  - verify Google appears connected.
- Team/member display:
  - update display name.
  - verify team member/invite displays still work.

---

## 11. Risks and guardrails

- **Manual linking setup:** Supabase manual linking may need to be enabled in project auth
  configuration. Surface this clearly if the API returns a setup error.
- **Provider return path:** reuse AUTH-1 redirect logic so GitHub Pages and local dev do not
  diverge.
- **Display name source drift:** prefer `profiles.display_name` for app display; auth
  metadata is optional mirror data.
- **Google overwrite risk:** do not re-import Google profile name over a user-edited display
  name during normal sign-in.
- **Unlink risk:** do not implement unlink/remove in AUTH-2 unless separately planned.
- **RLS/profile repair:** if profile repair fails due RLS, show an actionable error and do
  not silently proceed with incomplete profile state.
- **Account scope creep:** no account deletion, password reset overhaul, MFA, avatar upload,
  or email-change flow in AUTH-2.

---

## 12. Pre-handoff decisions for implementation

Recommended defaults are listed first.

- **Display name source:** `profiles.display_name`.
- **Auth metadata:** optional mirror after successful profile update.
- **Avatar:** display-only if already present; no upload/edit in AUTH-2.
- **Connected methods:** display list from `getUserIdentities()`.
- **Manual Google linking:** include.
- **Unlink/removal:** defer.
- **Account deletion:** defer.
- **Password/email changes:** defer.

No additional product decisions are required before implementation if these defaults are
accepted.

---

## 13. Research references

- Supabase `getUserIdentities`: `https://supabase.com/docs/reference/javascript/auth-getuseridentities`
- Supabase `linkIdentity`: `https://supabase.com/docs/reference/javascript/auth-linkidentity`
- Supabase `unlinkIdentity`: `https://supabase.com/docs/reference/javascript/auth-unlinkidentity`
- Supabase `updateUser`: `https://supabase.com/docs/reference/javascript/auth-updateuser`
- Supabase identity linking guide: `https://supabase.com/docs/guides/auth/auth-identity-linking`
