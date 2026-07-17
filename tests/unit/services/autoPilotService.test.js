import { describe, it, expect, vi } from 'vitest'
import { AutoPilotService } from '../../../src/services/autoPilotService.js'
import { Team } from '../../../src/models/Team.js'
import { Player } from '../../../src/models/Player.js'

// Minimal team stub — selectNomination only needs canAffordPlayer + isAutoPilot.
function makeTeam({ maxBid = 100 } = {}) {
  return {
    isAutoPilot: true,
    canAffordPlayer: (price) => price <= maxBid
  }
}

describe('AutoPilotService.selectNomination', () => {
  it('falls back to the cheapest available player when no player matches canAffordPlayer', () => {
    const service = new AutoPilotService()
    const stratPick = vi.fn()
    service.currentStrategy = { selectNomination: stratPick }
    const team = makeTeam({ maxBid: 5 })
    const players = [
      { id: 'a', position: 'WR', estimatedValue: 30 },
      { id: 'b', position: 'RB', estimatedValue: 20 },
      { id: 'c', position: 'TE', estimatedValue: 10 }
    ]
    // None affordable (all > $5)
    const pick = service.selectNomination(players, team)
    expect(pick.id).toBe('c') // cheapest by estimatedValue
    expect(stratPick).not.toHaveBeenCalled()
  })

  it('delegates to the strategy when affordable players exist', () => {
    const service = new AutoPilotService()
    const stratPick = vi.fn().mockReturnValue({ id: 'chosen' })
    service.currentStrategy = { selectNomination: stratPick }
    const team = makeTeam({ maxBid: 25 })
    const players = [
      { id: 'a', position: 'WR', estimatedValue: 30 }, // too expensive
      { id: 'b', position: 'RB', estimatedValue: 20 }  // affordable
    ]
    const pick = service.selectNomination(players, team)
    expect(stratPick).toHaveBeenCalledTimes(1)
    expect(stratPick.mock.calls[0][0]).toEqual([{ id: 'b', position: 'RB', estimatedValue: 20 }])
    expect(pick.id).toBe('chosen')
  })

  it('returns null only when the entire available pool is empty', () => {
    const service = new AutoPilotService()
    service.currentStrategy = { selectNomination: vi.fn() }
    const team = makeTeam({ maxBid: 5 })
    expect(service.selectNomination([], team)).toBeNull()
  })

  it('returns null when no strategy is initialized', () => {
    const service = new AutoPilotService()
    const team = makeTeam({ maxBid: 100 })
    expect(service.selectNomination([{ id: 'a', estimatedValue: 1 }], team)).toBeNull()
  })

  it('returns null when the team is not on auto-pilot', () => {
    const service = new AutoPilotService()
    service.currentStrategy = { selectNomination: vi.fn() }
    const team = { isAutoPilot: false, canAffordPlayer: () => true }
    expect(service.selectNomination([{ id: 'a', estimatedValue: 1 }], team)).toBeNull()
  })
})

describe('AutoPilotService positional spend limits', () => {
  // End-to-end through a real strategy: a human auto-pilot team with a
  // config-level positional limit must stop bidding at the cap and never
  // produce a bid amount above it.
  function makeLimitedHuman(limits) {
    const team = new Team('h1', 'Human', true, {
      budgetPerTeam: 200,
      rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 },
      positionalSpendLimits: limits,
    })
    team.isAutoPilot = true
    const service = new AutoPilotService()
    service.initializeStrategy(team, 'Balanced')
    return { team, service }
  }

  const rb = new Player({ id: 'rb1', name: 'Star RB', position: 'RB', team: 'KC', estimatedValue: 60, byeWeek: 7 })

  it('shouldBid drops out at the positional cap', () => {
    const { team, service } = makeLimitedHuman({ RB: 20 })
    expect(service.shouldBid(rb, 20, [rb], team)).toBe(false)
    expect(service.shouldBid(rb, 40, [rb], team)).toBe(false)
  })

  it('calculateBidAmount never exceeds the positional cap', () => {
    const { team, service } = makeLimitedHuman({ RB: 20 })
    for (let i = 0; i < 25; i++) {
      const bid = service.calculateBidAmount(rb, 15, [rb], team)
      expect(bid).toBeLessThanOrEqual(20)
    }
  })

  it('a player value adjustment on the player lifts the cap', () => {
    const { team, service } = makeLimitedHuman({ RB: 20 })
    team.playerValueAdjustments.set(rb.id, 1.5)
    service.applyPlayerValueAdjustments(team)
    // 1.5 × $60 pin = $90 — the strategy stays in well past the $20 limit.
    expect(service.shouldBid(rb, 40, [rb], team)).toBe(true)
  })
})
