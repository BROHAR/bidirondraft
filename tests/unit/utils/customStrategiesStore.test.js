import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadCustomStrategies,
  saveCustomStrategies,
  upsertCustomStrategy,
  removeCustomStrategy,
} from '../../../src/utils/customStrategiesStore.js'

const KEY = 'adraft.customStrategies.v1'

describe('customStrategiesStore', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns an empty list when nothing is stored', () => {
    expect(loadCustomStrategies()).toEqual([])
  })

  it('round-trips a saved list', () => {
    const list = [{ id: 'a', name: 'One', baseKey: 'ZeroRB', positionMultipliers: { RB: 0.5 } }]
    saveCustomStrategies(list)
    expect(loadCustomStrategies()).toEqual(list)
  })

  it('falls back to [] on corrupt JSON', () => {
    window.localStorage.setItem(KEY, '{ not json')
    expect(loadCustomStrategies()).toEqual([])
  })

  it('drops entries missing required fields on load', () => {
    window.localStorage.setItem(KEY, JSON.stringify([{ name: 'no id' }, { id: 'ok', name: 'Good' }]))
    const loaded = loadCustomStrategies()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe('ok')
  })

  // The builder clamps on write, but localStorage is hand-editable, so the
  // same clamps re-apply on load — a stored 50× multiplier or 0.99 skip
  // probability must never reach the bidding engine.
  it('re-applies knob clamps on load (hand-edited storage)', () => {
    window.localStorage.setItem(KEY, JSON.stringify([{
      id: 'a',
      name: 'Wild',
      baseKey: 'Balanced',
      positionMultipliers: { QB: 50, RB: 0.001, WR: 1.3, TE: NaN, K: 'x', HACKER: 3 },
      skipProbability: 0.99,
    }]))
    const [def] = loadCustomStrategies()
    expect(def.positionMultipliers).toEqual({ QB: 2.0, RB: 0.5, WR: 1.3 })
    expect(def.skipProbability).toBe(0.45)
  })

  it('drops a non-numeric skipProbability and clamps the low end', () => {
    window.localStorage.setItem(KEY, JSON.stringify([
      { id: 'a', name: 'A', skipProbability: 'often' },
      { id: 'b', name: 'B', skipProbability: 0.0001 },
    ]))
    const [a, b] = loadCustomStrategies()
    expect('skipProbability' in a).toBe(false)
    expect(b.skipProbability).toBe(0.02)
  })

  describe('upsertCustomStrategy', () => {
    it('appends a new definition', () => {
      const next = upsertCustomStrategy([], { id: 'a', name: 'A' })
      expect(next).toHaveLength(1)
    })

    it('replaces an existing definition by id', () => {
      const list = [{ id: 'a', name: 'A' }]
      const next = upsertCustomStrategy(list, { id: 'a', name: 'A-updated' })
      expect(next).toHaveLength(1)
      expect(next[0].name).toBe('A-updated')
    })
  })

  it('removeCustomStrategy filters by id', () => {
    const list = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
    expect(removeCustomStrategy(list, 'a')).toEqual([{ id: 'b', name: 'B' }])
  })
})
