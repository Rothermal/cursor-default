export type ShotZone = 'restricted' | 'paint' | 'mid_range' | 'three'

/** Location on the half-court diagram in feet; same system as `BasketballCourt` taps. @see `src/lib/shotChartCoordinates.ts` */
export interface ShotRecord {
  id: string
  x: number
  y: number
  made: boolean
  shotType: '2pt' | '3pt'
  zone: ShotZone
  playerId: string
  timestamp: number
}

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
  /** Team stats: actual stat id becomes `${id}_p${currentPeriod}` in GameTracker. */
  periodScoped?: boolean
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
  /** When true, suppress the section header in Game Tracker (card labels serve as identifiers). */
  hideHeader?: boolean
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
  /** Team pseudo-player stat categories (optional per sport). */
  teamCategories?: StatCategory[]
  scoreLabel: string
  /** Stat ids for compact per-game lines (e.g. game log). Optional; falls back to score + common stats. */
  keyStatIds?: string[]
  /** Compact keys when summarizing team-level stats. */
  teamKeyStatIds?: string[]
  /**
   * Base stat id for period-scoped team fouls (suffix `_pN` in tracker). Used for bonus banner counts.
   * Basketball sets `team_foul`.
   */
  teamFoulBaseStatId?: string
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
  /** True for home/opponent team pseudo-players (team-level stat tracking). */
  isTeamPlayer?: boolean
  teamSide?: 'home' | 'opponent'
}

export interface ActionLogEntry {
  id: string
  timestamp: number
  type:
    | 'increment'
    | 'decrement'
    | 'opponent_score_up'
    | 'opponent_score_down'
    | 'home_score_up'
    | 'home_score_down'
    | 'home_team_score_up'
    | 'home_team_score_down'
  playerId?: string
  statId?: string
  previousValue: number
  /** When set, `UNDO` also removes the matching row from `GameState.shotChart`. */
  shotId?: string
  /** For home_team_score_* undo: snapshot before the change. */
  previousHomeTeamScore?: number | null
  previousHomeScoreAdjustment?: number
}

/** Resolved basketball team-stat rules (season defaults merged in). */
export interface BasketballTeamStatsConfig {
  periodsPerGame: number
  periodLabels: string[]
  bonusThreshold: number
  doubleBonusThreshold: number
  hasOneAndOne: boolean
  overtimeLabel: string
  overtimeFoulsReset: boolean
  /** Max team timeouts per regulation period; null = unlimited. */
  timeoutsPerPeriod: number | null
  /** Max per OT period; null = same as timeoutsPerPeriod. */
  timeoutsPerOvertime: number | null
}

/** Union placeholder for future per-sport team config shapes. */
export type TeamStatsConfig = BasketballTeamStatsConfig

export interface GameState {
  sport: SportConfig | null
  gameInfo: GameInfo | null
  players: Player[]
  activePlayerId: string | null
  opponentScore: number
  /**
   * Standalone scoreboard home total (not derived from player scoring stats).
   * When null, displayed home score uses legacy: sum of player scoring stats + homeScoreAdjustment.
   */
  homeTeamScore: number | null
  /**
   * Legacy additive tweak when homeTeamScore is null; ignored when homeTeamScore is set.
   */
  homeScoreAdjustment: number
  /** Free-text game notes entered during or after the game. */
  notes: string
  actionLog: ActionLogEntry[]
  cloudSync: CloudSyncState
  /** 1-based period index for period-scoped team stats (e.g. half 1 vs 2). */
  currentPeriod: number
  /**
   * Raw `seasons.team_stats_config` JSON for the active cloud season (merged at game time via resolveTeamStatsConfig).
   * Null when no season or empty config.
   */
  teamStatsConfig: Record<string, unknown> | null
  /** Location-tagged shots from the shot chart (feet from rim; see `shotChartCoordinates.ts`). */
  shotChart: ShotRecord[]
}

export type CloudSyncStatus =
  | 'offline'
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'error'

export interface CloudSyncState {
  seasonId: string | null
  teamId: string | null
  gameId: string | null
  gameStatus: string | null
  playerIdMap: Record<string, string>
  status: CloudSyncStatus
  lastSyncedAt: string | null
  /** Fingerprint at last successful sync/hydrate; skip cloud hydrate when local state diverges. */
  lastSyncedFingerprint: string | null
  lastError: string | null
  /**
   * Shot-chart rows present in Supabase for this game/recorder that were not mapped into
   * `shotChart` during hydration (e.g. player no longer on roster). Sync must not delete
   * cloud rows while this is positive and local `shotChart` is empty.
   */
  shotChartHydrationDroppedRows: number
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
  | { type: 'SET_NOTES'; notes: string }
  | { type: 'ADD_SHOT'; shot: ShotRecord }
  | { type: 'REMOVE_LAST_SHOT' }
  /** Undo once only if the last log entry is shot-chart–originated (`shotId` set). */
  | { type: 'UNDO_LAST_SHOT' }
  /** Pop every shot from the tail of `shotChart` that still matches the last log entry (see reducer). */
  | { type: 'CLEAR_SHOT_CHART' }
  | { type: 'UNDO' }
  | { type: 'RESET_GAME' }
  | { type: 'SET_CLOUD_SYNC_STATE'; cloudSync: Partial<CloudSyncState> }
  | { type: 'SET_PERIOD'; period: number }
  | { type: 'SET_TEAM_STATS_CONFIG'; config: Record<string, unknown> | null }
