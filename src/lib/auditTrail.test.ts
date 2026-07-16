import { describe, expect, it } from 'vitest'
import { formatAuditEvent, parseAuditEvents } from './auditTrail'

describe('parseAuditEvents', () => {
  it('normalizes valid audit RPC rows and drops malformed rows', () => {
    expect(parseAuditEvents([
      {
        id: 'event-1',
        event_type: 'team_member_role_changed',
        actor_user_id: 'actor-1',
        actor_display_name: 'Coach One',
        target_user_id: 'target-1',
        target_display_name: 'Coach Two',
        team_id: 'team-1',
        team_name: 'Wildcats',
        metadata: { previous_role: 'viewer', role: 'scorer' },
        created_at: '2026-07-16T12:00:00Z',
      },
      { id: 'event-2' },
    ])).toEqual([{
      id: 'event-1',
      eventType: 'team_member_role_changed',
      actorUserId: 'actor-1',
      actorDisplayName: 'Coach One',
      targetUserId: 'target-1',
      targetDisplayName: 'Coach Two',
      teamId: 'team-1',
      teamName: 'Wildcats',
      metadata: { previous_role: 'viewer', role: 'scorer' },
      createdAt: '2026-07-16T12:00:00Z',
    }])
  })
})

describe('formatAuditEvent', () => {
  const baseEvent = {
    id: 'event-1',
    actorUserId: 'actor-1',
    actorDisplayName: 'Coach One',
    targetUserId: 'target-1',
    targetDisplayName: 'Coach Two',
    teamId: 'team-1',
    teamName: 'Wildcats',
    createdAt: '2026-07-16T12:00:00Z',
  }

  it('describes member role changes from safe metadata', () => {
    expect(formatAuditEvent({
      ...baseEvent,
      eventType: 'team_member_role_changed',
      metadata: { previous_role: 'viewer', role: 'scorer' },
    })).toBe('Coach One changed Coach Two from viewer to scorer')
  })

  it('describes app access changes without requiring email', () => {
    expect(formatAuditEvent({
      ...baseEvent,
      teamId: null,
      teamName: null,
      eventType: 'app_access_changed',
      metadata: {
        previous_status: 'active',
        status: 'suspended',
        previous_app_role: 'user',
        app_role: 'user',
      },
    })).toBe('Coach One changed Coach Two: active/user to suspended/user')
  })
})
