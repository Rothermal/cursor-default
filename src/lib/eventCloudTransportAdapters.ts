import { basketballEventCloudTransportAdapter } from './basketball/cloudSync'
import type { EventCloudTransportAdapter } from './gameEvents/cloudTransport'
import { soccerEventCloudTransportAdapter } from './soccer/cloudSync'

const adapters: Record<string, EventCloudTransportAdapter> = {
  basketball: basketballEventCloudTransportAdapter,
  soccer: soccerEventCloudTransportAdapter,
}

export function eventCloudTransportAdapterForSport(
  sportId: string | null | undefined
): EventCloudTransportAdapter | null {
  return sportId ? adapters[sportId] ?? null : null
}
