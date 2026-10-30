import { describe, expect, it } from 'vitest'
import type { ShotRecord } from '../../types'
import { BASKETBALL_MARKER_HIT_RADIUS_FEET, clusterBasketballShotMarkers } from './timeline'

const shot = (id: string, x = 30, y = 25, timestamp = 1): ShotRecord => ({
  id, playerId: 'player-1', x, y, timestamp, made: true, shotType: '2pt', zone: 'paint',
})
const ids = (shots: ShotRecord[]) => clusterBasketballShotMarkers(shots).map(group => group.map(item => item.id))

describe('Basketball display-only shot stacks', () => {
  it('counts exact and close overlaps while leaving distant shots separate', () => {
    expect(ids([shot('a'), shot('b'), shot('c', 31), shot('d', 60)]))
      .toEqual([['a', 'b', 'c'], ['d']])
  })
  it('is input-order independent and orders choices newest first with stable id ties', () => {
    const shots = [shot('old', 30, 25, 1), shot('b', 31, 25, 3), shot('a', 30, 25, 3), shot('far', 60)]
    expect(ids(shots)).toEqual([['a', 'b', 'old'], ['far']])
    expect(ids([...shots].reverse())).toEqual(ids(shots))
  })
  it('bounds every stack rather than joining a long chain of nearby shots', () => {
    const radius = BASKETBALL_MARKER_HIT_RADIUS_FEET
    expect(ids([shot('a', 0), shot('b', radius), shot('c', radius * 2)]))
      .toEqual([['a', 'b'], ['c']])
  })
  it('does not mutate coordinates, records or input order', () => {
    const shots = [shot('b', 31), shot('a')]
    const before = structuredClone(shots)
    clusterBasketballShotMarkers(shots)
    expect(shots).toEqual(before)
  })
  it('counts only supplied visible shots and handles empty/single-shot views', () => {
    const visible = [shot('a'), { ...shot('b'), made: false }]
    expect(ids(visible)).toEqual([['a', 'b']])
    expect(ids(visible.filter(item => item.made))).toEqual([['a']])
    expect(ids([])).toEqual([])
  })
})
