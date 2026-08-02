import { getLineupSlots } from './draftAnalysis.js'

// Build-a-Champ core. Pure roster math for the meta-sim tab where the user
// hand-picks a roster from the simulated player pool: each player costs what
// the simulated league pays for them on average (playerPool from
// metaSimulation.js), an optional per-player boost reshapes their projection,
// and the finished roster is ranked against every simulated team's starting
// lineup (leagueBenchmark). No React and no store — the tab and the unit tests
// call these functions directly.

// How far a per-player expectation can deviate from the base projection.
// -100% zeroes a player out (season-ending injury); +200% covers even an
// out-of-nowhere breakout without letting a typo (e.g. 2000) wreck the math.
export const BOOST_MIN = -100
export const BOOST_MAX = 200

export const MAX_SAVED_ROSTERS = 5
const STORAGE_KEY = 'adraft.champRosters.v1'

export function clampBoost(pct) {
  const n = Number(pct)
  if (!Number.isFinite(n)) return 0
  return Math.min(BOOST_MAX, Math.max(BOOST_MIN, n))
}

export function boostedPoints(projectedPoints, boostPct) {
  return (projectedPoints || 0) * (1 + clampBoost(boostPct) / 100)
}

// Total roster spots (starters + bench) the league config allows.
export function rosterSizeFor(rosterPositions) {
  return Object.values(rosterPositions || {}).reduce((s, n) => s + (n || 0), 0)
}

// Resolve the user's picks ({ id, boostPct }) against the sim player pool into
// display-ready entries. Picks whose player never appeared in the simulations
// are silently skipped here — resolveSavedRoster reports them by name.
export function buildChampEntries(selection, poolById) {
  const entries = []
  for (const pick of selection || []) {
    const p = poolById.get(pick.id)
    if (!p) continue
    const boostPct = clampBoost(pick.boostPct)
    entries.push({
      id: p.id, name: p.name, position: p.position, team: p.team,
      avgPrice: p.avgPrice, draftRate: p.draftRate,
      projectedPoints: p.projectedPoints,
      boostPct,
      adjustedPoints: boostedPoints(p.projectedPoints, boostPct),
    })
  }
  return entries
}

// Expected finish among (numberOfTeams - 1) opponents drawn from the sorted
// benchmark of simulated teams. Ties split the difference so a roster exactly
// at the field median projects mid-pack, not first or last.
export function estimateFinish(starterPoints, sortedBenchmark, numberOfTeams) {
  const n = sortedBenchmark?.length || 0
  if (!n) return { expectedRank: 1, percentile: 1, winOdds: 1 }
  let below = 0, equal = 0
  for (const pts of sortedBenchmark) {
    if (pts < starterPoints) below++
    else if (pts === starterPoints) equal++
    else break // sorted ascending — everything after is above
  }
  const fracBelow = (below + 0.5 * equal) / n
  const opponents = Math.max(0, (numberOfTeams || 1) - 1)
  return {
    expectedRank: 1 + opponents * (1 - fracBelow),
    percentile: fracBelow,
    winOdds: Math.pow(fracBelow, opponents),
  }
}

// The headline numbers for the tab: cost vs budget, roster fill, the boosted
// lineup's starter points, and where that lineup lands in the simulated field.
export function computeChampProjection(entries, { rosterPositions, numberOfTeams, budgetPerTeam, benchmark }) {
  const roster = entries.map(e => ({ id: e.id, position: e.position, projectedPoints: e.adjustedPoints }))
  const { slots, bench } = getLineupSlots({ roster }, rosterPositions)
  let starterPoints = 0
  for (const slot of Object.keys(slots)) for (const p of slots[slot]) starterPoints += p.projectedPoints || 0

  const totalCost = entries.reduce((s, e) => s + (e.avgPrice || 0), 0)
  const rosterSize = rosterSizeFor(rosterPositions)
  const finish = estimateFinish(starterPoints, benchmark, numberOfTeams)
  return {
    starterPoints,
    totalCost,
    budgetPerTeam,
    remainingBudget: (budgetPerTeam || 0) - totalCost,
    overBudget: totalCost > (budgetPerTeam || 0),
    rosterSize,
    spotsFilled: entries.length,
    benchCount: bench.length,
    ...finish,
  }
}

// ---- Saved rosters (localStorage, survive between meta sims) ------------
//
// Only identity + expectation are saved ({ id, name, position, team, boostPct }
// per player): prices and projections are re-resolved from the CURRENT meta
// sim's pool on load, so a roster saved last week reprices itself against
// today's market instead of freezing stale numbers.

function readStore() {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(r => r && typeof r === 'object' && typeof r.name === 'string' && Array.isArray(r.players))
      .slice(0, MAX_SAVED_ROSTERS)
  } catch {
    return []
  }
}

function writeStore(rosters) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rosters))
  } catch {
    // localStorage can throw (private mode / quota) — persistence is best-effort.
  }
}

export function loadSavedRosters() {
  return readStore()
}

// Save the current picks under `name`. A matching name overwrites that slot;
// a new name appends. Returns the updated list, or null when all
// MAX_SAVED_ROSTERS slots are taken by other names (the caller surfaces that).
export function saveRoster(name, entries) {
  const trimmed = (name || '').trim()
  if (!trimmed) return null
  const record = {
    name: trimmed,
    savedAt: new Date().toISOString(),
    players: entries.map(e => ({ id: e.id, name: e.name, position: e.position, team: e.team, boostPct: clampBoost(e.boostPct) })),
  }
  const rosters = readStore()
  const idx = rosters.findIndex(r => r.name === trimmed)
  if (idx >= 0) rosters[idx] = record
  else if (rosters.length < MAX_SAVED_ROSTERS) rosters.push(record)
  else return null
  writeStore(rosters)
  return rosters
}

export function deleteSavedRoster(name) {
  const rosters = readStore().filter(r => r.name !== name)
  writeStore(rosters)
  return rosters
}

// Rehydrate a saved roster against the current sim's pool: players still in
// the pool come back as picks (keeping their saved boost); players the current
// simulations never drafted are reported by name so the tab can say who was
// dropped rather than silently shrinking the roster.
export function resolveSavedRoster(saved, poolById) {
  const selection = []
  const missing = []
  for (const p of saved?.players || []) {
    if (poolById.has(p.id)) selection.push({ id: p.id, boostPct: clampBoost(p.boostPct) })
    else missing.push(p.name || p.id)
  }
  return { selection, missing }
}
