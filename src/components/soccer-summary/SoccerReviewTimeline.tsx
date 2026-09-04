import SoccerTimeline from '../soccer/SoccerTimeline'
import {
  canEditSoccerSummaryTimeline,
  type SoccerLiveResult,
} from '../../lib/soccer'
import type { SoccerSummarySource } from '../../lib/soccer/summarySource'

interface SoccerReviewTimelineProps {
  source: SoccerSummarySource
  recorderUserId: string | null
  busy: boolean
  onApply: (result: SoccerLiveResult) => boolean
}

export default function SoccerReviewTimeline({
  source,
  recorderUserId,
  busy,
  onApply,
}: SoccerReviewTimelineProps) {
  const soccerState = source.state.sportGameState?.sportId === 'soccer'
    ? source.state.sportGameState
    : null
  const editable = canEditSoccerSummaryTimeline(source)

  return (
    <main className="mx-auto max-w-2xl pb-10">
      <section className="bg-white px-4 py-4">
        <SoccerTimeline
          state={source.state}
          inspection={source.inspection}
          busy={busy}
          onApply={onApply}
          recorderUserId={recorderUserId}
          defaultTeamSide={soccerState?.capturePreferences.teamSide ?? 'tracked'}
          allowAddEvent={!soccerState?.projection.shootout}
          readOnly={!editable}
          presentation="review"
        />
      </section>
    </main>
  )
}
