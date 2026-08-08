// Persists the imported League Profile (leagueProfile.js) to localStorage.
// Mirrors playerOverrides.js: guarded, versioned, tolerant of missing/corrupt
// data. The sanitizer re-clamps every factor to the fit-time ranges so a
// hand-edited or stale entry can never smuggle wild adjustments into the
// engine — corrupt data loads as null (feature silently off).

import {
  PROFILE_VERSION,
  POSITION_FACTOR_RANGE,
  TIER_FACTOR_RANGE,
  LATE_INFLATION_RANGE,
  TIER_MINS,
  TIER_POSITIONS,
} from './leagueProfile'
import { BUILTIN_STRATEGIES } from '../strategies/registry'

const STORAGE_KEY = 'adraft.leagueProfile.v1'

const BUILTIN_KEYS = BUILTIN_STRATEGIES.map(s => s.key)
const CONFIDENCES = ['high', 'medium', 'low']
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']

function clampFactor(value, [lo, hi]) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1.0
  return Math.min(hi, Math.max(lo, value))
}

export function sanitizeLeagueProfile(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== PROFILE_VERSION) return null

  const positionFactors = {}
  for (const pos of POSITIONS) {
    positionFactors[pos] = clampFactor(raw.positionFactors?.[pos], POSITION_FACTOR_RANGE)
  }

  // Rebuild each position's tier list from the canonical bucket mins so
  // extra/missing/misordered entries can't corrupt the descending lookup in
  // tierFactorFor. K/DST are forced fully neutral, matching the fitter.
  const tierFactors = {}
  for (const pos of TIER_POSITIONS) {
    const savedTiers = Array.isArray(raw.tierFactors?.[pos]) ? raw.tierFactors[pos] : []
    const neutral = pos === 'K' || pos === 'DST'
    tierFactors[pos] = TIER_MINS.map(min => {
      const saved = savedTiers.find(t => t && t.min === min)
      return {
        min,
        factor: min === 0 || neutral ? 1.0 : clampFactor(saved?.factor, TIER_FACTOR_RANGE),
      }
    })
  }

  // Raw pick pass-through (the "keepers from last year's draft" source).
  // Optional on older stored profiles; entries must be structurally sound and
  // the array is length-capped, which also bounds per-pick work downstream
  // (name matching runs per entry during render).
  const picks = (Array.isArray(raw.picks) ? raw.picks : [])
    .slice(0, 1000)
    .filter(p =>
      p && typeof p === 'object' &&
      typeof p.name === 'string' && p.name.length > 0 &&
      POSITIONS.includes(p.position) &&
      Number.isInteger(p.price) && p.price >= 1 && p.price <= 100000 &&
      typeof p.fantasyTeam === 'string' && p.fantasyTeam.length > 0)
    .map(p => ({
      name: p.name.slice(0, 128),
      position: p.position,
      price: p.price,
      fantasyTeam: p.fantasyTeam.slice(0, 128),
    }))

  const teams = (Array.isArray(raw.teams) ? raw.teams : [])
    .filter(t => t && typeof t.name === 'string' && t.name.length > 0)
    .map(t => ({
      name: t.name,
      isUser: !!t.isUser,
      persona: BUILTIN_KEYS.includes(t.persona) ? t.persona : 'Balanced',
      confidence: CONFIDENCES.includes(t.confidence) ? t.confidence : 'low',
      spend: typeof t.spend === 'number' && Number.isFinite(t.spend) ? t.spend : 0,
      picks: Number.isInteger(t.picks) ? t.picks : 0,
      homeTeam: typeof t.homeTeam === 'string' && t.homeTeam ? t.homeTeam : null,
    }))

  return {
    version: PROFILE_VERSION,
    importedAt: typeof raw.importedAt === 'string' ? raw.importedAt : '',
    source: typeof raw.source === 'string' ? raw.source : 'csv',
    leagueBudget: typeof raw.leagueBudget === 'number' && raw.leagueBudget > 0 ? raw.leagueBudget : 200,
    parsedCount: Number.isInteger(raw.parsedCount) ? raw.parsedCount : 0,
    picks,
    positionFactors,
    tierFactors,
    lateInflation: clampFactor(raw.lateInflation, LATE_INFLATION_RANGE),
    teams,
  }
}

export function loadLeagueProfile() {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return sanitizeLeagueProfile(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveLeagueProfile(profile) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  } catch {
    // localStorage can throw (private mode / quota) — persistence is best-effort.
  }
}

export function clearLeagueProfile() {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.removeItem(STORAGE_KEY)
}
