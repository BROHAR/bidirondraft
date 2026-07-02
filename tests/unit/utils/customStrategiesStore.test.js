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
