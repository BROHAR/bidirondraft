import { describe, it, expect } from 'vitest'
import { buildPoolEntries } from '../../../src/utils/playerPoolView.js'

function mkPlayer(id, name = id) {
  return { id, name, position: 'RB', team: 'KC', estimatedValue: 10 }
}

function mkPick(player, team = 'Team 2', price = 12) {
  return { player, team, price, nominator: 'Team 1', timestamp: 1 }
}

describe('buildPoolEntries', () => {
  const a = mkPlayer('a')
  const b = mkPlayer('b')
  const c = mkPlayer('c')

  it('returns only available players when showDrafted is off (default behavior)', () => {
    const entries = buildPoolEntries([a, b], [mkPick(c)], false)
    expect(entries.map(e => e.player.id)).toEqual(['a', 'b'])
    expect(entries.every(e => e.drafted === false)).toBe(true)
  })

  it('appends drafted players with sale info when showDrafted is on', () => {
    const entries = buildPoolEntries([a], [mkPick(b, 'Ringers', 37), mkPick(c, 'Team 3', 5)], true)
    expect(entries.map(e => e.player.id)).toEqual(['a', 'b', 'c'])
    const draftedB = entries.find(e => e.player.id === 'b')
    expect(draftedB).toMatchObject({ drafted: true, soldTo: 'Ringers', soldPrice: 37 })
    const availableA = entries.find(e => e.player.id === 'a')
    expect(availableA).toMatchObject({ drafted: false, soldTo: null, soldPrice: null })
  })

  it('never duplicates a player who is back in the pool (undone pick)', () => {
    // After an undo, the player is in availablePlayers but may still have a
    // stale history entry mid-update; the available row must win.
    const entries = buildPoolEntries([a, b], [mkPick(b)], true)
    expect(entries.filter(e => e.player.id === 'b')).toHaveLength(1)
    expect(entries.find(e => e.player.id === 'b').drafted).toBe(false)
  })

  it('includes no-bid picks and tolerates malformed history entries', () => {
    const entries = buildPoolEntries([], [mkPick(c, 'No Bids', 0), null, { team: 'X', price: 1 }], true)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ drafted: true, soldTo: 'No Bids', soldPrice: 0 })
  })

  it('returns an empty list for an empty pool with the toggle off', () => {
    expect(buildPoolEntries([], [mkPick(a)], false)).toEqual([])
  })
})
