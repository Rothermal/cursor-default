import { describe, expect, it } from 'vitest'
import { DEFAULT_SOCCER_MATCH_RULES } from './rules'
import { createSoccerMatchProjection } from './state'
import {
  formatSoccerMatchFormat,
  isSoccerSummaryRoute,
  legacySoccerReviewSummaryPath,
  parseSoccerSummaryQuery,
  soccerMatchLeaders,
  soccerSummaryBackPath,
  soccerSummaryPath,
  soccerSummaryResult,
  soccerTeamComparison,
} from './summary'
import type { SoccerMatchSetup } from './types'

function setup(): SoccerMatchSetup {
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    firstPeriodAttackingDirection: 'left_to_right',
    sourceTeamId: 'team-1',
    sourceSeasonId: 'season-1',
    rulesSnapshot: structuredClone(DEFAULT_SOCCER_MATCH_RULES),
    participants: [
      {
        id: 'participant-a',
        kind: 'player',
        playerId: 'player-a',
        displayName: 'Alex Morgan',
        number: '13',
        initialStatus: 'starter',
        initialRole: { group: 'forward', label: null },
      },
      {
        id: 'participant-b',
        kind: 'player',
        playerId: 'player-b',
        displayName: 'Sam Rivera',
        number: '8',
        initialStatus: 'starter',
        initialRole: { group: 'midfielder', label: null },
      },
    ],
  }
}

describe('soccer summary navigation', () => {
  it('parses shipped tabs and falls back future tabs to overview', () => {
    expect(
      parseSoccerSummaryQuery(new URLSearchParams('tab=players')).tab
    ).toBe('players')
    const parsed = parseSoccerSummaryQuery(
      new URLSearchParams(
        'gameId=game-1&tab=field&from=game-info&teamId=team-1'
      )
    )
    expect(parsed).toEqual({
      gameId: 'game-1',
      tab: 'field',
      requestedTab: 'field',
      from: 'game-info',
      teamId: 'team-1',
    })
    expect(soccerSummaryBackPath(parsed)).toBe(
      '/game-info?gameId=game-1&teamId=team-1'
    )
    expect(
      parseSoccerSummaryQuery(new URLSearchParams('tab=shootout')).tab
    ).toBe('shootout')
    expect(
      parseSoccerSummaryQuery(new URLSearchParams('tab=future')).tab
    ).toBe('overview')
  })

  it('rejects unknown return contexts and uses the soccer dashboard', () => {
    const parsed = parseSoccerSummaryQuery(
      new URLSearchParams('gameId=game-1&from=somewhere')
    )
    expect(parsed.from).toBeNull()
    expect(soccerSummaryBackPath(parsed)).toBe('/sport/soccer')
  })

  it('builds direct and legacy summary paths without unrelated parameters', () => {
    expect(
      soccerSummaryPath({
        gameId: 'game 1',
        tab: 'players',
        from: 'team',
        teamId: 'team/1',
      })
    ).toBe(
      '/summary?gameId=game+1&tab=players&from=team&teamId=team%2F1'
    )
    expect(
      soccerSummaryPath({
        gameId: 'game-1',
        tab: 'shootout',
        from: 'games',
      })
    ).toBe('/summary?gameId=game-1&tab=shootout&from=games')
    expect(
      legacySoccerReviewSummaryPath(
        '?gameId=game-1&tab=timeline&from=games&junk=ignored'
      )
    ).toBe('/summary?gameId=game-1&tab=timeline&from=games')
  })

  it('keeps direct cloud soccer summary routing after local state is discarded', () => {
    expect(
      isSoccerSummaryRoute(null, new URLSearchParams('gameId=game-1'))
    ).toBe(true)
    expect(isSoccerSummaryRoute('soccer', new URLSearchParams())).toBe(true)
    expect(isSoccerSummaryRoute('basketball', new URLSearchParams())).toBe(false)
  })
})

describe('soccer summary read model', () => {
  it('labels regulation, extra-time, shootout, suspended, and abandoned results', () => {
    const projection = createSoccerMatchProjection(setup())
    projection.status = 'ended'
    projection.endReason = 'completed'
    projection.result = 'tracked_win'
    projection.decidedStage = 'regulation'
    expect(soccerSummaryResult(projection)).toMatchObject({
      resultLabel: 'Win',
      decisionLabel: null,
    })

    projection.decidedStage = 'extra_time'
    expect(soccerSummaryResult(projection).decisionLabel).toBe('AET')

    projection.decidedStage = 'shootout'
    projection.shootout = {
      firstKickingSide: 'tracked',
      initialKicksPerSide: 5,
      trackedEligibleParticipantIds: [],
      trackedExcludedParticipantIds: [],
      opponentEligibleCount: 0,
      currentGoalkeepers: { tracked: 'unknown', opponent: 'unknown' },
      kicks: [],
      score: { tracked: 4, opponent: 3 },
      attempts: { tracked: 5, opponent: 5 },
      saves: { tracked: 1, opponent: 0 },
      cards: {
        trackedYellow: 0,
        trackedRed: 0,
        opponentYellow: 0,
        opponentRed: 0,
      },
      nextSide: 'tracked',
      decided: true,
      winner: 'tracked',
      suddenDeathRound: null,
    }
    expect(soccerSummaryResult(projection)).toMatchObject({
      decisionLabel: 'Pens',
      shootoutScore: { tracked: 4, opponent: 3 },
    })

    projection.status = 'suspended'
    projection.result = 'suspended'
    expect(soccerSummaryResult(projection).resultLabel).toBe('Suspended')

    projection.status = 'ended'
    projection.endReason = 'abandoned'
    projection.result = 'abandoned'
    expect(soccerSummaryResult(projection).resultLabel).toBe('Abandoned')
  })

  it('keeps key zero comparison rows and hides empty optional rows', () => {
    const projection = createSoccerMatchProjection(setup())
    const sections = soccerTeamComparison(projection)
    expect(sections.find(section => section.id === 'attack')?.rows.map(row => row.id))
      .toEqual(['shots', 'shots_on_target', 'corners'])
    expect(sections.find(section => section.id === 'defense')?.rows.map(row => row.id))
      .toEqual(['saves'])
    expect(sections.find(section => section.id === 'discipline')?.rows.map(row => row.id))
      .toEqual(['fouls', 'yellow_cards', 'red_cards'])

    projection.sideTotals.opponent.offsides = 2
    projection.sideTotals.tracked.throwIns = 4
    projection.sideTotals.opponent.goalKicks = 3
    const attackRows = soccerTeamComparison(projection)
      .find(section => section.id === 'attack')
      ?.rows
    expect(
      attackRows?.find(row => row.id === 'offsides')
    ).toMatchObject({ tracked: 0, opponent: 2 })
    expect(attackRows?.find(row => row.id === 'throw_ins'))
      .toMatchObject({ tracked: 4, opponent: 0 })
    expect(attackRows?.find(row => row.id === 'goal_kicks'))
      .toMatchObject({ tracked: 0, opponent: 3 })
  })

  it('returns every tied nonzero leader and hides empty categories', () => {
    const projection = createSoccerMatchProjection(setup())
    projection.participantStats['participant-a'].goals = 2
    projection.participantStats['participant-b'].goals = 2
    projection.participantStats['participant-a'].primaryAssists = 1
    projection.participantStats['participant-a'].secondaryAssists = 1
    projection.participantStats['participant-b'].tacklesWon = 3
    projection.participantStats['participant-b'].interceptions = 1

    const leaders = soccerMatchLeaders(projection)
    expect(leaders.find(category => category.id === 'goals')?.leaders)
      .toHaveLength(2)
    expect(leaders.find(category => category.id === 'assists')?.leaders[0])
      .toMatchObject({ participantId: 'participant-a', value: 2 })
    expect(leaders.find(category => category.id === 'defensive_actions')?.leaders[0])
      .toMatchObject({ participantId: 'participant-b', value: 4 })
    expect(leaders.some(category => category.id === 'saves')).toBe(false)
  })

  it('formats common and mixed match segment lengths', () => {
    expect(formatSoccerMatchFormat(DEFAULT_SOCCER_MATCH_RULES)).toBe('2 x 45 min')
    expect(
      formatSoccerMatchFormat({
        ...DEFAULT_SOCCER_MATCH_RULES,
        regulationSegments: [
          { id: 'p1', label: 'P1', kind: 'regulation', order: 1, durationMs: 20 * 60_000 },
          { id: 'p2', label: 'P2', kind: 'regulation', order: 2, durationMs: 25 * 60_000 },
        ],
      })
    ).toBe('20 min + 25 min')
  })
})
