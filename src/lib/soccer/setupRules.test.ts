import { describe, expect, it } from 'vitest'
import { resolveSoccerMatchRules } from './rules'
import {
  detectRegulationPreset,
  regulationSegmentsForPreset,
  reorderSoccerSegments,
  resizeSoccerSegments,
} from './setupRules'

describe('soccer setup rules', () => {
  it('builds and detects reviewed regulation presets', () => {
    const rules = reorderSoccerSegments({
      ...resolveSoccerMatchRules(),
      regulationSegments: regulationSegmentsForPreset('quarters'),
    })
    expect(detectRegulationPreset(rules)).toBe('quarters')
    expect(rules.regulationSegments.map(segment => segment.durationMs)).toEqual([
      900_000, 900_000, 900_000, 900_000,
    ])
  })

  it('resizes custom segments while preserving existing edits', () => {
    const initial = regulationSegmentsForPreset('standard')
    initial[0] = { ...initial[0], label: 'Opening Period' }
    const resized = resizeSoccerSegments(initial, 'regulation', 3, 20)

    expect(resized).toHaveLength(3)
    expect(resized[0].label).toBe('Opening Period')
    expect(resized[2]).toMatchObject({ id: 'regulation-3', durationMs: 1_200_000 })
  })

  it('orders extra time after every regulation segment', () => {
    const reordered = reorderSoccerSegments({
      ...resolveSoccerMatchRules(),
      regulationSegments: regulationSegmentsForPreset('quarters'),
    })
    expect(reordered.extraTimeSegments.map(segment => segment.order)).toEqual([5, 6])
  })

  it('clamps custom segment counts and treats non-matching rules as custom', () => {
    expect(resizeSoccerSegments([], 'regulation', 0, 10)).toHaveLength(1)
    expect(resizeSoccerSegments([], 'extra_time', 99, 15, 2)).toHaveLength(8)
    expect(resizeSoccerSegments([], 'extra_time', 99, 15, 2)[0]).toMatchObject({
      id: 'extra-time-1',
      order: 3,
      durationMs: 900_000,
    })

    const custom = reorderSoccerSegments({
      ...resolveSoccerMatchRules(),
      regulationSegments: [
        { id: 'regulation-1', label: 'Odd Half', kind: 'regulation', order: 1, durationMs: 40 * 60_000 },
      ],
    })
    expect(detectRegulationPreset(custom)).toBe('custom')
    expect(detectRegulationPreset({
      ...resolveSoccerMatchRules(),
      regulationSegments: regulationSegmentsForPreset('youth'),
    })).toBe('youth')
  })
})
