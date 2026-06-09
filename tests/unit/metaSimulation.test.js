import { describe, it, expect } from 'vitest'
import {
  mean,
  median,
  stdev,
  aggregateRows,
  computeFieldAverages,
  generateMetaTakeaways,
} from '../../src/utils/metaSimulation.js'

// Build a TeamRow the way extractTeamRows would, with sensible defaults.
function row(overrides = {}) {
  return {
    strategyName: 'Balanced',
    isHuman: false,
    teamId: 'team_1',
    starterPoints: 1000,
    valueCapture: 0,
    teamVorp: 100,
    finishRank: 6,
    isWinner: false,
    positionSpend: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 },
    ...overrides,
  }
}

describe('numeric helpers', () => {
  it('mean handles empty and normal inputs', () => {
    expect(mean([])).toBe(0)
    expect(mean([2, 4, 6])).toBe(4)
  })

  it('median handles empty, odd, and even inputs', () => {
    expect(median([])).toBe(0)
    expect(median([5])).toBe(5)
    expect(median([3, 1, 2])).toBe(2)          // odd, unsorted
    expect(median([1, 2, 3, 4])).toBe(2.5)     // even -> average of middle two
  })

  it('stdev is 0 for <2 samples and population sd otherwise', () => {
    expect(stdev([])).toBe(0)
    expect(stdev([7])).toBe(0)
    expect(stdev([2, 4, 6])).toBeCloseTo(Math.sqrt(8 / 3), 10)
  })
})

describe('aggregateRows', () => {
  it('groups by strategy and counts samples', () => {
    const rows = [
      row({ strategyName: 'A' }),
      row({ strategyName: 'A' }),
      row({ strategyName: 'B' }),
    ]
    const summaries = aggregateRows(rows)
    const byName = Object.fromEntries(summaries.map(s => [s.strategyName, s]))
    expect(byName.A.samples).toBe(2)
    expect(byName.B.samples).toBe(1)
  })

  it('computes win rate as the fraction of winning rows', () => {
    const rows = [
      row({ strategyName: 'A', isWinner: true }),
      row({ strategyName: 'A', isWinner: false }),
      row({ strategyName: 'A', isWinner: true }),
      row({ strategyName: 'A', isWinner: false }),
    ]
    const [s] = aggregateRows(rows)
    expect(s.winRate).toBe(0.5)
  })

  it('positionSpendPct reflects the spend split and sums to ~1', () => {
    const rows = [
      row({ strategyName: 'A', positionSpend: { QB: 10, RB: 30, WR: 60, TE: 0, K: 0, DST: 0 } }),
    ]
    const [s] = aggregateRows(rows)
    expect(s.positionSpendPct.RB).toBeCloseTo(0.3, 10)
    expect(s.positionSpendPct.WR).toBeCloseTo(0.6, 10)
    const total = Object.values(s.positionSpendPct).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('positionSpendPct is all zero when nothing was spent (no divide-by-zero)', () => {
    const [s] = aggregateRows([row({ strategyName: 'A' })])
    const total = Object.values(s.positionSpendPct).reduce((a, b) => a + b, 0)
    expect(total).toBe(0)
  })

  it('averages starter points and reports median/stdev', () => {
    const rows = [
      row({ strategyName: 'A', starterPoints: 900 }),
      row({ strategyName: 'A', starterPoints: 1100 }),
    ]
    const [s] = aggregateRows(rows)
    expect(s.starterPoints.mean).toBe(1000)
    expect(s.starterPoints.median).toBe(1000)
    expect(s.starterPoints.stdev).toBe(100)
  })
})

describe('computeFieldAverages + generateMetaTakeaways', () => {
  const summaries = [
    {
      strategyName: 'A', rank: 1, samples: 10,
      starterPoints: { mean: 1100, median: 1100, stdev: 0 },
      valueCapture: { mean: 12 }, teamVorp: { mean: 200 }, finishRank: { mean: 3 },
      winRate: 0.4,
      positionSpend: { QB: 0, RB: 60, WR: 30, TE: 10, K: 0, DST: 0 },
      positionSpendPct: { QB: 0, RB: 0.6, WR: 0.3, TE: 0.1, K: 0, DST: 0 },
    },
    {
      strategyName: 'B', rank: 2, samples: 10,
      starterPoints: { mean: 900, median: 900, stdev: 0 },
      valueCapture: { mean: -8 }, teamVorp: { mean: 100 }, finishRank: { mean: 9 },
      winRate: 0.1,
      positionSpend: { QB: 0, RB: 20, WR: 70, TE: 10, K: 0, DST: 0 },
      positionSpendPct: { QB: 0, RB: 0.2, WR: 0.7, TE: 0.1, K: 0, DST: 0 },
    },
  ]

  it('field averages are the mean across strategies', () => {
    const f = computeFieldAverages(summaries)
    expect(f.starterPoints).toBe(1000)
    expect(f.positionSpendPct.RB).toBeCloseTo(0.4, 10)
  })

  it('takeaways surface the winner, its positional lean, and value capture', () => {
    const f = computeFieldAverages(summaries)
    const takeaways = generateMetaTakeaways(summaries[0], f)
    expect(takeaways.length).toBeGreaterThan(0)
    expect(takeaways.length).toBeLessThanOrEqual(4)
    expect(takeaways[0]).toMatch(/Your best play/)
    // Surfaces a positional-spend tendency and the captured value.
    expect(takeaways.join(' ')).toMatch(/Puts \d+% of your budget into/)
    expect(takeaways.join(' ')).toMatch(/Captured \$12/)
  })

  it('flags the overpaying strategy', () => {
    const f = computeFieldAverages(summaries)
    const takeaways = generateMetaTakeaways(summaries[1], f)
    expect(takeaways.join(' ')).toMatch(/Overpaid by \$8/)
  })
})
