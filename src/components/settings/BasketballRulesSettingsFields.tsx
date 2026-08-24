import { useMemo } from 'react'
import {
  listBasketballRulesProfiles,
  resolveBasketballRules,
  type BasketballRuleLayerId,
  type BasketballRulesProfileRef,
} from '../../lib/basketball/profiles'
import type { BasketballTeamSettingsV1 } from '../../lib/basketball/settings'
import type { BasketballRulesV2Field } from '../../lib/basketball/types'

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

  const chooseProfile = (profileRef: BasketballRulesProfileRef) => {
    onChange?.({ baseProfile: profileRef, ruleOverrides: {} })
  }

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

  return (
    <div className="space-y-5">
      {!readOnly && (
        <label className="block text-sm font-medium text-slate-700">
          Tracking profile
          <select
            value={`${settings.baseProfile.profileId}@${settings.baseProfile.profileVersion}`}
            onChange={event => {
              const profile = profiles.find(item =>
                `${item.profileId}@${item.profileVersion}` === event.target.value
              )
              if (profile) chooseProfile({
                profileId: profile.profileId,
                profileVersion: profile.profileVersion,
              })
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

      {resolved.ok ? (
        <>
          {!readOnly && (
            <NumberField
              label="Player foul limit"
              value={resolved.value.rules.personalFoulLimit}
              min={1}
              max={20}
              onChange={setPersonalFoulLimit}
            />
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

export function BasketballRulesSummary({
  resolution,
  layerId,
  profileSourceLabel,
  overrideSourceLabel,
}: {
  resolution: Extract<ReturnType<typeof resolveBasketballRules>, { ok: true }>['value']
  layerId: Extract<BasketballRuleLayerId, 'personal' | 'team'>
  profileSourceLabel: string
  overrideSourceLabel: string
}) {
  const { profile, rules, customized, sourceByField } = resolution
  const source = (field: BasketballRulesV2Field) =>
    sourceByField[field] === layerId ? overrideSourceLabel : 'Built-in profile'

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
          `${segment.label} (${Math.round(segment.durationMs / 60_000)} min)`
        ).join(', ')}
        source={source('regulationSegments')}
      />
      <SummaryRow
        label="Overtime"
        value={`${rules.overtimeTemplate.label}, ${Math.round(rules.overtimeTemplate.durationMs / 60_000)} min`}
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
