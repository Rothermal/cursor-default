import type { SoccerSummaryTab } from '../../lib/soccer/summary'

interface SoccerSummaryTabsProps {
  activeTab: SoccerSummaryTab
  showPlayers: boolean
  showTimeline: boolean
  showField: boolean
  showShootout: boolean
  onChange: (tab: SoccerSummaryTab) => void
}

const TABS: Array<{ id: SoccerSummaryTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'players', label: 'Players' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'field', label: 'Field' },
  { id: 'shootout', label: 'Shootout' },
]

export default function SoccerSummaryTabs({
  activeTab,
  showPlayers,
  showTimeline,
  showField,
  showShootout,
  onChange,
}: SoccerSummaryTabsProps) {
  const tabs = TABS.filter(tab =>
    tab.id === 'overview' ||
    (tab.id === 'players' && showPlayers) ||
    (tab.id === 'timeline' && showTimeline) ||
    (tab.id === 'field' && showField) ||
    (tab.id === 'shootout' && showShootout)
  )
  return (
    <nav
      className="sticky top-0 z-30 border-b border-line bg-surface"
      aria-label="Summary sections"
    >
      <div className="mx-auto flex h-12 max-w-2xl items-stretch overflow-x-auto px-4">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`shrink-0 border-b-2 px-3 text-sm font-bold ${
              activeTab === tab.id
                ? 'border-success-line text-success-content'
                : 'border-transparent text-content-muted'
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
