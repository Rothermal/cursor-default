import { describe, expect, it } from 'vitest'
import {
  basketballLineupInitialSelection,
  buildBasketballLineupSheetModel,
} from './lineupSheetModel'
import type {
  BasketballLineupSideProjection,
  BasketballMatchProjection,
  BasketballProjectedParticipant,
  BasketballTeamSide,
} from './types'

describe('BKE-6C1 lineup sheet model', () => {
  it('derives current, bench, unavailable, outgoing, incoming, and a balanced result', () => {
    const projection = projectedGame({ opponent: true })
    projection.participants['tracked-7'].openingStatus = 'dnp'
    projection.participants['tracked-8'].ejected = true
    const model = buildBasketballLineupSheetModel(
      projection,
      'tracked',
      ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-5', 'tracked-6'],
      null,
      ''
    )

    expect(basketballLineupInitialSelection(projection, 'tracked')).toEqual(starters('tracked'))
    expect(model.current.map(row => row.participantId)).toEqual(starters('tracked'))
    expect(model.bench.map(row => row.participantId)).toEqual(['tracked-6'])
    expect(model.unavailable.map(row => [row.participantId, row.unavailableReason])).toEqual([
      ['tracked-7', 'DNP'],
      ['tracked-8', 'Ejected'],
    ])
    expect(model.outgoingParticipantIds).toEqual(['tracked-1'])
    expect(model.incomingParticipantIds).toEqual(['tracked-6'])
    expect(model).toMatchObject({ mode: 'balanced', reasonRequired: false, canCommit: true })
  })

  it('derives exit-only, entry-only, and mixed transitions with required reasons', () => {
    const projection = projectedGame()
    const exit = buildBasketballLineupSheetModel(
      projection,
      'tracked',
      starters('tracked').slice(0, 4),
      null,
      ''
    )
    expect(exit).toMatchObject({ mode: 'exit_only', reasonRequired: true, canCommit: false })
    expect(exit.validationMessage).toContain('Select a reason')

    const shortProjection = projectedGame()
    shortProjection.lineup!.sides.tracked!.currentParticipantIds = starters('tracked').slice(0, 4)
    const entry = buildBasketballLineupSheetModel(
      shortProjection,
      'tracked',
      starters('tracked'),
      'recovery',
      ''
    )
    expect(entry).toMatchObject({ mode: 'entry_only', reasonRequired: true, canCommit: true })

    const mixed = buildBasketballLineupSheetModel(
      projection,
      'tracked',
      ['tracked-2', 'tracked-3', 'tracked-4', 'tracked-6'],
      'injury',
      'Two exits and one entry'
    )
    expect(mixed).toMatchObject({ mode: 'mixed', reasonRequired: true, canCommit: true })
    expect(mixed.outgoingParticipantIds).toEqual(['tracked-1', 'tracked-5'])
    expect(mixed.incomingParticipantIds).toEqual(['tracked-6'])
  })

  it('rejects zero, duplicate, wrong-side, unavailable, and oversized lineups', () => {
    const projection = projectedGame({ opponent: true })
    projection.participants['tracked-6'].ejected = true
    const cases: Array<[string[], string]> = [
      [[], 'at least one'],
      [['tracked-1', 'tracked-1'], 'only once'],
      [['tracked-1', 'tracked-2', 'tracked-3', 'tracked-4', 'opponent-1'], 'unavailable'],
      [['tracked-1', 'tracked-2', 'tracked-3', 'tracked-4', 'tracked-6'], 'DNP, ejected'],
      [[...starters('tracked'), 'tracked-7'], 'at most five'],
    ]

    for (const [ids, message] of cases) {
      const model = buildBasketballLineupSheetModel(projection, 'tracked', ids, 'injury', '')
      expect(model.canCommit).toBe(false)
      expect(model.validationMessage).toContain(message)
    }
  })

  it('requires a bounded note only for Other and keeps opponent authority independent', () => {
    const projection = projectedGame({ opponent: true })
    const ids = starters('opponent').slice(0, 4)
    expect(buildBasketballLineupSheetModel(
      projection, 'opponent', ids, 'other', ''
    ).validationMessage).toContain('Other')
    expect(buildBasketballLineupSheetModel(
      projection, 'opponent', ids, 'other', 'Temporary short bench'
    )).toMatchObject({ mode: 'exit_only', canCommit: true })
    expect(buildBasketballLineupSheetModel(
      projection, 'opponent', ids, 'injury', 'x'.repeat(241)
    ).validationMessage).toContain('240')
    expect(buildBasketballLineupSheetModel(
      projectedGame(), 'opponent', ids, 'injury', ''
    ).validationMessage).toContain('unavailable')
  })

  it('allows an unchanged candidate only for boundary confirmation', () => {
    const projection = projectedGame()
    expect(buildBasketballLineupSheetModel(
      projection, 'tracked', starters('tracked'), null, ''
    )).toMatchObject({ changed: false, canCommit: false })
    expect(buildBasketballLineupSheetModel(
      projection,
      'tracked',
      starters('tracked'),
      null,
      '',
      { allowUnchanged: true }
    )).toMatchObject({ changed: false, canCommit: true, validationMessage: null })
  })
})

function projectedGame({ opponent = false }: { opponent?: boolean } = {}): BasketballMatchProjection {
  const participants = Object.fromEntries([
    ...participantsFor('tracked', 8),
    ...(opponent ? participantsFor('opponent', 7) : []),
  ].map(participant => [participant.participantId, participant]))
  return {
    status: 'in_progress',
    currentPeriodId: 'period-1',
    periods: [],
    startedPeriodIds: ['period-1'],
    completedPeriodIds: [],
    participants,
    sideStats: {} as BasketballMatchProjection['sideStats'],
    teamActorStats: {} as BasketballMatchProjection['teamActorStats'],
    periodTeamFouls: {},
    periodTimeouts: {},
    bonusStatusByPeriod: {},
    neutralTimeouts: 0,
    ejections: [],
    score: {} as BasketballMatchProjection['score'],
    clock: {} as BasketballMatchProjection['clock'],
    lineup: {
      sides: {
        tracked: sideProjection('tracked'),
        opponent: opponent ? sideProjection('opponent') : null,
      },
      runningClockIntervals: [],
      equalPlayReviews: [],
      equalPlayCompliant: true,
      enforcedOverridesComplete: true,
      pendingEqualPlayOverride: null,
    },
    relationshipWarnings: [],
    endedAt: null,
    endReason: null,
    result: 'unresolved',
  }
}

function participantsFor(
  side: BasketballTeamSide,
  count: number
): BasketballProjectedParticipant[] {
  return Array.from({ length: count }, (_, index) => ({
    participantId: `${side}-${index + 1}`,
    playerId: `${side}-player-${index + 1}`,
    displayName: `${side === 'tracked' ? 'Player' : 'Opponent'} ${index + 1}`,
    number: String(index + 1),
    teamSide: side,
    openingStatus: index < 5 ? 'starter' : 'bench',
    position: null,
    captain: false,
    lateAdded: false,
    stats: {} as BasketballProjectedParticipant['stats'],
    disqualified: false,
    ejected: false,
  }))
}

function starters(side: BasketballTeamSide): string[] {
  return Array.from({ length: 5 }, (_, index) => `${side}-${index + 1}`)
}

function sideProjection(teamSide: BasketballTeamSide): BasketballLineupSideProjection {
  return {
    teamSide,
    currentParticipantIds: starters(teamSide),
    currentShortHandedReasonCode: null,
    currentShortHandedReasonNote: null,
    boundaryConfirmationRequired: false,
    boundaryConfirmedPeriodId: null,
    clockStartedInPeriod: false,
    replacementRequiredParticipantIds: [],
    incompletePeriodIds: [],
    onCourtIntervals: [],
    participationByParticipantId: {},
    roleHistoryByParticipantId: {},
  }
}
