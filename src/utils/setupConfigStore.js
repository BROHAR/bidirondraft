import { DEFAULT_CONFIGS } from '../models/DraftConfig'

// Persists the SetupScreen's draft configuration to localStorage so it survives
// a page refresh or starting a new draft. Mirrors playerOverrides.js: guarded,
// versioned, and tolerant of missing/corrupt data (always falls back to
// defaults). Player value pins and projection overrides are persisted
// separately and intentionally not stored here.

const STORAGE_KEY = 'adraft.setupConfig.v1'

// The default draft configuration — single source of truth for the SetupScreen
// initial state. rosterPositions is cloned so the shared preset object is never
// mutated by the form.
export function defaultDraftConfig() {
  return {
    numberOfTeams: 12,
    budgetPerTeam: 200,
    humanTeamName: 'Your Team',
    humanDraftPosition: 1,
    nominationTimer: 20,
    biddingTimer: 20,
    minBidIncrement: 1,
    scoringFormat: 'halfPPR',
    rosterPositions: { ...DEFAULT_CONFIGS.standard.rosterPositions },
    autoPilotEnabled: false,
    autoPilotStrategy: 'Balanced',
    aiTeamStrategies: [],
    aiTeamHomeTeams: [],
  }
}

// The full persisted setup state: the draft config plus the two SetupScreen
// toggles that change draft/sim behaviour.
export function defaultSetupState() {
  return {
    config: defaultDraftConfig(),
    aiBidderProfilesEnabled: false,
    metaDraftsPerStrategy: 50,
  }
}

export function loadSetupState() {
  const defaults = defaultSetupState()
  if (typeof window === 'undefined' || !window.localStorage) return defaults
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaults
    const savedConfig = parsed.config && typeof parsed.config === 'object' ? parsed.config : {}
    // Merge over defaults so configs saved before a field existed still load.
    return {
      config: {
        ...defaults.config,
        ...savedConfig,
        rosterPositions: savedConfig.rosterPositions && typeof savedConfig.rosterPositions === 'object'
          ? { ...savedConfig.rosterPositions }
          : defaults.config.rosterPositions,
        aiTeamStrategies: Array.isArray(savedConfig.aiTeamStrategies) ? savedConfig.aiTeamStrategies : [],
        aiTeamHomeTeams: Array.isArray(savedConfig.aiTeamHomeTeams) ? savedConfig.aiTeamHomeTeams : [],
      },
      aiBidderProfilesEnabled: !!parsed.aiBidderProfilesEnabled,
      metaDraftsPerStrategy: Number.isFinite(parsed.metaDraftsPerStrategy)
        ? parsed.metaDraftsPerStrategy
        : defaults.metaDraftsPerStrategy,
    }
  } catch {
    return defaults
  }
}

export function saveSetupState(state) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const payload = {
      config: state.config,
      aiBidderProfilesEnabled: !!state.aiBidderProfilesEnabled,
      metaDraftsPerStrategy: state.metaDraftsPerStrategy,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // localStorage can throw (private mode / quota) — persistence is best-effort.
  }
}

export function clearSetupState() {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.removeItem(STORAGE_KEY)
}
