import { captureAuthIdentity, isCurrentAuthIdentity } from '../authIdentity'
import { isPlainObject } from '../gameEvents/envelope'
import { stableJson } from '../gameEvents/stream'
import { baseballMapFingerprint, baseballUuid } from './aggregateIdentity'
import { BaseballFeatureError, exactKeys, invalid, requiredString } from './featureErrors'

export interface BaseballReviewedLinkRequest {
  gameId: string
  expectedMapFingerprint: string
  expectedPublicationId: string | null
  reason: string
  participantIds: string[]
}
/** Device intent only, outside frozen setup/events. No automatic offline identity queue. */
export interface BaseballPersonalLinkIntent {
  version: 1
  userId: string
  localGameId: string
  participantId: string
  targetPlayerId: string
  operationId: string
  revision: number
  reviewed: BaseballReviewedLinkRequest | null
}
export interface BaseballLinkIntentStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
export interface BaseballLinkIntentStore {
  read(userId: string, localGameId: string, participantId: string): BaseballPersonalLinkIntent | null
  save(intent: BaseballPersonalLinkIntent, expectedRevision: number | null): void
  matches(intent: BaseballPersonalLinkIntent): boolean
  acknowledge(intent: BaseballPersonalLinkIntent): boolean
}

export function parseBaseballPersonalLinkIntent(value: unknown): BaseballPersonalLinkIntent {
  if (!isPlainObject(value) || !exactKeys(value, ['version', 'userId', 'localGameId', 'participantId', 'targetPlayerId', 'operationId', 'revision', 'reviewed'])
    || value.version !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1) throw invalid('Invalid Baseball link intent.')
  let reviewed: BaseballReviewedLinkRequest | null = null
  if (value.reviewed !== null) {
    const r = value.reviewed
    if (!isPlainObject(r) || !exactKeys(r, ['gameId', 'expectedMapFingerprint', 'expectedPublicationId', 'reason', 'participantIds'])
      || !Array.isArray(r.participantIds) || !r.participantIds.length) throw invalid('Invalid Baseball reviewed link request.')
    const participantIds = r.participantIds.map(id => requiredString(id, 'participant'))
    if (new Set(participantIds).size !== participantIds.length || !participantIds.includes(String(value.participantId))) throw invalid('Invalid Baseball reviewed participant set.')
    const expectedPublicationId = r.expectedPublicationId === null ? null : baseballUuid(r.expectedPublicationId, 'reviewed publication')
    if (typeof r.reason !== 'string' || (expectedPublicationId && r.reason.trim().length < 3)) throw invalid('A final Baseball link needs a reopen reason.')
    reviewed = { gameId: baseballUuid(r.gameId, 'reviewed game'), expectedMapFingerprint: baseballMapFingerprint(r.expectedMapFingerprint),
      expectedPublicationId, reason: r.reason.trim(), participantIds }
  }
  return { version: 1, userId: baseballUuid(value.userId, 'intent account'), localGameId: requiredString(value.localGameId, 'local game'),
    participantId: requiredString(value.participantId, 'participant'), targetPlayerId: baseballUuid(value.targetPlayerId, 'target player'),
    operationId: baseballUuid(value.operationId, 'operation'), revision: Number(value.revision), reviewed }
}

export function createBaseballLinkIntentStore(storage: BaseballLinkIntentStorage): BaseballLinkIntentStore {
  const key = (user: string, game: string, participant: string) => `statkeeper_baseball_link_intent:${encodeURIComponent(user)}:${encodeURIComponent(game)}:${encodeURIComponent(participant)}`
  const assertAccount = (userId: string) => {
    const identity = captureAuthIdentity(userId)
    if (!identity) throw new BaseballFeatureError('stale_account', 'The Baseball link account changed.')
    return () => { if (!isCurrentAuthIdentity(identity)) throw new BaseballFeatureError('stale_account', 'The Baseball link account changed.') }
  }
  const read = (userId: string, localGameId: string, participantId: string) => {
    const current = assertAccount(userId)
    const raw = storage.getItem(key(userId, localGameId, participantId))
    current()
    if (raw === null) return null
    const intent = parseBaseballPersonalLinkIntent(JSON.parse(raw))
    if (intent.userId !== userId || intent.localGameId !== localGameId || intent.participantId !== participantId) throw invalid('The stored Baseball link identity mismatches its key.')
    return intent
  }
  const matches = (intent: BaseballPersonalLinkIntent) => stableJson(read(intent.userId, intent.localGameId, intent.participantId)) === stableJson(intent)
  return { read, matches,
    save(value, expectedRevision) {
      const intent = parseBaseballPersonalLinkIntent(value)
      const current = assertAccount(intent.userId)
      const previous = read(intent.userId, intent.localGameId, intent.participantId)
      if ((previous?.revision ?? null) !== expectedRevision || intent.revision !== (expectedRevision ?? 0) + 1) throw new BaseballFeatureError('conflict', 'The Baseball link intent changed.')
      if (previous?.operationId === intent.operationId && stableJson({ ...previous, revision: 0 }) !== stableJson({ ...intent, revision: 0 })) {
        throw new BaseballFeatureError('conflict', 'A reviewed link change needs a new operation id.')
      }
      current()
      storage.setItem(key(intent.userId, intent.localGameId, intent.participantId), JSON.stringify(intent))
      current()
    },
    acknowledge(intent) {
      const current = assertAccount(intent.userId)
      if (!matches(intent)) return false
      current()
      storage.removeItem(key(intent.userId, intent.localGameId, intent.participantId))
      current()
      return true
    },
  }
}
