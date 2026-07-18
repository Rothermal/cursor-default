# Plan: App foundation roadmap

Living roadmap for the next foundation work before soccer implementation. This plan covers
the shared product architecture for sport-aware navigation, focused settings/admin pages,
Google authentication, account management, and the first soccer planning/build phases.

The intent is to make the app easier to navigate for basketball today while creating a
clean path for multiple sports in progress at the same time. Each major phase below should
be expanded into its own execution plan before implementation.

---

## 1. Problem statement

StatKeeper has grown from a basketball-first tracker into a multi-game, multi-sport
foundation. The current home/admin structure still largely reflects the original app:

- The post-login home is primarily a sport selector plus several direct actions.
- Settings/admin content is concentrated into long pages, which increases scrolling and
  mixes normal preferences with advanced/debug-style tools.
- Authentication is email/password only today, but the desired account model should support
  Google sign-in/sign-up and account linking.
- Soccer is the next sport direction, and the app needs a navigation/settings model that
  does not hard-code basketball assumptions into global workflows.

The next work should establish the app shell and account/settings foundations first, then
build soccer on top of that structure.

---

## 2. Target mental model

```text
Login / Auth
  -> Sport choice
      -> Basketball dashboard
          -> Resume active basketball game
          -> Parked basketball games
          -> New basketball game
          -> Basketball teams
          -> Basketball cloud games
      -> Soccer dashboard
          -> Resume active soccer game
          -> Parked soccer games
          -> New soccer game
          -> Soccer teams
          -> Soccer cloud games

Global shell
  -> Settings
  -> Account
  -> Help / advanced access as needed
```

The global shell should be reachable across primary authenticated pages, likely through a
small header/footer control. Global navigation does not belong to a specific sport.

The sport dashboard is where work is scoped to a sport. Sport choice answers "which sport
are you working in?" The sport dashboard answers "what do you want to do for this sport?"

---

## 3. Settled product decisions

- Use **login -> sport choice -> sport dashboard** as the main post-auth hierarchy.
- Keep sport dashboards functional first: routing/structure and light polish now; broad
  visual reskin later once the UI is highly functional.
- Keep Settings/Admin globally accessible from the app shell, not only from the sport choice page.
- Split Settings/Admin into focused sections instead of one long scrolling page.
- Put sport-specific settings under that sport. For example, the basketball rebound prompt
  setting belongs under a Basketball settings tab, not a generic settings scroll.
- Make Google the primary auth CTA while keeping email/password as a fallback.
- Split auth work into two phases:
  - AUTH-1: Google sign-in/sign-up.
  - AUTH-2: account management and identity linking UI.
- AUTH-1 must happen before AUTH-2, but the app shell/navigation work can happen before
  AUTH-1.
- Google profile data is default-only: it may prefill display name/avatar, but StatKeeper's
  display name remains editable.
- Account controls should live in a separate Account tab/page, not buried inside a long
  Settings page.
- Cloud games at the sport dashboard level should be sport-filtered first. Team-specific cloud
  games belong naturally inside the team hub or a team filter within cloud games.

---

## 4. Authentication direction

### AUTH-1: Google sign-in/sign-up

Detailed plan: [PLAN_AUTH_1_GOOGLE_SIGN_IN.md](PLAN_AUTH_1_GOOGLE_SIGN_IN.md).

Goal: add Google OAuth as the primary account creation/sign-in path without removing the
existing email/password fallback.

Expected scope:

- Add a Google sign-in/sign-up CTA to the auth entry point.
- Keep email/password available for existing users and fallback/admin/testing flows.
- Handle OAuth redirect return cleanly with HashRouter.
- Document required Supabase and Google Console setup.
- Preserve optional Supabase behavior: when Supabase env vars are absent, the app should
  continue to run in offline/local mode.

> **Callout: existing account linking**
>
> Google linking is a hard requirement, not a nice-to-have. Existing email/password accounts
> that use the same Gmail address should be able to sign in with Google and retain the same
> StatKeeper account/data ownership. Supabase supports automatic identity linking for OAuth
> identities with the same verified email address, and AUTH-1 should explicitly test this
> same-email migration path before it is considered complete.

Implementation notes to preserve:

- Do not tie auth identity to a sport. One account owns teams, seasons, games, and parking
  across all sports.
- Google account name/avatar can seed defaults, but app-facing profile identity remains
  editable.
- Keep email/password UI available unless a later plan explicitly retires it.
- Add setup documentation for redirect URLs, Google OAuth credentials, and consent screen
  requirements.

### AUTH-2: Account management

Detailed plan: [PLAN_AUTH_2_ACCOUNT_MANAGEMENT.md](PLAN_AUTH_2_ACCOUNT_MANAGEMENT.md).

Goal: create the user-facing account area after the app shell/settings split gives it a
proper home.

Expected scope:

- Add a distinct Account tab/page.
- Show signed-in email and current display name.
- Let the user edit the StatKeeper display name.
- Show connected sign-in methods.
- Add a manual "Link Google" action for logged-in users.
- Consider avatar display/import behavior after the display-name flow is stable.

---

## 5. Navigation and settings direction

### NAV-1: App shell and sport dashboards

Detailed plan: [PLAN_NAV_1_APP_SHELL_AND_SPORT_DASHBOARDS.md](PLAN_NAV_1_APP_SHELL_AND_SPORT_DASHBOARDS.md).

Goal: introduce the sport-aware navigation structure while reusing existing features.

Expected scope:

- Add a global app shell with persistent access to Settings/Account.
- Keep HashRouter behavior and existing routes working.
- Make the post-login landing experience a sport choice screen.
- Add sport-scoped dashboards, starting with Basketball and a future-ready path for Soccer.
- Move existing basketball actions into the Basketball dashboard:
  - active/resume game
  - parked games
  - start new game
  - teams
  - cloud games
- Ensure parked games and cloud games are filtered or clearly scoped by sport where shown.
- Keep legacy/deep links working where practical.

Suggested route shape:

```text
/#/sports
/#/sport/:sportId
/#/sport/:sportId/setup
/#/sport/:sportId/parked
/#/sport/:sportId/cloud-games
/#/teams?sport=:sportId
/#/team?teamId=...
/#/settings
/#/account
```

The exact route names can change during the detailed phase plan, but the hierarchy should
remain sport-aware.

### NAV-2: Settings/Admin split

Detailed plan: [PLAN_NAV_2_SETTINGS_ADMIN_SPLIT.md](PLAN_NAV_2_SETTINGS_ADMIN_SPLIT.md).

Goal: reduce scrolling and make normal settings, sport settings, account controls, data
tools, and advanced tools easier to find.

Recommended sections:

```text
Settings
  -> Account
  -> App / General
  -> Sports
      -> Basketball
          -> Game tracker
          -> Rebound prompt after miss
          -> Basketball team-stat/season config
      -> Soccer
          -> Soccer-specific settings later
      -> Future sports
  -> Data & Sync
  -> Advanced
```

Expected scope:

- Split the existing Admin/Settings page into focused tabs or routes.
- Move the basketball rebound prompt into the Basketball settings area.
- Keep data import/export, parked-game storage, and cloud sync controls under Data & Sync.
- Keep diagnostics, merge/debug utilities, and dangerous/reset actions under Advanced.
- Avoid a broad visual reskin in this phase; prioritize structure, discoverability, and
  shorter pages.

---

## 6. Soccer direction

Soccer is the next sport direction after the app foundation work. The first soccer planning
phase should assume each sport eventually gets its own live surface and layout:

- Basketball uses a basketball court.
- Soccer should use a soccer field when built.
- Baseball should use a diamond when built.
- Football should use a football field when built.

Do not make soccer inherit basketball-specific UI. Generic sport configuration can drive
stat definitions, setup, teams, and summaries, but live tracking surfaces should resolve by
sport.

### SOC-0: Soccer planning

Detailed plan: [PLAN_SOC_0_SOCCER_PRODUCT_MODEL.md](PLAN_SOC_0_SOCCER_PRODUCT_MODEL.md).

Status: Product and technical direction resolved; implementation not started.

SOC-0 replaces the dormant soccer stat-grid assumptions with an event-first model:

- Detailed player events for the tracked team; simplified opponent attribution.
- A shared, versioned game-event envelope with soccer-specific payloads.
- Derived stat/score projections instead of independently mutable soccer counters.
- Configurable match rules, clock, lineup, periods, direction, and substitutions.
- A full soccer field plus quick-event controls and an editable timeline.
- A complete stat catalog divided into core, derived, and optional future modules.
- A required future basketball event-model redesign that does not block soccer
  ([roadmap](PLAN_BASKETBALL_EVENT_MODEL_ROADMAP.md)).

### SOC-1 through SOC-6: Soccer implementation program

| Phase | Purpose |
|---|---|
| SOC-1 | Shared game-event foundation, local persistence, derivation engine, and cloud schema |
| SOC-2 | Soccer rules, tracked-team side, lineup roles, clock, periods, direction, substitutions, and minutes |
| SOC-3 | Full field, attacking events, chance creation, goalkeeper links, score events, and timeline editing |
| SOC-4 | Defense, discipline/staff cards, corners, offsides, shootouts, and structured outcomes |
| SOC-5 | Cloud sync, independent recorder streams, primary resolution, finalization, and resume hardening |
| SOC-6 | Soccer summaries, field maps, season aggregates, settings modules, QA, and enablement |

Each phase receives its own execution plan and one-question-at-a-time Q&A before code work.

---

## 7. Recommended build order

| Phase | Deliverable | Notes |
|-------|-------------|-------|
| **NAV-1** | App shell + sport choice/dashboard structure | Best first foundation slice; gives every later feature a cleaner home. |
| **NAV-2** | Settings/Admin split | Reduces scrolling and creates Account/Sports/Data/Advanced destinations. |
| **AUTH-1** | Google sign-in/sign-up | Must precede AUTH-2; can follow navigation because auth entry does not depend on soccer. |
| **AUTH-2** | Account management | Implemented; uses the Account destination created by NAV-2 for profile editing, connected methods, and Google linking. |
| **SOC-0** | Soccer product/technical plan | Complete; defines event-first product model and six-phase implementation roadmap. |
| **SOC-1** | Shared event foundation | First soccer implementation phase; detailed planning required before code. |
| **SOC-2** | Match rules, lineups, and clock | Build soccer match state on the shared event foundation. |
| **SOC-3** | Field and attacking events | Deliver the soccer-native field and linked attacking workflow. |
| **SOC-4** | Remaining core events | Add defense, discipline, team events, shootouts, and outcomes. |
| **SOC-5** | Event cloud sync | Harden independent recorder streams, resolution, parking, and finalization. |
| **SOC-6** | Summary and release | Add soccer reporting, settings, season aggregates, QA, and enablement. |

---

## 8. Phase planning notes

When expanding each phase into an implementation plan, include:

- Target files and route changes.
- Backward compatibility for existing HashRouter links.
- Manual regression steps for basketball and multi-game parking.
- Any README, AGENTS, and `docs/AGENT_CODEBASE_OVERVIEW.md` updates.
- Whether Supabase migrations are required.
- How the phase behaves when Supabase is not configured.
- What should be deferred to keep the PR small.

Suggested phase-plan naming:

```text
docs/PLAN_NAV_1_APP_SHELL_AND_SPORT_DASHBOARDS.md
docs/PLAN_NAV_2_SETTINGS_ADMIN_SPLIT.md
docs/PLAN_AUTH_1_GOOGLE_SIGN_IN.md
docs/PLAN_AUTH_2_ACCOUNT_MANAGEMENT.md
docs/PLAN_SOC_0_SOCCER_PRODUCT_MODEL.md
docs/PLAN_SOC_1_SHARED_EVENT_FOUNDATION.md
docs/PLAN_SOC_2_MATCH_RULES_LINEUPS_AND_CLOCK.md
docs/PLAN_SOC_3_FIELD_AND_ATTACKING_EVENTS.md
docs/PLAN_SOC_4_MATCH_EVENT_CATALOG.md
docs/PLAN_SOC_5_EVENT_CLOUD_SYNC.md
docs/PLAN_SOC_6_SUMMARY_AND_RELEASE.md
```

---

## 9. Open questions for later phase plans

These do not block this high-level roadmap.

- NAV-1: Should sport dashboards be new pages or a refactor of the existing `SportSelect`
  page into separate components?
- NAV-1: What exact global shell pattern fits mobile best: top header, bottom nav, or a
  compact hybrid?
- NAV-1: Should `/` redirect to `/sports`, or should `/` remain the sport choice route?
- NAV-2: Should Settings sections be tabs within one route or separate HashRouter routes?
- NAV-2: Which current Admin tools are advanced/debug-only versus normal user-facing data
  tools?
- AUTH-1: Which deployment URLs need to be configured in Supabase/Google at launch
  (localhost, GitHub Pages, custom domain)?
- AUTH-1: What exact user-facing copy should explain existing account linking?
- AUTH-2: Avatar display is read-only from Google/profile defaults for now; upload/edit remains a future account phase.
- SOC-1 through SOC-6: Detailed implementation choices remain phase-local and should be
  resolved through one-question-at-a-time Q&A before each phase.

---

## 10. Research references

- Supabase Google OAuth setup: `https://supabase.com/docs/guides/auth/social-login/auth-google`
- Supabase redirect URLs: `https://supabase.com/docs/guides/auth/redirect-urls`
- Supabase identity linking: `https://supabase.com/docs/guides/auth/auth-identity-linking`
- Supabase JavaScript `linkIdentity`: `https://supabase.com/docs/reference/javascript/auth-linkidentity`
- Google OAuth app verification and consent screen: `https://support.google.com/cloud/answer/13461325`
- Google sign-in branding guidelines: `https://developers.google.com/identity/branding-guidelines`
- IFAB permitted youth/grassroots modifications: `https://www.theifab.com/laws/latest/general-modifications/`
- NCAA soccer shot/assist/save definitions: `https://ncaaorg.s3.amazonaws.com/championships/sports/soccer/rules/PRXSO_RulesBook.pdf`
- FIFA Football Language: `https://www.fifatrainingcentre.com/en/resources-tools/football-language/`
