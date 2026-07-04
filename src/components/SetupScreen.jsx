import React, { useState, useEffect, useMemo } from 'react'
import { useDraftStore } from '../store/draftStore'
import { DraftConfig, DEFAULT_CONFIGS } from '../models/DraftConfig'
import playersData from '../data/players.json'
import PlayerValueModal from './PlayerValueModal'
import PlayerCustomizationModal from './PlayerCustomizationModal'
import StrategyBuilderModal from './StrategyBuilderModal'
import { NFL_TEAMS } from '../strategies/TacoStrategy'
import { getStrategyOptions } from '../strategies/registry'
import {
  loadOverrides,
  saveOverrides,
  applyOverrides,
  countOverrides,
} from '../utils/playerOverrides'
import { loadSetupState, saveSetupState } from '../utils/setupConfigStore'
import { loadCustomStrategies, saveCustomStrategies } from '../utils/customStrategiesStore'
import '../styles/components/metaSimulation.css'

// The three ways to run a configured league. Presented as pick-one cards in
// step 2; the selected mode drives the final launch button in step 3.
const LAUNCH_MODES = [
  {
    key: 'live',
    tag: 'LIVE',
    title: 'Real Time',
    desc: 'Run the auction live and bid in real time against the AI — practice for a league like yours.',
    foot: '',
    cta: 'Start Draft →',
  },
  {
    key: 'sim',
    tag: 'ONE-SHOT',
    title: 'Simulate',
    desc: 'Auto-drafts the whole league in one shot, then shows the post-draft report.',
    foot: 'Requires Auto-Pilot Enabled',
    cta: 'Run Simulation →',
  },
  {
    key: 'meta',
    tag: 'BATCH · RANKED',
    title: 'Meta Sim',
    desc: 'Plays your seat with every strategy across many drafts, then ranks the best.',
    foot: '',
    cta: 'Run Meta Simulation →',
  },
]

// Draft-count choices for the Meta Sim (drafts run per strategy).
const DRAFT_COUNT_OPTIONS = [10, 20, 30, 40, 50]

// The wizard steps, in order. `step` state is 1-based.
const STEPS = [
  { num: 1, label: 'League Settings' },
  { num: 2, label: 'Draft or Sim Type' },
  { num: 3, label: 'AI & Strategy' },
]

function SetupScreen() {
  const { initializeDraft, simulateDraft, runMetaSimulation } = useDraftStore()
  // Restore the persisted setup config (survives refresh / new draft).
  const persisted = useMemo(() => loadSetupState(), [])
  const [config, setConfig] = useState(persisted.config)

  // Wizard position (1-3). Ephemeral — always starts on step 1.
  const [step, setStep] = useState(1)
  // Which run mode the final launch button will fire. Persisted.
  const [launchMode, setLaunchMode] = useState(persisted.launchMode)
  // Inline validation message shown next to the wizard nav.
  const [stepError, setStepError] = useState(null)

  const [playerValueAdjustments, setPlayerValueAdjustments] = useState(new Map())
  const [showValueModal, setShowValueModal] = useState(false)
  const [simulateError, setSimulateError] = useState(null)
  const [aiBidderProfilesEnabled, setAiBidderProfilesEnabled] = useState(persisted.aiBidderProfilesEnabled)
  const [metaDraftsPerStrategy, setMetaDraftsPerStrategy] = useState(
    () => Math.min(50, Math.max(10, persisted.metaDraftsPerStrategy))
  )
  const [playerOverrides, setPlayerOverrides] = useState(() => loadOverrides())
  const [showCustomizationModal, setShowCustomizationModal] = useState(false)
  const [customStrategies, setCustomStrategies] = useState(() => loadCustomStrategies())
  const [showStrategyModal, setShowStrategyModal] = useState(false)

  useEffect(() => {
    if (config.autoPilotEnabled) setSimulateError(null)
  }, [config.autoPilotEnabled])

  useEffect(() => {
    saveOverrides(playerOverrides)
  }, [playerOverrides])

  // Persist user-authored custom strategies so they survive refresh / new drafts.
  useEffect(() => {
    saveCustomStrategies(customStrategies)
  }, [customStrategies])

  // Persist the draft config + toggles so they survive refresh and new drafts.
  useEffect(() => {
    saveSetupState({ config, aiBidderProfilesEnabled, metaDraftsPerStrategy, launchMode })
  }, [config, aiBidderProfilesEnabled, metaDraftsPerStrategy, launchMode])

  const customizedPlayersData = useMemo(
    () => applyOverrides(playersData, playerOverrides),
    [playerOverrides]
  )
  const overrideCount = countOverrides(playerOverrides)

  // The presence of a SUPERFLEX roster slot is what makes a league superflex —
  // drives the active-preset highlight and the format badge below.
  const isSuperflex = (config.rosterPositions.SUPERFLEX || 0) > 0

  // Dropdown options: every built-in strategy plus the user's custom strategies.
  // Derived from the registry so the list lives in one place.
  const strategies = useMemo(() => getStrategyOptions(customStrategies), [customStrategies])

  // Live total roster size + whether it's within the valid range (mirrors
  // DraftConfig.validate); drives the inline counter's colour in step 1.
  const totalRosterSize = Object.values(config.rosterPositions).reduce((sum, count) => sum + count, 0)
  const rosterValid = totalRosterSize >= 10 && totalRosterSize <= 20

  // Simulate auto-drafts the human seat too, so it needs Auto-Pilot. Meta
  // force-enables it internally, so only Simulate constrains the UI here.
  const requiresAutoPilot = launchMode === 'sim'
  const activeMode = LAUNCH_MODES.find(m => m.key === launchMode) || LAUNCH_MODES[0]

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

  // Step a roster slot up/down, clamped to a sensible 0–7 per position.
  const handleRosterStep = (position, delta) => {
    setConfig(prev => {
      const current = prev.rosterPositions[position] || 0
      const next = Math.max(0, Math.min(7, current + delta))
      return {
        ...prev,
        rosterPositions: { ...prev.rosterPositions, [position]: next },
      }
    })
  }

  const loadPreset = (preset) => {
    setConfig({
      ...config,
      ...DEFAULT_CONFIGS[preset]
    })
  }

  // Choosing Simulate pre-sets Auto-Pilot on, since Simulate can't run without
  // it (matches the "pre-set the field" behaviour rather than blocking later).
  const chooseMode = (mode) => {
    setLaunchMode(mode)
    setSimulateError(null)
    if (mode === 'sim' && !config.autoPilotEnabled) {
      handleConfigChange('autoPilotEnabled', true)
    }
  }

  // Advance one step. Leaving step 1 validates the league config so field
  // errors surface inline here instead of only as an alert at launch time.
  const goNext = () => {
    if (step === 1) {
      const validation = new DraftConfig(config).validate()
      if (!validation.isValid) {
        setStepError(validation.errors.join(' · '))
        return
      }
    }
    setStepError(null)
    setStep(s => Math.min(3, s + 1))
  }

  const goToStep = (n) => {
    // Allow jumping back freely; jumping forward re-runs the same gate as Next.
    if (n < step) {
      setStepError(null)
      setStep(n)
    } else if (n > step) {
      goNext()
    }
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
      customStrategies,
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
      customStrategies,
      playerValueAdjustments,
      playerOverrides
    }, customizedPlayersData)
  }

  const runMeta = () => {
    // Meta sim rates strategies for the user's team, so it needs a real seat.
    if (!config.humanDraftPosition || config.humanDraftPosition < 1) {
      setSimulateError('Meta Simulation rates strategies for your team — set your draft position to a seat first.')
      return
    }

    const draftConfig = new DraftConfig(config)
    const validation = draftConfig.validate()

    if (!validation.isValid) {
      alert('Configuration errors:\n' + validation.errors.join('\n'))
      return
    }

    setSimulateError(null)
    runMetaSimulation({
      ...config,
      autoPilotEnabled: true,
      aiTeamStrategies: aiBidderProfilesEnabled ? config.aiTeamStrategies : [],
      aiTeamHomeTeams: aiBidderProfilesEnabled ? config.aiTeamHomeTeams : [],
      customStrategies,
      playerOverrides
    }, customizedPlayersData, {
      // Rate every built-in AND every custom strategy for the user's seat.
      // `strategies` (getStrategyOptions) already lists both; meta-sim resolves
      // custom display names from config.customStrategies.
      strategies: strategies.map(s => s.value),
      draftsPerStrategy: metaDraftsPerStrategy,
      baseSeed: 1,
    })
  }

  // Step 3's primary button fires the selected mode's launch action.
  const launch = () => {
    if (launchMode === 'sim') return runSimulation()
    if (launchMode === 'meta') return runMeta()
    return startDraft()
  }

  return (
    <div className="setup-screen">
      <div className="card">
        <h2>Draft Configuration</h2>

        {/* Step indicator — click a prior step to jump back. */}
        <ol className="setup-stepper" role="list">
          {STEPS.map(s => {
            const state = s.num < step ? 'done' : s.num === step ? 'active' : 'upcoming'
            return (
              <li key={s.num} className={`setup-step-pill ${state}`}>
                <button
                  type="button"
                  onClick={() => goToStep(s.num)}
                  aria-current={state === 'active' ? 'step' : undefined}
                >
                  <span className="step-num">{s.num}</span>
                  <span className="step-label">{s.label}</span>
                </button>
              </li>
            )
          })}
        </ol>

        {/* ---------------------------------------------------------------- */}
        {/* STEP 1 — League                                                  */}
        {/* ---------------------------------------------------------------- */}
        {step === 1 && (
        <div className="setup-step">
          <h3 className="setup-step-title">League Settings</h3>
          <p className="section-hint">The basics every draft needs.</p>

          <div className="preset-buttons">
            <button
              className={`btn ${isSuperflex ? 'btn-secondary' : 'btn-primary'}`}
              aria-pressed={!isSuperflex}
              onClick={() => loadPreset('standard')}
            >
              Standard League
            </button>
            <button
              className={`btn ${isSuperflex ? 'btn-primary' : 'btn-secondary'}`}
              aria-pressed={isSuperflex}
              onClick={() => loadPreset('superflex')}
            >
              Superflex League
            </button>
          </div>

          <div className="grid grid-3">
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
                max="2000"
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

          <div className="roster-header">
            <h3 className="roster-heading">Roster Positions</h3>
            <span className={`roster-total ${rosterValid ? '' : 'invalid'}`}>
              {totalRosterSize} players
            </span>
          </div>
          <div className="roster-grid">
            {Object.entries(config.rosterPositions).map(([position, count]) => (
              <div key={position} className="roster-slot">
                <span className="roster-slot-pos">{position}</span>
                <span className="roster-slot-count">{count}</span>
                <div className="roster-slot-steppers">
                  <button
                    type="button"
                    className="roster-step"
                    aria-label={`Decrease ${position}`}
                    onClick={() => handleRosterStep(position, -1)}
                    disabled={count <= 0}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="roster-step"
                    aria-label={`Increase ${position}`}
                    onClick={() => handleRosterStep(position, 1)}
                    disabled={count >= 7}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="customize-box">
            <div className="customize-box-text">
              <span className="customize-box-title">Customize Player Values</span>
              <small>Override est. $ and projected points — used across your league for both you and the AI. Saved in this browser's local storage until cleared.</small>
            </div>
            <div className="customize-box-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowCustomizationModal(true)}
              >
                Customize ({overrideCount}) →
              </button>
              {overrideCount > 0 && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setPlayerOverrides({})}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* STEP 2 — Draft or Sim Type                                       */}
        {/* ---------------------------------------------------------------- */}
        {step === 2 && (
        <div className="setup-step">
          <h3 className="setup-step-title">Draft or Sim Type</h3>
          <p className="section-hint">Three options — practice drafting live, or use simulation to collect data.</p>

          <div className="mode-cards">
            {LAUNCH_MODES.map(mode => {
              const selected = launchMode === mode.key
              return (
                <div key={mode.key} className="mode-card-slot">
                  <button
                    type="button"
                    className={`mode-card ${selected ? 'selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => chooseMode(mode.key)}
                  >
                    <span className="mode-card-dot" aria-hidden="true" />
                    <span className="mode-card-body">
                      <span className="mode-card-head">
                        <span className="mode-card-title">{mode.title}</span>
                        <span className="mode-card-tag">{mode.tag}</span>
                      </span>
                      <span className="mode-card-desc">{mode.desc}</span>
                      {mode.foot && <span className="mode-card-foot">{mode.foot}</span>}
                    </span>
                  </button>

                  {mode.key === 'meta' && selected && (
                    <div className="mode-card-extra">
                      <div className="draft-count">
                        <span className="draft-count-label">Drafts per strategy</span>
                        <div className="draft-count-options" role="group" aria-label="Drafts per strategy">
                          {DRAFT_COUNT_OPTIONS.map(n => (
                            <button
                              key={n}
                              type="button"
                              className={`draft-count-btn ${metaDraftsPerStrategy === n ? 'active' : ''}`}
                              aria-pressed={metaDraftsPerStrategy === n}
                              onClick={() => setMetaDraftsPerStrategy(n)}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                      <span className="draft-count-total">
                        {metaDraftsPerStrategy * strategies.length} total drafts
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* STEP 3 — AI & Strategy                                           */}
        {/* ---------------------------------------------------------------- */}
        {step === 3 && (
        <div className="setup-step">
          <h3 className="setup-step-title">AI &amp; Strategy</h3>
          <p className="section-hint">
            Enable Auto-Pilot, shape your league, or even create custom bidding profiles.
          </p>

          <div className="auto-pilot-section">
            <div className="toggle-row">
              <button
                type="button"
                role="switch"
                aria-checked={config.autoPilotEnabled}
                aria-label="Enable Auto-Pilot"
                className={`toggle-switch ${config.autoPilotEnabled ? 'on' : ''}`}
                disabled={requiresAutoPilot}
                onClick={() => handleConfigChange('autoPilotEnabled', !config.autoPilotEnabled)}
              >
                <span className="toggle-knob" aria-hidden="true" />
              </button>
              <div className="toggle-text">
                <div className="toggle-title">
                  Enable Auto-Pilot
                  {requiresAutoPilot && <span className="required-badge">Required for Simulate</span>}
                </div>
                <div className="toggle-sub">Let the AI handle your bidding and nominations</div>
              </div>
            </div>

            {config.autoPilotEnabled && (
              <div className="section-body">
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
                      Adjust Values ({playerValueAdjustments.size})
                    </button>
                    {playerValueAdjustments.size > 0 && (
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => setPlayerValueAdjustments(new Map())}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <small>Fine-tune individual player values to match your preferences</small>
                </div>
              </div>
            )}
          </div>

          <div className="advanced-config-section">
            <div className="toggle-row">
              <button
                type="button"
                role="switch"
                aria-checked={aiBidderProfilesEnabled}
                aria-label="Match My League's Bidders"
                className={`toggle-switch ${aiBidderProfilesEnabled ? 'on' : ''}`}
                onClick={() => setAiBidderProfilesEnabled(!aiBidderProfilesEnabled)}
              >
                <span className="toggle-knob" aria-hidden="true" />
              </button>
              <div className="toggle-text">
                <div className="toggle-title">Match My League&apos;s Bidders</div>
                <div className="toggle-sub">Pin a strategy to any AI team — the rest stay Mixed</div>
              </div>
            </div>

            {aiBidderProfilesEnabled && (
              <>
                <div className="advanced-config-rows section-body">
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

          <div className="customize-box">
            <div className="customize-box-text">
              <span className="customize-box-title">Custom Bidding Strategies</span>
              <small>Clone a built-in and tweak it — appears in every strategy menu above.</small>
            </div>
            <div className="customize-box-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowStrategyModal(true)}
              >
                Manage ({customStrategies.length}) →
              </button>
            </div>
          </div>

          {simulateError && <div className="simulate-error">{simulateError}</div>}
        </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Wizard navigation                                                */}
        {/* ---------------------------------------------------------------- */}
        {stepError && <div className="simulate-error">{stepError}</div>}
        <div className="setup-wizard-nav">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => goToStep(step - 1)}
            disabled={step === 1}
          >
            ← Back
          </button>
          {step < 3 ? (
            <button type="button" className="btn btn-primary btn-large" onClick={goNext}>
              Next →
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-large" onClick={launch}>
              {activeMode.cta}
            </button>
          )}
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
        budgetPerTeam={config.budgetPerTeam}
        onChange={setPlayerOverrides}
        onClearAll={() => setPlayerOverrides({})}
      />

      <StrategyBuilderModal
        isOpen={showStrategyModal}
        onClose={() => setShowStrategyModal(false)}
        customStrategies={customStrategies}
        onChange={setCustomStrategies}
      />
    </div>
  )
}

export default SetupScreen
