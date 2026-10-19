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
  prepare: (gameId, userId) => prepareBaseballFinalization(gameId, userId),
  finalize: (preview, userId) => finalizeBaseballGame(preview, userId),
  loadConflicts: loadBaseballPrimaryFinalizationConflicts,
  resolveConflict: resolveBaseballPrimaryFinalizationConflict,
  reopen: ({ gameId, reason, userId }) => reopenBaseballCloudGame(gameId, reason, userId),
  previewNote: preview => (
    <div className="mt-3 space-y-2 text-xs text-content-muted">
      <p>The server counts the runs again from the recorded plays and publishes its own score.</p>
      {preview.pitcherDecisionsMissing && (
        <p role="status">Pitcher decisions have not been recorded for this end. Only the primary recorder can set them on their device; finalizing without them is allowed.</p>
      )}
    </div>
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
