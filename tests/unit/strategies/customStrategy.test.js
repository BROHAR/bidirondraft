import { describe, it, expect } from 'vitest'
import { createCustomStrategy } from '../../../src/strategies/customStrategy.js'
import { ZeroRB } from '../../../src/strategies/ZeroRB.js'
import { Balanced } from '../../../src/strategies/Balanced.js'
import { Team } from '../../../src/models/Team.js'
import { Player } from '../../../src/models/Player.js'

const config = {
  budgetPerTeam: 200,
  rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 },
}

describe('createCustomStrategy (clone-and-tweak)', () => {
  it('clones the base class, keeping its instanceof and method overrides', () => {
    const s = createCustomStrategy({ id: 'a', name: 'My ZeroRB', baseKey: 'ZeroRB' })
    expect(s).toBeInstanceOf(ZeroRB)
    expect(s.name).toBe('My ZeroRB')
    expect(s.isCustom).toBe(true)
    expect(s.customId).toBe('a')
  })

  it('merges position multipliers over the base preset', () => {
    const s = createCustomStrategy({
      id: 'b', name: 'Tweaked', baseKey: 'ZeroRB',
      positionMultipliers: { RB: 0.5, WR: 1.3 },
    })
    expect(s.preferences.positionMultipliers.RB).toBe(0.5)
    expect(s.preferences.positionMultipliers.WR).toBe(1.3)
    // Untouched positions retain the base preset's values.
    expect(s.preferences.positionMultipliers.QB).toBe(new ZeroRB().preferences.positionMultipliers.QB)
  })

  it('overrides skip probability when provided, inherits otherwise', () => {
    const overridden = createCustomStrategy({ id: 'c', name: 'X', baseKey: 'ZeroRB', skipProbability: 0.33 })
    expect(overridden.getSkipProbability()).toBe(0.33)

    const inherited = createCustomStrategy({ id: 'd', name: 'Y', baseKey: 'ZeroRB' })
    expect(inherited.getSkipProbability()).toBe(new ZeroRB().getSkipProbability())
  })

  it('preserves the base strategy\'s signature bidding behavior', () => {
    // ZeroRB refuses premium RBs in evaluateBid — a clone must still refuse.
    const s = createCustomStrategy({ id: 'e', name: 'Z', baseKey: 'ZeroRB' })
    const team = new Team('t1', 'T', false, config)
    team.setStrategy(s)
    const premiumRB = new Player({ id: 'rb', name: 'Stud RB', position: 'RB', team: 'KC', estimatedValue: 40, byeWeek: 7 })
    expect(s.evaluateBid(premiumRB, 5, 40, [premiumRB])).toBe(false)
  })

  it('applies a home team only to a Taco clone', () => {
    const taco = createCustomStrategy({ id: 'f', name: 'Homer', baseKey: 'Taco', homeTeam: 'DAL' })
    expect(taco.preferences.homeTeam).toBe('DAL')

    const zero = createCustomStrategy({ id: 'g', name: 'NoHome', baseKey: 'ZeroRB', homeTeam: 'DAL' })
    expect(zero.preferences.homeTeam).toBeUndefined()
  })

  it('falls back to Balanced for an unknown baseKey', () => {
    expect(createCustomStrategy({ id: 'h', name: 'Fallback', baseKey: 'Nope' })).toBeInstanceOf(Balanced)
  })
})
