import { DEFAULT_CONFIGS } from '../models/DraftConfig'
import { sanitizeKeepers, DEFAULT_MAX_KEEPERS, MAX_KEEPERS_LIMIT } from './keepers'
import { sanitizePositionValueFactors } from './positionValueAdjustment'

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
    // Manual per-position value multipliers (1.0 = neutral, stored sparse).
    positionValueFactors: {},
    aiTeamStrategies: [],
    aiTeamHomeTeams: [],
    aiTeamNames: [],
    keepers: [],
    maxKeepersPerTeam: DEFAULT_MAX_KEEPERS,
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

// Custom AI opponent names, indexed by seat (position − 1). Only strings
// survive; trimmed and length-capped so a corrupt value can't blow up team
// headers. Empty string = seat keeps its "Team N" default.
export const MAX_TEAM_NAME_LENGTH = 24

function sanitizeTeamNames(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).map(v =>
    typeof v === 'string' ? v.trim().slice(0, MAX_TEAM_NAME_LENGTH) : '')
}

function sanitizeSpendLimits(value) {
  if (!value || typeof value !== 'object') return {}
  const limits = {}
  for (const pos of LIMIT_POSITIONS) {
    const cap = value[pos]
    if (Number.isInteger(cap) && cap >= 1 && cap <= 100000) limits[pos] = cap
  }
  return limits
}

// Roster slots the app knows how to draft for — anything else stored under
// rosterPositions is dropped, and counts are clamped to a sane per-slot range.
const ROSTER_SLOTS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DST', 'BENCH']

function sanitizeRosterPositions(value, fallback) {
  if (!value || typeof value !== 'object') return { ...fallback }
  const roster = {}
  for (const slot of ROSTER_SLOTS) {
    const count = value[slot]
    if (Number.isInteger(count)) roster[slot] = Math.min(30, Math.max(0, count))
  }
  return Object.keys(roster).length > 0 ? roster : { ...fallback }
}

const SCORING_FORMATS = ['standard', 'halfPPR', 'ppr']

// Seat-indexed string arrays (AI strategies / Taco home teams). Indices must
// be preserved — a hole means "default for that seat" — so non-strings map to
// '' rather than being filtered out, mirroring sanitizeTeamNames.
function sanitizeStringSeats(value) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).map(v => (typeof v === 'string' ? v.slice(0, 64) : ''))
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
    const numberOfTeams = intInRange(savedConfig.numberOfTeams, 2, 20, d.numberOfTeams)
    // Explicit field allowlist — never spread savedConfig. localStorage is
    // user-editable, so a blanket spread would let arbitrary extra keys (or
    // unclamped known keys) ride into the config the whole app trusts. Every
    // field falls back to its default, so configs saved before a field
    // existed still load (same forward-compatibility the old merge gave).
    return {
      config: {
        numberOfTeams,
        budgetPerTeam: intInRange(savedConfig.budgetPerTeam, 10, 100000, d.budgetPerTeam),
        humanTeamName: typeof savedConfig.humanTeamName === 'string'
          ? savedConfig.humanTeamName.trim().slice(0, MAX_TEAM_NAME_LENGTH) || d.humanTeamName
          : d.humanTeamName,
        humanDraftPosition: intInRange(savedConfig.humanDraftPosition, 1, numberOfTeams, d.humanDraftPosition),
        nominationTimer: intInRange(savedConfig.nominationTimer, 1, 3600, d.nominationTimer),
        biddingTimer: intInRange(savedConfig.biddingTimer, 1, 3600, d.biddingTimer),
        minBidIncrement: intInRange(savedConfig.minBidIncrement, 1, 1000, d.minBidIncrement),
        scoringFormat: SCORING_FORMATS.includes(savedConfig.scoringFormat)
          ? savedConfig.scoringFormat
          : d.scoringFormat,
        rosterPositions: sanitizeRosterPositions(savedConfig.rosterPositions, d.rosterPositions),
        autoPilotEnabled: !!savedConfig.autoPilotEnabled,
        // Any string is a legal strategy key (built-ins plus custom ids);
        // resolution falls back to Balanced for unknown keys downstream.
        autoPilotStrategy: typeof savedConfig.autoPilotStrategy === 'string' && savedConfig.autoPilotStrategy
          ? savedConfig.autoPilotStrategy.slice(0, 64)
          : d.autoPilotStrategy,
        positionalSpendLimits: sanitizeSpendLimits(savedConfig.positionalSpendLimits),
        positionValueFactors: sanitizePositionValueFactors(savedConfig.positionValueFactors),
        aiTeamStrategies: sanitizeStringSeats(savedConfig.aiTeamStrategies),
        aiTeamHomeTeams: sanitizeStringSeats(savedConfig.aiTeamHomeTeams),
        aiTeamNames: sanitizeTeamNames(savedConfig.aiTeamNames),
        // Keeper entries for seats beyond the loaded team count are dropped —
        // they'd only resurface as launch-blocking validation errors.
        keepers: sanitizeKeepers(savedConfig.keepers, numberOfTeams),
        maxKeepersPerTeam: intInRange(savedConfig.maxKeepersPerTeam, 0, MAX_KEEPERS_LIMIT, d.maxKeepersPerTeam),
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
