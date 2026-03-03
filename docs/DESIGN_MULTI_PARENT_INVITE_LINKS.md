# Design: Multi-Parent Workflows & Invite Links

Design for making it easier for multiple parents to join the same team and collaborate: shareable invite links and clearer multi-parent workflows. Ideas and decisions are tracked here.

---

## 1. Goal & scope

**Goal:** Allow team owners/admins to share a single link that another parent can use to join the team (without the inviter having to look up the invitee’s email). Clarify in the app that multiple parents can work together (tracking, checkout, review) so the flow feels intentional rather than email-only.

**In scope:** Invite links (create, share, redeem), optional expiry and role; join/landing experience for the link; light UX improvements so “multi-parent” is obvious where it matters.

**Out of scope:** Email delivery of the link (we can add “Copy link” and the user shares via any channel); changing the existing email-invite flow (it stays); federation or cross-org teams.

---

## 2. Current state

**Invite flow today (migration 011, [Teams.tsx](src/pages/Teams.tsx)):**

- **Invite by email:** Owner/admin enters an email → `lookup_user_by_email(team_id, email)` (returns existing Supabase auth user) → `invite_team_member(team_id, user_id, role)` → inserts/updates `team_members` with `accepted_at = null`.
- **Invitee experience:** Invitee must already have an account. They see “Pending invites” on the Teams page (rows where they are `user_id` and `accepted_at` is null); they Accept (update `accepted_at`) or Decline (delete row).
- **Tables:** `team_members` (team_id, user_id, role, invited_at, accepted_at). No separate “invite” table; a pending invite is just a row with null `accepted_at`.

**Multi-parent today:**

- Multiple parents can be members of the same team (owner, admin, scorer).
- Player checkout, resolved stats, “Primary recorder,” “All submissions,” “Stats needing review” all support multiple recorders. The **workflow** is multi-parent; the **onboarding** (how you become a member) is still “someone invites you by email.”

**Gap:** To add a parent, the inviter must know their email and the invitee must already be signed up. No way to say “here’s a link, open it and join the team.”

---

## 3. Invite links: use cases

| Actor | Action |
|-------|--------|
| Owner/admin | Creates an invite link for the team (optional: role, expiry). Copies or shares the link (SMS, WhatsApp, email, etc.). |
| Parent (signed in) | Opens link → lands on a “Join [Team name]” page → one tap to accept (same as current accept, but triggered by link). |
| Parent (signed out) | Opens link → sees “Sign in to join [Team name]” → after sign-in/sign-up, redirect back to join flow and accept. |

The link must identify **which team** (and optionally **which role**) and be hard to guess. It can be single-use or multi-use (see below).

---

## 4. Invite link: options

### 4.1 Token storage

| Option | How it works | Pros | Cons |
|--------|----------------|------|------|
| **A. DB table** | New table `team_invite_links`: (team_id, role, token, created_by, expires_at, max_uses?). Create link → insert row, token = random (e.g. nanoid). Redeem = lookup by token, insert/update team_members, optionally delete or decrement uses. | Revocable, can list “active links,” expiry and use limits in DB | Extra table and RPCs; token must be unique and indexed |
| **B. Signed payload (JWT or HMAC)** | No DB. Link contains signed payload (team_id, role, exp). Backend RPC validates signature and exp, then creates team_members row. | No new table; stateless | Can’t revoke before expiry; can’t list “active links”; key management |

**Recommendation:** Start with **Option A (DB table)** so we can revoke links, show “Active invite links” in the Teams UI, and enforce expiry and optional use limits in one place.

### 4.2 Token format and URL

- **Token:** Cryptographically random, URL-safe (e.g. 16–24 chars from [A-Za-z0-9_-]). Stored in DB, unique index.
- **URL shape:** HashRouter-friendly. Two options:
  - `/#/teams/join?token=abc123` (query param; join page reads token and team from RPC).
  - `/#/invite/abc123` (path param; one RPC “resolve invite token” returns team_id, team name, role, expires_at).

Path param keeps the link short and avoids leaking team_id in query. **Recommendation:** `/#/invite/:token`. One RPC `get_invite_by_token(p_token text)` returns team_id, team name, role, expires_at (or 404/410 if invalid or expired).

### 4.3 Single-use vs multi-use

- **Single-use:** After first successful redeem, token is deleted or marked used. Simpler and safer; good default.
- **Multi-use:** Optional `max_uses` (e.g. 5) or “unlimited” until expiry. Useful for “share with the whole sideline.”

**Recommendation:** Implement single-use first. Add optional `max_uses` in a follow-up if needed.

### 4.4 Expiry

- **Optional expiry:** `expires_at` (e.g. 7 days from creation). On redeem, RPC checks `expires_at > now()`.
- **Default:** 7 days if we don’t want “links live forever.”

---

## 5. Data model (Option A)

**New table: `team_invite_links`**

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| team_id | uuid | FK → teams, NOT NULL |
| role | text | 'scorer' \| 'admin', NOT NULL, default 'scorer' |
| token | text | UNIQUE, NOT NULL, URL-safe random |
| created_by | uuid | FK → profiles, who created the link |
| expires_at | timestamptz | NULL = no expiry, or e.g. now() + 7 days |
| created_at | timestamptz | NOT NULL default now() |

- Index on `token` (unique) for fast lookup.
- RLS: team members can read links for their team; only owner/admin can insert; only owner/admin can delete (revoke). Redeem is done via RPC (SECURITY DEFINER) that checks token and expiry, then inserts/updates `team_members`.

**RPCs:**

1. **create_invite_link(p_team_id uuid, p_role text default 'scorer', p_expires_in_days int default 7)**  
   Returns: `{ token, url, expires_at }`. Caller must be owner/admin. Insert row; generate token (e.g. nanoid(16)); return token and full URL (app base + `/#/invite/` + token).

2. **get_invite_by_token(p_token text)**  
   Returns: `{ team_id, team_name, role, expires_at }` or 404. Public (no auth required) so the join page can show “Join [Team name] as Scorer” before sign-in. If expired or already used (if we go single-use and delete on redeem), return 410 or 404.

3. **redeem_invite_token(p_token text)**  
   Caller = current user (auth.uid()). Look up link by token; check not expired; insert/update `team_members` (team_id, user_id, role, accepted_at = now()); delete the invite link row (single-use). Return team_id so client can redirect to Teams and select that team.

---

## 6. Multi-parent workflows (UX)

Existing behavior already supports multiple parents (checkout, resolved stats, Primary recorder, All submissions, Stats needing review). We can make it more visible and predictable:

- **Teams page / Team detail:** Short line such as “Multiple parents can track the same game; use Primary view and Review to resolve differences.” (Optional; can live in help or onboarding.)
- **After accepting an invite (email or link):** Same as today: show team in list, “Accepted.” Optionally toast or banner: “You’ve joined [Team]. You can now track games and view season stats.”
- **Invite link entry point:** In the “Invite by email” area, add “Or share an invite link” with [Create link] → show URL + [Copy]. List of “Active links” (optional v1): table of created links with expiry and [Revoke].

No change to Game Tracker or Game Summary flows; they already assume multiple recorders.

---

## 7. UI sketch

**Teams page (owner/admin):**

- Under “Team Members” / “Invite by email”, add section **“Invite link”**:
  - Button “Create invite link” (optional: dropdown for role Scorer / Admin, optional: “Expires in 7 days”).
  - On create: call `create_invite_link`, show full URL and [Copy] button; show expiry date.
  - Optional: “Active links” list (token truncated, role, expires_at, [Revoke]).

**New route: `/#/invite/:token`**

- **Page: InviteJoin (or InviteLanding).**
- On load: call `get_invite_by_token(token)` (no auth). If 404/410: “This invite is invalid or has expired.”
- If valid:
  - **User signed in:** Show “Join [Team name] as [Role]?” [Join team]. On click: `redeem_invite_token(token)` → redirect to `/#/teams` (or `/#/teams?selected=team_id`).
  - **User not signed in:** Show “Sign in to join [Team name].” [Sign in]. After auth, redirect back to `/#/invite/:token` so they can redeem (or auto-redeem on next load if we want).

**Router:** Add route `/invite/:token` → `InviteJoin` (or similar). This page may render inside the same layout as Teams (header + back) or a minimal layout (so the link works even when shared to a new user).

---

## 8. Security considerations

- **Token entropy:** Use a secure random (e.g. nanoid with 16+ chars) so links are unguessable.
- **Rate limiting:** Optional: limit `get_invite_by_token` or `redeem_invite_token` by IP to avoid brute-force. Can add later.
- **Revocation:** With DB-backed links, owner/admin can delete a link (or we add “revoke” that deletes the row); any future redeem fails.
- **Expiry:** Enforce in both `get_invite_by_token` and `redeem_invite_token`.

---

## 9. Implementation order

1. **Migration:** Create `team_invite_links` table, RLS, indexes; RPCs `create_invite_link`, `get_invite_by_token`, `redeem_invite_token`.
2. **Teams page:** “Create invite link” + copy URL; show expiry. (Optional: list active links + revoke.)
3. **Route and page:** `/#/invite/:token` → resolve token, show Join UI; signed-in user can redeem; signed-out user sees “Sign in to join” and returns to redeem after auth.
4. **Polish:** Redirect after redeem to Teams with the new team selected; optional short “You’ve joined [Team]” message.

---

## 10. Open questions

- **Default expiry:** 7 days vs 24 hours vs “no expiry” (null). 7 days is a reasonable default; make it configurable later (e.g. dropdown: 1 day, 7 days, 30 days, Never).
- **Role in link:** Fixed at create time (e.g. “Scorer” or “Admin”) vs “let invitee choose.” Fixed is simpler; we can add “choose role when joining” later.
- **Active links list:** Show all created links for the team with [Copy] [Revoke]? Helps owner revoke a link they shared by mistake. Implement after basic create/redeem works.
- **Email + link:** Later we could add “Send invite by email” that sends an email containing the invite link (Supabase Edge Function or third-party). Out of scope for this design.

---

## 11. Summary

- **Invite links:** DB-backed token in `team_invite_links`; RPCs create, resolve, redeem; single-use redeem; optional expiry (e.g. 7 days). URL `/#/invite/:token`.
- **Multi-parent workflows:** Already supported in app logic; add invite link as the primary “add a parent” path and optional short copy to make collaboration obvious.
- **Next:** Migration + RPCs, then Teams “Create link” + Copy, then InviteJoin page and route.
