import type { BaseballRulesVariant, BaseballTeamSide } from './types'

export interface BaseballAggregateSourceGame {
  id: string
  date: string
  status: string
  cloudScope: 'team' | 'personal'
  teamId: string | null
  seasonId: string | null
  tournamentId: string | null
  trackedTeamName: string
  opponentName: string
}
export interface BaseballCanonicalAggregateSource {
  publicationId: string
  publicationNumber: number
  snapshotFingerprint: string
  finalizedAt: string
  eventCount: number
  payloadBytes: number
  game: BaseballAggregateSourceGame
  canonicalSnapshot: unknown
  participantSourceMap: Record<string, string | null> | null
  participantMapFingerprint: string | null
  identityStatus: 'valid' | 'invalid'
  identityDiagnostic: string | null
  canManage: boolean
}
export type BaseballAggregateLoadScope =
  | { type: 'team' | 'season'; id: string }
  | { type: 'tournament'; id: string; teamId: string }
  | { type: 'player' | 'career'; playerId: string; teamId?: string | null; seasonId?: string | null }
export interface BaseballAggregateExclusion {
  sourceId: string
  gameId: string
  kind: 'malformed_source' | 'invalid_identity' | 'ineligible_source' | 'authority_collision'
  message: string
}
export interface BaseballPitchCoverage {
  includedGames: number
  excludedGames: number
  recordedPitches: number
  recordedStrikes: number
  firstPitchObservations: number
  firstPitchStrikes: number
  unlocatedPitches: number
}
export interface BaseballDecisionCoverage {
  valid: number
  reviewedEmpty: number
  absent: number
  reviewNeeded: number
}
export type BaseballAggregateStats = Record<string, number>
export interface BaseballAggregatePlayer {
  playerId: string
  displayName: string
  number: string | null
  stats: BaseballAggregateStats
  pitchingBases: Record<number, { outs: number; er: number; k: number }>
  pitchCoverage: BaseballPitchCoverage
  pitchesSeenLowerBoundGames: number
  pitchCountLowerBoundGames: number
  decisions: BaseballDecisionCoverage
}
export interface BaseballAggregateTeamTotals { runs: number; hits: number; errors: number; leftOnBase: number }
export interface BaseballAggregateMatch {
  sourceId: string
  sourceFingerprint: string
  game: BaseballAggregateSourceGame
  finalizedAt: string
  variant: BaseballRulesVariant
  basis: number
  players: BaseballAggregatePlayer[]
  unlinked: Array<{ participantId: string; displayName: string; appeared: boolean }>
  teamTotals: Record<BaseballTeamSide, BaseballAggregateTeamTotals>
  outcome: 'win' | 'loss' | 'tie'
  decisions: BaseballDecisionCoverage
}
export interface BaseballAggregateRosterPlayer {
  playerId: string
  displayName: string
  number: string | null
  teamId: string
  seasonId?: string | null
  tournamentId?: string | null
}
export interface BaseballAggregateResult {
  variant: BaseballRulesVariant
  players: BaseballAggregatePlayer[]
  games: BaseballAggregateMatch[]
  teams: Array<{ teamId: string; games: number; wins: number; losses: number; ties: number; totals: Record<BaseballTeamSide, BaseballAggregateTeamTotals> }>
  exclusions: BaseballAggregateExclusion[]
  quality: 'complete' | 'partial'
  unlinkedAppearances: number
  filteredVariantCount: number
}
