# Plan: SEC-6 Audit trail

SEC-6 adds durable audit history for sensitive access and admin actions.

Depends on: SEC-0. Best after SEC-1 through SEC-5 define the actions worth auditing.

---

## 1. Goal

Record who changed important access or admin state, what changed, and when.

This helps support, debugging, trust, and future app-admin workflows.

---

## 2. Candidate Events

Team/member:

- member invited,
- invite accepted/declined,
- invite link created/redeemed/revoked,
- member role changed,
- member removed,
- owner transferred.

Player/guardian:

- guardian claimed,
- guardian approved,
- guardian removed,
- player merged.

Game/stats:

- stat correction created/updated/deleted,
- primary recorder reassigned,
- game finalized/unfinalized if that ever exists.

App access:

- user approved,
- user suspended,
- user reactivated,
- app role changed.

---

## 3. Scope

- Define audit event schema.
- Add write helpers/RPCs for new SEC actions.
- Decide whether to backfill existing audit sources such as `player_merge_audit`.
- Add read UI for relevant scopes.
- Add regression checks for audit writes on sensitive actions.

---

## 4. Out Of Scope

- Full immutable event-sourcing rewrite.
- Reconstructing all historical activity.
- User-facing activity feeds for every minor change.
- Impersonation logs unless impersonation is introduced.

---

## 5. Data Model Sketch

Table: `access_audit_events`

Columns:

- `id uuid primary key`
- `event_type text not null`
- `actor_user_id uuid null references profiles(id)`
- `target_user_id uuid null references profiles(id)`
- `team_id uuid null references teams(id)`
- `player_id uuid null references players(id)`
- `game_id uuid null references games(id)`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

RLS:

- App admins can read all if SEC-5 exists.
- Team owner/admin can read events scoped to their teams.
- Users can read events where they are actor/target if product wants that transparency.
- Writes should happen through RPCs or triggers, not direct client inserts.

---

## 6. Q&A Session

Ask these one at a time before implementation.

1. Should audit be team-visible or app-admin-only?
   - Recommended: Team owner/admin can see team-scoped audit; app admins can see all.
   - Option B: App-admin-only.
   - Option C: Minimal internal table, no UI yet.

2. Should users see audit events about themselves?
   - Recommended: Not in v1, except through normal UI state.
   - Option B: Yes, account activity page.

3. Should audit writes be centralized in one RPC?
   - Recommended: Use small action-specific RPCs/triggers rather than client-side direct insert.
   - Option B: One generic `record_audit_event` RPC.

4. Should existing `player_merge_audit` be kept separate?
   - Recommended: Keep it, optionally mirror future merge events into unified audit.
   - Option B: Migrate/replace with unified audit.

5. Which event should SEC-6 implement first?
   - Recommended: Member role/removal/invite-link events.
   - Option B: App access events if SEC-5 ships first.
   - Option C: Guardian events if SEC-4 ships first.

---

## 7. Resolved Decisions

- Team owner/admin can see team-scoped audit; app admins can see all.
- Users do not get a personal audit/activity page in v1.
- Audit writes use action-specific RPCs/triggers, not one generic write-anything endpoint.
- Keep `player_merge_audit` separate, with optional future mirroring.
- Implement member role/removal and invite-link events first.

---

## 8. Acceptance Criteria

- Sensitive actions write audit events.
- Authorized users can read the intended audit scope.
- Unauthorized users cannot read other teams' audit events.
- Audit metadata is useful but does not expose secrets or invite tokens.
- Existing feature flows still work.
