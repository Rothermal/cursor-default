import { describe, expect, it } from 'vitest'
import {
  AGGREGATE_PARTICIPANTS,
  AGGREGATE_PLAYERS,
  makeCanonicalAggregateSource,
} from './aggregateTestFixtures'
import { projectBasketballCanonicalAggregateSource } from './aggregateProjection'

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
