import React, { useState } from 'react'
import { useDraftStore } from '../store/draftStore'
import TeamDetailsModal from './TeamDetailsModal'

function AllTeamsSummary() {
  const { teams, config, availablePlayers } = useDraftStore()
  const [teamDetailsModal, setTeamDetailsModal] = useState({ isOpen: false, team: null })

  const openTeamDetails = (team) => {
    setTeamDetailsModal({ isOpen: true, team })
  }

  const closeTeamDetails = () => {
    setTeamDetailsModal({ isOpen: false, team: null })
  }

  const calculateFullRosterPoints = (team) => {
    return team.roster.reduce((total, player) => total + (player.projectedPoints || 0), 0)
  }

  const getStartingLineup = (team) => {
    const roster = [...team.roster]
    const rosterConfig = config?.rosterPositions || {}
    const starters = []

    // Get players by position, sorted by projected points (highest first)
    const playersByPosition = {
      QB: roster.filter(p => p.position === 'QB').sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0)),
      RB: roster.filter(p => p.position === 'RB').sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0)),
      WR: roster.filter(p => p.position === 'WR').sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0)),
      TE: roster.filter(p => p.position === 'TE').sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0)),
      K: roster.filter(p => p.position === 'K').sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0)),
      DST: roster.filter(p => p.position === 'DST').sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0))
    }

    // Select starters for each position
    Object.keys(rosterConfig).forEach(position => {
      if (position === 'FLEX' || position === 'SUPERFLEX' || position === 'BENCH') return
      
      const count = rosterConfig[position]
      const available = playersByPosition[position] || []
      
      for (let i = 0; i < count && i < available.length; i++) {
        starters.push(available[i])
      }
    })

    // Handle FLEX position (RB/WR/TE not already starting)
    if (rosterConfig.FLEX && rosterConfig.FLEX > 0) {
      const flexEligible = [
        ...playersByPosition.RB.slice(rosterConfig.RB || 0),
        ...playersByPosition.WR.slice(rosterConfig.WR || 0),
        ...playersByPosition.TE.slice(rosterConfig.TE || 0)
      ].sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0))

      for (let i = 0; i < rosterConfig.FLEX && i < flexEligible.length; i++) {
        starters.push(flexEligible[i])
      }
    }

    // Handle SUPERFLEX position (any position not already starting)
    if (rosterConfig.SUPERFLEX && rosterConfig.SUPERFLEX > 0) {
      const superflexEligible = [
        ...playersByPosition.QB.slice(rosterConfig.QB || 0),
        ...playersByPosition.RB.slice(rosterConfig.RB || 0),
        ...playersByPosition.WR.slice(rosterConfig.WR || 0),
        ...playersByPosition.TE.slice(rosterConfig.TE || 0)
      ].sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0))

      for (let i = 0; i < rosterConfig.SUPERFLEX && i < superflexEligible.length; i++) {
        starters.push(superflexEligible[i])
      }
    }

    return starters
  }

  const calculateStarterPoints = (team) => {
    const starters = getStartingLineup(team)
    return starters.reduce((total, player) => total + (player.projectedPoints || 0), 0)
  }

  return (
    <div className="card all-teams-summary">
      <div className="teams-summary-header">
        <h3>All Teams Summary</h3>
      </div>
      
      <div className="teams-grid">
        {teams.map(team => {
          const totalPoints = calculateFullRosterPoints(team)
          const starterPoints = calculateStarterPoints(team)
          const totalSpots = Object.values(config.rosterPositions || {}).reduce((sum, count) => sum + count, 0)
          const spent = team.budget - team.remainingBudget

          return (
            <div key={team.id} className={`team-summary ${team.isHuman ? 'human-team' : ''}`}>
              <div
                className="team-name clickable"
                onClick={() => openTeamDetails(team)}
                title="Click to view team details"
              >
                {team.name}{team.isHuman ? ' (You)' : ''}
                {team.draftStrategy?.preferences?.homeTeam && (
                  <span className="ts-home-team" title={`Home team: ${team.draftStrategy.preferences.homeTeam}`}>
                    {' '}♥ {team.draftStrategy.preferences.homeTeam}
                  </span>
                )}
              </div>
              <div className="ts-stat-grid">
                <div className="ts-stat">
                  <span className="ts-stat-label">Budget</span>
                  <span className="ts-stat-value ts-stat-value--money">${team.remainingBudget}</span>
                </div>
                <div className="ts-stat">
                  <span className="ts-stat-label">Max Bid</span>
                  <span className="ts-stat-value ts-stat-value--money">${team.maxBid}</span>
                </div>
                <div className="ts-stat">
                  <span className="ts-stat-label">Roster</span>
                  <span className="ts-stat-value">{team.roster.length}/{totalSpots}</span>
                </div>
                <div className="ts-stat">
                  <span className="ts-stat-label">Spent</span>
                  <span className="ts-stat-value">${spent}</span>
                </div>
              </div>
              {team.roster.length > 0 && (
                <div className="ts-points">
                  <div className="ts-points-row">
                    <span className="ts-points-label">Starters</span>
                    <span className="ts-points-value ts-points-value--accent">{starterPoints.toFixed(1)} pts</span>
                  </div>
                  <div className="ts-points-row">
                    <span className="ts-points-label">Total</span>
                    <span className="ts-points-value">{totalPoints.toFixed(1)} pts</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      
      <TeamDetailsModal
        team={teamDetailsModal.team}
        isOpen={teamDetailsModal.isOpen}
        onClose={closeTeamDetails}
        allPlayers={[...availablePlayers, ...teams.flatMap(t => t.roster)]}
      />
    </div>
  )
}

export default AllTeamsSummary