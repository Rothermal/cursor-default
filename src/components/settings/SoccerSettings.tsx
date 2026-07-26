import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Cloud, RefreshCw, RotateCcw, Save } from 'lucide-react'
import { useSettings } from '../../context/SettingsContext'
import {
  configurableSoccerRulesFromMatchRules,
  type SoccerConfigurableRules,
} from '../../lib/soccer/rules'
import {
  detectRegulationPreset,
  detectSoccerCompetitionProfile,
  regulationSegmentsForPreset,
  resizeSoccerSegments,
  soccerRulesForCompetitionProfile,
  type SoccerCompetitionProfile,
  type SoccerRegulationPreset,
} from '../../lib/soccer/setupRules'
import {
  DEFAULT_SOCCER_PERSONAL_SETTINGS,
  resolveSoccerSettingsHierarchy,
  type SoccerPersonalSettings,
} from '../../lib/soccer/settings'
import { soccerSettingsFingerprint } from '../../lib/soccer/personalSettingsSync'
import type { SoccerMatchSegment } from '../../lib/soccer/types'

type SettingsSection = 'common' | 'match' | 'discipline' | 'substitutions' | 'advanced'

const sections: Array<{ id: SettingsSection; label: string }> = [
  { id: 'common', label: 'Common' },
  { id: 'match', label: 'Match Format' },
  { id: 'discipline', label: 'Discipline' },
  { id: 'substitutions', label: 'Substitutions' },
  { id: 'advanced', label: 'Advanced' },
]

export default function SoccerSettings() {
  const {
    soccerSettings,
    soccerSettingsSync,
    saveSoccerSettings,
    refreshSoccerSettings,
    useCloudSoccerSettings,
    keepDeviceSoccerSettings,
    setSoccerSettingsPageActive,
  } = useSettings()
  const [draft, setDraft] = useState<SoccerPersonalSettings>(() =>
    structuredClone(soccerSettings)
  )
  const [draftBaseRevision, setDraftBaseRevision] = useState(
    soccerSettingsSync.revision
  )
  const previousSavedFingerprint = useRef(soccerSettingsFingerprint(soccerSettings))
  const [activeSection, setActiveSection] = useState<SettingsSection>('common')
  const dirty = useMemo(
    () => soccerSettingsFingerprint(draft) !== soccerSettingsFingerprint(soccerSettings),
    [draft, soccerSettings]
  )
  const effective = useMemo(
    () => resolveSoccerSettingsHierarchy({ personalDefaults: draft.rules }).rules,
    [draft.rules]
  )
  const competitionProfile = detectSoccerCompetitionProfile(effective)
  const regulationPreset = detectRegulationPreset(effective)

  useEffect(() => {
    setSoccerSettingsPageActive(true)
    return () => setSoccerSettingsPageActive(false)
  }, [setSoccerSettingsPageActive])

  useEffect(() => {
    const previous = previousSavedFingerprint.current
    const next = soccerSettingsFingerprint(soccerSettings)
    const current = soccerSettingsFingerprint(draft)
    if (current === previous || current === next) {
      if (current !== next) setDraft(structuredClone(soccerSettings))
      setDraftBaseRevision(soccerSettingsSync.revision)
    }
    previousSavedFingerprint.current = next
  }, [draft, soccerSettings, soccerSettingsSync.revision])

  const updateRules = (update: (rules: SoccerConfigurableRules) => SoccerConfigurableRules) => {
    setDraft(current => ({
      ...current,
      rules: update(current.rules),
    }))
  }

  const resetSection = () => {
    const defaults = DEFAULT_SOCCER_PERSONAL_SETTINGS
    setDraft(current => {
      const next = structuredClone(current)
      if (activeSection === 'common') {
        next.rules.clockDirection = defaults.rules.clockDirection
        next.rules.clockDisplay = defaults.rules.clockDisplay
        next.rules.maxOnFieldPlayers = defaults.rules.maxOnFieldPlayers
        next.display = structuredClone(defaults.display)
      } else if (activeSection === 'match') {
        next.rules.regulationSegments = structuredClone(defaults.rules.regulationSegments)
        next.rules.extraTimeSegments = structuredClone(defaults.rules.extraTimeSegments)
        next.rules.tieResolution = defaults.rules.tieResolution
      } else if (activeSection === 'discipline') {
        next.rules.yellowCardExitPolicy = defaults.rules.yellowCardExitPolicy
        next.rules.redCardReplacementPolicy = defaults.rules.redCardReplacementPolicy
      } else if (activeSection === 'substitutions') {
        next.rules.allowReturnSubstitutions = defaults.rules.allowReturnSubstitutions
        next.rules.substitutionLimit = defaults.rules.substitutionLimit
        next.rules.substitutionWindowLimit = defaults.rules.substitutionWindowLimit
      } else {
        next.rules.maxAssistsPerGoal = defaults.rules.maxAssistsPerGoal
        next.rules.shootoutInitialKicksPerSide =
          defaults.rules.shootoutInitialKicksPerSide
        next.rules.allowUnusedGoalkeeperShootoutReplacement =
          defaults.rules.allowUnusedGoalkeeperShootoutReplacement
      }
      return next
    })
  }

  const applyCompetitionProfile = (profile: SoccerCompetitionProfile) => {
    if (profile === 'custom') return
    setDraft(current => ({
      ...current,
      rules: configurableSoccerRulesFromMatchRules(
        soccerRulesForCompetitionProfile(profile)
      ),
    }))
  }

  const applyRegulationPreset = (preset: SoccerRegulationPreset) => {
    if (preset === 'custom') return
    updateRules(rules => ({
      ...normalizeRules({
        ...rules,
        regulationSegments: regulationSegmentsForPreset(preset),
      }),
    }))
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Soccer</h2>
          <div className="flex items-center gap-2">
            <SyncStatus status={soccerSettingsSync.status} />
            {dirty && <span className="text-xs font-semibold text-amber-700">Unsaved changes</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refreshSoccerSettings()}
          disabled={soccerSettingsSync.status === 'checking' || soccerSettingsSync.status === 'saving'}
          className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-slate-200 text-slate-600 disabled:opacity-40"
          title="Refresh cloud settings"
          aria-label="Refresh cloud settings"
        >
          <RefreshCw size={17} className={soccerSettingsSync.status === 'checking' ? 'animate-spin' : ''} />
        </button>
      </div>

      {soccerSettingsSync.error && (
        <p className={`rounded-md border px-3 py-2 text-sm ${
          soccerSettingsSync.status === 'backend_update_required'
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {soccerSettingsSync.error}
        </p>
      )}

      {soccerSettingsSync.conflict && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-3">
          <p className="text-sm font-semibold text-amber-900">Settings changed on another device.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary text-sm px-3" onClick={useCloudSoccerSettings}>
              Use Cloud
            </button>
            <button type="button" className="btn-primary text-sm px-3" onClick={() => void keepDeviceSoccerSettings()}>
              Keep This Device
            </button>
          </div>
        </div>
      )}

      <label className="block text-sm font-medium text-slate-700">
        Starting profile
        <select
          value={competitionProfile}
          onChange={event => applyCompetitionProfile(event.target.value as SoccerCompetitionProfile)}
          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-slate-900"
        >
          <option value="ifab">IFAB</option>
          <option value="high_school">U.S. High School</option>
          <option value="custom">Custom</option>
        </select>
      </label>

      <div className="overflow-x-auto border-b border-slate-200">
        <div className="flex min-w-max" role="tablist" aria-label="Soccer settings sections">
          {sections.map(section => (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={activeSection === section.id}
              onClick={() => setActiveSection(section.id)}
              className={`h-10 px-3 text-sm font-semibold border-b-2 ${
                activeSection === section.id
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-slate-500'
              }`}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-[20rem]">
        {activeSection === 'common' && (
          <div className="space-y-4">
            <Segmented
              label="Clock direction"
              value={draft.rules.clockDirection}
              options={[
                { value: 'count_up', label: 'Count up' },
                { value: 'count_down', label: 'Count down' },
              ]}
              onChange={value => updateRules(rules => ({ ...rules, clockDirection: value }))}
            />
            <Segmented
              label="Clock display"
              value={draft.rules.clockDisplay}
              options={[
                { value: 'continuous', label: 'Continuous' },
                { value: 'per_period', label: 'Per period' },
              ]}
              onChange={value => updateRules(rules => ({ ...rules, clockDisplay: value }))}
            />
            <NumberField
              label="Players on field"
              value={draft.rules.maxOnFieldPlayers}
              min={1}
              max={18}
              onChange={value => updateRules(rules => ({ ...rules, maxOnFieldPlayers: value }))}
            />
            <Toggle
              label="Flip field by default"
              checked={draft.display.fieldFlipped}
              onChange={fieldFlipped => setDraft(current => ({
                ...current,
                display: { fieldFlipped },
              }))}
            />
          </div>
        )}

        {activeSection === 'match' && (
          <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              Regulation format
              <select
                value={regulationPreset}
                onChange={event => applyRegulationPreset(event.target.value as SoccerRegulationPreset)}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5"
              >
                <option value="standard">2 x 45 minutes</option>
                <option value="youth">2 x 30 minutes</option>
                <option value="quarters">4 x 15 minutes</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <NumberField
              label="Regulation periods"
              value={draft.rules.regulationSegments.length}
              min={1}
              max={8}
              onChange={count => updateRules(rules => ({
                ...normalizeRules({
                  ...rules,
                  regulationSegments: resizeSoccerSegments(
                    rules.regulationSegments,
                    'regulation',
                    count,
                    45
                  ),
                }),
              }))}
            />
            <SegmentRows
              segments={draft.rules.regulationSegments}
              onChange={segments => updateRules(rules => ({ ...rules, regulationSegments: segments }))}
            />
            <label className="block text-sm font-medium text-slate-700">
              Tie resolution
              <select
                value={draft.rules.tieResolution}
                onChange={event => updateRules(rules => ({
                  ...rules,
                  tieResolution: event.target.value as SoccerConfigurableRules['tieResolution'],
                }))}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5"
              >
                <option value="draw_allowed">Draw allowed</option>
                <option value="extra_time_then_shootout">Extra time, then shootout</option>
                <option value="direct_to_shootout">Direct to shootout</option>
              </select>
            </label>
            {draft.rules.tieResolution === 'extra_time_then_shootout' && (
              <>
                <NumberField
                  label="Extra-time periods"
                  value={draft.rules.extraTimeSegments.length}
                  min={1}
                  max={4}
                  onChange={count => updateRules(rules => ({
                    ...normalizeRules({
                      ...rules,
                      extraTimeSegments: resizeSoccerSegments(
                        rules.extraTimeSegments,
                        'extra_time',
                        count,
                        15,
                        rules.regulationSegments.length
                      ),
                    }),
                  }))}
                />
                <SegmentRows
                  segments={draft.rules.extraTimeSegments}
                  onChange={segments => updateRules(rules => ({ ...rules, extraTimeSegments: segments }))}
                />
              </>
            )}
          </div>
        )}

        {activeSection === 'discipline' && (
          <div className="space-y-4">
            <Segmented
              label="Yellow-card exit"
              value={draft.rules.yellowCardExitPolicy}
              options={[
                { value: 'stay_on', label: 'Player stays on' },
                { value: 'must_leave_may_replace', label: 'Must leave' },
              ]}
              onChange={value => updateRules(rules => ({ ...rules, yellowCardExitPolicy: value }))}
            />
            <label className="block text-sm font-medium text-slate-700">
              Red-card replacement
              <select
                value={draft.rules.redCardReplacementPolicy}
                disabled
                className="mt-1 w-full rounded-md border border-slate-200 bg-slate-100 px-3 py-2.5 text-slate-600"
              >
                <option value="play_short">Team plays short</option>
              </select>
            </label>
          </div>
        )}

        {activeSection === 'substitutions' && (
          <div className="space-y-4">
            <Toggle
              label="Allow return substitutions"
              checked={draft.rules.allowReturnSubstitutions}
              onChange={value => updateRules(rules => ({ ...rules, allowReturnSubstitutions: value }))}
            />
            <NullableNumberField
              label="Substitution limit"
              value={draft.rules.substitutionLimit}
              onChange={value => updateRules(rules => ({ ...rules, substitutionLimit: value }))}
            />
            <NullableNumberField
              label="Substitution windows"
              value={draft.rules.substitutionWindowLimit}
              onChange={value => updateRules(rules => ({ ...rules, substitutionWindowLimit: value }))}
            />
          </div>
        )}

        {activeSection === 'advanced' && (
          <div className="space-y-4">
            <NumberField
              label="Maximum assists per goal"
              value={draft.rules.maxAssistsPerGoal}
              min={0}
              max={2}
              onChange={value => updateRules(rules => ({ ...rules, maxAssistsPerGoal: value }))}
            />
            <NumberField
              label="Initial shootout kicks per side"
              value={draft.rules.shootoutInitialKicksPerSide}
              min={1}
              max={20}
              onChange={value => updateRules(rules => ({
                ...rules,
                shootoutInitialKicksPerSide: value,
              }))}
            />
            <Toggle
              label="Allow unused goalkeeper replacement in shootout"
              checked={draft.rules.allowUnusedGoalkeeperShootoutReplacement}
              onChange={value => updateRules(rules => ({
                ...rules,
                allowUnusedGoalkeeperShootoutReplacement: value,
              }))}
            />
          </div>
        )}
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-bold uppercase text-slate-500">Effective Preview</p>
        <p className="mt-1 text-sm text-slate-700">
          {formatSegments(effective.regulationSegments)} · {effective.maxOnFieldPlayers} players ·{' '}
          {effective.clockDirection === 'count_up' ? 'Count up' : 'Count down'} ·{' '}
          {tieLabel(effective.tieResolution)}
        </p>
        <p className="mt-1 text-xs text-slate-500">Source: Personal defaults</p>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-3">
        <button
          type="button"
          onClick={resetSection}
          className="h-10 inline-flex items-center gap-2 rounded-md px-2 text-sm font-semibold text-slate-600"
        >
          <RotateCcw size={16} />
          Reset Section
        </button>
        <button
          type="button"
          onClick={() => setDraft(structuredClone(DEFAULT_SOCCER_PERSONAL_SETTINGS))}
          className="h-10 px-2 text-sm font-semibold text-slate-600"
        >
          Reset All
        </button>
      </div>

      <div className="sticky bottom-0 -mx-4 grid grid-cols-2 gap-2 border-t border-slate-200 bg-slate-50/95 p-4 backdrop-blur">
        <button
          type="button"
          className="btn-secondary"
          disabled={!dirty}
          onClick={() => {
            setDraft(structuredClone(soccerSettings))
            setDraftBaseRevision(soccerSettingsSync.revision)
          }}
        >
          Discard
        </button>
        <button
          type="button"
          className="btn-primary inline-flex items-center justify-center gap-2"
          disabled={!dirty || soccerSettingsSync.status === 'saving'}
          onClick={() => void saveSoccerSettings(draft, draftBaseRevision)}
        >
          {soccerSettingsSync.status === 'saving' ? (
            <RefreshCw size={17} className="animate-spin" />
          ) : soccerSettingsSync.status === 'synced' && !dirty ? (
            <Check size={17} />
          ) : (
            <Save size={17} />
          )}
          Save
        </button>
      </div>
    </section>
  )
}

function SyncStatus({ status }: {
  status: ReturnType<typeof useSettings>['soccerSettingsSync']['status']
}) {
  const labels = {
    local: 'Saved on this device',
    checking: 'Checking cloud settings',
    synced: 'Synced',
    saving: 'Saving',
    pending: 'Saved locally, cloud pending',
    conflict: 'Cloud conflict',
    backend_update_required: 'Local only',
    error: 'Cloud unavailable',
  } as const
  return (
    <span className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-slate-500">
      <Cloud size={13} />
      {labels[status]}
    </span>
  )
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-slate-700">{label}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1">
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`min-h-9 rounded px-2 text-sm font-semibold ${
              value === option.value
                ? 'bg-white text-emerald-700 shadow-sm'
                : 'text-slate-500'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function Toggle({ label, checked, onChange }: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium text-slate-700">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-emerald-600' : 'bg-slate-300'
        }`}
      >
        <span className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : ''
        }`} />
      </button>
    </label>
  )
}

function NumberField({ label, value, min, max, onChange }: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={event => {
          const next = Number(event.target.value)
          if (Number.isInteger(next)) onChange(Math.max(min, Math.min(max, next)))
        }}
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5"
      />
    </label>
  )
}

function NullableNumberField({ label, value, onChange }: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
}) {
  return (
    <div className="space-y-2">
      <Toggle label={`${label}: ${value === null ? 'No limit' : value}`} checked={value !== null} onChange={enabled => onChange(enabled ? 0 : null)} />
      {value !== null && (
        <input
          type="number"
          min={0}
          value={value}
          aria-label={label}
          onChange={event => {
            const next = Number(event.target.value)
            if (Number.isInteger(next)) onChange(Math.max(0, next))
          }}
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2.5"
        />
      )}
    </div>
  )
}

function SegmentRows({ segments, onChange }: {
  segments: SoccerMatchSegment[]
  onChange: (segments: SoccerMatchSegment[]) => void
}) {
  return (
    <div className="space-y-2">
      {segments.map((segment, index) => (
        <div key={segment.id} className="grid grid-cols-[1fr_6rem] gap-2">
          <label className="text-xs font-medium text-slate-500">
            Period {index + 1}
            <input
              value={segment.label}
              onChange={event => onChange(segments.map(item =>
                item.id === segment.id ? { ...item, label: event.target.value } : item
              ))}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2"
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            Minutes
            <input
              type="number"
              min={1}
              max={180}
              value={Math.round(segment.durationMs / 60_000)}
              onChange={event => {
                const minutes = Number(event.target.value)
                if (!Number.isInteger(minutes)) return
                onChange(segments.map(item =>
                  item.id === segment.id
                    ? { ...item, durationMs: Math.max(1, Math.min(180, minutes)) * 60_000 }
                    : item
                ))
              }}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2"
            />
          </label>
        </div>
      ))}
    </div>
  )
}

function normalizeRules(rules: SoccerConfigurableRules): SoccerConfigurableRules {
  return {
    ...rules,
    regulationSegments: rules.regulationSegments.map((segment, index) => ({
      ...segment,
      order: index + 1,
    })),
    extraTimeSegments: rules.extraTimeSegments.map((segment, index) => ({
      ...segment,
      order: rules.regulationSegments.length + index + 1,
    })),
  }
}

function formatSegments(segments: SoccerMatchSegment[]): string {
  const minutes = segments.map(segment => Math.round(segment.durationMs / 60_000))
  return minutes.every(value => value === minutes[0])
    ? `${segments.length} x ${minutes[0]} minutes`
    : minutes.map(value => `${value}m`).join(' + ')
}

function tieLabel(value: SoccerConfigurableRules['tieResolution']): ReactNode {
  if (value === 'draw_allowed') return 'Draw allowed'
  if (value === 'direct_to_shootout') return 'Direct to shootout'
  return 'Extra time, then shootout'
}
