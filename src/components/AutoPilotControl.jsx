import React from 'react'
import { useDraftStore } from '../store/draftStore'
import { autoPilotService } from '../services/autoPilotService'

function AutoPilotControl() {
  const { 
    autoPilotEnabled, 
    autoPilotStrategy,
    teams,
    availablePlayers,
    currentPlayer,
    currentBid,
    draftState,
    currentNominator,
    toggleAutoPilot,
    setAutoPilotStrategy,
    simulateToEnd
  } = useDraftStore()

  const humanTeam = teams.find(t => t.isHuman)

  if (!humanTeam) {
    return null
  }

  const canSimulateToEnd = autoPilotEnabled &&
    ['NOMINATING', 'BIDDING', 'PAUSED'].includes(draftState)

  const handleSimulateToEnd = () => {
    if (confirm('Simulate the rest of the draft and jump straight to the results? Picks so far are kept, but this cannot be undone.')) {
      simulateToEnd()
    }
  }

  const strategies = [
    { value: 'Balanced', label: 'Balanced' },
    { value: 'ValueHunter', label: 'Value Hunter' },
    { value: 'StarsAndScrubs', label: 'Stars & Scrubs' },
    { value: 'ZeroRB', label: 'Zero RB' },
    { value: 'HeroRB', label: 'Hero RB' },
    { value: 'LateRoundQB', label: 'Late Round QB' }
  ]

  const getNextAction = () => {
    if (!autoPilotEnabled) {
      return { type: 'manual', description: 'Manual control - Auto-pilot disabled' }
    }

    return autoPilotService.getNextAction(
      humanTeam,
      currentPlayer,
      currentBid,
      availablePlayers,
      draftState,
      currentNominator
    )
  }

  const nextAction = getNextAction()

  return (
    <div className="card auto-pilot-control">
      <div className="autopilot-header">
        <h4>Auto-Pilot</h4>
        <div className={`autopilot-status ${autoPilotEnabled ? 'active' : 'inactive'}`}>
          {autoPilotEnabled ? 'ACTIVE' : 'MANUAL'}
        </div>
      </div>

      <div className="autopilot-controls">
        <div className="form-group">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={autoPilotEnabled}
              onChange={toggleAutoPilot}
            />
            <span>Enable Auto-Pilot</span>
          </label>
        </div>

        {autoPilotEnabled && (
          <div className="form-group">
            <label>Strategy</label>
            <select
              value={autoPilotStrategy}
              onChange={(e) => setAutoPilotStrategy(e.target.value)}
            >
              {strategies.map(strategy => (
                <option key={strategy.value} value={strategy.value}>
                  {strategy.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {canSimulateToEnd && (
          <div className="form-group">
            <button
              className="btn btn-primary simulate-to-end-btn"
              onClick={handleSimulateToEnd}
            >
              Simulate to End
            </button>
          </div>
        )}
      </div>

      <div className="autopilot-status-info">
        <div className="next-action">
          <label>Next Action:</label>
          <div className={`action-description ${nextAction.type}`}>
            {nextAction.description}
          </div>
        </div>

        {autoPilotEnabled && humanTeam.playerValueAdjustments && humanTeam.playerValueAdjustments.size > 0 && (
          <div className="value-adjustments-info">
            <small>
              {humanTeam.playerValueAdjustments.size} player value adjustments active
            </small>
          </div>
        )}
      </div>

      {autoPilotEnabled && (draftState === 'NOMINATING' || draftState === 'BIDDING') && (
        <div className="autopilot-activity">
          <div className="activity-indicator">
            <div className="spinner"></div>
            <span>AI thinking...</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default AutoPilotControl