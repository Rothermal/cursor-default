import { ArrowDown, ArrowUp, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSportTeamSettings, type SportTeamSettingsStatus } from '../../hooks/useSportTeamSettings'
import { BASEBALL_FIELDING_POSITIONS } from '../../lib/baseball/positions'
import { baseballRulesProfiles } from '../../lib/baseball/profiles'
import {
  BASEBALL_MAX_DEFAULT_BATTING_ORDER,
  baseballTeamSettingsFingerprint,
  pruneBaseballLineupDefaults,
  resolveBaseballTeamRules,
  staleBaseballLineupPlayerIds,
  type BaseballTeamRuleOverrides,
  type BaseballTeamSettingsV1,
} from '../../lib/baseball/settings'
import { baseballTeamSettingsAdapter } from '../../lib/baseball/teamSettingsSync'
import type { BaseballBattingOrderFormat, BaseballProfileId } from '../../lib/baseball/types'

const FORMAT_LABELS: Record<BaseballBattingOrderFormat, string> = {
  standard: 'Standard (nine batters)',
  designated_hitter: 'Designated hitter allowed',
  extra_hitter: 'Extra hitters',
  continuous: 'Continuous batting order',
}

export default function BaseballTeamSettingsPanel({
  teamId,
  teamName,
  mayEdit,
  roster,
  rosterReady,
  onAuditChange,
}: {
  teamId: string
  teamName: string
  mayEdit: boolean
  roster: Array<{ id: string; label: string }>
  rosterReady: boolean
  onAuditChange: () => void
}) {
  const team = useSportTeamSettings(baseballTeamSettingsAdapter, teamId)
  const [draft, setDraft] = useState<BaseballTeamSettingsV1>(() => structuredClone(team.settings))
  const [baseRevision, setBaseRevision] = useState(team.revision)
  const previousSaved = useRef(baseballTeamSettingsFingerprint(team.settings))
  const dirty = baseballTeamSettingsFingerprint(draft) !== baseballTeamSettingsFingerprint(team.settings)
  const writable = mayEdit && (team.status === 'synced' || team.status === 'missing')
  const resolved = useMemo(() => resolveBaseballTeamRules(draft), [draft])
  const activeIds = useMemo(() => new Set(roster.map(player => player.id)), [roster])
  const stale = rosterReady ? staleBaseballLineupPlayerIds(draft.lineupDefaults, activeIds) : []
  const labelFor = (id: string) => roster.find(player => player.id === id)?.label ?? 'Unavailable player'
  const defensivePlayers = resolved.ok ? resolved.rules.defensivePlayers : 9

  // Adopt newly loaded or saved settings unless the recorder has unsaved edits.
  useEffect(() => {
    const next = baseballTeamSettingsFingerprint(team.settings)
    const current = baseballTeamSettingsFingerprint(draft)
    if (current === previousSaved.current || current === next) {
      if (current !== next) setDraft(structuredClone(team.settings))
      setBaseRevision(team.revision)
    }
    previousSaved.current = next
  }, [draft, team.revision, team.settings])

  const setOverrides = (patch: BaseballTeamRuleOverrides, remove: Array<keyof BaseballTeamRuleOverrides> = []) =>
    setDraft(current => {
      const ruleOverrides = { ...current.ruleOverrides, ...patch }
      for (const key of remove) delete ruleOverrides[key]
      return { ...current, ruleOverrides }
    })

  const setBattingOrder = (battingOrder: string[]) =>
    setDraft(current => ({ ...current, lineupDefaults: { ...current.lineupDefaults, battingOrder } }))

  const setFielder = (position: number, playerId: string) =>
    setDraft(current => {
      const defense = Object.fromEntries(
        Object.entries(current.lineupDefaults.defense).filter(([key, id]) => key !== String(position) && id !== playerId)
      )
      if (playerId) defense[String(position)] = playerId
      const ordered = Object.fromEntries(Object.entries(defense).sort(([a], [b]) => Number(a) - Number(b)))
      return { ...current, lineupDefaults: { ...current.lineupDefaults, defense: ordered } }
    })

  const save = async () => {
    if (!writable || !resolved.ok || stale.length > 0) return
    if (await team.save(draft, baseRevision)) onAuditChange()
  }

  const order = draft.lineupDefaults.battingOrder
  const unusedBatters = roster.filter(player => !order.includes(player.id))

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-content">Baseball Defaults</h2>
          <p className="text-xs text-content-muted">
            Shared by {teamName}. New Baseball games copy these; existing games never change.
          </p>
        </div>
        <button type="button" onClick={() => void team.refresh()}
          disabled={team.status === 'loading' || team.status === 'saving'}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line text-content-muted disabled:bg-control-disabled disabled:text-content-disabled"
          title="Refresh shared defaults" aria-label="Refresh shared defaults">
          <RefreshCw size={17} className={team.status === 'loading' ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-content-muted" aria-live="polite">
        <span>{statusLabel(team.status)}</span>
        {dirty && <span className="font-semibold text-warning-content">Unsaved changes</span>}
        {!mayEdit && <span className="font-semibold text-content-muted">Read only</span>}
      </div>

      {team.error && <p role="alert" className="rounded-md border border-warning-line bg-warning px-3 py-2 text-sm text-warning-content">{team.error}</p>}

      {team.conflict && (
        <div role="alert" className="space-y-2 rounded-md border border-warning-line bg-warning p-3">
          <p className="text-sm font-semibold text-warning-content">Another manager changed these defaults.</p>
          <button type="button" className="btn-secondary w-full text-sm" onClick={() => {
            const cloud = team.conflict
            team.useCloud()
            if (cloud) setDraft(structuredClone(cloud))
          }}>Reload Shared Version</button>
        </div>
      )}

      <fieldset disabled={!writable} className="space-y-3 border-y border-line py-3">
        <legend className="font-semibold text-content">Rules</legend>
        <label className="block space-y-1 text-sm text-content">
          <span className="font-medium">Rules profile</span>
          <select className="input-field w-full" value={draft.baseProfile.profileId}
            onChange={event => setDraft(current => ({
              ...current,
              baseProfile: { profileId: event.target.value as BaseballProfileId, profileVersion: 1 },
            }))}>
            {baseballRulesProfiles().map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
          </select>
        </label>
        <p className="text-xs text-content-muted">
          {baseballRulesProfiles().find(profile => profile.id === draft.baseProfile.profileId)?.description}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm text-content">
            <span className="font-medium">Innings</span>
            <input type="number" min={1} max={15} className="input-field w-full"
              value={resolved.ok ? resolved.rules.scheduledInnings : draft.ruleOverrides.scheduledInnings ?? ''}
              onChange={event => {
                const value = Number(event.target.value)
                if (Number.isInteger(value) && value >= 1 && value <= 15) setOverrides({ scheduledInnings: value })
              }} />
          </label>
          <label className="block space-y-1 text-sm text-content">
            <span className="font-medium">Batting order</span>
            <select className="input-field w-full"
              value={resolved.ok ? resolved.rules.battingOrderFormat : draft.ruleOverrides.battingOrderFormat ?? 'standard'}
              onChange={event => setOverrides({ battingOrderFormat: event.target.value as BaseballBattingOrderFormat })}>
              {Object.entries(FORMAT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {resolved.ok && resolved.rules.battingOrderFormat === 'extra_hitter' && (
            <label className="block space-y-1 text-sm text-content">
              <span className="font-medium">Extra hitters</span>
              <input type="number" min={0} max={5} className="input-field w-full" value={resolved.rules.maxExtraHitters}
                onChange={event => {
                  const value = Number(event.target.value)
                  if (Number.isInteger(value) && value >= 0 && value <= 5) setOverrides({ maxExtraHitters: value })
                }} />
            </label>
          )}
          <label className="block space-y-1 text-sm text-content">
            <span className="font-medium">Pitch count limit</span>
            <input type="number" min={1} max={500} className="input-field w-full" placeholder="None"
              value={resolved.ok ? resolved.rules.pitchCountLimit ?? '' : ''}
              onChange={event => {
                if (event.target.value === '') return setOverrides({ pitchCountLimit: null })
                const value = Number(event.target.value)
                if (Number.isInteger(value) && value >= 1 && value <= 500) setOverrides({ pitchCountLimit: value })
              }} />
          </label>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-content">Run rules</p>
          {(resolved.ok ? resolved.rules.runRules : []).map((rule, index, rules) => (
            <div key={index} className="flex flex-wrap items-center gap-2 text-sm text-content">
              <span>Lead of</span>
              <input type="number" min={1} max={100} aria-label={`Run rule ${index + 1} lead`} className="input-field w-20"
                value={rule.lead} onChange={event => {
                  const lead = Number(event.target.value)
                  if (Number.isInteger(lead) && lead >= 1) setOverrides({ runRules: rules.map((entry, i) => i === index ? { ...entry, lead } : entry) })
                }} />
              <span>after inning</span>
              <input type="number" min={1} max={15} aria-label={`Run rule ${index + 1} inning`} className="input-field w-20"
                value={rule.afterInning} onChange={event => {
                  const afterInning = Number(event.target.value)
                  if (Number.isInteger(afterInning) && afterInning >= 1) setOverrides({ runRules: rules.map((entry, i) => i === index ? { ...entry, afterInning } : entry) })
                }} />
              <button type="button" className="grid h-9 w-9 place-items-center rounded-md border border-line text-content-muted"
                aria-label={`Remove run rule ${index + 1}`}
                onClick={() => setOverrides({ runRules: rules.filter((_, i) => i !== index) })}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {resolved.ok && resolved.rules.runRules.length < 5 && (
            <button type="button" className="inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-info-content"
              onClick={() => setOverrides({ runRules: [...resolved.rules.runRules, { afterInning: 4, lead: 10 }] })}>
              <Plus size={16} /> Add run rule
            </button>
          )}
        </div>
        {!resolved.ok && <p role="alert" className="text-sm text-warning-content">{resolved.error}</p>}
        {Object.keys(draft.ruleOverrides).length > 0 && (
          <button type="button" className="text-sm font-semibold text-info-content"
            onClick={() => setDraft(current => ({ ...current, ruleOverrides: {} }))}>
            Use profile rules
          </button>
        )}
      </fieldset>

      <fieldset disabled={!writable || !rosterReady} className="space-y-3 border-b border-line pb-3">
        <legend className="font-semibold text-content">Default lineup</legend>
        {!rosterReady && <p role="status" className="text-sm text-content-muted">Loading roster...</p>}
        <p className="text-xs text-content-muted">
          Players not listed start on the bench. Nothing is filled in from jersey numbers or roster order.
        </p>
        <ol className="space-y-1">
          {order.map((id, index) => (
            <li key={id} className="flex min-h-10 items-center gap-2 border-b border-line py-1 text-sm">
              <span className="w-6 shrink-0 text-right font-semibold text-content-muted">{index + 1}</span>
              <span className={`min-w-0 flex-1 break-words ${activeIds.has(id) ? 'text-content' : 'text-warning-content'}`}>{labelFor(id)}</span>
              <button type="button" aria-label={`Move ${labelFor(id)} up`} disabled={index === 0}
                className="grid h-9 w-9 place-items-center rounded-md border border-line text-content-muted disabled:text-content-disabled"
                onClick={() => setBattingOrder(swap(order, index, index - 1))}><ArrowUp size={16} /></button>
              <button type="button" aria-label={`Move ${labelFor(id)} down`} disabled={index === order.length - 1}
                className="grid h-9 w-9 place-items-center rounded-md border border-line text-content-muted disabled:text-content-disabled"
                onClick={() => setBattingOrder(swap(order, index, index + 1))}><ArrowDown size={16} /></button>
              <button type="button" aria-label={`Remove ${labelFor(id)} from the batting order`}
                className="grid h-9 w-9 place-items-center rounded-md border border-line text-content-muted"
                onClick={() => setBattingOrder(order.filter(value => value !== id))}><Trash2 size={16} /></button>
            </li>
          ))}
        </ol>
        {rosterReady && unusedBatters.length > 0 && order.length < BASEBALL_MAX_DEFAULT_BATTING_ORDER && (
          <label className="block space-y-1 text-sm text-content">
            <span className="font-medium">Add batter</span>
            <select className="input-field w-full" value="" onChange={event => {
              if (event.target.value) setBattingOrder([...order, event.target.value])
            }}>
              <option value="">Choose a player</option>
              {unusedBatters.map(player => <option key={player.id} value={player.id}>{player.label}</option>)}
            </select>
          </label>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {BASEBALL_FIELDING_POSITIONS.filter(position => position.number <= defensivePlayers).map(position => {
            const current = draft.lineupDefaults.defense[String(position.number)] ?? ''
            return (
              <label key={position.code} className="block space-y-1 text-sm text-content">
                <span className="font-medium">{position.code} · {position.label}</span>
                <select className="input-field w-full" value={current}
                  onChange={event => setFielder(position.number, event.target.value)}>
                  <option value="">Not set</option>
                  {current && !activeIds.has(current) && <option value={current}>Unavailable player</option>}
                  {roster.map(player => <option key={player.id} value={player.id}>{player.label}</option>)}
                </select>
              </label>
            )
          })}
        </div>
        {stale.length > 0 && (
          <div role="status" className="space-y-2 rounded-md border border-warning-line bg-warning p-3 text-sm text-warning-content">
            <p>{stale.length === 1 ? 'One player in the default lineup is' : `${stale.length} players in the default lineup are`} no longer on the active roster. Remove them before saving.</p>
            <button type="button" className="btn-secondary w-full text-sm"
              onClick={() => setDraft(current => ({ ...current, lineupDefaults: pruneBaseballLineupDefaults(current.lineupDefaults, activeIds) }))}>
              Remove unavailable players
            </button>
          </div>
        )}
      </fieldset>

      {mayEdit && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button type="button" className="btn-secondary" disabled={!dirty}
            onClick={() => { setDraft(structuredClone(team.settings)); setBaseRevision(team.revision) }}>
            Discard
          </button>
          <button type="button" className="btn-primary inline-flex items-center justify-center gap-2"
            disabled={!dirty || !writable || team.status === 'saving' || !resolved.ok || stale.length > 0}
            onClick={() => void save()}>
            {team.status === 'saving' ? <RefreshCw size={17} className="animate-spin" /> : <Save size={17} />}
            Save Shared Defaults
          </button>
        </div>
      )}
    </section>
  )
}

function swap(values: string[], from: number, to: number): string[] {
  const next = [...values]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

function statusLabel(status: SportTeamSettingsStatus): string {
  switch (status) {
    case 'loading': return 'Loading shared defaults'
    case 'saving': return 'Saving shared defaults'
    case 'synced': return 'Shared defaults synced'
    case 'cached': return 'Showing last synced defaults'
    case 'missing': return 'Using application defaults'
    case 'conflict': return 'Shared settings conflict'
    case 'backend_update_required': return 'Backend update required'
    case 'error': return 'Shared defaults unavailable'
    default: return 'Shared defaults not loaded'
  }
}
