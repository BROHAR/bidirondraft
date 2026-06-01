import { describe, it, expect, beforeEach } from 'vitest'
import { BidValidator } from '../../../src/services/bidValidator.js'
import { Team } from '../../../src/models/Team.js'
import { Player } from '../../../src/models/Player.js'

const config = {
  budgetPerTeam: 200,
  minBidIncrement: 1,
  rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 }
}

function makeTeam(overrides = {}) {
  const team = new Team('t1', 'Test', false, config)
  Object.assign(team, overrides)
  return team
}

function makePlayer(id = 'p1') {
  return new Player({ id, name: 'Test Player', position: 'RB', team: 'KC', estimatedValue: 30, byeWeek: 7 })
}

describe('BidValidator', () => {
  describe('validateBid', () => {
    it('accepts a valid bid', () => {
      const team = makeTeam()
      const result = BidValidator.validateBid(team, 10, 9, config)
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('rejects bid below minimum increment', () => {
      const team = makeTeam()
      const result = BidValidator.validateBid(team, 9, 9, config) // needs to be at least 10
      expect(result.isValid).toBe(false)
      expect(result.errors[0]).toMatch(/Minimum bid/)
    })

    it('rejects bid that leaves team unable to fill remaining spots', () => {
      // 15 spots remaining, $200 budget → maxAllowableBid = 200 - 14 = 186
      const team = makeTeam()
      const result = BidValidator.validateBid(team, 190, 0, config)
      expect(result.isValid).toBe(false)
      expect(result.errors[0]).toMatch(/Maximum bid/)
    })

    it('rejects bid when team has no roster space', () => {
      const team = makeTeam()
      for (let i = 0; i < 15; i++) {
        team.roster.push(makePlayer(`p${i}`))
      }
      const result = BidValidator.validateBid(team, 5, 4, config)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Roster is full')
    })

    it('rejects bid less than $1', () => {
      const team = makeTeam()
      const result = BidValidator.validateBid(team, 0, -1, config)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Bid must be at least $1')
    })

    it('rejects bid exceeding total team budget', () => {
      const team = makeTeam()
      const result = BidValidator.validateBid(team, 250, 249, config)
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Bid cannot exceed team budget')
    })

    it('returns maxAllowableBid in result', () => {
      const team = makeTeam()
      const result = BidValidator.validateBid(team, 10, 9, config)
      // 15 spots → 14 reserve → max = 200 - 14 = 186
      expect(result.maxAllowableBid).toBe(186)
    })

    it('accumulates multiple errors', () => {
      const team = makeTeam()
      for (let i = 0; i < 15; i++) team.roster.push(makePlayer(`p${i}`))
      // Roster full AND bid < $1
      const result = BidValidator.validateBid(team, 0, -1, config)
      expect(result.errors.length).toBeGreaterThan(1)
    })
  })

  describe('calculateMaxBid', () => {
    it('returns budget minus reserve for remaining spots', () => {
      const team = makeTeam()
      // 15 spots → need 14 → max = 200 - 14 = 186
      expect(BidValidator.calculateMaxBid(team)).toBe(186)
    })

    it('returns at least 1', () => {
      const team = makeTeam({ remainingBudget: 1 })
      for (let i = 0; i < 14; i++) team.roster.push(makePlayer(`p${i}`))
      expect(BidValidator.calculateMaxBid(team)).toBe(1)
    })
  })

  describe('validateNomination', () => {
    it('accepts a valid nomination', () => {
      const team = makeTeam()
      const player = makePlayer('p1')
      const result = BidValidator.validateNomination(team, player, [player])
      expect(result.isValid).toBe(true)
    })

    it('rejects nomination of unavailable player', () => {
      const team = makeTeam()
      const player = makePlayer('p1')
      const result = BidValidator.validateNomination(team, player, [])
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Player is not available')
    })

    it('rejects nomination when team has no budget', () => {
      const team = makeTeam({ remainingBudget: 0 })
      const player = makePlayer('p1')
      const result = BidValidator.validateNomination(team, player, [player])
      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Insufficient budget for nomination')
    })
  })
})
