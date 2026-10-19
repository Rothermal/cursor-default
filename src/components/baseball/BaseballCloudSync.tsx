import { baseballCloudEnableAvailability } from '../../lib/baseball/enableCloudSync'
import type { GameState } from '../../types'
import { EventCloudMenuSection, EventCloudSyncAlerts } from '../game-events/EventCloudSync'

/** Game menu section: sync status, and Enable cloud sync for a device game (BSB-6B, plan Q3). */
export function BaseballCloudMenuSection({ state, onDone }: { state: GameState; onDone: () => void }) {
  return <EventCloudMenuSection state={state} onDone={onDone} availability={baseballCloudEnableAvailability} />
}

/** Sync problems shown on the tracker: conflicts to review, or an error with Retry and Export. */
export function BaseballCloudSyncAlerts({ state }: { state: GameState }) {
  return <EventCloudSyncAlerts state={state} sportId="baseball" />
}
