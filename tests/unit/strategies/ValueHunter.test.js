import { describe, it, expect, beforeEach } from 'vitest'
import { ValueHunter } from '../../../src/strategies/ValueHunter.js'
import { BaseStrategy } from '../../../src/strategies/BaseStrategy.js'
import { Team } from '../../../src/models/Team.js'
import { Player } from '../../../src/models/Player.js'

const config = {
  budgetPerTeam: 200,
  rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 } // 15 spots
}

function makeTeam(cfg = config) {
  return new Team('t1', 'Hunter Team', false, cfg)
}

function makePlayer(position, value, id = 'p1', team = 'KC') {
  return new Player({ id, name: `Player ${id}`, position, team, estimatedValue: value, byeWeek: 7 })
}

function fillRoster(team, count) {
  for (let i = 0; i < count; i++) {
    team.roster.push(makePlayer('WR', 2, `fill${i}`))
  }
}

describe('ValueHunter strategy', () => {
  let vh
  let team

  beforeEach(() => {
    vh = new ValueHunter()
    team = makeTeam()
    team.setStrategy(vh)
  })

  describe('preferences', () => {
    it('is an instance of BaseStrategy named "Value Hunter"', () => {
      expect(vh).toBeInstanceOf(BaseStrategy)
      expect(vh.name).toBe('Value Hunter')
    })

    it('values positions near-neutral — willingness is book, not a markup', () => {
      // Regression: the old 1.08-1.10 blanket markup made it bid its own
      // inflated number "up to 1.10x", i.e. structurally overpay to ~1.2x book.
      const m = vh.preferences.positionMultipliers
      for (const pos of ['QB', 'RB', 'WR', 'TE']) {
        expect(m[pos]).toBeLessThanOrEqual(1.02)
      }
    })

    it('has no early-draft aggression (base is 1.0-1.1)', () => {
      for (let i = 0; i < 50; i++) {
        expect(vh.getEarlyDraftMultiplier()).toBe(1.0)
      }
    })

    it('always uses the minimum bid increment', () => {
      // The winner pays their own final bid — ladder jumps only donate the gap.
      expect(vh.getBidIncrement(makePlayer('RB', 40, 'rb'), 12, 40)).toBe(1)
      expect(vh.getBidIncrement(makePlayer('WR', 25, 'wr'), 24, 25)).toBe(1)
    })
  })

  describe('evaluateBid — slot discipline', () => {
    it('refuses cheap players while the roster is mostly open', () => {
      const scrub = makePlayer('WR', 5, 'scrub')
      for (let i = 0; i < 100; i++) {
        expect(vh.evaluateBid(scrub, 1, 5, [])).toBe(false)
      }
    })

    it('buys cheap players once the roster is mostly built', () => {
      fillRoster(team, 10) // 10/15 spots > 0.6
      const scrub = makePlayer('WR', 5, 'scrub')
      let yes = 0
      for (let i = 0; i < 200; i++) {
        if (vh.evaluateBid(scrub, 1, 5, [])) yes++
      }
      expect(yes / 200).toBeGreaterThan(0.5)
    })
  })

  describe('evaluateBid — book-relative walk-away', () => {
    it('pounces on a real discount', () => {
      const mid = makePlayer('RB', 20, 'mid')
      let yes = 0
      for (let i = 0; i < 200; i++) {
        if (vh.evaluateBid(mid, 15, 20, [])) yes++ // 25% below book
      }
      expect(yes / 200).toBeGreaterThan(0.9)
    })

    it('never chases a mid-tier player past ~1.08x book', () => {
      const mid = makePlayer('RB', 20, 'mid')
      for (let i = 0; i < 200; i++) {
        expect(vh.evaluateBid(mid, 22, 30, [])).toBe(false)
      }
    })

    it('never chases a stud past ~1.15x book, even with a high adjusted value', () => {
      const stud = makePlayer('RB', 50, 'stud')
      for (let i = 0; i < 200; i++) {
        expect(vh.evaluateBid(stud, 58, 70, [])).toBe(false)
      }
    })

    it('will take a stud at book (anchor buys drain budget before the scraps phase)', () => {
      const stud = makePlayer('RB', 50, 'stud')
      let yes = 0
      for (let i = 0; i < 200; i++) {
        if (vh.evaluateBid(stud, 50, 55, [])) yes++
      }
      expect(yes / 200).toBeGreaterThan(0.5)
    })

    it('only pays scraps prices for cheap players', () => {
      fillRoster(team, 10)
      const scrub = makePlayer('WR', 4, 'scrub') // ceiling = max(book, sd(2)) = 4
      for (let i = 0; i < 100; i++) {
        expect(vh.evaluateBid(scrub, 4, 8, [])).toBe(false)
      }
    })

    it('respects the adjustedValue cap when it is the tighter bound', () => {
      const mid = makePlayer('RB', 20, 'mid')
      for (let i = 0; i < 100; i++) {
        expect(vh.evaluateBid(mid, 11, 10, [])).toBe(false) // 11 >= 10 * 1.10
      }
    })
  })
})
