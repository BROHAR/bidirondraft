const STORAGE_KEY = 'adraft.playerOverrides.v1'

export function loadOverrides() {
  if (typeof window === 'undefined' || !window.localStorage) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveOverrides(overrides) {
  if (typeof window === 'undefined' || !window.localStorage) return
  if (!overrides || Object.keys(overrides).length === 0) {
    window.localStorage.removeItem(STORAGE_KEY)
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
}

export function clearOverrides() {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.removeItem(STORAGE_KEY)
}

export function countOverrides(overrides) {
  return overrides ? Object.keys(overrides).length : 0
}

export function hasAnyOverride(playerOverride) {
  if (!playerOverride) return false
  if (typeof playerOverride.estimatedValue === 'number') return true
  const pp = playerOverride.projectedPoints
  return !!pp && Object.values(pp).some(v => typeof v === 'number')
}

export function applyOverrides(playersData, overrides) {
  if (!overrides || Object.keys(overrides).length === 0) return playersData
  const players = playersData.players.map(player => {
    const o = overrides[player.id]
    if (!o) return player
    const next = { ...player }
    if (typeof o.estimatedValue === 'number') {
      next.estimatedValue = o.estimatedValue
    }
    if (o.projectedPoints) {
      next.projectedPoints = { ...player.projectedPoints, ...o.projectedPoints }
    }
    return next
  })
  return { ...playersData, players }
}

export function setEstimatedValueOverride(overrides, playerId, value) {
  const next = { ...overrides }
  const existing = next[playerId] ? { ...next[playerId] } : {}
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) {
    delete existing.estimatedValue
  } else {
    existing.estimatedValue = value
  }
  if (!hasAnyOverride(existing)) {
    delete next[playerId]
  } else {
    next[playerId] = existing
  }
  return next
}

export function setProjectedPointsOverride(overrides, playerId, scoringFormat, value) {
  const next = { ...overrides }
  const existing = next[playerId] ? { ...next[playerId] } : {}
  const pp = existing.projectedPoints ? { ...existing.projectedPoints } : {}
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) {
    delete pp[scoringFormat]
  } else {
    pp[scoringFormat] = value
  }
  if (Object.keys(pp).length === 0) {
    delete existing.projectedPoints
  } else {
    existing.projectedPoints = pp
  }
  if (!hasAnyOverride(existing)) {
    delete next[playerId]
  } else {
    next[playerId] = existing
  }
  return next
}

export function clearPlayerOverride(overrides, playerId) {
  if (!overrides[playerId]) return overrides
  const next = { ...overrides }
  delete next[playerId]
  return next
}
