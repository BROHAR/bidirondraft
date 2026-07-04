import React, { useState, useMemo } from 'react'
import { useDraftStore } from '../store/draftStore'
import { autoPilotService } from '../services/autoPilotService'
import { getStrategyOptions } from '../strategies/registry'
import ConfirmDialog from './ConfirmDialog'

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
    config,
    toggleAutoPilot,
    setAutoPilotStrategy,
    simulateToEnd
  } = useDraftStore()

  const humanTeam = teams.find(t => t.isHuman)
  const [confirmSimulate, setConfirmSimulate] = useState(false)

  // Same option source as the setup screen, so custom strategies stay
  // available mid-draft. Labels drop the long descriptions to fit the panel.
  const strategies = useMemo(
    () => getStrategyOptions(config?.customStrategies).map(o => ({
      ...o,
      label: o.label.split(' - ')[0],
    })),
    [config?.customStrategies]
  )

  if (!humanTeam) {
    return null
  }

  const canSimulateToEnd = autoPilotEnabled &&
    ['NOMINATING', 'BIDDING', 'PAUSED'].includes(draftState)

  const handleSimulateToEnd = () => {
    simulateToEnd()
    setConfirmSimulate(false)
  }

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
              onClick={() => setConfirmSimulate(true)}
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

      <ConfirmDialog
        open={confirmSimulate}
        title="Simulate to End?"
        message="The AI finishes the rest of the draft and jumps straight to the results. Picks so far are kept. This cannot be undone."
        confirmLabel="Simulate"
        onConfirm={handleSimulateToEnd}
        onCancel={() => setConfirmSimulate(false)}
      />
    </div>
  )
}

export default AutoPilotControl