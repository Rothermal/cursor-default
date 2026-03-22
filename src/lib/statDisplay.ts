import type { SportConfig } from '../types'
import { computePlayerScore } from '../config/sports'

function statShortLabel(sport: SportConfig, statId: string): string {
  for (const cat of sport.categories) {
    const action = cat.actions.find(a => a.id === statId)
    if (action) return action.shortLabel
  }
  return statId
}

function scoreLineLabel(sport: SportConfig): string {
  if (sport.scoreLabel === 'Points') return 'PTS'
  return sport.scoreLabel
}

/** Compact per-game line for game logs (sport-aware). */
export function formatCompactGameStatLine(sport: SportConfig, stats: Record<string, number>): string {
  const parts: string[] = []
  const score = computePlayerScore(sport, stats)
  parts.push(`${score} ${scoreLineLabel(sport)}`)

  if (sport.id === 'basketball') {
    const reb = (stats.oreb ?? 0) + (stats.dreb ?? 0)
    if (reb > 0) parts.push(`${reb} REB`)
  }

  const keys = sport.keyStatIds?.length ? sport.keyStatIds : []
  for (const id of keys) {
    if (sport.id === 'basketball' && (id === 'oreb' || id === 'dreb')) continue
    const v = stats[id] ?? 0
    if (v > 0) parts.push(`${v} ${statShortLabel(sport, id)}`)
  }

  const line = parts.filter(Boolean).join(' · ')
  return line || '—'
}
