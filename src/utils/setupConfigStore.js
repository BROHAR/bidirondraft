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
    positionalSpendLimits: {},
    aiTeamStrategies: [],
    aiTeamHomeTeams: [],
  }
}

// The full persisted setup state: the draft config plus the two SetupScreen
// toggles that change draft/sim behaviour.
// Which of the three run modes the wizard will launch: 'live' (real-time
// auction), 'sim' (one-shot auto-draft) or 'meta' (batch strategy ranking).
const LAUNCH_MODES = ['live', 'sim', 'meta']

export function defaultSetupState() {
  return {
    config: defaultDraftConfig(),
    aiBidderProfilesEnabled: false,
    // Whether launches apply the imported league profile (the profile itself
    // persists separately in leagueProfileStore) — lets users A/B a draft
    // with/without their league's tendencies without re-importing.
    leagueProfileEnabled: false,
    metaDraftsPerStrategy: 10,
    launchMode: 'live',
  }
}

// A stored numeric scalar is only trusted when it's a finite integer within
// the field's sane range; anything else (corrupt value, older app version)
// falls back to the default. numberOfTeams matters most — it feeds
// Array.from({length}) on the setup screen, so a wild value wedges the page.
function intInRange(value, min, max, fallback) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

// Positional spend limits are absolute dollars keyed by position; only known
// positions with a sane integer value survive a load, everything else drops.
const LIMIT_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']

function sanitizeSpendLimits(value) {
  if (!value || typeof value !== 'object') return {}
  const limits = {}
  for (const pos of LIMIT_POSITIONS) {
    const cap = value[pos]
    if (Number.isInteger(cap) && cap >= 1 && cap <= 100000) limits[pos] = cap
  }
  return limits
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
    const d = defaults.config
    // Merge over defaults so configs saved before a field existed still load.
    const numberOfTeams = intInRange(savedConfig.numberOfTeams, 2, 20, d.numberOfTeams)
    return {
      config: {
        ...d,
        ...savedConfig,
        numberOfTeams,
        budgetPerTeam: intInRange(savedConfig.budgetPerTeam, 10, 100000, d.budgetPerTeam),
        humanDraftPosition: intInRange(savedConfig.humanDraftPosition, 1, numberOfTeams, d.humanDraftPosition),
        nominationTimer: intInRange(savedConfig.nominationTimer, 1, 3600, d.nominationTimer),
        biddingTimer: intInRange(savedConfig.biddingTimer, 1, 3600, d.biddingTimer),
        minBidIncrement: intInRange(savedConfig.minBidIncrement, 1, 1000, d.minBidIncrement),
        rosterPositions: savedConfig.rosterPositions && typeof savedConfig.rosterPositions === 'object'
          ? { ...savedConfig.rosterPositions }
          : d.rosterPositions,
        positionalSpendLimits: sanitizeSpendLimits(savedConfig.positionalSpendLimits),
        aiTeamStrategies: Array.isArray(savedConfig.aiTeamStrategies) ? savedConfig.aiTeamStrategies : [],
        aiTeamHomeTeams: Array.isArray(savedConfig.aiTeamHomeTeams) ? savedConfig.aiTeamHomeTeams : [],
      },
      aiBidderProfilesEnabled: !!parsed.aiBidderProfilesEnabled,
      leagueProfileEnabled: !!parsed.leagueProfileEnabled,
      metaDraftsPerStrategy: Number.isFinite(parsed.metaDraftsPerStrategy)
        ? parsed.metaDraftsPerStrategy
        : defaults.metaDraftsPerStrategy,
      launchMode: LAUNCH_MODES.includes(parsed.launchMode)
        ? parsed.launchMode
        : defaults.launchMode,
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
      leagueProfileEnabled: !!state.leagueProfileEnabled,
      metaDraftsPerStrategy: state.metaDraftsPerStrategy,
      launchMode: LAUNCH_MODES.includes(state.launchMode) ? state.launchMode : 'live',
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
