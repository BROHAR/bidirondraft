import { describe, it, expect } from 'vitest'
import {
  getStartingLineup,
  calculateStarterPoints,
  getTotalValueCapture,
  rankTeamsByStarterPoints,
  calculateDraftGrade,
  gradeColor,
  getValueLabel,
  getVariancePosition,
  getMarketAveragesByPosition,
  getBestValues,
  getBiggestOverpays,
  getByeWeekMap,
  getPositionSpendingByGroup,
  getHumanPicksTimeline,
  generateTakeaways,
  generateValueCostTakeaways,
  getLeagueAvgPointsPerDollar,
  getPointsValueLabel,
  getPickAnalysis,
  getReplacementThresholds,
  getReplacementLevels,
  getPlayerVORP,
  getTeamVORP,
} from '../../../src/utils/draftAnalysis.js'

function makePlayer(overrides = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Player',
    position: 'WR',
    nflTeam: 'KC',
    estimatedValue: 20,
    purchasePrice: 20,
    projectedPoints: 150,
    byeWeek: 7,
    ...overrides,
  }
}

function makeTeam(overrides = {}) {
  return {
    id: 't1',
    name: 'Team A',
    budget: 200,
    remainingBudget: 0,
    roster: [],
    ...overrides,
  }
}

const STD_ROSTER = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 }

// ─── getStartingLineup ──────────────────────────────────────────────────────

describe('getStartingLineup', () => {
  it('slots players by position counts', () => {
    const qb = makePlayer({ position: 'QB', projectedPoints: 300 })
    const rb1 = makePlayer({ position: 'RB', projectedPoints: 200 })
    const rb2 = makePlayer({ position: 'RB', projectedPoints: 180 })
    const wr1 = makePlayer({ position: 'WR', projectedPoints: 160 })
    const wr2 = makePlayer({ position: 'WR', projectedPoints: 140 })
    const te = makePlayer({ position: 'TE', projectedPoints: 120 })
    const k = makePlayer({ position: 'K', projectedPoints: 80 })
    const dst = makePlayer({ position: 'DST', projectedPoints: 90 })
    const team = makeTeam({ roster: [qb, rb1, rb2, wr1, wr2, te, k, dst] })
    const starters = getStartingLineup(team, { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 })
    expect(starters).toHaveLength(8)
    expect(starters).toContain(qb)
    expect(starters).toContain(rb1)
    expect(starters).toContain(rb2)
  })

  it('fills FLEX slot with best remaining RB/WR/TE', () => {
    const rb1 = makePlayer({ position: 'RB', projectedPoints: 200 })
    const rb2 = makePlayer({ position: 'RB', projectedPoints: 120 })
    const wr1 = makePlayer({ position: 'WR', projectedPoints: 160 })
    const wr2 = makePlayer({ position: 'WR', projectedPoints: 130 })
    const team = makeTeam({ roster: [rb1, rb2, wr1, wr2] })
    const starters = getStartingLineup(team, { RB: 1, WR: 2, FLEX: 1 })
    expect(starters).toContain(rb2)
  })

  it('fills SUPERFLEX with second QB over lower-projected RB', () => {
    const qb1 = makePlayer({ position: 'QB', projectedPoints: 350 })
    const qb2 = makePlayer({ position: 'QB', projectedPoints: 280 })
    const lowRb = makePlayer({ position: 'RB', projectedPoints: 80 })
    const team = makeTeam({ roster: [qb1, qb2, lowRb] })
    // QB:1 starter slot fills qb1; SUPERFLEX pool has qb2(280) and nothing after RB[1:]
    const starters = getStartingLineup(team, { QB: 1, SUPERFLEX: 1 })
    expect(starters).toContain(qb2)
    expect(starters).not.toContain(lowRb)
  })

  it('returns empty array when no rosterPositions', () => {
    const team = makeTeam({ roster: [makePlayer()] })
    expect(getStartingLineup(team, {})).toHaveLength(0)
  })
})

// ─── calculateStarterPoints ─────────────────────────────────────────────────

describe('calculateStarterPoints', () => {
  it('sums projected points for starters only', () => {
    const qb = makePlayer({ position: 'QB', projectedPoints: 300 })
    const bench = makePlayer({ position: 'RB', projectedPoints: 100 })
    const team = makeTeam({ roster: [qb, bench] })
    const pts = calculateStarterPoints(team, { QB: 1 })
    expect(pts).toBe(300)
  })

  it('treats missing projectedPoints as 0', () => {
    const p = makePlayer({ position: 'QB', projectedPoints: undefined })
    const team = makeTeam({ roster: [p] })
    expect(calculateStarterPoints(team, { QB: 1 })).toBe(0)
  })
})

// ─── getTotalValueCapture ────────────────────────────────────────────────────

describe('getTotalValueCapture', () => {
  it('returns sum of (estimatedValue - purchasePrice)', () => {
    const roster = [
      makePlayer({ estimatedValue: 30, purchasePrice: 20 }),
      makePlayer({ estimatedValue: 25, purchasePrice: 30 }),
    ]
    const team = makeTeam({ roster })
    expect(getTotalValueCapture(team)).toBe(5)
  })

  it('treats missing purchasePrice as 0', () => {
    const p = makePlayer({ estimatedValue: 25, purchasePrice: undefined })
    expect(getTotalValueCapture(makeTeam({ roster: [p] }))).toBe(25)
  })
})

// ─── rankTeamsByStarterPoints ────────────────────────────────────────────────

describe('rankTeamsByStarterPoints', () => {
  it('sorts teams descending by starter points', () => {
    const teamA = makeTeam({ id: 'a', roster: [makePlayer({ position: 'QB', projectedPoints: 200 })] })
    const teamB = makeTeam({ id: 'b', roster: [makePlayer({ position: 'QB', projectedPoints: 350 })] })
    const ranked = rankTeamsByStarterPoints([teamA, teamB], { QB: 1 })
    expect(ranked[0].id).toBe('b')
    expect(ranked[1].id).toBe('a')
  })

  it('does not mutate the original array', () => {
    const teams = [makeTeam()]
    rankTeamsByStarterPoints(teams, {})
    expect(teams).toHaveLength(1)
  })
})

// ─── calculateDraftGrade ────────────────────────────────────────────────────

describe('calculateDraftGrade', () => {
  it('returns A or better for top-ranked team with strong value capture and full spend', () => {
    const human = makeTeam({
      id: 'h',
      budget: 200,
      remainingBudget: 0,
      roster: [
        makePlayer({ position: 'QB', projectedPoints: 400, estimatedValue: 40, purchasePrice: 20 }),
      ],
    })
    const weak = makeTeam({
      id: 'w',
      budget: 200,
      remainingBudget: 5,
      roster: [makePlayer({ position: 'QB', projectedPoints: 100, estimatedValue: 10, purchasePrice: 20 })],
    })
    const grade = calculateDraftGrade(human, [human, weak], { QB: 1 })
    expect(grade).toMatch(/^A/)
  })

  it('returns B- or worse for last-place team with overpays and leftover budget', () => {
    const weak = makeTeam({
      id: 'w',
      budget: 200,
      remainingBudget: 80,
      roster: [makePlayer({ position: 'QB', projectedPoints: 50, estimatedValue: 5, purchasePrice: 40 })],
    })
    const strong = makeTeam({
      id: 's',
      budget: 200,
      remainingBudget: 0,
      roster: [makePlayer({ position: 'QB', projectedPoints: 400, estimatedValue: 50, purchasePrice: 20 })],
    })
    const grade = calculateDraftGrade(weak, [weak, strong], { QB: 1 })
    expect(['C', 'B-', 'B']).toContain(grade)
  })
})

// ─── gradeColor ─────────────────────────────────────────────────────────────

describe('gradeColor', () => {
  it('returns positive color for A grades', () => {
    expect(gradeColor('A+')).toBe('var(--accent-positive)')
    expect(gradeColor('A')).toBe('var(--accent-positive)')
    expect(gradeColor('A-')).toBe('var(--accent-positive)')
  })
  it('returns money color for B grades', () => {
    expect(gradeColor('B+')).toBe('var(--accent-money)')
  })
  it('returns negative color for C', () => {
    expect(gradeColor('C')).toBe('var(--accent-negative)')
  })
})

// ─── getValueLabel ───────────────────────────────────────────────────────────

describe('getValueLabel', () => {
  it('labels deep value (≤ -15%)', () => {
    // est 30, paid 20 → -33%
    const { text, cls } = getValueLabel(30, 20)
    expect(cls).toBe('value')
    expect(text).toMatch(/VALUE/)
  })
  it('labels slight value (-5% to -15%)', () => {
    // est 25, paid 22 → -12%
    expect(getValueLabel(25, 22).cls).toBe('slight-value')
  })
  it('labels fair (strictly inside ±5%)', () => {
    expect(getValueLabel(20, 20).cls).toBe('fair')
    // est 100, paid 103 → +3% → fair
    expect(getValueLabel(100, 103).cls).toBe('fair')
    // est 100, paid 97 → -3% → fair
    expect(getValueLabel(100, 97).cls).toBe('fair')
  })
  it('labels slight overpay (+5% to +15%)', () => {
    // est 20, paid 22 → +10%
    expect(getValueLabel(20, 22).cls).toBe('slight-overpay')
  })
  it('labels overpay (≥ +15%)', () => {
    // est 20, paid 24 → +20%
    expect(getValueLabel(20, 24).cls).toBe('overpay')
    // est 10, paid 20 → +100%
    expect(getValueLabel(10, 20).cls).toBe('overpay')
  })
  it('returns deltaDollars and pct in the result', () => {
    const r = getValueLabel(20, 24)
    expect(r.deltaDollars).toBe(4)
    expect(Math.round(r.pct)).toBe(20)
  })
  it('falls back to fair when estimatedValue is zero or missing', () => {
    expect(getValueLabel(0, 5).cls).toBe('fair')
    expect(getValueLabel(undefined, 5).cls).toBe('fair')
  })
})

// ─── getVariancePosition ────────────────────────────────────────────────────

describe('getVariancePosition', () => {
  it('puts fair (0%) at the middle', () => {
    expect(getVariancePosition(0)).toBe(50)
  })
  it('clamps deep value to the left edge (5)', () => {
    expect(getVariancePosition(-50)).toBe(5)
    expect(getVariancePosition(-30)).toBe(5)
  })
  it('clamps deep overpay to the right edge (95)', () => {
    expect(getVariancePosition(50)).toBe(95)
    expect(getVariancePosition(30)).toBe(95)
  })
  it('scales mid-range positions linearly', () => {
    // -15% → halfway between 5 and 50 = 27.5
    expect(getVariancePosition(-15)).toBeCloseTo(27.5)
    // +15% → halfway between 50 and 95 = 72.5
    expect(getVariancePosition(15)).toBeCloseTo(72.5)
  })
})

// ─── getMarketAveragesByPosition ────────────────────────────────────────────

describe('getMarketAveragesByPosition', () => {
  const history = [
    { player: makePlayer({ position: 'RB', estimatedValue: 30 }), price: 40 },
    { player: makePlayer({ position: 'RB', estimatedValue: 20 }), price: 25 },
    { player: makePlayer({ position: 'WR', estimatedValue: 15 }), price: 10 },
  ]

  it('groups by position correctly', () => {
    const mkt = getMarketAveragesByPosition(history)
    expect(mkt.RB.count).toBe(2)
    expect(mkt.WR.count).toBe(1)
  })

  it('calculates avgPaid', () => {
    const mkt = getMarketAveragesByPosition(history)
    expect(mkt.RB.avgPaid).toBe(32.5)
  })

  it('calculates inflation percentage', () => {
    const mkt = getMarketAveragesByPosition(history)
    expect(mkt.RB.inflation).toBeGreaterThan(0)
    expect(mkt.WR.inflation).toBeLessThan(0)
  })
})

// ─── getBestValues / getBiggestOverpays ──────────────────────────────────────

describe('getBestValues', () => {
  const history = [
    { player: makePlayer({ estimatedValue: 50 }), price: 20 },
    { player: makePlayer({ estimatedValue: 30 }), price: 25 },
    { player: makePlayer({ estimatedValue: 10 }), price: 40 },
  ]

  it('returns top n steals in descending value order', () => {
    const vals = getBestValues(history, 2)
    expect(vals).toHaveLength(2)
    expect(vals[0].valueDiff).toBe(30)
    expect(vals[1].valueDiff).toBe(5)
  })
})

describe('getBiggestOverpays', () => {
  const history = [
    { player: makePlayer({ estimatedValue: 10 }), price: 40 },
    { player: makePlayer({ estimatedValue: 30 }), price: 25 },
    { player: makePlayer({ estimatedValue: 50 }), price: 20 },
  ]

  it('returns top n overpays in ascending value order', () => {
    const ops = getBiggestOverpays(history, 1)
    expect(ops[0].valueDiff).toBe(-30)
  })
})

// ─── getByeWeekMap ───────────────────────────────────────────────────────────

describe('getByeWeekMap', () => {
  it('groups starters by bye week', () => {
    const qb = makePlayer({ position: 'QB', projectedPoints: 300, byeWeek: 9 })
    const rb = makePlayer({ position: 'RB', projectedPoints: 200, byeWeek: 9 })
    const team = makeTeam({ roster: [qb, rb] })
    const map = getByeWeekMap(team, { QB: 1, RB: 1 })
    expect(map[9]).toHaveLength(2)
  })

  it('excludes players with no byeWeek', () => {
    const p = makePlayer({ position: 'QB', projectedPoints: 300, byeWeek: undefined })
    const team = makeTeam({ roster: [p] })
    const map = getByeWeekMap(team, { QB: 1 })
    expect(Object.keys(map)).toHaveLength(0)
  })
})

// ─── getPositionSpendingByGroup ──────────────────────────────────────────────

describe('getPositionSpendingByGroup', () => {
  it('totals spend per position', () => {
    const roster = [
      makePlayer({ position: 'WR', purchasePrice: 30 }),
      makePlayer({ position: 'WR', purchasePrice: 25 }),
      makePlayer({ position: 'RB', purchasePrice: 40 }),
    ]
    const groups = getPositionSpendingByGroup(makeTeam({ roster }))
    expect(groups.WR.spend).toBe(55)
    expect(groups.RB.spend).toBe(40)
    expect(groups.WR.players).toHaveLength(2)
  })
})

// ─── getHumanPicksTimeline ───────────────────────────────────────────────────

describe('getHumanPicksTimeline', () => {
  const draftHistory = [
    { team: 'Alpha', player: makePlayer({ name: 'P1' }), price: 30 },
    { team: 'Beta',  player: makePlayer({ name: 'P2' }), price: 20 },
    { team: 'Alpha', player: makePlayer({ name: 'P3' }), price: 15 },
  ]

  it('includes only picks by humanTeamName', () => {
    const timeline = getHumanPicksTimeline(draftHistory, 'Alpha', 200)
    expect(timeline).toHaveLength(2)
  })

  it('tracks cumulative remaining budget', () => {
    const timeline = getHumanPicksTimeline(draftHistory, 'Alpha', 200)
    expect(timeline[0].remaining).toBe(170)
    expect(timeline[1].remaining).toBe(155)
  })

  it('captures pick index (1-based, global)', () => {
    const timeline = getHumanPicksTimeline(draftHistory, 'Alpha', 200)
    expect(timeline[0].pickIndex).toBe(1)
    expect(timeline[1].pickIndex).toBe(3)
  })
})

// ─── getLeagueAvgPointsPerDollar ─────────────────────────────────────────────

describe('getLeagueAvgPointsPerDollar', () => {
  it('returns 0 for empty history', () => {
    expect(getLeagueAvgPointsPerDollar([])).toBe(0)
  })

  it('returns sum(pts) / sum(price) across picks', () => {
    const history = [
      { player: makePlayer({ projectedPoints: 200 }), price: 50 },
      { player: makePlayer({ projectedPoints: 100 }), price: 50 },
    ]
    // (200 + 100) / (50 + 50) = 3
    expect(getLeagueAvgPointsPerDollar(history)).toBe(3)
  })

  it('ignores picks with price <= 0', () => {
    const history = [
      { player: makePlayer({ projectedPoints: 200 }), price: 50 },
      { player: makePlayer({ projectedPoints: 999 }), price: 0 },
    ]
    expect(getLeagueAvgPointsPerDollar(history)).toBe(4)
  })

  it('treats missing projectedPoints as 0', () => {
    const history = [
      { player: makePlayer({ projectedPoints: undefined }), price: 50 },
    ]
    expect(getLeagueAvgPointsPerDollar(history)).toBe(0)
  })
})

// ─── getPointsValueLabel ─────────────────────────────────────────────────────

describe('getPointsValueLabel', () => {
  // League avg of 4 pts/$ means expected = price * 4
  const AVG = 4

  it('returns fair for price <= 0', () => {
    expect(getPointsValueLabel(200, 0, AVG).cls).toBe('fair')
    expect(getPointsValueLabel(200, -5, AVG).cls).toBe('fair')
  })

  it('returns fair when league avg is 0 or missing', () => {
    expect(getPointsValueLabel(200, 10, 0).cls).toBe('fair')
    expect(getPointsValueLabel(200, 10, undefined).cls).toBe('fair')
  })

  it('labels VALUE when projected pts exceed expected by ≥ 15%', () => {
    // expected = 10 * 4 = 40, actual 50 → +25%
    const r = getPointsValueLabel(50, 10, AVG)
    expect(r.cls).toBe('value')
    expect(r.text).toMatch(/VALUE/)
    expect(r.surplusPts).toBe(10)
  })

  it('labels slight-value between +5% and +15%', () => {
    // expected = 10 * 4 = 40, actual 44 → +10%
    expect(getPointsValueLabel(44, 10, AVG).cls).toBe('slight-value')
  })

  it('labels fair strictly inside ±5%', () => {
    // expected = 40, actual 40 → 0%
    expect(getPointsValueLabel(40, 10, AVG).cls).toBe('fair')
    // +3% → fair
    expect(getPointsValueLabel(41.2, 10, AVG).cls).toBe('fair')
    // -3% → fair
    expect(getPointsValueLabel(38.8, 10, AVG).cls).toBe('fair')
  })

  it('labels slight-overpay between -5% and -15%', () => {
    // expected = 40, actual 36 → -10%
    expect(getPointsValueLabel(36, 10, AVG).cls).toBe('slight-overpay')
  })

  it('labels OVER when projected pts fall short by ≥ 15%', () => {
    // expected = 40, actual 30 → -25%
    const r = getPointsValueLabel(30, 10, AVG)
    expect(r.cls).toBe('overpay')
    expect(r.text).toMatch(/OVER/)
    expect(r.surplusPts).toBe(-10)
  })

  it('computes ptsPerDollar', () => {
    expect(getPointsValueLabel(50, 10, AVG).ptsPerDollar).toBe(5)
  })
})

// ─── getPickAnalysis ─────────────────────────────────────────────────────────

describe('getPickAnalysis', () => {
  const history = [
    { player: makePlayer({ estimatedValue: 50, projectedPoints: 200 }), price: 30, team: 'A' },
    { player: makePlayer({ estimatedValue: 20, projectedPoints: 100 }), price: 25, team: 'B' },
  ]

  it('preserves input order with 1-based pickIndex', () => {
    const out = getPickAnalysis(history, 4)
    expect(out[0].pickIndex).toBe(1)
    expect(out[1].pickIndex).toBe(2)
  })

  it('annotates each pick with both labels and deltas', () => {
    const out = getPickAnalysis(history, 4)
    expect(out[0].dollarLabel).toBeDefined()
    expect(out[0].pointsLabel).toBeDefined()
    expect(out[0].dollarDelta).toBe(20)   // 50 - 30
    expect(out[0].pointsDelta).toBeCloseTo(80) // 200 - (30 * 4 = 120)
  })

  it('returns empty array for empty input', () => {
    expect(getPickAnalysis([], 4)).toEqual([])
  })
})

// ─── generateTakeaways ───────────────────────────────────────────────────────

describe('generateTakeaways', () => {
  it('returns at most 5 takeaways', () => {
    const human = makeTeam({
      id: 'h',
      name: 'Alpha',
      budget: 200,
      remainingBudget: 20,
      roster: [makePlayer({ position: 'QB', projectedPoints: 100, estimatedValue: 5, purchasePrice: 45 })],
    })
    const draftHistory = Array.from({ length: 8 }, (_, i) => ({
      team: i % 2 === 0 ? 'Alpha' : 'Beta',
      player: makePlayer({ position: i % 2 === 0 ? 'RB' : 'WR', estimatedValue: 20 }),
      price: i % 2 === 0 ? 35 : 10,
    }))
    const takeaways = generateTakeaways(human, [human], draftHistory, { QB: 1 })
    expect(takeaways.length).toBeLessThanOrEqual(5)
    expect(Array.isArray(takeaways)).toBe(true)
  })

  it('flags unspent budget when > $15 remaining', () => {
    const human = makeTeam({
      id: 'h', name: 'Alpha', budget: 200, remainingBudget: 30,
      roster: [makePlayer({ position: 'QB', projectedPoints: 200, estimatedValue: 20, purchasePrice: 20 })],
    })
    const history = [{ team: 'Alpha', player: makePlayer({ position: 'QB', estimatedValue: 20 }), price: 20 }]
    const takeaways = generateTakeaways(human, [human], history, { QB: 1 })
    expect(takeaways.some(t => /unspent/i.test(t))).toBe(true)
  })
})

// ─── generateValueCostTakeaways ──────────────────────────────────────────────

describe('generateValueCostTakeaways', () => {
  it('returns an empty array for no picks', () => {
    expect(generateValueCostTakeaways([], 0, {}, {})).toEqual([])
  })

  it('returns at most 5 neutral, team-agnostic takeaways', () => {
    const history = [
      { team: 'A', player: makePlayer({ position: 'RB', estimatedValue: 50, projectedPoints: 220 }), price: 20 },
      { team: 'B', player: makePlayer({ position: 'WR', estimatedValue: 20, projectedPoints: 90 }), price: 45 },
      { team: 'A', player: makePlayer({ position: 'QB', estimatedValue: 30, projectedPoints: 300 }), price: 28 },
    ]
    const leagueAvg = getLeagueAvgPointsPerDollar(history)
    const annotated = getPickAnalysis(history, leagueAvg)
    const market = getMarketAveragesByPosition(history)
    const out = generateValueCostTakeaways(annotated, leagueAvg, { RB: 50, WR: 40, QB: 100, TE: 30, K: 0, DST: 0 }, market)
    expect(Array.isArray(out)).toBe(true)
    expect(out.length).toBeLessThanOrEqual(5)
    // Neutral framing — never references the drafter directly.
    expect(out.every(t => !/\byou\b/i.test(t))).toBe(true)
  })

  it('surfaces the league pts/$ benchmark', () => {
    const history = [
      { team: 'A', player: makePlayer({ estimatedValue: 20, projectedPoints: 100 }), price: 20 },
    ]
    const leagueAvg = getLeagueAvgPointsPerDollar(history)
    const annotated = getPickAnalysis(history, leagueAvg)
    const out = generateValueCostTakeaways(annotated, leagueAvg, {}, getMarketAveragesByPosition(history))
    expect(out.some(t => /projected points on average/i.test(t))).toBe(true)
  })
})

// ─── VORP ──────────────────────────────────────────────────────────────────

describe('getReplacementThresholds', () => {
  it('returns numTeams × startingSlots for each base position (no FLEX/SUPERFLEX)', () => {
    const t = getReplacementThresholds({ QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 }, 12)
    expect(t.QB).toBe(12)
    expect(t.RB).toBe(24)
    expect(t.WR).toBe(24)
    expect(t.TE).toBe(12)
    expect(t.K).toBe(12)
    expect(t.DST).toBe(12)
  })

  it('distributes FLEX evenly across RB/WR/TE (+4 each for 1 FLEX × 12 teams)', () => {
    const t = getReplacementThresholds({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 }, 12)
    expect(t.QB).toBe(12)
    expect(t.RB).toBeCloseTo(24 + 4, 5)
    expect(t.WR).toBeCloseTo(24 + 4, 5)
    expect(t.TE).toBeCloseTo(12 + 4, 5)
  })

  it('distributes SUPERFLEX evenly across QB/RB/WR/TE (+3 each for 1 SF × 12 teams)', () => {
    const t = getReplacementThresholds({ QB: 1, RB: 2, WR: 2, TE: 1, SUPERFLEX: 1, K: 1, DST: 1 }, 12)
    expect(t.QB).toBeCloseTo(12 + 3, 5)
    expect(t.RB).toBeCloseTo(24 + 3, 5)
    expect(t.WR).toBeCloseTo(24 + 3, 5)
    expect(t.TE).toBeCloseTo(12 + 3, 5)
  })

  it('handles missing rosterPositions and zero numberOfTeams gracefully', () => {
    expect(getReplacementThresholds(null, 12).QB).toBe(0)
    expect(getReplacementThresholds({ QB: 1 }, 0).QB).toBe(0)
  })
})

describe('getReplacementLevels', () => {
  it('returns the projectedPoints of the player at rank threshold (0-indexed)', () => {
    // 3 QBs in pool with descending pts; threshold = 2 (QB1 league with 2 teams)
    // sorted: [300, 200, 100]; rank index 2 = the player with 100 pts.
    const players = [
      { position: 'QB', projectedPoints: 200, name: 'B' },
      { position: 'QB', projectedPoints: 300, name: 'A' },
      { position: 'QB', projectedPoints: 100, name: 'C' },
    ]
    const { levels, players: replPlayers, thresholds } = getReplacementLevels(
      players,
      { QB: 1 },
      2,
    )
    expect(levels.QB).toBe(100)
    expect(replPlayers.QB.name).toBe('C')
    expect(thresholds.QB).toBe(2)
  })

  it('falls back to the last player when the pool is shorter than the threshold', () => {
    const players = [
      { position: 'TE', projectedPoints: 200 },
      { position: 'TE', projectedPoints: 150 },
    ]
    // Threshold = 12 but only 2 TEs in pool → use last (150)
    const { levels } = getReplacementLevels(players, { TE: 1 }, 12)
    expect(levels.TE).toBe(150)
  })

  it('returns 0 for a position with no players in the pool', () => {
    const { levels } = getReplacementLevels([], { QB: 1, K: 1 }, 12)
    expect(levels.QB).toBe(0)
    expect(levels.K).toBe(0)
  })
})

describe('getPlayerVORP', () => {
  it('returns projectedPoints minus replacement for the player position', () => {
    const wr = makePlayer({ position: 'WR', projectedPoints: 280 })
    expect(getPlayerVORP(wr, { WR: 200 })).toBe(80)
  })

  it('clamps below-replacement players at 0 (no negative VORP)', () => {
    const wr = makePlayer({ position: 'WR', projectedPoints: 150 })
    expect(getPlayerVORP(wr, { WR: 200 })).toBe(0)
  })

  it('returns 0 when player is null or replacement map is missing', () => {
    expect(getPlayerVORP(null, { WR: 200 })).toBe(0)
    expect(getPlayerVORP(makePlayer(), undefined)).toBe(0)
  })
})

describe('getTeamVORP', () => {
  it('sums per-player VORP across the roster', () => {
    const team = makeTeam({
      roster: [
        makePlayer({ position: 'WR', projectedPoints: 280 }), // VORP 80
        makePlayer({ position: 'RB', projectedPoints: 230 }), // VORP 30
        makePlayer({ position: 'K',  projectedPoints: 100 }), // VORP 0 (below repl)
      ],
    })
    expect(getTeamVORP(team, { WR: 200, RB: 200, K: 110 })).toBe(110)
  })

  it('returns 0 for an empty roster', () => {
    expect(getTeamVORP(makeTeam({ roster: [] }), { WR: 200 })).toBe(0)
  })
})
