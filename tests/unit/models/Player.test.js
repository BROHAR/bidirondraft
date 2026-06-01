import { describe, it, expect } from 'vitest'
import { Player } from '../../../src/models/Player.js'

const base = {
  id: 'p1',
  name: 'Patrick Mahomes',
  position: 'QB',
  team: 'KC',
  estimatedValue: 45,
  byeWeek: 10
}

describe('Player', () => {
  describe('constructor', () => {
    it('maps base fields', () => {
      const p = new Player(base)
      expect(p.id).toBe('p1')
      expect(p.name).toBe('Patrick Mahomes')
      expect(p.position).toBe('QB')
      expect(p.team).toBe('KC')
      expect(p.estimatedValue).toBe(45)
      expect(p.byeWeek).toBe(10)
    })

    it('reads scoring format from object projections', () => {
      const p = new Player({ ...base, projectedPoints: { halfPPR: 380, standard: 340, ppr: 420 } }, 'halfPPR')
      expect(p.projectedPoints).toBe(380)
      expect(p.allProjections).toEqual({ halfPPR: 380, standard: 340, ppr: 420 })
    })

    it('uses requested scoring format', () => {
      const p = new Player({ ...base, projectedPoints: { halfPPR: 380, ppr: 420 } }, 'ppr')
      expect(p.projectedPoints).toBe(420)
    })

    it('falls back to halfPPR when requested format is missing', () => {
      const p = new Player({ ...base, projectedPoints: { halfPPR: 380 } }, 'ppr')
      expect(p.projectedPoints).toBe(380)
    })

    it('handles legacy numeric projectedPoints', () => {
      const p = new Player({ ...base, projectedPoints: 350 })
      expect(p.projectedPoints).toBe(350)
      expect(p.allProjections).toEqual({ halfPPR: 350 })
    })

    it('defaults projectedPoints to 0 when absent', () => {
      const p = new Player(base)
      expect(p.projectedPoints).toBe(0)
    })
  })

  describe('isEligibleFor', () => {
    it('matches own position', () => {
      expect(new Player({ ...base, position: 'QB' }).isEligibleFor('QB')).toBe(true)
    })

    it('rejects a different position', () => {
      expect(new Player({ ...base, position: 'QB' }).isEligibleFor('RB')).toBe(false)
    })

    it.each(['RB', 'WR', 'TE'])('%s is FLEX eligible', (pos) => {
      expect(new Player({ ...base, position: pos }).isEligibleFor('FLEX')).toBe(true)
    })

    it('QB is not FLEX eligible', () => {
      expect(new Player({ ...base, position: 'QB' }).isEligibleFor('FLEX')).toBe(false)
    })

    it.each(['QB', 'RB', 'WR', 'TE'])('%s is SUPERFLEX eligible', (pos) => {
      expect(new Player({ ...base, position: pos }).isEligibleFor('SUPERFLEX')).toBe(true)
    })

    it('K is not FLEX or SUPERFLEX eligible', () => {
      const k = new Player({ ...base, position: 'K' })
      expect(k.isEligibleFor('FLEX')).toBe(false)
      expect(k.isEligibleFor('SUPERFLEX')).toBe(false)
    })
  })
})
