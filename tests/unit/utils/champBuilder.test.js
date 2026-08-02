import { describe, it, expect, beforeEach } from 'vitest'
import {
  clampBoost, boostedPoints, rosterSizeFor, buildChampEntries,
  estimateFinish, computeChampProjection,
  loadSavedRosters, saveRoster, deleteSavedRoster, resolveSavedRoster,
  MAX_SAVED_ROSTERS, BOOST_MIN, BOOST_MAX,
} from '../../../src/utils/champBuilder.js'

const STORAGE_KEY = 'adraft.champRosters.v1'

const ROSTER_POSITIONS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 }

function poolFixture() {
  const players = [
    { id: 'qb1', name: 'Josh Allen', position: 'QB', team: 'BUF', projectedPoints: 320, avgPrice: 30, timesDrafted: 10, draftRate: 1 },
    { id: 'qb2', name: 'Jalen Hurts', position: 'QB', team: 'PHI', projectedPoints: 300, avgPrice: 25, timesDrafted: 10, draftRate: 1 },
    { id: 'rb1', name: 'Bijan Robinson', position: 'RB', team: 'ATL', projectedPoints: 280, avgPrice: 55, timesDrafted: 10, draftRate: 1 },
    { id: 'wr1', name: 'Justin Jefferson', position: 'WR', team: 'MIN', projectedPoints: 270, avgPrice: 50, timesDrafted: 10, draftRate: 1 },
  ]
  return new Map(players.map(p => [p.id, p]))
}

describe('clampBoost / boostedPoints', () => {
  it('clamps to the allowed range and zeroes junk input', () => {
    expect(clampBoost(50)).toBe(50)
    expect(clampBoost(-500)).toBe(BOOST_MIN)
    expect(clampBoost(9999)).toBe(BOOST_MAX)
    expect(clampBoost('abc')).toBe(0)
    expect(clampBoost(undefined)).toBe(0)
    expect(clampBoost('25')).toBe(25)
  })

  it('scales projections by the boost percentage', () => {
    expect(boostedPoints(200, 0)).toBe(200)
    expect(boostedPoints(200, 10)).toBeCloseTo(220)
    expect(boostedPoints(200, -50)).toBeCloseTo(100)
    expect(boostedPoints(200, -100)).toBe(0)
  })
})

describe('rosterSizeFor', () => {
  it('sums every configured spot including bench', () => {
    expect(rosterSizeFor(ROSTER_POSITIONS)).toBe(15)
    expect(rosterSizeFor({})).toBe(0)
    expect(rosterSizeFor(null)).toBe(0)
  })
})

describe('buildChampEntries', () => {
  it('resolves picks against the pool with boosted points', () => {
    const entries = buildChampEntries(
      [{ id: 'qb1', boostPct: 10 }, { id: 'rb1', boostPct: -25 }],
      poolFixture()
    )
    expect(entries).toHaveLength(2)
    expect(entries[0].name).toBe('Josh Allen')
    expect(entries[0].adjustedPoints).toBeCloseTo(352)
    expect(entries[1].adjustedPoints).toBeCloseTo(210)
    expect(entries[1].avgPrice).toBe(55)
  })

  it('skips picks that are not in the pool', () => {
    const entries = buildChampEntries([{ id: 'ghost', boostPct: 0 }, { id: 'qb1', boostPct: 0 }], poolFixture())
    expect(entries.map(e => e.id)).toEqual(['qb1'])
  })
})

describe('estimateFinish', () => {
  const benchmark = [400, 500, 600, 700] // sorted ascending

  it('projects first place above the whole field', () => {
    const f = estimateFinish(800, benchmark, 12)
    expect(f.expectedRank).toBe(1)
    expect(f.percentile).toBe(1)
    expect(f.winOdds).toBe(1)
  })

  it('projects last place below the whole field', () => {
    const f = estimateFinish(100, benchmark, 12)
    expect(f.expectedRank).toBe(12)
    expect(f.percentile).toBe(0)
    expect(f.winOdds).toBe(0)
  })

  it('projects mid-pack at the field median, splitting ties', () => {
    const f = estimateFinish(550, benchmark, 5)
    expect(f.percentile).toBe(0.5)
    expect(f.expectedRank).toBeCloseTo(3) // 1 + 4 * 0.5
    const tied = estimateFinish(500, benchmark, 5) // one below, one equal
    expect(tied.percentile).toBeCloseTo(0.375)
  })

  it('handles an empty benchmark without dividing by zero', () => {
    const f = estimateFinish(500, [], 12)
    expect(f.expectedRank).toBe(1)
  })
})

describe('computeChampProjection', () => {
  const opts = {
    rosterPositions: { QB: 1, RB: 1, BENCH: 1 },
    numberOfTeams: 4,
    budgetPerTeam: 100,
    benchmark: [400, 500, 600, 700],
  }

  it('totals cost, fills, and starter points from boosted projections', () => {
    const entries = buildChampEntries([{ id: 'qb1', boostPct: 0 }, { id: 'rb1', boostPct: 0 }], poolFixture())
    const p = computeChampProjection(entries, opts)
    expect(p.totalCost).toBe(85)
    expect(p.remainingBudget).toBe(15)
    expect(p.overBudget).toBe(false)
    expect(p.spotsFilled).toBe(2)
    expect(p.rosterSize).toBe(3)
    expect(p.starterPoints).toBeCloseTo(600) // 320 + 280
    expect(p.expectedRank).toBeGreaterThanOrEqual(1)
    expect(p.expectedRank).toBeLessThanOrEqual(4)
  })

  it('benches the weaker boosted QB when only one QB slot exists', () => {
    // qb2 boosted +50% (450 pts) should start over qb1 (320 pts).
    const entries = buildChampEntries([{ id: 'qb1', boostPct: 0 }, { id: 'qb2', boostPct: 50 }], poolFixture())
    const p = computeChampProjection(entries, opts)
    expect(p.starterPoints).toBeCloseTo(450)
    expect(p.benchCount).toBe(1)
  })

  it('flags a roster the budget could not buy', () => {
    const entries = buildChampEntries(
      [{ id: 'qb1', boostPct: 0 }, { id: 'rb1', boostPct: 0 }, { id: 'wr1', boostPct: 0 }],
      poolFixture()
    )
    const p = computeChampProjection(entries, { ...opts, budgetPerTeam: 100 })
    expect(p.totalCost).toBe(135)
    expect(p.overBudget).toBe(true)
  })
})

describe('saved rosters (localStorage)', () => {
  beforeEach(() => { window.localStorage.clear() })

  const entriesFor = (ids) => buildChampEntries(ids.map(id => ({ id, boostPct: 15 })), poolFixture())

  it('round-trips a saved roster with boosts, without prices', () => {
    const saved = saveRoster('My Champs', entriesFor(['qb1', 'rb1']))
    expect(saved).toHaveLength(1)
    const loaded = loadSavedRosters()
    expect(loaded[0].name).toBe('My Champs')
    expect(loaded[0].players).toEqual([
      { id: 'qb1', name: 'Josh Allen', position: 'QB', team: 'BUF', boostPct: 15 },
      { id: 'rb1', name: 'Bijan Robinson', position: 'RB', team: 'ATL', boostPct: 15 },
    ])
  })

  it('overwrites a roster saved under the same name', () => {
    saveRoster('Champs', entriesFor(['qb1']))
    const updated = saveRoster('Champs', entriesFor(['rb1']))
    expect(updated).toHaveLength(1)
    expect(loadSavedRosters()[0].players[0].id).toBe('rb1')
  })

  it('caps saves at MAX_SAVED_ROSTERS and rejects the overflow', () => {
    for (let i = 0; i < MAX_SAVED_ROSTERS; i++) {
      expect(saveRoster(`Roster ${i}`, entriesFor(['qb1']))).not.toBeNull()
    }
    expect(saveRoster('One too many', entriesFor(['qb1']))).toBeNull()
    expect(loadSavedRosters()).toHaveLength(MAX_SAVED_ROSTERS)
  })

  it('rejects empty names', () => {
    expect(saveRoster('   ', entriesFor(['qb1']))).toBeNull()
  })

  it('deletes by name', () => {
    saveRoster('A', entriesFor(['qb1']))
    saveRoster('B', entriesFor(['rb1']))
    expect(deleteSavedRoster('A').map(r => r.name)).toEqual(['B'])
    expect(loadSavedRosters().map(r => r.name)).toEqual(['B'])
  })

  it('survives corrupt storage', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadSavedRosters()).toEqual([])
    window.localStorage.setItem(STORAGE_KEY, '{"an":"object"}')
    expect(loadSavedRosters()).toEqual([])
  })

  it('resolves a saved roster against a new pool and reports missing players', () => {
    saveRoster('Champs', entriesFor(['qb1', 'rb1']))
    const [saved] = loadSavedRosters()
    const shrunkenPool = new Map([['qb1', poolFixture().get('qb1')]])
    const { selection, missing } = resolveSavedRoster(saved, shrunkenPool)
    expect(selection).toEqual([{ id: 'qb1', boostPct: 15 }])
    expect(missing).toEqual(['Bijan Robinson'])
  })
})
