import type { GameState } from '../../types'
import { gameSideDisplayName } from '../display'

export interface EventFinalizationSideLabels {
  tracked: string
  opponent: string
}

/**
 * Labels for the finalization review: the loaded primary stream's own game info, which comes from
 * the inspected cloud game, never from whichever game happens to be active on this device. The
 * inspected game's labels are the fallback when the stream carries none.
 */
export function eventFinalizationPreviewSideLabels(
  primaryState: Pick<GameState, 'gameInfo'> | null | undefined,
  inspected: EventFinalizationSideLabels
): EventFinalizationSideLabels {
  const gameInfo = primaryState?.gameInfo ?? null
  return {
    tracked: gameSideDisplayName(gameInfo, 'tracked', inspected.tracked),
    opponent: gameSideDisplayName(gameInfo, 'opponent', inspected.opponent),
  }
}
