import BasketballCourt from '../components/shot-chart/BasketballCourt'
import type { ShotRecord } from '../types'

/** Sample layout for visually checking court geometry (dev route only). */
const SAMPLE_SHOTS: ShotRecord[] = [
  { id: '1', x: 0, y: 8, made: true, shotType: '2pt', zone: 'paint', playerId: 'p', timestamp: 0 },
  { id: '2', x: -4, y: 14, made: false, shotType: '2pt', zone: 'mid_range', playerId: 'p', timestamp: 0 },
  { id: '3', x: 18, y: 12, made: true, shotType: '3pt', zone: 'three', playerId: 'p', timestamp: 0 },
  { id: '4', x: -20, y: 11, made: false, shotType: '3pt', zone: 'three', playerId: 'p', timestamp: 0 },
  { id: '5', x: 6, y: 22, made: true, shotType: '2pt', zone: 'mid_range', playerId: 'p', timestamp: 0 },
]

export default function ShotChartPreview() {
  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <h1 className="text-sm font-medium text-slate-600 mb-3">Shot chart preview (dev)</h1>
      <div className="max-w-md mx-auto rounded-xl bg-white p-4 shadow-sm border border-slate-200">
        <BasketballCourt shots={SAMPLE_SHOTS} className="w-full" />
      </div>
    </div>
  )
}
