import { BadgeAlert, ChevronRight, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useBasketballRecorderPresence } from '../../hooks/useBasketballRecorderPresence'
import {
  basketballRecorderNeedsAttention,
  primaryBasketballRecorder,
} from '../../lib/basketball/recorders'
import { gameInfoPath } from '../../lib/teamInfo'

interface BasketballRecorderStatusProps {
  gameId: string
  teamId: string | null
  refreshSignal: string | null
}

export default function BasketballRecorderStatus({
  gameId,
  teamId,
  refreshSignal,
}: BasketballRecorderStatusProps) {
  const navigate = useNavigate()
  const { recorders, loading, error } = useBasketballRecorderPresence(gameId, refreshSignal)
  const primary = primaryBasketballRecorder(recorders)
  const attentionCount = recorders.filter(basketballRecorderNeedsAttention).length

  if (!loading && !error && recorders.length === 0) return null

  return (
    <button
      type="button"
      onClick={() => navigate(gameInfoPath(gameId, teamId))}
      className="mt-3 flex min-h-12 w-full items-center gap-3 border-y border-slate-200 bg-white px-1 text-left"
    >
      <Users size={19} className="shrink-0 text-blue-700" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-800">
          {loading && recorders.length === 0
            ? 'Loading recorder streams...'
            : error && recorders.length === 0
              ? 'Recorder status unavailable'
              : `${recorders.length} ${recorders.length === 1 ? 'recorder' : 'recorders'}`}
        </span>
        <span className="block truncate text-xs text-slate-500">
          {error
            ? error
            : primary
              ? `Primary: ${primary.displayName}${
                  attentionCount > 0
                    ? ` - ${attentionCount} ${attentionCount === 1 ? 'stream needs' : 'streams need'} attention`
                    : ''
                }`
              : 'Primary recorder pending'}
        </span>
      </span>
      {attentionCount > 0 && (
        <BadgeAlert
          size={17}
          className="shrink-0 text-amber-600"
          aria-label={`${attentionCount} recorder streams need attention`}
        />
      )}
      <ChevronRight size={18} className="shrink-0 text-slate-400" />
    </button>
  )
}
