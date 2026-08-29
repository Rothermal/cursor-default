import { describe, expect, it } from 'vitest'
import type { GameEvent } from '../gameEvents/types'
import { gameEventRegistry } from '../gameEvents/runtime'
import { createBasketballLineupEvent } from './lineupEvents'

const period = { id: 'period-1', order: 1 }
const occurredAt = '2026-08-29T18:00:00.000Z'

describe('BKE-6C1 exact lineup payload contracts', () => {
  it('retains the shipped lineup-confirmed form and accepts only the exact recorded-later addition', () => {
    const live = createBasketballLineupEvent({
      id: uuid(1),
      eventType: 'basketball.lineup_confirmed',
      payload: {
        captureCommandId: uuid(2),
        participantIds: participantIds(),
        boundaryPeriodId: period.id,
      },
      recorderUserId: 'recorder-1',
      sequence: 1,
      period,
      elapsedMs: 0,
      occurredAt,
      teamSide: 'tracked',
    })
    expect(gameEventRegistry.inspect(live).ok).toBe(true)
    expect(gameEventRegistry.inspect({
      ...live,
      payload: { ...live.payload, recordedLater: true },
    }).ok).toBe(true)
    expect(gameEventRegistry.inspect({
      ...live,
      payload: { ...live.payload, recordedLater: false },
    } as GameEvent).ok).toBe(false)
    expect(gameEventRegistry.inspect({
      ...live,
      payload: { ...live.payload, unexpected: true },
    } as GameEvent).ok).toBe(false)
  })

  it('uses one final structured substitution form with an optional true marker', () => {
    const live = createBasketballLineupEvent({
      id: uuid(3),
      eventType: 'basketball.substitution',
      payload: {
        captureCommandId: uuid(4),
        participantIds: participantIds(),
        mode: 'balanced',
        reasonCode: null,
        reasonNote: null,
      },
      recorderUserId: 'recorder-1',
      sequence: 2,
      period,
      elapsedMs: 0,
      occurredAt,
      teamSide: 'tracked',
    })
    expect(gameEventRegistry.inspect(live).ok).toBe(true)
    expect(gameEventRegistry.inspect({
      ...live,
      payload: { ...live.payload, recordedLater: true },
    }).ok).toBe(true)
    expect(gameEventRegistry.inspect({
      ...live,
      payload: {
        captureCommandId: uuid(4),
        participantIds: participantIds(),
        mode: 'balanced',
        reason: null,
      },
    } as GameEvent).ok).toBe(false)
    expect(gameEventRegistry.inspect({
      ...live,
      payload: {
        ...live.payload,
        reasonCode: 'injury',
      },
    } as GameEvent).ok).toBe(false)
  })

  it('locks exact live and recorded-later role and override forms', () => {
    const role = createBasketballLineupEvent({
      id: uuid(5),
      eventType: 'basketball.role_changed',
      payload: {
        captureCommandId: uuid(6),
        changes: [{ participantId: 'tracked-1', position: 'PG', captain: false }],
      },
      recorderUserId: 'recorder-1',
      sequence: 3,
      period,
      elapsedMs: 0,
      occurredAt,
      teamSide: 'tracked',
    })
    const override = createBasketballLineupEvent({
      id: uuid(7),
      eventType: 'basketball.equal_play_override',
      payload: {
        captureCommandId: uuid(8),
        boundaryPeriodId: period.id,
        candidateParticipantIds: participantIds(),
        violationCodes: ['minimum_periods'],
        reason: 'Approved exception',
      },
      recorderUserId: 'recorder-1',
      sequence: 4,
      period,
      elapsedMs: 0,
      occurredAt,
      teamSide: 'tracked',
    })
    for (const event of [role, override]) {
      expect(gameEventRegistry.inspect(event).ok).toBe(true)
      expect(gameEventRegistry.inspect({
        ...event,
        payload: { ...event.payload, recordedLater: true },
      }).ok).toBe(true)
    }
  })

  it('requires structured reasons for unbalanced and short-handed results', () => {
    const base = createBasketballLineupEvent({
      id: uuid(9),
      eventType: 'basketball.substitution',
      payload: {
        captureCommandId: uuid(10),
        participantIds: participantIds().slice(0, 4),
        mode: 'exit_only',
        reasonCode: 'injury',
        reasonNote: null,
      },
      recorderUserId: 'recorder-1',
      sequence: 5,
      period,
      elapsedMs: 0,
      occurredAt,
      teamSide: 'tracked',
    })
    expect(gameEventRegistry.inspect(base).ok).toBe(true)
    expect(gameEventRegistry.inspect({
      ...base,
      payload: { ...base.payload, reasonCode: null },
    }).ok).toBe(false)
    expect(gameEventRegistry.inspect({
      ...base,
      payload: { ...base.payload, reasonCode: 'other', reasonNote: null },
    }).ok).toBe(false)

    const boundary = {
      ...base,
      payload: {
        ...base.payload,
        participantIds: participantIds(),
        mode: 'boundary',
        reasonCode: null,
        reasonNote: null,
      },
    } as GameEvent
    expect(gameEventRegistry.inspect(boundary).ok).toBe(true)

    const mixed = {
      ...base,
      payload: {
        ...base.payload,
        mode: 'mixed',
      },
    } as GameEvent
    expect(gameEventRegistry.inspect(mixed).ok).toBe(true)
    expect(gameEventRegistry.inspect({
      ...mixed,
      payload: { ...mixed.payload, reasonCode: null },
    } as GameEvent).ok).toBe(false)
  })
})

function participantIds(): string[] {
  return ['tracked-1', 'tracked-2', 'tracked-3', 'tracked-4', 'tracked-5']
}

function uuid(value: number): string {
  return `6c100000-0000-4000-8000-${String(value).padStart(12, '0')}`
}
