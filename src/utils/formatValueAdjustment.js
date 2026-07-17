import { getReplacementLevels } from './draftAnalysis.js'
import { REFERENCE_BUDGET } from './budgetScaling.js'

// estimatedValue in players.json is market-calibrated to half PPR (Yahoo's
// salary-cap default). When the league scores standard or full PPR, each
// player's value shifts by their change in VORP converted to dollars at a
// single half-PPR-anchored rate. The delta is additive (preserves Yahoo's
// market structure — positional premiums, name value — where ratios explode
// near replacement level) and the conversion rate is shared across formats:
// a per-format rate would hand QB/K/DST spurious deltas because total pool
// VORP shifts between formats even though their own points don't.
//
// 1.0 = full VORP-implied swing. If playtesting shows elite pass-catcher
// prices overshooting the market, 0.7–0.85 is the sensible dampening range.
const FORMAT_DELTA_WEIGHT = 1.0

// Works on both Player instances (allProjections map) and raw players.json
// entries (projectedPoints as a per-format object, or a legacy number).
const pointsIn = fmt => p => {
  const src = p.allProjections ??
    (typeof p.projectedPoints === 'object' ? p.projectedPoints : { halfPPR: p.projectedPoints })
  return src?.[fmt] ?? src?.halfPPR ?? 0
}

// Map<playerId, dollarDelta> for the given scoring format, relative to the
// half-PPR baseline. Empty map = no adjustment. Deltas are in $200-reference
// book dollars — the same space as raw estimatedValue — so budget scaling
// stays downstream (the engine's budget anchor, or scaleValueToBudget in UI).
export function buildFormatValueDeltas(players, { scoringFormat, numberOfTeams, rosterPositions }) {
  const deltas = new Map()
  if (!scoringFormat || scoringFormat === 'halfPPR') return deltas
  if (!players?.length) return deltas

  const basePoints = pointsIn('halfPPR')
  const formatPoints = pointsIn(scoringFormat)
  const base = getReplacementLevels(players, rosterPositions, numberOfTeams, basePoints)
  const target = getReplacementLevels(players, rosterPositions, numberOfTeams, formatPoints)

  const vorp = (p, pts, levels) => Math.max(0, pts(p) - (levels[p.position] ?? 0))

  const totalBaseVorp = players.reduce((sum, p) => sum + vorp(p, basePoints, base.levels), 0)
  const rosterSize = Object.values(rosterPositions || {}).reduce((s, c) => s + c, 0)
  // Standard AAV method: money above the $1-per-slot minimum is what VORP buys.
  const discretionary = numberOfTeams * REFERENCE_BUDGET - numberOfTeams * rosterSize
  if (totalBaseVorp <= 0 || discretionary <= 0) return deltas

  const dollarsPerVorp = discretionary / totalBaseVorp
  for (const p of players) {
    const delta = FORMAT_DELTA_WEIGHT * dollarsPerVorp *
      (vorp(p, formatPoints, target.levels) - vorp(p, basePoints, base.levels))
    if (delta !== 0) deltas.set(p.id, delta)
  }
  return deltas
}

// Mutates estimatedValue in place (the engine's calibration stages do the
// same); rounding is left to the engine's existing floor/round pass.
export function applyFormatValueAdjustment(players, config) {
  const deltas = buildFormatValueDeltas(players, {
    scoringFormat: config.scoringFormat,
    numberOfTeams: config.numberOfTeams,
    rosterPositions: config.rosterPositions,
  })
  if (deltas.size === 0) return
  for (const p of players) {
    const delta = deltas.get(p.id)
    if (delta !== undefined) {
      p.estimatedValue = Math.max(1, p.estimatedValue + delta)
    }
  }
}
