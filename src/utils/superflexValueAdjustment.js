// Superflex / 2QB valuation. estimatedValue in players.json comes from
// Yahoo's salary-cap data, which assumes a 1-QB league — so the QB book has a
// hard cliff (QB1 ~$29, QB10+ all $1-3). In a league whose roster includes a
// SUPERFLEX slot (or 2+ QB slots), most teams start two QBs, replacement
// level drops from ~QB12 to ~QB22, and the entire startable QB tier carries
// real auction value. This module rescales the QB book for those leagues.
//
// Approach ("price QB scarcity the way the market already prices flex
// scarcity"): a QB's superflex value should match what the book charges for
// an RB/WR of equivalent scarcity. Concretely:
//
//   1. Compute each QB's VORP against the superflex replacement level —
//      the QB ranked at numberOfTeams × (QB slots + SF_QB_FILL × SUPERFLEX
//      slots), since superflex seats are started as QBs ~85% of the time.
//   2. Build a monotone VORP → dollars curve from the RB/WR book: the i-th
//      highest RB/WR VORP (against the league's own RB/WR replacement
//      levels) is paired with the i-th highest RB/WR book value. Rank-
//      matching both sides independently keeps the curve monotone and
//      smooths per-player market noise; the book's convexity (stars cost
//      disproportionately more per point) carries over automatically.
//   3. A QB's superflex price is that curve evaluated at his superflex
//      VORP; his delta is max(0, price − book), so no QB is ever devalued
//      and the book's residual name-value ordering survives among QBs the
//      curve prices equally.
//
// Everything is computed in half-PPR points (the book's native calibration —
// QBs score the same in every format anyway) and in $200-reference dollars,
// the same additive pre-anchor delta convention as buildFormatValueDeltas
// and buildLeagueProfileDeltas. The engine's downstream budget anchor
// re-normalizes the pool total to teams × budget, so adding QB value here
// deflates everyone else proportionally and total money stays consistent —
// only the (now QB-aware) relative shape survives. On the bundled book this
// lands the QB tier at ~25% of total pool value for a 12-team superflex
// league, in line with real superflex auction markets, with no cliff:
// elite QBs near top RB/WR prices, QB10-15 in the $20s, QB16-20 in the
// teens, and only the non-startable tail at $1-2.

// Share of SUPERFLEX starts that are QBs in practice. The remaining ~15%
// (an RB/WR/TE flex started over a healthy QB) is ignored on the flex side —
// its effect on RB/WR replacement is a fraction of one roster spot.
const SF_QB_FILL = 0.85

const pointsOf = p => {
  const src = p.allProjections ??
    (typeof p.projectedPoints === 'object' ? p.projectedPoints : { halfPPR: p.projectedPoints })
  return src?.halfPPR ?? 0
}

// A league is QB-premium when its roster can start more than one QB.
export function isSuperflexConfig(rosterPositions) {
  const rp = rosterPositions || {}
  return (rp.SUPERFLEX || 0) > 0 || (rp.QB || 0) > 1
}

// Replacement-level points for a position: the player at sorted rank
// `rank` (same indexing convention as getReplacementLevels), clamped to the
// end of the list.
function replacementPoints(sorted, rank) {
  if (sorted.length === 0) return 0
  const idx = Math.min(Math.max(0, Math.round(rank)), sorted.length - 1)
  return pointsOf(sorted[idx])
}

// Map<playerId, positiveDollarDelta> lifting QBs to their superflex price.
// Empty map for 1-QB leagues — the strict no-op path the seeded integration
// tests rely on.
export function buildSuperflexValueDeltas(players, { numberOfTeams, rosterPositions } = {}) {
  const deltas = new Map()
  const rp = rosterPositions || {}
  if (!isSuperflexConfig(rp) || !players?.length) return deltas
  const n = numberOfTeams > 0 ? numberOfTeams : 12

  const byPos = pos => players
    .filter(p => p.position === pos)
    .sort((a, b) => pointsOf(b) - pointsOf(a))

  // Superflex QB replacement: last QB started league-wide.
  const qbs = byPos('QB')
  if (qbs.length === 0) return deltas
  const qbStarts = (rp.QB || 0) + SF_QB_FILL * (rp.SUPERFLEX || 0)
  const qbRepl = replacementPoints(qbs, n * qbStarts)

  // RB/WR VORP against the league's own flex replacement (FLEX seats split
  // /3 across RB/WR/TE, matching getReplacementThresholds).
  const flexShare = (rp.FLEX || 0) / 3
  const flexSamples = []
  for (const pos of ['RB', 'WR']) {
    const sorted = byPos(pos)
    const repl = replacementPoints(sorted, n * ((rp[pos] || 0) + flexShare))
    for (const p of sorted) {
      flexSamples.push({ vorp: Math.max(0, pointsOf(p) - repl), value: p.estimatedValue })
    }
  }
  if (flexSamples.length === 0) return deltas

  // Rank-matched monotone curve: i-th highest VORP ↔ i-th highest book value.
  const vs = flexSamples.map(s => s.vorp).sort((a, b) => b - a)
  const ys = flexSamples.map(s => s.value).sort((a, b) => b - a)
  const priceAt = (vorp) => {
    if (vorp <= 0) return 1
    if (vorp >= vs[0]) return ys[0]   // never above the top flex book value
    for (let i = 1; i < vs.length; i++) {
      if (vs[i] <= vorp) {
        const span = vs[i - 1] - vs[i]
        const t = span > 0 ? (vorp - vs[i]) / span : 0
        return ys[i] + t * (ys[i - 1] - ys[i])
      }
    }
    return 1
  }

  for (const p of qbs) {
    const price = priceAt(Math.max(0, pointsOf(p) - qbRepl))
    const delta = price - p.estimatedValue
    if (delta > 0) deltas.set(p.id, delta)
  }
  return deltas
}

// Mutates estimatedValue in place, same contract as the sibling apply
// functions in formatValueAdjustment / leagueProfile.
export function applySuperflexValueAdjustment(players, config) {
  const deltas = buildSuperflexValueDeltas(players, {
    numberOfTeams: config?.numberOfTeams,
    rosterPositions: config?.rosterPositions,
  })
  if (deltas.size === 0) return
  for (const p of players) {
    const delta = deltas.get(p.id)
    if (delta) p.estimatedValue = Math.max(1, p.estimatedValue + delta)
  }
}
