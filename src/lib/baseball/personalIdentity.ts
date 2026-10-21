import type { GameState } from '../../types'
import { isPlainObject } from '../gameEvents/envelope'
import { eventRevisionCheckpoint, eventStreamFingerprint } from '../gameEvents/cloudTransport'
import { assertExactBaseballParticipants, baseballMapFingerprint, baseballUuid, parseBaseballParticipantMap } from './aggregateIdentity'
import { createBaseballCanonicalSnapshot } from './finalization'
import { BaseballFeatureError, createBaseballFeatureClient, exactKeys, invalid, type BaseballFeatureOptions } from './featureClient'
import { parseBaseballPersonalLinkIntent, type BaseballLinkIntentStore, type BaseballPersonalLinkIntent } from './personalLinkIntents'
import { baseballSummarySource } from './summary'

export interface BaseballPersonalLinkReview {
  gameId: string
  participantSourceMap: Record<string, string | null>
  mapFingerprint: string
  activePublicationId: string | null
}
export interface BaseballPersonalLinkReceipt {
  gameId: string
  operationId: string
  participantId: string
  targetPlayerId: string
  participantSourceMap: Record<string, string | null>
  mapFingerprint: string
  /** Historical transaction evidence, never an executable local reopen handoff. */
  historicalReopen: { gameId: string; publicationId: string; reopenedAt: string } | null
  lifecycleAuthority: 'unverified'
}
export interface BaseballReviewedFinalizeResult {
  publicationId: string
  publicationNumber: number
  primaryRecorderId: string
  finalizedAt: string
}

export function parseBaseballPersonalLinkReview(value: unknown, gameId: string, participantIds: readonly string[]): BaseballPersonalLinkReview {
  if (!isPlainObject(value) || !exactKeys(value, ['contractVersion', 'sportId', 'gameId', 'participantSourceMap', 'mapFingerprint', 'activePublicationId'])
    || value.contractVersion !== 1 || value.sportId !== 'baseball' || value.gameId !== gameId) throw invalid('Invalid Baseball personal link review.')
  const participantSourceMap = parseBaseballParticipantMap(value.participantSourceMap)
  assertExactBaseballParticipants(participantSourceMap, participantIds)
  return { gameId, participantSourceMap, mapFingerprint: baseballMapFingerprint(value.mapFingerprint),
    activePublicationId: value.activePublicationId === null ? null : baseballUuid(value.activePublicationId, 'active publication') }
}

export function createBaseballPersonalIdentityClient(userId: string, options: BaseballFeatureOptions = {}) {
  const feature = createBaseballFeatureClient(userId, options)
  async function read(gameId: string, participantIds: readonly string[]) {
    const id = baseballUuid(gameId, 'game')
    const data = await feature.request('get_baseball_personal_participant_links', { p_game_id: id })
    feature.assertCurrent()
    return parseBaseballPersonalLinkReview(data, id, participantIds)
  }
  return {
    async review(gameId: string, participantIds: readonly string[]): Promise<BaseballPersonalLinkReview> {
      const ids = [...participantIds]
      await feature.require('personal_links')
      feature.assertCurrent()
      const result = await read(gameId, ids)
      feature.assertCurrent()
      return result
    },
    async link(value: BaseballPersonalLinkIntent, store: BaseballLinkIntentStore): Promise<{
      receipt: BaseballPersonalLinkReceipt; currentReview: BaseballPersonalLinkReview; acknowledged: boolean
    }> {
      const intent = parseBaseballPersonalLinkIntent(structuredClone(value))
      if (intent.userId !== userId || !intent.reviewed) throw invalid('A matching reviewed Baseball intent is required.')
      const reviewed = intent.reviewed
      const assertIntent = () => {
        feature.assertCurrent()
        if (!store.matches(intent)) throw new BaseballFeatureError('conflict', 'The selected Baseball link changed. Review again.')
      }
      assertIntent()
      await feature.require('personal_links')
      assertIntent()
      const data = await feature.request('link_baseball_personal_participant', {
        p_game_id: reviewed.gameId, p_client_participant_id: intent.participantId,
        p_target_player_id: intent.targetPlayerId, p_expected_map_fingerprint: reviewed.expectedMapFingerprint,
        p_expected_publication_id: reviewed.expectedPublicationId, p_reason: reviewed.reason, p_operation_id: intent.operationId,
      })
      assertIntent()
      const receipt = parseReceipt(data, intent)
      // Receipts can predate republish and another reopen, even with the same map fingerprint.
      // Only this fresh read can acknowledge this participant's target, not lifecycle authority.
      // Other participants may have been linked since the historical receipt was saved.
      const currentReview = await read(reviewed.gameId, reviewed.participantIds)
      assertIntent()
      const reconciled = currentReview.participantSourceMap[intent.participantId] === intent.targetPlayerId
      const acknowledged = reconciled && store.acknowledge(intent)
      feature.assertCurrent()
      return { receipt, currentReview, acknowledged }
    },
    async finalizeReviewed(input: {
      state: GameState
      review: BaseballPersonalLinkReview
      /** The caller owns its local-game/query/review generation, checked around every await. */
      assertReviewCurrent: () => void
    }): Promise<BaseballReviewedFinalizeResult> {
      const state = structuredClone(input.state)
      const review = structuredClone(input.review)
      const assertCurrent = () => { feature.assertCurrent(); input.assertReviewCurrent() }
      assertCurrent()
      if (state.cloudSync.gameId !== review.gameId || state.sportGameState?.sportId !== 'baseball'
        || state.sportGameState.setup.sourceTeamId !== null || state.sportGameState.setup.sourceSeasonId !== null) throw invalid('Reviewed finalization requires the matching personal Baseball game.')
      assertExactBaseballParticipants(parseBaseballParticipantMap(review.participantSourceMap), state.sportGameState.setup.participants.map(p => p.id))
      baseballMapFingerprint(review.mapFingerprint)
      const snapshot = createBaseballCanonicalSnapshot(review.gameId, userId, state)
      const replay = baseballSummarySource(state)
      if (!replay.healthy || !replay.sport || !['final', 'abandoned'].includes(replay.sport.projection.status)) throw invalid('The Baseball recording has not ended.')
      const parameters = { p_game_id: review.gameId, p_primary_recorded_by: userId,
        p_event_revisions: eventRevisionCheckpoint(state), p_stream_fingerprint: eventStreamFingerprint(state),
        p_canonical_snapshot: snapshot, p_expected_map_fingerprint: review.mapFingerprint }
      await feature.require('personal_links')
      assertCurrent()
      const response = await feature.request('finalize_baseball_event_game_reviewed', parameters)
      assertCurrent()
      if (!isPlainObject(response) || !exactKeys(response, ['publication_id', 'publication_number', 'primary_recorded_by', 'finalized_at'])
        || response.primary_recorded_by !== userId || !Number.isSafeInteger(response.publication_number) || Number(response.publication_number) < 1) throw invalid('Invalid Baseball reviewed finalization response.')
      return { publicationId: baseballUuid(response.publication_id, 'publication'), publicationNumber: Number(response.publication_number),
        primaryRecorderId: userId, finalizedAt: validTime(response.finalized_at) }
    },
  }
}

function parseReceipt(value: unknown, intent: BaseballPersonalLinkIntent): BaseballPersonalLinkReceipt {
  if (!isPlainObject(value) || !exactKeys(value, ['contractVersion', 'gameId', 'operationId', 'participantId', 'targetPlayerId', 'participantSourceMap', 'mapFingerprint', 'reopen'])
    || value.contractVersion !== 1 || value.gameId !== intent.reviewed!.gameId || value.operationId !== intent.operationId
    || value.participantId !== intent.participantId || value.targetPlayerId !== intent.targetPlayerId) throw invalid('The Baseball link receipt does not match this operation.')
  const map = parseBaseballParticipantMap(value.participantSourceMap)
  assertExactBaseballParticipants(map, intent.reviewed!.participantIds)
  if (map[intent.participantId] !== intent.targetPlayerId) throw invalid('The Baseball receipt does not confirm its target.')
  let historicalReopen: BaseballPersonalLinkReceipt['historicalReopen'] = null
  if (value.reopen !== null) {
    const r = value.reopen
    if (!isPlainObject(r) || !exactKeys(r, ['game_id', 'publication_id', 'reopened_at']) || r.game_id !== intent.reviewed!.gameId
      || r.publication_id !== intent.reviewed!.expectedPublicationId) throw invalid('Invalid historical Baseball reopen receipt.')
    historicalReopen = { gameId: r.game_id as string, publicationId: baseballUuid(r.publication_id, 'historical publication'), reopenedAt: validTime(r.reopened_at) }
  }
  return { gameId: intent.reviewed!.gameId, operationId: intent.operationId, participantId: intent.participantId, targetPlayerId: intent.targetPlayerId,
    participantSourceMap: map, mapFingerprint: baseballMapFingerprint(value.mapFingerprint), historicalReopen, lifecycleAuthority: 'unverified' }
}
function validTime(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw invalid('Invalid Baseball response time.')
  return value
}
