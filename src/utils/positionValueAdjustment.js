// Manual per-position value percentages (config.positionValueFactors).
// A league import fits per-position factors automatically (leagueProfile.js);
// this module is the user-editable version of the same idea: a multiplier per
// position, usable with or without an import. When an import is applied, the
// SetupScreen seeds these factors from the fitted profile (and neutralizes
// the profile's own copy) so the imported percentages become editable
// controls rather than a fixed black box.
//
// Factors are multipliers (1.0 = no change) stored as a plain object so they
// ride on config through the meta-sim worker's JSON round-trip. Application
// is the same additive pre-anchor delta convention as the sibling modules:
// delta = (factor − 1) × current book value, applied before the engine's
// budget anchor so only the relative shape survives.

export const ADJUSTABLE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']

// Manual range is intentionally wider than the import fitter's clamp
// ([0.6, 1.6]) — a superflex league legitimately wants QB at 2-3x — but still
// bounded so a typo can't produce a broken market. −75% .. +300%.
export const POSITION_FACTOR_LIMITS = [0.25, 4.0]

// Returns a clean factors object containing only known positions with finite
// non-neutral values, clamped to POSITION_FACTOR_LIMITS. {} = fully neutral.
export function sanitizePositionValueFactors(raw) {
  const factors = {}
  if (!raw || typeof raw !== 'object') return factors
  const [lo, hi] = POSITION_FACTOR_LIMITS
  for (const pos of ADJUSTABLE_POSITIONS) {
    const f = raw[pos]
    if (typeof f !== 'number' || !Number.isFinite(f)) continue
    const clamped = Math.min(hi, Math.max(lo, f))
    if (clamped !== 1.0) factors[pos] = Math.round(clamped * 100) / 100
  }
  return factors
}

// Map<playerId, dollarDelta> in the current book's dollar space.
export function buildPositionValueDeltas(players, factors) {
  const deltas = new Map()
  const clean = sanitizePositionValueFactors(factors)
  if (Object.keys(clean).length === 0 || !players?.length) return deltas
  for (const p of players) {
    const f = clean[p.position]
    if (f === undefined) continue
    const delta = (f - 1) * p.estimatedValue
    if (delta !== 0) deltas.set(p.id, delta)
  }
  return deltas
}

// Mutates estimatedValue in place; strict no-op without factors, same
// contract as the sibling apply functions.
export function applyPositionValueAdjustment(players, config) {
  const deltas = buildPositionValueDeltas(players, config?.positionValueFactors)
  if (deltas.size === 0) return
  for (const p of players) {
    const delta = deltas.get(p.id)
    if (delta) p.estimatedValue = Math.max(1, p.estimatedValue + delta)
  }
}
