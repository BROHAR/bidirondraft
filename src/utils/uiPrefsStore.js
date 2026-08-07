// Persists small draft-room UI preferences (currently just the Player Pool's
// "show drafted players" toggle) to localStorage so they survive a refresh.
// Mirrors setupConfigStore.js: guarded, versioned, and tolerant of
// missing/corrupt data — always falls back to defaults.

const STORAGE_KEY = 'adraft.uiPrefs.v1'

export function defaultUiPrefs() {
  return {
    // Matches the historical Player Pool behavior: only available players.
    showDraftedPlayers: false,
  }
}

export function loadUiPrefs() {
  const defaults = defaultUiPrefs()
  if (typeof window === 'undefined' || !window.localStorage) return defaults
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaults
    return {
      ...defaults,
      showDraftedPlayers: !!parsed.showDraftedPlayers,
    }
  } catch {
    return defaults
  }
}

// Merge `partial` over the currently stored prefs so callers can save a single
// preference without clobbering others added later.
export function saveUiPrefs(partial) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const merged = { ...loadUiPrefs(), ...partial }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  } catch {
    // localStorage can throw (private mode / quota) — persistence is best-effort.
  }
}
