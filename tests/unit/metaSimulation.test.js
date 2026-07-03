import { describe, it, expect } from 'vitest'
import {
  mean,
  median,
  stdev,
  aggregateRows,
  computeFieldAverages,
  generateMetaTakeaways,
  aggregateWinningComposition,
  selectBlueprints,
  buildStrategyDreamTeams,
} from '../../src/utils/metaSimulation.js'

const zeroPos = () => ({ QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 })

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
    positionSpend: zeroPos(),
    positionStarterPoints: zeroPos(),
    positionCounts: zeroPos(),
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

describe('aggregateWinningComposition', () => {
  it('counts only winners for samples/spend/counts but win rate over all rows', () => {
    const rows = [
      row({ strategyName: 'A', isWinner: true, positionSpend: { ...zeroPos(), RB: 100 }, positionCounts: { ...zeroPos(), RB: 4 }, positionStarterPoints: { ...zeroPos(), RB: 300 } }),
      row({ strategyName: 'A', isWinner: false, positionSpend: { ...zeroPos(), WR: 100 }, positionCounts: { ...zeroPos(), WR: 4 }, positionStarterPoints: { ...zeroPos(), WR: 999 } }),
      row({ strategyName: 'A', isWinner: false }),
      row({ strategyName: 'B', isWinner: true, positionSpend: { ...zeroPos(), RB: 60, WR: 40 }, positionCounts: { ...zeroPos(), RB: 3, WR: 3 }, positionStarterPoints: { ...zeroPos(), RB: 200 } }),
    ]
    const wc = aggregateWinningComposition(rows)

    // Two winners; non-winner spend/counts/points excluded.
    expect(wc.samples).toBe(2)
    expect(wc.positionSpend.RB).toBe(80)   // mean of 100 and 60
    expect(wc.positionSpend.WR).toBe(20)   // mean of 0 and 40 (non-winner WR ignored)
    expect(wc.positionCounts.RB).toBe(3.5) // mean of 4 and 3
    expect(wc.positionStarterPoints.RB).toBe(250) // mean of 300 and 200
    expect(wc.positionStarterPoints.WR).toBe(0)   // non-winner WR points ignored

    // Field-wide win rate over ALL rows.
    const byName = Object.fromEntries(wc.winRateByStrategy.map(r => [r.strategyName, r]))
    expect(byName.A).toMatchObject({ games: 3, wins: 1 })
    expect(byName.A.winRate).toBeCloseTo(1 / 3, 10)
    expect(byName.B).toMatchObject({ games: 1, wins: 1, winRate: 1 })
  })

  it('positionSpendPct sums to ~1 among winners and is sorted by win rate', () => {
    const rows = [
      row({ strategyName: 'Low', isWinner: false }),
      row({ strategyName: 'Low', isWinner: false }),
      row({ strategyName: 'High', isWinner: true, positionSpend: { ...zeroPos(), RB: 50, WR: 50 } }),
    ]
    const wc = aggregateWinningComposition(rows)
    const total = Object.values(wc.positionSpendPct).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 10)
    expect(wc.positionSpendPct.RB).toBeCloseTo(0.5, 10)
    // Sorted descending by win rate.
    expect(wc.winRateByStrategy[0].strategyName).toBe('High')
  })

  it('empty input yields zero samples, zeroed maps, and no strategy rows', () => {
    const wc = aggregateWinningComposition([])
    expect(wc.samples).toBe(0)
    expect(Object.values(wc.positionSpendPct).reduce((a, b) => a + b, 0)).toBe(0)
    expect(Object.values(wc.positionCounts).reduce((a, b) => a + b, 0)).toBe(0)
    expect(wc.winRateByStrategy).toEqual([])
  })
})

describe('selectBlueprints', () => {
  const bp = (strategyName, starterPoints, names) => ({
    strategyName, seed: 1, starterPoints, totalSpent: 200, benchCount: 6,
    starters: names.map(n => ({ slot: 'RB', name: n, position: 'RB', team: 'X', price: 10, points: 100 })),
  })

  it('picks the winningest strategy and returns its highest-scoring builds', () => {
    const all = [
      bp('HeroRB', 1100, ['a', 'b']),
      bp('HeroRB', 1200, ['c', 'd']),
      bp('Balanced', 1500, ['e', 'f']), // higher points but not the winningest strategy
    ]
    const winRate = [{ strategyName: 'HeroRB', winRate: 0.5 }, { strategyName: 'Balanced', winRate: 0.2 }]
    const out = selectBlueprints(all, winRate, 5)
    expect(out.strategyName).toBe('HeroRB')
    expect(out.winRate).toBe(0.5)
    expect(out.teams.map(t => t.starterPoints)).toEqual([1200, 1100]) // sorted desc, Balanced excluded
  })

  it('de-duplicates identical starter sets and honors the limit', () => {
    const all = [
      bp('HeroRB', 1200, ['a', 'b']),
      bp('HeroRB', 1100, ['b', 'a']), // same set, different order -> duplicate
      bp('HeroRB', 1000, ['c', 'd']),
      bp('HeroRB', 900, ['e', 'f']),
    ]
    const winRate = [{ strategyName: 'HeroRB', winRate: 0.4 }]
    const out = selectBlueprints(all, winRate, 2)
    expect(out.teams.length).toBe(2)
    expect(out.teams.map(t => t.starterPoints)).toEqual([1200, 1000]) // dupe dropped, limit respected
  })

  it('returns an empty selection when there are no blueprints or no strategies', () => {
    expect(selectBlueprints([], [{ strategyName: 'A', winRate: 1 }])).toEqual({ strategyName: null, winRate: 0, teams: [] })
    expect(selectBlueprints([bp('A', 100, ['x'])], [])).toEqual({ strategyName: null, winRate: 0, teams: [] })
  })
})

describe('buildStrategyDreamTeams', () => {
  const rc = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 }
  const entry = (id, position, pts, count, avgPrice) => ({
    id, name: id, position, team: 'X', projectedPoints: pts, count, priceSum: avgPrice * count,
  })
  const poolFor = (entries) => new Map(entries.map(e => [e.id, e]))
  const fullPool = () => poolFor([
    entry('qb1', 'QB', 300, 10, 20), entry('qb2', 'QB', 250, 5, 10),
    entry('rb1', 'RB', 280, 10, 50), entry('rb2', 'RB', 260, 10, 40), entry('rb3', 'RB', 200, 8, 15), entry('rb4', 'RB', 180, 6, 8),
    entry('wr1', 'WR', 270, 10, 45), entry('wr2', 'WR', 250, 10, 35), entry('wr3', 'WR', 210, 8, 20), entry('wr4', 'WR', 190, 6, 10),
    entry('te1', 'TE', 180, 10, 25), entry('te2', 'TE', 140, 6, 8),
    entry('k1', 'K', 130, 10, 2), entry('dst1', 'DST', 110, 10, 3),
  ])

  it('builds one ideal team per top strategy, ranked by win rate, within budget', () => {
    const pools = new Map([['HeroRB', fullPool()], ['Balanced', fullPool()], ['ZeroRB', fullPool()]])
    const winRate = [
      { strategyName: 'HeroRB', winRate: 0.5 },
      { strategyName: 'Balanced', winRate: 0.3 },
      { strategyName: 'ZeroRB', winRate: 0.2 },
    ]
    const out = buildStrategyDreamTeams(pools, winRate, rc, 200, 2) // limit 2
    expect(out.map(o => o.strategyName)).toEqual(['HeroRB', 'Balanced'])
    // Fills the 9 starting slots in slot order.
    expect(out[0].rows.map(r => r.slotLabel)).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DST'])
    expect(out[0].rows.every(r => r.name)).toBe(true)
    // Stays within the starter budget (budget minus the bench reserve).
    expect(out[0].totalCost).toBeLessThanOrEqual(200 - rc.BENCH)
    expect(out[0].totalPoints).toBeGreaterThan(0)
  })

  it('skips strategies with no captured pool and respects the limit', () => {
    const pools = new Map([['A', fullPool()]])
    const winRate = [{ strategyName: 'Missing', winRate: 0.9 }, { strategyName: 'A', winRate: 0.5 }]
    const out = buildStrategyDreamTeams(pools, winRate, rc, 200, 5)
    expect(out.map(o => o.strategyName)).toEqual(['A'])
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
