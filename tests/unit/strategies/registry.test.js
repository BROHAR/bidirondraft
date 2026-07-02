import { describe, it, expect } from 'vitest'
import {
  BUILTIN_STRATEGIES,
  BUILTIN_BY_KEY,
  MIXED_FILL_POOL,
  getStrategyOptions,
  instantiateStrategy,
  isCustomKey,
  customKey,
} from '../../../src/strategies/registry.js'
import { Balanced } from '../../../src/strategies/Balanced.js'
import { ZeroRB } from '../../../src/strategies/ZeroRB.js'
import { Taco } from '../../../src/strategies/TacoStrategy.js'

describe('strategy registry', () => {
  it('exposes all built-ins by class-name key', () => {
    const keys = BUILTIN_STRATEGIES.map(s => s.key)
    expect(keys).toEqual(
      expect.arrayContaining(['Balanced', 'ZeroRB', 'HeroRB', 'StarsAndScrubs', 'ValueHunter', 'LateRoundQB', 'Taco'])
    )
    expect(BUILTIN_BY_KEY.ZeroRB.Class).toBe(ZeroRB)
    expect(MIXED_FILL_POOL).toContain(Taco)
  })

  describe('getStrategyOptions', () => {
    it('lists built-ins then custom entries', () => {
      const customs = [{ id: 'abc', name: 'My Strat', baseKey: 'ZeroRB' }]
      const opts = getStrategyOptions(customs)
      expect(opts.length).toBe(BUILTIN_STRATEGIES.length + 1)
      const custom = opts[opts.length - 1]
      expect(custom.value).toBe('custom:abc')
      expect(custom.label).toContain('My Strat')
    })

    it('returns just built-ins when no customs given', () => {
      expect(getStrategyOptions()).toHaveLength(BUILTIN_STRATEGIES.length)
    })
  })

  describe('instantiateStrategy', () => {
    it('resolves a built-in key to a fresh instance', () => {
      expect(instantiateStrategy('ZeroRB')).toBeInstanceOf(ZeroRB)
    })

    it('applies a pinned home team to Taco', () => {
      const s = instantiateStrategy('Taco', { homeTeam: 'DAL' })
      expect(s).toBeInstanceOf(Taco)
      expect(s.preferences.homeTeam).toBe('DAL')
    })

    it('resolves a custom key from its definition', () => {
      const customs = [{ id: 'x1', name: 'Cloned', baseKey: 'ZeroRB' }]
      const s = instantiateStrategy('custom:x1', { customDefs: customs })
      expect(s).toBeInstanceOf(ZeroRB)
      expect(s.isCustom).toBe(true)
    })

    it('falls back to Balanced for an unknown built-in key', () => {
      expect(instantiateStrategy('DoesNotExist')).toBeInstanceOf(Balanced)
    })

    it('falls back to Balanced for a dangling custom pin', () => {
      // Definition was deleted but the pin persists — must not crash.
      expect(instantiateStrategy('custom:gone', { customDefs: [] })).toBeInstanceOf(Balanced)
    })
  })

  describe('key helpers', () => {
    it('round-trips custom keys', () => {
      expect(customKey('abc')).toBe('custom:abc')
      expect(isCustomKey('custom:abc')).toBe(true)
      expect(isCustomKey('Balanced')).toBe(false)
    })
  })
})
