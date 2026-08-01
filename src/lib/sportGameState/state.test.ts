import { describe, expect, it } from 'vitest'
import { resolveSoccerMatchRules } from '../soccer/rules'
import { createSoccerSportGameState } from '../soccer/state'
import type { SoccerMatchSetup } from '../soccer/types'
import { sportSupportsLegacyAggregateCloudSync } from './capabilities'
import { normalizeSportGameState, sportGameStateForFingerprint } from './state'

function soccerSetup(): SoccerMatchSetup {
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    sourceTeamId: null,
    sourceSeasonId: null,
    rulesSnapshot: resolveSoccerMatchRules(),
    participants: [],
    firstPeriodAttackingDirection: 'left_to_right',
  }
}

describe('sport game state dispatch', () => {
  it('normalizes Soccer through its sport-owned normalizer', () => {
    const soccer = createSoccerSportGameState(soccerSetup())
    soccer.capturePreferences.captureMode = 'foul'

    expect(normalizeSportGameState(structuredClone(soccer))).toEqual(soccer)
  })

  it('rejects malformed and unknown sport-owned state', () => {
    expect(normalizeSportGameState(null)).toBeNull()
    expect(normalizeSportGameState({ sportId: 'soccer', version: 2 })).toBeNull()
    expect(normalizeSportGameState({ sportId: 'future-sport', version: 1 })).toBeNull()
  })

  it('fingerprints immutable setup without projection or capture preferences', () => {
    const soccer = createSoccerSportGameState(soccerSetup())

    expect(sportGameStateForFingerprint(soccer)).toEqual({
      sportId: 'soccer',
      version: soccer.version,
      setup: soccer.setup,
    })
  })

  it('grants legacy aggregate cloud sync only to configured legacy sports', () => {
    expect(['basketball', 'baseball', 'football', 'hockey'].map(
      sportSupportsLegacyAggregateCloudSync
    )).toEqual([true, true, true, true])
    expect(sportSupportsLegacyAggregateCloudSync('soccer')).toBe(false)
    expect(sportSupportsLegacyAggregateCloudSync('future-sport')).toBe(false)
  })
})
