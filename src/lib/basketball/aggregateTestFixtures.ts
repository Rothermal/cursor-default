import type { GameEventActor, GameEventPeriod } from '../gameEvents/types'
import { createBasketballAdministrativeEvent } from './administrativeEvents'
import { createBasketballLifecycleEvent } from './events'
import {
  type BasketballCanonicalAggregateSource,
  type BasketballAggregateSourceGame,
} from './aggregateProjection'
import type { BasketballCanonicalSnapshot } from './finalization'
import {
  createBasketballMatchRules,
  DEFAULT_BASKETBALL_RULES_SOURCE,
} from './rules'
import { createBasketballStatEvent } from './statEvents'
import { emptyBasketballStatTotals } from './state'
import type {
  BasketballMatchEvent,
  BasketballMatchParticipant,
  BasketballMatchSetup,
} from './types'
import type { BasketballLegacyAggregateSource } from './aggregateComposition'

const RECORDER_ID = 'aggregate-recorder'
const BASE_AT = Date.parse('2026-08-20T12:00:00.000Z')
const PERIOD: GameEventPeriod = { id: 'regulation-1', order: 1 }

export const AGGREGATE_PARTICIPANTS = {
  starter: 'b4e10000-0000-4000-8000-000000000101',
  bench: 'b4e10000-0000-4000-8000-000000000102',
  removedBench: 'b4e10000-0000-4000-8000-000000000103',
  dnp: 'b4e10000-0000-4000-8000-000000000104',
  opponent: 'b4e10000-0000-4000-8000-000000000105',
  late: 'b4e10000-0000-4000-8000-000000000106',
} as const

export const AGGREGATE_PLAYERS = {
  starter: 'cloud-player-starter',
  bench: 'cloud-player-bench',
  removedBench: 'cloud-player-removed',
  dnp: 'cloud-player-dnp',
  late: 'cloud-player-late',
} as const

export function makeCanonicalAggregateSource({
  gameId = 'canonical-game-1',
  date = '2026-08-20',
  cloudScope = 'team',
  teamId = cloudScope === 'team' ? 'team-1' : null,
  active = true,
  includeStableMappings = true,
  endReason = 'completed',
}: {
  gameId?: string
  date?: string
  cloudScope?: 'team' | 'personal'
  teamId?: string | null
  active?: boolean
  includeStableMappings?: boolean
  endReason?: 'completed' | 'abandoned'
} = {}): BasketballCanonicalAggregateSource {
  const setup = aggregateSetup(teamId)
  const events = aggregateEvents(endReason)
  const snapshot: BasketballCanonicalSnapshot = {
    version: 2,
    canonicalSchemaVersion: 1,
    sportId: 'basketball',
    gameId,
    primaryRecorderId: RECORDER_ID,
    eventStream: { version: 1, events },
    sportGameState: { sportId: 'basketball', version: 1, setup },
  }
  return {
    authority: 'canonical',
    publicationId: `publication-${gameId}`,
    publicationNumber: 1,
    snapshotFingerprint: `fingerprint-${gameId}`,
    finalizedAt: '2026-08-20T13:00:00.000Z',
    active,
    game: aggregateGame(gameId, date, cloudScope, teamId),
    canonicalSnapshot: snapshot,
    participantSourceMap: includeStableMappings ? {
      [AGGREGATE_PARTICIPANTS.starter]: AGGREGATE_PLAYERS.starter,
      [AGGREGATE_PARTICIPANTS.bench]: AGGREGATE_PLAYERS.bench,
      [AGGREGATE_PARTICIPANTS.removedBench]: AGGREGATE_PLAYERS.removedBench,
      [AGGREGATE_PARTICIPANTS.dnp]: AGGREGATE_PLAYERS.dnp,
      [AGGREGATE_PARTICIPANTS.late]: AGGREGATE_PLAYERS.late,
    } : {},
    canManage: true,
  }
}

export function makeLegacyAggregateSource({
  gameId = 'legacy-game-1',
  date = '2026-08-10',
  cloudScope = 'team',
  teamId = cloudScope === 'team' ? 'team-1' : null,
  playerId = AGGREGATE_PLAYERS.starter,
}: {
  gameId?: string
  date?: string
  cloudScope?: 'team' | 'personal'
  teamId?: string | null
  playerId?: string | null
} = {}): BasketballLegacyAggregateSource {
  const playerStats = {
    ...emptyBasketballStatTotals(),
    ft: 2,
    ft_miss: 1,
    '2pt': 3,
    '2pt_miss': 2,
    '3pt': 1,
    '3pt_miss': 1,
    oreb: 2,
    dreb: 4,
    ast: 5,
    stl: 2,
    blk: 1,
    to: 2,
    pf: 3,
    min: 20,
  }
  return {
    authority: 'legacy',
    sourceId: `legacy-source-${gameId}`,
    sourceFingerprint: `legacy-fingerprint-${gameId}`,
    resolvedAt: '2026-08-10T13:00:00.000Z',
    game: aggregateGame(gameId, date, cloudScope, teamId),
    players: [{
      playerId,
      displayName: 'Starter One',
      number: '1',
      stats: playerStats,
      participationEvidence: true,
    }],
    trackedStats: { ...playerStats, dreb: 5, to: 3 },
    opponentStats: { ...emptyBasketballStatTotals(), '2pt': 5, '3pt': 2 },
    score: { tracked: 11, opponent: 16 },
    periods: [{
      periodId: 'regulation-1', label: 'Q1', order: 1, kind: 'regulation',
      tracked: 11, opponent: 16,
    }],
    canManage: true,
  }
}

function aggregateGame(
  id: string,
  date: string,
  cloudScope: 'team' | 'personal',
  teamId: string | null
): BasketballAggregateSourceGame {
  return {
    id,
    date,
    status: 'final',
    cloudScope,
    teamId,
    seasonId: teamId ? 'season-1' : null,
    tournamentId: teamId ? 'tournament-1' : null,
    trackedTeamName: teamId ? 'Aces' : 'Personal',
    opponentName: 'Bears',
  }
}

function aggregateSetup(teamId: string | null): BasketballMatchSetup {
  return {
    version: 1,
    trackedTeamDesignation: 'home',
    sourceTeamId: teamId,
    sourceSeasonId: teamId ? 'season-1' : null,
    rulesSource: structuredClone(DEFAULT_BASKETBALL_RULES_SOURCE),
    rulesSnapshot: createBasketballMatchRules(),
    participants: [
      participant(AGGREGATE_PARTICIPANTS.starter, 'local-starter', 'Starter One', 'starter'),
      participant(AGGREGATE_PARTICIPANTS.bench, 'local-bench', 'Bench Two', 'bench'),
      participant(
        AGGREGATE_PARTICIPANTS.removedBench,
        'local-removed',
        'Removed Three',
        'bench'
      ),
      participant(AGGREGATE_PARTICIPANTS.dnp, 'local-dnp', 'DNP Four', 'dnp'),
      {
        ...participant(AGGREGATE_PARTICIPANTS.opponent, null, 'Opponent Five', 'starter'),
        teamSide: 'opponent',
      },
    ],
  }
}

function participant(
  id: string,
  playerId: string | null,
  displayName: string,
  initialStatus: 'starter' | 'bench' | 'dnp'
): BasketballMatchParticipant {
  return {
    id,
    playerId,
    displayName,
    number: null,
    teamSide: 'tracked',
    initialStatus,
    position: null,
    captain: false,
  }
}

function aggregateEvents(endReason: 'completed' | 'abandoned'): BasketballMatchEvent[] {
  const events: BasketballMatchEvent[] = []
  const push = (event: BasketballMatchEvent) => events.push(event)
  push(lifecycle(0, 'basketball.period_started', {
    periodId: PERIOD.id, captureCommandId: null,
  }))
  const madeTwo = shot(1, true, 2, playerActor('shooter', 'starter'))
  push(madeTwo)
  push(shot(2, false, 2, playerActor('shooter', 'starter')))
  push(stat(3, 'basketball.assist', {
    relatedEventId: madeTwo.id, captureCommandId: null,
  }, [playerActor('assister', 'bench')]))
  const removedAssist = stat(4, 'basketball.assist', {
    relatedEventId: madeTwo.id, captureCommandId: null,
  }, [playerActor('assister', 'removedBench')])
  push({ ...removedAssist, revision: 2, deletedAt: at(5), updatedAt: at(5) })
  const missedShot = events[2]
  push(stat(5, 'basketball.rebound', {
    kind: 'offensive', relatedEventId: missedShot.id, captureCommandId: null,
  }, [{ role: 'rebounder', kind: 'team', label: 'Aces' }]))
  push(stat(6, 'basketball.shot', {
    value: 3,
    made: true,
    attempt: 'field_goal',
    valueSource: 'quick_entry',
    freeThrowTripId: null,
    tripAttemptNumber: null,
    captureCommandId: null,
  }, [{
    role: 'shooter', kind: 'unknown', label: 'Opponent Five',
  }], 'opponent'))
  const lateParticipant = participant(
    AGGREGATE_PARTICIPANTS.late,
    'local-late',
    'Late Six',
    'bench'
  )
  push(lifecycle(7, 'basketball.match_roster_added', {
    participant: lateParticipant, destination: 'bench', captureCommandId: null,
  }))
  push(shot(8, true, 3, playerActor('shooter', 'late')))
  push(administrative(9, 'basketball.minutes_adjustment', {
    deltaMinutes: 12, captureCommandId: null,
  }, [playerActor('player', 'starter')]))
  for (let sequence = 10; sequence < 15; sequence += 1) {
    push(administrative(sequence, 'basketball.foul', {
      class: 'personal',
      context: 'common',
      teamControlSide: null,
      incidentId: null,
      countingOverride: null,
      captureCommandId: null,
    }, [playerActor('committed_by', 'starter')]))
  }
  push(administrative(15, 'basketball.ejection', {
    reason: 'Official ruling',
    source: 'official_ruling',
    relatedFoulEventId: null,
    captureCommandId: null,
  }, [playerActor('subject', 'bench')]))
  push(lifecycle(16, 'basketball.match_ended', {
    reason: endReason, captureCommandId: null,
  }))
  return events
}

function playerActor(
  role: string,
  key: 'starter' | 'bench' | 'removedBench' | 'late'
): GameEventActor {
  const participantId = AGGREGATE_PARTICIPANTS[key]
  return {
    role,
    kind: 'player',
    participantId,
    playerId: `local-${key === 'removedBench' ? 'removed' : key}`,
  }
}

function shot(
  sequence: number,
  made: boolean,
  value: 2 | 3,
  actor: GameEventActor
): BasketballMatchEvent {
  return stat(sequence, 'basketball.shot', {
    value,
    made,
    attempt: 'field_goal',
    valueSource: 'quick_entry',
    freeThrowTripId: null,
    tripAttemptNumber: null,
    captureCommandId: null,
  }, [actor])
}

function stat(
  sequence: number,
  eventType: Parameters<typeof createBasketballStatEvent>[0]['eventType'],
  payload: Parameters<typeof createBasketballStatEvent>[0]['payload'],
  actors: GameEventActor[],
  teamSide: 'tracked' | 'opponent' = 'tracked'
): BasketballMatchEvent {
  return createBasketballStatEvent({
    id: id(sequence), eventType, payload, recorderUserId: RECORDER_ID,
    sequence, period: PERIOD, occurredAt: at(sequence), teamSide, actors, location: null,
  } as Parameters<typeof createBasketballStatEvent>[0]) as BasketballMatchEvent
}

function administrative(
  sequence: number,
  eventType: Parameters<typeof createBasketballAdministrativeEvent>[0]['eventType'],
  payload: Parameters<typeof createBasketballAdministrativeEvent>[0]['payload'],
  actors: GameEventActor[]
): BasketballMatchEvent {
  return createBasketballAdministrativeEvent({
    id: id(sequence), eventType, payload, recorderUserId: RECORDER_ID,
    sequence, period: PERIOD, occurredAt: at(sequence), teamSide: 'tracked', actors,
  } as Parameters<typeof createBasketballAdministrativeEvent>[0]) as BasketballMatchEvent
}

function lifecycle(
  sequence: number,
  eventType: Parameters<typeof createBasketballLifecycleEvent>[0]['eventType'],
  payload: Parameters<typeof createBasketballLifecycleEvent>[0]['payload']
): BasketballMatchEvent {
  return createBasketballLifecycleEvent({
    id: id(sequence), eventType, payload, recorderUserId: RECORDER_ID,
    sequence, period: PERIOD, occurredAt: at(sequence),
  } as Parameters<typeof createBasketballLifecycleEvent>[0]) as BasketballMatchEvent
}

function id(sequence: number): string {
  return `b4e10000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`
}

function at(sequence: number): string {
  return new Date(BASE_AT + sequence * 1_000).toISOString()
}
