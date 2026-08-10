import { describe, it, expect } from 'vitest'
import { applyProjectionSource, PROJECTION_SOURCES } from '../../../src/utils/projectionSource.js'

const ESPN = { standard: 100, halfPPR: 110, ppr: 120 }
const FP = { standard: 90, halfPPR: 95, ppr: 100 }

const pool = () => ({
  players: [
    { id: 'a', name: 'Covered Player', position: 'RB', projectedPoints: ESPN, projectedPointsFP: FP },
    { id: 'b', name: 'ESPN Only', position: 'WR', projectedPoints: ESPN },
  ],
})

describe('applyProjectionSource', () => {
  it('returns the pool unchanged for the espn source', () => {
    const data = pool()
    expect(applyProjectionSource(data, 'espn')).toBe(data)
  })

  it('swaps projectedPoints to the FantasyPros block under fantasyPros', () => {
    const swapped = applyProjectionSource(pool(), 'fantasyPros')
    expect(swapped.players[0].projectedPoints).toEqual(FP)
  })

  it('falls back to ESPN points for players without FantasyPros data', () => {
    const swapped = applyProjectionSource(pool(), 'fantasyPros')
    expect(swapped.players[1].projectedPoints).toEqual(ESPN)
  })

  it('does not mutate the source pool', () => {
    const data = pool()
    applyProjectionSource(data, 'fantasyPros')
    expect(data.players[0].projectedPoints).toEqual(ESPN)
  })

  it('exposes the two known sources', () => {
    expect(PROJECTION_SOURCES).toEqual(['espn', 'fantasyPros'])
  })
})
