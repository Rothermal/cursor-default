import type { SupabaseClient } from '@supabase/supabase-js'

/** RTN-1 saved opponent: per account and sport, reused across teams and seasons. */
export interface OpponentTeam {
  id: string
  sportId: string
  name: string
  nickname: string | null
}

export const OPPONENT_LABEL_MAX_LENGTH = 100

const OPPONENT_COLUMNS = 'id,sport_id,name,nickname'

export function normalizeOpponentLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

export function opponentNameKey(name: string): string {
  return name.trim().toLocaleLowerCase()
}

/** Validation message for a name/nickname pair, or null when it can be saved. */
export function opponentLabelError(name: string, nickname: string | null | undefined): string | null {
  const trimmedName = name.trim()
  if (!trimmedName) return 'Enter an opponent name.'
  if (trimmedName.length > OPPONENT_LABEL_MAX_LENGTH) return `Opponent name must be at most ${OPPONENT_LABEL_MAX_LENGTH} characters.`
  if ((nickname?.trim().length ?? 0) > OPPONENT_LABEL_MAX_LENGTH) return `Nickname must be at most ${OPPONENT_LABEL_MAX_LENGTH} characters.`
  return null
}

export function parseOpponentTeam(value: unknown): OpponentTeam | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.sport_id !== 'string' || typeof row.name !== 'string') return null
  if (row.nickname != null && typeof row.nickname !== 'string') return null
  const name = row.name.trim()
  if (!name) return null
  return { id: row.id, sportId: row.sport_id, name, nickname: normalizeOpponentLabel(row.nickname as string | null) }
}

export function sortOpponents(opponents: OpponentTeam[]): OpponentTeam[] {
  return [...opponents].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

export function findOpponentByName(opponents: OpponentTeam[], name: string): OpponentTeam | null {
  const key = opponentNameKey(name)
  if (!key) return null
  return opponents.find(opponent => opponentNameKey(opponent.name) === key) ?? null
}

/** Saved opponents matching typed text, best matches first (prefix before substring). */
export function filterOpponents(opponents: OpponentTeam[], query: string, limit = 8): OpponentTeam[] {
  const key = opponentNameKey(query)
  const sorted = sortOpponents(opponents)
  if (!key) return sorted.slice(0, limit)
  const matches = (opponent: OpponentTeam, test: (text: string) => boolean) =>
    test(opponentNameKey(opponent.name)) || (opponent.nickname != null && test(opponentNameKey(opponent.nickname)))
  const prefix = sorted.filter(opponent => matches(opponent, text => text.startsWith(key)))
  const rest = sorted.filter(opponent => !prefix.includes(opponent) && matches(opponent, text => text.includes(key)))
  return [...prefix, ...rest].slice(0, limit)
}

/**
 * Whether setup should offer "Save opponent for future games": a typed name that
 * is not saved yet, or a saved one whose nickname was changed here.
 */
export function opponentSaveCandidate(
  opponents: OpponentTeam[],
  name: string,
  nickname: string | null | undefined
): { kind: 'new' } | { kind: 'nickname'; opponent: OpponentTeam } | null {
  if (opponentLabelError(name, nickname)) return null
  const existing = findOpponentByName(opponents, name)
  if (!existing) return { kind: 'new' }
  return existing.nickname === normalizeOpponentLabel(nickname) ? null : { kind: 'nickname', opponent: existing }
}

type Client = SupabaseClient

export async function listOpponentTeams(client: Client, sportId: string): Promise<OpponentTeam[]> {
  const { data, error } = await client
    .from('opponent_teams')
    .select(OPPONENT_COLUMNS)
    .eq('sport_id', sportId)
    .is('archived_at', null)
    .order('name')
  if (error) throw new Error(error.message)
  return sortOpponents((data ?? []).map(parseOpponentTeam).filter((row): row is OpponentTeam => row !== null))
}

export async function createOpponentTeam(client: Client, sportId: string, name: string, nickname: string | null): Promise<OpponentTeam> {
  const message = opponentLabelError(name, nickname)
  if (message) throw new Error(message)
  const { data, error } = await client
    .from('opponent_teams')
    .insert({ sport_id: sportId, name: name.trim(), nickname: normalizeOpponentLabel(nickname) })
    .select(OPPONENT_COLUMNS)
    .single()
  if (error) throw new Error(error.code === '23505' ? 'That opponent is already saved.' : error.message)
  const parsed = parseOpponentTeam(data)
  if (!parsed) throw new Error('The saved opponent could not be read back.')
  return parsed
}

export async function updateOpponentTeam(client: Client, id: string, name: string, nickname: string | null): Promise<OpponentTeam> {
  const message = opponentLabelError(name, nickname)
  if (message) throw new Error(message)
  const { data, error } = await client
    .from('opponent_teams')
    .update({ name: name.trim(), nickname: normalizeOpponentLabel(nickname) })
    .eq('id', id)
    .select(OPPONENT_COLUMNS)
    .single()
  if (error) throw new Error(error.code === '23505' ? 'Another saved opponent already has that name.' : error.message)
  const parsed = parseOpponentTeam(data)
  if (!parsed) throw new Error('The saved opponent could not be read back.')
  return parsed
}

export async function archiveOpponentTeam(client: Client, id: string): Promise<void> {
  const { error } = await client.from('opponent_teams').update({ archived_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

export interface OpponentGameRow {
  id: string
  opponentName: string
  opponentNickname: string | null
}

/**
 * Cloud games of this sport that the signed-in user created against an opponent
 * with this name (case-insensitive). Used by the rename prompt.
 */
export async function listOwnGamesAgainstOpponent(
  client: Client,
  userId: string,
  sportId: string,
  opponentName: string
): Promise<OpponentGameRow[]> {
  const { data, error } = await client
    .from('games')
    .select('id,opponent_name,opponent_nickname')
    .eq('created_by', userId)
    .eq('sport_id', sportId)
    .ilike('opponent_name', escapeLikePattern(opponentName.trim()))
  if (error) throw new Error(error.message)
  const key = opponentNameKey(opponentName)
  return (data ?? [])
    .filter(row => typeof row.id === 'string' && typeof row.opponent_name === 'string' && opponentNameKey(row.opponent_name) === key)
    .map(row => ({
      id: row.id as string,
      opponentName: row.opponent_name as string,
      opponentNickname: normalizeOpponentLabel(row.opponent_nickname as string | null),
    }))
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`)
}

export async function setGameOpponentLabels(client: Client, gameId: string, name: string, nickname: string | null): Promise<void> {
  const message = opponentLabelError(name, nickname)
  if (message) throw new Error(message)
  const { error } = await client.rpc('set_game_opponent_labels', {
    p_game_id: gameId,
    p_opponent_name: name.trim(),
    p_opponent_nickname: normalizeOpponentLabel(nickname),
  })
  if (error) throw new Error(error.message)
}
