import { describe, it, expect } from 'vitest'
import {
  buildFormatValueDeltas,
  applyFormatValueAdjustment,
} from '../../../src/utils/formatValueAdjustment.js'

// Minimal pool with format-differentiated pass-catchers. Points are chosen so
// replacement level per position is the last player, keeping VORP arithmetic
// easy to follow: WRs swing with receptions, RB barely does, QB/K/DST not at all.
function makePool() {
  return [
    // WR1: 90 catches — big PPR gainer
    { id: 'wr1', position: 'WR', estimatedValue: 40, allProjections: { standard: 200, halfPPR: 245, ppr: 290 } },
    { id: 'wr2', position: 'WR', estimatedValue: 20, allProjections: { standard: 160, halfPPR: 190, ppr: 220 } },
    // Replacement WR
    { id: 'wr3', position: 'WR', estimatedValue: 1, allProjections: { standard: 100, halfPPR: 120, ppr: 140 } },
    // RB1: volume runner, few catches
    { id: 'rb1', position: 'RB', estimatedValue: 40, allProjections: { standard: 240, halfPPR: 250, ppr: 260 } },
    { id: 'rb2', position: 'RB', estimatedValue: 15, allProjections: { standard: 180, halfPPR: 195, ppr: 210 } },
    // Replacement RB
    { id: 'rb3', position: 'RB', estimatedValue: 1, allProjections: { standard: 120, halfPPR: 130, ppr: 140 } },
    // QB/K/DST: format-identical points
    { id: 'qb1', position: 'QB', estimatedValue: 25, allProjections: { standard: 350, halfPPR: 350, ppr: 350 } },
    { id: 'qb2', position: 'QB', estimatedValue: 1, allProjections: { standard: 280, halfPPR: 280, ppr: 280 } },
    { id: 'k1', position: 'K', estimatedValue: 2, allProjections: { standard: 150, halfPPR: 150, ppr: 150 } },
    { id: 'k2', position: 'K', estimatedValue: 1, allProjections: { standard: 130, halfPPR: 130, ppr: 130 } },
    { id: 'dst1', position: 'DST', estimatedValue: 2, allProjections: { standard: 120, halfPPR: 120, ppr: 120 } },
    { id: 'dst2', position: 'DST', estimatedValue: 1, allProjections: { standard: 100, halfPPR: 100, ppr: 100 } },
  ]
}

const CONFIG = {
  numberOfTeams: 2,
  rosterPositions: { QB: 1, RB: 1, WR: 1, K: 1, DST: 1 },
}

describe('buildFormatValueDeltas', () => {
  it('returns an empty map for halfPPR (exact no-op)', () => {
    expect(buildFormatValueDeltas(makePool(), { ...CONFIG, scoringFormat: 'halfPPR' }).size).toBe(0)
    expect(buildFormatValueDeltas(makePool(), { ...CONFIG, scoringFormat: undefined }).size).toBe(0)
  })

  it('raises reception-heavy WRs under ppr and lowers them under standard', () => {
    const pool = makePool()
    const ppr = buildFormatValueDeltas(pool, { ...CONFIG, scoringFormat: 'ppr' })
    const std = buildFormatValueDeltas(pool, { ...CONFIG, scoringFormat: 'standard' })
    expect(ppr.get('wr1')).toBeGreaterThan(0)
    expect(std.get('wr1')).toBeLessThan(0)
    // WR1 (bigger reception share) swings harder than WR2
    expect(ppr.get('wr1')).toBeGreaterThan(ppr.get('wr2'))
  })

  it('gives format-identical positions (QB/K/DST) exactly zero delta', () => {
    const pool = makePool()
    for (const format of ['standard', 'ppr']) {
      const deltas = buildFormatValueDeltas(pool, { ...CONFIG, scoringFormat: format })
      for (const id of ['qb1', 'qb2', 'k1', 'k2', 'dst1', 'dst2']) {
        expect(deltas.get(id) ?? 0).toBe(0)
      }
    }
  })

  it('leaves legacy numeric-projection players unchanged', () => {
    const pool = makePool()
    // Legacy Player shape: allProjections = { halfPPR: n } only
    pool.push({ id: 'legacy', position: 'WR', estimatedValue: 10, projectedPoints: 150, allProjections: { halfPPR: 150 } })
    const deltas = buildFormatValueDeltas(pool, { ...CONFIG, scoringFormat: 'ppr' })
    expect(deltas.get('legacy') ?? 0).toBe(0)
  })

  it('no-ops when the pool has zero total VORP', () => {
    // Single player per position = everyone IS the replacement → zero VORP
    const flatPool = makePool().filter(p => p.id.endsWith('3'))
    expect(buildFormatValueDeltas(flatPool, { ...CONFIG, scoringFormat: 'ppr' }).size).toBe(0)
  })

  it('reads raw players.json entries (projectedPoints as per-format object)', () => {
    // Same pool but in the on-disk shape: no allProjections, points map under
    // projectedPoints — the shape SetupScreen feeds the modals.
    const raw = makePool().map(({ allProjections, ...p }) => ({ ...p, projectedPoints: allProjections }))
    const deltas = buildFormatValueDeltas(raw, { ...CONFIG, scoringFormat: 'ppr' })
    expect(deltas.get('wr1')).toBeGreaterThan(0)
    expect(deltas.get('qb1') ?? 0).toBe(0)
  })

  it('handles SUPERFLEX rosters without error and still zeroes QB deltas', () => {
    const deltas = buildFormatValueDeltas(makePool(), {
      ...CONFIG,
      rosterPositions: { QB: 1, RB: 1, WR: 1, SUPERFLEX: 1 },
      scoringFormat: 'ppr',
    })
    expect(deltas.get('qb1') ?? 0).toBe(0)
    expect(deltas.get('wr1')).toBeGreaterThan(0)
  })
})

describe('applyFormatValueAdjustment', () => {
  it('mutates estimatedValue in place and clamps at $1', () => {
    const pool = makePool()
    // Make wr2 cheap enough that its negative standard delta drives it below $1
    pool.find(p => p.id === 'wr2').estimatedValue = 2
    const before = Object.fromEntries(pool.map(p => [p.id, p.estimatedValue]))
    applyFormatValueAdjustment(pool, { ...CONFIG, scoringFormat: 'standard' })

    const byId = Object.fromEntries(pool.map(p => [p.id, p.estimatedValue]))
    expect(byId.wr1).toBeLessThan(before.wr1)
    expect(byId.wr2).toBe(1)
    expect(byId.qb1).toBe(before.qb1)
    expect(byId.k1).toBe(before.k1)
  })

  it('is a no-op for halfPPR', () => {
    const pool = makePool()
    const before = pool.map(p => p.estimatedValue)
    applyFormatValueAdjustment(pool, { ...CONFIG, scoringFormat: 'halfPPR' })
    expect(pool.map(p => p.estimatedValue)).toEqual(before)
  })
})
