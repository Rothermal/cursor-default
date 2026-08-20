import type { BasketballSummaryTab } from '../../lib/basketball/summary'

interface Props {
  activeTab: BasketballSummaryTab
  onChange: (tab: BasketballSummaryTab) => void
}

const TABS: Array<{ id: BasketballSummaryTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'players', label: 'Players' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'team', label: 'Team Stats' },
]

export default function BasketballSummaryTabs({ activeTab, onChange }: Props) {
  return (
    <nav className="sticky top-0 z-10 border-b border-slate-200 bg-white" aria-label="Summary views">
      <div className="mx-auto flex h-12 max-w-5xl items-stretch overflow-x-auto px-4">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`shrink-0 border-b-2 px-3 text-sm font-bold ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500'
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
