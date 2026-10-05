import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import HockeyRink from '../components/hockey/HockeyRink'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { useSettings } from '../context/SettingsContext'
import { useSportPersonalSettings } from '../hooks/useSportPersonalSettings'
import { useSportTeamSettings } from '../hooks/useSportTeamSettings'
import {
  addHockeyDraftPlayers,
  applyHockeySetupSettings,
  buildHockeyMatchSetup,
  createHockeyEventGameState,
  createHockeySetupDraft,
  findHockeyRulesProfile,
  hockeyDraftRules,
  hockeyPositionLabel,
  hockeyTeamRulesSettings,
  hockeyRulesProfiles,
  HOCKEY_POSITIONS,
  HOCKEY_SETUP_PERIOD_MINUTES,
  normalizeHockeyPosition,
  parseHockeyJerseyList,
  prefillHockeyDraftLineup,
  removeHockeyDraftEntry,
  setHockeyDraftClockModel,
  setHockeyDraftGoalie,
  setHockeyDraftPeriodLength,
  setHockeyDraftProfile,
  setHockeyDraftRoster,
  setHockeyEntryDressed,
  setHockeyEntryDressedAs,
  toggleHockeyDraftStarter,
  type HockeyAttackingDirection,
  type HockeyClockModel,
  type HockeyProfileId,
  hockeySetupTeamGate,
  type HockeySetupDraft,
  type HockeySetupLoadStatus,
  type HockeySetupEntry,
  type HockeySetupSettingsLayer,
} from '../lib/hockey'
import { hockeyPersonalSettingsAdapter, hockeyTeamSettingsAdapter } from '../lib/hockey/settingsSync'
import { ensureHockeyReleaseCapabilities } from '../lib/hockey/releaseCapabilities'
import { hockeySetupCloudGate, type HockeySetupCapabilityState, type HockeySetupStorage } from '../lib/hockey/setupCloud'
import { getHockeyEventCreationPolicy } from '../lib/sportAvailability'
import { supabase } from '../lib/supabase'

interface HockeyTeamOption {
  id: string
  name: string
  seasonId: string | null
}

/**
 * HKY-2E setup for Hockey event games. A cloud team's roster is read-only here; without a
 * team the recorder adds quick local players. Start freezes setup v1 and opens `/game`.
 */
export default function HockeyGameSetup() {
  const { hockeyEventTrackerEnabled } = useSettings()
  if (!getHockeyEventCreationPolicy(hockeyEventTrackerEnabled).canCreateNewEventGame) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-5 space-y-3">
        <p className="rounded-md border border-info-line bg-info px-3 py-2 text-sm text-info-content">
          Hockey event tracking is not available in this build yet. Turn on the new event tracker in Hockey settings to try it on this device.
        </p>
        <Link to="/settings/sports/hockey" className="btn-secondary inline-block">Hockey settings</Link>
      </main>
    )
  }
  return <HockeySetupForm />
}

function HockeySetupForm() {
  const { state, dispatch, prepareActiveGameMutation, startNewGame } = useGame()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const cloudAvailable = Boolean(user && supabase)
  const [teams, setTeams] = useState<HockeyTeamOption[]>([])
  const [teamsStatus, setTeamsStatus] = useState<HockeySetupLoadStatus>('idle')
  const [teamsError, setTeamsError] = useState<string | null>(null)
  const [teamsAttempt, setTeamsAttempt] = useState(0)
  // A team link only applies when the cloud is available; otherwise the roster is local.
  const [teamId, setTeamId] = useState(() => (cloudAvailable ? searchParams.get('teamId') ?? '' : ''))
  const [localTeamName, setLocalTeamName] = useState('Home')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [rosterStatus, setRosterStatus] = useState<HockeySetupLoadStatus>('idle')
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [rosterTeamId, setRosterTeamId] = useState<string | null>(null)
  const [rosterAttempt, setRosterAttempt] = useState(0)
  const [draft, setDraft] = useState<HockeySetupDraft>(() => createHockeySetupDraft())
  const [jerseys, setJerseys] = useState('')
  const [newPlayer, setNewPlayer] = useState({ name: '', number: '', position: '' })
  const [error, setError] = useState<string | null>(null)
  const [viewFlipped, setViewFlipped] = useState(false)
  const [storage, setStorage] = useState<HockeySetupStorage>('cloud')
  const [capability, setCapability] = useState<HockeySetupCapabilityState>({ status: 'idle' })
  const [capabilityAttempt, setCapabilityAttempt] = useState(0)
  const cloudGate = hockeySetupCloudGate({ cloudAvailable, storage, capability })

  // Only a selection that resolves to one of the recorder's Hockey teams loads a roster.
  const team = teamsStatus === 'ready' ? teams.find(entry => entry.id === teamId) ?? null : null
  const resolvedTeamId = team?.id ?? null
  const teamGate = hockeySetupTeamGate({ selectedTeamId: teamId, teamsStatus, teams, rosterStatus, rosterTeamId })
  const rules = useMemo(() => hockeyDraftRules(draft), [draft])
  const profile = findHockeyRulesProfile(draft.profileId)
  const trackedName = team?.name ?? (localTeamName.trim() || 'Home')

  // HKY-5C: a team game starts from the team's defaults, any other game from the recorder's
  // own Hockey settings. Each source is applied once it has settled; edits here always win.
  const personal = useSportPersonalSettings(hockeyPersonalSettingsAdapter)
  const teamSettings = useSportTeamSettings(hockeyTeamSettingsAdapter, resolvedTeamId)
  const teamSettingsSettled = Boolean(resolvedTeamId && teamSettings.settledTeamId === resolvedTeamId)
  const teamSettingsLoaded = teamSettingsSettled &&
    teamSettings.status !== 'error' && teamSettings.status !== 'backend_update_required'
  const rulesKey = resolvedTeamId
    ? (teamSettingsSettled ? `team:${resolvedTeamId}` : null)
    : teamId || personal.sync.status === 'checking' ? null : 'personal'
  const lineupKey = teamSettingsLoaded && rosterStatus === 'ready' && rosterTeamId === resolvedTeamId
    ? `${rosterTeamId}:${rosterAttempt}`
    : null
  const appliedRulesKey = useRef<string | null>(null)
  const appliedLineupKey = useRef<string | null>(null)
  const layer = useMemo<HockeySetupSettingsLayer | null>(() => (
    rulesKey === 'personal'
      ? { authority: 'personal', settings: personal.settings }
      : rulesKey && teamSettingsLoaded
        ? { authority: 'team', settings: hockeyTeamRulesSettings(teamSettings.settings) }
        : null
  ), [personal.settings, rulesKey, teamSettings.settings, teamSettingsLoaded])

  useEffect(() => {
    if (rulesKey && rulesKey !== appliedRulesKey.current) {
      appliedRulesKey.current = rulesKey
      setDraft(current => applyHockeySetupSettings(current, layer))
    }
    // A roster reload clears every pick, so the next loaded roster is prefilled again.
    if (!lineupKey) appliedLineupKey.current = null
    if (lineupKey && lineupKey !== appliedLineupKey.current) {
      appliedLineupKey.current = lineupKey
      const defaults = teamSettings.settings.lineupDefaults
      setDraft(current => prefillHockeyDraftLineup(current, defaults).draft)
    }
  }, [layer, lineupKey, rulesKey, teamSettings.settings.lineupDefaults])

  const missingDefaults = lineupKey
    ? (() => {
        const onRoster = new Set(draft.entries.flatMap(entry => (entry.playerId ? [entry.playerId.toLowerCase()] : [])))
        const lineup = teamSettings.settings.lineupDefaults
        return [...lineup.starterPlayerIds, lineup.startingGoaliePlayerId, lineup.backupGoaliePlayerId]
          .filter(id => id !== null && !onRoster.has(id)).length
      })()
    : 0
  // Settings apply only while the draft keeps their profile (hockeyDraftSettingsBase).
  const rulesFromSettings = Boolean(draft.settingsLayer && draft.settingsLayer.settings.baseProfile.profileId === draft.profileId)

  useEffect(() => {
    if (!cloudAvailable) return
    let cancelled = false
    setTeamsStatus('loading')
    setTeamsError(null)
    void (async () => {
      const { data, error: loadError } = await supabase!
        .from('teams')
        .select('id,name,season_id,seasons!inner(sport)')
        .eq('seasons.sport', 'hockey')
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (loadError) {
        setTeamsError(loadError.message)
        setTeamsStatus('error')
        return
      }
      setTeams(((data ?? []) as Array<{ id: string; name: string; season_id: string | null }>)
        .map(row => ({ id: row.id, name: row.name, seasonId: row.season_id })))
      setTeamsStatus('ready')
    })()
    return () => { cancelled = true }
  }, [cloudAvailable, teamsAttempt])

  useEffect(() => {
    setRosterTeamId(null)
    if (!resolvedTeamId || !supabase) {
      setRosterStatus('idle')
      return
    }
    let cancelled = false
    setRosterStatus('loading')
    setRosterError(null)
    void (async () => {
      const { data, error: loadError } = await supabase!
        .from('team_players')
        .select('player_id, jersey_number, position, players!inner(id, first_name, last_name)')
        .eq('team_id', resolvedTeamId)
        .eq('is_active', true)
        .order('joined_at', { ascending: true })
      if (cancelled) return
      if (loadError) {
        setRosterError(loadError.message)
        setRosterStatus('error')
        return
      }
      type Row = { player_id: string; jersey_number: string | null; position: string | null; players: { first_name: string | null; last_name: string | null } }
      const roster = ((data ?? []) as unknown as Row[]).map(row => ({
        playerId: row.player_id,
        displayName: `${row.players.first_name ?? ''} ${row.players.last_name ?? ''}`.trim() || 'Player',
        number: row.jersey_number,
        position: normalizeHockeyPosition(row.position),
      }))
      setDraft(current => setHockeyDraftRoster(current, roster))
      setRosterTeamId(resolvedTeamId)
      setRosterStatus('ready')
    })()
    return () => { cancelled = true }
  }, [resolvedTeamId, rosterAttempt])

  // The handshake keeps Cloud unavailable until the HKY-5A migrations are applied.
  useEffect(() => {
    if (!cloudAvailable || storage !== 'cloud' || !user) return
    let cancelled = false
    setCapability({ status: 'checking' })
    void ensureHockeyReleaseCapabilities(user.id, { force: capabilityAttempt > 0 }).then(result => {
      if (!cancelled) setCapability({ status: 'done', result })
    })
    return () => { cancelled = true }
  }, [cloudAvailable, storage, user, capabilityAttempt])

  const update = (next: HockeySetupDraft) => {
    setDraft(next)
    setError(null)
  }

  const chooseTeam = (id: string) => {
    setTeamId(id)
    // Local players never carry over to a team roster, and a team roster never to local entry.
    setDraft(current => setHockeyDraftRoster(current, []))
  }

  const addJerseys = () => {
    const numbers = parseHockeyJerseyList(jerseys)
    if (numbers.length === 0) return
    update(addHockeyDraftPlayers(draft, numbers.map(number => ({ displayName: '', number, position: null }))))
    setJerseys('')
  }

  const addPlayer = () => {
    if (!newPlayer.name.trim() && !newPlayer.number.trim()) return
    update(addHockeyDraftPlayers(draft, [{
      displayName: newPlayer.name,
      number: newPlayer.number,
      position: newPlayer.position || null,
    }]))
    setNewPlayer({ name: '', number: '', position: '' })
  }

  const start = () => {
    const hockey = sports.find(entry => entry.id === 'hockey')
    if (!hockey) return
    if (!teamGate.ok) {
      setError(teamGate.message)
      return
    }
    if (!cloudGate.canStart) {
      setError(cloudGate.message ?? 'Checking Hockey cloud support…')
      return
    }
    const built = buildHockeyMatchSetup(draft, teamGate.source)
    if (!built.ok) {
      setError(built.message)
      return
    }
    const created = createHockeyEventGameState({
      sport: hockey,
      setup: built.setup,
      teamName: trackedName,
      opponentName: draft.opponentName,
      date,
      context: { recorderUserId: user?.id ?? null, occurredAt: new Date().toISOString() },
      cloudPolicy: cloudGate.cloudPolicy,
    })
    if (!created.ok) {
      setError(created.message)
      return
    }
    const hasGame = Boolean(state.sport && (state.gameInfo || state.players.length > 0 || state.eventStream))
    if (hasGame && !prepareActiveGameMutation('new_game_commit')) return
    if (!startNewGame(hockey)) return
    dispatch({ type: 'HYDRATE_STATE', state: created.state })
    navigate('/game')
  }

  const setDirection = (direction: HockeyAttackingDirection) => update({ ...draft, firstPeriodAttackingDirection: direction })
  const dressed = draft.entries.filter(entry => entry.dressed)
  const goalie = draft.entries.find(entry => entry.id === draft.goalieId) ?? null

  return (
    <main className="max-w-2xl mx-auto px-4 py-5 space-y-5">
      <div>
        <h1 className="text-lg font-bold">New Hockey game</h1>
        {!cloudAvailable && (
          <p className="text-sm text-content-muted">Saved on this device. Sign in to sync Hockey games to the cloud.</p>
        )}
      </div>

      {cloudAvailable && (
        <Section title="Sync">
          <Segmented
            label="Save to"
            options={[{ value: 'cloud', label: 'Cloud' }, { value: 'device', label: 'This device only' }]}
            value={storage}
            onChange={(value: HockeySetupStorage) => { setStorage(value); setError(null) }}
          />
          <p className="text-sm text-content-muted">
            {storage === 'cloud'
              ? 'Events sync as you record them, and the game appears in Cloud Games.'
              : 'The game stays on this device. You can enable cloud sync later from the Game menu.'}
          </p>
          {storage === 'cloud' && !cloudGate.canStart && cloudGate.checking && (
            <p className="text-sm text-content-muted" role="status">Checking Hockey cloud support…</p>
          )}
          {storage === 'cloud' && !cloudGate.canStart && !cloudGate.checking && (
            <div role="alert" className="space-y-2 rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
              <p>{cloudGate.message}</p>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary" onClick={() => setCapabilityAttempt(attempt => attempt + 1)}>Retry</button>
                <button type="button" className="btn-secondary" onClick={() => setStorage('device')}>This device only</button>
              </div>
            </div>
          )}
        </Section>
      )}

      <Section title="Teams">
        {cloudAvailable && (
          <label className="block text-sm font-medium text-content">
            Your team
            <select className="input-field mt-1" value={teamId} onChange={event => chooseTeam(event.target.value)}>
              <option value="">Local roster (not a cloud team)</option>
              {teamId && !team && <option value={teamId}>{teamsStatus === 'ready' ? 'Team not found' : 'Selected team (loading)'}</option>}
              {teams.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
        )}
        {teamsStatus === 'error' && (
          <div role="alert" className="flex items-center gap-2 text-sm text-danger-content">
            <span className="min-w-0 flex-1">Teams could not load: {teamsError}</span>
            <button type="button" className="btn-secondary shrink-0" onClick={() => setTeamsAttempt(attempt => attempt + 1)}>Retry</button>
          </div>
        )}
        {teamId && teamsStatus === 'ready' && !team && (
          <p role="alert" className="text-sm text-danger-content">That team is not one of your Hockey teams. Choose another team or Local roster.</p>
        )}
        {!teamId && (
          <label className="block text-sm font-medium text-content">
            Team name
            <input className="input-field mt-1" maxLength={80} value={localTeamName} onChange={event => setLocalTeamName(event.target.value)} />
          </label>
        )}
        <label className="block text-sm font-medium text-content">
          Opponent
          <input
            className="input-field mt-1"
            maxLength={80}
            value={draft.opponentName}
            placeholder="Opponent"
            onChange={event => update({ ...draft, opponentName: event.target.value })}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Segmented
            label={`${trackedName} is`}
            options={[{ value: 'home', label: 'Home' }, { value: 'away', label: 'Away' }]}
            value={draft.trackedTeam}
            onChange={value => update({ ...draft, trackedTeam: value })}
          />
          <label className="block text-sm font-medium text-content">
            Date
            <input type="date" className="input-field mt-1" value={date} onChange={event => setDate(event.target.value)} />
          </label>
        </div>
      </Section>

      <Section title="Rules">
        <p className="text-xs text-content-muted">
          {rulesFromSettings
            ? draft.settingsLayer?.authority === 'team'
              ? `Starts from ${trackedName}'s team defaults. Changes here apply to this game only.`
              : 'Starts from your Hockey settings. Changes here apply to this game only.'
            : 'Built-in profile rules. Changes here apply to this game only.'}
        </p>
        {resolvedTeamId && teamSettingsSettled && !teamSettingsLoaded && (
          <p role="status" className="text-sm text-warning-content">
            {teamSettings.error ?? 'Team defaults could not load.'} Using built-in rules and no default lineup.
          </p>
        )}
        <label className="block text-sm font-medium text-content">
          Rules profile
          <select
            className="input-field mt-1"
            value={draft.profileId}
            onChange={event => update(setHockeyDraftProfile(draft, event.target.value as HockeyProfileId))}
          >
            {hockeyRulesProfiles().map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        {profile && <p className="text-xs text-content-muted">{profile.description}</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-content">
            Period length (min)
            <input
              type="number"
              inputMode="numeric"
              min={HOCKEY_SETUP_PERIOD_MINUTES.min}
              max={HOCKEY_SETUP_PERIOD_MINUTES.max}
              className="input-field mt-1"
              value={draft.periodLengthMinutes ?? Math.round(rules.regulation.periodLengthMs / 60_000)}
              onChange={event => update(setHockeyDraftPeriodLength(draft, event.target.value === '' ? null : Number(event.target.value)))}
            />
          </label>
          <Segmented
            label="Clock"
            options={[{ value: 'anchored', label: 'Run clock' }, { value: 'none', label: 'No clock' }]}
            value={rules.clockModel}
            onChange={(value: HockeyClockModel) => update(setHockeyDraftClockModel(draft, value))}
          />
        </div>
        <p className="text-xs text-content-muted">
          {rules.regulation.periods} periods, {rules.skatersPerSide} skaters a side
          {rules.overtime ? `, ${Math.round(rules.overtime.lengthMs / 60_000)}-minute overtime` : ', no overtime'}
          {rules.shootout ? ', shootout' : ''}.
        </p>
      </Section>

      <Section title="Period 1 direction">
        <p className="text-sm text-content-muted">Tap the end {trackedName} attacks in period 1.</p>
        <HockeyRink
          trackedDirection={draft.firstPeriodAttackingDirection}
          flipped={viewFlipped}
          trapezoid={rules.trapezoid}
          trackedLabel={trackedName}
          onFlip={() => setViewFlipped(!viewFlipped)}
          onLocation={location => setDirection(location.x >= 0.5 ? 'left_to_right' : 'right_to_left')}
        />
        <Segmented
          label="Attacks toward"
          options={[{ value: 'right_to_left', label: 'Left end' }, { value: 'left_to_right', label: 'Right end' }]}
          value={draft.firstPeriodAttackingDirection}
          onChange={setDirection}
        />
      </Section>

      <Section title={`${trackedName} lineup`}>
        {teamId && rosterStatus === 'loading' && <p className="text-sm text-content-muted">Loading the roster…</p>}
        {teamId && rosterStatus === 'error' && (
          <div role="alert" className="flex items-center gap-2 text-sm text-danger-content">
            <span className="min-w-0 flex-1">The roster could not load: {rosterError}</span>
            <button type="button" className="btn-secondary shrink-0" onClick={() => setRosterAttempt(attempt => attempt + 1)}>Retry</button>
          </div>
        )}
        {teamId && rosterStatus === 'ready' && draft.entries.length === 0 && (
          <p className="text-sm text-content-muted">This team has no active players. Add them in Team Manage, or use a local roster.</p>
        )}
        {teamId && rosterStatus === 'ready' && (
          <p className="text-xs text-content-muted">
            The team roster is read-only here; nothing is written back to the team.
            {lineupKey && ' Starters and goalies start from the team defaults.'}
          </p>
        )}
        {missingDefaults > 0 && (
          <p role="status" className="text-xs text-warning-content">
            {missingDefaults === 1 ? 'One default lineup player is' : `${missingDefaults} default lineup players are`} not on the active roster and stay out of this game.
          </p>
        )}
        <p className="text-sm font-medium text-content" aria-live="polite">
          Goalie: {goalie ? entryName(goalie) : 'not chosen'} · Skaters {draft.starterIds.length} of {rules.skatersPerSide} · {dressed.length} dressed
        </p>
        {draft.entries.length > 0 && (
          <ul className="divide-y divide-line rounded-md border border-line">
            {draft.entries.map(entry => (
              <LineupRow
                key={entry.id}
                entry={entry}
                goalie={draft.goalieId === entry.id}
                starter={draft.starterIds.includes(entry.id)}
                removable={!teamId}
                onDressed={value => update(setHockeyEntryDressed(draft, entry.id, value))}
                onDressedAs={value => update(setHockeyEntryDressedAs(draft, entry.id, value))}
                onGoalie={() => update(setHockeyDraftGoalie(draft, draft.goalieId === entry.id ? null : entry.id))}
                onStarter={() => update(toggleHockeyDraftStarter(draft, entry.id))}
                onRemove={() => update(removeHockeyDraftEntry(draft, entry.id))}
              />
            ))}
          </ul>
        )}
        {!teamId && (
          <div className="space-y-3 rounded-md bg-surface-muted p-3">
            <div className="flex gap-2">
              <label className="min-w-0 flex-1 text-sm font-medium text-content">
                Add by jersey numbers
                <input
                  className="input-field mt-1"
                  inputMode="numeric"
                  placeholder="1, 7, 9, 12"
                  value={jerseys}
                  onChange={event => setJerseys(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter') addJerseys() }}
                />
              </label>
              <button type="button" className="btn-secondary self-end" onClick={addJerseys}>Add</button>
            </div>
            <div className="grid grid-cols-[1fr_4.5rem] gap-2">
              <label className="text-sm font-medium text-content">
                Player name
                <input className="input-field mt-1" maxLength={80} value={newPlayer.name} onChange={event => setNewPlayer({ ...newPlayer, name: event.target.value })} />
              </label>
              <label className="text-sm font-medium text-content">
                No.
                <input className="input-field mt-1" maxLength={10} value={newPlayer.number} onChange={event => setNewPlayer({ ...newPlayer, number: event.target.value })} />
              </label>
            </div>
            <div className="flex gap-2">
              <label className="min-w-0 flex-1 text-sm font-medium text-content">
                Position
                <select className="input-field mt-1" value={newPlayer.position} onChange={event => setNewPlayer({ ...newPlayer, position: event.target.value })}>
                  <option value="">Unassigned</option>
                  {HOCKEY_POSITIONS.map(position => <option key={position.code} value={position.code}>{position.label}</option>)}
                </select>
              </label>
              <button type="button" className="btn-secondary self-end" onClick={addPlayer}>Add player</button>
            </div>
          </div>
        )}
      </Section>

      <Section title="Opponent goalie">
        <label className="block text-sm font-medium text-content">
          Starting goalie number (optional)
          <input
            className="input-field mt-1"
            maxLength={10}
            inputMode="numeric"
            value={draft.opponentGoalieNumber}
            onChange={event => update({ ...draft, opponentGoalieNumber: event.target.value })}
          />
        </label>
      </Section>

      {error && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">{error}</p>
      )}
      <div className="sticky bottom-0 -mx-4 border-t border-line bg-canvas/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
        <button
          type="button"
          className="btn-primary w-full"
          onClick={start}
          disabled={!cloudGate.canStart}
        >
          Start game
        </button>
      </div>
    </main>
  )
}

function entryName(entry: HockeySetupEntry): string {
  return entry.number && !entry.displayName.startsWith('#') ? `#${entry.number} ${entry.displayName}` : entry.displayName
}

function LineupRow({
  entry,
  goalie,
  starter,
  removable,
  onDressed,
  onDressedAs,
  onGoalie,
  onStarter,
  onRemove,
}: {
  entry: HockeySetupEntry
  goalie: boolean
  starter: boolean
  removable: boolean
  onDressed: (value: boolean) => void
  onDressedAs: (value: 'skater' | 'goalie') => void
  onGoalie: () => void
  onStarter: () => void
  onRemove: () => void
}) {
  const name = entryName(entry)
  return (
    <li className={`space-y-2 px-3 py-2 ${entry.dressed ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-2">
        <label className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={entry.dressed} onChange={event => onDressed(event.target.checked)} />
          <span className="min-w-0 truncate font-semibold text-content">{name}</span>
          <span className="shrink-0 text-xs text-content-muted">{hockeyPositionLabel(entry.position)}</span>
        </label>
        {removable && (
          <button type="button" className="grid h-9 w-9 place-items-center text-content-muted" aria-label={`Remove ${name}`} title="Remove" onClick={onRemove}>
            <Trash2 size={16} />
          </button>
        )}
      </div>
      {entry.dressed && (
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex overflow-hidden rounded-md border border-line-strong" role="group" aria-label={`${name} dresses as`}>
            {(['skater', 'goalie'] as const).map(value => (
              <button
                key={value}
                type="button"
                aria-pressed={entry.dressedAs === value}
                className={`min-h-9 px-3 text-sm ${entry.dressedAs === value ? 'bg-accent text-accent-content' : 'text-content-muted'}`}
                onClick={() => onDressedAs(value)}
              >
                {value === 'skater' ? 'Skater' : 'Goalie'}
              </button>
            ))}
          </div>
          {entry.dressedAs === 'goalie' ? (
            <button
              type="button"
              aria-pressed={goalie}
              className={`min-h-9 rounded-md border px-3 text-sm font-semibold ${goalie ? 'border-accent bg-accent text-accent-content' : 'border-line-strong text-content'}`}
              onClick={onGoalie}
            >
              {goalie ? 'Starting goalie' : 'Start in goal'}
            </button>
          ) : (
            <button
              type="button"
              aria-pressed={starter}
              className={`min-h-9 rounded-md border px-3 text-sm font-semibold ${starter ? 'border-accent bg-accent text-accent-content' : 'border-line-strong text-content'}`}
              onClick={onStarter}
            >
              {starter ? 'Starting skater' : 'Start'}
            </button>
          )}
        </div>
      )}
    </li>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold uppercase text-content-muted">{title}</h2>
      {children}
    </section>
  )
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="text-sm font-medium text-content">
      <p className="truncate">{label}</p>
      <div className="mt-1 grid grid-flow-col overflow-hidden rounded-md border border-line-strong" role="group" aria-label={label}>
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            className={`min-h-10 px-2 text-sm ${value === option.value ? 'bg-accent text-accent-content' : 'text-content-muted'}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
