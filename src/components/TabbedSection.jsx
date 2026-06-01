import React, { useState } from 'react'
import TeamRosters from './TeamRosters'
import AllTeamsSummary from './AllTeamsSummary'
import DraftHistory from './DraftHistory'

function TabbedSection() {
  const [activeTab, setActiveTab] = useState('rosters')

  const tabs = [
    { id: 'rosters', label: 'Team Rosters', component: TeamRosters },
    { id: 'allteams', label: 'All Teams', component: AllTeamsSummary },
    { id: 'history', label: 'Draft History', component: DraftHistory }
  ]

  const ActiveComponent = tabs.find(tab => tab.id === activeTab)?.component || TeamRosters

  return (
    <div className="tabbed-section">
      <div className="tab-nav">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="tab-content">
        <ActiveComponent />
      </div>
    </div>
  )
}

export default TabbedSection