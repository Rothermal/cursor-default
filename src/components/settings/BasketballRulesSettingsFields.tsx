import { useEffect, useMemo, useState } from 'react'
import {
  basketballRuleOverridesWithAnchoredClock,
  basketballRuleOverridesWithoutClockLineups,
  listBasketballRulesProfiles,
  previewBasketballProfileUpgrade,
  resolveBasketballRules,
  upgradeBasketballRulesDraftToV3,
  type BasketballRuleLayerId,
  type BasketballProfileUpgradeResult,
  type BasketballRulesProfileRef,
} from '../../lib/basketball/profiles'
import { isBasketballMatchRulesV2, isBasketballMatchRulesV3 } from '../../lib/basketball/rules'
import {
  basketballRuleFieldLabel,
  formatBasketballRuleField,
} from '../../lib/basketball/profileDiffPresentation'
import type { BasketballTeamSettingsV1 } from '../../lib/basketball/settings'
import type {
  BasketballEqualPlayMode,
  BasketballMatchRulesV3,
  BasketballRulesField,
} from '../../lib/basketball/types'

export default function BasketballRulesSettingsFields({
  settings,
  layerId,
  profileSourceLabel,
  overrideSourceLabel,
  readOnly = false,
  onChange,
}: {
  settings: BasketballTeamSettingsV1
  layerId: Extract<BasketballRuleLayerId, 'personal' | 'team'>
  profileSourceLabel: string
  overrideSourceLabel: string
  readOnly?: boolean
  onChange?: (settings: BasketballTeamSettingsV1) => void
}) {
  const profiles = useMemo(listBasketballRulesProfiles, [])
  const resolved = useMemo(() => resolveBasketballRules(
    settings.baseProfile,
    [{ id: layerId, overrides: settings.ruleOverrides }]
  ), [layerId, settings.baseProfile, settings.ruleOverrides])
  const [pendingProfile, setPendingProfile] = useState<BasketballRulesProfileRef | null>(null)
  const [pendingClockUpgrade, setPendingClockUpgrade] = useState(false)
  const profilePreview = useMemo<BasketballProfileUpgradeResult | null>(() => (
    pendingProfile
      ? previewBasketballProfileUpgrade(
          settings.baseProfile,
          pendingProfile,
          settings.ruleOverrides
        )
      : null
  ), [pendingProfile, settings.baseProfile, settings.ruleOverrides])

  useEffect(() => setPendingProfile(null), [
    settings.baseProfile.profileId,
    settings.baseProfile.profileVersion,
  ])

  const setPersonalFoulLimit = (limit: number) => {
    const profile = profiles.find(item =>
      item.profileId === settings.baseProfile.profileId &&
      item.profileVersion === settings.baseProfile.profileVersion
    )
    if (!profile) return
    const overrides = { ...settings.ruleOverrides }
    if (limit === profile.rules.personalFoulLimit) delete overrides.personalFoulLimit
    else overrides.personalFoulLimit = limit
    onChange?.({ ...settings, ruleOverrides: overrides })
  }

  const applyAnchoredClock = () => {
    if (!resolved.ok || !isBasketballMatchRulesV2(resolved.value.rules)) return
    onChange?.({
      ...settings,
      ruleOverrides: basketballRuleOverridesWithAnchoredClock(
        resolved.value.rules,
        settings.baseProfile.profileId,
        settings.ruleOverrides
      ),
    })
    setPendingClockUpgrade(false)
  }

  const removeClockLineups = () => {
    onChange?.({
      ...settings,
      ruleOverrides: basketballRuleOverridesWithoutClockLineups(settings.ruleOverrides),
    })
  }

  const updateClockRules = (rules: BasketballMatchRulesV3) => {
    onChange?.({
      ...settings,
      ruleOverrides: {
        ...settings.ruleOverrides,
        clockModel: rules.clockModel,
        clockDisplayDirection: rules.clockDisplayDirection,
        clockExpiration: rules.clockExpiration,
        stoppageMode: rules.stoppageMode,
        equalPlayPolicy: structuredClone(rules.equalPlayPolicy),
      },
    })
  }

  return (
    <div className="space-y-5">
      {!readOnly && (
        <label className="block text-sm font-medium text-slate-700">
          Tracking profile
          <select
            value={`${pendingProfile?.profileId ?? settings.baseProfile.profileId}@${pendingProfile?.profileVersion ?? settings.baseProfile.profileVersion}`}
            onChange={event => {
              const profile = profiles.find(item =>
                `${item.profileId}@${item.profileVersion}` === event.target.value
              )
              if (!profile) return
              const next = {
                profileId: profile.profileId,
                profileVersion: profile.profileVersion,
              }
              setPendingProfile(
                next.profileId === settings.baseProfile.profileId &&
                next.profileVersion === settings.baseProfile.profileVersion
                  ? null
                  : next
              )
            }}
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 text-slate-900"
          >
            {profiles.map(profile => (
              <option
                key={`${profile.profileId}@${profile.profileVersion}`}
                value={`${profile.profileId}@${profile.profileVersion}`}
              >
                {profile.label} v{profile.profileVersion}
              </option>
            ))}
          </select>
        </label>
      )}

      {!readOnly && pendingProfile && profilePreview && (
        <ProfileChangeReview
          preview={profilePreview}
          onCancel={() => setPendingProfile(null)}
          onApply={() => {
            if (!profilePreview.ok) return
            onChange?.({
              baseProfile: pendingProfile,
              ruleOverrides: structuredClone(settings.ruleOverrides),
            })
            setPendingProfile(null)
          }}
        />
      )}

      {resolved.ok ? (
        <>
          {!readOnly && (
            <>
              <NumberField
                label="Player foul limit"
                value={resolved.value.rules.personalFoulLimit}
                min={1}
                max={20}
                onChange={setPersonalFoulLimit}
              />
              {isBasketballMatchRulesV2(resolved.value.rules) ? (
                <div className="space-y-3 border-y border-slate-200 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Event game clock</p>
                      <p className="text-xs text-slate-500">Clockless compatibility rules</p>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary px-3 text-sm"
                      onClick={() => setPendingClockUpgrade(true)}
                    >
                      Use Anchored Clock
                    </button>
                  </div>
                  {pendingClockUpgrade && (
                    <ClockUpgradeReview
                      rules={resolved.value.rules}
                      profileId={settings.baseProfile.profileId}
                      sourceLabel={overrideSourceLabel}
                      onCancel={() => setPendingClockUpgrade(false)}
                      onApply={applyAnchoredClock}
                    />
                  )}
                </div>
              ) : isBasketballMatchRulesV3(resolved.value.rules) ? (
                <ClockRulesEditor
                  rules={resolved.value.rules}
                  onChange={updateClockRules}
                  onReturnToClockless={removeClockLineups}
                />
              ) : null}
            </>
          )}
          <BasketballRulesSummary
            resolution={resolved.value}
            layerId={layerId}
            profileSourceLabel={profileSourceLabel}
            overrideSourceLabel={overrideSourceLabel}
          />
        </>
      ) : (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {resolved.message}
        </p>
      )}
    </div>
  )
}

function ClockUpgradeReview({
  rules,
  profileId,
  sourceLabel,
  onCancel,
  onApply,
}: {
  rules: Parameters<typeof upgradeBasketballRulesDraftToV3>[0]
  profileId: BasketballRulesProfileRef['profileId']
  sourceLabel: string
  onCancel: () => void
  onApply: () => void
}) {
  const upgraded = useMemo(
    () => upgradeBasketballRulesDraftToV3(rules, profileId),
    [profileId, rules]
  )
  const fields = [
    'clockModel',
    'clockDisplayDirection',
    'clockExpiration',
    'stoppageMode',
    'equalPlayPolicy',
  ] as const
  return (
    <div className="space-y-3 border-y border-amber-200 bg-amber-50 px-3 py-3">
      <div>
        <p className="text-sm font-semibold text-amber-950">Review anchored clock rules</p>
        <p className="mt-1 text-xs text-amber-800">
          Applying creates one complete version-3 clock and lineup rule bundle in this draft.
        </p>
      </div>
      <div className="divide-y divide-amber-200 border-y border-amber-200">
        {fields.map(field => (
          <div key={field} className="py-2 text-xs text-slate-700">
            <p className="font-semibold text-slate-800">{basketballRuleFieldLabel(field)}</p>
            <p className="mt-0.5">Current: Not available in version 2</p>
            <p className="mt-0.5 break-words">
              New: {formatBasketballRuleField(field, upgraded[field])}
            </p>
            <p className="mt-0.5 text-amber-800">Source: {sourceLabel}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary" onClick={onApply}>Apply Anchored</button>
      </div>
    </div>
  )
}

function ClockRulesEditor({
  rules,
  onChange,
  onReturnToClockless,
}: {
  rules: BasketballMatchRulesV3
  onChange: (rules: BasketballMatchRulesV3) => void
  onReturnToClockless: () => void
}) {
  const updateEqualPlayMode = (mode: BasketballEqualPlayMode) => {
    onChange({
      ...rules,
      clockModel: mode === 'off' ? rules.clockModel : 'anchored',
      equalPlayPolicy: {
        ...rules.equalPlayPolicy,
        mode,
        ...(mode === 'off'
          ? {
              minimumPeriods: null,
              maximumConsecutivePeriods: null,
              maximumPeriodImbalance: null,
            }
          : {}),
      },
    })
  }
  const updateLimit = (
    field: 'minimumPeriods' | 'maximumConsecutivePeriods' | 'maximumPeriodImbalance',
    value: number | null
  ) => onChange({
    ...rules,
    equalPlayPolicy: { ...rules.equalPlayPolicy, [field]: value },
  })

  return (
    <div className="space-y-4 border-y border-slate-200 py-3">
      <SelectField
        label="Event game clock"
        value={rules.clockModel}
        options={[
          { value: 'anchored', label: 'Anchored clock' },
          { value: 'none', label: 'Clockless version 3' },
        ]}
        onChange={value => onChange({
          ...rules,
          clockModel: value as BasketballMatchRulesV3['clockModel'],
          equalPlayPolicy: value === 'none'
            ? {
                mode: 'off',
                minimumPeriods: null,
                maximumConsecutivePeriods: null,
                maximumPeriodImbalance: null,
              }
            : rules.equalPlayPolicy,
        })}
      />
      <SelectField
        label="Clock display"
        value={rules.clockDisplayDirection}
        options={[
          { value: 'count_down', label: 'Count down' },
          { value: 'count_up', label: 'Count up' },
        ]}
        onChange={value => onChange({
          ...rules,
          clockDisplayDirection: value as BasketballMatchRulesV3['clockDisplayDirection'],
        })}
      />
      <SelectField
        label="Equal-play policy"
        value={rules.equalPlayPolicy.mode}
        disabled={rules.clockModel === 'none'}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'advisory', label: 'Advisory' },
          { value: 'enforced', label: 'Enforced' },
        ]}
        onChange={value => updateEqualPlayMode(value as BasketballEqualPlayMode)}
      />
      {rules.equalPlayPolicy.mode !== 'off' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <OptionalNumberField
            label="Minimum periods"
            value={rules.equalPlayPolicy.minimumPeriods}
            onChange={value => updateLimit('minimumPeriods', value)}
          />
          <OptionalNumberField
            label="Max consecutive"
            value={rules.equalPlayPolicy.maximumConsecutivePeriods}
            onChange={value => updateLimit('maximumConsecutivePeriods', value)}
          />
          <OptionalNumberField
            label="Max imbalance"
            value={rules.equalPlayPolicy.maximumPeriodImbalance}
            onChange={value => updateLimit('maximumPeriodImbalance', value)}
          />
        </div>
      )}
      <button
        type="button"
        className="inline-flex h-10 items-center text-sm font-semibold text-slate-600"
        onClick={onReturnToClockless}
      >
        Return to compatible clockless rules
      </button>
    </div>
  )
}

function ProfileChangeReview({
  preview,
  onCancel,
  onApply,
}: {
  preview: BasketballProfileUpgradeResult
  onCancel: () => void
  onApply: () => void
}) {
  return (
    <div className="space-y-3 border-y border-amber-200 bg-amber-50 px-3 py-3">
      <div>
        <p className="text-sm font-semibold text-amber-950">Review profile change</p>
        <p className="mt-1 text-xs text-amber-800">
          Existing compatible overrides stay applied. The change is blocked when an override is
          incompatible with the selected profile.
        </p>
      </div>
      {preview.ok ? (
        <>
          <p className="text-sm text-slate-800">
            {preview.current.profile.label} v{preview.current.profile.profileVersion} to{' '}
            {preview.candidate.profile.label} v{preview.candidate.profile.profileVersion}
          </p>
          {preview.differences.length === 0 ? (
            <p className="text-xs text-slate-600">No effective rule values change.</p>
          ) : (
            <div className="divide-y divide-amber-200 border-y border-amber-200">
              {preview.differences.map(diff => (
                <div key={diff.field} className="py-2 text-xs text-slate-700">
                  <p className="font-semibold text-slate-800">{basketballRuleFieldLabel(diff.field)}</p>
                  {diff.overridden ? (
                    <>
                      <p className="mt-0.5 break-words">
                        Profile default:{' '}
                        {formatBasketballRuleField(
                          diff.field,
                          preview.currentBaseRules[diff.field]
                        )}{' '}
                        to{' '}
                        {formatBasketballRuleField(
                          diff.field,
                          preview.targetBaseRules[diff.field]
                        )}
                      </p>
                      <p className="mt-0.5 break-words text-amber-800">
                        Your override stays{' '}
                        {formatBasketballRuleField(
                          diff.field,
                          preview.candidate.rules[diff.field]
                        )}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-0.5 break-words">
                        Current: {formatBasketballRuleField(
                          diff.field,
                          preview.current.rules[diff.field]
                        )}
                      </p>
                      <p className="mt-0.5 break-words">
                        New: {formatBasketballRuleField(
                          diff.field,
                          preview.candidate.rules[diff.field]
                        )}
                      </p>
                      <p className="mt-0.5 text-amber-800">Changed by selected profile</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p role="alert" className="text-sm text-red-700">{preview.message}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="btn-primary"
          disabled={!preview.ok}
          onClick={onApply}
        >
          Apply Profile
        </button>
      </div>
    </div>
  )
}

export function BasketballRulesSummary({
  resolution,
  layerId,
  profileSourceLabel,
  overrideSourceLabel,
  sourceLabels,
}: {
  resolution: Extract<ReturnType<typeof resolveBasketballRules>, { ok: true }>['value']
  layerId: Extract<BasketballRuleLayerId, 'personal' | 'team'>
  profileSourceLabel: string
  overrideSourceLabel: string
  sourceLabels?: Partial<Record<'built_in' | BasketballRuleLayerId, string>>
}) {
  const { profile, rules, customized, sourceByField } = resolution
  const source = (field: BasketballRulesField) => {
    const sourceId = sourceByField[field]
    return (sourceId ? sourceLabels?.[sourceId] : undefined) ??
      (sourceId === layerId ? overrideSourceLabel : 'Built-in profile')
  }

  return (
    <div className="divide-y divide-slate-200 border-y border-slate-200">
      <SummaryRow
        label="Profile"
        value={`${profile.label} v${profile.profileVersion}${customized ? ' - Customized' : ''}`}
        source={profileSourceLabel}
      />
      <SummaryRow
        label="Regulation"
        value={rules.regulationSegments.map(segment =>
          `${segment.label} (${Math.round(segment.durationMs / 60_000)} min, ${
            segment.lineupChangeBoundary ? 'lineup boundary' : 'continuous lineup'
          })`
        ).join(', ')}
        source={source('regulationSegments')}
      />
      <SummaryRow
        label="Overtime"
        value={`${rules.overtimeTemplate.label}, ${Math.round(rules.overtimeTemplate.durationMs / 60_000)} min, ${
          rules.overtimeTemplate.lineupChangeBoundary ? 'lineup boundary' : 'continuous lineup'
        }`}
        source={source('overtimeTemplate')}
      />
      <SummaryRow
        label="Foul windows"
        value={rules.foulWindows.map(window => {
          if (window.bonusThreshold === null) return `${window.label}: no bonus`
          return `${window.label}: bonus at ${window.bonusThreshold}`
        }).join(' - ')}
        source={source('foulWindows')}
      />
      <SummaryRow
        label="Foul limit"
        value={`${rules.personalFoulLimit} personal fouls`}
        source={source('personalFoulLimit')}
      />
      <SummaryRow
        label="Timeout pools"
        value={rules.timeoutPools.map(pool =>
          `${pool.label}: ${pool.totalLimit === null ? 'unlimited' : pool.totalLimit}`
        ).join(' - ')}
        source={source('timeoutPools')}
      />
      <SummaryRow
        label="Clock model"
        value={rules.clockModel === 'none' ? 'No event-model game clock' : rules.clockModel}
        source={source('clockModel')}
      />
      {isBasketballMatchRulesV3(rules) && (
        <>
          <SummaryRow
            label="Clock display"
            value={formatBasketballRuleField('clockDisplayDirection', rules.clockDisplayDirection)}
            source={source('clockDisplayDirection')}
          />
          <SummaryRow
            label="Clock expiration"
            value={formatBasketballRuleField('clockExpiration', rules.clockExpiration)}
            source={source('clockExpiration')}
          />
          <SummaryRow
            label="Stoppages"
            value={formatBasketballRuleField('stoppageMode', rules.stoppageMode)}
            source={source('stoppageMode')}
          />
          <SummaryRow
            label="Equal play"
            value={formatBasketballRuleField('equalPlayPolicy', rules.equalPlayPolicy)}
            source={source('equalPlayPolicy')}
          />
        </>
      )}
      <div className="py-3">
        <p className="text-xs font-semibold uppercase text-slate-500">Sources</p>
        <p className="mt-1 text-sm text-slate-700">{profile.effectiveRulesLabel}</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {profile.sourceUrls.map((url, index) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-semibold text-blue-700 underline"
            >
              Source {index + 1}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

function SummaryRow({
  label,
  value,
  source,
}: {
  label: string
  value: string
  source: string
}) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-3 text-sm">
      <span className="font-semibold text-slate-500">{label}</span>
      <span className="min-w-0 text-slate-800">
        <span className="block">{value}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{source}</span>
      </span>
    </div>
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

function OptionalNumberField({ label, value, onChange }: {
  label: string
  value: number | null
  onChange: (value: number | null) => void
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        type="number"
        min={1}
        value={value ?? ''}
        placeholder="None"
        onChange={event => {
          if (event.target.value === '') {
            onChange(null)
            return
          }
          const next = Number(event.target.value)
          if (Number.isInteger(next) && next > 0) onChange(next)
        }}
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5"
      />
    </label>
  )
}

function SelectField({ label, value, options, disabled = false, onChange }: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2.5 disabled:bg-slate-100 disabled:text-slate-500"
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}
