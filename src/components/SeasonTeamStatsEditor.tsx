import { useState } from 'react'
import type { BasketballTeamStatsConfig } from '../types'
import {
  BASKETBALL_TEAM_STATS_DEFAULTS,
  BASKETBALL_PRESETS,
  getDefaultPeriodLabels,
} from '../config/teamStatsDefaults'

type Props = {
  value: BasketballTeamStatsConfig
  onChange: (next: BasketballTeamStatsConfig) => void
}

function mergePresetIntoDefaults(
  base: BasketballTeamStatsConfig,
  partial: Partial<BasketballTeamStatsConfig>
): BasketballTeamStatsConfig {
  const periodsPerGame =
    typeof partial.periodsPerGame === 'number' && partial.periodsPerGame >= 1
      ? Math.floor(partial.periodsPerGame)
      : base.periodsPerGame
  let periodLabels = base.periodLabels
  if (Array.isArray(partial.periodLabels) && partial.periodLabels.length === periodsPerGame) {
    periodLabels = partial.periodLabels
  } else if (partial.periodsPerGame != null) {
    periodLabels = getDefaultPeriodLabels(periodsPerGame)
  }
  return {
    ...base,
    ...partial,
    periodsPerGame,
    periodLabels,
    bonusThreshold:
      typeof partial.bonusThreshold === 'number' && partial.bonusThreshold >= 1
        ? partial.bonusThreshold
        : base.bonusThreshold,
    doubleBonusThreshold:
      typeof partial.doubleBonusThreshold === 'number' && partial.doubleBonusThreshold >= 1
        ? partial.doubleBonusThreshold
        : base.doubleBonusThreshold,
    hasOneAndOne:
      typeof partial.hasOneAndOne === 'boolean' ? partial.hasOneAndOne : base.hasOneAndOne,
    overtimeLabel:
      typeof partial.overtimeLabel === 'string' && partial.overtimeLabel.length > 0
        ? partial.overtimeLabel
        : base.overtimeLabel,
    overtimeFoulsReset:
      typeof partial.overtimeFoulsReset === 'boolean'
        ? partial.overtimeFoulsReset
        : base.overtimeFoulsReset,
    timeoutsPerPeriod:
      partial.timeoutsPerPeriod !== undefined ? partial.timeoutsPerPeriod : base.timeoutsPerPeriod,
    timeoutsPerOvertime:
      partial.timeoutsPerOvertime !== undefined ? partial.timeoutsPerOvertime : base.timeoutsPerOvertime,
  }
}

export default function SeasonTeamStatsEditor({ value, onChange }: Props) {
  const [presetSelectKey, setPresetSelectKey] = useState(0)

  const setPeriodLabel = (index: number, label: string) => {
    const next = [...value.periodLabels]
    next[index] = label
    onChange({ ...value, periodLabels: next })
  }

  return (
    <div className="space-y-3 pt-2 border-t border-slate-100">
      <p className="text-xs text-slate-500">
        Used for team fouls, timeouts, and period controls during games in this season.
      </p>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Rules preset</label>
        <select
          key={presetSelectKey}
          className="input-field"
          value=""
          aria-label="Apply basketball team stats preset"
          onChange={e => {
            const id = e.target.value
            if (!id) return
            const preset = BASKETBALL_PRESETS.find(p => p.id === id)
            if (preset) {
              onChange(mergePresetIntoDefaults({ ...BASKETBALL_TEAM_STATS_DEFAULTS }, preset.config))
            }
            setPresetSelectKey(k => k + 1)
          }}
        >
          <option value="">Apply a preset…</option>
          {BASKETBALL_PRESETS.map(p => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Regulation periods</label>
        <input
          type="number"
          min={1}
          max={8}
          className="input-field"
          value={value.periodsPerGame}
          onChange={e => {
            const n = Math.min(8, Math.max(1, Math.floor(Number(e.target.value) || 1)))
            onChange({
              ...value,
              periodsPerGame: n,
              periodLabels: getDefaultPeriodLabels(n),
            })
          }}
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-600">Period labels</p>
        {value.periodLabels.map((label, i) => (
          <input
            key={i}
            type="text"
            className="input-field"
            value={label}
            onChange={e => setPeriodLabel(i, e.target.value)}
            aria-label={`Period ${i + 1} label`}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Bonus fouls</label>
          <input
            type="number"
            min={1}
            max={99}
            className="input-field"
            value={value.bonusThreshold}
            onChange={e =>
              onChange({
                ...value,
                bonusThreshold: Math.max(1, Math.floor(Number(e.target.value) || 1)),
              })
            }
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Double bonus</label>
          <input
            type="number"
            min={1}
            max={99}
            className="input-field"
            value={value.doubleBonusThreshold}
            onChange={e =>
              onChange({
                ...value,
                doubleBonusThreshold: Math.max(1, Math.floor(Number(e.target.value) || 1)),
              })
            }
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={value.hasOneAndOne}
          onChange={e => onChange({ ...value, hasOneAndOne: e.target.checked })}
        />
        1-and-1 before double bonus
      </label>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Overtime label</label>
        <input
          type="text"
          className="input-field"
          value={value.overtimeLabel}
          onChange={e => onChange({ ...value, overtimeLabel: e.target.value || 'OT' })}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={value.overtimeFoulsReset}
          onChange={e => onChange({ ...value, overtimeFoulsReset: e.target.checked })}
        />
        Reset team fouls each overtime
      </label>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Timeouts / period</label>
          <input
            type="number"
            min={0}
            className="input-field"
            placeholder="Unlimited"
            value={value.timeoutsPerPeriod ?? ''}
            onChange={e => {
              const raw = e.target.value
              onChange({
                ...value,
                timeoutsPerPeriod: raw === '' ? null : Math.max(0, Math.floor(Number(raw))),
              })
            }}
          />
          <p className="text-[10px] text-slate-400 mt-0.5">Blank = no limit</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Timeouts / OT</label>
          <input
            type="number"
            min={0}
            className="input-field"
            placeholder="Same as reg."
            value={value.timeoutsPerOvertime ?? ''}
            onChange={e => {
              const raw = e.target.value
              onChange({
                ...value,
                timeoutsPerOvertime: raw === '' ? null : Math.max(0, Math.floor(Number(raw))),
              })
            }}
          />
          <p className="text-[10px] text-slate-400 mt-0.5">Blank = same as regulation</p>
        </div>
      </div>
    </div>
  )
}
