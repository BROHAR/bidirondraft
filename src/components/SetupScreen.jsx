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
import { buildFormatValueDeltas } from '../utils/formatValueAdjustment'
import { buildSuperflexValueDeltas } from '../utils/superflexValueAdjustment'
import {
  ADJUSTABLE_POSITIONS,
  POSITION_FACTOR_LIMITS,
  buildPositionValueDeltas,
} from '../utils/positionValueAdjustment'
import { shouldShowPrompt } from '../utils/subscribeStore'
import EmailSignupForm from './EmailSignupForm'
import { loadCustomStrategies, saveCustomStrategies } from '../utils/customStrategiesStore'
import { track } from '../services/analyticsService'
import LeagueImportModal from './LeagueImportModal'
import KeeperModal from './KeeperModal'
import { loadLeagueProfile, saveLeagueProfile, clearLeagueProfile } from '../utils/leagueProfileStore'
import { buildLeagueProfileDeltas } from '../utils/leagueProfile'
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

// Positions that accept an Auto-Pilot max-spend limit.
const LIMIT_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']

// The wizard steps, in order. `step` state is 1-based.
const STEPS = [
  { num: 1, label: 'League Settings' },
  { num: 2, label: 'Draft or Sim Type' },
  { num: 3, label: 'AI & Strategy' },
]

// Analytics ids for the wizard steps (snake_case, stable across label edits).
const STEP_IDS = { 1: 'league_settings', 2: 'draft_type', 3: 'ai_strategy' }

// Open a setup modal and record which tool was reached for.
const openTool = (tool, open) => {
  track('setup_tool_opened', { tool })
  open(true)
}

function SetupScreen() {
  const { initializeDraft, simulateDraft, runMetaSimulation } = useDraftStore()
  // Restore the persisted setup config (survives refresh / new draft).
  // Keeper entries whose player no longer exists in the pool (projection
  // refresh dropped them) are pruned here — the engine would skip them
  // silently, which would leave the keeping team's budget wrong vs intent.
  const persisted = useMemo(() => {
    const state = loadSetupState()
    const poolIds = new Set(playersData.players.map(p => p.id))
    const kept = (state.config.keepers || []).filter(k => poolIds.has(k.playerId))
    if (kept.length !== (state.config.keepers || []).length) {
      state.config = { ...state.config, keepers: kept }
    }
    return state
  }, [])
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
  const [showSignup, setShowSignup] = useState(() => shouldShowPrompt())
  const [aiBidderProfilesEnabled, setAiBidderProfilesEnabled] = useState(persisted.aiBidderProfilesEnabled)
  const [metaDraftsPerStrategy, setMetaDraftsPerStrategy] = useState(
    () => Math.min(50, Math.max(10, persisted.metaDraftsPerStrategy))
  )
  const [playerOverrides, setPlayerOverrides] = useState(() => loadOverrides())
  const [showCustomizationModal, setShowCustomizationModal] = useState(false)
  const [customStrategies, setCustomStrategies] = useState(() => loadCustomStrategies())
  const [showStrategyModal, setShowStrategyModal] = useState(false)
  const [leagueProfile, setLeagueProfile] = useState(() => loadLeagueProfile())
  const [leagueProfileEnabled, setLeagueProfileEnabled] = useState(persisted.leagueProfileEnabled)
  const [showLeagueImportModal, setShowLeagueImportModal] = useState(false)
  const [showKeeperModal, setShowKeeperModal] = useState(false)

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
    saveSetupState({ config, aiBidderProfilesEnabled, leagueProfileEnabled, metaDraftsPerStrategy, launchMode })
  }, [config, aiBidderProfilesEnabled, leagueProfileEnabled, metaDraftsPerStrategy, launchMode])

  const customizedPlayersData = useMemo(
    () => applyOverrides(playersData, playerOverrides),
    [playerOverrides]
  )
  const overrideCount = countOverrides(playerOverrides)

  // estimatedValue in the data is half-PPR book; under standard/ppr both
  // player modals show format-adjusted values so users customize against the
  // same book the draft will actually use.
  const formatDeltas = useMemo(
    () => buildFormatValueDeltas(playersData.players, {
      scoringFormat: config.scoringFormat,
      numberOfTeams: config.numberOfTeams,
      rosterPositions: config.rosterPositions,
    }),
    [config.scoringFormat, config.numberOfTeams, config.rosterPositions]
  )

  // Imported-league market deltas (same additive $200-space convention as
  // formatDeltas) — shown in the modals only while the profile toggle is on,
  // matching what the engine will apply at launch.
  const leagueDeltas = useMemo(
    () => (leagueProfileEnabled && leagueProfile
      ? buildLeagueProfileDeltas(playersData.players, leagueProfile)
      : new Map()),
    [leagueProfileEnabled, leagueProfile]
  )

  // Superflex / 2QB QB rescale — mirrors the engine's pre-anchor adjustment
  // so the modals preview the QB market the draft will actually use.
  const superflexDeltas = useMemo(
    () => buildSuperflexValueDeltas(playersData.players, {
      numberOfTeams: config.numberOfTeams,
      rosterPositions: config.rosterPositions,
    }),
    [config.numberOfTeams, config.rosterPositions]
  )

  // Manual per-position percentages (editable in step 3, League History section).
  const positionDeltas = useMemo(
    () => buildPositionValueDeltas(playersData.players, config.positionValueFactors),
    [config.positionValueFactors]
  )

  // Every pre-anchor book adjustment the engine will apply, combined — the
  // single delta source for the player modals below.
  const previewDeltas = useMemo(() => {
    const combined = new Map()
    for (const deltas of [formatDeltas, superflexDeltas, leagueDeltas, positionDeltas]) {
      for (const [id, delta] of deltas) {
        combined.set(id, (combined.get(id) || 0) + delta)
      }
    }
    return combined
  }, [formatDeltas, superflexDeltas, leagueDeltas, positionDeltas])

  // Value-adjustment modal input: fully adjusted book (format, superflex,
  // league profile, position tweaks), except players whose value the user
  // overrode — overrides are authoritative (the engine snaps them back after
  // its own adjustments too).
  const valueModalPlayers = useMemo(
    () => customizedPlayersData.players.map(player => {
      const delta = previewDeltas.get(player.id) || 0
      if (delta === 0) return player
      const o = playerOverrides[player.id]
      if (o && typeof o.estimatedValue === 'number') return player
      return { ...player, estimatedValue: Math.max(1, Math.round(player.estimatedValue + delta)) }
    }),
    [customizedPlayersData, previewDeltas, playerOverrides]
  )

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

  // Keeper summary for the step-1 box label.
  const keeperCount = config.keepers?.length || 0
  const keeperSpend = (config.keepers || []).reduce((s, k) => s + k.price, 0)

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

  const handlePositionalLimitChange = (position, raw) => {
    setConfig(prev => {
      const next = { ...(prev.positionalSpendLimits || {}) }
      const n = parseInt(raw, 10)
      if (raw === '' || !Number.isFinite(n)) delete next[position]
      else next[position] = Math.max(1, Math.min(prev.budgetPerTeam, n))
      return { ...prev, positionalSpendLimits: next }
    })
  }

  // Per-position value percentage editor (step 3, League History section). Stored as multipliers;
  // the UI speaks percent deltas (+25 → 1.25×). Blank/0 clears the position.
  const handlePositionFactorChange = (position, raw) => {
    setConfig(prev => {
      const next = { ...(prev.positionValueFactors || {}) }
      const pct = parseFloat(raw)
      const [lo, hi] = POSITION_FACTOR_LIMITS
      if (raw === '' || !Number.isFinite(pct) || pct === 0) {
        delete next[position]
      } else {
        const factor = Math.min(hi, Math.max(lo, 1 + pct / 100))
        next[position] = Math.round(factor * 100) / 100
      }
      return { ...prev, positionValueFactors: next }
    })
  }

  // Apply an imported league profile: persist it, enable it, and seat-map the
  // detected teams' personas onto the AI bidder dropdowns — non-user imported
  // teams fill seats 1..N (skipping the human seat) in imported order. The
  // existing per-seat dropdowns are the override surface.
  const handleLeagueProfileApply = (profile) => {
    track('league_import_applied', {
      picks: profile.parsedCount ?? 0,
      teams: (profile.teams || []).length,
    })
    // The fitted per-position factors seed the manual editor (step 3) and are
    // neutralized on the stored profile so they apply exactly once — turning
    // the import's "straight % change per position" into editable controls.
    // Tier curves and late inflation stay on the profile.
    const seededFactors = {}
    for (const pos of ADJUSTABLE_POSITIONS) {
      const f = profile.positionFactors?.[pos]
      if (typeof f === 'number' && Number.isFinite(f) && f !== 1.0) seededFactors[pos] = f
    }
    const neutralFactors = {}
    for (const pos of ADJUSTABLE_POSITIONS) neutralFactors[pos] = 1.0
    const storedProfile = { ...profile, positionFactors: neutralFactors }
    saveLeagueProfile(storedProfile)
    setLeagueProfile(storedProfile)
    setLeagueProfileEnabled(true)
    setShowLeagueImportModal(false)

    const importedTeams = (profile.teams || []).filter(t => !t.isUser)
    const aiTeamStrategies = []
    const aiTeamHomeTeams = []
    const aiTeamNames = []
    let next = 0
    for (let seat = 1; seat <= config.numberOfTeams; seat++) {
      if (seat === config.humanDraftPosition) continue
      const team = importedTeams[next++]
      aiTeamStrategies[seat - 1] = team ? team.persona : 'Mixed'
      aiTeamHomeTeams[seat - 1] = team?.homeTeam || ''
      // Imported leagues carry real team names — seat them alongside the
      // personas so the room reads like the user's actual league.
      aiTeamNames[seat - 1] = team?.name || ''
    }
    setConfig(prev => ({
      ...prev,
      aiTeamStrategies,
      aiTeamHomeTeams,
      aiTeamNames,
      positionValueFactors: seededFactors,
    }))
    setAiBidderProfilesEnabled(true)
  }

  const handleLeagueProfileRemove = () => {
    clearLeagueProfile()
    setLeagueProfile(null)
    setLeagueProfileEnabled(false)
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

  const handleAiTeamNameChange = (positionIndex, value) => {
    setConfig(prev => {
      const next = [...(prev.aiTeamNames || [])]
      next[positionIndex] = value
      return { ...prev, aiTeamNames: next }
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
    if (step < 3) track('setup_step_completed', { step, step_name: STEP_IDS[step] })
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
      aiTeamNames: aiBidderProfilesEnabled ? config.aiTeamNames : [],
      customStrategies,
      leagueProfile: leagueProfileEnabled ? leagueProfile : null,
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
      aiTeamNames: aiBidderProfilesEnabled ? config.aiTeamNames : [],
      customStrategies,
      leagueProfile: leagueProfileEnabled ? leagueProfile : null,
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
      aiTeamNames: aiBidderProfilesEnabled ? config.aiTeamNames : [],
      customStrategies,
      leagueProfile: leagueProfileEnabled ? leagueProfile : null,
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
                onClick={() => openTool('player_customization', setShowCustomizationModal)}
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

          <div className="customize-box">
            <div className="customize-box-text">
              <span className="customize-box-title">Keeper League</span>
              <small>Set the players each team keeps from last season. Keepers skip the auction, fill roster slots, and their price comes off that team&apos;s budget — remaining player values adjust to the money left in the room.</small>
            </div>
            <div className="customize-box-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => openTool('keepers', setShowKeeperModal)}
              >
                Keepers ({keeperCount}{keeperCount > 0 ? ` · $${keeperSpend}` : ''}) →
              </button>
              {keeperCount > 0 && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setConfig(prev => ({ ...prev, keepers: [] }))}
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
                      onClick={() => openTool('player_values', setShowValueModal)}
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

                <div className="form-group">
                  <label>Positional Limits</label>
                  <div className="positional-limits-grid">
                    {LIMIT_POSITIONS.map(pos => (
                      <label key={pos} className="positional-limit-field">
                        <span className="positional-limit-pos">{pos}</span>
                        <input
                          type="number"
                          min={1}
                          max={config.budgetPerTeam}
                          placeholder="—"
                          aria-label={`Max spend for ${pos}`}
                          value={config.positionalSpendLimits?.[pos] ?? ''}
                          onChange={(e) => handlePositionalLimitChange(pos, e.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                  <small>
                    Max $ Auto-Pilot will pay at each position. Blank = no limit.
                    Player value adjustments override these. Applies to meta sims too.
                  </small>
                </div>
              </div>
            )}
          </div>

          <div className="advanced-config-section">
            <div className="toggle-row">
              <button
                type="button"
                role="switch"
                aria-checked={leagueProfileEnabled}
                aria-label="Use My League's Draft History"
                className={`toggle-switch ${leagueProfileEnabled ? 'on' : ''}`}
                disabled={!leagueProfile}
                onClick={() => setLeagueProfileEnabled(!leagueProfileEnabled)}
              >
                <span className="toggle-knob" aria-hidden="true" />
              </button>
              <div className="toggle-text">
                <div className="toggle-title">Use My League&apos;s Draft History</div>
                <div className="toggle-sub">
                  Import last year&apos;s auction results to tune prices and detect each bidder&apos;s persona
                </div>
              </div>
            </div>

            <div className="section-body league-profile-body">
              {leagueProfile ? (
                <>
                  <div className="league-profile-summary">
                    <span className="league-profile-chip">
                      {leagueProfile.parsedCount} picks · {leagueProfile.importedAt?.slice(0, 10)}
                    </span>
                    {leagueProfile.lateInflation !== 1.0 && (
                      <span className="league-profile-chip">Late inflation {leagueProfile.lateInflation}×</span>
                    )}
                  </div>
                  <div className="league-profile-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => openTool('league_import', setShowLeagueImportModal)}>
                      Re-import
                    </button>
                    <button type="button" className="btn btn-outline" onClick={handleLeagueProfileRemove}>
                      Remove
                    </button>
                  </div>
                </>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => openTool('league_import', setShowLeagueImportModal)}>
                  Import Last Year&apos;s Draft…
                </button>
              )}

              <div className="form-group">
                <label>Position Value Adjustments</label>
                <div className="positional-limits-grid">
                  {ADJUSTABLE_POSITIONS.map(pos => {
                    const factor = config.positionValueFactors?.[pos]
                    const pct = factor !== undefined ? Math.round((factor - 1) * 100) : ''
                    return (
                      <label key={pos} className="positional-limit-field">
                        <span className="positional-limit-pos">{pos}</span>
                        <input
                          type="number"
                          min={Math.round((POSITION_FACTOR_LIMITS[0] - 1) * 100)}
                          max={Math.round((POSITION_FACTOR_LIMITS[1] - 1) * 100)}
                          step="5"
                          placeholder="0"
                          aria-label={`Value adjustment percent for ${pos}`}
                          value={pct}
                          onChange={(e) => handlePositionFactorChange(pos, e.target.value)}
                        />
                      </label>
                    )
                  })}
                </div>
                {Object.keys(config.positionValueFactors || {}).length > 0 && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => setConfig(prev => ({ ...prev, positionValueFactors: {} }))}
                  >
                    Reset
                  </button>
                )}
                <small>
                  Shift every player at a position by a percentage (e.g. QB +50).
                  Importing your draft pre-fills these from your league&apos;s actual
                  spending. Superflex QB pricing is automatic; use this to push it
                  further. Works with or without an import.
                </small>
              </div>
            </div>
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
                <div className="toggle-sub">Name your opponents and pin a strategy to any AI team — the rest stay Mixed</div>
              </div>
            </div>

            {aiBidderProfilesEnabled && (
              <>
                <div className="advanced-config-rows section-body">
                  {Array.from({ length: config.numberOfTeams }, (_, i) => i + 1)
                    .filter(p => p !== config.humanDraftPosition)
                    .map(p => (
                      <div key={p} className="advanced-config-row">
                        <label htmlFor={`ai-name-${p}`}>Seat {p}</label>
                        <div className="advanced-config-selects">
                          <input
                            id={`ai-name-${p}`}
                            type="text"
                            className="ai-team-name-input"
                            placeholder={`Team ${p}`}
                            maxLength={24}
                            aria-label={`Name for seat ${p}`}
                            value={config.aiTeamNames?.[p - 1] || ''}
                            onChange={(e) => handleAiTeamNameChange(p - 1, e.target.value)}
                          />
                          <select
                            id={`ai-strategy-${p}`}
                            aria-label={`Strategy for seat ${p}`}
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
                onClick={() => openTool('strategy_builder', setShowStrategyModal)}
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

        {showSignup && (
          <div className="setup-signup-footer">
            <EmailSignupForm source="setup" variant="inline" onDismiss={() => setShowSignup(false)} />
          </div>
        )}
      </div>

      <PlayerValueModal
        isOpen={showValueModal}
        onClose={() => setShowValueModal(false)}
        players={valueModalPlayers}
        budgetPerTeam={config.budgetPerTeam}
        totalRosterSize={totalRosterSize}
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
        formatDeltas={previewDeltas}
        onChange={setPlayerOverrides}
        onClearAll={() => setPlayerOverrides({})}
      />

      <StrategyBuilderModal
        isOpen={showStrategyModal}
        onClose={() => setShowStrategyModal(false)}
        customStrategies={customStrategies}
        onChange={setCustomStrategies}
      />

      <LeagueImportModal
        isOpen={showLeagueImportModal}
        onClose={() => setShowLeagueImportModal(false)}
        existingProfile={leagueProfile}
        onApply={handleLeagueProfileApply}
      />

      {/* Mounted only while open so its working copy re-seeds from config
          each time (unlike the other modals, it stages edits locally). */}
      {showKeeperModal && (
        <KeeperModal
          isOpen
          onClose={() => setShowKeeperModal(false)}
          config={config}
          players={valueModalPlayers}
          leagueProfile={leagueProfile}
          onApply={({ keepers, maxKeepersPerTeam }) => {
            track('keepers_applied', {
              keeper_count: keepers.length,
              keeper_spend: keepers.reduce((s, k) => s + (k.price || 0), 0),
            })
            setConfig(prev => ({ ...prev, keepers, maxKeepersPerTeam }))
          }}
        />
      )}
    </div>
  )
}

export default SetupScreen
