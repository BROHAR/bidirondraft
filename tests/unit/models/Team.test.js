import { describe, it, expect, beforeEach } from 'vitest'
import { Team } from '../../../src/models/Team.js'
import { Player } from '../../../src/models/Player.js'

const config = {
  budgetPerTeam: 200,
  rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 }
}
// total spots = 15

function p(id, position, value = 20) {
  return new Player({ id, name: `Player ${id}`, position, team: 'KC', estimatedValue: value, byeWeek: 5 })
}

function fill(t, position, ids) {
  for (const id of ids) t.roster.push(p(id, position))
}

describe('Team', () => {
  let team

  beforeEach(() => {
    team = new Team('t1', 'Test Team', false, config)
  })

  describe('constructor', () => {
    it('sets budget from config', () => {
      expect(team.budget).toBe(200)
      expect(team.remainingBudget).toBe(200)
    })

    it('starts with an empty roster', () => {
      expect(team.roster).toHaveLength(0)
    })

    it('reflects isHuman flag', () => {
      const human = new Team('t2', 'Human', true, config)
      expect(human.isHuman).toBe(true)
      expect(team.isHuman).toBe(false)
    })

    it('defaults momentum to neutral', () => {
      expect(team.momentum).toBe('neutral')
    })
  })

  describe('getRosterSpotsRemaining', () => {
    it('returns total size on empty roster', () => {
      expect(team.getRosterSpotsRemaining()).toBe(15)
    })

    it('decrements as players are added', () => {
      team.roster.push(p('a', 'QB'), p('b', 'RB'))
      expect(team.getRosterSpotsRemaining()).toBe(13)
    })

    it('returns 0 when roster is full', () => {
      for (let i = 0; i < 15; i++) team.roster.push(p(`p${i}`, 'QB'))
      expect(team.getRosterSpotsRemaining()).toBe(0)
    })
  })

  describe('hasRosterSpace', () => {
    it('returns true when spots remain', () => {
      expect(team.hasRosterSpace()).toBe(true)
    })

    it('returns false when roster is full', () => {
      for (let i = 0; i < 15; i++) team.roster.push(p(`p${i}`, 'QB'))
      expect(team.hasRosterSpace()).toBe(false)
    })
  })

  describe('maxBid', () => {
    it('reserves $1 per remaining roster spot', () => {
      // 15 spots → need 14 reserve → maxBid = 200 - 14 = 186
      expect(team.maxBid).toBe(186)
    })

    it('decreases as players are drafted and budget is spent', () => {
      team.roster.push(p('a', 'QB'))
      team.remainingBudget -= 50
      // 14 spots → need 13 reserve → maxBid = 150 - 13 = 137
      expect(team.maxBid).toBe(137)
    })

    it('equals remaining budget on the last roster spot', () => {
      team.remainingBudget = 1
      for (let i = 0; i < 14; i++) team.roster.push(p(`p${i}`, 'QB'))
      // 1 spot → need 0 reserve → maxBid = 1
      expect(team.maxBid).toBe(1)
    })

    it('can fall below 1 when remaining budget cannot cover reserved spots', () => {
      // 15 spots, $0 budget → need 14 reserve → maxBid = -14
      team.remainingBudget = 0
      expect(team.maxBid).toBe(-14)
    })
  })

  describe('canAffordPlayer', () => {
    it('returns true within maxBid', () => {
      expect(team.canAffordPlayer(100)).toBe(true)
    })

    it('returns false above maxBid', () => {
      expect(team.canAffordPlayer(200)).toBe(false)
    })

    it('returns false for $1 when team is out of funds', () => {
      team.remainingBudget = 0
      expect(team.canAffordPlayer(1)).toBe(false)
    })
  })

  describe('canBid', () => {
    it('returns true for a fresh team', () => {
      expect(team.canBid()).toBe(true)
    })

    it('returns false when remaining budget is 0', () => {
      team.remainingBudget = 0
      expect(team.canBid()).toBe(false)
    })

    it('returns false when remaining budget cannot cover $1 per remaining spot', () => {
      // $2 budget, 3 spots remaining → maxBid = 2 - 2 = 0 → cannot bid
      team.remainingBudget = 2
      for (let i = 0; i < 12; i++) team.roster.push(p(`p${i}`, 'QB'))
      expect(team.canBid()).toBe(false)
    })

    it('returns true at the edge — $1 per remaining spot exactly', () => {
      // $3 budget, 3 spots remaining → maxBid = 3 - 2 = 1
      team.remainingBudget = 3
      for (let i = 0; i < 12; i++) team.roster.push(p(`p${i}`, 'QB'))
      expect(team.canBid()).toBe(true)
    })

    it('returns false when roster is full', () => {
      for (let i = 0; i < 15; i++) team.roster.push(p(`p${i}`, 'QB'))
      expect(team.canBid()).toBe(false)
    })
  })

  describe('getPositionNeed', () => {
    it('returns configured count when position is empty', () => {
      expect(team.getPositionNeed('QB')).toBe(1)
      expect(team.getPositionNeed('RB')).toBe(2)
    })

    it('decrements as position fills', () => {
      team.roster.push(p('a', 'RB'))
      expect(team.getPositionNeed('RB')).toBe(1)
    })

    it('returns 0 when position is filled', () => {
      team.roster.push(p('a', 'QB'))
      expect(team.getPositionNeed('QB')).toBe(0)
    })

    it('returns 0 for unknown positions', () => {
      expect(team.getPositionNeed('UNKNOWN')).toBe(0)
    })
  })

  describe('getFlexNeed', () => {
    it('needs a flex player once base RB/WR/TE starters are filled', () => {
      // RB2, WR2, TE1 fills the base — the FLEX:1 slot still needs an eligible player
      fill(team, 'RB', ['r1', 'r2'])
      fill(team, 'WR', ['w1', 'w2'])
      team.roster.push(p('t1', 'TE'))
      expect(team.getFlexNeed()).toBe(1)
    })

    it('is satisfied by a surplus flex-eligible player', () => {
      fill(team, 'RB', ['r1', 'r2', 'r3']) // 1 surplus RB → fills flex
      fill(team, 'WR', ['w1', 'w2'])
      team.roster.push(p('t1', 'TE'))
      expect(team.getFlexNeed()).toBe(0)
    })

    it('does not count a position still in deficit as flex surplus', () => {
      // RB3 (1 surplus) but WR/TE empty → the surplus RB covers flex, need 0
      fill(team, 'RB', ['r1', 'r2', 'r3'])
      expect(team.getFlexNeed()).toBe(0)
      // …whereas RB2/WR0/TE0 has no surplus → flex still needed
      const t2 = new Team('t2', 'T2', false, config)
      fill(t2, 'RB', ['r1', 'r2'])
      expect(t2.getFlexNeed()).toBe(1)
    })

    it('returns 0 when the config has no FLEX slot', () => {
      const noFlex = new Team('t3', 'T3', false, { rosterPositions: { QB: 1, RB: 2, BENCH: 2 } })
      expect(noFlex.getFlexNeed()).toBe(0)
    })
  })

  describe('getSuperflexNeed', () => {
    const sfConfig = { budgetPerTeam: 200, rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 1, K: 1, DST: 1, BENCH: 5 } }

    it('is 0 without a SUPERFLEX slot', () => {
      expect(team.getSuperflexNeed()).toBe(0)
    })

    it('needs a superflex player after base + flex are covered', () => {
      const t = new Team('sf', 'SF', false, sfConfig)
      fill(t, 'RB', ['r1', 'r2', 'r3']) // RB2 base + 1 → flex
      fill(t, 'WR', ['w1', 'w2'])
      t.roster.push(p('t1', 'TE'))
      t.roster.push(p('q1', 'QB')) // QB base
      // flex consumed the surplus RB; superflex still open
      expect(t.getSuperflexNeed()).toBe(1)
    })

    it('is satisfied by a QB surplus', () => {
      const t = new Team('sf', 'SF', false, sfConfig)
      fill(t, 'RB', ['r1', 'r2', 'r3']) // surplus RB → flex
      fill(t, 'WR', ['w1', 'w2'])
      t.roster.push(p('t1', 'TE'))
      fill(t, 'QB', ['q1', 'q2']) // QB base + 1 surplus → superflex
      expect(t.getSuperflexNeed()).toBe(0)
    })
  })

  describe('getAdjustedPlayerValue', () => {
    it('returns base value when no adjustment is set', () => {
      const player = p('a', 'QB', 40)
      expect(team.getAdjustedPlayerValue(player)).toBe(40)
    })

    it('scales by adjustment multiplier', () => {
      const player = p('a', 'QB', 40)
      team.playerValueAdjustments.set('a', 1.5)
      expect(team.getAdjustedPlayerValue(player)).toBe(60)
    })
  })

  describe('setPlayerValueAdjustment', () => {
    it('stores a multiplier for human teams', () => {
      const human = new Team('t2', 'Human', true, config)
      human.setPlayerValueAdjustment('p1', 1.25)
      expect(human.playerValueAdjustments.get('p1')).toBe(1.25)
    })

    it('removes entry when multiplier is reset to 1.0', () => {
      const human = new Team('t2', 'Human', true, config)
      human.setPlayerValueAdjustment('p1', 1.5)
      human.setPlayerValueAdjustment('p1', 1.0)
      expect(human.playerValueAdjustments.has('p1')).toBe(false)
    })

    it('has no effect on AI teams', () => {
      team.setPlayerValueAdjustment('p1', 1.5)
      expect(team.playerValueAdjustments.has('p1')).toBe(false)
    })

    it('does not leak the user pin map to AI teams when config carries one', () => {
      const userPins = new Map([['p1', 1.6]])
      const configWithPins = { ...config, playerValueAdjustments: userPins }
      const human = new Team('h', 'Human', true, configWithPins)
      const ai = new Team('ai', 'AI', false, configWithPins)
      expect(human.playerValueAdjustments.get('p1')).toBe(1.6)
      expect(ai.playerValueAdjustments.has('p1')).toBe(false)
      // Mutating the AI team's map must not affect the human's.
      ai.playerValueAdjustments.set('p2', 2.0)
      expect(human.playerValueAdjustments.has('p2')).toBe(false)
    })
  })

  describe('auto-pilot', () => {
    it('enables auto-pilot on human teams', () => {
      const human = new Team('t2', 'Human', true, config)
      human.enableAutoPilot('Balanced')
      expect(human.isAutoPilot).toBe(true)
      expect(human.autoPilotStrategy).toBe('Balanced')
    })

    it('does not enable auto-pilot on AI teams', () => {
      team.enableAutoPilot('Balanced')
      expect(team.isAutoPilot).toBe(false)
    })

    it('disables auto-pilot on human teams', () => {
      const human = new Team('t2', 'Human', true, config)
      human.isAutoPilot = true
      human.disableAutoPilot()
      expect(human.isAutoPilot).toBe(false)
    })
  })
})
