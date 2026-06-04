import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Taco, NFL_TEAMS } from '../../../src/strategies/TacoStrategy.js'
import { BaseStrategy } from '../../../src/strategies/BaseStrategy.js'
import { Team } from '../../../src/models/Team.js'
import { Player } from '../../../src/models/Player.js'

const config = {
  budgetPerTeam: 200,
  rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 }
}

function makeTeam() {
  return new Team('t1', 'Taco Team', false, config)
}

function makePlayer(position, value, id = 'p1', team = 'KC') {
  return new Player({ id, name: `Player ${id}`, position, team, estimatedValue: value, byeWeek: 7 })
}

function makeQBPool(count, basePrice = 50) {
  // Descending value list so rank 0 is the most expensive
  return Array.from({ length: count }, (_, i) =>
    makePlayer('QB', basePrice - i * 2, `qb${i}`, 'NE')
  )
}

describe('Taco strategy', () => {
  let taco
  let team

  beforeEach(() => {
    taco = new Taco()
    team = makeTeam()
    team.setStrategy(taco)
    // Deterministic home team for assertions
    taco.preferences.homeTeam = 'DAL'
  })

  describe('preferences', () => {
    it('is registered with name "Taco"', () => {
      expect(taco.name).toBe('Taco')
    })

    it('picks a homeTeam at construction time (3-letter NFL code)', () => {
      const fresh = new Taco()
      expect(fresh.preferences.homeTeam).toMatch(/^[A-Z]{2,3}$/)
    })

    it('exports a sorted NFL_TEAMS list that excludes the free-agent code', () => {
      expect(NFL_TEAMS.length).toBeGreaterThan(20)
      expect(NFL_TEAMS).not.toContain('FA')
      expect([...NFL_TEAMS]).toEqual([...NFL_TEAMS].sort())
    })

    it('overvalues K and DST relative to most strategies', () => {
      expect(taco.preferences.positionMultipliers.K).toBeGreaterThanOrEqual(1.0)
      expect(taco.preferences.positionMultipliers.DST).toBeGreaterThanOrEqual(1.0)
    })

    it('also values TE at par or higher (drives the second-TE stack)', () => {
      expect(taco.preferences.positionMultipliers.TE).toBeGreaterThanOrEqual(1.0)
    })
  })

  describe('getPositionLimit', () => {
    it('allows up to 3 kickers (vs base limit of 2)', () => {
      expect(taco.getPositionLimit('K')).toBe(3)
    })

    it('allows up to 3 defenses (vs base limit of 2)', () => {
      expect(taco.getPositionLimit('DST')).toBe(3)
    })

    it('does not relax QB or TE limits', () => {
      // Base QB limit = QB(1) + SUPERFLEX(0) + 1 backup = 2
      expect(taco.getPositionLimit('QB')).toBe(2)
      // Base TE limit = TE(1) + 1 backup = 2
      expect(taco.getPositionLimit('TE')).toBe(2)
    })
  })

  describe('getPositionNeedMultiplier — boring-position backups', () => {
    it('returns 0.95 (mild discount, not 0.55) for a K backup while under Taco limit', () => {
      // Starter slot is filled, but Taco's limit of 3 still has room.
      team.roster.push(makePlayer('K', 4, 'k1'))
      expect(taco.getPositionNeedMultiplier('K')).toBe(0.95)
    })

    it('returns 0.95 for a DST backup while under Taco limit', () => {
      team.roster.push(makePlayer('DST', 3, 'dst1'))
      expect(taco.getPositionNeedMultiplier('DST')).toBe(0.95)
    })

    it('returns 0.95 for a TE backup while under Taco limit', () => {
      team.roster.push(makePlayer('TE', 12, 'te1'))
      expect(taco.getPositionNeedMultiplier('TE')).toBe(0.95)
    })

    it('falls back to base 0.55 once at Taco limit (no more stockpiling)', () => {
      // Fill K to Taco's full limit of 3
      team.roster.push(makePlayer('K', 4, 'k1'))
      team.roster.push(makePlayer('K', 3, 'k2'))
      team.roster.push(makePlayer('K', 3, 'k3'))
      expect(taco.getPositionNeedMultiplier('K')).toBe(0.55)
    })

    it('returns base 1.0 when the starter slot is still open (override defers)', () => {
      // No K on roster, config.K = 1 → need = 1 → base returns 1.0
      expect(taco.getPositionNeedMultiplier('K')).toBe(1.0)
    })

    it('does not affect non-boring positions (override defers to super)', () => {
      // QB starter filled, config.QB = 1 → need = 0 → base returns 0.55
      team.roster.push(makePlayer('QB', 30, 'qb1'))
      expect(taco.getPositionNeedMultiplier('QB')).toBe(0.55)
    })
  })

  describe('getAdjustedPlayerValue — backup K/DST/TE floor', () => {
    it('floors a backup K at $4 (bypassing the cheap-player short-circuit)', () => {
      // K and DST in the dataset are $0-1, which normally lands in the
      // base's $1-3 short-circuit. Taco needs to escape that to actually win.
      team.roster.push(makePlayer('K', 1, 'k1'))
      const backupK = makePlayer('K', 1, 'k_backup')
      const pool = [backupK]
      expect(taco.getAdjustedPlayerValue(backupK, pool)).toBeGreaterThanOrEqual(4)
    })

    it('floors a backup DST at $4', () => {
      team.roster.push(makePlayer('DST', 1, 'dst1'))
      const backupDst = makePlayer('DST', 0, 'dst_backup')
      expect(taco.getAdjustedPlayerValue(backupDst, [backupDst])).toBeGreaterThanOrEqual(4)
    })

    it('does NOT floor when starter slot is still open', () => {
      // No K on roster → need = 1 → override defers → base returns $1-3
      const k = makePlayer('K', 1, 'k_only')
      const val = taco.getAdjustedPlayerValue(k, [k])
      expect(val).toBeLessThanOrEqual(3)
    })

    it('does NOT floor once at Taco limit (3 K already drafted)', () => {
      team.roster.push(makePlayer('K', 1, 'k1'))
      team.roster.push(makePlayer('K', 1, 'k2'))
      team.roster.push(makePlayer('K', 1, 'k3'))
      const fourth = makePlayer('K', 1, 'k4')
      const val = taco.getAdjustedPlayerValue(fourth, [fourth])
      // Falls through to base — short-circuit returns 1-3
      expect(val).toBeLessThanOrEqual(3)
    })

    it('floor does not override a higher base value (expensive TE backup)', () => {
      team.roster.push(makePlayer('TE', 12, 'te1'))
      // High-value backup TE goes through full multiplier stack, which can
      // exceed $4 — Math.max(base, 4) keeps the base.
      const teBackup = makePlayer('TE', 15, 'te_backup')
      const pool = [teBackup, ...makeQBPool(5)]
      const val = taco.getAdjustedPlayerValue(teBackup, pool)
      expect(val).toBeGreaterThanOrEqual(4)
    })
  })

  describe('selectNomination — boring-stack branch', () => {
    it('sometimes nominates a K/DST/TE once those starters are filled', () => {
      // Fill the K, DST, and TE starter slots so the branch is eligible.
      team.roster.push(makePlayer('K', 4, 'k1'))
      team.roster.push(makePlayer('DST', 3, 'dst1'))
      team.roster.push(makePlayer('TE', 10, 'te1'))

      const cheapBoring = [
        makePlayer('K', 1, 'k_avail_1'),
        makePlayer('K', 2, 'k_avail_2'),
        makePlayer('DST', 1, 'dst_avail_1'),
        makePlayer('TE', 6, 'te_avail_1')
      ]
      const distractors = Array.from({ length: 60 }, (_, i) =>
        makePlayer('RB', 30 - (i % 25), `rb${i}`, 'KC')
      )
      const pool = [...cheapBoring, ...distractors]
      const boringIds = new Set(cheapBoring.map(p => p.id))

      let hits = 0
      const TRIALS = 300
      for (let i = 0; i < TRIALS; i++) {
        const pick = taco.selectNomination(pool)
        if (pick && boringIds.has(pick.id)) hits++
      }
      // ~10% nomination probability; loose lower bound at 4% to avoid flakiness.
      expect(hits / TRIALS).toBeGreaterThan(0.04)
    })

    it('does NOT fire the boring-stack branch when starters are still open', () => {
      // No K/DST/TE on roster; the branch should defer because need > 0.
      // The other Taco branches plus super.selectNomination still produce a valid pick.
      const pool = [
        makePlayer('K', 5, 'k_only', 'NE'),
        makePlayer('RB', 40, 'rb_main', 'KC'),
        makePlayer('WR', 35, 'wr_main', 'NE')
      ]
      // With starters open, the branch's `getPositionNeed(pos) <= 0` guard
      // is false for K/DST/TE → branch skipped. Just verify a valid pick comes back.
      const pick = taco.selectNomination(pool)
      expect(pool).toContain(pick)
    })
  })

  describe('getTopTierBoost', () => {
    it('boosts the top-3 QBs in the available pool', () => {
      const qbs = makeQBPool(10)
      expect(taco.getTopTierBoost(qbs[0], qbs)).toBe(taco.preferences.topQBBoost)
      expect(taco.getTopTierBoost(qbs[2], qbs)).toBe(taco.preferences.topQBBoost)
    })

    it('does not boost QBs outside the top-3', () => {
      const qbs = makeQBPool(10)
      expect(taco.getTopTierBoost(qbs[3], qbs)).toBe(1.0)
      expect(taco.getTopTierBoost(qbs[9], qbs)).toBe(1.0)
    })

    it('does not boost non-QB positions', () => {
      const rb = makePlayer('RB', 60, 'rb1')
      const pool = [rb, ...makeQBPool(5)]
      expect(taco.getTopTierBoost(rb, pool)).toBe(1.0)
    })

    it('returns 1.0 when availablePlayers is empty', () => {
      expect(taco.getTopTierBoost(makePlayer('QB', 50), [])).toBe(1.0)
    })
  })

  describe('getAdjustedPlayerValue — home-team bias', () => {
    // The home-team boost adds to the pre-cap additive bucket. In normal play
    // the boost shapes which players Taco competes for; in this isolated unit
    // test we lift the per-player bid cap so the additive boost is visible in
    // the returned number. Math.random pinned for the deterministic value-cap
    // (this also fixes get*Multiplier rolls inside getAdjustedPlayerValue).
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
      vi.spyOn(taco, 'getMaxBidForPlayer').mockReturnValue(999)
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('adjusts a home-team player above an identical non-home-team player', () => {
      const homie = makePlayer('WR', 30, 'home_wr', 'DAL')
      const stranger = makePlayer('WR', 30, 'away_wr', 'KC')
      const pool = [homie, stranger, ...makeQBPool(5)]
      const homieValue = taco.getAdjustedPlayerValue(homie, pool)
      const strangerValue = taco.getAdjustedPlayerValue(stranger, pool)
      expect(homieValue).toBeGreaterThan(strangerValue)
    })
  })

  describe('1.35x ceiling still applies', () => {
    it('never values a player above 1.35 * estimatedValue, even with all Taco bonuses stacked', () => {
      const homeTopQB = makePlayer('QB', 50, 'home_qb', 'DAL')
      const pool = [homeTopQB, ...makeQBPool(5)]
      const adjusted = taco.getAdjustedPlayerValue(homeTopQB, pool)
      expect(adjusted).toBeLessThanOrEqual(Math.round(50 * 1.35))
    })
  })

  describe('selectNomination', () => {
    it('biases nominations toward home-team players or top-QBs more often than chance', () => {
      const homie = makePlayer('WR', 25, 'home_wr', 'DAL')
      const topQBs = [
        makePlayer('QB', 55, 'qb_top1', 'NE'),
        makePlayer('QB', 50, 'qb_top2', 'NE'),
        makePlayer('QB', 45, 'qb_top3', 'NE')
      ]
      // Plenty of distractors so a non-biased baseline would rarely pick our targets
      const distractors = Array.from({ length: 100 }, (_, i) =>
        makePlayer('RB', 60 - (i % 40), `rb${i}`, 'KC')
      )
      const pool = [homie, ...topQBs, ...distractors]
      const targetIds = new Set(['home_wr', 'qb_top1', 'qb_top2', 'qb_top3'])

      let hits = 0
      const TRIALS = 200
      for (let i = 0; i < TRIALS; i++) {
        const pick = taco.selectNomination(pool)
        if (pick && targetIds.has(pick.id)) hits++
      }
      // Spec: ~30% home-team + ~25% top-QB (combined ~55%). Conservative lower bound at 35%.
      expect(hits / TRIALS).toBeGreaterThan(0.35)
    })

    it('falls back to super.selectNomination when biased branches do not fire', () => {
      // Empty home team + no QBs → both Taco branches return nothing,
      // strategy must still produce a valid nomination from the pool.
      taco.preferences.homeTeam = 'XXX' // no players from XXX
      const pool = [
        makePlayer('RB', 40, 'rb1'),
        makePlayer('WR', 35, 'wr1'),
        makePlayer('TE', 20, 'te1')
      ]
      const pick = taco.selectNomination(pool)
      expect(pick).toBeTruthy()
      expect(pool).toContain(pick)
    })
  })

  describe('inherits BaseStrategy behavior', () => {
    it('is an instance of BaseStrategy', () => {
      expect(taco).toBeInstanceOf(BaseStrategy)
    })
  })
})
