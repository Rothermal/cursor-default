import { describe, expect, it } from 'vitest'
import { formatAuditEvent, parseAuditEvents, type AuditEvent } from './auditTrail'

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
      null,
      'bad',
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

  it('rejects non-arrays and coerces unsafe metadata/nullables', () => {
    expect(parseAuditEvents(null)).toEqual([])
    expect(parseAuditEvents({ id: 'event-1' })).toEqual([])

    expect(parseAuditEvents([{
      id: 'event-3',
      event_type: 'invite_link_created',
      actor_user_id: 12,
      actor_display_name: 'Coach One',
      target_user_id: null,
      target_display_name: null,
      team_id: 'team-1',
      team_name: null,
      metadata: ['not-an-object'],
      created_at: '2026-07-16T13:00:00Z',
    }])).toEqual([{
      id: 'event-3',
      eventType: 'invite_link_created',
      actorUserId: null,
      actorDisplayName: 'Coach One',
      targetUserId: null,
      targetDisplayName: null,
      teamId: 'team-1',
      teamName: null,
      metadata: {},
      createdAt: '2026-07-16T13:00:00Z',
    }])
  })
})

describe('formatAuditEvent', () => {
  const baseEvent: Omit<AuditEvent, 'eventType' | 'metadata'> = {
    id: 'event-1',
    actorUserId: 'actor-1',
    actorDisplayName: 'Coach One',
    targetUserId: 'target-1',
    targetDisplayName: 'Coach Two',
    teamId: 'team-1',
    teamName: 'Wildcats',
    createdAt: '2026-07-16T12:00:00Z',
  }

  it('describes member lifecycle and invite-link events from safe metadata', () => {
    expect(formatAuditEvent({
      ...baseEvent,
      eventType: 'team_member_invited',
      metadata: { role: 'viewer' },
    })).toBe('Coach One invited Coach Two as viewer')

    expect(formatAuditEvent({
      ...baseEvent,
      eventType: 'team_invite_accepted',
      metadata: { role: 'scorer' },
    })).toBe('Coach Two accepted the scorer invite')

    expect(formatAuditEvent({
      ...baseEvent,
      eventType: 'team_invite_declined',
      metadata: { role: 'admin' },
    })).toBe('Coach Two declined the admin invite')

    expect(formatAuditEvent({
      ...baseEvent,
      eventType: 'team_invite_canceled',
      metadata: { role: 'viewer' },
    })).toBe('Coach One canceled the viewer invite for Coach Two')

    expect(formatAuditEvent({
      ...baseEvent,
      eventType: 'team_member_left',
      metadata: {},
    })).toBe('Coach Two left the team')

    expect(formatAuditEvent({
      ...baseEvent,
      eventType: 'team_member_removed',
      metadata: {},
    })).toBe('Coach One removed Coach Two from the team')

    expect(formatAuditEvent({
      ...baseEvent,
      eventType: 'invite_link_created',
      metadata: { role: 'scorer' },
    })).toBe('Coach One created a scorer invite link')

    expect(formatAuditEvent({
      ...baseEvent,
      eventType: 'invite_link_redeemed',
      metadata: { role: 'viewer' },
    })).toBe('Coach Two joined as viewer using an invite link')

    expect(formatAuditEvent({
      ...baseEvent,
      eventType: 'invite_link_revoked',
      metadata: { role: 'scorer' },
    })).toBe('Coach One revoked a scorer invite link')
  })

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

  it('uses safe fallbacks for blank actor/target/metadata and unknown types', () => {
    expect(formatAuditEvent({
      ...baseEvent,
      actorDisplayName: '',
      targetDisplayName: null,
      eventType: 'team_member_invited',
      metadata: { role: '   ' },
    })).toBe('System invited a team member as member')

    expect(formatAuditEvent({
      ...baseEvent,
      eventType: 'custom_future_event',
      metadata: {},
    })).toBe('custom future event')
  })
})
