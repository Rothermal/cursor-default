export function basketballWholeSecondsFromMs(valueMs: number): number {
  return Math.floor(Math.max(0, finite(valueMs)) / 1_000)
}

export function formatBasketballDurationSeconds(valueSeconds: number): string {
  const seconds = Math.floor(Math.max(0, finite(valueSeconds)))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

export function formatBasketballDurationMs(valueMs: number): string {
  return formatBasketballDurationSeconds(basketballWholeSecondsFromMs(valueMs))
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}
