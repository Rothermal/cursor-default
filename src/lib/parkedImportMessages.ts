import type { ImportParkedGamesResult } from './gameParking'

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** User-facing summary after a parked-games import merge (Settings → Data). */
export function formatParkedImportMessage(result: ImportParkedGamesResult): string {
  const skippedParts: string[] = []
  if (result.skippedExisting > 0) {
    skippedParts.push(`${formatCount(result.skippedExisting, 'existing game')} kept`)
  }
  if (result.skippedAtCap > 0) {
    skippedParts.push(`${formatCount(result.skippedAtCap, 'game')} over the parked-game limit`)
  }
  if (result.skippedInvalid > 0) {
    skippedParts.push(`${formatCount(result.skippedInvalid, 'invalid row')}`)
  }

  const skippedText = skippedParts.length > 0 ? `; skipped ${skippedParts.join(', ')}` : ''
  return `${formatCount(result.imported, 'parked game')} imported${skippedText}. Reloading...`
}

export function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
}
