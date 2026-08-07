import { describe, it, expect } from 'vitest'
import { isPositionStartable } from '../../../src/utils/positionEligibility.js'

describe('isPositionStartable', () => {
  const standard = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 }

  it('accepts every position under a standard lineup', () => {
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST']) {
      expect(isPositionStartable(pos, standard), pos).toBe(true)
    }
  })

  it('rejects K and DST when their dedicated slot is zero or absent', () => {
    const noKdst = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 3, K: 0, DST: 0, BENCH: 6 }
    expect(isPositionStartable('K', noKdst)).toBe(false)
    expect(isPositionStartable('DST', noKdst)).toBe(false)
    const absent = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, BENCH: 6 }
    expect(isPositionStartable('K', absent)).toBe(false)
    expect(isPositionStartable('DST', absent)).toBe(false)
  })

  it('lets FLEX carry RB/WR/TE and SUPERFLEX carry QB', () => {
    const flexOnly = { FLEX: 2, SUPERFLEX: 1, BENCH: 4 }
    expect(isPositionStartable('RB', flexOnly)).toBe(true)
    expect(isPositionStartable('WR', flexOnly)).toBe(true)
    expect(isPositionStartable('TE', flexOnly)).toBe(true)
    expect(isPositionStartable('QB', flexOnly)).toBe(true)
    expect(isPositionStartable('K', flexOnly)).toBe(false)
  })

  it('rejects TE when neither TE nor FLEX nor SUPERFLEX slots exist', () => {
    const noTe = { QB: 1, RB: 2, WR: 3, K: 1, DST: 1, BENCH: 5 }
    expect(isPositionStartable('TE', noTe)).toBe(false)
  })

  it('treats a missing/empty rosterPositions map as all-startable', () => {
    expect(isPositionStartable('K', undefined)).toBe(true)
    expect(isPositionStartable('DST', {})).toBe(true)
  })
})
