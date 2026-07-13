# Plan: AUTH-1 Google sign-in and sign-up

Execution plan for the first authentication slice from
[PLAN_APP_FOUNDATION_ROADMAP.md](PLAN_APP_FOUNDATION_ROADMAP.md). AUTH-1 adds Google OAuth
as the primary sign-in/sign-up path while keeping the existing email/password flow as a
fallback.

AUTH-1 can happen after NAV-1/NAV-2, but it must happen before AUTH-2 account management.

---

## 1. Goal

Add "Continue with Google" to the auth entry point so users can create or access a
StatKeeper account with Google.

Primary requirements:

- Google is the primary CTA.
- Email/password remains available.
- Existing accounts using the same Gmail address can link to Google and keep their existing
  StatKeeper data.
- Supabase-unconfigured/offline-local mode still works.
- HashRouter and GitHub Pages deployment paths still return users to the app correctly.

---

## 2. Current state

Current auth implementation:

- `src/context/AuthContext.tsx`
  - tracks `user`, `session`, `loading`, and `isConfigured`.
  - exposes `signUp(email, password, displayName)`.
  - exposes `signIn(email, password)`.
  - exposes `signOut()`.
  - uses `supabase.auth.getSession()` and `onAuthStateChange`.
- `src/pages/Auth.tsx`
  - renders email/password sign in and sign up.
  - sign-up asks for a display name.
  - if Supabase is not configured, shows an offline/cloud setup message.
- `src/lib/supabase.ts`
  - creates the Supabase client only when env vars are present.
  - accepts `VITE_SUPABASE_PUBLISHABLE_KEY` or legacy `VITE_SUPABASE_ANON_KEY`.
- `supabase/migrations/001_profiles.sql`
  - creates `profiles`.
  - `handle_new_user()` creates a profile on auth user creation.
  - current default display name is `raw_user_meta_data.display_name` or email.
- `vite.config.ts`
  - production base is `/cursor-default/`.
  - live app is `https://rothermal.github.io/cursor-default/`.

---

## 3. Product decisions

- Keep email/password as a fallback.
- Google profile data is default-only:
  - can seed profile display name/avatar.
  - should not permanently lock the user's StatKeeper display name.
- One auth identity owns data across all sports. Do not tie auth to Basketball or Soccer.
- Manual Google linking belongs to AUTH-2, but same-email automatic linking must be tested in
  AUTH-1.

> **Callout: existing account linking**
>
> Existing email/password accounts that use the same Gmail address should be able to use
> Google sign-in and retain the same Supabase user/profile ownership. Supabase documents
> automatic OAuth identity linking for matching verified email addresses. AUTH-1 should
> explicitly test this path with an existing email/password account before handoff.

---

## 4. OAuth behavior and redirect strategy

Use Supabase's browser OAuth flow:

```ts
await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: getOAuthRedirectUrl(),
  },
})
```

Configure the Supabase browser client for PKCE:

```ts
createClient(supabaseUrl, supabaseKey, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: true,
  },
})
```

Recommended redirect helper:

```ts
export function getOAuthRedirectUrl(): string {
  return `${window.location.origin}${window.location.pathname}`
}
```

Why:

- Local dev returns to `http://localhost:5173/`.
- GitHub Pages returns to `https://rothermal.github.io/cursor-default/`.
- HashRouter will treat a no-hash return as the root route, which should be sport choice
  after NAV-1.
- Avoid hard-coding `/`, which would be wrong for GitHub Pages project hosting.
- PKCE returns with a query `code` instead of token fragments in `window.location.hash`,
  avoiding HashRouter token-fragment races.

Do not request Google offline access/provider refresh tokens in AUTH-1. StatKeeper only
needs the Supabase session, not access to Google APIs.

---

## 5. Supabase and Google setup notes

Supabase project configuration:

- Enable the Google provider in Supabase Auth.
- Add Google Client ID and Client Secret to the Google provider.
- Set Site URL to production:
  - `https://rothermal.github.io/cursor-default/`
- Add redirect URLs:
  - `http://localhost:5173/`
  - `http://localhost:5173/**` if local paths need wildcard support.
  - `https://rothermal.github.io/cursor-default/`
  - exact production redirect URLs are preferred over production wildcards.

Google Cloud / Google Auth Platform configuration:

- Create OAuth client ID with application type **Web application**.
- Authorized JavaScript origins:
  - `http://localhost:5173`
  - `https://rothermal.github.io`
- Authorized redirect URI:
  - Supabase project's callback URL, usually
    `https://<project-ref>.supabase.co/auth/v1/callback`.
- Scopes:
  - `openid`
  - email/profile scopes required by Supabase/Google login.
- Consent screen:
  - app name.
  - support email.
  - app logo if available.
  - home page.
  - privacy policy.
  - terms of service if available.
  - authorized domains.
  - developer contact.
- During Google test mode, add test users.

Production note:

- If/when StatKeeper moves to a custom domain, revisit Site URL, allowed redirect URLs,
  Google authorized domains, and Google JavaScript origins.

---

## 6. Profile defaults

Current profile trigger only uses:

```sql
new.raw_user_meta_data ->> 'display_name'
```

Google OAuth users may provide names through metadata fields such as `full_name`, `name`, or
similar provider metadata, plus `avatar_url`/picture metadata. AUTH-1 should make profile
creation tolerate both email/password and Google sign-ups.

Recommended migration:

- Update `public.handle_new_user()` to set:
  - `display_name` from `display_name`, then `full_name`, then `name`, then email.
  - `avatar_url` from `avatar_url` or `picture` if present.
  - `email` from `new.email` if the current schema includes `profiles.email`.
- Do not overwrite existing profiles during OAuth sign-in.
- Do not add profile editing UI in AUTH-1.

No RLS behavior should need to change.

---

## 7. Implementation tasks

### D1: Auth context API

- [x] Add `signInWithGoogle()` to `AuthContextType`.
- [x] Implement it with `supabase.auth.signInWithOAuth({ provider: 'google', options })`.
- [x] Return `{ error: string | null }` for consistency with `signIn`/`signUp`.
- [x] Use a redirect helper based on `window.location.origin + window.location.pathname`.
- [x] Preserve current `getSession` and `onAuthStateChange` session handling.
- [x] Preserve `isConfigured` behavior when Supabase env vars are absent.

### D2: Auth page UI

- [x] Add a "Continue with Google" button above email/password fields.
- [x] Make Google the primary visual CTA.
- [x] Keep Sign In / Sign Up email/password tabs.
- [x] Add clear loading/error behavior for Google click failures.
- [x] Follow Google sign-in button branding rules closely enough for verification:
  - recognizable Google mark.
  - standard wording such as "Continue with Google" or "Sign in with Google".
  - button at least as prominent as other third-party providers.
- [x] Do not add a large redesign beyond this auth surface.

### D3: Profile trigger migration

- [x] Add a new numbered migration updating `public.handle_new_user()`.
- [x] Preserve email/password `display_name` behavior.
- [x] Add Google-friendly fallbacks for `full_name`, `name`, and avatar metadata.
- [x] Preserve/backfill `profiles.email` if the current schema includes it.
- [x] Confirm the migration is safe to apply after existing migrations.
- [x] Update README migration list.

### D4: Setup documentation

- [x] Update README Supabase setup with Google OAuth steps.
- [x] Document local and production redirect URLs.
- [x] Document Google authorized JavaScript origins.
- [x] Document Supabase callback URL placement in Google OAuth client.
- [x] Document consent screen/test-user requirements.
- [x] Update `docs/REGRESSION_TESTING.md` auth section with Google OAuth checks.
- [x] Update `docs/AGENT_CODEBASE_OVERVIEW.md` auth row.
- [x] Update `AGENTS.md` if operational auth gotchas are worth capturing.

### D5: Account-linking QA

- [ ] Create or use an existing email/password account with a Gmail address.
- [ ] Confirm the account email if confirmation is enabled.
- [ ] Sign out.
- [ ] Use Google sign-in with the same Gmail address.
- [ ] Verify the same app account/data is retained:
  - same user id if visible in Supabase/Auth dashboard.
  - existing teams/games still visible.
  - local owner-gated persisted game data does not bleed between users.
- [ ] Record any Supabase provider behavior that differs from the expected automatic-linking
  path.

---

## 8. Suggested file list

Likely touched:

- `src/context/AuthContext.tsx`
- `src/pages/Auth.tsx`
- `supabase/migrations/034_google_auth_profile_defaults.sql` or next available number
- `README.md`
- `docs/REGRESSION_TESTING.md`
- `docs/AGENT_CODEBASE_OVERVIEW.md`
- `docs/PLAN_APP_FOUNDATION_ROADMAP.md`

Possibly touched:

- `AGENTS.md`
- `src/lib/authRedirect.ts` or similar small helper if keeping redirect logic out of context.
- `src/lib/authRedirect.test.ts` if the helper is pure/testable.

---

## 9. Acceptance criteria

- Supabase-unconfigured mode still bypasses auth and runs offline/local.
- Email/password sign-in still works.
- Email/password sign-up still works.
- Google button appears on the auth page as the primary CTA.
- Clicking Google starts the Supabase Google OAuth flow.
- OAuth return lands back in the app on local dev.
- OAuth return lands back in the app on GitHub Pages production path.
- New Google user gets a usable profile row.
- Existing same-Gmail email/password user can sign in with Google without losing existing
  teams/games/account ownership.
- No sport-specific data ownership changes are introduced.
- No Google provider tokens are stored in localStorage.

---

## 10. Regression tests

Automated:

- Run `pnpm test`.
- Run `pnpm build`.
- Run `pnpm lint` and note existing Fast Refresh warnings if unchanged.
- Add unit coverage for redirect helper if it is extracted as a pure helper.

Manual:

- Supabase disabled:
  - open app.
  - verify no auth screen and no crash.
- Email/password:
  - sign in.
  - sign out.
  - sign up with display name.
- Google local dev:
  - configure Google/Supabase local redirect.
  - click Continue with Google.
  - complete OAuth.
  - verify return to app.
- Google production:
  - configure GitHub Pages redirect.
  - deploy.
  - complete OAuth from `https://rothermal.github.io/cursor-default/`.
- Same-email linking:
  - verify existing Gmail email/password account keeps data after Google sign-in.
- Profile defaults:
  - inspect `profiles.display_name`, `profiles.email`, and `profiles.avatar_url` for a new
    Google user.
- Account switching:
  - sign out clears the currently persisted game storage as it does today.
  - signing into another user does not expose prior user's cloud data.

---

## 11. Risks and guardrails

- **HashRouter and OAuth fragments:** use PKCE and avoid hash-specific redirect URLs in
  AUTH-1. Redirect to the app base path and let HashRouter load sport choice.
- **GitHub Pages base path:** do not hard-code `/`; production needs `/cursor-default/`.
- **Provider setup outside code:** OAuth will not work until Supabase and Google Console are
  configured correctly. Document this clearly in README/regression tests.
- **Account linking expectations:** automatic same-email linking depends on verified/unique
  email behavior. Test it explicitly before handoff.
- **Profile defaults:** Google metadata keys may differ; use conservative fallbacks and do
  not overwrite existing profiles.
- **Scope creep into AUTH-2:** do not build manual linking, connected methods, editable
  display name, or avatar management in AUTH-1.
- **Google branding:** custom button styling should stay close to Google's published
  requirements.

---

## 12. Pre-handoff decisions for implementation

Recommended defaults are listed first.

- **Auth model:** Google primary, email/password fallback.
- **OAuth redirect:** `window.location.origin + window.location.pathname`.
- **Post-login destination:** app root/sport choice.
- **Manual Google linking:** defer to AUTH-2.
- **Profile defaults:** update trigger to accept Google name/avatar metadata.
- **Google tokens:** do not request or store provider tokens.
- **Database migration:** include a small trigger update migration if implementation confirms
  Google metadata is not captured by the current trigger.

No additional product decisions are required before implementation if these defaults are
accepted.

---

## 13. Research references

- Supabase Google OAuth setup: `https://supabase.com/docs/guides/auth/social-login/auth-google`
- Supabase redirect URLs: `https://supabase.com/docs/guides/auth/redirect-urls`
- Supabase identity linking: `https://supabase.com/docs/guides/auth/auth-identity-linking`
- Supabase `signInWithOAuth`: `https://supabase.com/docs/reference/javascript/auth-signinwithoauth`
- Supabase `linkIdentity`: `https://supabase.com/docs/reference/javascript/auth-linkidentity`
- Google sign-in branding guidelines: `https://developers.google.com/identity/branding-guidelines`
- Google OAuth consent screen / verification: `https://support.google.com/cloud/answer/13461325`
