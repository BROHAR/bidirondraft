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
  getLineupSlots,
  getPositionalRankScores,
  buildPositionalRadar,
  getPowerRankings,
  buildDreamTeam,
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

// ─── getLineupSlots ─────────────────────────────────────────────────────────

describe('getLineupSlots', () => {
  const rc = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 }

  it('fills base slots, then FLEX with the best leftover RB/WR/TE', () => {
    const roster = [
      makePlayer({ id: 'qb', position: 'QB', projectedPoints: 300 }),
      makePlayer({ id: 'rb1', position: 'RB', projectedPoints: 250 }),
      makePlayer({ id: 'rb2', position: 'RB', projectedPoints: 200 }),
      makePlayer({ id: 'rb3', position: 'RB', projectedPoints: 190 }), // best leftover → FLEX
      makePlayer({ id: 'wr1', position: 'WR', projectedPoints: 180 }),
      makePlayer({ id: 'wr2', position: 'WR', projectedPoints: 170 }),
      makePlayer({ id: 'te', position: 'TE', projectedPoints: 120 }),
      makePlayer({ id: 'k', position: 'K', projectedPoints: 130 }),
      makePlayer({ id: 'dst', position: 'DST', projectedPoints: 110 }),
      makePlayer({ id: 'wr3', position: 'WR', projectedPoints: 90 }), // bench
    ]
    const { slots, bench, starterIds } = getLineupSlots(makeTeam({ roster }), rc)
    expect(slots.RB.map(p => p.id)).toEqual(['rb1', 'rb2'])
    expect(slots.FLEX.map(p => p.id)).toEqual(['rb3']) // 190 beats wr3 90
    expect(slots.QB.map(p => p.id)).toEqual(['qb'])
    expect(bench.map(p => p.id)).toEqual(['wr3'])
    expect(starterIds.has('rb3')).toBe(true)
    expect(starterIds.has('wr3')).toBe(false)
  })

  it('fills SUPERFLEX with the best leftover incl QB', () => {
    const sf = { QB: 1, RB: 1, WR: 1, TE: 1, SUPERFLEX: 1, K: 1, DST: 1, BENCH: 2 }
    const roster = [
      makePlayer({ id: 'qb1', position: 'QB', projectedPoints: 320 }),
      makePlayer({ id: 'qb2', position: 'QB', projectedPoints: 300 }), // leftover QB → SF
      makePlayer({ id: 'rb1', position: 'RB', projectedPoints: 200 }),
      makePlayer({ id: 'wr1', position: 'WR', projectedPoints: 180 }),
      makePlayer({ id: 'te1', position: 'TE', projectedPoints: 120 }),
    ]
    const { slots } = getLineupSlots(makeTeam({ roster }), sf)
    expect(slots.SUPERFLEX.map(p => p.id)).toEqual(['qb2'])
  })

  it('handles an empty roster without throwing', () => {
    const { slots, bench } = getLineupSlots(makeTeam({ roster: [] }), rc)
    expect(bench).toEqual([])
    expect(slots.QB).toEqual([])
  })
})

// ─── getPositionalRankScores ────────────────────────────────────────────────

describe('getPositionalRankScores', () => {
  it('scores the best player at a position highest (total) down to 1', () => {
    const pool = [
      makePlayer({ id: 'wr1', position: 'WR', projectedPoints: 300 }),
      makePlayer({ id: 'wr2', position: 'WR', projectedPoints: 200 }),
      makePlayer({ id: 'wr3', position: 'WR', projectedPoints: 100 }),
      makePlayer({ id: 'rb1', position: 'RB', projectedPoints: 250 }),
    ]
    const scores = getPositionalRankScores(pool)
    expect(scores.get('wr1')).toBe(3) // 3 WRs, best
    expect(scores.get('wr2')).toBe(2)
    expect(scores.get('wr3')).toBe(1)
    expect(scores.get('rb1')).toBe(1) // only RB
  })

  it('is safe on empty / null input', () => {
    expect(getPositionalRankScores([]).size).toBe(0)
    expect(getPositionalRankScores(null).size).toBe(0)
  })
})

// ─── buildPositionalRadar ───────────────────────────────────────────────────

describe('buildPositionalRadar', () => {
  const rc = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 2 }

  function teamWith(id, pts) {
    // pts = { QB, RB:[..], WR:[..], TE, K, DST, benchRB? }
    const roster = []
    roster.push(makePlayer({ id: `${id}-qb`, position: 'QB', projectedPoints: pts.QB }))
    ;(pts.RB || []).forEach((p, i) => roster.push(makePlayer({ id: `${id}-rb${i}`, position: 'RB', projectedPoints: p })))
    ;(pts.WR || []).forEach((p, i) => roster.push(makePlayer({ id: `${id}-wr${i}`, position: 'WR', projectedPoints: p })))
    roster.push(makePlayer({ id: `${id}-te`, position: 'TE', projectedPoints: pts.TE }))
    roster.push(makePlayer({ id: `${id}-k`, position: 'K', projectedPoints: pts.K }))
    roster.push(makePlayer({ id: `${id}-dst`, position: 'DST', projectedPoints: pts.DST }))
    return makeTeam({ id, name: id, roster })
  }

  const teamA = teamWith('A', { QB: 300, RB: [250, 200, 150], WR: [180, 170], TE: 120, K: 130, DST: 110 })
  const teamB = teamWith('B', { QB: 200, RB: [150, 140], WR: [220, 210], TE: 90, K: 120, DST: 100 })
  const teams = [teamA, teamB]

  it('lists axes from the roster config (incl FLEX, excl BENCH)', () => {
    const { axes } = buildPositionalRadar(teams, rc, { stat: 'points' })
    expect(axes).toEqual(['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'])
    expect(axes).not.toContain('BENCH')
  })

  it('points: base axes use base-slot occupants under "starters"', () => {
    const { byTeamId } = buildPositionalRadar(teams, rc, { stat: 'points', filter: 'starters' })
    // A's RB axis = top 2 RBs (250+200); the leftover RB 150 fills FLEX
    // (WR 180/170 are taken by the 2 WR slots, so nothing beats 150).
    expect(byTeamId.A.values.RB).toBe(450)
    expect(byTeamId.A.values.FLEX).toBe(150)
  })

  it('points: "all" counts every player at the base position', () => {
    const { byTeamId } = buildPositionalRadar(teams, rc, { stat: 'points', filter: 'all' })
    expect(byTeamId.A.values.RB).toBe(600) // 250+200+150
  })

  it('points: "bench" excludes starters', () => {
    const { byTeamId } = buildPositionalRadar(teams, rc, { stat: 'points', filter: 'bench' })
    // A: RBs 250,200 start; 150 is the FLEX starter → no bench RB.
    expect(byTeamId.A.values.RB).toBe(0)
  })

  it('FLEX under "all"/"bench" = best bench flex-eligible not starting', () => {
    // Give A a clear bench RB (100) below the FLEX starter (150).
    const a2 = teamWith('A2', { QB: 300, RB: [250, 200, 150, 100], WR: [180, 170], TE: 120, K: 130, DST: 110 })
    const { byTeamId } = buildPositionalRadar([a2], rc, { stat: 'points', filter: 'bench' })
    // Starters: RB 250,200; FLEX 150. Bench flex-eligible best = RB 100.
    expect(byTeamId.A2.values.FLEX).toBe(100)
  })

  it('normalizes each axis to the field max and ranks teams', () => {
    const { byTeamId } = buildPositionalRadar(teams, rc, { stat: 'points', filter: 'starters' })
    // QB: A 300 vs B 200 → A normalized 1, rank 1; B 0.667, rank 2.
    expect(byTeamId.A.normalized.QB).toBeCloseTo(1, 5)
    expect(byTeamId.B.normalized.QB).toBeCloseTo(200 / 300, 5)
    expect(byTeamId.A.ranks.QB).toEqual({ rank: 1, of: 2 })
    expect(byTeamId.B.ranks.QB).toEqual({ rank: 2, of: 2 })
    // WR: B (220+210=430) beats A (180+170=350).
    expect(byTeamId.B.ranks.WR).toEqual({ rank: 1, of: 2 })
  })

  it('vorp stat sums player VORP per axis', () => {
    const repl = { QB: 100, RB: 100, WR: 100, TE: 100, K: 100, DST: 100 }
    const { byTeamId } = buildPositionalRadar(teams, rc, { stat: 'vorp', filter: 'starters', replacementLevels: repl })
    // A QB 300 - 100 = 200.
    expect(byTeamId.A.values.QB).toBe(200)
  })

  it('guards divide-by-zero when an axis is empty across the field', () => {
    const empty = makeTeam({ id: 'E', name: 'E', roster: [] })
    const { byTeamId, fieldMax } = buildPositionalRadar([empty], rc, { stat: 'points' })
    expect(fieldMax.QB).toBe(0)
    expect(byTeamId.E.normalized.QB).toBe(0)
    expect(Number.isNaN(byTeamId.E.normalized.QB)).toBe(false)
  })
})

// ─── getPowerRankings ───────────────────────────────────────────────────────

describe('getPowerRankings', () => {
  it('orders teams by average per-axis rank, best (lowest) first', () => {
    const radar = {
      axes: ['QB', 'RB'],
      byTeamId: {
        A: { ranks: { QB: { rank: 1, of: 3 }, RB: { rank: 1, of: 3 } } }, // avg 1.0
        B: { ranks: { QB: { rank: 2, of: 3 }, RB: { rank: 3, of: 3 } } }, // avg 2.5
        C: { ranks: { QB: { rank: 3, of: 3 }, RB: { rank: 2, of: 3 } } }, // avg 2.5
      },
    }
    const out = getPowerRankings(radar)
    expect(out.map(r => r.teamId)).toEqual(['A', 'B', 'C'])
    expect(out[0]).toMatchObject({ teamId: 'A', avgRank: 1, rank: 1 })
    // B and C tie at 2.5 → share power rank 2
    expect(out[1].rank).toBe(2)
    expect(out[2].rank).toBe(2)
    expect(out[1].avgRank).toBeCloseTo(2.5, 5)
  })

  it('is safe on empty radar', () => {
    expect(getPowerRankings({})).toEqual([])
    expect(getPowerRankings(null)).toEqual([])
  })

  it('matches a real buildPositionalRadar result', () => {
    const mk = (id, qb, rb) => makeTeam({
      id,
      name: id,
      roster: [
        makePlayer({ id: `${id}-qb`, position: 'QB', projectedPoints: qb }),
        makePlayer({ id: `${id}-rb`, position: 'RB', projectedPoints: rb }),
      ],
    })
    const teams = [mk('A', 300, 100), mk('B', 100, 300)]
    const radar = buildPositionalRadar(teams, { QB: 1, RB: 1 }, { stat: 'points', filter: 'starters' })
    const out = getPowerRankings(radar)
    // A: QB 1st, RB 2nd → 1.5; B: QB 2nd, RB 1st → 1.5 → tie at rank 1
    expect(out.every(r => r.avgRank === 1.5)).toBe(true)
    expect(out.every(r => r.rank === 1)).toBe(true)
  })
})

// ─── buildDreamTeam ─────────────────────────────────────────────────────────

describe('buildDreamTeam', () => {
  const rc = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 }

  function fullTeam(id, scale) {
    // scale multiplies points so different teams own different-strength players
    return makeTeam({
      id,
      name: id,
      roster: [
        makePlayer({ id: `${id}-qb`, position: 'QB', projectedPoints: 300 * scale, purchasePrice: 30 }),
        makePlayer({ id: `${id}-rb1`, position: 'RB', projectedPoints: 250 * scale, purchasePrice: 40 }),
        makePlayer({ id: `${id}-rb2`, position: 'RB', projectedPoints: 200 * scale, purchasePrice: 20 }),
        makePlayer({ id: `${id}-rb3`, position: 'RB', projectedPoints: 150 * scale, purchasePrice: 5 }),
        makePlayer({ id: `${id}-wr1`, position: 'WR', projectedPoints: 220 * scale, purchasePrice: 35 }),
        makePlayer({ id: `${id}-wr2`, position: 'WR', projectedPoints: 180 * scale, purchasePrice: 15 }),
        makePlayer({ id: `${id}-te`, position: 'TE', projectedPoints: 120 * scale, purchasePrice: 10 }),
        makePlayer({ id: `${id}-k`, position: 'K', projectedPoints: 130 * scale, purchasePrice: 1 }),
        makePlayer({ id: `${id}-dst`, position: 'DST', projectedPoints: 110 * scale, purchasePrice: 2 }),
      ],
    })
  }

  it('picks the single best player at each slot across all teams', () => {
    const strong = fullTeam('Strong', 1) // owns the best at every position
    const weak = fullTeam('Weak', 0.5)
    const { rows } = buildDreamTeam([strong, weak], [], rc)
    const byLabel = {}
    rows.forEach(r => { (byLabel[r.slotLabel] ||= []).push(r.player) })
    expect(byLabel.QB[0].id).toBe('Strong-qb')
    expect(byLabel.RB.map(p => p.id)).toEqual(['Strong-rb1', 'Strong-rb2']) // top 2 RBs
    expect(byLabel.FLEX[0].id).toBe('Strong-rb3') // best leftover flex-eligible (150 > weak's)
  })

  it('includes free agents priced at estimatedValue', () => {
    const team = fullTeam('A', 0.3) // weak roster
    const fa = makePlayer({ id: 'fa-qb', position: 'QB', projectedPoints: 999, estimatedValue: 50 })
    const { rows, meta } = buildDreamTeam([team], [fa], rc)
    const qbRow = rows.find(r => r.slotLabel === 'QB')
    expect(qbRow.player.id).toBe('fa-qb') // 999 beats everyone
    expect(meta.get('fa-qb')).toMatchObject({ owner: 'FA', cost: 50, drafted: false })
  })

  it('reports total points and total cost of the dream lineup', () => {
    const team = fullTeam('A', 1)
    const { rows, totalPoints, totalCost, meta } = buildDreamTeam([team], [], rc)
    const expectedPts = rows.reduce((s, r) => s + (r.player?.projectedPoints || 0), 0)
    const expectedCost = rows.reduce((s, r) => s + (meta.get(r.player.id)?.cost || 0), 0)
    expect(totalPoints).toBe(expectedPts)
    expect(totalCost).toBe(expectedCost)
  })

  it('does not double-count a player listed both rostered and available', () => {
    const p = makePlayer({ id: 'dup-qb', position: 'QB', projectedPoints: 400, purchasePrice: 25 })
    const team = makeTeam({ id: 'A', name: 'A', roster: [p] })
    const { meta } = buildDreamTeam([team], [p], { QB: 1 })
    // drafted entry wins; FA dup ignored
    expect(meta.get('dup-qb')).toMatchObject({ owner: 'A', drafted: true, cost: 25 })
  })
})

describe('buildDreamTeam (budget-constrained)', () => {
  // 2-slot lineup, no flex, to make the knapsack hand-checkable.
  const rc = { QB: 1, RB: 1 }
  const team = makeTeam({
    id: 'A', name: 'A', roster: [
      makePlayer({ id: 'qbA', position: 'QB', projectedPoints: 300, purchasePrice: 9 }),
      makePlayer({ id: 'qbB', position: 'QB', projectedPoints: 250, purchasePrice: 3 }),
      makePlayer({ id: 'rbA', position: 'RB', projectedPoints: 200, purchasePrice: 9 }),
      makePlayer({ id: 'rbB', position: 'RB', projectedPoints: 150, purchasePrice: 3 }),
    ],
  })

  it('returns the unconstrained best when the budget is ample', () => {
    const res = buildDreamTeam([team], [], rc, 1000)
    expect(res.totalPoints).toBe(500) // qbA + rbA
    expect(res.rows.map(r => r.player.id).sort()).toEqual(['qbA', 'rbA'])
    expect(res.overBudget).toBe(false)
  })

  it('picks the best legal lineup within budget at cost', () => {
    // Unconstrained best (qbA+rbA = 500) costs 18 > 10. The studs can't be
    // paired with anything affordable, so the optimum is qbB+rbB = 400 @ $6.
    const res = buildDreamTeam([team], [], rc, 10)
    expect(res.totalCost).toBeLessThanOrEqual(10)
    expect(res.totalPoints).toBe(400)
    expect(res.rows.map(r => r.player.id).sort()).toEqual(['qbB', 'rbB'])
    expect(res.overBudget).toBe(false)
  })

  it('flags overBudget when even the cheapest legal lineup does not fit', () => {
    // Cheapest lineup is qbB+rbB = $6; budget 4 cannot afford two slots.
    const res = buildDreamTeam([team], [], rc, 4)
    expect(res.overBudget).toBe(true)
  })

  it('defaults to unconstrained when no budget is passed', () => {
    const res = buildDreamTeam([team], [], rc)
    expect(res.totalPoints).toBe(500)
  })
})
