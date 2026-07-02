// Persists user-authored custom bidding strategies to localStorage so they
// survive refreshes and new drafts, and are available to pin on AI teams / the
// auto-pilot seat. Mirrors setupConfigStore.js / playerOverrides.js: guarded,
// versioned, and tolerant of missing/corrupt data (always falls back to an
// empty list). A custom strategy definition is plain JSON:
//   { id, name, baseKey, positionMultipliers, skipProbability?, homeTeam? }

const STORAGE_KEY = 'adraft.customStrategies.v1'

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

export function loadCustomStrategies() {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidDef)
  } catch {
    return []
  }
}

export function saveCustomStrategies(list) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const safe = Array.isArray(list) ? list.filter(isValidDef) : []
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
