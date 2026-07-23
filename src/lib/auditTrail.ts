export interface AuditEvent {
  id: string
  eventType: string
  actorUserId: string | null
  actorDisplayName: string
  targetUserId: string | null
  targetDisplayName: string | null
  teamId: string | null
  teamName: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

interface AuditRpcRow {
  id?: unknown
  event_type?: unknown
  actor_user_id?: unknown
  actor_display_name?: unknown
  target_user_id?: unknown
  target_display_name?: unknown
  team_id?: unknown
  team_name?: unknown
  metadata?: unknown
  created_at?: unknown
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function parseAuditEvents(value: unknown): AuditEvent[] {
  if (!Array.isArray(value)) return []

  return value.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const row = raw as AuditRpcRow
    if (
      typeof row.id !== 'string' ||
      typeof row.event_type !== 'string' ||
      typeof row.actor_display_name !== 'string' ||
      typeof row.created_at !== 'string'
    ) return []

    return [{
      id: row.id,
      eventType: row.event_type,
      actorUserId: nullableString(row.actor_user_id),
      actorDisplayName: row.actor_display_name,
      targetUserId: nullableString(row.target_user_id),
      targetDisplayName: nullableString(row.target_display_name),
      teamId: nullableString(row.team_id),
      teamName: nullableString(row.team_name),
      metadata: metadataObject(row.metadata),
      createdAt: row.created_at,
    }]
  })
}

function metadataLabel(event: AuditEvent, key: string, fallback: string): string {
  const value = event.metadata[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function targetLabel(event: AuditEvent): string {
  return event.targetDisplayName ?? 'a team member'
}

export function formatAuditEvent(event: AuditEvent): string {
  const actor = event.actorDisplayName || 'System'
  const target = targetLabel(event)
  const role = metadataLabel(event, 'role', 'member')

  switch (event.eventType) {
    case 'team_member_invited':
      return `${actor} invited ${target} as ${role}`
    case 'team_invite_accepted':
      return `${target} accepted the ${role} invite`
    case 'team_invite_declined':
      return `${target} declined the ${role} invite`
    case 'team_invite_canceled':
      return `${actor} canceled the ${role} invite for ${target}`
    case 'team_member_left':
      return `${target} left the team`
    case 'team_member_removed':
      return `${actor} removed ${target} from the team`
    case 'team_member_role_changed': {
      const previousRole = metadataLabel(event, 'previous_role', 'member')
      return `${actor} changed ${target} from ${previousRole} to ${role}`
    }
    case 'invite_link_created':
      return `${actor} created a ${role} invite link`
    case 'invite_link_redeemed':
      return `${target} joined as ${role} using an invite link`
    case 'invite_link_revoked':
      return `${actor} revoked a ${role} invite link`
    case 'app_access_changed': {
      const previousStatus = metadataLabel(event, 'previous_status', 'unknown')
      const status = metadataLabel(event, 'status', 'unknown')
      const previousRole = metadataLabel(event, 'previous_app_role', 'user')
      const appRole = metadataLabel(event, 'app_role', 'user')
      return `${actor} changed ${target}: ${previousStatus}/${previousRole} to ${status}/${appRole}`
    }
    case 'soccer_primary_recorder_changed':
      return `${actor} selected ${target} as the soccer primary recorder`
    case 'soccer_primary_conflict_resolved':
      return `${actor} resolved a primary soccer stream conflict for ${target}`
    case 'soccer_game_finalized':
      return `${actor} finalized the soccer game using ${target}`
    case 'soccer_game_reopened':
      return `${actor} reopened the soccer game`
    default:
      return event.eventType.split('_').join(' ')
  }
}
