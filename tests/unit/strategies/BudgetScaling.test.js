import { describe, it, expect } from 'vitest'
import { BaseStrategy } from '../../../src/strategies/BaseStrategy.js'
import { Team } from '../../../src/models/Team.js'
import { Player } from '../../../src/models/Player.js'

function makeConfig(budgetPerTeam) {
  return {
    budgetPerTeam,
    rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 },
  }
}

class TestStrategy extends BaseStrategy {
  constructor() {
    super('Test')
    this.preferences = {
      positionMultipliers: { QB: 1.0, RB: 1.0, WR: 1.0, TE: 1.0, K: 0.8, DST: 0.8 },
    }
  }
  evaluateBid(player, currentBid, adjustedValue) {
    return currentBid < adjustedValue
  }
}

function makeStrategy(budgetPerTeam) {
  const strategy = new TestStrategy()
  const team = new Team('t1', 'Test', false, makeConfig(budgetPerTeam))
  team.setStrategy(strategy)
  return strategy
}

describe('BaseStrategy budget scaling', () => {
  describe('budgetScale / sd / si', () => {
    it('is 1.0 at the $200 reference budget (behavior unchanged)', () => {
      const s = makeStrategy(200)
      expect(s.budgetScale).toBe(1)
      expect(s.sd(50)).toBe(50)
      expect(s.si(1)).toBe(1)
      expect(s.si(10)).toBe(10)
    })

    it('scales dollar thresholds linearly with budget', () => {
      const s = makeStrategy(600)
      expect(s.budgetScale).toBe(3)
      expect(s.sd(50)).toBe(150)
      expect(s.sd(5)).toBe(15)
    })

    it('rounds and floors bid increments at $1', () => {
      const s = makeStrategy(600)
      expect(s.si(1)).toBe(3)
      expect(s.si(2)).toBe(6)
      // Tiny amount on a low budget never drops below the $1 minimum raise.
      const small = makeStrategy(100)
      expect(small.si(1)).toBe(1)
    })
  })

  describe('K/DST cap scales with budget', () => {
    // A defense whose (artificially high) book value would otherwise blow past
    // the K/DST ceiling is clamped to the budget-scaled cap ($5 at $200).
    const dst = new Player({
      id: 'd1', name: 'Test DST', position: 'DST', team: 'KC',
      estimatedValue: 40, byeWeek: 7,
    })

    it('caps at $5 at the reference budget', () => {
      const s = makeStrategy(200)
      expect(s.getAdjustedPlayerValue(dst, [dst])).toBe(5)
    })

    it('caps at the scaled $15 at a $600 budget', () => {
      const s = makeStrategy(600)
      expect(s.getAdjustedPlayerValue(dst, [dst])).toBe(15)
    })
  })
})
