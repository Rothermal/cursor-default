import type { BasketballSummaryTab } from '../../lib/basketball/summary'

interface Props {
  activeTab: BasketballSummaryTab
  onChange: (tab: BasketballSummaryTab) => void
  /** The Plays map shows once the game has a located play (BKE-7D). */
  showPlays?: boolean
}

const TABS: Array<{ id: BasketballSummaryTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'players', label: 'Players' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'shots', label: 'Shots' },
  { id: 'plays', label: 'Plays' },
  { id: 'team', label: 'Team Stats' },
]

export default function BasketballSummaryTabs({ activeTab, onChange, showPlays = false }: Props) {
  return (
    <nav className="sticky top-0 z-10 border-b border-line bg-surface" aria-label="Summary views">
      <div className="mx-auto flex h-12 max-w-5xl items-stretch overflow-x-auto px-4">
        {TABS.filter(tab => tab.id !== 'plays' || showPlays || activeTab === 'plays').map(tab => (
          <button
            key={tab.id}
            id={`basketball-${tab.id}-tab`}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`shrink-0 border-b-2 px-3 text-sm font-bold ${
              activeTab === tab.id
                ? 'border-info-line text-info-content'
                : 'border-transparent text-content-subtle'
            }`}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
