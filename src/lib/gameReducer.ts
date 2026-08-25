import type {
  ActionLogEntry,
  CloudSyncState,
  CloudSyncStatus,
  GameAction,
  GameState,
} from '../types'
import { activePlayerIdAfterRosterChange } from './activePlayerIdForRoster'
import { clearEntireShotChart, statIdForShotRecord } from './clearShotChart'
import { mergeCloudSyncState } from './cloudSyncState'
import { getDisplayedHomeScore } from './gameScore'
import {
  addGameEvent,
  addGameEvents,
  deleteGameEvent,
  initializeGameEventStream,
  restoreGameEvent,
  updateGameEvent,
} from './gameEvents/mutations'
import { gameEventProjectors, gameEventRegistry } from './gameEvents/runtime'
import { normalizeGameEventStream } from './gameEvents/stream'
import { rebuildGameEventProjection } from './gameEvents/projection'
import { normalizeGameDataAuthority, SPORT_EVENTS_AUTHORITY } from './gameEvents/authority'
import { normalizeSportGameState } from './sportGameState/state'
import { playerIdMapForRoster, shotChartForRoster } from './rosterAlignment'
import { normalizeBasketballEventCloudPolicyState } from './basketball/eventCloudPolicy'

export function createInitialCloudSyncState(status: CloudSyncStatus = 'idle'): CloudSyncState {
  return {
    seasonId: null,
    teamId: null,
    gameId: null,
    gameStatus: null,
    playerIdMap: {},
    status,
    lastSyncedAt: null,
    lastError: null,
    lastSyncedGameFingerprint: null,
    shotChartHydrationDroppedRows: 0,
    eventSyncBase: {},
    eventConflicts: [],
    pendingEventConflictResolutions: [],
  }
}

export function createInitialState(status: CloudSyncStatus = 'idle'): GameState {
  return {
    gameDataAuthority: null,
    sport: null,
    gameInfo: null,
    players: [],
    activePlayerId: null,
    opponentScore: 0,
    homeTeamScore: null,
    homeScoreAdjustment: 0,
    notes: '',
    actionLog: [],
    cloudSync: createInitialCloudSyncState(status),
    currentPeriod: 1,
    teamStatsConfig: null,
    shotChart: [],
    eventStream: null,
    sportGameState: null,
    basketballCourtOrientation: 'standard',
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/** Revert the last `actionLog` entry (and linked shot when `shotId` is set). Returns null if log empty. */
export function applyUndoLastEntry(state: GameState): GameState | null {
  if (state.actionLog.length === 0) return null
  const lastAction = state.actionLog[state.actionLog.length - 1]
  let newState: GameState = { ...state, actionLog: state.actionLog.slice(0, -1) }

  switch (lastAction.type) {
    case 'increment':
    case 'decrement':
      newState = {
        ...newState,
        players: newState.players.map(p =>
          p.id === lastAction.playerId
            ? { ...p, stats: { ...p.stats, [lastAction.statId!]: lastAction.previousValue } }
            : p
        ),
      }
      if (lastAction.type === 'increment' && lastAction.shotId) {
        newState = {
          ...newState,
          shotChart: newState.shotChart.filter(s => s.id !== lastAction.shotId),
        }
      }
      break
    case 'opponent_score_up':
    case 'opponent_score_down':
      newState = { ...newState, opponentScore: lastAction.previousValue }
      break
    case 'home_score_up':
    case 'home_score_down':
      newState = { ...newState, homeScoreAdjustment: lastAction.previousValue }
      break
    case 'home_team_score_up':
    case 'home_team_score_down':
      if (lastAction.previousHomeTeamScore == null) {
        newState = {
          ...newState,
          homeTeamScore: null,
          homeScoreAdjustment: lastAction.previousHomeScoreAdjustment ?? 0,
        }
      } else {
        newState = { ...newState, homeTeamScore: lastAction.previousHomeTeamScore }
      }
      break
    default:
      return newState
  }
  return newState
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  const resetStatus: CloudSyncStatus = state.cloudSync.status === 'offline' ? 'offline' : 'idle'
  if (
    (state.eventStream || state.gameDataAuthority === SPORT_EVENTS_AUTHORITY) &&
    isLegacyAggregateMutation(action.type)
  ) return state

  switch (action.type) {
    case 'SET_SPORT':
      return { ...createInitialState(resetStatus), sport: action.sport }

    case 'SET_GAME_INFO':
      return {
        ...state,
        gameInfo: action.gameInfo,
        cloudSync:
          state.gameInfo && state.gameInfo.teamName !== action.gameInfo.teamName
            ? {
                ...state.cloudSync,
                teamId: null,
                gameId: null,
                gameStatus: null,
                playerIdMap: {},
                lastSyncedAt: null,
                lastSyncedGameFingerprint: null,
                shotChartHydrationDroppedRows: 0,
              }
            : state.cloudSync,
      }

    case 'ADD_PLAYER':
      return { ...state, players: [...state.players, action.player] }

    case 'SET_PLAYERS': {
      const players = action.players
      const prevPlayers = state.players
      const nextIds = new Set(players.map(p => p.id))
      // Strip chart rows only when someone left the roster. Prepending team placeholders
      // (GameTracker / GameCheckout) adds ids without removing any — filtering there would
      // wipe every shot because markers still use real player ids.
      const removedAnyPlayer = prevPlayers.some(p => !nextIds.has(p.id))
      const shotChart =
        removedAnyPlayer || prevPlayers.length === 0 || players.length === 0
          ? shotChartForRoster(state.shotChart, players)
          : state.shotChart
      return {
        ...state,
        players,
        activePlayerId: activePlayerIdAfterRosterChange(state.activePlayerId, players),
        shotChart,
        cloudSync: {
          ...state.cloudSync,
          playerIdMap: playerIdMapForRoster(state.cloudSync.playerIdMap, players),
        },
      }
    }

    case 'HYDRATE_STATE': {
      const s = action.state
      const cs = s.cloudSync
      const normalizedState = normalizeBasketballEventCloudPolicyState({
        ...s,
        gameDataAuthority: normalizeGameDataAuthority(s.gameDataAuthority),
        eventStream: normalizeGameEventStream(s.eventStream),
        sportGameState: normalizeSportGameState(s.sportGameState),
        basketballCourtOrientation:
          s.basketballCourtOrientation === 'flipped' ? 'flipped' : 'standard',
        shotChart: shotChartForRoster(s.shotChart, s.players),
        cloudSync: {
          ...cs,
          playerIdMap: playerIdMapForRoster(cs.playerIdMap, s.players),
          shotChartHydrationDroppedRows:
            typeof cs.shotChartHydrationDroppedRows === 'number'
              ? Math.max(0, Math.floor(cs.shotChartHydrationDroppedRows))
              : 0,
          eventSyncBase:
            cs.eventSyncBase && typeof cs.eventSyncBase === 'object'
              ? cs.eventSyncBase
              : {},
          eventConflicts: Array.isArray(cs.eventConflicts) ? cs.eventConflicts : [],
          pendingEventConflictResolutions: Array.isArray(cs.pendingEventConflictResolutions)
            ? cs.pendingEventConflictResolutions
            : [],
        },
      })
      return rebuildGameEventProjection(
        normalizedState,
        gameEventRegistry,
        gameEventProjectors
      ).state
    }

    case 'REMOVE_PLAYER': {
      // Keep local->remote player mapping aligned with the current roster.
      // Removed players are not automatically deleted in Supabase to preserve history.
      const players = state.players.filter(p => p.id !== action.playerId)
      return {
        ...state,
        players,
        activePlayerId: state.activePlayerId === action.playerId ? null : state.activePlayerId,
        shotChart: shotChartForRoster(state.shotChart, players),
        cloudSync: {
          ...state.cloudSync,
          playerIdMap: playerIdMapForRoster(state.cloudSync.playerIdMap, players),
        },
      }
    }

    case 'SET_ACTIVE_PLAYER':
      return { ...state, activePlayerId: action.playerId }

    case 'ADD_SHOT': {
      const shot = action.shot
      const player = state.players.find(p => p.id === shot.playerId)
      if (!player) return state
      const statId = statIdForShotRecord(shot)
      const prevValue = player.stats[statId] || 0
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'increment',
        playerId: shot.playerId,
        statId,
        previousValue: prevValue,
        shotId: shot.id,
      }
      return {
        ...state,
        shotChart: [...state.shotChart, shot],
        players: state.players.map(p =>
          p.id === shot.playerId
            ? { ...p, stats: { ...p.stats, [statId]: prevValue + 1 } }
            : p
        ),
        actionLog: [...state.actionLog, logEntry],
      }
    }

    case 'REMOVE_LAST_SHOT': {
      if (state.shotChart.length === 0) return state
      const popped = state.shotChart[state.shotChart.length - 1]
      const last = state.actionLog[state.actionLog.length - 1]
      const logMatchesShot =
        last?.type === 'increment' &&
        last.shotId === popped.id &&
        last.playerId === popped.playerId &&
        last.statId === statIdForShotRecord(popped)
      if (logMatchesShot) {
        return applyUndoLastEntry(state) ?? state
      }
      return { ...state, shotChart: state.shotChart.slice(0, -1) }
    }

    case 'UNDO_LAST_SHOT': {
      const last = state.actionLog[state.actionLog.length - 1]
      if (!last?.shotId) return state
      return applyUndoLastEntry(state) ?? state
    }

    case 'CLEAR_SHOT_CHART': {
      return clearEntireShotChart(state)
    }

    case 'INCREMENT_STAT': {
      const player = state.players.find(p => p.id === action.playerId)
      if (!player) return state
      const prevValue = player.stats[action.statId] || 0
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'increment',
        playerId: action.playerId,
        statId: action.statId,
        previousValue: prevValue,
        linkedShotId: action.linkedShotId,
      }
      return {
        ...state,
        players: state.players.map(p =>
          p.id === action.playerId
            ? { ...p, stats: { ...p.stats, [action.statId]: prevValue + 1 } }
            : p
        ),
        actionLog: [...state.actionLog, logEntry],
      }
    }

    case 'DECREMENT_STAT': {
      const player = state.players.find(p => p.id === action.playerId)
      if (!player) return state
      const prevValue = player.stats[action.statId] || 0
      if (prevValue <= 0) return state
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'decrement',
        playerId: action.playerId,
        statId: action.statId,
        previousValue: prevValue,
      }
      return {
        ...state,
        players: state.players.map(p =>
          p.id === action.playerId
            ? { ...p, stats: { ...p.stats, [action.statId]: prevValue - 1 } }
            : p
        ),
        actionLog: [...state.actionLog, logEntry],
      }
    }

    case 'INCREMENT_OPPONENT_SCORE': {
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'opponent_score_up',
        previousValue: state.opponentScore,
      }
      return {
        ...state,
        opponentScore: state.opponentScore + 1,
        actionLog: [...state.actionLog, logEntry],
      }
    }

    case 'DECREMENT_OPPONENT_SCORE': {
      if (state.opponentScore <= 0) return state
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'opponent_score_down',
        previousValue: state.opponentScore,
      }
      return {
        ...state,
        opponentScore: state.opponentScore - 1,
        actionLog: [...state.actionLog, logEntry],
      }
    }

    case 'INCREMENT_HOME_SCORE': {
      if (state.homeTeamScore != null) {
        const prev = state.homeTeamScore
        const logEntry: ActionLogEntry = {
          id: generateId(),
          timestamp: Date.now(),
          type: 'home_team_score_up',
          previousValue: prev,
          previousHomeTeamScore: prev,
        }
        return {
          ...state,
          homeTeamScore: prev + 1,
          actionLog: [...state.actionLog, logEntry],
        }
      }
      const sport = state.sport
      if (!sport) return state
      const baseline = getDisplayedHomeScore(sport, state.players, null, state.homeScoreAdjustment)
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'home_team_score_up',
        previousValue: baseline,
        previousHomeTeamScore: null,
        previousHomeScoreAdjustment: state.homeScoreAdjustment,
      }
      return {
        ...state,
        homeTeamScore: baseline + 1,
        homeScoreAdjustment: 0,
        actionLog: [...state.actionLog, logEntry],
      }
    }

    case 'SET_NOTES':
      return { ...state, notes: action.notes }

    case 'DECREMENT_HOME_SCORE': {
      if (state.homeTeamScore != null) {
        if (state.homeTeamScore <= 0) return state
        const prev = state.homeTeamScore
        const logEntry: ActionLogEntry = {
          id: generateId(),
          timestamp: Date.now(),
          type: 'home_team_score_down',
          previousValue: prev,
          previousHomeTeamScore: prev,
        }
        return {
          ...state,
          homeTeamScore: prev - 1,
          actionLog: [...state.actionLog, logEntry],
        }
      }
      const sport = state.sport
      if (!sport) return state
      const baseline = getDisplayedHomeScore(sport, state.players, null, state.homeScoreAdjustment)
      if (baseline <= 0) return state
      const logEntry: ActionLogEntry = {
        id: generateId(),
        timestamp: Date.now(),
        type: 'home_team_score_down',
        previousValue: baseline,
        previousHomeTeamScore: null,
        previousHomeScoreAdjustment: state.homeScoreAdjustment,
      }
      return {
        ...state,
        homeTeamScore: Math.max(0, baseline - 1),
        homeScoreAdjustment: 0,
        actionLog: [...state.actionLog, logEntry],
      }
    }

    case 'UNDO':
      return applyUndoLastEntry(state) ?? state

    case 'RESET_GAME':
      return createInitialState(resetStatus)

    case 'SET_CLOUD_SYNC_STATE':
      return {
        ...state,
        cloudSync: mergeCloudSyncState(state.cloudSync, action.cloudSync),
      }

    case 'SET_PERIOD': {
      const next =
        Number.isFinite(action.period) && action.period >= 1 ? Math.floor(action.period) : 1
      return { ...state, currentPeriod: next }
    }

    case 'SET_TEAM_STATS_CONFIG':
      return { ...state, teamStatsConfig: action.config }

    case 'SET_SPORT_GAME_STATE':
      if (state.eventStream && state.eventStream.events.length > 0) return state
      return {
        ...state,
        sportGameState: action.sportGameState,
      }

    case 'SET_SOCCER_CAPTURE_PREFERENCES':
      if (state.sportGameState?.sportId !== 'soccer') return state
      return {
        ...state,
        sportGameState: {
          ...state.sportGameState,
          capturePreferences: {
            ...state.sportGameState.capturePreferences,
            ...action.preferences,
          },
        },
      }

    case 'SET_BASKETBALL_CAPTURE_PREFERENCES':
      if (state.sportGameState?.sportId !== 'basketball') return state
      return {
        ...state,
        sportGameState: {
          ...state.sportGameState,
          capturePreferences: {
            ...state.sportGameState.capturePreferences,
            ...action.preferences,
          },
        },
      }

    case 'INITIALIZE_EVENT_STREAM':
      return initializeGameEventStream(state, gameEventRegistry, gameEventProjectors).state

    case 'ADD_GAME_EVENT': {
      const next = addGameEvent(
        state,
        action.event,
        gameEventRegistry,
        gameEventProjectors
      ).state
      return clearBasketballCourtUndoAfterEventMutation(state, next)
    }

    case 'ADD_GAME_EVENTS': {
      const next = addGameEvents(
        state,
        action.events,
        gameEventRegistry,
        gameEventProjectors
      ).state
      return clearBasketballCourtUndoAfterEventMutation(state, next)
    }

    case 'UPDATE_GAME_EVENT': {
      const next = updateGameEvent(
        state,
        action.eventId,
        action.changes,
        action.now ?? new Date().toISOString(),
        gameEventRegistry,
        gameEventProjectors
      ).state
      return clearBasketballCourtUndoAfterEventMutation(state, next)
    }

    case 'DELETE_GAME_EVENT': {
      const next = deleteGameEvent(
        state,
        action.eventId,
        action.now ?? new Date().toISOString(),
        gameEventRegistry,
        gameEventProjectors
      ).state
      return clearBasketballCourtUndoAfterEventMutation(state, next)
    }

    case 'RESTORE_GAME_EVENT': {
      const next = restoreGameEvent(
        state,
        action.eventId,
        action.now ?? new Date().toISOString(),
        gameEventRegistry,
        gameEventProjectors
      ).state
      return clearBasketballCourtUndoAfterEventMutation(state, next)
    }

    default:
      return state
  }
}

function clearBasketballCourtUndoAfterEventMutation(
  previous: GameState,
  next: GameState
): GameState {
  if (
    next === previous ||
    next.sportGameState?.sportId !== 'basketball' ||
    next.sportGameState.capturePreferences.lastCourtUndo === null
  ) return next
  return {
    ...next,
    sportGameState: {
      ...next.sportGameState,
      capturePreferences: {
        ...next.sportGameState.capturePreferences,
        lastCourtUndo: null,
      },
    },
  }
}

function isLegacyAggregateMutation(type: GameAction['type']): boolean {
  return [
    'ADD_SHOT',
    'REMOVE_LAST_SHOT',
    'UNDO_LAST_SHOT',
    'CLEAR_SHOT_CHART',
    'INCREMENT_STAT',
    'DECREMENT_STAT',
    'INCREMENT_OPPONENT_SCORE',
    'DECREMENT_OPPONENT_SCORE',
    'INCREMENT_HOME_SCORE',
    'DECREMENT_HOME_SCORE',
    'UNDO',
    'SET_PERIOD',
  ].includes(type)
}
