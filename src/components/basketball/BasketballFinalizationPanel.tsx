import type { FlushCloudSyncResult } from '../../context/GameContext'
import type { GameState } from '../../types'
import { isBasketballAnchoredCloudAuthority } from '../../lib/basketball/cloudAuthorization'
import {
  basketballCanonicalAuthorityState,
  finalizeBasketballGame,
  loadBasketballCanonicalPublication,
  loadBasketballCanonicalPublicationHistory,
  loadBasketballFinalizationReadiness,
  loadBasketballPrimaryFinalizationConflicts,
  prepareBasketballFinalization,
  reopenBasketballCloudGame,
  resolveBasketballPrimaryFinalizationConflict,
  type BasketballCanonicalPublication,
  type BasketballCanonicalPublicationHistoryEntry,
  type BasketballFinalizationPreview,
  type BasketballFinalizationResult,
  type BasketballReopenResult,
} from '../../lib/basketball/finalization'
import type { BasketballReopenMode } from '../../lib/basketball/types'
import EventFinalizationPanel, { type EventFinalizationAdapter } from '../game-events/EventFinalizationPanel'

function isAnchoredPublication(publication: BasketballCanonicalPublication | null): boolean {
  return publication?.snapshot.sportGameState.setup.version === 2 &&
    publication.snapshot.sportGameState.setup.rulesSnapshot.clockModel === 'anchored'
}

const BASKETBALL_FINALIZATION_ADAPTER: EventFinalizationAdapter<
  BasketballCanonicalPublication,
  BasketballCanonicalPublicationHistoryEntry,
  BasketballFinalizationPreview,
  BasketballFinalizationResult,
  BasketballReopenResult,
  BasketballReopenMode
> = {
  sportId: 'basketball',
  label: 'Basketball',
  loadReadiness: loadBasketballFinalizationReadiness,
  loadPublication: loadBasketballCanonicalPublication,
  loadPublicationHistory: loadBasketballCanonicalPublicationHistory,
  prepare: (gameId, userId) => prepareBasketballFinalization(gameId, userId ? { userId } : undefined),
  finalize: (preview, userId) => finalizeBasketballGame(preview, userId ? { userId } : undefined),
  loadConflicts: loadBasketballPrimaryFinalizationConflicts,
  resolveConflict: resolveBasketballPrimaryFinalizationConflict,
  reopen: ({ gameId, reason, mode, publication, baseState, userId }) => {
    const authorityState = publication
      ? basketballCanonicalAuthorityState(baseState, publication)
      : null
    const anchored = isAnchoredPublication(publication) && authorityState
      ? isBasketballAnchoredCloudAuthority(authorityState)
      : false
    return reopenBasketballCloudGame(
      gameId,
      reason,
      anchored && mode
        ? { mode, authorityState: authorityState!, userId: userId ?? undefined }
        : undefined
    )
  },
  reopenModes: publication => isAnchoredPublication(publication)
    ? [
        { value: 'correct_records', label: 'Correct records' },
        { value: 'resume_game', label: 'Resume game' },
      ]
    : null,
  historyModeLabel: entry => entry.reopenMode
    ? entry.reopenMode === 'correct_records' ? 'Correct records' : 'Resume game'
    : null,
}

interface BasketballFinalizationPanelProps {
  gameId: string
  gameStatus: string
  baseState: GameState
  currentUserId: string | null
  canManage: boolean
  trackedScore: number | null
  opponentScore: number | null
  ownedLocalTerminal: boolean
  flushCloudSync?: () => Promise<FlushCloudSyncResult>
  onFinalized: (result: BasketballFinalizationResult) => void
  onReopened: (result: BasketballReopenResult) => void | Promise<void>
}

export default function BasketballFinalizationPanel({ onReopened, ...props }: BasketballFinalizationPanelProps) {
  return (
    <EventFinalizationPanel
      adapter={BASKETBALL_FINALIZATION_ADAPTER}
      onReopened={result => onReopened(result)}
      {...props}
    />
  )
}
