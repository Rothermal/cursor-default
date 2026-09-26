import type { GameState, Player } from '../../types'
import { isTeamPseudoPlayer } from '../teamPlayers'
import { BASKETBALL_POSITION_OPTIONS } from './positions'
import type { BasketballProjectedParticipant } from './types'
import type { BasketballFreeThrowTripStatus } from './foulFreeThrowCommands'

export function basketballParticipantIsLive(state: GameState, participant: BasketballProjectedParticipant): boolean {
  if (participant.disqualified || participant.ejected) return false
  const sport = state.sportGameState
  if (sport?.sportId !== 'basketball') return false
  const side = sport.projection.lineup?.sides[participant.teamSide]
  const tracked = sport.setup.version === 2 && sport.setup.openingLineups?.[participant.teamSide] != null
  if (!side) return !tracked
  return !side.boundaryConfirmationRequired && side.currentParticipantIds.includes(participant.participantId)
}

export function basketballActorPlayers(state: GameState, players: Player[], includeBench = false): Player[] {
  const sport = state.sportGameState
  if (state.gameDataAuthority === 'sport_events' && sport?.sportId !== 'basketball') return players.filter(isTeamPseudoPlayer)
  const participants = sport?.sportId === 'basketball' ? Object.values(sport.projection.participants) : []
  const byPlayer = new Map(participants.map(participant => [participant.playerId, participant]))
  const position = (player: Player) => byPlayer.get(player.id)?.position ?? null
  const rank = (value: string | null) => {
    if (!value) return 6
    const index = BASKETBALL_POSITION_OPTIONS.findIndex(option => option === value)
    return index < 0 ? 5 : index
  }
  return players.filter(player => {
    if (isTeamPseudoPlayer(player)) return true
    if (sport?.sportId !== 'basketball') return true
    const participant = byPlayer.get(player.id)
    return participant && !participant.disqualified && !participant.ejected &&
      (includeBench || basketballParticipantIsLive(state, participant))
  }).sort((a, b) => {
    if (isTeamPseudoPlayer(a) || isTeamPseudoPlayer(b)) return Number(isTeamPseudoPlayer(a)) - Number(isTeamPseudoPlayer(b))
    const pa = position(a), pb = position(b)
    return rank(pa) - rank(pb) ||
      (rank(pa) === 5 ? (pa ?? '').localeCompare(pb ?? '') : 0) ||
      Number(!a.number) - Number(!b.number) || a.number.localeCompare(b.number, 'en', { numeric: true }) ||
      a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  })
}

export function basketballTripShooter(trip: BasketballFreeThrowTripStatus): string | null {
  return [...trip.attempts].sort((a, b) => b.attemptNumber - a.attemptNumber)
    .find(attempt => !attempt.deleted && attempt.shooterPlayerId)?.shooterPlayerId ?? null
}

export function basketballOpenTrips(state: GameState, trips: BasketballFreeThrowTripStatus[], side: 'tracked' | 'opponent') {
  return trips.filter(trip => trip.open && trip.teamSide === side &&
    state.sportGameState?.sportId === 'basketball' &&
    trip.periodId === state.sportGameState.projection.currentPeriodId)
}
