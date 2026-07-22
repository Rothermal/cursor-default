import { resolveSoccerMatchRules, withSoccerTieResolution } from './rules'
import type { SoccerMatchRules, SoccerMatchSegment } from './types'

export type SoccerRegulationPreset = 'standard' | 'youth' | 'quarters' | 'custom'
export type SoccerCompetitionProfile = 'ifab' | 'high_school' | 'custom'

export function soccerRulesForCompetitionProfile(
  profile: Exclude<SoccerCompetitionProfile, 'custom'>
): SoccerMatchRules {
  if (profile === 'ifab') return resolveSoccerMatchRules()
  return withSoccerTieResolution(resolveSoccerMatchRules({
    gameOverrides: {
      regulationSegments: createSegments('regulation', 2, 40, ['First Half', 'Second Half']),
      clockDirection: 'count_down',
      clockDisplay: 'per_period',
      allowReturnSubstitutions: true,
      substitutionLimit: null,
      substitutionWindowLimit: null,
      yellowCardExitPolicy: 'must_leave_may_replace',
    },
  }), 'draw_allowed')
}

export function detectSoccerCompetitionProfile(rules: SoccerMatchRules): SoccerCompetitionProfile {
  for (const profile of ['ifab', 'high_school'] as const) {
    if (JSON.stringify(rules) === JSON.stringify(soccerRulesForCompetitionProfile(profile))) {
      return profile
    }
  }
  return 'custom'
}

export function regulationSegmentsForPreset(
  preset: Exclude<SoccerRegulationPreset, 'custom'>
): SoccerMatchSegment[] {
  switch (preset) {
    case 'standard':
      return createSegments('regulation', 2, 45, ['First Half', 'Second Half'])
    case 'youth':
      return createSegments('regulation', 2, 30, ['First Half', 'Second Half'])
    case 'quarters':
      return createSegments('regulation', 4, 15, ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'])
  }
}

export function detectRegulationPreset(rules: SoccerMatchRules): SoccerRegulationPreset {
  for (const preset of ['standard', 'youth', 'quarters'] as const) {
    const expected = regulationSegmentsForPreset(preset)
    if (
      expected.length === rules.regulationSegments.length &&
      expected.every((segment, index) => {
        const actual = rules.regulationSegments[index]
        return actual?.label === segment.label && actual.durationMs === segment.durationMs
      })
    ) {
      return preset
    }
  }
  return 'custom'
}

export function resizeSoccerSegments(
  segments: SoccerMatchSegment[],
  kind: SoccerMatchSegment['kind'],
  count: number,
  defaultMinutes: number,
  orderOffset = 0
): SoccerMatchSegment[] {
  const size = Math.max(1, Math.min(8, Math.floor(count)))
  return Array.from({ length: size }, (_, index) => {
    const existing = segments[index]
    if (existing) {
      return { ...existing, kind, order: orderOffset + index + 1 }
    }
    return {
      id: `${kind === 'regulation' ? 'regulation' : 'extra-time'}-${index + 1}`,
      label: kind === 'regulation' ? `Period ${index + 1}` : `Extra Time ${index + 1}`,
      kind,
      order: orderOffset + index + 1,
      durationMs: Math.max(1, Math.floor(defaultMinutes)) * 60_000,
    }
  })
}

export function reorderSoccerSegments(rules: SoccerMatchRules): SoccerMatchRules {
  const regulationSegments = rules.regulationSegments.map((segment, index) => ({
    ...segment,
    order: index + 1,
  }))
  const extraTimeSegments = rules.extraTimeSegments.map((segment, index) => ({
    ...segment,
    order: regulationSegments.length + index + 1,
  }))
  return { ...rules, regulationSegments, extraTimeSegments }
}

function createSegments(
  kind: SoccerMatchSegment['kind'],
  count: number,
  minutes: number,
  labels: string[]
): SoccerMatchSegment[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${kind === 'regulation' ? 'regulation' : 'extra-time'}-${index + 1}`,
    label: labels[index] ?? `Period ${index + 1}`,
    kind,
    order: index + 1,
    durationMs: minutes * 60_000,
  }))
}
