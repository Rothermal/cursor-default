import { describe, expect, it } from 'vitest'
import { sports } from '../../config/sports'
import type { GameState } from '../../types'
import { createInitialState } from '../gameReducer'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import { createBasketballLifecycleEvent } from './events'
import { createBasketballAdministrativeEvent } from './administrativeEvents'
import {
  getBasketballRulesProfile,
  listBasketballRulesProfiles,
  normalizeBasketballRuleOverridesV2,
  previewBasketballProfileUpgrade,
  resolveBasketballRules,
  type BasketballRulesProfileId,
} from './profiles'
import {
  normalizeBasketballMatchRules,
  resolveBasketballFoulWindow,
  resolveBasketballTimeoutPool,
  resolveBasketballTimeoutPoolWithCarryover,
  validateBasketballMatchRules,
} from './rules'
import { createBasketballSportGameState } from './state'
import type {
  BasketballMatchParticipant,
  BasketballMatchEvent,
  BasketballMatchRulesV2,
  BasketballMatchSetup,
} from './types'

const basketball = sports.find(sport => sport.id === 'basketball')!

const EXPECTED: Array<{
  id: BasketballRulesProfileId
  periods: number
  minutes: number
  overtimeMinutes: number
  foulLimit: number
}> = [
  { id: 'nfhs', periods: 4, minutes: 8, overtimeMinutes: 4, foulLimit: 5 },
  { id: 'ncaa_men', periods: 2, minutes: 20, overtimeMinutes: 5, foulLimit: 5 },
  { id: 'ncaa_women', periods: 4, minutes: 10, overtimeMinutes: 5, foulLimit: 5 },
  { id: 'nba', periods: 4, minutes: 12, overtimeMinutes: 5, foulLimit: 6 },
  { id: 'fiba', periods: 4, minutes: 10, overtimeMinutes: 5, foulLimit: 5 },
  { id: 'youth_standard', periods: 4, minutes: 8, overtimeMinutes: 2, foulLimit: 5 },
  { id: 'youth_equal_play', periods: 8, minutes: 4, overtimeMinutes: 2, foulLimit: 5 },
]

describe('BKE-5A Basketball rules profiles', () => {
  it('ships source-linked, valid, independently versioned fixtures', () => {
    const profiles = listBasketballRulesProfiles()
    expect(profiles).toHaveLength(EXPECTED.length)
    expect(new Set(profiles.map(profile => `${profile.profileId}:${profile.profileVersion}`)).size)
      .toBe(EXPECTED.length)

    for (const expected of EXPECTED) {
      const profile = getBasketballRulesProfile(expected.id, 1)
      expect(profile).not.toBeNull()
      expect(profile?.sourceUrls.every(url => url.startsWith('https://'))).toBe(true)
      expect(profile?.reviewedAt).toBe('2026-08-23')
      expect(profile?.coverage.enforced.length).toBeGreaterThan(0)
      expect(profile?.coverage.deferred).toContain('Game and shot clock operation')
      expect(validateBasketballMatchRules(profile?.rules)).toBeNull()
      expect(profile?.rules.regulationSegments).toHaveLength(expected.periods)
      expect(profile?.rules.regulationSegments[0].durationMs).toBe(expected.minutes * 60_000)
      expect(profile?.rules.overtimeTemplate.durationMs).toBe(expected.overtimeMinutes * 60_000)
      expect(profile?.rules.personalFoulLimit).toBe(expected.foulLimit)
    }
  })

  it('returns clones instead of exposing mutable catalog records', () => {
    const first = getBasketballRulesProfile('nfhs', 1)!
    first.label = 'Changed'
    first.rules.regulationSegments[0].label = 'Changed'
    const second = getBasketballRulesProfile('nfhs', 1)!
    expect(second.label).toBe('NFHS')
    expect(second.rules.regulationSegments[0].label).toBe('Q1')
  })

  it('models current bonus and overtime differences without clock-dependent claims', () => {
    const nfhs = getBasketballRulesProfile('nfhs', 1)!.rules
    const men = getBasketballRulesProfile('ncaa_men', 1)!.rules
    const women = getBasketballRulesProfile('ncaa_women', 1)!.rules
    const nba = getBasketballRulesProfile('nba', 1)!.rules

    expect(resolveBasketballFoulWindow(nfhs, 'regulation-1')).toMatchObject({
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
    })
    expect(resolveBasketballFoulWindow(men, 'regulation-1')).toMatchObject({
      bonusThreshold: 7,
      doubleBonusThreshold: 10,
      hasOneAndOne: true,
    })
    expect(resolveBasketballFoulWindow(women, 'regulation-1')?.hasOneAndOne).toBe(false)
    expect(resolveBasketballFoulWindow(nba, 'overtime-1')).toMatchObject({
      bonusThreshold: 4,
      doubleBonusThreshold: 4,
      hasOneAndOne: false,
    })
    expect(nba.clockModel).toBe('none')
  })

  it('keeps equal-play period, lineup, foul, and timeout concepts separate', () => {
    const rules = getBasketballRulesProfile('youth_equal_play', 1)!.rules
    expect(rules.regulationSegments.map(segment => segment.label)).toEqual([
      'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8',
    ])
    expect(rules.regulationSegments.every(segment => segment.lineupChangeBoundary)).toBe(true)
    expect(rules.foulWindows.map(window => window.segmentIds.length)).toEqual([4, 4])
    expect(rules.timeoutPools.map(pool => pool.segmentIds.length)).toEqual([4, 4])
    expect(resolveBasketballFoulWindow(rules, 'regulation-4')?.id).toBe('foul-h1')
    expect(resolveBasketballFoulWindow(rules, 'regulation-5')?.id).toBe('foul-h2')
    expect(resolveBasketballTimeoutPool(rules, 'regulation-4')?.id).toBe('timeouts-h1')
    expect(resolveBasketballTimeoutPool(rules, 'regulation-5')?.id).toBe('timeouts-h2')
  })

  it('resolves sparse layers atomically with field-level source metadata', () => {
    const result = resolveBasketballRules({ profileId: 'nfhs', profileVersion: 1 }, [{
      id: 'personal',
      overrides: { personalFoulLimit: 6 },
    }, {
      id: 'match',
      overrides: { personalFoulLimit: 7 },
    }])
    expect(result).toMatchObject({
      ok: true,
      value: {
        rules: { personalFoulLimit: 7 },
        sourceByField: { personalFoulLimit: 'match', regulationSegments: 'built_in' },
        customized: true,
      },
    })

    expect(resolveBasketballRules({ profileId: 'nfhs', profileVersion: 99 })).toMatchObject({
      ok: false,
      layer: 'built_in',
    })
    expect(normalizeBasketballRuleOverridesV2({ unknown: true })).toBeNull()
    expect(resolveBasketballRules({ profileId: 'nfhs', profileVersion: 1 }, [{
      id: 'team',
      overrides: { personalFoulLimit: 0 },
    }])).toMatchObject({ ok: false, layer: 'team' })
  })

  it('reapplies compatible overrides and identifies profile-driven upgrade differences', () => {
    const preview = previewBasketballProfileUpgrade(
      { profileId: 'nfhs', profileVersion: 1 },
      { profileId: 'nba', profileVersion: 1 },
      { personalFoulLimit: 7 }
    )
    expect(preview).toMatchObject({
      ok: true,
      current: { rules: { personalFoulLimit: 7 } },
      candidate: { rules: { personalFoulLimit: 7 } },
    })
    if (!preview.ok) throw new Error(preview.message)
    expect(preview.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'regulationSegments', changedByProfile: true }),
    ]))
    expect(preview.differences.some(difference => difference.field === 'personalFoulLimit')).toBe(false)
  })

  it('rejects invalid references, assignments, thresholds, and timeout carryover', () => {
    const base = getBasketballRulesProfile('fiba', 1)!.rules
    expect(validateBasketballMatchRules(withRules(base, {
      regulationSegments: base.regulationSegments.map((segment, index) =>
        index === 0 ? { ...segment, foulWindowId: 'missing' } : segment
      ),
    }))).toContain('invalid foul window reference')
    expect(validateBasketballMatchRules(withRules(base, {
      foulWindows: base.foulWindows.map((window, index) =>
        index === 0 ? { ...window, doubleBonusThreshold: 4 } : window
      ),
    }))).toContain('foul windows are invalid')
    expect(validateBasketballMatchRules(withRules(base, {
      timeoutPools: base.timeoutPools.map((pool, index) => ({
        ...pool,
        carryoverToPoolId: index === 0 ? 'timeouts-h2' : 'timeouts-h1',
      })),
    }))).toContain('carryover must move forward')
  })

  it('carries only unused charged inventory into a later timeout pool', () => {
    const base = getBasketballRulesProfile('fiba', 1)!.rules
    const rules = withRules(base, {
      timeoutPools: base.timeoutPools.map((pool, index) => ({
        ...pool,
        carryoverToPoolId: index === 0 ? 'timeouts-h2' : null,
      })),
    })
    expect(validateBasketballMatchRules(rules)).toBeNull()
    const usage = new Map([['timeouts-h1', { total: 1, full: 1, short: 0 }]])
    expect(resolveBasketballTimeoutPoolWithCarryover(
      rules,
      'regulation-3',
      usage
    )).toMatchObject({ totalLimit: 4, fullLimit: 4, shortLimit: 0 })
  })

  it('normalizes v1 snapshots exactly and starts every v2 profile without catalog lookup', () => {
    const legacy = {
      periodsPerGame: 1,
      periodLabels: ['P1'],
      regulationSegments: [{
        id: 'regulation-1', label: 'P1', kind: 'regulation', order: 1, durationMs: 60_000,
      }],
      overtimeTemplate: { idPrefix: 'overtime', label: 'OT', durationMs: 60_000 },
      bonusThreshold: 5,
      doubleBonusThreshold: 5,
      hasOneAndOne: false,
      overtimeLabel: 'OT',
      overtimeFoulsReset: true,
      timeoutsPerPeriod: 1,
      timeoutsPerOvertime: 1,
      personalFoulLimit: 5,
      clockModel: 'none',
    }
    expect(normalizeBasketballMatchRules(legacy)).toEqual(legacy)
    expect(normalizeBasketballMatchRules(legacy)).not.toHaveProperty('rulesSchemaVersion')

    for (const profile of listBasketballRulesProfiles()) {
      const matchSetup = setup(profile.rules, profile.profileId)
      const initial: GameState = {
        ...createInitialState(),
        sport: basketball,
        gameDataAuthority: 'sport_events',
        sportGameState: createBasketballSportGameState(matchSetup),
        eventStream: {
          version: 1,
          events: [createBasketballLifecycleEvent({
            id: `90000000-0000-4000-8000-${String(EXPECTED.findIndex(item => item.id === profile.profileId) + 1).padStart(12, '0')}`,
            eventType: 'basketball.period_started',
            payload: { periodId: 'regulation-1', captureCommandId: null },
            recorderUserId: 'recorder-1',
            sequence: 0,
            period: { id: 'regulation-1', order: 1 },
            occurredAt: '2026-08-23T12:00:00.000Z',
          })],
        },
      }
      const rebuilt = rebuildGameEventProjection(initial, gameEventRegistry, gameEventProjectors)
      expect(rebuilt.inspection.complete, profile.profileId).toBe(true)
      expect(rebuilt.state.sportGameState?.sportId).toBe('basketball')
      if (rebuilt.state.sportGameState?.sportId !== 'basketball') throw new Error('Expected Basketball.')
      expect(rebuilt.state.sportGameState.projection.currentPeriodId).toBe('regulation-1')
    }
  })

  it('projects equal-play fouls across period boundaries within the same half window', () => {
    const profile = getBasketballRulesProfile('youth_equal_play', 1)!
    const events: BasketballMatchEvent[] = [
      periodEvent(0, 'basketball.period_started', 'regulation-1', 1),
      foulEvent(1, 'regulation-1', 1),
      periodEvent(2, 'basketball.period_ended', 'regulation-1', 1),
      periodEvent(3, 'basketball.period_started', 'regulation-2', 2),
      ...Array.from({ length: 6 }, (_, index) => foulEvent(4 + index, 'regulation-2', 2)),
    ]
    const rebuilt = projectProfile(profile.rules, profile.profileId, events)
    expect(rebuilt.inspection.complete).toBe(true)
    if (rebuilt.state.sportGameState?.sportId !== 'basketball') throw new Error('Expected Basketball.')
    expect(rebuilt.state.sportGameState.projection.periodTeamFouls).toMatchObject({
      'regulation-1': { tracked: 1 },
      'regulation-2': { tracked: 6 },
    })
    expect(rebuilt.state.sportGameState.projection.bonusStatusByPeriod['regulation-2'].tracked)
      .toBe('one_and_one')
  })

  it('fails closed when v2 charged timeouts exceed a shared half pool', () => {
    const profile = getBasketballRulesProfile('fiba', 1)!
    const events: BasketballMatchEvent[] = [
      periodEvent(0, 'basketball.period_started', 'regulation-1', 1),
      timeoutEvent(1, 'regulation-1', 1),
      timeoutEvent(2, 'regulation-1', 1),
      periodEvent(3, 'basketball.period_ended', 'regulation-1', 1),
      periodEvent(4, 'basketball.period_started', 'regulation-2', 2),
      timeoutEvent(5, 'regulation-2', 2),
    ]
    const rebuilt = projectProfile(profile.rules, profile.profileId, events)
    expect(rebuilt.inspection.complete).toBe(false)
    expect(rebuilt.inspection.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('timeout pool') }),
    ]))
  })
})

function withRules(
  rules: BasketballMatchRulesV2,
  changes: Partial<BasketballMatchRulesV2>
): BasketballMatchRulesV2 {
  return Object.assign(structuredClone(rules), structuredClone(changes))
}

function setup(rules: BasketballMatchRulesV2, profileId: string): BasketballMatchSetup {
  const participants: BasketballMatchParticipant[] = [{
    id: 'tracked-1',
    playerId: 'player-1',
    displayName: 'Player One',
    number: '1',
    teamSide: 'tracked',
    initialStatus: 'starter',
    position: null,
    captain: false,
  }]
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    sourceTeamId: null,
    sourceSeasonId: null,
    rulesSource: {
      profileId,
      profileVersion: 1,
      personalRevision: null,
      teamRevision: null,
      hasExplicitMatchOverrides: false,
    },
    rulesSnapshot: structuredClone(rules),
    participants,
  }
}

function projectProfile(
  rules: BasketballMatchRulesV2,
  profileId: string,
  events: BasketballMatchEvent[]
) {
  const initial: GameState = {
    ...createInitialState(),
    sport: basketball,
    gameDataAuthority: 'sport_events',
    sportGameState: createBasketballSportGameState(setup(rules, profileId)),
    eventStream: { version: 1, events },
  }
  return rebuildGameEventProjection(initial, gameEventRegistry, gameEventProjectors)
}

function periodEvent(
  sequence: number,
  eventType: 'basketball.period_started' | 'basketball.period_ended',
  periodId: string,
  order: number
) {
  return createBasketballLifecycleEvent({
    id: eventId(sequence),
    eventType,
    payload: { periodId, captureCommandId: null },
    recorderUserId: 'recorder-1',
    sequence,
    period: { id: periodId, order },
    occurredAt: eventTime(sequence),
  })
}

function foulEvent(sequence: number, periodId: string, order: number) {
  return createBasketballAdministrativeEvent({
    id: eventId(sequence),
    eventType: 'basketball.foul',
    payload: {
      class: 'personal',
      context: 'common',
      teamControlSide: null,
      incidentId: null,
      countingOverride: null,
      captureCommandId: null,
    },
    recorderUserId: 'recorder-1',
    sequence,
    period: { id: periodId, order },
    occurredAt: eventTime(sequence),
    teamSide: 'tracked',
    actors: [{ role: 'committed_by', kind: 'team', label: 'Tracked' }],
  })
}

function timeoutEvent(sequence: number, periodId: string, order: number) {
  return createBasketballAdministrativeEvent({
    id: eventId(sequence),
    eventType: 'basketball.timeout',
    payload: {
      kind: 'full',
      chargedSide: 'tracked',
      label: 'Full timeout',
      captureCommandId: null,
    },
    recorderUserId: 'recorder-1',
    sequence,
    period: { id: periodId, order },
    occurredAt: eventTime(sequence),
    teamSide: 'tracked',
    actors: [{ role: 'team', kind: 'team', label: 'Tracked' }],
  })
}

function eventId(sequence: number): string {
  return `91000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`
}

function eventTime(sequence: number): string {
  return new Date(Date.parse('2026-08-23T12:00:00.000Z') + sequence * 1_000).toISOString()
}
