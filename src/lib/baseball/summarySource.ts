import type { GameState } from '../../types'
import { isGameEventEnvelope } from '../gameEvents/envelope'
import { stableJson } from '../gameEvents/stream'
import { loadBaseballCloudShell } from './cloudSync'
import { loadBaseballCanonicalPublication, parseBaseballCanonicalSnapshot, type BaseballCanonicalPublication } from './finalization'
import { loadBaseballGameRecorders, loadBaseballRecorderProjection, type BaseballRecorderProjection, type BaseballRecorderSummary } from './recorders'
import { createBaseballSportGameState } from './state'
import { baseballSummarySource, type BaseballSummarySource } from './summary'

export interface BaseballSummarySourceDependencies {
  loadCloudState: (gameId: string) => Promise<GameState>
  loadRecorders: (gameId: string) => Promise<BaseballRecorderSummary[]>
  loadRecorder: (gameId: string, recorder: BaseballRecorderSummary, assertCurrent: () => void) => Promise<BaseballRecorderProjection>
  loadCanonical: (gameId: string) => Promise<BaseballCanonicalPublication | null>
}

const dependencies: BaseballSummarySourceDependencies = {
  loadCloudState: async gameId => (await loadBaseballCloudShell(gameId)).state,
  loadRecorders: loadBaseballGameRecorders,
  loadRecorder: loadBaseballRecorderProjection,
  loadCanonical: loadBaseballCanonicalPublication,
}

function unavailable(state: GameState, kind: BaseballSummarySource['kind'], diagnostic: string): BaseballSummarySource {
  return { ...baseballSummarySource({ ...state, eventStream: null }), kind, healthy: false, diagnostic }
}

/** Reads only. The lifetime guard runs before and after each asynchronous read, never writes. */
export async function loadBaseballSummarySource(
  localState: GameState,
  gameId: string | null,
  deps: BaseballSummarySourceDependencies = dependencies,
  assertCurrent: () => void = () => {},
): Promise<BaseballSummarySource> {
  assertCurrent()
  const cloudId = gameId || (localState.cloudSync.gameStatus === 'final' ? localState.cloudSync.gameId : null)
  if (!cloudId) {
    if (localState.cloudSync.gameStatus === 'final') return unavailable(localState, 'canonical', 'The final cloud game binding is unavailable.')
    return baseballSummarySource(localState)
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const loaded = await loadCloudSource(cloudId, deps, assertCurrent)
    assertCurrent()
    let current = true
    if (loaded.publicationId) {
      const publication = await deps.loadCanonical(cloudId)
      assertCurrent()
      current = publication?.publicationId === loaded.publicationId
    } else if (loaded.primaryId) {
      const recorders = await deps.loadRecorders(cloudId)
      assertCurrent()
      current = recorders.filter(recorder => recorder.isPrimary).length === 1 &&
        recorders.find(recorder => recorder.isPrimary)?.recorderId === loaded.primaryId
    }
    const confirmed = await deps.loadCloudState(cloudId)
    assertCurrent()
    current = current && confirmed.cloudSync.gameId === cloudId && confirmed.gameDataAuthority === 'sport_events' &&
      confirmed.sport?.id === 'baseball' && confirmed.cloudSync.gameStatus === loaded.shell.cloudSync.gameStatus &&
      stableJson(confirmed.sportGameState?.setup) === stableJson(loaded.shell.sportGameState?.setup)
    if (current) return loaded.source
  }
  throw new Error('The cloud Baseball authority changed during review. Try again.')
}

async function loadCloudSource(cloudId: string, deps: BaseballSummarySourceDependencies, assertCurrent: () => void) {
  assertCurrent()
  const shell = await deps.loadCloudState(cloudId)
  assertCurrent()
  if (shell.cloudSync.gameId !== cloudId || shell.sport?.id !== 'baseball' || shell.gameDataAuthority !== 'sport_events') {
    throw new Error('The cloud Baseball game identity is invalid.')
  }
  const kind = shell.cloudSync.gameStatus === 'final' ? 'canonical' : 'cloud_primary'
  const context = unavailable(shell, kind, 'The cloud Baseball source could not load.')
  let publicationId: string | null = null
  let primaryId: string | null = null
  const result = (source: BaseballSummarySource) => ({ shell, source, publicationId, primaryId })
  if (!context.sport) return result({ ...context, diagnostic: 'The cloud Baseball setup is unreadable.' })
  try {
    if (kind === 'canonical') {
      const publication = await deps.loadCanonical(cloudId)
      assertCurrent()
      if (!publication) return result({ ...context, diagnostic: 'This game is final, but no active published result is available.' })
      publicationId = publication.publicationId
      return result(projectBaseballCanonicalPublication(shell, publication))
    }
    const recorders = await deps.loadRecorders(cloudId)
    assertCurrent()
    const primaries = recorders.filter(recorder => recorder.isPrimary)
    if (primaries.length !== 1) return result({ ...context, diagnostic: 'This game does not have one primary Baseball recorder.' })
    const primary = primaries[0]
    primaryId = primary.recorderId
    const loaded = await deps.loadRecorder(cloudId, primary, assertCurrent)
    assertCurrent()
    if (loaded.recorder.recorderId !== primary.recorderId || loaded.state.cloudSync.gameId !== cloudId ||
      stableJson(loaded.state.sportGameState?.setup) !== stableJson(context.sport.setup)) {
      return result({ ...context, diagnostic: 'The primary Baseball recording does not match this game setup.' })
    }
    // Replay exactly the returned stream on the original shell, ignoring all cached totals.
    if (loaded.eventStream.events.some(event => !isGameEventEnvelope(event) || event.sportId !== 'baseball' || event.recorderUserId !== primary.recorderId)) {
      return result({ ...context, diagnostic: 'The primary Baseball recording contains invalid or mixed ownership.' })
    }
    const source = baseballSummarySource({ ...shell, eventStream: loaded.eventStream })
    if (!loaded.inspection.complete) return result({ ...context, diagnostic: loaded.inspection.diagnostics[0]?.message ?? 'The primary recording is quarantined.' })
    return result({ ...source, kind, recorderName: primary.displayName })
  } catch (error) {
    assertCurrent()
    return result({ ...context, diagnostic: error instanceof Error ? error.message : 'The cloud Baseball source could not load.' })
  }
}

export function projectBaseballCanonicalPublication(shell: GameState, publication: BaseballCanonicalPublication): BaseballSummarySource {
  const context = unavailable(shell, 'canonical', 'The published Baseball result is invalid.')
  try {
    const snapshot = parseBaseballCanonicalSnapshot(publication.snapshot)
    if (shell.cloudSync.gameStatus !== 'final' || snapshot.gameId !== shell.cloudSync.gameId ||
      snapshot.primaryRecorderId !== publication.primaryRecorderId || !context.sport ||
      stableJson(snapshot.sportGameState.setup) !== stableJson(context.sport.setup)) {
      return { ...context, diagnostic: 'The published Baseball identity or setup does not match this game.' }
    }
    const source = baseballSummarySource({ ...shell, eventStream: snapshot.eventStream,
      sportGameState: createBaseballSportGameState(snapshot.sportGameState.setup) })
    if (!source.healthy) return { ...source, kind: 'canonical', recorderName: publication.primaryDisplayName }
    if (source.sport?.projection.status !== 'final' && source.sport?.projection.status !== 'abandoned') {
      return { ...context, diagnostic: 'The published Baseball result has not ended.' }
    }
    return { ...source, kind: 'canonical', recorderName: publication.primaryDisplayName }
  } catch (error) {
    return { ...context, diagnostic: error instanceof Error ? error.message : 'The published Baseball result is invalid.' }
  }
}
