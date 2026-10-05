import { loadBasketballGameRecorders } from '../lib/basketball/recorders'
import { useEventRecorderPresence } from './useEventRecorderPresence'

export function useBasketballRecorderPresence(
  gameId: string | null,
  refreshSignal?: string | null
) {
  return useEventRecorderPresence(loadBasketballGameRecorders, gameId, refreshSignal)
}
