import { describe, it, expect } from 'vitest'
import {
  isSuperflexConfig,
  buildSuperflexValueDeltas,
  applySuperflexValueAdjustment,
} from '../../../src/utils/superflexValueAdjustment.js'
import playersData from '../../../src/data/players.json'

// The real bundled book — the exact data the user-reported problem lives in
// (1-QB Yahoo values: QB1 ~$29, then a cliff to $1-3 by QB10). Assertions on
// it are deliberately loose so routine projection refreshes don't break them,
// while still failing if the superflex QB market ever collapses again.
const POOL = playersData.players

const SUPERFLEX_ROSTER = {
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 1, K: 1, DST: 1, BENCH: 5,
}
const STANDARD_ROSTER = {
  QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6,
}

const halfPPR = p => p.projectedPoints?.halfPPR ?? 0

function sfValues(numberOfTeams = 12, rosterPositions = SUPERFLEX_ROSTER) {
  const deltas = buildSuperflexValueDeltas(POOL, { numberOfTeams, rosterPositions })
  return { deltas, valueOf: p => p.estimatedValue + (deltas.get(p.id) || 0) }
}

describe('isSuperflexConfig', () => {
  it('detects SUPERFLEX slots and 2QB rosters, rejects 1-QB rosters', () => {
    expect(isSuperflexConfig(SUPERFLEX_ROSTER)).toBe(true)
    expect(isSuperflexConfig({ ...STANDARD_ROSTER, QB: 2 })).toBe(true)
    expect(isSuperflexConfig(STANDARD_ROSTER)).toBe(false)
    expect(isSuperflexConfig(undefined)).toBe(false)
  })
})

describe('buildSuperflexValueDeltas', () => {
  it('is an exact no-op for 1-QB leagues', () => {
    const deltas = buildSuperflexValueDeltas(POOL, {
      numberOfTeams: 12,
      rosterPositions: STANDARD_ROSTER,
    })
    expect(deltas.size).toBe(0)
  })

  it('only ever lifts QBs, never touches other positions', () => {
    const { deltas } = sfValues()
    expect(deltas.size).toBeGreaterThan(0)
    const byId = new Map(POOL.map(p => [p.id, p]))
    for (const [id, delta] of deltas) {
      expect(byId.get(id).position).toBe('QB')
      expect(delta).toBeGreaterThan(0)
    }
  })

  it('puts elite QBs near top-tier RB/WR prices in a 12-team superflex league', () => {
    const { valueOf } = sfValues()
    const qbs = POOL.filter(p => p.position === 'QB').sort((a, b) => halfPPR(b) - halfPPR(a))
    const topFlex = Math.max(...POOL
      .filter(p => p.position === 'RB' || p.position === 'WR')
      .map(p => p.estimatedValue))
    const qb1 = valueOf(qbs[0])
    expect(qb1).toBeGreaterThan(topFlex * 0.6)
    expect(qb1).toBeLessThanOrEqual(topFlex)   // capped at the top flex price
  })

  it('removes the mid-QB cliff: QB6-15 all hold meaningful value', () => {
    const { valueOf } = sfValues()
    const qbs = POOL.filter(p => p.position === 'QB').sort((a, b) => halfPPR(b) - halfPPR(a))
    for (const qb of qbs.slice(5, 15)) {
      expect(valueOf(qb), `${qb.name} should be a real superflex asset`).toBeGreaterThanOrEqual(10)
    }
    // The QB market is a curve, not a flat band: QB1 clearly above QB12.
    expect(valueOf(qbs[0])).toBeGreaterThan(valueOf(qbs[11]) * 1.4)
  })

  it('leaves the non-startable QB tail near $1-2', () => {
    const { valueOf } = sfValues()
    const qbs = POOL.filter(p => p.position === 'QB').sort((a, b) => halfPPR(b) - halfPPR(a))
    for (const qb of qbs.slice(28, 40)) {
      expect(valueOf(qb)).toBeLessThanOrEqual(4)
    }
  })

  it('scales QB scarcity with league size: deeper leagues boost QBs more', () => {
    const totalDelta = n => {
      const { deltas } = sfValues(n)
      let sum = 0
      for (const d of deltas.values()) sum += d
      return sum
    }
    expect(totalDelta(14)).toBeGreaterThan(totalDelta(8))
  })

  it('treats a 2QB roster (QB: 2, no SUPERFLEX) as QB-premium too', () => {
    const { deltas } = sfValues(12, { ...STANDARD_ROSTER, QB: 2, BENCH: 5 })
    expect(deltas.size).toBeGreaterThan(0)
  })

  it('handles empty pools and missing config without throwing', () => {
    expect(buildSuperflexValueDeltas([], { numberOfTeams: 12, rosterPositions: SUPERFLEX_ROSTER }).size).toBe(0)
    expect(buildSuperflexValueDeltas(POOL, {}).size).toBe(0)
    expect(buildSuperflexValueDeltas(POOL, undefined).size).toBe(0)
  })
})

describe('applySuperflexValueAdjustment', () => {
  it('mutates QB estimatedValue in place and leaves others untouched', () => {
    const pool = POOL.map(p => ({ ...p }))
    const before = new Map(pool.map(p => [p.id, p.estimatedValue]))
    applySuperflexValueAdjustment(pool, { numberOfTeams: 12, rosterPositions: SUPERFLEX_ROSTER })
    let qbLifted = 0
    for (const p of pool) {
      if (p.position === 'QB') {
        expect(p.estimatedValue).toBeGreaterThanOrEqual(before.get(p.id))
        if (p.estimatedValue > before.get(p.id)) qbLifted++
      } else {
        expect(p.estimatedValue).toBe(before.get(p.id))
      }
    }
    expect(qbLifted).toBeGreaterThanOrEqual(15)
  })

  it('is a strict no-op for a standard config', () => {
    const pool = POOL.map(p => ({ ...p }))
    const before = pool.map(p => p.estimatedValue)
    applySuperflexValueAdjustment(pool, { numberOfTeams: 12, rosterPositions: STANDARD_ROSTER })
    expect(pool.map(p => p.estimatedValue)).toEqual(before)
  })
})
