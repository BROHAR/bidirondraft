import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { HeroRB } from '../../../src/strategies/HeroRB.js'
import { BaseStrategy } from '../../../src/strategies/BaseStrategy.js'
import { Team } from '../../../src/models/Team.js'
import { Player } from '../../../src/models/Player.js'

const config = {
  budgetPerTeam: 200,
  rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 }
}

function makeTeam(cfg = config) {
  return new Team('t1', 'Hero Team', false, cfg)
}

function makePlayer(position, value, id = 'p1', team = 'KC') {
  return new Player({ id, name: `Player ${id}`, position, team, estimatedValue: value, byeWeek: 7 })
}

// Descending-value RB pool: rb0 is the most expensive. With base 50 / step 2,
// the cohort (top 8) spans $50-36 and rb8 ($34) sits just outside it AND below
// the sd(35) keeper fallback, so cohort-membership and book-value clauses are
// distinguishable in tests.
function makeRBPool(count = 12, base = 50, step = 2) {
  return Array.from({ length: count }, (_, i) =>
    makePlayer('RB', base - i * step, `rb${i}`)
  )
}

function makeWRDistractors(count = 10, base = 30) {
  return Array.from({ length: count }, (_, i) =>
    makePlayer('WR', base - (i % 20), `wr${i}`, 'NE')
  )
}

describe('HeroRB strategy', () => {
  let hero
  let team

  beforeEach(() => {
    hero = new HeroRB()
    team = makeTeam()
    team.setStrategy(hero)
  })

  describe('preferences', () => {
    it('is registered with name "Hero RB"', () => {
      expect(hero.name).toBe('Hero RB')
    })

    it('values RB at par — the premium lives in the hero boost, not a blanket multiplier', () => {
      // Regression: the old RB 1.18 survived the loose mid-tier max-bid cap
      // and made the strategy hoard $15-30 RBs instead of landing a stud.
      expect(hero.preferences.positionMultipliers.RB).toBe(1.0)
    })

    it('is an instance of BaseStrategy', () => {
      expect(hero).toBeInstanceOf(BaseStrategy)
    })
  })

  describe('hero cohort snapshot', () => {
    it('captures exactly the top 8 RBs by book value on first sighting of the pool', () => {
      const pool = [...makeRBPool(), ...makeWRDistractors()]
      const ids = hero.heroIds(pool)
      expect(ids.size).toBe(8)
      for (let i = 0; i < 8; i++) expect(ids.has(`rb${i}`)).toBe(true)
      expect(ids.has('rb8')).toBe(false)
    })

    it('stays frozen when the pool shrinks — the 9th-best RB never gets promoted', () => {
      const pool = [...makeRBPool(), ...makeWRDistractors()]
      hero.heroIds(pool)
      const shrunk = pool.filter(p => !['rb0', 'rb1', 'rb2', 'rb3', 'rb4', 'rb5', 'rb6', 'rb7'].includes(p.id))
      expect(hero.heroIds(shrunk).has('rb8')).toBe(false)
      expect(hero.isHeroTarget(shrunk.find(p => p.id === 'rb8'), shrunk)).toBe(false)
    })

    it('returns an empty set (no boost) before any pool has been seen', () => {
      expect(hero.heroIds([]).size).toBe(0)
      expect(hero.getTopTierBoost(makePlayer('RB', 50, 'rbX'), [])).toBe(1.0)
    })
  })

  describe('hasAcquiredHero', () => {
    it('is false on an empty roster', () => {
      expect(hero.hasAcquiredHero()).toBe(false)
    })

    it('is false for a non-cohort RB even when bought at hero money', () => {
      hero.heroIds([...makeRBPool(), ...makeWRDistractors()])
      const scrub = makePlayer('RB', 34, 'rb8')
      scrub.purchasePrice = 30
      team.roster.push(scrub)
      expect(hero.hasAcquiredHero()).toBe(false)
    })

    it('is true when a cohort RB is on the roster, regardless of price paid', () => {
      hero.heroIds([...makeRBPool(), ...makeWRDistractors()])
      const bargain = makePlayer('RB', 44, 'rb3')
      bargain.purchasePrice = 1 // even a $1 no-bid win of a cohort RB counts
      team.roster.push(bargain)
      expect(hero.hasAcquiredHero()).toBe(true)
    })

    it('is false after a cheap $1 fallback RB (the old roster-count gate regression)', () => {
      hero.heroIds([...makeRBPool(), ...makeWRDistractors()])
      const scrub = makePlayer('RB', 5, 'rb_scrub')
      scrub.purchasePrice = 1
      team.roster.push(scrub)
      expect(hero.hasAcquiredHero()).toBe(false)
    })

    it('counts a book-elite roster RB missing from the snapshot (keeper fallback)', () => {
      // Keepers never appear in availablePlayers, so they can't be in the
      // cohort snapshot; a $35+ book RB on the roster still counts as the hero.
      team.roster.push(makePlayer('RB', 40, 'keeper_rb'))
      expect(hero.hasAcquiredHero()).toBe(true)
    })

    it('scales the keeper fallback with the team budget', () => {
      const bigTeam = makeTeam({ ...config, budgetPerTeam: 400 })
      const bigHero = new HeroRB()
      bigTeam.setStrategy(bigHero)
      bigTeam.roster.push(makePlayer('RB', 40, 'keeper_rb')) // < sd(35) = $70 at $400
      expect(bigHero.hasAcquiredHero()).toBe(false)
      bigTeam.roster.push(makePlayer('RB', 80, 'keeper_rb2')) // >= $70
      expect(bigHero.hasAcquiredHero()).toBe(true)
    })
  })

  describe('isHeroTarget / getTopTierBoost', () => {
    let pool

    beforeEach(() => {
      pool = [...makeRBPool(), ...makeWRDistractors()]
    })

    it('boosts cohort RBs while the hero is unowned', () => {
      expect(hero.getTopTierBoost(pool[0], pool)).toBeCloseTo(1.2)
      expect(hero.getTopTierBoost(pool[7], pool)).toBeCloseTo(1.2)
    })

    it('does not boost the 9th-ranked RB or other positions', () => {
      expect(hero.getTopTierBoost(pool[8], pool)).toBe(1.0)
      const wr = pool.find(p => p.position === 'WR')
      expect(hero.getTopTierBoost(wr, pool)).toBe(1.0)
    })

    it('stops boosting once the hero is acquired', () => {
      hero.heroIds(pool)
      team.roster.push(makePlayer('RB', 50, 'rb0'))
      expect(hero.getTopTierBoost(pool.find(p => p.id === 'rb1'), pool)).toBe(1.0)
    })
  })

  describe('hero premium survives the per-player bid cap', () => {
    // Regression for "HeroRB never wins the stud": getMaxBidForPlayer caps
    // studs (value >= sd(30)) at ~1.0-1.05x book, which erased the old 1.18
    // position multiplier so HeroRB bid the same ~book as the field. The
    // signature-boost path now lets the hero premium clear the field.
    it('values a cohort stud well above book pre-hero, bounded by the 1.35x ceiling', () => {
      const pool = [...makeRBPool(), ...makeWRDistractors()]
      const stud = pool.find(p => p.id === 'rb1') // $48 book
      for (let i = 0; i < 25; i++) {
        const val = hero.getAdjustedPlayerValue(stud, pool)
        expect(val).toBeGreaterThan(48 * 1.10)
        expect(val).toBeLessThanOrEqual(Math.round(48 * 1.35))
      }
    })

    it('drops back to (below) field pricing on the same stud once the hero is owned', () => {
      const pool = [...makeRBPool(), ...makeWRDistractors()]
      const stud = pool.find(p => p.id === 'rb1')

      let preMin = Infinity
      for (let i = 0; i < 25; i++) {
        preMin = Math.min(preMin, hero.getAdjustedPlayerValue(stud, pool))
      }

      team.roster.push(makePlayer('RB', 50, 'rb0')) // cohort hero acquired
      let postMax = 0
      for (let i = 0; i < 25; i++) {
        postMax = Math.max(postMax, hero.getAdjustedPlayerValue(stud, pool))
      }

      expect(postMax).toBeLessThan(preMin)
    })
  })

  describe('post-hero conservatism', () => {
    beforeEach(() => {
      hero.heroIds([...makeRBPool(), ...makeWRDistractors()])
      team.roster.push(makePlayer('RB', 50, 'rb0'))
    })

    it('discounts additional RBs and pivots budget to WRs', () => {
      expect(hero.getPositionMultiplier('RB')).toBe(0.85)
      expect(hero.getPositionMultiplier('WR')).toBe(1.05)
    })

    it('never bids an additional RB up to its full adjusted value', () => {
      const midRB = makePlayer('RB', 20, 'rb9')
      for (let i = 0; i < 200; i++) {
        // Threshold band is 0.75-0.90 x adjustedValue, so 0.97x always rejects
        expect(hero.evaluateBid(midRB, Math.ceil(20 * 0.97), 20, [])).toBe(false)
      }
    })
  })

  describe('evaluateBid on hero targets', () => {
    it('stays in up to book value but walks away above the premium ceiling', () => {
      const pool = [...makeRBPool(), ...makeWRDistractors()]
      const stud = pool.find(p => p.id === 'rb0') // book $50
      for (let i = 0; i < 200; i++) {
        // Below the 1.04x-book floor of the walk-away band: always in
        expect(hero.evaluateBid(stud, 51, 60, pool)).toBe(true)
        // Above the 1.15x-book top of the band: always out, even though the
        // boosted adjustedValue would allow more — price discipline vs a
        // rival hero hunter
        expect(hero.evaluateBid(stud, 58, 60, pool)).toBe(false)
        // And never at/above adjustedValue (no dead >1.0 factor)
        expect(hero.evaluateBid(stud, 60, 60, pool)).toBe(false)
      }
    })
  })

  describe('getBidIncrement', () => {
    it('uses aggressive $2-8 jumps on cohort RBs pre-hero', () => {
      hero.heroIds([...makeRBPool(), ...makeWRDistractors()])
      const stud = makePlayer('RB', 50, 'rb0')
      for (let i = 0; i < 100; i++) {
        const inc = hero.getBidIncrement(stud, 20, 50)
        expect(inc).toBeGreaterThanOrEqual(2)
        expect(inc).toBeLessThanOrEqual(8)
      }
    })

    it('closes with $1-2 raises once the price reaches book value', () => {
      // Big jumps above book would overshoot the hero walk-away ceiling and
      // inflate realized stud prices.
      hero.heroIds([...makeRBPool(), ...makeWRDistractors()])
      const stud = makePlayer('RB', 50, 'rb0')
      for (let i = 0; i < 100; i++) {
        const inc = hero.getBidIncrement(stud, 52, 60)
        expect(inc).toBeGreaterThanOrEqual(1)
        expect(inc).toBeLessThanOrEqual(2)
      }
    })

    it('defers to the base increment for non-cohort players and post-hero', () => {
      hero.heroIds([...makeRBPool(), ...makeWRDistractors()])
      const spy = vi.spyOn(BaseStrategy.prototype, 'getBidIncrement')
      hero.getBidIncrement(makePlayer('RB', 34, 'rb8'), 10, 34)
      expect(spy).toHaveBeenCalledTimes(1)
      team.roster.push(makePlayer('RB', 50, 'rb0'))
      hero.getBidIncrement(makePlayer('RB', 48, 'rb1'), 10, 48)
      expect(spy).toHaveBeenCalledTimes(2)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('selectNomination', () => {
    let pool

    beforeEach(() => {
      pool = [...makeRBPool(), ...makeWRDistractors(40)]
    })

    it('nominates the best available cohort RB most of the time pre-hero', () => {
      let hits = 0
      const TRIALS = 300
      for (let i = 0; i < TRIALS; i++) {
        if (hero.selectNomination(pool)?.id === 'rb0') hits++
      }
      // Hero branch fires ~70% and always picks the top cohort RB; loose bound.
      expect(hits / TRIALS).toBeGreaterThan(0.5)
    })

    it('still hunts the hero after winning a cheap non-cohort RB (regression)', () => {
      hero.heroIds(pool)
      const scrub = makePlayer('RB', 5, 'rb_scrub')
      scrub.purchasePrice = 1
      team.roster.push(scrub)
      let hits = 0
      const TRIALS = 300
      for (let i = 0; i < TRIALS; i++) {
        if (hero.selectNomination(pool)?.id === 'rb0') hits++
      }
      expect(hits / TRIALS).toBeGreaterThan(0.5)
    })

    it('stops the hero-nomination branch once a cohort RB is acquired', () => {
      hero.heroIds(pool)
      team.roster.push(makePlayer('RB', 44, 'rb3'))
      const spy = vi.spyOn(BaseStrategy.prototype, 'selectNomination')
      const TRIALS = 100
      for (let i = 0; i < TRIALS; i++) {
        hero.selectNomination(pool)
      }
      // Every nomination defers to the base strategy — the branch never fires.
      expect(spy).toHaveBeenCalledTimes(TRIALS)
    })
  })
})
