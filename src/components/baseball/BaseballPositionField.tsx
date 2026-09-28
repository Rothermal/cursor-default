import { useId, useState } from 'react'
import { BASEBALL_POSITION_MAX_LENGTH, BASEBALL_POSITION_OPTIONS } from '../../lib/baseball/positions'

export default function BaseballPositionField({ value, onChange, disabled = false }: {
  value: string | null
  onChange: (value: string | null) => void
  disabled?: boolean
}) {
  const id = useId()
  const [customSelected, setCustomSelected] = useState(false)
  const [customText, setCustomText] = useState(value ?? '')
  const standard = BASEBALL_POSITION_OPTIONS.some(position => position.code === value)
  const custom = customSelected || (value !== null && !standard)
  return <div className="min-w-0 space-y-1">
    <label htmlFor={id} className="text-sm font-medium text-content">Position</label>
    <select id={id} value={custom ? '__custom__' : value ?? ''} disabled={disabled}
      onChange={event => {
        setCustomSelected(event.target.value === '__custom__')
        if (event.target.value === '__custom__') setCustomText('')
        onChange(event.target.value === '__custom__' ? null : event.target.value || null)
      }}
      className="input-field w-full">
      <option value="">Unassigned</option>
      {BASEBALL_POSITION_OPTIONS.map(position =>
        <option key={position.code} value={position.code}>{position.code} · {position.label}</option>)}
      <option value="__custom__">Custom</option>
    </select>
    {custom && <input aria-label="Custom position" value={customSelected ? customText : value ?? ''} disabled={disabled}
      maxLength={BASEBALL_POSITION_MAX_LENGTH} className="input-field w-full"
      onChange={event => {
        setCustomSelected(true)
        setCustomText(event.target.value)
        onChange(event.target.value)
      }} />}
  </div>
}
