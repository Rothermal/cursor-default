import type { GameEventActor } from '../gameEvents/types'

type BasketballActorIdentity = Pick<GameEventActor, 'kind' | 'label' | 'participantId'>

export function normalizeBasketballActorLabel(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? ''
}

export function sameBasketballActorIdentity(
  left: BasketballActorIdentity | undefined,
  right: BasketballActorIdentity | undefined
): boolean {
  if (!left || !right) return false
  if (left.participantId || right.participantId) {
    return Boolean(left.participantId && left.participantId === right.participantId)
  }
  return left.kind === right.kind &&
    normalizeBasketballActorLabel(left.label) === normalizeBasketballActorLabel(right.label)
}
