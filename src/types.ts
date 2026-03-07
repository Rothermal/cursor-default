export interface StatAction {
  id: string
  label: string
  shortLabel: string
  pointValue?: number
  /** Per-action color override (falls back to the category color). */
  color?: StatColor
  /** Set on miss/attempt actions: the id of the corresponding made stat.
   *  Used in Game Summary to merge made+miss into a single M/A column. */
  madeStatId?: string
}

export interface StatCategory {
  id: string
  name: string
  color: StatColor
  actions: StatAction[]
  showTotal?: boolean
  totalLabel?: string
  /** Override the auto grid-column count for the action grid in Game Tracker. */
  columns?: number
}

export type StatColor = 'amber' | 'sky' | 'emerald' | 'violet' | 'rose' | 'slate' | 'orange' | 'red' | 'blue' | 'green' | 'indigo' | 'teal' | 'cyan' | 'pink'

export interface SportTheme {
  bg: string
  bgLight: string
  text: string
  border: string
  gradient: string
}

export interface SportConfig {
  id: string
  name: string
  icon: string
  theme: SportTheme
  categories: StatCategory[]
  scoreLabel: string
}

export interface GameInfo {
  teamName: string
  opponentName: string
  tournamentName: string
  /** Supabase tournaments.id — set when user picks an existing or newly-created tournament. */
  tournamentId?: string | null
  date: string
}

export interface Player {
  id: string
  name: string
  number: string
  stats: Record<string, number>
}

export interface ActionLogEntry {
  id: string
  timestamp: number
  type: 'increment' | 'decrement' | 'opponent_score_up' | 'opponent_score_down' | 'home_score_up' | 'home_score_down'
  playerId?: string
  statId?: string
  previousValue: number
}

export interface GameState {
  sport: SportConfig | null
  gameInfo: GameInfo | null
  players: Player[]
  activePlayerId: string | null
  opponentScore: number
  /** Additive adjustment to home score (computed from player stats). Displayed home = computed + this. */
  homeScoreAdjustment: number
  actionLog: ActionLogEntry[]
  cloudSync: CloudSyncState
}

export type CloudSyncStatus =
  | 'offline'
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'error'

export interface CloudSyncState {
  teamId: string | null
  gameId: string | null
  gameStatus: string | null
  playerIdMap: Record<string, string>
  status: CloudSyncStatus
  lastSyncedAt: string | null
  lastError: string | null
}

export type GameAction =
  | { type: 'SET_SPORT'; sport: SportConfig }
  | { type: 'SET_GAME_INFO'; gameInfo: GameInfo }
  | { type: 'SET_PLAYERS'; players: Player[] }
  | { type: 'HYDRATE_STATE'; state: GameState }
  | { type: 'ADD_PLAYER'; player: Player }
  | { type: 'REMOVE_PLAYER'; playerId: string }
  | { type: 'SET_ACTIVE_PLAYER'; playerId: string }
  | { type: 'INCREMENT_STAT'; playerId: string; statId: string }
  | { type: 'DECREMENT_STAT'; playerId: string; statId: string }
  | { type: 'INCREMENT_OPPONENT_SCORE' }
  | { type: 'DECREMENT_OPPONENT_SCORE' }
  | { type: 'INCREMENT_HOME_SCORE' }
  | { type: 'DECREMENT_HOME_SCORE' }
  | { type: 'UNDO' }
  | { type: 'RESET_GAME' }
  | { type: 'SET_CLOUD_SYNC_STATE'; cloudSync: Partial<CloudSyncState> }
