import { sports } from '../../config/sports'
import { createInitialState } from '../gameReducer'
import { stableJson } from '../gameEvents/stream'
import { assertExactBaseballParticipants, baseballMapFingerprint, parseBaseballParticipantMap } from './aggregateIdentity'
import { baseballDecisionsView } from './decisions'
import { parseBaseballCanonicalSnapshot } from './finalization'
import { replayBaseballAggregateAppearances, replayBaseballPitches } from './projector'
import { baseballParticipantStats } from './stats'
import { createBaseballSportGameState } from './state'
import { baseballSummarySource } from './summary'
import { addBaseballAggregatePlayer, BASEBALL_APPEARANCE_STAT_IDS, emptyBaseballAggregatePlayer, emptyBaseballDecisionCoverage } from './aggregateStats'
import type { BaseballAggregateExclusion, BaseballAggregateLoadScope, BaseballAggregateMatch, BaseballAggregatePlayer,
  BaseballAggregateResult, BaseballAggregateRosterPlayer, BaseballAggregateTeamTotals, BaseballCanonicalAggregateSource } from './aggregateTypes'
import type { BaseballEvent, BaseballRulesVariant, BaseballTeamSide } from './types'

export type BaseballAggregateSourceProjection = { ok: true; match: BaseballAggregateMatch } | { ok: false; exclusion: BaseballAggregateExclusion }

export function projectBaseballCanonicalAggregateSource(source: BaseballCanonicalAggregateSource): BaseballAggregateSourceProjection {
  const exclude = (kind: BaseballAggregateExclusion['kind'], message: string): BaseballAggregateSourceProjection => ({
    ok: false, exclusion: { kind, sourceId: source.publicationId, gameId: source.game.id, message },
  })
  try {
    if (source.identityStatus !== 'valid') return exclude('invalid_identity', source.identityDiagnostic ?? 'Invalid published Baseball identity.')
    if (source.game.status !== 'final') return exclude('ineligible_source', 'Only final canonical Baseball publications count.')
    if (!/^\d{4}-\d\d-\d\d$/.test(source.game.date) || !Number.isFinite(Date.parse(source.game.date))
      || new Date(source.game.date).toISOString().slice(0, 10) !== source.game.date) return exclude('malformed_source', 'Invalid Baseball game date.')
    const snapshot = parseBaseballCanonicalSnapshot(source.canonicalSnapshot)
    if (snapshot.gameId !== source.game.id) return exclude('malformed_source', 'The canonical snapshot names another game.')
    const setup = snapshot.sportGameState.setup
    if (setup.sourceTeamId !== source.game.teamId || setup.sourceSeasonId !== source.game.seasonId) {
      return exclude('malformed_source', 'The Baseball setup and cloud scope disagree.')
    }
    let map: Record<string, string | null>
    try {
      map = parseBaseballParticipantMap(source.participantSourceMap)
      if (source.game.cloudScope === 'personal') {
        baseballMapFingerprint(source.participantMapFingerprint)
        assertExactBaseballParticipants(map, setup.participants.map(p => p.id))
      } else if (source.participantMapFingerprint !== null) throw new Error('Team maps cannot carry personal pins.')
    } catch (error) { return exclude('invalid_identity', error instanceof Error ? error.message : 'Invalid Baseball identity.') }

    const base = createInitialState()
    const summary = baseballSummarySource({ ...base, sport: sports.find(s => s.id === 'baseball')!,
      gameDataAuthority: 'sport_events', eventStream: snapshot.eventStream,
      sportGameState: createBaseballSportGameState(setup) })
    if (!summary.healthy || !summary.sport) return exclude('malformed_source', summary.diagnostic ?? 'The publication cannot replay.')
    const { projection } = summary.sport
    if (projection.status !== 'final' || !['completed', 'run_rule', 'time_limit'].includes(projection.result?.outcome ?? '')) {
      return exclude('ineligible_source', 'This Baseball outcome does not contribute to official totals.')
    }
    const events = summary.inspection.activeEvents
    const appearances = replayBaseballAggregateAppearances(setup, events)
    const pitches = replayBaseballPitches(setup, events)
    const eventById = new Map(events.map(e => [e.id, e]))
    const decisionsView = baseballDecisionsView(summary.sport, events)
    const decisions = emptyBaseballDecisionCoverage()
    const currentDecisions = decisionsView.current?.decisions
    const absentPitcher = currentDecisions && [currentDecisions.tracked.win, currentDecisions.tracked.loss,
      currentDecisions.tracked.save, ...currentDecisions.tracked.holds].some(id => id !== null && !appearances.pitching.has(id))
    const decisionStatus = !currentDecisions ? 'absent' : decisionsView.issues.length || absentPitcher ? 'reviewNeeded'
      : [currentDecisions.tracked, currentDecisions.opponent].every(d => !d.win && !d.loss && !d.save && d.holds.length === 0) ? 'reviewedEmpty' : 'valid'
    decisions[decisionStatus] = 1
    const players = new Map<string, BaseballAggregatePlayer>()
    const unlinked: BaseballAggregateMatch['unlinked'] = []
    const basis = setup.rulesSnapshot.scheduledInnings
    for (const participant of setup.participants) {
      const byParticipant = map[participant.id]
      const byAlias = source.game.cloudScope === 'team' && participant.playerId ? map[participant.playerId] : undefined
      if (byParticipant && byAlias && byParticipant !== byAlias) return exclude('invalid_identity', 'Conflicting Baseball participant aliases.')
      const playerId = byParticipant ?? byAlias ?? null
      if (!playerId) {
        unlinked.push({ participantId: participant.id, displayName: participant.displayName, appeared: appearances.played.has(participant.id) })
        continue
      }
      const row = emptyBaseballAggregatePlayer(playerId, participant.displayName, participant.number)
      Object.assign(row.stats, baseballParticipantStats(projection, participant.id))
      for (const [id, set] of [
        ['bsb_gp', appearances.played], ['bsb_gs', appearances.started], ['bsb_b_gp', appearances.batting],
        ['bsb_f_gp', appearances.fielding], ['bsb_p_gp', appearances.pitching],
        ['bsb_p_gs', appearances.pitchingStarted], ['bsb_running_gp', appearances.running],
      ] as const) row.stats[id] = Number(set.has(participant.id))
      if (row.stats.bsb_p_gp) {
        row.pitchingBases[basis] = { outs: row.stats.bsb_p_outs, er: row.stats.bsb_p_er, k: row.stats.bsb_p_k }
        row.decisions[decisionStatus] = 1
        const incomplete = (projection.pitchingLines[participant.id]?.untrackedPlateAppearances ?? 0) > 0
        row.pitchCountLowerBoundGames = Number(incomplete)
        row.pitchCoverage[incomplete ? 'excludedGames' : 'includedGames'] = 1
        if (!incomplete) for (const pitch of pitches.filter(p => p.pitcherId === participant.id)) {
          const event = eventById.get(pitch.eventId) as BaseballEvent<'baseball.pitch'>
          const strike = !['ball', 'intentional_ball', 'pitchout', 'hit_by_pitch'].includes(event.payload.result)
          row.pitchCoverage.recordedPitches += 1
          row.pitchCoverage.recordedStrikes += Number(strike)
          row.pitchCoverage.firstPitchObservations += Number(pitch.firstPitch)
          row.pitchCoverage.firstPitchStrikes += Number(pitch.firstPitch && strike)
          row.pitchCoverage.unlocatedPitches += Number(event.payload.pitchLocation === null)
        }
        if (decisionsView.current && decisionStatus !== 'reviewNeeded') {
          const chosen = decisionsView.current.decisions.tracked
          for (const [id, awarded] of [['bsb_p_w', chosen.win === participant.id], ['bsb_p_l', chosen.loss === participant.id],
            ['bsb_p_sv', chosen.save === participant.id], ['bsb_p_hld', chosen.holds.includes(participant.id)]] as const) row.stats[id] = Number(awarded)
        }
      }
      row.pitchesSeenLowerBoundGames = Number(appearances.incompleteBatters.has(participant.id))
      const previous = players.get(playerId)
      if (previous) mergeGamePlayer(previous, row)
      else players.set(playerId, row)
    }
    return { ok: true, match: { sourceId: source.publicationId,
      sourceFingerprint: stableJson({ snapshot: source.snapshotFingerprint, pin: source.participantMapFingerprint,
        map, canonical: snapshot, game: source.game, publicationNumber: source.publicationNumber,
        finalizedAt: source.finalizedAt }), game: structuredClone(source.game), finalizedAt: source.finalizedAt,
      variant: setup.rulesSnapshot.variant, basis, players: [...players.values()], unlinked,
      teamTotals: { tracked: teamTotals('tracked'), opponent: teamTotals('opponent') },
      outcome: projection.result?.winner === 'tie' ? 'tie' : projection.result?.winner === 'tracked' ? 'win' : 'loss', decisions } }

    function teamTotals(side: BaseballTeamSide): BaseballAggregateTeamTotals {
      const batting = projection.lineScore.filter(line => line.battingSide === side)
      const fielding = projection.lineScore.filter(line => line.battingSide !== side)
      return { runs: projection.score[side], hits: batting.reduce((n, l) => n + l.hits, 0),
        errors: fielding.reduce((n, l) => n + l.errors, 0), leftOnBase: batting.reduce((n, l) => n + l.leftOnBase, 0) }
    }
  } catch (error) { return exclude('malformed_source', error instanceof Error ? error.message : 'Invalid Baseball publication.') }
}

/** Merge lineage may converge. Counts sum, but a person appears only once per game. */
function mergeGamePlayer(target: BaseballAggregatePlayer, source: BaseballAggregatePlayer): void {
  const flags = Object.fromEntries(BASEBALL_APPEARANCE_STAT_IDS.map(id => [id, Math.max(target.stats[id], source.stats[id])]))
  addBaseballAggregatePlayer(target, source)
  Object.assign(target.stats, flags)
  target.pitchesSeenLowerBoundGames = Math.min(1, target.pitchesSeenLowerBoundGames)
  target.pitchCountLowerBoundGames = Math.min(1, target.pitchCountLowerBoundGames)
  for (const key of Object.keys(target.decisions) as Array<keyof typeof target.decisions>) target.decisions[key] = Math.min(1, target.decisions[key])
  if (target.pitchCoverage.excludedGames) {
    for (const key of Object.keys(target.pitchCoverage) as Array<keyof typeof target.pitchCoverage>) target.pitchCoverage[key] = 0
    target.pitchCoverage.excludedGames = 1
  } else target.pitchCoverage.includedGames = Math.min(1, target.pitchCoverage.includedGames)
}

/** Collisions invalidate every contribution for that game, independent of arrival order. */
export function aggregateBaseballMatches(
  scope: BaseballAggregateLoadScope, variant: BaseballRulesVariant, matches: readonly BaseballAggregateMatch[],
  exclusions: readonly BaseballAggregateExclusion[] = [], roster: readonly BaseballAggregateRosterPlayer[] = [],
): BaseballAggregateResult {
  const errors = [...exclusions]
  const byGame = new Map<string, BaseballAggregateMatch[]>()
  for (const match of matches) byGame.set(match.game.id, [...(byGame.get(match.game.id) ?? []), match])
  const byPublication = new Map<string, Set<string>>()
  for (const match of matches) {
    const games = byPublication.get(match.sourceId) ?? new Set<string>()
    games.add(match.game.id)
    byPublication.set(match.sourceId, games)
  }
  const games: BaseballAggregateMatch[] = []
  let filteredVariantCount = 0
  for (const group of byGame.values()) {
    const first = group[0]
    const collision = group.some(m => m.sourceId !== first.sourceId || stableJson(m) !== stableJson(first) || byPublication.get(m.sourceId)!.size > 1)
      || errors.some(e => e.sourceId === first.sourceId || e.gameId === first.game.id)
    if (collision) {
      errors.push({ kind: 'authority_collision', gameId: first.game.id, sourceId: first.sourceId, message: 'Conflicting active Baseball publication identities.' })
    } else if (first.variant === variant) games.push(structuredClone(first))
    else filteredVariantCount += 1
  }
  const players = new Map<string, BaseballAggregatePlayer>()
  for (const player of roster) {
    if (!isPlayerScope(scope)) {
      const id = scope.type === 'team' ? player.teamId : scope.type === 'season' ? player.seasonId : player.tournamentId
      if (scope.id !== id || (scope.type === 'tournament' && player.teamId !== scope.teamId)) continue
    }
    if (isPlayerScope(scope) && player.playerId !== scope.playerId) continue
    players.set(player.playerId, emptyBaseballAggregatePlayer(player.playerId, player.displayName, player.number))
  }
  const teams: BaseballAggregateResult['teams'] = []
  for (const game of games) {
    for (const player of game.players) {
      if (isPlayerScope(scope) && player.playerId !== scope.playerId) continue
      const target = players.get(player.playerId) ?? emptyBaseballAggregatePlayer(player.playerId, player.displayName, player.number)
      addBaseballAggregatePlayer(target, player)
      players.set(player.playerId, target)
    }
    if (!game.game.teamId) continue
    let team = teams.find(t => t.teamId === game.game.teamId)
    if (!team) { team = { teamId: game.game.teamId, games: 0, wins: 0, losses: 0, ties: 0,
      totals: { tracked: { runs: 0, hits: 0, errors: 0, leftOnBase: 0 }, opponent: { runs: 0, hits: 0, errors: 0, leftOnBase: 0 } } }; teams.push(team) }
    team.games += 1
    team[game.outcome === 'win' ? 'wins' : game.outcome === 'loss' ? 'losses' : 'ties'] += 1
    for (const side of ['tracked', 'opponent'] as const) for (const key of ['runs', 'hits', 'errors', 'leftOnBase'] as const) team.totals[side][key] += game.teamTotals[side][key]
  }
  return { variant, players: [...players.values()], games, teams, exclusions: errors,
    quality: errors.length ? 'partial' : 'complete',
    unlinkedAppearances: games.reduce((n, g) => n + g.unlinked.filter(p => p.appeared).length, 0), filteredVariantCount }
}

export function isPlayerScope(scope: BaseballAggregateLoadScope): scope is Extract<BaseballAggregateLoadScope, { playerId: string }> {
  return scope.type === 'player' || scope.type === 'career'
}
