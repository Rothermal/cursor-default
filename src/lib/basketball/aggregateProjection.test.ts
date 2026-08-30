import { describe, expect, it } from 'vitest'
import {
  AGGREGATE_PARTICIPANTS,
  AGGREGATE_PLAYERS,
  ANCHORED_AGGREGATE_PLAYERS,
  makeAnchoredCanonicalAggregateSource,
  makeCanonicalAggregateSource,
} from './aggregateTestFixtures'
import { projectBasketballCanonicalAggregateSource } from './aggregateProjection'
import type { BasketballMatchEvent } from './types'

describe('Basketball canonical aggregate projection', () => {
  it('rebuilds completed snapshots and derives tracked player, team, score, and period truth', () => {
    const projected = projectBasketballCanonicalAggregateSource(makeCanonicalAggregateSource())
    expect(projected.ok).toBe(true)
    if (!projected.ok) throw new Error(projected.exclusion.message)

    expect(projected.match.authority).toBe('canonical')
    expect(projected.match.score).toEqual({ tracked: 5, opponent: 3 })
    expect(projected.match.result).toBe('win')
    expect(projected.match.periods).toEqual([
      expect.objectContaining({
        periodId: 'regulation-1', kind: 'regulation', tracked: 5, opponent: 3,
      }),
    ])
    expect(projected.match.players.map(player => player.playerId)).toEqual([
      AGGREGATE_PLAYERS.bench,
      AGGREGATE_PLAYERS.dnp,
      AGGREGATE_PLAYERS.late,
      AGGREGATE_PLAYERS.removedBench,
      AGGREGATE_PLAYERS.starter,
    ])
    expect(projected.match.players.some(player =>
      player.participantIds.includes(AGGREGATE_PARTICIPANTS.opponent)
    )).toBe(false)

    const starter = projected.match.players.find(
      player => player.playerId === AGGREGATE_PLAYERS.starter
    )
    expect(starter?.stats).toMatchObject({
      bk_app: 1, bk_start: 1, bk_pts: 2, bk_fgm: 1, bk_fga: 2,
      bk_pf: 5, bk_dq: 1, bk_min_sec: 720,
    })
    expect(projected.match.players.find(
      player => player.playerId === AGGREGATE_PLAYERS.bench
    )?.stats).toMatchObject({ bk_app: 1, bk_ast: 1, bk_eject: 1 })
    expect(projected.match.players.find(
      player => player.playerId === AGGREGATE_PLAYERS.late
    )?.stats).toMatchObject({ bk_app: 1, bk_start: 0, bk_pts: 3 })
    expect(projected.match.players.find(
      player => player.playerId === AGGREGATE_PLAYERS.removedBench
    )?.stats).toMatchObject({ bk_app: 0, bk_ast: 0 })
    expect(projected.match.players.find(
      player => player.playerId === AGGREGATE_PLAYERS.dnp
    )?.stats).toMatchObject({ bk_app: 0, bk_start: 0 })
  })

  it('uses projection-authoritative side totals instead of summing visible players', () => {
    const projected = projectBasketballCanonicalAggregateSource(makeCanonicalAggregateSource())
    if (!projected.ok) throw new Error(projected.exclusion.message)
    const visibleOffensiveRebounds = projected.match.players.reduce(
      (sum, player) => sum + player.stats.bk_oreb,
      0
    )
    expect(visibleOffensiveRebounds).toBe(0)
    expect(projected.match.teamStats.tracked.bk_oreb).toBe(1)
    expect(projected.match.teamStats.tracked.bk_pts).toBe(5)
    expect(projected.match.teamStats.tracked.bk_dq).toBe(1)
    expect(projected.match.teamStats.tracked.bk_eject).toBe(1)
    expect(projected.match.teamStats.opponent.bk_pts).toBe(3)
  })

  it('derives exact anchored participation, DNP, and side-specific plus-minus', () => {
    const projected = projectBasketballCanonicalAggregateSource(
      makeAnchoredCanonicalAggregateSource()
    )
    expect(projected.ok).toBe(true)
    if (!projected.ok) throw new Error(projected.exclusion.message)

    const player = (id: string) => projected.match.players.find(row => row.playerId === id)
    expect(player(ANCHORED_AGGREGATE_PLAYERS.starter)).toMatchObject({
      participationBasis: 'interval_derived',
      stats: { bk_app: 1, bk_start: 1, bk_dnp: 0, bk_min_sec: 1, bk_pm: 2 },
      metricEligibility: { bk_pm: { eligible: true, reason: null } },
    })
    expect(player(ANCHORED_AGGREGATE_PLAYERS.second)?.stats).toMatchObject({
      bk_app: 1, bk_start: 1, bk_min_sec: 2, bk_pm: 0,
    })
    expect(player(ANCHORED_AGGREGATE_PLAYERS.bench)?.stats).toMatchObject({
      bk_app: 1, bk_start: 0, bk_dnp: 0, bk_min_sec: 1, bk_pm: -2,
    })
    expect(player(ANCHORED_AGGREGATE_PLAYERS.dnp)?.stats).toMatchObject({
      bk_app: 0, bk_start: 0, bk_dnp: 1, bk_min_sec: 0, bk_pm: 0,
    })
    expect(player(ANCHORED_AGGREGATE_PLAYERS.opponent)?.stats).toMatchObject({
      bk_app: 1, bk_start: 1, bk_min_sec: 2, bk_pm: 0,
    })
    expect(projected.match.availableMetricIds).toEqual(expect.arrayContaining([
      'bk_dnp', 'bk_pm',
    ]))
  })

  it('reprojects revised scoring and keeps an unmapped anchored DNP harmless', () => {
    const corrected = makeAnchoredCanonicalAggregateSource()
    const events = corrected.canonicalSnapshot.eventStream.events as BasketballMatchEvent[]
    const opponentShot = events.find(event =>
      event.eventType === 'basketball.shot' && event.teamSide === 'opponent'
    )!
    opponentShot.revision = 2
    opponentShot.deletedAt = '2026-08-27T14:00:04.500Z'
    opponentShot.updatedAt = opponentShot.deletedAt
    const projected = projectBasketballCanonicalAggregateSource(corrected)
    if (!projected.ok) throw new Error(projected.exclusion.message)
    expect(projected.match.score).toEqual({ tracked: 2, opponent: 0 })
    expect(projected.match.players.find(
      row => row.playerId === ANCHORED_AGGREGATE_PLAYERS.bench
    )?.stats.bk_pm).toBe(0)

    const unresolved = makeAnchoredCanonicalAggregateSource()
    unresolved.participantSourceMap = {}
    const withoutMappings = projectBasketballCanonicalAggregateSource(unresolved)
    if (!withoutMappings.ok) throw new Error(withoutMappings.exclusion.message)
    expect(withoutMappings.match.unresolvedParticipants.some(
      row => row.displayName === 'Anchored dnp'
    )).toBe(false)
    expect(withoutMappings.match.unresolvedParticipants.every(
      row => row.contributionCount > 0
    )).toBe(true)
  })

  it('requires optional opponent lineup authority before projecting opponent players', () => {
    const projected = projectBasketballCanonicalAggregateSource(
      makeAnchoredCanonicalAggregateSource({ includeOpponentLineup: false })
    )
    if (!projected.ok) throw new Error(projected.exclusion.message)
    expect(projected.match.players.some(
      row => row.playerId === ANCHORED_AGGREGATE_PLAYERS.opponent
    )).toBe(false)
    expect(projected.match.teamStats.opponent.bk_pts).toBe(2)
    expect(projected.match.availableMetricIds).toContain('bk_pm')
  })

  it('retains only unresolved tracked contributions and never repairs identity by name', () => {
    const projected = projectBasketballCanonicalAggregateSource(
      makeCanonicalAggregateSource({ includeStableMappings: false })
    )
    if (!projected.ok) throw new Error(projected.exclusion.message)
    expect(projected.match.players).toEqual([])
    expect(projected.match.unresolvedParticipants.map(row => row.displayName).sort()).toEqual([
      'Bench Two', 'Late Six', 'Starter One',
    ])
    expect(projected.match.unresolvedParticipants.every(row => row.contributionCount > 0)).toBe(true)
  })

  it('counts effective activity by a setup-DNP participant as an appearance, not a start', () => {
    const source = makeCanonicalAggregateSource()
    const madeShot = source.canonicalSnapshot.eventStream.events.find(value =>
      (value as { sequence?: number }).sequence === 1
    ) as { actors: Array<{ participantId?: string; playerId?: string | null }> }
    madeShot.actors[0].participantId = AGGREGATE_PARTICIPANTS.dnp
    madeShot.actors[0].playerId = 'local-dnp'

    const projected = projectBasketballCanonicalAggregateSource(source)
    if (!projected.ok) throw new Error(projected.exclusion.message)
    expect(projected.match.players.find(
      player => player.playerId === AGGREGATE_PLAYERS.dnp
    )?.stats).toMatchObject({ bk_app: 1, bk_start: 0, bk_pts: 2 })
    expect(projected.match.players.find(
      player => player.playerId === AGGREGATE_PLAYERS.starter
    )?.stats).toMatchObject({ bk_app: 1, bk_start: 1, bk_pts: 0 })
  })

  it('records an ejection-only setup-DNP without fabricating an appearance', () => {
    const source = makeCanonicalAggregateSource()
    const ejection = source.canonicalSnapshot.eventStream.events.find(value =>
      (value as { eventType?: string }).eventType === 'basketball.ejection'
    ) as { actors: Array<{ participantId?: string; playerId?: string | null }> }
    ejection.actors[0].participantId = AGGREGATE_PARTICIPANTS.dnp
    ejection.actors[0].playerId = 'local-dnp'

    const projected = projectBasketballCanonicalAggregateSource(source)
    if (!projected.ok) throw new Error(projected.exclusion.message)
    expect(projected.match.players.find(
      player => player.playerId === AGGREGATE_PLAYERS.dnp
    )?.stats).toMatchObject({ bk_app: 0, bk_start: 0, bk_eject: 1 })
    expect(projected.match.teamStats.tracked.bk_eject).toBe(1)
  })

  it('excludes inactive and abandoned sources and quarantines recorder mismatches', () => {
    expect(projectBasketballCanonicalAggregateSource(
      makeCanonicalAggregateSource({ active: false })
    )).toMatchObject({ ok: false, exclusion: { kind: 'ineligible_source' } })
    expect(projectBasketballCanonicalAggregateSource(
      makeCanonicalAggregateSource({ endReason: 'abandoned' })
    )).toMatchObject({ ok: false, exclusion: { kind: 'abandoned_game' } })

    const malformed = makeCanonicalAggregateSource()
    const firstEvent = malformed.canonicalSnapshot.eventStream.events[0] as {
      recorderUserId: string | null
    }
    firstEvent.recorderUserId = 'someone-else'
    expect(projectBasketballCanonicalAggregateSource(malformed)).toMatchObject({
      ok: false,
      exclusion: { kind: 'malformed_source' },
    })
  })
})
