export function createSoccerUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const random = Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12)
  return `00000000-0000-4000-8000-${random}`
}
