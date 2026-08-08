// Persists user-authored custom bidding strategies to localStorage so they
// survive refreshes and new drafts, and are available to pin on AI teams / the
// auto-pilot seat. Mirrors setupConfigStore.js / playerOverrides.js: guarded,
// versioned, and tolerant of missing/corrupt data (always falls back to an
// empty list). A custom strategy definition is plain JSON:
//   { id, name, baseKey, positionMultipliers, skipProbability?, homeTeam? }

const STORAGE_KEY = 'adraft.customStrategies.v1'

// Knob ranges — single source of truth shared with StrategyBuilderModal, so
// the write-time clamps and these read-time clamps can never drift apart.
// localStorage is user-editable, so the builder's clamps alone aren't enough:
// a hand-edited 50× multiplier or 0.99 skip probability would otherwise ride
// straight into the bidding engine.
export const MULT_RANGE = [0.5, 2.0]
export const SKIP_RANGE = [0.02, 0.45]

const clamp = (n, [lo, hi]) => Math.min(hi, Math.max(lo, n))

// The only positions the builder exposes multipliers for — unknown keys in a
// stored blob are dropped rather than patched onto strategy preferences.
const MULT_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']

// Validate a single definition loosely — enough to keep obviously-broken
// entries (missing id/name) out of the dropdowns without being precious about
// optional fields.
function isValidDef(def) {
  return (
    def &&
    typeof def === 'object' &&
    typeof def.id === 'string' &&
    def.id.length > 0 &&
    typeof def.name === 'string'
  )
}

// Re-apply the builder's knob clamps to a stored definition: non-finite
// multipliers drop (clone keeps the base's value), out-of-range ones clamp,
// and skipProbability survives only as a finite in-range number.
function sanitizeDef(def) {
  const out = { ...def }
  if (out.positionMultipliers && typeof out.positionMultipliers === 'object') {
    const mults = {}
    for (const pos of MULT_POSITIONS) {
      const m = out.positionMultipliers[pos]
      if (typeof m === 'number' && Number.isFinite(m)) mults[pos] = clamp(m, MULT_RANGE)
    }
    out.positionMultipliers = mults
  } else {
    delete out.positionMultipliers
  }
  if (typeof out.skipProbability === 'number' && Number.isFinite(out.skipProbability)) {
    out.skipProbability = clamp(out.skipProbability, SKIP_RANGE)
  } else {
    delete out.skipProbability
  }
  return out
}

export function loadCustomStrategies() {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidDef).map(sanitizeDef)
  } catch {
    return []
  }
}

export function saveCustomStrategies(list) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const safe = Array.isArray(list) ? list.filter(isValidDef).map(sanitizeDef) : []
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe))
  } catch {
    // localStorage can throw (private mode / quota) — persistence is best-effort.
  }
}

// Insert or replace a definition by id, returning a new array (callers keep the
// list in React state and persist via effect).
export function upsertCustomStrategy(list, def) {
  const base = Array.isArray(list) ? list : []
  const idx = base.findIndex(d => d.id === def.id)
  if (idx === -1) return [...base, def]
  const next = [...base]
  next[idx] = def
  return next
}

export function removeCustomStrategy(list, id) {
  const base = Array.isArray(list) ? list : []
  return base.filter(d => d.id !== id)
}
