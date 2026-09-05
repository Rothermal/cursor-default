# SOC-S22 - Durable roster history and deleted-source recovery

**Status:** implemented; migration 067 and deployed recovery verification pending
**Scope:** shared player deletion, event-platform binding, event-game recovery UI

## 1. Problem

A team roster is setup input for a match, not continuing authority over that
match's participant history. A permanent `players` deletion previously cascaded
away `team_players` membership. An intact local event game then failed its first
cloud binding because the v4 binder could no longer prove that the frozen source
player belonged to the source team.

```text
local participant snapshot -> deleted cloud player -> missing team membership
                           -> v4 binding rejects the complete local game
```

Normal roster **Remove** already sets `team_players.is_active = false` and keeps
the membership row, so it remains compatible with binding.

## 2. Decisions

1. Permanent player deletion is allowed only when no local or cloud game history
   references that identity. Roster removal remains the normal lifecycle action.
2. Direct authenticated deletes from `players` are removed. Both deletion screens
   use one guarded RPC, and legacy sync rollback uses that same RPC.
3. Ordinary binding retains every v4 identity and access check.
4. Recovery is explicit and limited to team owners/admins. It may unlink a source
   only when the referenced `players` row no longer exists.
5. A player who still exists but is not on the source team is never silently
   accepted, anonymized, or mapped to another identity.
6. Recovery preserves the immutable setup, local participant id, client player id,
   display name, jersey number, event stream, score, clock, and finalization state.

## 3. Delivered contracts

### 3.1 Deletion protection

Migration `067_roster_history_binding_recovery.sql` drops the direct
`players_delete` policy and revokes authenticated table deletion. The fixed
`delete_unreferenced_player(uuid)` RPC:

- requires the caller to be the player creator;
- locks the player row during validation;
- rejects event participants, legacy stats, shots, corrections, checkouts, or
  legacy game-level team-player placeholders;
- deletes only an identity with no game history.

The Teams and Settings/Advanced handlers additionally inspect every active and
parked local game. This catches the unbound device-only case that the server
cannot see.

### 3.2 Binding recovery

The private `bind_event_game_v5` delegates unchanged requests to v4. On an
explicit recovery request it requires owner/admin access, then examines each
participant source:

```text
membership exists                 -> retain normal source link
player exists but membership gone -> reject through normal v4 validation
player row genuinely gone         -> store frozen participant without source link
```

Fixed Soccer and Basketball v5 wrappers keep the private shared core unavailable
to clients. Both event trackers recognize the known binding failure and offer a
confirmation-driven **Preserve History** retry only to a current team owner/admin.
The recovery choice is durable long enough to survive storage and execute one bind
attempt, then clears whether that attempt succeeds or fails.

## 4. Non-goals

- Reassigning historical events to a replacement player.
- Recreating a deleted global player identity automatically.
- Relaxing current team membership, recorder, setup, or finalization checks.
- Changing ordinary roster deactivation or player merge behavior.
- Backfilling source links already nulled in bound cloud history.

## 5. Exit

Implementation exits after automated contracts pass and the focused matrix in
`REGRESSION_SOC_S22_ROSTER_HISTORY.md` verifies migration 067 against Supabase.
The previously exported damaged match is the preferred recovery fixture.
