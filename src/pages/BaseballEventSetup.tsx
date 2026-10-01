import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BaseballHandChoice from '../components/baseball/BaseballHandChoice'
import BaseballPositionField from '../components/baseball/BaseballPositionField'
import { sports } from '../config/sports'
import { useAuth } from '../context/AuthContext'
import { useGame } from '../context/GameContext'
import { useSportTeamSettings } from '../hooks/useSportTeamSettings'
import {
  baseballFieldingPositionCode,
  baseballPositionLabel,
  baseballRulesProfiles,
  createBaseballMatchRules,
  DEFAULT_BASEBALL_PROFILE_ID,
  normalizeBaseballMatchRules,
  normalizeBaseballPosition,
  type BaseballBatHand,
  type BaseballBattingOrderFormat,
  type BaseballMatchRules,
  type BaseballPitchHand,
  type BaseballProfileId,
} from '../lib/baseball'
import { createBaseballUuid } from '../lib/baseball/id'
import {
  buildBaseballMatchSetup,
  createBaseballEventGameState,
  createBaseballSetupDraft,
  planBaseballTeamPrefill,
  setBaseballDraftFielder,
  setBaseballDraftHand,
  setBaseballDraftRules,
  setBaseballPlayerSelected,
  type BaseballSetupDraft,
  type BaseballSetupRosterPlayer,
} from '../lib/baseball/setupBuilder'
import { baseballTeamSettingsAdapter } from '../lib/baseball/teamSettingsSync'
import { getBaseballEventCreationPolicy } from '../lib/sportAvailability'
import { useSettings } from '../context/SettingsContext'
import { supabase } from '../lib/supabase'

interface BaseballTeamOption {
  id: string
  name: string
  seasonId: string | null
}

type RosterStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * BSB-2 development setup for Baseball event games: builds the frozen BSB-1 setup from a
 * local roster or a cloud team (prefilled once from team defaults) and opens `/game`.
 */
export default function BaseballEventSetup() {
  const { baseballEventTrackerEnabled } = useSettings()
  if (!getBaseballEventCreationPolicy(baseballEventTrackerEnabled).canCreateNewEventGame) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-5 space-y-3">
        <p className="rounded-md border border-info-line bg-info px-3 py-2 text-sm text-info-content">
          Baseball event tracking is not available in this build yet. Turn on the new event tracker in Baseball settings to try it on this device.
        </p>
        <Link to="/settings/sports/baseball" className="btn-secondary inline-block">Baseball settings</Link>
      </main>
    )
  }
  return <BaseballSetupForm />
}

function BaseballSetupForm() {
  const { state, dispatch, prepareActiveGameMutation, startNewGame } = useGame()
  const { user } = useAuth()
  const navigate = useNavigate()
  const cloudAvailable = Boolean(user && supabase)
  const [teams, setTeams] = useState<BaseballTeamOption[]>([])
  const [teamsError, setTeamsError] = useState<string | null>(null)
  const [teamId, setTeamId] = useState<string>('')
  const [teamName, setTeamName] = useState('Home')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [roster, setRoster] = useState<BaseballSetupRosterPlayer[]>([])
  const [rosterStatus, setRosterStatus] = useState<RosterStatus>('idle')
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [draft, setDraft] = useState<BaseballSetupDraft>(() =>
    createBaseballSetupDraft({ rules: createBaseballMatchRules(DEFAULT_BASEBALL_PROFILE_ID), roster: [] }))
  const [draftTeamId, setDraftTeamId] = useState<string>('')
  const [defaultsNote, setDefaultsNote] = useState<string | null>(null)
  const [rulesError, setRulesError] = useState<string | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [newPlayer, setNewPlayer] = useState({ name: '', number: '', position: null as string | null })
  const teamSettings = useSportTeamSettings(baseballTeamSettingsAdapter, teamId || null, Boolean(teamId))

  useEffect(() => {
    if (!cloudAvailable) return
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase!
        .from('teams')
        .select('id,name,season_id,seasons!inner(sport)')
        .eq('seasons.sport', 'baseball')
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (error) {
        setTeamsError(error.message)
        return
      }
      setTeams(((data ?? []) as Array<{ id: string; name: string; season_id: string | null }>)
        .map(row => ({ id: row.id, name: row.name, seasonId: row.season_id })))
    })()
    return () => { cancelled = true }
  }, [cloudAvailable])

  useEffect(() => {
    if (!teamId || !supabase) return
    let cancelled = false
    setRosterStatus('loading')
    setRosterError(null)
    void (async () => {
      const { data, error } = await supabase!
        .from('team_players')
        .select('player_id, jersey_number, position, players!inner(id, first_name, last_name)')
        .eq('team_id', teamId)
        .eq('is_active', true)
        .order('joined_at', { ascending: true })
      if (cancelled) return
      if (error) {
        setRosterError(error.message)
        setRosterStatus('error')
        return
      }
      type Row = { player_id: string; jersey_number: string | null; position: string | null; players: { first_name: string | null; last_name: string | null } }
      setRoster(((data ?? []) as unknown as Row[]).map(row => ({
        playerId: row.player_id,
        displayName: `${row.players.first_name ?? ''} ${row.players.last_name ?? ''}`.trim() || 'Player',
        number: row.jersey_number,
        position: normalizeBaseballPosition(row.position),
      })))
      setRosterStatus('ready')
    })()
    return () => { cancelled = true }
  }, [teamId])

  // Team defaults are copied into the draft once per chosen team, after the roster and the
  // first cloud settings read have both finished (see planBaseballTeamPrefill).
  useEffect(() => {
    const team = teams.find(entry => entry.id === teamId)
    const prefill = planBaseballTeamPrefill({
      teamId,
      initializedTeamId: draftTeamId || null,
      rosterReady: rosterStatus === 'ready',
      roster,
      settings: {
        settledTeamId: teamSettings.settledTeamId,
        status: teamSettings.status,
        settings: teamSettings.settings,
      },
      sourceSeasonId: team?.seasonId ?? null,
      trackedSide: draft.trackedSide,
      opponentName: draft.opponentName,
    })
    if (!prefill) return
    setDraft(prefill.draft)
    setDefaultsNote(prefill.note)
    if (team) setTeamName(team.name)
    setDraftTeamId(teamId)
  }, [teamId, draftTeamId, rosterStatus, roster, teams, teamSettings.settledTeamId, teamSettings.status, teamSettings.settings, draft.trackedSide, draft.opponentName])

  const chooseTeam = (next: string) => {
    setTeamId(next)
    setDraftTeamId('')
    setDefaultsNote(null)
    setRoster([])
    setRosterStatus(next ? 'loading' : 'idle')
    if (!next) {
      setDraft(current => createBaseballSetupDraft({
        rules: createBaseballMatchRules(DEFAULT_BASEBALL_PROFILE_ID),
        roster: [],
        trackedSide: current.trackedSide,
        opponentName: current.opponentName,
      }))
    }
  }

  const addLocalPlayer = () => {
    const name = newPlayer.name.trim()
    if (!name) return
    const player: BaseballSetupRosterPlayer = {
      playerId: createBaseballUuid(),
      displayName: name.slice(0, 80),
      number: newPlayer.number.trim().slice(0, 10) || null,
      position: normalizeBaseballPosition(newPlayer.position),
    }
    setRoster(current => [...current, player])
    setDraft(current => setBaseballPlayerSelected(current, player.playerId, true))
    setNewPlayer({ name: '', number: '', position: null })
  }

  const changeRules = (patch: Partial<BaseballMatchRules>) => {
    const candidate = { ...draft.rules, ...patch }
    if (candidate.placedRunnerBase !== null && candidate.placedRunnerFromInning !== null &&
        candidate.placedRunnerFromInning <= candidate.scheduledInnings) {
      candidate.placedRunnerFromInning = candidate.scheduledInnings + 1
    }
    const normalized = normalizeBaseballMatchRules(candidate)
    if (!normalized) {
      setRulesError('That rule change is not valid for these rules.')
      return
    }
    setRulesError(null)
    setDraft(current => setBaseballDraftRules(current, normalized))
  }

  const nameOf = useMemo(() => {
    const names = new Map(roster.map(player => [player.playerId, player]))
    return (playerId: string) => {
      const player = names.get(playerId)
      return player ? `${player.number ? `#${player.number} ` : ''}${player.displayName}` : 'Unknown player'
    }
  }, [roster])

  const dressed = roster.filter(player => draft.selectedPlayerIds.includes(player.playerId))
  const build = useMemo(() => buildBaseballMatchSetup(draft, roster), [draft, roster])
  const waitingForTeam = Boolean(teamId) && draftTeamId !== teamId

  const moveBatter = (index: number, offset: number) => {
    const order = [...draft.battingOrder]
    const target = index + offset
    if (target < 0 || target >= order.length) return
    ;[order[index], order[target]] = [order[target], order[index]]
    setDraft({ ...draft, battingOrder: order })
  }

  const resizeOpponent = (count: number) => {
    if (!Number.isInteger(count) || count < 1 || count > 30) return
    const slots = draft.opponentSlots.slice(0, count)
    while (slots.length < count) slots.push({ label: '', number: '', position: '' })
    setDraft({ ...draft, opponentSlots: slots })
  }

  const commit = () => {
    const baseball = sports.find(entry => entry.id === 'baseball')
    if (!baseball || !build.ok) return
    const created = createBaseballEventGameState({ sport: baseball, setup: build.setup, teamName, date })
    if (!created.ok) {
      setCommitError(created.message)
      return
    }
    const hasGame = Boolean(state.sport && (state.gameInfo || state.players.length > 0 || state.eventStream))
    if (hasGame && !prepareActiveGameMutation('new_game_commit')) return
    if (!startNewGame(baseball)) return
    dispatch({ type: 'HYDRATE_STATE', state: created.state })
    navigate('/game')
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-5 space-y-5">
      <h1 className="text-lg font-bold">New Baseball game</h1>
      <p className="rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">
        Development preview. The game saves on this device only.
      </p>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase text-content-muted">Game</h2>
        {cloudAvailable && (
          <label className="block text-sm font-medium text-content">
            Team
            <select className="input-field mt-1" value={teamId} onChange={event => chooseTeam(event.target.value)}>
              <option value="">No team (enter players here)</option>
              {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
        )}
        {teamsError && <p className="text-sm text-danger-content">Teams could not be loaded: {teamsError}</p>}
        <label className="block text-sm font-medium text-content">
          Team name
          <input className="input-field mt-1" maxLength={80} value={teamName} onChange={event => setTeamName(event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-content">
          Opponent
          <input className="input-field mt-1" maxLength={80} value={draft.opponentName}
            onChange={event => setDraft({ ...draft, opponentName: event.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-content">
            We are
            <select className="input-field mt-1" value={draft.trackedSide}
              onChange={event => setDraft({ ...draft, trackedSide: event.target.value as 'home' | 'away' })}>
              <option value="home">Home</option>
              <option value="away">Away</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-content">
            Date
            <input type="date" className="input-field mt-1" value={date} onChange={event => setDate(event.target.value)} />
          </label>
        </div>
      </section>

      {waitingForTeam ? (
        <p className="text-sm text-content-muted" aria-live="polite">
          {rosterStatus === 'error' ? `The roster could not be loaded: ${rosterError}` : 'Loading the team roster and defaults...'}
        </p>
      ) : (
        <>
          {defaultsNote && (
            <p className="rounded-md border border-info-line bg-info px-3 py-2 text-sm text-info-content">{defaultsNote}</p>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase text-content-muted">Rules</h2>
            <label className="block text-sm font-medium text-content">
              Profile
              <select className="input-field mt-1" value={draft.rules.profileId}
                onChange={event => {
                  setRulesError(null)
                  setDraft(setBaseballDraftRules(draft, createBaseballMatchRules(event.target.value as BaseballProfileId)))
                }}>
                {baseballRulesProfiles().map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-content">
                Innings
                <input type="number" min={1} max={15} className="input-field mt-1" value={draft.rules.scheduledInnings}
                  onChange={event => changeRules({ scheduledInnings: Number(event.target.value) })} />
              </label>
              <label className="block text-sm font-medium text-content">
                Batting order
                <select className="input-field mt-1" value={draft.rules.battingOrderFormat}
                  onChange={event => changeRules({ battingOrderFormat: event.target.value as BaseballBattingOrderFormat })}>
                  <option value="standard">Standard (nine bat)</option>
                  <option value="designated_hitter">Designated hitter</option>
                  <option value="extra_hitter">Extra hitters</option>
                  <option value="continuous">Continuous order</option>
                </select>
              </label>
            </div>
            {draft.rules.battingOrderFormat === 'extra_hitter' && (
              <label className="block text-sm font-medium text-content">
                Extra hitters allowed
                <input type="number" min={0} max={5} className="input-field mt-1" value={draft.rules.maxExtraHitters}
                  onChange={event => changeRules({ maxExtraHitters: Number(event.target.value) })} />
              </label>
            )}
            {rulesError && <p role="alert" className="text-sm text-danger-content">{rulesError}</p>}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-bold uppercase text-content-muted">Players</h2>
            {roster.length === 0 && <p className="text-sm text-content-muted">No players yet.</p>}
            <ul className="space-y-1">
              {roster.map(player => (
                <li key={player.playerId}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={draft.selectedPlayerIds.includes(player.playerId)}
                      onChange={event => setDraft(setBaseballPlayerSelected(draft, player.playerId, event.target.checked))} />
                    {nameOf(player.playerId)}
                    <span className="text-content-muted">· {baseballPositionLabel(player.position)}</span>
                  </label>
                  {draft.selectedPlayerIds.includes(player.playerId) && (
                    <div className="mt-1 flex flex-wrap items-center gap-3 pl-6 text-xs text-content-muted">
                      <span className="flex items-center gap-1">
                        Bats
                        <BaseballHandChoice compact legend={`${nameOf(player.playerId)} bats`} options={['L', 'R', 'S']}
                          value={draft.hands?.[player.playerId]?.bats ?? null}
                          onChange={bats => setDraft(setBaseballDraftHand(draft, player.playerId, { bats }))} />
                      </span>
                      <span className="flex items-center gap-1">
                        Throws
                        <BaseballHandChoice compact legend={`${nameOf(player.playerId)} throws`} options={['L', 'R']}
                          value={draft.hands?.[player.playerId]?.throws ?? null}
                          onChange={throws => setDraft(setBaseballDraftHand(draft, player.playerId, { throws: throws as BaseballPitchHand | null }))} />
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {!teamId && (
              <div className="rounded-md border border-line p-3 space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <input aria-label="Player name" placeholder="Name" className="input-field col-span-2" maxLength={80}
                    value={newPlayer.name} onChange={event => setNewPlayer({ ...newPlayer, name: event.target.value })} />
                  <input aria-label="Player number" placeholder="#" className="input-field" maxLength={10}
                    value={newPlayer.number} onChange={event => setNewPlayer({ ...newPlayer, number: event.target.value })} />
                </div>
                <BaseballPositionField value={newPlayer.position} onChange={position => setNewPlayer({ ...newPlayer, position })} />
                <button type="button" className="btn-secondary w-full" disabled={!newPlayer.name.trim()} onClick={addLocalPlayer}>
                  Add player
                </button>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-bold uppercase text-content-muted">Batting order</h2>
            <ol className="space-y-1">
              {draft.battingOrder.map((playerId, index) => (
                <li key={playerId} className="flex items-center gap-2 text-sm">
                  <span className="w-6 tabular-nums text-content-muted">{index + 1}.</span>
                  <span className="flex-1">{nameOf(playerId)}</span>
                  <button type="button" className="btn-secondary px-2 py-1" aria-label={`Move ${nameOf(playerId)} up`}
                    disabled={index === 0} onClick={() => moveBatter(index, -1)}>↑</button>
                  <button type="button" className="btn-secondary px-2 py-1" aria-label={`Move ${nameOf(playerId)} down`}
                    disabled={index === draft.battingOrder.length - 1} onClick={() => moveBatter(index, 1)}>↓</button>
                  <button type="button" className="btn-secondary px-2 py-1" aria-label={`Remove ${nameOf(playerId)} from the order`}
                    onClick={() => setDraft({ ...draft, battingOrder: draft.battingOrder.filter(id => id !== playerId) })}>✕</button>
                </li>
              ))}
            </ol>
            <select aria-label="Add a batter" className="input-field" value=""
              onChange={event => event.target.value && setDraft({ ...draft, battingOrder: [...draft.battingOrder, event.target.value] })}>
              <option value="">Add a batter...</option>
              {dressed.filter(player => !draft.battingOrder.includes(player.playerId)).map(player => (
                <option key={player.playerId} value={player.playerId}>{nameOf(player.playerId)}</option>
              ))}
            </select>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-bold uppercase text-content-muted">Defense</h2>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: draft.rules.defensivePlayers }, (_, index) => index + 1).map(number => (
                <label key={number} className="block text-sm font-medium text-content">
                  {number} · {baseballFieldingPositionCode(number)}
                  <select className="input-field mt-1" value={draft.defense[String(number)] ?? ''}
                    onChange={event => setDraft(setBaseballDraftFielder(draft, number, event.target.value))}>
                    <option value="">Not set</option>
                    {dressed.map(player => (
                      <option key={player.playerId} value={player.playerId}>{nameOf(player.playerId)}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-bold uppercase text-content-muted">Opponent lineup</h2>
            <label className="block text-sm font-medium text-content">
              Batting slots
              <input type="number" min={1} max={30} className="input-field mt-1" value={draft.opponentSlots.length}
                onChange={event => resizeOpponent(Number(event.target.value))} />
            </label>
            <p className="text-xs text-content-muted">Names, numbers and positions are optional.</p>
            <ol className="space-y-1">
              {draft.opponentSlots.map((slot, index) => {
                const update = (patch: Partial<typeof slot>) => setDraft({
                  ...draft,
                  opponentSlots: draft.opponentSlots.map((entry, at) => at === index ? { ...entry, ...patch } : entry),
                })
                return (
                  <li key={index} className="grid grid-cols-[1.5rem_1fr_3.5rem_3.5rem_3.5rem] items-center gap-2 text-sm">
                    <span className="tabular-nums text-content-muted">{index + 1}.</span>
                    <input aria-label={`Opponent batter ${index + 1} name`} placeholder={`Batter ${index + 1}`} className="input-field"
                      maxLength={80} value={slot.label} onChange={event => update({ label: event.target.value })} />
                    <input aria-label={`Opponent batter ${index + 1} number`} placeholder="#" className="input-field"
                      maxLength={10} value={slot.number} onChange={event => update({ number: event.target.value })} />
                    <input aria-label={`Opponent batter ${index + 1} position`} placeholder="Pos" className="input-field"
                      maxLength={80} value={slot.position} onChange={event => update({ position: event.target.value })} />
                    <select aria-label={`Opponent batter ${index + 1} bats`} className="input-field px-1" value={slot.bats ?? ''}
                      onChange={event => update({ bats: (event.target.value || null) as BaseballBatHand | null })}>
                      <option value="">Bats</option>
                      <option value="L">L</option>
                      <option value="R">R</option>
                      <option value="S">S</option>
                    </select>
                  </li>
                )
              })}
            </ol>
            <div className="grid grid-cols-[1fr_4rem_4.5rem] gap-2">
              <input aria-label="Opponent pitcher name" placeholder="Starting pitcher" className="input-field" maxLength={80}
                value={draft.opponentPitcher.label}
                onChange={event => setDraft({ ...draft, opponentPitcher: { ...draft.opponentPitcher, label: event.target.value } })} />
              <input aria-label="Opponent pitcher number" placeholder="#" className="input-field" maxLength={10}
                value={draft.opponentPitcher.number}
                onChange={event => setDraft({ ...draft, opponentPitcher: { ...draft.opponentPitcher, number: event.target.value } })} />
              <select aria-label="Opponent pitcher throws" className="input-field px-1" value={draft.opponentPitcher.throws ?? ''}
                onChange={event => setDraft({ ...draft, opponentPitcher: { ...draft.opponentPitcher, throws: (event.target.value || null) as BaseballPitchHand | null } })}>
                <option value="">Throws</option>
                <option value="L">L</option>
                <option value="R">R</option>
              </select>
            </div>
          </section>

          {!build.ok && (
            <p className="rounded-md border border-info-line bg-info px-3 py-2 text-sm text-info-content" aria-live="polite">
              {build.message}
            </p>
          )}
          {commitError && (
            <p role="alert" className="rounded-md border border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
              {commitError}
            </p>
          )}
          <button type="button" className="btn-primary w-full" disabled={!build.ok} onClick={commit}>
            Continue to game
          </button>
        </>
      )}
    </main>
  )
}
