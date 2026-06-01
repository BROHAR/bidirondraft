import React from 'react'
import { useDraftStore } from '../store/draftStore'

function DraftProgress() {
  const { teams, availablePlayers } = useDraftStore()
  
  const isComplete = availablePlayers.length === 0 || teams.every(t => t.getRosterSpotsRemaining() === 0)
  
  const totalPlayers = teams.length * Object.values(useDraftStore.getState().config.rosterPositions || {}).reduce((sum, count) => sum + count, 0)
  const playersDrafted = teams.reduce((sum, team) => sum + team.roster.length, 0)
  const progressPercentage = (playersDrafted / totalPlayers) * 100

  return (
    <div className="card draft-progress-section">
      <div className="progress-header">
        <h4>Draft Progress</h4>
        {isComplete && (
          <div className="completion-badge">
            🎉 Complete!
          </div>
        )}
      </div>

      <div className="progress-stats-horizontal">
        <div className="stat">
          <label>Players Drafted</label>
          <span className="stat-value">{playersDrafted} / {totalPlayers}</span>
        </div>
        
        <div className="stat">
          <label>Available Players</label>
          <span className="stat-value">{availablePlayers.length}</span>
        </div>
        
        <div className="stat">
          <label>Total Budget Spent</label>
          <span className="stat-value">
            ${teams.reduce((sum, team) => sum + (team.budget - team.remainingBudget), 0)}
          </span>
        </div>
        
        <div className="stat">
          <label>Progress</label>
          <span className="stat-value">{Math.round(progressPercentage)}%</span>
        </div>
      </div>
      
      <div className="progress-bar-section">
        <div className="progress-bar">
          <div 
            className="progress-fill"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
      </div>
    </div>
  )
}

export default DraftProgress