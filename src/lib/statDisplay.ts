import type { SportConfig } from '../types'
import { computePlayerScore } from '../config/sports'

function statShortLabel(sport: SportConfig, statId: string): string {
  for (const cat of sport.categories) {
    const action = cat.actions.find(a => a.id === statId)
    if (action) return action.shortLabel
  }
  return statId
}

/** Compact "12 PTS · 4 REB · 3 AST" for one game's resolved stat map. */
export function formatCompactGameStatLine(sport: SportConfig, stats: Record<string, number>): string {
  const parts: string[] = []
  const score = computePlayerScore(sport, stats)
  const scoreLabel = sport.scoreLabel === 'Points' ? 'PTS' : sport.scoreLabel
  parts.push(`${score} ${scoreLabel}`)

  if (sport.id === 'basketball') {
    const reb = (stats.oreb ?? 0) + (stats.dreb ?? 0)
    if (reb > 0) parts.push(`${reb} REB`)
  }

  const keys = sport.keyStatIds?.length ? sport.keyStatIds : ['ast', 'stl', 'blk']
  for (const id of keys) {
    const v = stats[id] ?? 0
    if (v > 0) parts.push(`${v} ${statShortLabel(sport, id)}`)
  }

  const line = parts.filter(Boolean).join(' · ')
  return line || '—'
}
