import type { FlushCloudSyncResult } from '../../context/GameContext'
import type { GameState } from '../../types'
import {
  finalizeHockeyGame,
  loadHockeyCanonicalPublication,
  loadHockeyCanonicalPublicationHistory,
  loadHockeyFinalizationReadiness,
  loadHockeyPrimaryFinalizationConflicts,
  prepareHockeyFinalization,
  reopenHockeyCloudGame,
  resolveHockeyPrimaryFinalizationConflict,
  type HockeyCanonicalPublication,
  type HockeyCanonicalPublicationHistoryEntry,
  type HockeyFinalizationPreview,
  type HockeyFinalizationResult,
  type HockeyReopenResult,
} from '../../lib/hockey/finalization'
import EventFinalizationPanel, { type EventFinalizationAdapter } from '../game-events/EventFinalizationPanel'

const HOCKEY_FINALIZATION_ADAPTER: EventFinalizationAdapter<
  HockeyCanonicalPublication,
  HockeyCanonicalPublicationHistoryEntry,
  HockeyFinalizationPreview,
  HockeyFinalizationResult,
  HockeyReopenResult
> = {
  sportId: 'hockey',
  label: 'Hockey',
  loadReadiness: loadHockeyFinalizationReadiness,
  loadPublication: loadHockeyCanonicalPublication,
  loadPublicationHistory: loadHockeyCanonicalPublicationHistory,
  prepare: gameId => prepareHockeyFinalization(gameId),
  finalize: preview => finalizeHockeyGame(preview),
  loadConflicts: loadHockeyPrimaryFinalizationConflicts,
  resolveConflict: resolveHockeyPrimaryFinalizationConflict,
  reopen: ({ gameId, reason }) => reopenHockeyCloudGame(gameId, reason),
  previewNote: preview => {
    const winner = preview.projection.state.sportGameState?.sportId === 'hockey'
      ? preview.projection.state.sportGameState.projection.shootout?.winner ?? null
      : null
    return (
      <p className="mt-3 text-xs text-content-muted">
        {winner
          ? 'Includes one goal for the shootout winner. '
          : ''}
        The server counts the score again from the recorded goals and publishes its own.
      </p>
    )
  },
}

interface HockeyFinalizationPanelProps {
  gameId: string
  gameStatus: string
  baseState: GameState
  currentUserId: string | null
  canManage: boolean
  trackedScore: number | null
  opponentScore: number | null
  ownedLocalTerminal: boolean
  flushCloudSync?: () => Promise<FlushCloudSyncResult>
  onFinalized: (result: HockeyFinalizationResult) => void
  onReopened: (
    result: HockeyReopenResult,
    publication: HockeyCanonicalPublication | null
  ) => void | Promise<void>
}

/** Finalize with the server's score, publication history and reopen with a reason (HKY-5B2). */
export default function HockeyFinalizationPanel(props: HockeyFinalizationPanelProps) {
  return <EventFinalizationPanel adapter={HOCKEY_FINALIZATION_ADAPTER} {...props} />
}
