import type { BasketballSummaryTab } from '../../lib/basketball/summary'

interface Props {
  activeTab: BasketballSummaryTab
  onChange: (tab: BasketballSummaryTab) => void
}

const TABS: Array<{ id: BasketballSummaryTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'players', label: 'Players' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'shots', label: 'Shots' },
  { id: 'team', label: 'Team Stats' },
]

export default function BasketballSummaryTabs({ activeTab, onChange }: Props) {
  return (
    <nav className="sticky top-0 z-10 border-b border-line bg-surface" aria-label="Summary views">
      <div className="mx-auto flex h-12 max-w-5xl items-stretch overflow-x-auto px-4">
        {TABS.map(tab => (
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
