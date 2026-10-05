import { RefreshCw, Save } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSportTeamSettings, type SportTeamSettingsStatus } from '../../hooks/useSportTeamSettings'
import {
  HOCKEY_MAX_DEFAULT_STARTERS,
  hockeyDefaultRole,
  pruneHockeyLineupDefaults,
  setHockeyDefaultRole,
  staleHockeyLineupPlayerIds,
  type HockeyDefaultRole,
} from '../../lib/hockey/lineupDefaults'
import { hockeySettingsFingerprint, hockeySettingsRules, type HockeyTeamSettingsV1 } from '../../lib/hockey/settings'
import { hockeyTeamSettingsAdapter } from '../../lib/hockey/settingsSync'
import HockeyRulesFields from './HockeyRulesFields'

const ROLE_LABELS: Record<HockeyDefaultRole, string> = {
  bench: 'Bench',
  starter: 'Starter',
  starting_goalie: 'Starting goalie',
  backup_goalie: 'Backup goalie',
}

/**
 * Team Manage Hockey defaults (HKY-5C): rules plus Starter/Bench and goalie defaults.
 * Owners and admins edit; scorers and viewers review read-only. New games copy these
 * once; existing games never change.
 */
export default function HockeyTeamSettingsPanel({
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
  const team = useSportTeamSettings(hockeyTeamSettingsAdapter, teamId)
  const [draft, setDraft] = useState<HockeyTeamSettingsV1>(() => structuredClone(team.settings))
  const [baseRevision, setBaseRevision] = useState(team.revision)
  const previousSaved = useRef(hockeySettingsFingerprint(team.settings))
  const dirty = hockeySettingsFingerprint(draft) !== hockeySettingsFingerprint(team.settings)
  const writable = mayEdit && (team.status === 'synced' || team.status === 'missing')
  const activeIds = useMemo(() => new Set(roster.map(player => player.id.toLowerCase())), [roster])
  const stale = rosterReady ? staleHockeyLineupPlayerIds(draft.lineupDefaults, activeIds) : []
  const rulesValid = hockeySettingsRules(draft) !== null
  const lineup = draft.lineupDefaults
  const starterCount = lineup.starterPlayerIds.length

  // Adopt newly loaded or saved settings unless there are unsaved edits.
  useEffect(() => {
    const next = hockeySettingsFingerprint(team.settings)
    const current = hockeySettingsFingerprint(draft)
    if (current === previousSaved.current || current === next) {
      if (current !== next) setDraft(structuredClone(team.settings))
      setBaseRevision(team.revision)
    }
    previousSaved.current = next
  }, [draft, team.revision, team.settings])

  const save = async () => {
    if (!writable || !rulesValid || stale.length > 0) return
    if (await team.save(draft, baseRevision)) onAuditChange()
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-content">Hockey Defaults</h2>
          <p className="text-xs text-content-muted">
            Shared by {teamName}. New Hockey games copy these; existing games never change.
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
        <HockeyRulesFields idPrefix={`hockey-team-${teamId}`} settings={draft} disabled={!writable} onChange={setDraft} />
      </fieldset>

      <fieldset disabled={!writable || !rosterReady} className="space-y-3 border-b border-line pb-3">
        <legend className="font-semibold text-content">Default lineup</legend>
        {!rosterReady && <p role="status" className="text-sm text-content-muted">Loading roster...</p>}
        <p className="text-xs text-content-muted">
          Players without a role start on the bench. Nothing is filled in from positions, jersey numbers or roster order.
        </p>
        <p className="text-sm font-medium text-content" aria-live="polite">
          Starters {starterCount} of {HOCKEY_MAX_DEFAULT_STARTERS} · Starting goalie {lineup.startingGoaliePlayerId ? 'set' : 'not set'}
        </p>
        {rosterReady && roster.length === 0 && (
          <p className="text-sm text-content-muted">This team has no active players yet.</p>
        )}
        <ul className="divide-y divide-line">
          {roster.map(player => {
            const id = player.id.toLowerCase()
            const role = hockeyDefaultRole(lineup, id)
            return (
              <li key={player.id} className="flex min-h-11 items-center gap-2 py-1 text-sm">
                <span className="min-w-0 flex-1 break-words text-content">{player.label}</span>
                <select
                  aria-label={`Default role for ${player.label}`}
                  className="input-field w-40 shrink-0"
                  value={role}
                  onChange={event => setDraft(current => ({
                    ...current,
                    lineupDefaults: setHockeyDefaultRole(current.lineupDefaults, id, event.target.value as HockeyDefaultRole),
                  }))}
                >
                  {(Object.keys(ROLE_LABELS) as HockeyDefaultRole[]).map(value => (
                    <option
                      key={value}
                      value={value}
                      disabled={value === 'starter' && role !== 'starter' && starterCount >= HOCKEY_MAX_DEFAULT_STARTERS}
                    >
                      {ROLE_LABELS[value]}
                    </option>
                  ))}
                </select>
              </li>
            )
          })}
        </ul>
        {stale.length > 0 && (
          <div role="status" className="space-y-2 rounded-md border border-warning-line bg-warning p-3 text-sm text-warning-content">
            <p>{stale.length === 1 ? 'One player in the default lineup is' : `${stale.length} players in the default lineup are`} no longer on the active roster. Remove them before saving.</p>
            <button type="button" className="btn-secondary w-full text-sm"
              onClick={() => setDraft(current => ({ ...current, lineupDefaults: pruneHockeyLineupDefaults(current.lineupDefaults, activeIds) }))}>
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
            disabled={!dirty || !writable || team.status === 'saving' || !rulesValid || stale.length > 0}
            onClick={() => void save()}>
            {team.status === 'saving' ? <RefreshCw size={17} className="animate-spin" /> : <Save size={17} />}
            Save Shared Defaults
          </button>
        </div>
      )}
    </section>
  )
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
