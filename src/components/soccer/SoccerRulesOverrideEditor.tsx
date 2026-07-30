import { RotateCcw } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import {
  withSoccerTieResolution,
  type SoccerMatchRulesOverride,
} from '../../lib/soccer/rules'
import {
  detectRegulationPreset,
  detectSoccerCompetitionProfile,
  regulationSegmentsForPreset,
  reorderSoccerSegments,
  resizeSoccerSegments,
  soccerRulesForCompetitionProfile,
  type SoccerCompetitionProfile,
  type SoccerRegulationPreset,
} from '../../lib/soccer/setupRules'
import {
  resolveSoccerOverrideEditorRules,
  soccerRulesOverrideFromDifference,
  type SoccerRuleSourceMap,
} from '../../lib/soccer/settings'
import type { SoccerMatchRules, SoccerMatchSegment } from '../../lib/soccer/types'

interface Props {
  inherited: SoccerMatchRules
  inheritedSources: SoccerRuleSourceMap
  override: SoccerMatchRulesOverride
  overrideLabel: 'Team override' | 'Match override'
  readOnly?: boolean
  onChange: (override: SoccerMatchRulesOverride) => void
}

export default function SoccerRulesOverrideEditor({
  inherited,
  inheritedSources,
  override,
  overrideLabel,
  readOnly = false,
  onChange,
}: Props) {
  const { rules: effective, error: overrideError } =
    resolveSoccerOverrideEditorRules(inherited, override)
  const regulationPreset = detectRegulationPreset(effective)
  const competitionProfile = detectSoccerCompetitionProfile(effective)

  const updateEffective = (
    update: (current: SoccerMatchRules) => SoccerMatchRules
  ) => {
    if (readOnly) return
    onChange(soccerRulesOverrideFromDifference(
      inherited,
      reorderSoccerSegments(update(effective))
    ))
  }
  const reset = (...keys: Array<keyof SoccerMatchRulesOverride>) => {
    if (readOnly) return
    const next = { ...override }
    for (const key of keys) delete next[key]
    onChange(next)
  }
  const source = (key: keyof SoccerRuleSourceMap) =>
    Object.prototype.hasOwnProperty.call(override, key)
      ? overrideLabel
      : sourceName(inheritedSources[key])

  return (
    <div className="space-y-5">
      {overrideError && (
        <div
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          Saved rules could not be applied and inherited values are shown instead. Reset this scope
          or edit a value to repair it. ({overrideError})
        </div>
      )}
      <RuleGroup title="Profile">
        <RuleField
          source={profileSource(override, inheritedSources, overrideLabel)}
          overridden={Object.keys(override).length > 0}
          readOnly={readOnly}
          onReset={() => onChange({})}
        >
          <SelectField
            label="Starting profile"
            value={competitionProfile}
            disabled={readOnly}
            options={[
              ['ifab', 'IFAB'],
              ['high_school', 'U.S. High School'],
              ['custom', 'Custom'],
            ]}
            onChange={value => {
              if (value === 'custom') return
              onChange(soccerRulesOverrideFromDifference(
                inherited,
                soccerRulesForCompetitionProfile(value as Exclude<SoccerCompetitionProfile, 'custom'>)
              ))
            }}
          />
        </RuleField>
      </RuleGroup>

      <RuleGroup title="Match Format">
        <RuleField
          source={source('regulationSegments')}
          overridden={'regulationSegments' in override}
          readOnly={readOnly}
          onReset={() => reset('regulationSegments')}
        >
          <SelectField
            label="Regulation format"
            value={regulationPreset}
            disabled={readOnly}
            options={[
              ['standard', '2 x 45 minutes'],
              ['youth', '2 x 30 minutes'],
              ['quarters', '4 x 15 minutes'],
              ['custom', 'Custom'],
            ]}
            onChange={value => {
              if (value === 'custom') return
              updateEffective(current => ({
                ...current,
                regulationSegments: regulationSegmentsForPreset(
                  value as Exclude<SoccerRegulationPreset, 'custom'>
                ),
              }))
            }}
          />
          <NumberField
            label="Regulation periods"
            value={effective.regulationSegments.length}
            min={1}
            max={8}
            disabled={readOnly}
            onChange={count => updateEffective(current => ({
              ...current,
              regulationSegments: resizeSoccerSegments(
                current.regulationSegments,
                'regulation',
                count,
                45
              ),
            }))}
          />
          <SegmentRows
            segments={effective.regulationSegments}
            disabled={readOnly}
            onChange={segments => updateEffective(current => ({
              ...current,
              regulationSegments: segments,
            }))}
          />
        </RuleField>
        <RuleField
          source={source('tieResolution')}
          overridden={'tieResolution' in override}
          readOnly={readOnly}
          onReset={() => reset('tieResolution')}
        >
          <SelectField
            label="Tie resolution"
            value={effective.tieResolution}
            disabled={readOnly}
            options={[
              ['draw_allowed', 'Draw allowed'],
              ['extra_time_then_shootout', 'Extra time, then shootout'],
              ['direct_to_shootout', 'Direct to shootout'],
            ]}
            onChange={value => updateEffective(current =>
              withSoccerTieResolution(
                current,
                value as SoccerMatchRules['tieResolution']
              )
            )}
          />
        </RuleField>
        {effective.tieResolution === 'extra_time_then_shootout' && (
          <RuleField
            source={source('extraTimeSegments')}
            overridden={'extraTimeSegments' in override}
            readOnly={readOnly}
            onReset={() => reset('extraTimeSegments')}
          >
            <NumberField
              label="Extra-time periods"
              value={effective.extraTimeSegments.length}
              min={1}
              max={4}
              disabled={readOnly}
              onChange={count => updateEffective(current => ({
                ...current,
                extraTimeSegments: resizeSoccerSegments(
                  current.extraTimeSegments,
                  'extra_time',
                  count,
                  15,
                  current.regulationSegments.length
                ),
              }))}
            />
            <SegmentRows
              segments={effective.extraTimeSegments}
              disabled={readOnly}
              onChange={segments => updateEffective(current => ({
                ...current,
                extraTimeSegments: segments,
              }))}
            />
          </RuleField>
        )}
      </RuleGroup>

      <RuleGroup title="Clock and Lineup">
        <div className="grid sm:grid-cols-2 gap-3">
          <RuleField
            source={source('clockDirection')}
            overridden={'clockDirection' in override}
            readOnly={readOnly}
            onReset={() => reset('clockDirection')}
          >
            <SelectField
              label="Clock direction"
              value={effective.clockDirection}
              disabled={readOnly}
              options={[['count_up', 'Count up'], ['count_down', 'Count down']]}
              onChange={value => updateEffective(current => ({
                ...current,
                clockDirection: value as SoccerMatchRules['clockDirection'],
              }))}
            />
          </RuleField>
          <RuleField
            source={source('clockDisplay')}
            overridden={'clockDisplay' in override}
            readOnly={readOnly}
            onReset={() => reset('clockDisplay')}
          >
            <SelectField
              label="Clock display"
              value={effective.clockDisplay}
              disabled={readOnly}
              options={[['continuous', 'Continuous'], ['per_period', 'Per period']]}
              onChange={value => updateEffective(current => ({
                ...current,
                clockDisplay: value as SoccerMatchRules['clockDisplay'],
              }))}
            />
          </RuleField>
          <RuleField
            source={source('maxOnFieldPlayers')}
            overridden={'maxOnFieldPlayers' in override}
            readOnly={readOnly}
            onReset={() => reset('maxOnFieldPlayers')}
          >
            <NumberField
              label="Players on field"
              value={effective.maxOnFieldPlayers}
              min={1}
              max={18}
              disabled={readOnly}
              onChange={value => updateEffective(current => ({
                ...current,
                maxOnFieldPlayers: value,
              }))}
            />
          </RuleField>
          <RuleField
            source={source('maxAssistsPerGoal')}
            overridden={'maxAssistsPerGoal' in override}
            readOnly={readOnly}
            onReset={() => reset('maxAssistsPerGoal')}
          >
            <NumberField
              label="Maximum assists per goal"
              value={effective.maxAssistsPerGoal}
              min={0}
              max={2}
              disabled={readOnly}
              onChange={value => updateEffective(current => ({
                ...current,
                maxAssistsPerGoal: value,
              }))}
            />
          </RuleField>
        </div>
      </RuleGroup>

      <RuleGroup title="Substitutions">
        <RuleField
          source={source('allowReturnSubstitutions')}
          overridden={'allowReturnSubstitutions' in override}
          readOnly={readOnly}
          onReset={() => reset('allowReturnSubstitutions')}
        >
          <Toggle
            label="Allow return substitutions"
            checked={effective.allowReturnSubstitutions}
            disabled={readOnly}
            onChange={value => updateEffective(current => ({
              ...current,
              allowReturnSubstitutions: value,
            }))}
          />
        </RuleField>
        <div className="grid sm:grid-cols-2 gap-3">
          <RuleField
            source={source('substitutionLimit')}
            overridden={'substitutionLimit' in override}
            readOnly={readOnly}
            onReset={() => reset('substitutionLimit')}
          >
            <NullableNumberField
              label="Substitution limit"
              value={effective.substitutionLimit}
              disabled={readOnly}
              onChange={value => updateEffective(current => ({
                ...current,
                substitutionLimit: value,
              }))}
            />
          </RuleField>
          <RuleField
            source={source('substitutionWindowLimit')}
            overridden={'substitutionWindowLimit' in override}
            readOnly={readOnly}
            onReset={() => reset('substitutionWindowLimit')}
          >
            <NullableNumberField
              label="Substitution windows"
              value={effective.substitutionWindowLimit}
              disabled={readOnly}
              onChange={value => updateEffective(current => ({
                ...current,
                substitutionWindowLimit: value,
              }))}
            />
          </RuleField>
        </div>
      </RuleGroup>

      <RuleGroup title="Discipline and Shootout">
        <RuleField
          source={source('yellowCardExitPolicy')}
          overridden={'yellowCardExitPolicy' in override}
          readOnly={readOnly}
          onReset={() => reset('yellowCardExitPolicy')}
        >
          <SelectField
            label="Yellow-card exit"
            value={effective.yellowCardExitPolicy}
            disabled={readOnly}
            options={[
              ['stay_on', 'Player stays on'],
              ['must_leave_may_replace', 'Must leave, may replace'],
            ]}
            onChange={value => updateEffective(current => ({
              ...current,
              yellowCardExitPolicy: value as SoccerMatchRules['yellowCardExitPolicy'],
            }))}
          />
        </RuleField>
        <RuleField
          source={source('shootoutInitialKicksPerSide')}
          overridden={'shootoutInitialKicksPerSide' in override}
          readOnly={readOnly}
          onReset={() => reset('shootoutInitialKicksPerSide')}
        >
          <NumberField
            label="Initial shootout kicks per side"
            value={effective.shootoutInitialKicksPerSide}
            min={1}
            max={20}
            disabled={readOnly}
            onChange={value => updateEffective(current => ({
              ...current,
              shootoutInitialKicksPerSide: value,
            }))}
          />
        </RuleField>
        <RuleField
          source={source('allowUnusedGoalkeeperShootoutReplacement')}
          overridden={'allowUnusedGoalkeeperShootoutReplacement' in override}
          readOnly={readOnly}
          onReset={() => reset('allowUnusedGoalkeeperShootoutReplacement')}
        >
          <Toggle
            label="Allow unused goalkeeper replacement in shootout"
            checked={effective.allowUnusedGoalkeeperShootoutReplacement}
            disabled={readOnly}
            onChange={value => updateEffective(current => ({
              ...current,
              allowUnusedGoalkeeperShootoutReplacement: value,
            }))}
          />
        </RuleField>
        <p className="text-xs text-slate-500">
          Red-card replacement remains fixed to playing short.
        </p>
      </RuleGroup>
    </div>
  )
}

function RuleGroup({ title, children }: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3 border-t border-slate-200 pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-bold uppercase text-slate-500">{title}</h3>
      {children}
    </section>
  )
}

function RuleField({ source, overridden, readOnly, onReset, children }: {
  source: string
  overridden: boolean
  readOnly: boolean
  onReset: () => void
  children: ReactNode
}) {
  return (
    <div className="border-b border-slate-200 pb-3 last:border-b-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] font-semibold ${
          overridden ? 'text-emerald-700' : 'text-slate-500'
        }`}>
          {source}
        </span>
        {overridden && !readOnly && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-7 items-center gap-1 text-xs font-semibold text-slate-600"
            title="Resume inherited value"
          >
            <RotateCcw size={13} />
            Inherit
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

function SelectField({ label, value, options, disabled, onChange }: {
  label: string
  value: string
  options: Array<[string, string]>
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        className="input-field mt-1 disabled:bg-slate-100"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  )
}

function NumberField({ label, value, min, max, disabled, onChange }: {
  label: string
  value: number
  min: number
  max: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={event => onChange(
          Math.max(min, Math.min(max, Number(event.target.value) || min))
        )}
        className="input-field mt-1 disabled:bg-slate-100"
      />
    </label>
  )
}

function NullableNumberField({ label, value, disabled, onChange }: {
  label: string
  value: number | null
  disabled: boolean
  onChange: (value: number | null) => void
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        type="number"
        value={value ?? ''}
        min={0}
        disabled={disabled}
        placeholder="Unlimited"
        onChange={event => onChange(
          event.target.value === '' ? null : Math.max(0, Number(event.target.value) || 0)
        )}
        className="input-field mt-1 disabled:bg-slate-100"
      />
    </label>
  )
}

function Toggle({ label, checked, disabled, onChange }: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-h-10 items-center justify-between gap-3 text-sm font-medium text-slate-700">
      {label}
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
        className="h-5 w-5 accent-emerald-600"
      />
    </label>
  )
}

function SegmentRows({ segments, disabled, onChange }: {
  segments: SoccerMatchSegment[]
  disabled: boolean
  onChange: (segments: SoccerMatchSegment[]) => void
}) {
  return (
    <div className="space-y-2">
      {segments.map((segment, index) => (
        <div key={segment.id} className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
          <label className="min-w-0 text-xs font-medium text-slate-500">
            Label
            <SegmentLabelInput
              value={segment.label}
              disabled={disabled}
              onCommit={label => onChange(segments.map((item, itemIndex) =>
                itemIndex === index ? { ...item, label } : item
              ))}
            />
          </label>
          <label className="text-xs font-medium text-slate-500">
            Minutes
            <input
              type="number"
              min={1}
              max={240}
              value={Math.round(segment.durationMs / 60_000)}
              disabled={disabled}
              onChange={event => onChange(segments.map((item, itemIndex) =>
                itemIndex === index
                  ? {
                      ...item,
                      durationMs: Math.max(1, Number(event.target.value) || 1) * 60_000,
                    }
                  : item
              ))}
              className="input-field mt-1 px-3 py-2 text-sm disabled:bg-slate-100"
            />
          </label>
        </div>
      ))}
    </div>
  )
}

/** Keep blank mid-edit labels local until blur so parent resolve cannot throw. */
function SegmentLabelInput({
  value,
  disabled,
  onCommit,
}: {
  value: string
  disabled: boolean
  onCommit: (label: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    setDraft(value)
  }, [value])

  return (
    <input
      value={draft}
      disabled={disabled}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        const trimmed = draft.trim()
        if (!trimmed) {
          setDraft(value)
          return
        }
        if (trimmed !== value) onCommit(trimmed)
        else if (draft !== value) setDraft(value)
      }}
      className="input-field mt-1 min-w-0 w-full px-3 py-2 text-sm disabled:bg-slate-100"
    />
  )
}

function sourceName(source: SoccerRuleSourceMap[keyof SoccerRuleSourceMap]): string {
  switch (source) {
    case 'personal': return 'Personal default'
    case 'team': return 'Team default'
    case 'match': return 'Match override'
    default: return 'Built-in default'
  }
}

function profileSource(
  override: SoccerMatchRulesOverride,
  inheritedSources: SoccerRuleSourceMap,
  overrideLabel: string
): string {
  if (Object.keys(override).length > 0) return overrideLabel
  const sources = new Set(Object.values(inheritedSources))
  if (sources.has('team')) return 'Includes team defaults'
  if (sources.has('personal')) return 'Personal defaults'
  return 'Built-in defaults'
}
