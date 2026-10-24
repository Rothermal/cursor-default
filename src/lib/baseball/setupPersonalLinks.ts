import type { GameState } from '../../types'
import { captureAuthIdentity, isCurrentAuthIdentity } from '../authIdentity'
import { createBaseballUuid } from './id'
import { createBaseballPersonalIdentityClient } from './personalIdentity'
import { baseballPersonalLinkIntentKey, createBaseballLinkIntentStore, type BaseballLinkIntentStorage } from './personalLinkIntents'
import { prepareBaseballPersonalLinkIntent } from './personalLinkReview'
import type { BaseballSetupRosterPlayer } from './setupBuilder'
import type { BaseballMatchSetup } from './types'
import type { BaseballFeatureOptions } from './featureClient'

/** Called inside the parking transaction. A partial metadata write restores its own keys. */
export function persistBaseballSetupPlayerLinks(userId: string, localGameId: string, setup: BaseballMatchSetup, roster: readonly BaseballSetupRosterPlayer[], storage: BaseballLinkIntentStorage = localStorage): void {
  if (setup.sourceTeamId || setup.sourceSeasonId) return
  const store = createBaseballLinkIntentStore(storage)
  const links = setup.participants.flatMap(participant => {
    const target = roster.find(player => player.playerId === participant.playerId)?.personalPlayerId
    return target ? [{ participantId: participant.id, targetPlayerId: target }] : []
  })
  if (new Set(links.map(link => link.targetPlayerId)).size !== links.length) throw Error('A My Player can only appear once in this game.')
  const saved = links.map(link => ({ key: baseballPersonalLinkIntentKey(userId, localGameId, link.participantId), value: storage.getItem(baseballPersonalLinkIntentKey(userId, localGameId, link.participantId)) }))
  try {
    for (const link of links) store.save({ version: 2, origin: 'setup', userId, localGameId, ...link, operationId: createBaseballUuid(), revision: 1, reviewed: null }, null)
  } catch (error) {
    for (const item of saved) {
      if (item.value === null) storage.removeItem(item.key)
      else storage.setItem(item.key, item.value)
    }
    throw error
  }
}

/** Only explicit setup choices are drained. Final games always need the reasoned review UI. */
export async function syncBaseballSetupPlayerLinks(input: {
  state: GameState; userId: string; localGameId: string; assertCurrent: () => void
}, storage: BaseballLinkIntentStorage | null = typeof localStorage === 'undefined' ? null : localStorage, options: BaseballFeatureOptions = {}): Promise<void> {
  const setup = input.state.sportGameState?.sportId === 'baseball' ? input.state.sportGameState.setup : null
  if (!storage || !setup || setup.sourceTeamId || setup.sourceSeasonId || !input.state.cloudSync.gameId) return
  const identity = captureAuthIdentity(input.userId)
  const current = () => { input.assertCurrent(); if (!identity || !isCurrentAuthIdentity(identity)) throw Error('The Baseball player-link account changed.') }
  const store = createBaseballLinkIntentStore(storage)
  const client = createBaseballPersonalIdentityClient(input.userId, options)
  const participantIds = setup.participants.map(player => player.id)
  for (const participantId of participantIds) {
    current()
    let intent = store.read(input.userId, input.localGameId, participantId)
    if (!intent || intent.origin !== 'setup') continue
    if (intent.reviewed && (intent.reviewed.gameId !== input.state.cloudSync.gameId || intent.reviewed.expectedPublicationId
      || intent.reviewed.participantIds.length !== participantIds.length || intent.reviewed.participantIds.some(id => !participantIds.includes(id)))) {
      throw Error('Review the pending player link for this game.')
    }
    const review = await client.review(input.state.cloudSync.gameId, participantIds)
    current()
    if (!store.matches(intent)) throw Error('The pending player selection changed. Review player links.')
    if (review.participantSourceMap[participantId] === intent.targetPlayerId) { store.acknowledge(intent); continue }
    if (review.activePublicationId) throw Error('Review player links to update this published result.')
    if (!intent.reviewed) {
      intent = prepareBaseballPersonalLinkIntent({ ...intent, participantIds, review, reason: '' }, store)
    }
    const result = await client.link(intent, store)
    current()
    if (!result.acknowledged) throw Error('The pending player link is not confirmed. Review player links.')
  }
}
