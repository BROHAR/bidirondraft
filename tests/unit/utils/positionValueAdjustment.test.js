import { describe, it, expect } from 'vitest'
import {
  ADJUSTABLE_POSITIONS,
  POSITION_FACTOR_LIMITS,
  sanitizePositionValueFactors,
  buildPositionValueDeltas,
  applyPositionValueAdjustment,
} from '../../../src/utils/positionValueAdjustment.js'

const POOL = [
  { id: 'qb1', position: 'QB', estimatedValue: 20 },
  { id: 'qb2', position: 'QB', estimatedValue: 4 },
  { id: 'rb1', position: 'RB', estimatedValue: 50 },
  { id: 'wr1', position: 'WR', estimatedValue: 30 },
  { id: 'te1', position: 'TE', estimatedValue: 10 },
  { id: 'k1', position: 'K', estimatedValue: 1 },
]

describe('sanitizePositionValueFactors', () => {
  it('returns {} for junk input and neutral factors', () => {
    expect(sanitizePositionValueFactors(null)).toEqual({})
    expect(sanitizePositionValueFactors('QB')).toEqual({})
    expect(sanitizePositionValueFactors({ QB: 1.0, RB: 'x', FLEX: 2, WR: NaN })).toEqual({})
  })

  it('keeps known positions and clamps to the manual range', () => {
    const [lo, hi] = POSITION_FACTOR_LIMITS
    const clean = sanitizePositionValueFactors({ QB: 99, RB: 0.01, WR: 1.25 })
    expect(clean.QB).toBe(hi)
    expect(clean.RB).toBe(lo)
    expect(clean.WR).toBe(1.25)
  })

  it('covers all six adjustable positions', () => {
    const all = {}
    for (const pos of ADJUSTABLE_POSITIONS) all[pos] = 1.5
    expect(Object.keys(sanitizePositionValueFactors(all))).toEqual(ADJUSTABLE_POSITIONS)
  })
})

describe('buildPositionValueDeltas', () => {
  it('is empty with no factors', () => {
    expect(buildPositionValueDeltas(POOL, undefined).size).toBe(0)
    expect(buildPositionValueDeltas(POOL, {}).size).toBe(0)
  })

  it('produces (factor − 1) × value deltas for the targeted position only', () => {
    const deltas = buildPositionValueDeltas(POOL, { QB: 2.0 })
    expect(deltas.get('qb1')).toBe(20)
    expect(deltas.get('qb2')).toBe(4)
    expect(deltas.has('rb1')).toBe(false)
    expect(deltas.has('wr1')).toBe(false)
  })

  it('supports negative adjustments', () => {
    const deltas = buildPositionValueDeltas(POOL, { RB: 0.8 })
    expect(deltas.get('rb1')).toBeCloseTo(-10)
  })
})

describe('applyPositionValueAdjustment', () => {
  it('mutates values in place, flooring at $1', () => {
    const pool = POOL.map(p => ({ ...p }))
    applyPositionValueAdjustment(pool, { positionValueFactors: { QB: 2.5, TE: 0.25 } })
    expect(pool.find(p => p.id === 'qb1').estimatedValue).toBe(50)
    expect(pool.find(p => p.id === 'te1').estimatedValue).toBe(2.5)
    // 0.25 clamp already at the floor of the range; a $1 K stays ≥ $1
    applyPositionValueAdjustment(pool, { positionValueFactors: { K: 0.25 } })
    expect(pool.find(p => p.id === 'k1').estimatedValue).toBe(1)
  })

  it('is a strict no-op without config factors', () => {
    const pool = POOL.map(p => ({ ...p }))
    applyPositionValueAdjustment(pool, {})
    applyPositionValueAdjustment(pool, undefined)
    expect(pool).toEqual(POOL)
  })
})
