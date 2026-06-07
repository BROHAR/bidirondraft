import { describe, it, expect, afterEach } from 'vitest'
import { random, setSeed, resetRng } from '../../../src/utils/rng.js'

describe('rng', () => {
  afterEach(() => { resetRng() })

  it('produces values in [0, 1)', () => {
    setSeed(42)
    for (let i = 0; i < 1000; i++) {
      const v = random()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('is deterministic for the same seed', () => {
    setSeed(123)
    const a = Array.from({ length: 10 }, () => random())
    setSeed(123)
    const b = Array.from({ length: 10 }, () => random())
    expect(a).toEqual(b)
  })

  it('differs across seeds', () => {
    setSeed(1)
    const a = random()
    setSeed(2)
    const b = random()
    expect(a).not.toBe(b)
  })

  it('falls back to Math.random after resetRng', () => {
    setSeed(7)
    resetRng()
    // Not deterministic anymore: two fresh sequences from the same seed point
    // would match, but unseeded values still respect the [0, 1) contract.
    const v = random()
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThan(1)
  })
})
