import { isPlainObject } from '../gameEvents/envelope'
import { invalid } from './featureErrors'

export function baseballUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw invalid(`Invalid Baseball ${label}.`)
  }
  return value.toLowerCase()
}
export function baseballMapFingerprint(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) throw invalid('Invalid Baseball participant map fingerprint.')
  return value
}
export function parseBaseballParticipantMap(value: unknown): Record<string, string | null> {
  if (!isPlainObject(value)) throw invalid('Invalid Baseball participant map.')
  const result: Record<string, string | null> = Object.create(null)
  for (const [key, source] of Object.entries(value)) {
    if (!key.trim()) throw invalid('Invalid Baseball participant key.')
    result[key] = source === null ? null : baseballUuid(source, 'source player')
  }
  return result
}
export function assertExactBaseballParticipants(map: Record<string, string | null>, participantIds: readonly string[]): void {
  if (!participantIds.length || new Set(participantIds).size !== participantIds.length
    || Object.keys(map).length !== participantIds.length || participantIds.some(id => !id.trim() || !Object.prototype.hasOwnProperty.call(map, id))) {
    throw invalid('The personal Baseball map must include every canonical participant, including null links.')
  }
}
