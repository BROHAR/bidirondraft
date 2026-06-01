import { describe, it, expect } from 'vitest'
import { DraftConfig } from '../../../src/models/DraftConfig.js'

describe('DraftConfig', () => {
  describe('constructor', () => {
    it('applies defaults when no options provided', () => {
      const c = new DraftConfig()
      expect(c.numberOfTeams).toBe(12)
      expect(c.budgetPerTeam).toBe(200)
      expect(c.humanTeamName).toBe('Your Team')
      expect(c.humanDraftPosition).toBe(1)
      expect(c.nominationTimer).toBe(20)
      expect(c.biddingTimer).toBe(20)
      expect(c.minBidIncrement).toBe(1)
      expect(c.scoringFormat).toBe('halfPPR')
    })

    it('overrides defaults with provided values', () => {
      const c = new DraftConfig({ numberOfTeams: 10, budgetPerTeam: 300, scoringFormat: 'ppr' })
      expect(c.numberOfTeams).toBe(10)
      expect(c.budgetPerTeam).toBe(300)
      expect(c.scoringFormat).toBe('ppr')
    })

    it('merges rosterPositions on top of defaults', () => {
      const c = new DraftConfig({ rosterPositions: { SUPERFLEX: 1 } })
      expect(c.rosterPositions.QB).toBe(1)
      expect(c.rosterPositions.SUPERFLEX).toBe(1)
    })

    it('overrides default roster positions', () => {
      const c = new DraftConfig({ rosterPositions: { QB: 2 } })
      expect(c.rosterPositions.QB).toBe(2)
    })
  })

  describe('totalRosterSize', () => {
    it('sums all position slots', () => {
      // QB:1 RB:2 WR:2 TE:1 FLEX:1 K:1 DST:1 BENCH:6 = 15
      expect(new DraftConfig().totalRosterSize).toBe(15)
    })

    it('updates when rosterPositions are customized', () => {
      const c = new DraftConfig({ rosterPositions: { QB: 2, RB: 0, WR: 0, TE: 0, FLEX: 0, K: 0, DST: 0, BENCH: 0 } })
      expect(c.totalRosterSize).toBe(2)
    })
  })

  describe('validate', () => {
    it('passes for a valid default config', () => {
      const { isValid, errors } = new DraftConfig().validate()
      expect(isValid).toBe(true)
      expect(errors).toHaveLength(0)
    })

    it('rejects too few teams', () => {
      const { isValid, errors } = new DraftConfig({ numberOfTeams: 7 }).validate()
      expect(isValid).toBe(false)
      expect(errors).toContain('Number of teams must be between 8 and 14')
    })

    it('rejects too many teams', () => {
      const { isValid, errors } = new DraftConfig({ numberOfTeams: 15 }).validate()
      expect(isValid).toBe(false)
      expect(errors).toContain('Number of teams must be between 8 and 14')
    })

    it('rejects budget below minimum', () => {
      const { isValid, errors } = new DraftConfig({ budgetPerTeam: 50 }).validate()
      expect(isValid).toBe(false)
      expect(errors).toContain('Budget per team must be between $100 and $1000')
    })

    it('rejects budget above maximum', () => {
      const { isValid, errors } = new DraftConfig({ budgetPerTeam: 2000 }).validate()
      expect(isValid).toBe(false)
      expect(errors).toContain('Budget per team must be between $100 and $1000')
    })

    it('rejects humanDraftPosition outside team range', () => {
      const { isValid, errors } = new DraftConfig({ numberOfTeams: 10, humanDraftPosition: 12 }).validate()
      expect(isValid).toBe(false)
      expect(errors).toContain('Human draft position must be valid team position')
    })

    it('collects multiple errors', () => {
      const { isValid, errors } = new DraftConfig({ numberOfTeams: 5, budgetPerTeam: 50 }).validate()
      expect(isValid).toBe(false)
      expect(errors.length).toBeGreaterThan(1)
    })
  })
})
