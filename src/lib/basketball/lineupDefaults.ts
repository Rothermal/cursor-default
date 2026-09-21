import { isPlainObject } from '../gameEvents/envelope'

export interface BasketballLineupDefaults {
  version: 1
  starterPlayerIds: string[]
}

export function parseBasketballLineupDefaults(value: unknown): BasketballLineupDefaults | null {
  if (!isPlainObject(value) || Object.keys(value).length !== 2 || value.version !== 1 ||
      !Array.isArray(value.starterPlayerIds) || value.starterPlayerIds.length > 5) return null
  const ids: string[] = []
  for (const id of value.starterPlayerIds) {
    if (typeof id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null
    const normalized = id.toLowerCase()
    if (ids.includes(normalized)) return null
    ids.push(normalized)
  }
  return { version: 1, starterPlayerIds: ids.sort() }
}
