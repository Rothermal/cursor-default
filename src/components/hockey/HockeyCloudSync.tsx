import { hockeyCloudEnableAvailability } from '../../lib/hockey/enableCloudSync'
import type { GameState } from '../../types'
import { EventCloudMenuSection, EventCloudSyncAlerts } from '../game-events/EventCloudSync'

/** Footer controls: sync status and Enable cloud sync for a device game (HKY-5B). */
export function HockeyCloudMenuSection({ state, onDone }: { state: GameState; onDone: () => void }) {
  return <EventCloudMenuSection state={state} onDone={onDone} availability={hockeyCloudEnableAvailability} />
}

/** Sync problems shown on the tracker: conflicts to review, or an error with Retry and Export. */
export function HockeyCloudSyncAlerts({ state }: { state: GameState }) {
  return <EventCloudSyncAlerts state={state} sportId="hockey" />
}
