import { describe, it, expect, beforeEach } from 'vitest'
import { AIManager } from '../../../src/services/aiManager.js'
import { Team } from '../../../src/models/Team.js'
import { Player } from '../../../src/models/Player.js'
import { StarsAndScrubs } from '../../../src/strategies/StarsAndScrubs.js'
import { ZeroRB } from '../../../src/strategies/ZeroRB.js'
import { Balanced } from '../../../src/strategies/Balanced.js'
import { Taco } from '../../../src/strategies/TacoStrategy.js'

const config = {
  rosterPositions: { QB: 1, RB: 1, WR: 1 }, // 3 spots
  budgetPerTeam: 200
}

function stubStrategy(adjustedValue) {
  return {
    getAdjustedPlayerValue: () => adjustedValue,
    calculateBidAmount: (_player, currentBid) => currentBid + 1,
    shouldBid: () => true,
    getPacingRatio: () => 1
  }
}

describe('AIManager.processAIBidding', () => {
  let manager
  let team
  let player

  beforeEach(() => {
    manager = new AIManager()
    team = new Team('t1', 'AI', false, config)
    team.draftStrategy = stubStrategy(80)
    player = new Player({
      id: 'p1', name: 'Star QB', position: 'QB',
      team: 'KC', estimatedValue: 80, byeWeek: 5
    })
  })

  it('caps the aggressive bid at team.maxBid when the team has tight budget', () => {
    // $15 budget, 3 spots, 0 picked → reserve 2 → maxBid = 13.
    // Without the cap the aggressive path would bid 0.60-0.85 of $80 (~$48-$68).
    team.remainingBudget = 15
    const maxBid = team.maxBid
    expect(maxBid).toBe(13)

    // Re-run because the aggressive amount is randomised inside the band.
    for (let i = 0; i < 50; i++) {
      const bid = manager.processAIBidding([team], player, 0, [player], 0, 20000, null, true)
      if (bid) {
        expect(bid.amount).toBeLessThanOrEqual(maxBid)
        expect(bid.amount).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('skips a team that is out of funds on a high-value player', () => {
    team.remainingBudget = 0
    const bid = manager.processAIBidding([team], player, 0, [player], 0, 20000, null, true)
    expect(bid).toBeNull()
  })

  it('skips a team whose remaining budget cannot cover $1 per remaining roster spot', () => {
    // $2 budget, 3 spots → maxBid = 0 → canBid is false
    team.remainingBudget = 2
    const bid = manager.processAIBidding([team], player, 0, [player], 0, 20000, null, true)
    expect(bid).toBeNull()
  })

  it('falls through to another interested team when the first pick cannot outbid', () => {
    // Three teams all "interested" via shouldBid=true, but only one of them
    // returns a calculateBidAmount above currentBid. Without retry, a single
    // unlucky weighted-random pick would terminate the auction at currentBid.
    const lowA = new Team('low_a', 'LowA', false, config)
    const lowB = new Team('low_b', 'LowB', false, config)
    const high = new Team('high', 'High', false, config)
    // currentBid=50; low teams want to bid but cap at 50, high team can hit 100.
    lowA.draftStrategy = {
      getAdjustedPlayerValue: () => 50,
      calculateBidAmount: (_p, currentBid) => Math.min(50, currentBid + 1),
      shouldBid: () => true,
      getPacingRatio: () => 1
    }
    lowB.draftStrategy = {
      getAdjustedPlayerValue: () => 50,
      calculateBidAmount: (_p, currentBid) => Math.min(50, currentBid + 1),
      shouldBid: () => true,
      getPacingRatio: () => 1
    }
    high.draftStrategy = {
      getAdjustedPlayerValue: () => 100,
      calculateBidAmount: (_p, currentBid) => Math.min(100, currentBid + 5),
      shouldBid: () => true,
      getPacingRatio: () => 1
    }

    // 50 trials — without the retry, a 2/3 chance per trial of picking a low
    // team would null out the auction. With the retry, every trial yields a
    // bid > 50 (from the high team).
    for (let i = 0; i < 50; i++) {
      const bid = manager.processAIBidding([lowA, lowB, high], player, 50, [player], 0, 20000, null, true)
      expect(bid).not.toBeNull()
      expect(bid.amount).toBeGreaterThan(50)
      expect(bid.team.id).toBe('high')
    }
  })

  describe('aggressive early opener', () => {
    // The aggressive path bypasses the stochastic shouldBid chain and bids the
    // player up immediately, capped at the picked team's adjustedValue. It
    // guarantees an opener whenever any eligible team values the player above
    // the current bid — so mid-tier players (Burrow/Swift) don't slip through
    // for $1 because of unlucky stochastic rolls in the normal path.

    it('triggers for a mid-tier player (estimatedValue=15)', () => {
      const midPlayer = new Player({
        id: 'mid', name: 'Mid QB', position: 'QB',
        team: 'KC', estimatedValue: 15, byeWeek: 5
      })
      team.remainingBudget = 200
      team.draftStrategy = stubStrategy(15)

      const bid = manager.processAIBidding([team], midPlayer, 1, [midPlayer], 0, 20000, null, true)
      expect(bid?.isAggressive).toBe(true)
      expect(bid.amount).toBeGreaterThan(1)
      expect(bid.amount).toBeLessThanOrEqual(15)
    })

    it('does not trigger for a tiny-value player (estimatedValue=4)', () => {
      const lowPlayer = new Player({
        id: 'low', name: 'Tiny', position: 'TE',
        team: 'KC', estimatedValue: 4, byeWeek: 5
      })
      team.remainingBudget = 200
      team.draftStrategy = stubStrategy(4)
      const bid = manager.processAIBidding([team], lowPlayer, 1, [lowPlayer], 0, 20000, null, true)
      // Falls through to the normal path — stub's calculateBidAmount returns currentBid+1.
      expect(bid).not.toBeNull()
      expect(bid.isAggressive).toBeFalsy()
      expect(bid.amount).toBe(2)
    })

    it('picks the team with the highest adjustedValue when teams disagree', () => {
      // Mirrors the late-mid-draft case for Burrow: most teams already filled
      // their QB and value him at ~$8 (backup-slot discount), only one team
      // still needs a QB and values him at $15.
      const burrow = new Player({
        id: 'burrow', name: 'Joe Burrow', position: 'QB',
        team: 'CIN', estimatedValue: 15, byeWeek: 12
      })
      const needsQb = new Team('needs', 'NeedsQB', false, config)
      needsQb.remainingBudget = 200
      needsQb.draftStrategy = stubStrategy(15)
      const hasQb = [0, 1, 2, 3].map(i => {
        const t = new Team(`has_${i}`, `HasQB${i}`, false, config)
        t.remainingBudget = 200
        t.draftStrategy = stubStrategy(8) // 0.55 backup-slot discount territory
        return t
      })
      const bid = manager.processAIBidding(
        [needsQb, ...hasQb], burrow, 1, [burrow], 0, 20000, null, true
      )
      expect(bid?.isAggressive).toBe(true)
      expect(bid.team.id).toBe('needs')
      expect(bid.amount).toBeGreaterThanOrEqual(2)
      expect(bid.amount).toBeLessThanOrEqual(15)
    })

    it('still fires when every team is below the old 65% bar — caps bid at bestValue', () => {
      // Pre-fix: aggressive filter required adjustedValue >= estimatedValue * 0.65 = $9.75.
      // All teams at $8 would have failed and the player would silently go for $1.
      // Now we pick the highest team ($8) and cap the bid at $8.
      const player = new Player({
        id: 'p', name: 'P', position: 'WR',
        team: 'KC', estimatedValue: 15, byeWeek: 5
      })
      const teams = [0, 1, 2].map(i => {
        const t = new Team(`t_${i}`, `T${i}`, false, config)
        t.remainingBudget = 200
        t.draftStrategy = stubStrategy(8)
        return t
      })
      const bid = manager.processAIBidding(teams, player, 1, [player], 0, 20000, null, true)
      expect(bid?.isAggressive).toBe(true)
      expect(bid.amount).toBeGreaterThanOrEqual(2)
      expect(bid.amount).toBeLessThanOrEqual(8) // capped at picked team's adjustedValue
    })

    it('returns null from the aggressive path when no team values the player above currentBid', () => {
      const player = new Player({
        id: 'p', name: 'P', position: 'WR',
        team: 'KC', estimatedValue: 15, byeWeek: 5
      })
      // All teams' adjustedValue (5) is below currentBid (10) — opener can't fire.
      const teams = [0, 1].map(i => {
        const t = new Team(`t_${i}`, `T${i}`, false, config)
        t.remainingBudget = 200
        // stub's calculateBidAmount returns currentBid + 1; we want the normal
        // path to also not bid, so override calculateBidAmount to return 0.
        t.draftStrategy = {
          getAdjustedPlayerValue: () => 5,
          calculateBidAmount: () => 0,
          shouldBid: () => true,
          getPacingRatio: () => 1
        }
        return t
      })
      const bid = manager.processAIBidding(teams, player, 10, [player], 0, 20000, null, true)
      expect(bid).toBeNull()
    })
  })

  it('returns null only when no interested team can outbid currentBid', () => {
    const lowA = new Team('low_a', 'LowA', false, config)
    const lowB = new Team('low_b', 'LowB', false, config)
    lowA.draftStrategy = {
      getAdjustedPlayerValue: () => 40,
      calculateBidAmount: (_p, currentBid) => Math.min(40, currentBid + 1),
      shouldBid: () => true,
      getPacingRatio: () => 1
    }
    lowB.draftStrategy = {
      getAdjustedPlayerValue: () => 40,
      calculateBidAmount: (_p, currentBid) => Math.min(40, currentBid + 1),
      shouldBid: () => true,
      getPacingRatio: () => 1
    }
    const bid = manager.processAIBidding([lowA, lowB], player, 50, [player], 0, 20000, null, true)
    expect(bid).toBeNull()
  })
})

describe('AIManager.assignStrategies', () => {
  const makeTeams = (count, humanPosition = 1) => {
    const teams = []
    for (let i = 0; i < count; i++) {
      const position = i + 1
      const isHuman = position === humanPosition
      teams.push(new Team(`team_${position}`, isHuman ? 'You' : `Team ${position}`, isHuman, config))
    }
    return teams
  }

  it('falls back to the legacy distribution when aiTeamStrategies is omitted', () => {
    const manager = new AIManager()
    const teams = makeTeams(12)
    manager.assignStrategies(teams)
    const aiTeams = teams.filter(t => !t.isHuman)
    expect(aiTeams.every(t => t.draftStrategy)).toBe(true)
    const numStarsAndScrubs = aiTeams.filter(t => t.draftStrategy instanceof StarsAndScrubs).length
    expect(numStarsAndScrubs).toBeGreaterThanOrEqual(Math.ceil(aiTeams.length / 2))
  })

  it('registers Taco in the strategies pool', () => {
    const manager = new AIManager()
    expect(manager.strategies).toContain(Taco)
  })

  it('honors a Taco pin', () => {
    const manager = new AIManager()
    const teams = makeTeams(12)
    const aiTeamStrategies = new Array(12).fill('Mixed')
    aiTeamStrategies[1] = 'Taco'
    manager.assignStrategies(teams, aiTeamStrategies)
    const tacoTeam = teams.find(t => t.id === 'team_2')
    expect(tacoTeam.draftStrategy).toBeInstanceOf(Taco)
    expect(tacoTeam.draftStrategy.preferences.homeTeam).toMatch(/^[A-Z]{2,3}$/)
  })

  it('every non-S&S strategy is reachable from the Mixed pool across runs', () => {
    const manager = new AIManager()
    const expected = manager.strategies
      .filter(S => S !== StarsAndScrubs)
      .map(S => S.name)

    const counts = new Map(expected.map(n => [n, 0]))
    for (let run = 0; run < 100; run++) {
      const teams = makeTeams(12)
      manager.assignStrategies(teams)
      for (const t of teams) {
        if (t.isHuman || !t.draftStrategy) continue
        const n = t.draftStrategy.constructor.name
        counts.set(n, (counts.get(n) ?? 0) + 1)
      }
    }

    for (const name of expected) {
      expect(counts.get(name)).toBeGreaterThan(0)
    }
  })

  it('honors every pinned slot when all AI teams are set', () => {
    const manager = new AIManager()
    const teams = makeTeams(12)
    const aiTeamStrategies = []
    for (let p = 1; p <= 12; p++) {
      aiTeamStrategies[p - 1] = p === 1 ? 'Mixed' : 'ZeroRB' // human is at position 1
    }
    manager.assignStrategies(teams, aiTeamStrategies)
    const aiTeams = teams.filter(t => !t.isHuman)
    expect(aiTeams.every(t => t.draftStrategy instanceof ZeroRB)).toBe(true)
  })

  it('threads the player pool to per-team generators', () => {
    const manager = new AIManager()
    const teams = makeTeams(4)
    // Build a pool of 100 players with zero-padded IDs and decreasing values.
    const players = Array.from({ length: 100 }, (_, i) => ({
      id: `player_${String(i + 1).padStart(3, '0')}`,
      name: `P${i + 1}`,
      position: 'WR',
      estimatedValue: 100 - i
    }))
    const idSet = new Set(players.map(p => p.id))

    manager.assignStrategies(teams, [], players)
    const aiTeams = teams.filter(t => !t.isHuman)
    for (const team of aiTeams) {
      expect(team.valueModifiers.size).toBeGreaterThanOrEqual(1)
      expect(team.valueModifiers.size).toBeLessThanOrEqual(6)
      for (const id of team.valueModifiers.keys()) {
        expect(idSet.has(id)).toBe(true)
      }
      expect(team.doNotDraftList.size).toBeGreaterThanOrEqual(1)
      expect(team.doNotDraftList.size).toBeLessThanOrEqual(5)
      for (const id of team.doNotDraftList) {
        expect(idSet.has(id)).toBe(true)
      }
    }
  })

  it('never produces a zero-value modifier (DND list covers that case)', () => {
    const manager = new AIManager()
    const players = Array.from({ length: 200 }, (_, i) => ({
      id: `player_${String(i + 1).padStart(3, '0')}`,
      name: `P${i + 1}`,
      position: 'WR',
      estimatedValue: 200 - i
    }))
    for (let trial = 0; trial < 100; trial++) {
      const team = new Team('t_solo', 'Solo', false, config)
      manager.generateValueModifiers(team, players)
      for (const modifier of team.valueModifiers.values()) {
        expect(modifier).toBeGreaterThan(0)
      }
    }
  })

  it('places favorite-tier modifiers (1.05-1.15) on top-50 players by value', () => {
    const manager = new AIManager()
    const players = Array.from({ length: 200 }, (_, i) => ({
      id: `player_${String(i + 1).padStart(3, '0')}`,
      name: `P${i + 1}`,
      position: 'WR',
      estimatedValue: 200 - i
    }))
    const top50Ids = new Set(players.slice(0, 50).map(p => p.id))

    for (let trial = 0; trial < 50; trial++) {
      const team = new Team('t_solo', 'Solo', false, config)
      manager.generateValueModifiers(team, players)
      for (const [id, modifier] of team.valueModifiers.entries()) {
        // Favorite tier [1.05, 1.15) is exclusive — no other tier produces >1.0.
        if (modifier > 1.0) {
          expect(top50Ids.has(id)).toBe(true)
        }
      }
    }
  })

  it('places high-value-dislike modifiers (0.85-0.95) on top-75 players by value', () => {
    const manager = new AIManager()
    const players = Array.from({ length: 200 }, (_, i) => ({
      id: `player_${String(i + 1).padStart(3, '0')}`,
      name: `P${i + 1}`,
      position: 'WR',
      estimatedValue: 200 - i
    }))
    const top75Ids = new Set(players.slice(0, 75).map(p => p.id))

    for (let trial = 0; trial < 50; trial++) {
      const team = new Team('t_solo', 'Solo', false, config)
      manager.generateValueModifiers(team, players)
      for (const [id, modifier] of team.valueModifiers.entries()) {
        // [0.90, 0.95) is exclusively high-value-dislike — low-value tops at
        // <0.90 and favorites start at ≥1.05.
        if (modifier >= 0.90 && modifier < 0.95) {
          expect(top75Ids.has(id)).toBe(true)
        }
      }
    }
  })

  it('pins specified slots and fills the remainder with the fallback algorithm', () => {
    const manager = new AIManager()
    const teams = makeTeams(12)
    const aiTeamStrategies = new Array(12).fill('Mixed')
    aiTeamStrategies[1] = 'Balanced'  // team_2 → Balanced
    aiTeamStrategies[4] = 'ZeroRB'    // team_5 → ZeroRB

    manager.assignStrategies(teams, aiTeamStrategies)

    const team2 = teams.find(t => t.id === 'team_2')
    const team5 = teams.find(t => t.id === 'team_5')
    expect(team2.draftStrategy).toBeInstanceOf(Balanced)
    expect(team5.draftStrategy).toBeInstanceOf(ZeroRB)

    const aiTeams = teams.filter(t => !t.isHuman)
    expect(aiTeams.every(t => t.draftStrategy)).toBe(true)
  })
})
