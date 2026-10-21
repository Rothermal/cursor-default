export type BaseballFeatureErrorCode = 'aborted' | 'stale_account' | 'not_configured' | 'backend_update_required'
  | 'client_update_required' | 'invalid_response' | 'access_denied' | 'transport' | 'conflict'

export class BaseballFeatureError extends Error {
  constructor(readonly code: BaseballFeatureErrorCode, message: string, readonly causeDetail?: unknown) {
    super(message)
    this.name = 'BaseballFeatureError'
  }
}
export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
}
export function invalid(message: string): BaseballFeatureError { return new BaseballFeatureError('invalid_response', message) }
export function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`Invalid Baseball ${label}.`)
  return value
}
