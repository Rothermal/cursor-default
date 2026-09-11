import { useMemo } from 'react'
import { BasketballRulesSummary } from '../settings/BasketballRulesSettingsFields'
import { resolveBasketballSettingsHierarchy } from '../../lib/basketball/settings'
import type { BasketballSetupDraftEventV1 } from '../../lib/basketball/setupDraft'
import type { BasketballRuleOverrides } from '../../lib/basketball/types'

export default function BasketballSetupRulesReview({
  event,
  readOnly = false,
  onMatchOverridesChange,
}: {
  event: BasketballSetupDraftEventV1
  readOnly?: boolean
  onMatchOverridesChange?: (overrides: BasketballRuleOverrides) => void
}) {
  const authority = event.settingsAuthority
  const resolution = useMemo(() => resolveBasketballSettingsHierarchy({
    authority: authority.kind,
    personalSettings: authority.kind === 'personal' ? authority.settings : undefined,
    teamSettings: authority.kind === 'team' ? authority.settings : undefined,
    matchOverrides: event.matchOverrides,
  }), [authority, event.matchOverrides])
  const inherited = useMemo(() => resolveBasketballSettingsHierarchy({
    authority: authority.kind,
    personalSettings: authority.kind === 'personal' ? authority.settings : undefined,
    teamSettings: authority.kind === 'team' ? authority.settings : undefined,
    matchOverrides: {},
  }), [authority])
  const revisionLabel = authority.revision === null ? 'Built-in default' : `Revision ${authority.revision}`
  const authorityLabel = authority.kind === 'team' ? 'Team defaults' : 'Personal defaults'

  if (!resolution.ok) {
    return (
      <p role="alert" className="border-y border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
        {resolution.message}
      </p>
    )
  }
  if (!inherited.ok) {
    return (
      <p role="alert" className="border-y border-danger-line bg-danger px-3 py-2 text-sm text-danger-content">
        {inherited.message}
      </p>
    )
  }

  const updateFoulLimit = (limit: number) => {
    if (!onMatchOverridesChange) return
    const next = structuredClone(event.matchOverrides)
    if (limit === inherited.value.rules.personalFoulLimit) delete next.personalFoulLimit
    else next.personalFoulLimit = limit
    onMatchOverridesChange(next)
  }

  return (
    <section className="space-y-4 border-y border-line-strong py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-content">Rules Review</h3>
          <p className="mt-0.5 text-xs text-content-muted">
            {authorityLabel} - {revisionLabel}
          </p>
        </div>
        {Object.keys(event.matchOverrides).length > 0 && (
          <span className="rounded border border-info-line bg-info px-2 py-1 text-xs font-semibold text-info-content">
            Match overrides
          </span>
        )}
      </div>

      {!readOnly && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-content">
            Match foul limit
            <input
              type="number"
              min={1}
              max={20}
              value={resolution.value.rules.personalFoulLimit}
              onChange={change => {
                const value = Number(change.target.value)
                if (Number.isInteger(value)) updateFoulLimit(Math.max(1, Math.min(20, value)))
              }}
              className="input-field mt-1"
            />
          </label>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-content-muted">Changes apply only to this game.</p>
            {Object.keys(event.matchOverrides).length > 0 && (
              <button
                type="button"
                className="text-xs font-semibold text-info-content underline"
                onClick={() => onMatchOverridesChange?.({})}
              >
                Reset match overrides
              </button>
            )}
          </div>
        </div>
      )}

      <BasketballRulesSummary
        resolution={resolution.value}
        layerId={authority.kind}
        profileSourceLabel={authorityLabel}
        overrideSourceLabel={`${authorityLabel.slice(0, -1)} override`}
        sourceLabels={{
          built_in: 'Built-in profile',
          personal: 'Personal override',
          team: 'Team override',
          match: 'Match override',
        }}
      />
    </section>
  )
}
