import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BaseStrategy } from '../../../src/strategies/BaseStrategy.js'
import { Team } from '../../../src/models/Team.js'
import { Player } from '../../../src/models/Player.js'

const config = {
  budgetPerTeam: 200,
  rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 }
}

function makeTeam(overrides = {}) {
  const t = new Team('t1', 'Test', false, config)
  Object.assign(t, overrides)
  return t
}

function makePlayer(position, value = 30, id = 'p1') {
  return new Player({ id, name: `Player ${id}`, position, team: 'KC', estimatedValue: value, byeWeek: 7 })
}

class TestStrategy extends BaseStrategy {
  constructor() {
    super('Test')
    this.preferences = {
      positionMultipliers: { QB: 1.0, RB: 1.0, WR: 1.0, TE: 1.0, K: 0.8, DST: 0.8 }
    }
  }

  evaluateBid(player, currentBid, adjustedValue) {
    return currentBid < adjustedValue
  }
}

describe('BaseStrategy', () => {
  let strategy
  let team

  beforeEach(() => {
    strategy = new TestStrategy()
    team = makeTeam()
    team.setStrategy(strategy)
  })

  describe('shouldApplyPositionLimits', () => {
    it('returns false for QB when below position limit (0 of 2 in standard)', () => {
      const qb = makePlayer('QB')
      expect(strategy.shouldApplyPositionLimits(qb)).toBe(false)
    })

    it('returns false for QB with 1 drafted (backup slot still open)', () => {
      team.roster.push(makePlayer('QB', 40, 'qb1'))
      expect(strategy.shouldApplyPositionLimits(makePlayer('QB'))).toBe(false)
    })

    it('returns true for QB at limit (2 in standard, QB:1 + no SUPERFLEX + 1 backup)', () => {
      team.roster.push(makePlayer('QB', 40, 'qb1'))
      team.roster.push(makePlayer('QB', 25, 'qb2'))
      expect(strategy.shouldApplyPositionLimits(makePlayer('QB'))).toBe(true)
    })

    it('allows 3 QBs in superflex league (QB:1 + SUPERFLEX:1 + 1 backup)', () => {
      const sfConfig = { ...config, rosterPositions: { ...config.rosterPositions, SUPERFLEX: 1 } }
      const sfTeam = new Team('sf', 'SF', false, sfConfig)
      const sfStrategy = new TestStrategy()
      sfTeam.setStrategy(sfStrategy)
      sfTeam.roster.push(makePlayer('QB', 40, 'qb1'))
      sfTeam.roster.push(makePlayer('QB', 30, 'qb2'))
      // limit = QB(1) + SUPERFLEX(1) + 1 backup = 3; currentCount = 2 → still allowed
      expect(sfStrategy.shouldApplyPositionLimits(makePlayer('QB'))).toBe(false)
    })

    it('returns false for first TE (below backup limit)', () => {
      const te = makePlayer('TE')
      expect(strategy.shouldApplyPositionLimits(te)).toBe(false)
    })

    it('returns false for second TE (backup slot, below limit of 2)', () => {
      team.roster.push(makePlayer('TE', 20, 'te1'))
      const te2 = makePlayer('TE', 15, 'te2')
      expect(strategy.shouldApplyPositionLimits(te2)).toBe(false)
    })

    it('returns true when TE limit of 2 is reached', () => {
      team.roster.push(makePlayer('TE', 20, 'te1'))
      team.roster.push(makePlayer('TE', 12, 'te2'))
      expect(strategy.shouldApplyPositionLimits(makePlayer('TE'))).toBe(true)
    })

    it('returns true at K/DST limit even late in draft', () => {
      // Verify draft-progress loophole no longer exists
      for (let i = 0; i < 12; i++) team.roster.push(makePlayer('RB', 5, `rb${i}`))
      team.roster.push(makePlayer('K', 8, 'k1'))
      team.roster.push(makePlayer('K', 5, 'k2'))
      expect(strategy.shouldApplyPositionLimits(makePlayer('K'))).toBe(true)
    })
  })

  describe('getPositionNeedMultiplier', () => {
    it('returns 1.0 when exactly 1 spot needed', () => {
      expect(strategy.getPositionNeedMultiplier('QB')).toBe(1.0)
    })

    it('returns 1.2 when 2+ spots needed', () => {
      expect(strategy.getPositionNeedMultiplier('RB')).toBe(1.2)
    })

    it('returns 0.55 when position is already filled (backup/excess discount)', () => {
      team.roster.push(makePlayer('QB', 40, 'qb1'))
      expect(strategy.getPositionNeedMultiplier('QB')).toBe(0.55)
    })
  })

  describe('getPacingRatio', () => {
    it('returns 1.0 for a fresh team (no budget spent, all spots remaining)', () => {
      expect(strategy.getPacingRatio()).toBeCloseTo(1.0, 5)
    })

    it('returns ~1.69 when carrying a big surplus (7 picks made, $180 left)', () => {
      for (let i = 0; i < 7; i++) team.roster.push(makePlayer('RB', 3, `r${i}`))
      team.remainingBudget = 180
      // currentPerPick = 180/8 = 22.5, expectedPerPick = 200/15 ≈ 13.33 → ratio ≈ 1.69
      expect(strategy.getPacingRatio()).toBeCloseTo(22.5 / (200 / 15), 1)
    })

    it('returns ~0.38 when nearly out of budget (7 picks made, $40 left)', () => {
      for (let i = 0; i < 7; i++) team.roster.push(makePlayer('RB', 3, `r${i}`))
      team.remainingBudget = 40
      // currentPerPick = 40/8 = 5, expectedPerPick ≈ 13.33 → ratio ≈ 0.375
      expect(strategy.getPacingRatio()).toBeCloseTo(5 / (200 / 15), 1)
    })

    it('returns 1.0 when team is not set', () => {
      const bare = new TestStrategy()
      expect(bare.getPacingRatio()).toBe(1.0)
    })
  })

  describe('getBudgetConservationFactor', () => {
    it('returns 1.0 when no budget spent', () => {
      expect(strategy.getBudgetConservationFactor()).toBe(1.0)
    })

    it('returns 0.92 when under budget pace (remaining low relative to picks left)', () => {
      // $150 remaining / 15 picks = $10/pick vs expected $13.33/pick → under pace → 0.92
      team.remainingBudget = 150
      expect(strategy.getBudgetConservationFactor()).toBe(0.92)
    })

    it('returns 0.85 when critically under budget pace (nearly out of money)', () => {
      // $40 remaining / 15 picks = $2.67/pick vs expected $13.33/pick → critical → 0.85
      team.remainingBudget = 40
      expect(strategy.getBudgetConservationFactor()).toBe(0.85)
    })

    it('returns 1.05 when over budget pace (surplus per remaining pick)', () => {
      // $180 left / 8 picks = $22.50/pick vs expected $13.33 → > 1.5x → 1.05
      for (let i = 0; i < 7; i++) team.roster.push(makePlayer('RB', 3, `r${i}`))
      team.remainingBudget = 180
      expect(strategy.getBudgetConservationFactor()).toBe(1.05)
    })
  })

  describe('shouldBid', () => {
    it('returns false when team cannot afford the next bid', () => {
      team.remainingBudget = 1
      for (let i = 0; i < 14; i++) team.roster.push(makePlayer('QB', 1, `q${i}`))
      // maxBid = 1, can't afford currentBid + 1 = 2
      const player = makePlayer('RB', 30)
      expect(strategy.shouldBid(player, 1, [])).toBe(false)
    })

    it('returns false for players on the do-not-draft list', () => {
      const player = makePlayer('RB', 30, 'banned')
      team.doNotDraftList.add('banned')
      vi.spyOn(Math, 'random').mockReturnValue(0) // prevent zone-out from interfering
      expect(strategy.shouldBid(player, 5, [])).toBe(false)
    })

    it('returns false when strategy has no team set', () => {
      const bare = new TestStrategy()
      expect(bare.shouldBid(makePlayer('RB'), 5, [])).toBe(false)
    })
  })

  describe('isInTop150Players', () => {
    it('returns true when player is in top 150', () => {
      const players = Array.from({ length: 200 }, (_, i) =>
        makePlayer('RB', 200 - i, `p${i}`)
      )
      const topPlayer = players[0] // rank 1, value 200
      expect(strategy.isInTop150Players(topPlayer, players)).toBe(true)
    })

    it('returns false when player is ranked below 150', () => {
      const players = Array.from({ length: 200 }, (_, i) =>
        makePlayer('RB', 200 - i, `p${i}`)
      )
      const lowPlayer = players[160] // rank 161
      expect(strategy.isInTop150Players(lowPlayer, players)).toBe(false)
    })

    it('returns true when no available players list is provided', () => {
      expect(strategy.isInTop150Players(makePlayer('RB'), [])).toBe(true)
    })
  })

  describe('getBidIncrement', () => {
    it('returns $1 for very low value players', () => {
      const player = makePlayer('K', 3)
      expect(strategy.getBidIncrement(player, 1, 3)).toBe(1)
    })

    it('returns a large increment for severely undervalued players', () => {
      // adjustedValue = 60, currentBid = 20 → undervalued by 40
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const player = makePlayer('RB', 60)
      const increment = strategy.getBidIncrement(player, 20, 60)
      expect(increment).toBeGreaterThanOrEqual(15)
    })
  })

  describe('getStarterUrgencyBoost', () => {
    it('returns 1.0 when team has no open starter slot at that position', () => {
      team.roster.push(makePlayer('QB', 40, 'qb_starter'))
      const player = makePlayer('QB', 50, 'qb_target')
      const others = [makePlayer('QB', 10, 'qb_backup')]
      expect(strategy.getStarterUrgencyBoost(player, others)).toBe(1.0)
    })

    it('returns 1.12 when tier drop is greater than 30%', () => {
      const player = makePlayer('QB', 50, 'qb1')
      const others = [makePlayer('QB', 30, 'qb2')] // drop = 0.40
      expect(strategy.getStarterUrgencyBoost(player, others)).toBe(1.12)
    })

    it('returns 1.06 when tier drop is between 15% and 30%', () => {
      const player = makePlayer('QB', 50, 'qb1')
      const others = [makePlayer('QB', 40, 'qb2')] // drop = 0.20
      expect(strategy.getStarterUrgencyBoost(player, others)).toBe(1.06)
    })

    it('returns 1.03 when tier drop is small (no meaningful gap)', () => {
      const player = makePlayer('QB', 50, 'qb1')
      const others = [makePlayer('QB', 48, 'qb2')] // drop = 0.04
      expect(strategy.getStarterUrgencyBoost(player, others)).toBe(1.03)
    })

    it('returns 1.03 when no available players list is provided', () => {
      const player = makePlayer('QB', 50, 'qb1')
      expect(strategy.getStarterUrgencyBoost(player, [])).toBe(1.03)
    })
  })

  describe('getAdjustedPlayerValue boost ceilings', () => {
    it('caps pacing boost at 1.50x even when pacingRatio is extreme', () => {
      vi.spyOn(strategy, 'getPacingRatio').mockReturnValue(5.0)
      vi.spyOn(strategy, 'getStarterUrgencyBoost').mockReturnValue(1.0)
      // Push draftProgress past 0.3 so the pacing branch is reachable
      for (let i = 0; i < 6; i++) team.roster.push(makePlayer('K', 1, `k${i}`))

      const player = makePlayer('QB', 50, 'qb_target')
      vi.spyOn(Math, 'random').mockReturnValue(0)

      const adj = strategy.getAdjustedPlayerValue(player, [player])
      // pacingBoost = min(1.50, 5.0) = 1.50; urgencyBoost = 1.0 (stubbed).
      // baseValue × 1.50 = 75, clamped by the defensive ceiling to
      // 50 × 1.35 = 67.5 → 68. Old uncapped logic would multiply by 5.0 → 250+.
      expect(adj).toBeLessThanOrEqual(68)
      expect(adj).toBeGreaterThanOrEqual(55) // confirms boost is actually applied
    })

    it('combines pacing and urgency via max(), not product', () => {
      // Ratio 1.25 keeps the combined result below the 1.35x defensive
      // ceiling so the max-vs-product distinction stays observable:
      // max(1.25, 1.12) = 1.25 → 50 × 1.25 ≈ 63, while a product
      // (1.25 × 1.12 = 1.40) would be clamped at 50 × 1.35 = 67.5 → 68.
      vi.spyOn(strategy, 'getPacingRatio').mockReturnValue(1.25)
      for (let i = 0; i < 6; i++) team.roster.push(makePlayer('K', 1, `k${i}`))

      // QB slot open + tier drop > 30% triggers urgency 1.12
      const player = makePlayer('QB', 50, 'qb_target')
      const others = [makePlayer('QB', 30, 'qb_step_down')]
      vi.spyOn(Math, 'random').mockReturnValue(0)

      const adj = strategy.getAdjustedPlayerValue(player, [player, ...others])
      expect(adj).toBeLessThanOrEqual(63)
    })

    it('defensive cap clamps adjustedValue to 1.35x book even with maxed multipliers', () => {
      // Force every multiplier high: fresh roster, max random rolls, hi-tier urgency.
      vi.spyOn(strategy, 'getPacingRatio').mockReturnValue(5.0)
      vi.spyOn(strategy, 'getStarterUrgencyBoost').mockReturnValue(1.20)
      vi.spyOn(Math, 'random').mockReturnValue(0.999999)

      // Tilt the value modifier high too, simulating an AI favorite.
      const player = makePlayer('WR', 40, 'wr_cap')
      team.valueModifiers.set(player.id, 1.30)

      const adj = strategy.getAdjustedPlayerValue(player, [player])
      expect(adj).toBeLessThanOrEqual(Math.round(40 * 1.35))
    })

    it('elite $50+ player stays at or below 1.12x of estimatedValue without boosts', () => {
      vi.spyOn(strategy, 'getPacingRatio').mockReturnValue(1.0)
      vi.spyOn(strategy, 'getStarterUrgencyBoost').mockReturnValue(1.0)

      const player = makePlayer('QB', 50, 'qb_target')
      vi.spyOn(Math, 'random').mockReturnValue(0)

      const adj = strategy.getAdjustedPlayerValue(player, [player])
      // No boosts. Hard cap from getMaxBidForPlayer: 1.12 × 50 = 56.
      expect(adj).toBeLessThanOrEqual(56)
    })
  })

  describe('getEndgameSpendFloor', () => {
    // Standard config: 15 total spots. Pushing 6 RBs leaves 9 spots — inside
    // the 10-spot endgame window. owed K/DST = 2 → burnSpots = 7,
    // fairShare = (200 - 2×$2) / 7 = $28.
    function fillToEndgame(t) {
      for (let i = 0; i < 6; i++) t.roster.push(makePlayer('RB', 1, `rb${i}`))
    }

    it('returns 0 outside the endgame window (fresh roster)', () => {
      expect(strategy.getEndgameSpendFloor(makePlayer('RB', 2, 'cheap'))).toBe(0)
    })

    it('returns 0 for K/DST regardless of surplus', () => {
      fillToEndgame(team)
      expect(strategy.getEndgameSpendFloor(makePlayer('K', 2, 'k1'))).toBe(0)
      expect(strategy.getEndgameSpendFloor(makePlayer('DST', 2, 'd1'))).toBe(0)
    })

    // fairShare with 9 spots left = (200 - 2×$2) / 7 = $28.

    it('AI team: capped at 2x book while quality remains on the board', () => {
      fillToEndgame(team) // 9 spots left
      const board = [makePlayer('WR', 15, 'stud')] // best book > sd(10)
      // A $2 book player caps at $4 — mid-draft cheap nominations must not
      // get bid to double digits while real players are still available.
      expect(strategy.getEndgameSpendFloor(makePlayer('RB', 2, 'cheap'), board)).toBeCloseTo(4, 1)
      expect(strategy.getEndgameSpendFloor(makePlayer('RB', 20, 'mid'), board)).toBeCloseTo(28, 1) // 2×20=40 > fairShare
    })

    it('AI team: cap loosens to 4x book when the board is thinning', () => {
      fillToEndgame(team)
      const board = [makePlayer('WR', 7, 'okay')] // best book between sd(5) and sd(10)
      expect(strategy.getEndgameSpendFloor(makePlayer('RB', 2, 'cheap'), board)).toBeCloseTo(8, 1)
    })

    it('AI team: full fair share once only scraps remain', () => {
      fillToEndgame(team)
      const board = [makePlayer('WR', 3, 'scrap')] // best book below sd(5)
      expect(strategy.getEndgameSpendFloor(makePlayer('RB', 2, 'cheap'), board)).toBeCloseTo(28, 1)
    })

    it('AI team: caps on cheap nominees lift only once down to 2 burnable spots', () => {
      // 9 of 15 filled, no K/DST owned → 4 burnable spots (owedKdst 2).
      // Quality remains, so a $2 nominee at <25% of best-usable caps at 2x.
      for (let i = 0; i < 9; i++) team.roster.push(makePlayer('RB', 1, `rb${i}`))
      const board = [makePlayer('WR', 15, 'stud')]
      expect(strategy.getEndgameSpendFloor(makePlayer('WR', 2, 'cheap'), board)).toBeCloseTo(4, 1)
      // Two more wins → 2 burnable spots: caps release (drain of last resort,
      // safe because scrub auctions are blocked in shouldBid by then).
      team.roster.push(makePlayer('WR', 1, 'rb9'))
      team.roster.push(makePlayer('WR', 1, 'rb10'))
      // 11 filled, no K/DST → 4 spots left, owedKdst 2 → burnSpots 2,
      // fairShare = (200 - 2×$2) / 2 = $98.
      expect(strategy.getEndgameSpendFloor(makePlayer('RB', 2, 'cheap'), board)).toBeCloseTo(98, 1)
    })

    it('human team: overpay ties to book value, ~2x for $1-2 players', () => {
      const human = makeTeam({ isHuman: true })
      human.setStrategy(strategy)
      fillToEndgame(human)
      // Flush: fairShare $28 > expected $200/15 ≈ $13.3 → active.
      expect(strategy.getEndgameSpendFloor(makePlayer('WR', 1, 'w1'))).toBeCloseTo(2, 1) // capped 2x
      expect(strategy.getEndgameSpendFloor(makePlayer('WR', 2, 'w2'))).toBeCloseTo(4, 1) // 2x
      // Premium decays fast as book rises: 1 + 2/book.
      expect(strategy.getEndgameSpendFloor(makePlayer('WR', 10, 'w3'))).toBeCloseTo(12, 1) // 1.2x
      expect(strategy.getEndgameSpendFloor(makePlayer('WR', 20, 'w4'))).toBeCloseTo(22, 1) // 1.1x
    })

    it('human team: inactive without surplus (never overpays when at or under pace)', () => {
      const human = makeTeam({ isHuman: true, remainingBudget: 50 })
      human.setStrategy(strategy)
      fillToEndgame(human)
      // fairShare = (50 - 4) / 7 ≈ $6.6 < expected $13.3 → no floor.
      expect(strategy.getEndgameSpendFloor(makePlayer('WR', 2, 'w1'))).toBe(0)
    })
  })

  describe('K/DST value ceiling', () => {
    it('caps an inflated kicker book value to the K/DST hard cap even when flush and over-pace', () => {
      // Simulate bad data: a kicker priced like a skill player.
      const kicker = makePlayer('K', 30, 'k_inflated')
      // Flush, over-pace team late in the draft — every auction-pressure boost active.
      vi.spyOn(strategy, 'getPacingRatio').mockReturnValue(5.0)
      vi.spyOn(strategy, 'getStarterUrgencyBoost').mockReturnValue(1.20)
      for (let i = 0; i < 6; i++) team.roster.push(makePlayer('RB', 1, `rb${i}`))
      vi.spyOn(Math, 'random').mockReturnValue(0.999999)

      const adj = strategy.getAdjustedPlayerValue(kicker, [kicker])
      // Old behavior reached ~1.35× book ($34+). Cap holds at $5.
      expect(adj).toBeLessThanOrEqual(5)
    })

    it('caps an inflated defense the same way', () => {
      const dst = makePlayer('DST', 28, 'dst_inflated')
      vi.spyOn(strategy, 'getPacingRatio').mockReturnValue(5.0)
      vi.spyOn(Math, 'random').mockReturnValue(0.999999)
      const adj = strategy.getAdjustedPlayerValue(dst, [dst])
      expect(adj).toBeLessThanOrEqual(5)
    })

    it('also bounds the actual bid amount, not just the valuation', () => {
      const kicker = makePlayer('K', 30, 'k_inflated')
      vi.spyOn(strategy, 'getPacingRatio').mockReturnValue(5.0)
      vi.spyOn(Math, 'random').mockReturnValue(0.999999)
      const adj = strategy.getAdjustedPlayerValue(kicker, [kicker])
      const bid = strategy.calculateBidAmount(kicker, 1, adj)
      expect(bid).toBeLessThanOrEqual(5)
    })
  })

  describe('user value adjustment hard pin', () => {
    it('breaks through the tier cap when user pins > 1.0', () => {
      const player = makePlayer('WR', 40, 'wr_target')
      team.playerValueAdjustments.set(player.id, 2.0)

      const adj = strategy.getAdjustedPlayerValue(player, [player])
      // 2.0 × 40 = 80, far above the ~$52 cap that would otherwise apply.
      expect(adj).toBe(80)
    })

    it('bounds a pinned value by the team budget (team.maxBid)', () => {
      const player = makePlayer('WR', 40, 'wr_target')
      team.playerValueAdjustments.set(player.id, 2.0)

      // 15 roster spots, empty roster → reserve $14 → maxBid = remainingBudget - 14.
      // Set remainingBudget = 40 so maxBid = 26, well below the pinned 80.
      team.remainingBudget = 40
      const maxBid = team.maxBid

      const adj = strategy.getAdjustedPlayerValue(player, [player])
      expect(adj).toBe(maxBid)
      expect(adj).toBeLessThan(80)
    })

    it('leaves AI teams unaffected (no playerValueAdjustments set)', () => {
      const player = makePlayer('WR', 40, 'wr_target')
      // Simulate an AI team's random favorite via valueModifiers — should NOT
      // trigger the hard-pin branch because playerValueAdjustments is empty.
      team.valueModifiers.set(player.id, 1.30)

      const adj = strategy.getAdjustedPlayerValue(player, [player])
      // High tier cap: 1.10 × 40 × combinedBoost(≤1.20) — well below 1.30 × 40 = 52.
      // Without the hard-pin branch, the normal cap still applies.
      expect(adj).toBeLessThanOrEqual(53)
    })
  })

  describe('isRiskyNomination', () => {
    it('flags a cheap player at a filled position with non-positive multiplier', () => {
      // K mult is 0.8 in TestStrategy. Fill the K slot so getPositionNeed=0.
      team.roster.push(makePlayer('K', 1, 'k_starter'))
      const cheapK = makePlayer('K', 1, 'k_scrub')
      expect(strategy.isRiskyNomination(cheapK)).toBe(true)
    })

    it('exempts cheap players at a position the team still needs', () => {
      // No K rostered → getPositionNeed('K') > 0 → exempt.
      const cheapK = makePlayer('K', 1, 'k_scrub')
      expect(strategy.isRiskyNomination(cheapK)).toBe(false)
    })

    it('exempts players above the $2 ceiling', () => {
      team.roster.push(makePlayer('K', 1, 'k_starter'))
      const okK = makePlayer('K', 3, 'k_mid')
      expect(strategy.isRiskyNomination(okK)).toBe(false)
    })

    it('exempts positions with a positive strategy multiplier (Taco-style stack)', () => {
      // Override K to a "I want this" multiplier without touching team state.
      strategy.preferences.positionMultipliers.K = 1.10
      team.roster.push(makePlayer('K', 1, 'k_starter'))
      const cheapK = makePlayer('K', 1, 'k_stack')
      expect(strategy.isRiskyNomination(cheapK)).toBe(false)
    })

    it('returns false when the strategy has no team set', () => {
      const bare = new TestStrategy()
      expect(bare.isRiskyNomination(makePlayer('K', 1))).toBe(false)
    })
  })

  describe('filterNominationPool', () => {
    it('strips out risky players when safe ones remain', () => {
      team.roster.push(makePlayer('K', 1, 'k_starter'))
      team.roster.push(makePlayer('DST', 1, 'dst_starter'))
      const pool = [
        makePlayer('RB', 30, 'rb_star'),     // safe
        makePlayer('K', 1, 'k_scrub'),       // risky
        makePlayer('DST', 0, 'dst_scrub'),   // risky
        makePlayer('WR', 25, 'wr_solid'),    // safe
      ]
      const out = strategy.filterNominationPool(pool)
      const ids = out.map(p => p.id)
      expect(ids).toContain('rb_star')
      expect(ids).toContain('wr_solid')
      expect(ids).not.toContain('k_scrub')
      expect(ids).not.toContain('dst_scrub')
    })

    it('falls back to the unfiltered list when every candidate is risky', () => {
      team.roster.push(makePlayer('K', 1, 'k_starter'))
      team.roster.push(makePlayer('DST', 1, 'dst_starter'))
      const pool = [
        makePlayer('K', 1, 'k_scrub1'),
        makePlayer('DST', 1, 'dst_scrub1'),
      ]
      const out = strategy.filterNominationPool(pool)
      expect(out).toHaveLength(2)
    })
  })

  describe('selectNomination respects the risky filter', () => {
    it('never returns a risky player when a safe option exists', () => {
      team.roster.push(makePlayer('K', 1, 'k_starter'))
      team.roster.push(makePlayer('DST', 1, 'dst_starter'))
      const safe = makePlayer('RB', 30, 'rb_star')
      const pool = [
        safe,
        makePlayer('K', 1, 'k_scrub'),
        makePlayer('DST', 0, 'dst_scrub'),
      ]
      // Pin Math.random so any "want a player" branches resolve deterministically.
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const picked = strategy.selectNomination(pool)
      expect(['k_scrub', 'dst_scrub']).not.toContain(picked.id)
    })
  })
})
