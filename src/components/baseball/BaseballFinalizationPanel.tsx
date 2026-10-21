import type { FlushCloudSyncResult } from '../../context/GameContext'
import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { captureAuthIdentity, isCurrentAuthIdentity } from '../../lib/authIdentity'
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
      {preview.personalLinkReview && <p>Player-history links reviewed: {Object.values(preview.personalLinkReview.participantSourceMap).filter(Boolean).length} linked / {Object.values(preview.personalLinkReview.participantSourceMap).filter(value => value === null).length} unlinked. This exact map is pinned when published.</p>}
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
  const [params] = useSearchParams()
  const identity = props.currentUserId ? captureAuthIdentity(props.currentUserId) : null
  const key = JSON.stringify([identity, props.gameId, params.toString()])
  const lifetime = useRef({ key, token: {}, active: true })
  if (lifetime.current.key !== key) { lifetime.current.active = false; lifetime.current = { key, token: {}, active: true } }
  const request = lifetime.current
  useEffect(() => { request.active = true; return () => { request.active = false } }, [request])
  const adapter = useMemo(() => {
    const current = () => {
      if (!request.active || lifetime.current !== request || !identity || !isCurrentAuthIdentity(identity)) throw Error('The Baseball finalization review changed.')
    }
    return { ...BASEBALL_FINALIZATION_ADAPTER,
      prepare: (gameId: string, userId: string | null) => { current(); return prepareBaseballFinalization(gameId, userId, { assertCurrent: current, reviewPersonalLinks: true }) },
      finalize: (preview: BaseballFinalizationPreview, userId: string | null) => { current(); return finalizeBaseballGame(preview, userId, { assertCurrent: current, reviewPersonalLinks: true }) },
    }
    // identity is represented by request's account-epoch key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])
  return <EventFinalizationPanel key={key} adapter={adapter} {...props} />
}
