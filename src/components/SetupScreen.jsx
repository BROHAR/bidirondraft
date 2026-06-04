import React, { useState, useEffect, useMemo } from 'react'
import { useDraftStore } from '../store/draftStore'
import { DraftConfig, DEFAULT_CONFIGS } from '../models/DraftConfig'
import playersData from '../data/players.json'
import PlayerValueModal from './PlayerValueModal'
import PlayerCustomizationModal from './PlayerCustomizationModal'
import { NFL_TEAMS } from '../strategies/TacoStrategy'
import {
  loadOverrides,
  saveOverrides,
  applyOverrides,
  countOverrides,
} from '../utils/playerOverrides'

function SetupScreen() {
  const { initializeDraft, simulateDraft } = useDraftStore()
  const [config, setConfig] = useState({
    numberOfTeams: 12,
    budgetPerTeam: 200,
    humanTeamName: 'Your Team',
    humanDraftPosition: 1,
    nominationTimer: 20,
    biddingTimer: 20,
    minBidIncrement: 1,
    scoringFormat: 'halfPPR',
    rosterPositions: DEFAULT_CONFIGS.standard.rosterPositions,
    autoPilotEnabled: false,
    autoPilotStrategy: 'Balanced',
    aiTeamStrategies: [],
    aiTeamHomeTeams: []
  })
  
  const [playerValueAdjustments, setPlayerValueAdjustments] = useState(new Map())
  const [showValueModal, setShowValueModal] = useState(false)
  const [simulateError, setSimulateError] = useState(null)
  const [aiBidderProfilesEnabled, setAiBidderProfilesEnabled] = useState(false)
  const [playerOverrides, setPlayerOverrides] = useState(() => loadOverrides())
  const [showCustomizationModal, setShowCustomizationModal] = useState(false)

  useEffect(() => {
    if (config.autoPilotEnabled) setSimulateError(null)
  }, [config.autoPilotEnabled])

  useEffect(() => {
    saveOverrides(playerOverrides)
  }, [playerOverrides])

  const customizedPlayersData = useMemo(
    () => applyOverrides(playersData, playerOverrides),
    [playerOverrides]
  )
  const overrideCount = countOverrides(playerOverrides)
  
  const strategies = [
    { value: 'Balanced', label: 'Balanced - Even focus across all positions' },
    { value: 'ValueHunter', label: 'Value Hunter - Target undervalued players' },
    { value: 'StarsAndScrubs', label: 'Stars & Scrubs - Elite players and cheap bench' },
    { value: 'ZeroRB', label: 'Zero RB - Avoid early running backs' },
    { value: 'HeroRB', label: 'Hero RB - Target elite running back early' },
    { value: 'LateRoundQB', label: 'Late Round QB - Wait on quarterbacks' },
    { value: 'Taco', label: 'Taco - Homer fan, overpays for top QBs, stacks K/DST' }
  ]

  const handleConfigChange = (field, value) => {
    setConfig(prev => ({
      ...prev,
      [field]: value
    }))
  }

  const handleAiStrategyChange = (positionIndex, value) => {
    setConfig(prev => {
      const next = [...(prev.aiTeamStrategies || [])]
      next[positionIndex] = value
      // A home team only applies to Taco; drop it if the slot moves off Taco.
      const homeTeams = [...(prev.aiTeamHomeTeams || [])]
      if (value !== 'Taco') homeTeams[positionIndex] = ''
      return { ...prev, aiTeamStrategies: next, aiTeamHomeTeams: homeTeams }
    })
  }

  const handleAiHomeTeamChange = (positionIndex, value) => {
    setConfig(prev => {
      const next = [...(prev.aiTeamHomeTeams || [])]
      next[positionIndex] = value
      return { ...prev, aiTeamHomeTeams: next }
    })
  }

  const handleRosterChange = (position, value) => {
    setConfig(prev => ({
      ...prev,
      rosterPositions: {
        ...prev.rosterPositions,
        [position]: parseInt(value) || 0
      }
    }))
  }

  const loadPreset = (preset) => {
    setConfig({
      ...config,
      ...DEFAULT_CONFIGS[preset]
    })
  }

  const startDraft = () => {
    const draftConfig = new DraftConfig(config)
    const validation = draftConfig.validate()
    
    if (!validation.isValid) {
      alert('Configuration errors:\n' + validation.errors.join('\n'))
      return
    }
    
    // Include auto-pilot configuration and player value adjustments.
    // aiTeamStrategies only applies when the Config AI Bidder Profiles
    // toggle is on — otherwise the engine falls back to its default mix.
    const configWithAutoPilot = {
      ...config,
      aiTeamStrategies: aiBidderProfilesEnabled ? config.aiTeamStrategies : [],
      aiTeamHomeTeams: aiBidderProfilesEnabled ? config.aiTeamHomeTeams : [],
      playerValueAdjustments: playerValueAdjustments,
      playerOverrides
    }

    initializeDraft(configWithAutoPilot, customizedPlayersData)
  }

  const runSimulation = () => {
    if (!config.autoPilotEnabled) {
      setSimulateError('Enable Auto-Pilot and select a Draft Strategy before simulating.')
      return
    }

    const draftConfig = new DraftConfig(config)
    const validation = draftConfig.validate()

    if (!validation.isValid) {
      alert('Configuration errors:\n' + validation.errors.join('\n'))
      return
    }

    setSimulateError(null)
    simulateDraft({
      ...config,
      aiTeamStrategies: aiBidderProfilesEnabled ? config.aiTeamStrategies : [],
      aiTeamHomeTeams: aiBidderProfilesEnabled ? config.aiTeamHomeTeams : [],
      playerValueAdjustments,
      playerOverrides
    }, customizedPlayersData)
  }

  return (
    <div className="setup-screen">
      <div className="card">
        <h2>Draft Configuration</h2>
        
        <div className="preset-buttons">
          <button 
            className="btn btn-secondary"
            onClick={() => loadPreset('standard')}
          >
            Standard League
          </button>
          <button 
            className="btn btn-secondary"
            onClick={() => loadPreset('superflex')}
          >
            Superflex League
          </button>
        </div>

        <div className="grid grid-2">
          <div className="form-group">
            <label>Number of Teams</label>
            <select 
              value={config.numberOfTeams}
              onChange={(e) => handleConfigChange('numberOfTeams', parseInt(e.target.value))}
            >
              {Array.from({length: 7}, (_, i) => i + 8).map(num => (
                <option key={num} value={num}>{num} Teams</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Budget per Team</label>
            <input
              type="number"
              value={config.budgetPerTeam}
              onChange={(e) => handleConfigChange('budgetPerTeam', parseInt(e.target.value))}
              min="100"
              max="1000"
            />
          </div>

          <div className="form-group">
            <label>Your Team Name</label>
            <input
              type="text"
              value={config.humanTeamName}
              onChange={(e) => handleConfigChange('humanTeamName', e.target.value)}
              placeholder="Enter your team name"
            />
          </div>

          <div className="form-group">
            <label>Your Draft Position</label>
            <select
              value={config.humanDraftPosition}
              onChange={(e) => handleConfigChange('humanDraftPosition', parseInt(e.target.value))}
            >
              {Array.from({length: config.numberOfTeams}, (_, i) => i + 1).map(pos => (
                <option key={pos} value={pos}>Position {pos}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Scoring Format</label>
            <select
              value={config.scoringFormat}
              onChange={(e) => handleConfigChange('scoringFormat', e.target.value)}
            >
              <option value="standard">Standard</option>
              <option value="halfPPR">Half PPR</option>
              <option value="ppr">PPR</option>
            </select>
          </div>
        </div>

        <h3>Roster Positions</h3>
        <div className="grid grid-4">
          {Object.entries(config.rosterPositions).map(([position, count]) => (
            <div key={position} className="form-group">
              <label>{position}</label>
              <input
                type="number"
                value={count}
                onChange={(e) => handleRosterChange(position, e.target.value)}
                min="0"
                max="5"
              />
            </div>
          ))}
        </div>

        <div className="grid grid-2">
          <div className="form-group">
            <label>Nomination Timer (seconds)</label>
            <input
              type="number"
              value={config.nominationTimer}
              onChange={(e) => handleConfigChange('nominationTimer', parseInt(e.target.value))}
              min="10"
              max="60"
            />
          </div>

          <div className="form-group">
            <label>Bidding Timer (seconds)</label>
            <input
              type="number"
              value={config.biddingTimer}
              onChange={(e) => handleConfigChange('biddingTimer', parseInt(e.target.value))}
              min="10"
              max="60"
            />
          </div>
        </div>

        <div className="total-roster-size">
          <strong>Total Roster Size: {Object.values(config.rosterPositions).reduce((sum, count) => sum + count, 0)} players</strong>
        </div>

        <div className="customize-players-section">
          <div className="form-group">
            <label>Customize Player Data</label>
            <div className="customize-players-controls">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowCustomizationModal(true)}
              >
                Customize Players ({overrideCount} customized)
              </button>
              {overrideCount > 0 && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setPlayerOverrides({})}
                >
                  Clear Customizations
                </button>
              )}
            </div>
            <small>
              Override est value and projected points with your own projections. Saved in this browser until cleared; the draft uses these values for both you and the AI.
            </small>
          </div>
        </div>

        <div className="auto-pilot-section">
          <label className="section-toggle">
            <input
              type="checkbox"
              checked={config.autoPilotEnabled}
              onChange={(e) => handleConfigChange('autoPilotEnabled', e.target.checked)}
            />
            <span>Enable Auto-Pilot</span>
          </label>
          <small className="section-hint">Let AI handle your bidding and nominations automatically</small>

          {config.autoPilotEnabled && (
            <>
              <div className="form-group">
                <label>Draft Strategy</label>
                <select
                  value={config.autoPilotStrategy}
                  onChange={(e) => handleConfigChange('autoPilotStrategy', e.target.value)}
                >
                  {strategies.map(strategy => (
                    <option key={strategy.value} value={strategy.value}>
                      {strategy.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Player Value Adjustments</label>
                <div className="value-adjustments-controls">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowValueModal(true)}
                  >
                    Adjust Player Values ({playerValueAdjustments.size} modified)
                  </button>
                  {playerValueAdjustments.size > 0 && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => setPlayerValueAdjustments(new Map())}
                    >
                      Clear Adjustments
                    </button>
                  )}
                </div>
                <small>Fine-tune individual player values to match your preferences</small>
              </div>
            </>
          )}
        </div>

        <div className="advanced-config-section">
          <label className="section-toggle">
            <input
              type="checkbox"
              checked={aiBidderProfilesEnabled}
              onChange={(e) => setAiBidderProfilesEnabled(e.target.checked)}
            />
            <span>Config AI Bidder Profiles</span>
          </label>

          {aiBidderProfilesEnabled && (
            <>
              <small className="section-hint">Pin a bidder strategy for any AI team. Slots left on Mixed (default) use the standard distribution.</small>
              <div className="advanced-config-rows">
                {Array.from({ length: config.numberOfTeams }, (_, i) => i + 1)
                  .filter(p => p !== config.humanDraftPosition)
                  .map(p => (
                    <div key={p} className="advanced-config-row">
                      <label htmlFor={`ai-strategy-${p}`}>Team {p}</label>
                      <div className="advanced-config-selects">
                        <select
                          id={`ai-strategy-${p}`}
                          value={config.aiTeamStrategies[p - 1] || 'Mixed'}
                          onChange={(e) => handleAiStrategyChange(p - 1, e.target.value)}
                        >
                          <option value="Mixed">Mixed (default)</option>
                          {strategies.map(strategy => (
                            <option key={strategy.value} value={strategy.value}>
                              {strategy.label}
                            </option>
                          ))}
                        </select>
                        {config.aiTeamStrategies[p - 1] === 'Taco' && (
                          <select
                            id={`ai-hometeam-${p}`}
                            className="ai-hometeam-select"
                            aria-label={`Team ${p} home team`}
                            title="Home team Taco overpays for"
                            value={config.aiTeamHomeTeams[p - 1] || ''}
                            onChange={(e) => handleAiHomeTeamChange(p - 1, e.target.value)}
                          >
                            <option value="">♥ Home team: Random</option>
                            {NFL_TEAMS.map(team => (
                              <option key={team} value={team}>♥ {team}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>

        <div className="setup-actions">
          <div className="simulate-action">
            <button
              className="btn btn-secondary btn-large"
              onClick={runSimulation}
            >
              Simulate
            </button>
            {simulateError
              ? <div className="simulate-error">{simulateError}</div>
              : <div className="simulate-hint">Requires Auto-Pilot + Strategy</div>
            }
          </div>
          <button
            className="btn btn-primary btn-large"
            onClick={startDraft}
          >
            Start Draft
          </button>
        </div>
      </div>

      <PlayerValueModal
        isOpen={showValueModal}
        onClose={() => setShowValueModal(false)}
        players={customizedPlayersData.players}
        valueAdjustments={playerValueAdjustments}
        onUpdateAdjustment={(playerId, multiplier) => {
          const newAdjustments = new Map(playerValueAdjustments)
          if (multiplier === 1.0) {
            newAdjustments.delete(playerId)
          } else {
            newAdjustments.set(playerId, multiplier)
          }
          setPlayerValueAdjustments(newAdjustments)
        }}
      />

      <PlayerCustomizationModal
        isOpen={showCustomizationModal}
        onClose={() => setShowCustomizationModal(false)}
        basePlayers={playersData.players}
        overrides={playerOverrides}
        scoringFormat={config.scoringFormat}
        onChange={setPlayerOverrides}
        onClearAll={() => setPlayerOverrides({})}
      />
    </div>
  )
}

export default SetupScreen