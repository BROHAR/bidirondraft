import { describe, it, expect, vi } from 'vitest'
import { AutoPilotService } from '../../../src/services/autoPilotService.js'

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
