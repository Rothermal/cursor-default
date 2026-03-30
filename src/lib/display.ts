export function teamDisplayName(team: { name: string; nickname?: string | null }): string {
  const nickname = team.nickname?.trim()
  return nickname ? nickname : team.name
}

export function playerDisplayName(player: {
  first_name: string
  last_name?: string | null
  nickname?: string | null
}): string {
  const nickname = player.nickname?.trim()
  if (nickname) return nickname
  return [player.first_name, player.last_name].filter(Boolean).join(' ').trim() || 'Player'
}

/** First + last always (for dropdowns where nicknames alone are ambiguous). Optional (nickname) suffix. */
export function playerRosterSelectLabel(player: {
  first_name: string
  last_name?: string | null
  nickname?: string | null
}): string {
  const base = [player.first_name, player.last_name].filter(Boolean).join(' ').trim() || 'Player'
  const nick = player.nickname?.trim()
  return nick ? `${base} (${nick})` : base
}

