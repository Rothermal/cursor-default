export function normalizedSeasonName(value: string): string | null {
  const name = value.trim()
  return name.length > 0 ? name : null
}

export function canRenameSeason(
  seasonOwnerId: string,
  userId: string | null | undefined
): boolean {
  return Boolean(userId && seasonOwnerId === userId)
}

export type SeasonRenameDecision =
  | { outcome: 'blocked' }
  | { outcome: 'invalid' }
  | { outcome: 'unchanged'; name: string }
  | { outcome: 'rename'; name: string }

export function decideSeasonRename(
  season: { ownerId: string; name: string },
  draft: string,
  userId: string | null | undefined
): SeasonRenameDecision {
  if (!canRenameSeason(season.ownerId, userId)) return { outcome: 'blocked' }

  const name = normalizedSeasonName(draft)
  if (!name) return { outcome: 'invalid' }
  if (name === season.name) return { outcome: 'unchanged', name }
  return { outcome: 'rename', name }
}
