import type { FlushCloudSyncResult } from '../../context/GameContext'
import type { EventFinalizationSideLabels } from '../../lib/gameEvents/finalizationLabels'
import {
  finalizeBaseballGame,
  loadBaseballCanonicalPublication,
  loadBaseballCanonicalPublicationHistory,
  loadBaseballFinalizationReadiness,
  loadBaseballPrimaryFinalizationConflicts,
  prepareBaseballFinalization,
  reopenBaseballCloudGame,
  resolveBaseballPrimaryFinalizationConflict,
  type BaseballCanonicalPublication,
  type BaseballCanonicalPublicationHistoryEntry,
  type BaseballFinalizationPreview,
  type BaseballFinalizationResult,
  type BaseballReopenResult,
} from '../../lib/baseball/finalization'
import EventFinalizationPanel, { type EventFinalizationAdapter } from '../game-events/EventFinalizationPanel'

const BASEBALL_FINALIZATION_ADAPTER: EventFinalizationAdapter<
  BaseballCanonicalPublication,
  BaseballCanonicalPublicationHistoryEntry,
  BaseballFinalizationPreview,
  BaseballFinalizationResult,
  BaseballReopenResult
> = {
  sportId: 'baseball',
  label: 'Baseball',
  loadReadiness: loadBaseballFinalizationReadiness,
  loadPublication: loadBaseballCanonicalPublication,
  loadPublicationHistory: loadBaseballCanonicalPublicationHistory,
  prepare: gameId => prepareBaseballFinalization(gameId),
  finalize: preview => finalizeBaseballGame(preview),
  loadConflicts: loadBaseballPrimaryFinalizationConflicts,
  resolveConflict: resolveBaseballPrimaryFinalizationConflict,
  reopen: ({ gameId, reason }) => reopenBaseballCloudGame(gameId, reason),
  previewNote: preview => (
    <>
      {preview.decisionsMissing && (
        <p className="mt-3 text-xs text-warning-content">
          No pitcher decisions are set for this game. Only the primary recorder&apos;s device can set them,
          after the game ends. You can still finalize without them.
        </p>
      )}
      <p className="mt-3 text-xs text-content-muted">
        {preview.endReason === 'forfeit' ? 'A forfeit publishes the runs as recorded; its winner stays with the ending. ' : ''}
        The server counts the runs again from the recorded plays and publishes its own score.
      </p>
    </>
  ),
}

interface BaseballFinalizationPanelProps {
  gameId: string
  gameStatus: string
  /** Team names of the inspected cloud game; Baseball reopen needs no local authority state. */
  sideLabels: EventFinalizationSideLabels
  currentUserId: string | null
  canManage: boolean
  trackedScore: number | null
  opponentScore: number | null
  ownedLocalTerminal: boolean
  flushCloudSync?: () => Promise<FlushCloudSyncResult>
  onFinalized: (result: BaseballFinalizationResult) => void
  onReopened: (
    result: BaseballReopenResult,
    publication: BaseballCanonicalPublication | null
  ) => void | Promise<void>
}

/** Finalize with the server's score, publication history and reopen with a reason (BSB-6B2). */
export default function BaseballFinalizationPanel(props: BaseballFinalizationPanelProps) {
  return <EventFinalizationPanel adapter={BASEBALL_FINALIZATION_ADAPTER} {...props} />
}
