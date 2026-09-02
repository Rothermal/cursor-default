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
