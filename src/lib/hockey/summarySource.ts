import type { GameState } from '../../types'
import { rebuildGameEventProjection } from '../gameEvents/projection'
import { gameEventProjectors, gameEventRegistry } from '../gameEvents/runtime'
import type { GameEvent, GameEventInspection } from '../gameEvents/types'
import { loadHockeyCloudShell } from './cloudSync'
import { loadHockeyCanonicalPublication, type HockeyCanonicalPublication } from './finalization'
import { deriveHockeyGameLines, hockeyGameLinesInput, type HockeyGameLines } from './gameLines'
import {
  loadHockeyGameRecorders,
  loadHockeyRecorderProjection,
  type HockeyRecorderProjection,
  type HockeyRecorderSummary,
} from './recorders'
import { createHockeySportGameState } from './state'
import type { HockeySportGameState } from './types'

/**
 * Where a Hockey Summary reads from (HKY-6A1): exactly one of this device's game, the active
 * canonical publication of a final cloud game, or the primary recorder's stream of a cloud
 * game that is not final. Each is re-inspected and replayed; the stored projection is never
 * trusted, and a remote source never touches `GameContext` or local storage.
 */
export type HockeySummaryAuthority = 'local' | 'cloud_primary' | 'canonical'

export interface HockeySummarySource {
  kind: HockeySummaryAuthority
  /** The rebuilt state: names and setup, and the projection when healthy. */
  state: GameState
  /** The setup and rebuilt projection; null only when the setup itself is unreadable. */
  sport: HockeySportGameState | null
  inspection: GameEventInspection<GameEvent>
  /** True when every event inspected and replayed; only then are totals shown. */
  healthy: boolean
  /** The first problem when not healthy. */
  diagnostic: string | null
  /** Per-game lines from the same replay; null when not healthy. */
  lines: HockeyGameLines | null
  recorderName: string | null
  publication: HockeyCanonicalPublication | null
}

export class HockeySummarySourceError extends Error {
  constructor(readonly authority: HockeySummaryAuthority, message: string) {
    super(message)
    this.name = 'HockeySummarySourceError'
  }
}

export interface HockeySummarySourceDependencies {
  loadCloudState: (gameId: string) => Promise<GameState>
  loadRecorders: (gameId: string) => Promise<HockeyRecorderSummary[]>
  loadRecorder: (gameId: string, recorder: HockeyRecorderSummary) => Promise<HockeyRecorderProjection>
  loadCanonical: (gameId: string) => Promise<HockeyCanonicalPublication | null>
}

const defaultDependencies: HockeySummarySourceDependencies = {
  loadCloudState: async gameId => (await loadHockeyCloudShell(gameId)).state,
  loadRecorders: loadHockeyGameRecorders,
  loadRecorder: loadHockeyRecorderProjection,
  loadCanonical: loadHockeyCanonicalPublication,
}

export function isHockeyEventState(state: Pick<GameState, 'gameDataAuthority' | 'sport' | 'sportGameState'>): boolean {
  return state.gameDataAuthority === 'sport_events' && state.sport?.id === 'hockey' && state.sportGameState?.sportId === 'hockey'
}

/**
 * A `gameId` reads the cloud game. Otherwise the active local game is the source, unless it
 * is bound to a final cloud game, whose published result is the authority.
 */
export async function loadHockeySummarySource(
  localState: GameState,
  gameId: string | null,
  dependencies: HockeySummarySourceDependencies = defaultDependencies
): Promise<HockeySummarySource> {
  if (gameId) return loadCloudSource(gameId, dependencies)
  if (!isHockeyEventState(localState) || !localState.eventStream) {
    throw new HockeySummarySourceError('local', 'Start or open a Hockey event game before viewing its summary.')
  }
  if (localState.cloudSync.gameStatus === 'final' && localState.cloudSync.gameId) {
    return loadCloudSource(localState.cloudSync.gameId, dependencies)
  }
  return hockeySummaryFromState('local', localState, null, null)
}

async function loadCloudSource(gameId: string, dependencies: HockeySummarySourceDependencies): Promise<HockeySummarySource> {
  let cloudState: GameState
  try {
    cloudState = await dependencies.loadCloudState(gameId)
  } catch (error) {
    throw sourceError('cloud_primary', error, 'The synced Hockey game could not load.')
  }
  if (!isHockeyEventState(cloudState)) {
    throw new HockeySummarySourceError('cloud_primary', 'This cloud game does not contain event-based Hockey setup.')
  }

  if (cloudState.cloudSync.gameStatus === 'final') {
    try {
      const publication = await dependencies.loadCanonical(gameId)
      if (!publication) {
        throw new Error('This game is final, but no published result is available. Reopen the game or try again later.')
      }
      return projectHockeyCanonicalPublication(cloudState, publication)
    } catch (error) {
      throw sourceError('canonical', error, 'The published Hockey result could not load.')
    }
  }

  try {
    const recorders = await dependencies.loadRecorders(gameId)
    const primary = recorders.find(recorder => recorder.isPrimary)
    if (!primary) throw new Error('This game does not have a primary Hockey recorder yet.')
    const projection = await dependencies.loadRecorder(gameId, primary)
    return hockeySummaryFromState('cloud_primary', projection.state, primary.displayName, null, projection.inspection)
  } catch (error) {
    throw sourceError('cloud_primary', error, 'The primary Hockey recorder could not load.')
  }
}

/** Rebuilds a published result from its snapshot; a published game must have ended or been abandoned. */
export function projectHockeyCanonicalPublication(
  cloudState: GameState,
  publication: HockeyCanonicalPublication
): HockeySummarySource {
  const snapshot = publication.snapshot
  const candidate: GameState = {
    ...cloudState,
    gameDataAuthority: 'sport_events',
    eventStream: structuredClone(snapshot.eventStream),
    sportGameState: createHockeySportGameState(snapshot.sportGameState.setup),
    cloudSync: { ...cloudState.cloudSync, gameId: snapshot.gameId, gameStatus: 'final' },
  }
  const source = hockeySummaryFromState('canonical', candidate, publication.primaryDisplayName, publication)
  const status = source.sport?.projection.status
  if (source.healthy && status !== 'ended' && status !== 'abandoned') {
    return { ...source, healthy: false, lines: null, diagnostic: 'The published Hockey result has not ended.' }
  }
  return source
}

/**
 * Inspects and replays a state. `inspection` is passed when the caller already rebuilt it
 * (a recorder projection); the lines always come from a fresh replay of the active events.
 */
export function hockeySummaryFromState(
  kind: HockeySummaryAuthority,
  state: GameState,
  recorderName: string | null,
  publication: HockeyCanonicalPublication | null,
  inspection?: GameEventInspection<GameEvent>
): HockeySummarySource {
  const stored = state.sportGameState?.sportId === 'hockey' ? (state.sportGameState as HockeySportGameState) : null
  const rebuilt = inspection
    ? { state, inspection }
    : rebuildGameEventProjection(state, gameEventRegistry, gameEventProjectors)
  const rebuiltSport = rebuilt.state.sportGameState?.sportId === 'hockey'
    ? (rebuilt.state.sportGameState as HockeySportGameState)
    : stored
  const base = { kind, state: rebuilt.state, sport: rebuiltSport, inspection: rebuilt.inspection, recorderName, publication }
  if (!rebuiltSport) {
    return { ...base, healthy: false, diagnostic: 'This game has no Hockey setup.', lines: null }
  }
  if (!rebuilt.inspection.complete) {
    return {
      ...base,
      healthy: false,
      diagnostic: rebuilt.inspection.diagnostics[0]?.message ?? 'This game\'s events could not be read.',
      lines: null,
    }
  }
  const lines = deriveHockeyGameLines(hockeyGameLinesInput(rebuiltSport.setup, rebuilt.inspection.activeEvents))
  if (!lines) {
    return { ...base, healthy: false, diagnostic: 'This game\'s events could not be replayed.', lines: null }
  }
  return { ...base, healthy: true, diagnostic: null, lines }
}

function sourceError(authority: HockeySummaryAuthority, error: unknown, fallback: string): HockeySummarySourceError {
  if (error instanceof HockeySummarySourceError) return error
  return new HockeySummarySourceError(authority, error instanceof Error ? error.message : fallback)
}
