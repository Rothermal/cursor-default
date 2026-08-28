import { ArrowRight, Check, RefreshCw, Save, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useBasketballTeamSettings } from '../../hooks/useBasketballTeamSettings'
import { resolveBasketballRules } from '../../lib/basketball/profiles'
import {
  BASKETBALL_V3_COMPATIBILITY_WARNING,
  basketballSettingsRequireVersion3Confirmation,
  type BasketballTeamSettingsV1,
} from '../../lib/basketball/settings'
import { basketballTeamSettingsFingerprint } from '../../lib/basketball/teamSettingsSync'
import { settingsPath } from '../../lib/settingsNavigation'
import BasketballLegacySeasonImport from './BasketballLegacySeasonImport'
import BasketballRulesSettingsFields from './BasketballRulesSettingsFields'
import ConfirmDialog from '../ConfirmDialog'

export default function BasketballTeamSettingsPanel({
  teamId,
  teamName,
  seasonId,
  seasonName,
  mayEdit,
  onAuditChange,
}: {
  teamId: string
  teamName: string
  seasonId: string
  seasonName: string
  mayEdit: boolean
  onAuditChange: () => void
}) {
  const navigate = useNavigate()
  const team = useBasketballTeamSettings(teamId)
  const [draft, setDraft] = useState<BasketballTeamSettingsV1>(() =>
    structuredClone(team.settings)
  )
  const [baseRevision, setBaseRevision] = useState(team.revision)
  const [editorOpen, setEditorOpen] = useState(!mayEdit)
  const [confirmV3Save, setConfirmV3Save] = useState(false)
  const previousSavedFingerprint = useRef(
    basketballTeamSettingsFingerprint(team.settings)
  )
  const dirty = basketballTeamSettingsFingerprint(draft) !==
    basketballTeamSettingsFingerprint(team.settings)
  const sharedWritable = mayEdit &&
    (team.status === 'synced' || team.status === 'missing')
  const resolved = useMemo(() => resolveBasketballRules(
    draft.baseProfile,
    [{ id: 'team', overrides: draft.ruleOverrides }]
  ), [draft.baseProfile, draft.ruleOverrides])

  useEffect(() => {
    const previous = previousSavedFingerprint.current
    const next = basketballTeamSettingsFingerprint(team.settings)
    const current = basketballTeamSettingsFingerprint(draft)
    if (current === previous || current === next) {
      if (current !== next) setDraft(structuredClone(team.settings))
      setBaseRevision(team.revision)
    }
    previousSavedFingerprint.current = next
  }, [draft, team.revision, team.settings])

  const handleSave = async () => {
    if (!mayEdit || !resolved.ok) return
    if (await team.save(draft, baseRevision)) onAuditChange()
  }

  const requestSave = () => {
    if (!mayEdit || !resolved.ok) return
    if (basketballSettingsRequireVersion3Confirmation(draft)) {
      setConfirmV3Save(true)
      return
    }
    void handleSave()
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-800">Basketball Rules</h2>
          <p className="text-xs text-slate-500">
            Shared by {teamName}. These defaults do not inherit from a recorder's personal rules.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void team.refresh()}
          disabled={team.status === 'loading' || team.status === 'saving'}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-600 disabled:opacity-40"
          title="Refresh shared defaults"
          aria-label="Refresh shared defaults"
        >
          <RefreshCw
            size={17}
            className={team.status === 'loading' ? 'animate-spin' : ''}
          />
        </button>
      </div>

      <div
        className="flex flex-wrap items-center gap-2 text-xs text-slate-500"
        aria-live="polite"
      >
        <span>{statusLabel(team.status)}</span>
        {dirty && <span className="font-semibold text-amber-700">Unsaved changes</span>}
        {!mayEdit && <span className="font-semibold text-slate-600">Read only</span>}
      </div>

      {team.error && (
        <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {team.error}
        </p>
      )}

      {team.conflict && (
        <div role="alert" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">
            Another manager changed these defaults.
          </p>
          <button
            type="button"
            onClick={() => {
              const cloud = team.conflict
              team.useCloud()
              if (cloud) setDraft(structuredClone(cloud))
            }}
            className="btn-secondary w-full text-sm"
          >
            Reload Shared Version
          </button>
        </div>
      )}

      <div className="space-y-2 border-y border-blue-100 bg-blue-50 px-3 py-3 text-sm">
        <p className="font-semibold text-blue-900">Which rules apply?</p>
        <p className="text-blue-800">
          These team defaults apply when setting up Basketball event-model games. Current legacy
          games continue to use the team foul, timeout, and bonus rules configured for the team's
          season.
        </p>
        <Link
          to={settingsPath('data')}
          className="inline-flex min-h-10 items-center gap-2 font-semibold text-blue-700"
        >
          Open Seasons
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>

      <button
        type="button"
        onClick={() => navigate('/settings/sports/basketball')}
        className="inline-flex h-9 items-center gap-2 text-sm font-semibold text-blue-700"
      >
        <Settings2 size={16} />
        Personal Basketball defaults
      </button>

      {mayEdit && (
        <button
          type="button"
          onClick={() => setEditorOpen(open => !open)}
          className="btn-secondary w-full"
          aria-expanded={editorOpen}
        >
          {editorOpen ? 'Close Rules Editor' : 'Open Rules Editor'}
        </button>
      )}

      {editorOpen && (
        <>
          {team.status === 'missing' && (
            <p className="border-y border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              No team defaults are saved. This preview uses the application default profile.
            </p>
          )}
          <BasketballRulesSettingsFields
            settings={draft}
            layerId="team"
            profileSourceLabel={
              dirty
                ? 'Unsaved team profile'
                : team.revision === null
                  ? 'Application default'
                  : 'Team profile'
            }
            overrideSourceLabel={dirty ? 'Unsaved team override' : 'Team override'}
            readOnly={!sharedWritable}
            onChange={setDraft}
          />
          {mayEdit && (
            <BasketballLegacySeasonImport
              seasonId={seasonId}
              seasonName={seasonName}
              disabled={!sharedWritable}
              onApply={setDraft}
            />
          )}
        </>
      )}

      {editorOpen && mayEdit && (
        <div className="sticky bottom-0 -mx-4 grid grid-cols-1 gap-2 border-t border-slate-200 bg-white/95 p-4 backdrop-blur sm:grid-cols-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={!dirty}
            onClick={() => {
              setDraft(structuredClone(team.settings))
              setBaseRevision(team.revision)
            }}
          >
            Discard
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center justify-center gap-2"
            disabled={!dirty || !sharedWritable || team.status === 'saving' || !resolved.ok}
            onClick={requestSave}
          >
            {team.status === 'saving' ? (
              <RefreshCw size={17} className="animate-spin" />
            ) : team.status === 'synced' && !dirty ? (
              <Check size={17} />
            ) : (
              <Save size={17} />
            )}
            Save Shared Defaults
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmV3Save}
        title="Save Version-3 Team Defaults?"
        message={BASKETBALL_V3_COMPATIBILITY_WARNING}
        confirmLabel="Save Version 3"
        cancelLabel="Keep Editing"
        destructive={false}
        onConfirm={() => {
          setConfirmV3Save(false)
          void handleSave()
        }}
        onCancel={() => setConfirmV3Save(false)}
      />
    </section>
  )
}

function statusLabel(status: ReturnType<typeof useBasketballTeamSettings>['status']): string {
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
