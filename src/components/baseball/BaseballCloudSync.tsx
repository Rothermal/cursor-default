import { baseballCloudEnableAvailability } from '../../lib/baseball/enableCloudSync'
import type { GameState } from '../../types'
import { EventCloudMenuSection, EventCloudSyncAlerts } from '../game-events/EventCloudSync'
import BaseballSetupLinkRecovery from './BaseballSetupLinkRecovery'

/** Game menu section: sync status, and Enable cloud sync for a device game (BSB-6B, plan Q3). */
export function BaseballCloudMenuSection({ state, onDone }: { state: GameState; onDone: () => void }) {
  return <EventCloudMenuSection state={state} onDone={onDone} availability={baseballCloudEnableAvailability} />
}

/** Sync problems shown on the tracker: conflicts to review, or an error with Retry and Export. */
export function BaseballCloudSyncAlerts({ state }: { state: GameState }) {
  return <>
    {state.cloudSync.lastError?.startsWith('Events saved; player-history links need attention:') && <BaseballSetupLinkRecovery state={state} />}
    {state.cloudSync.tournamentSyncWarning && <p role="status" className="rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
      Tournament association: {state.cloudSync.tournamentSyncWarning} Events can still sync.
    </p>}
    <EventCloudSyncAlerts state={state} sportId="baseball" />
  </>
}
