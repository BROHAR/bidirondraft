import { describe, it, expect, afterEach, vi } from 'vitest'
import { runMetaSimulation, runMetaSimulationAsync, STRATEGY_DISPLAY } from '../../src/utils/metaSimulation.js'
import { random, resetRng } from '../../src/utils/rng.js'
import playersData from '../../src/data/players.json'

// The meta core imports the real DraftEngine, which imports audioService; stub
// its side effects (no AudioContext under jsdom). Mirrors DraftCompleteness.
vi.mock('../../src/services/audioService.js', () => ({
  audioService: {
    playTimerWarning: vi.fn(),
    playTimerUrgent: vi.fn(),
    playTadaSound: vi.fn(),
    playChaChingSound: vi.fn(),
  },
}))

const CANDIDATES = ['Balanced', 'HeroRB', 'ZeroRB', 'Taco']

function baseConfig(overrides = {}) {
  return {
    numberOfTeams: 12,
    budgetPerTeam: 200,
    humanTeamName: 'My Team',
    humanDraftPosition: 5, // the user sits in a real seat — meta sim rates it
    minBidIncrement: 1,
    nominationTimer: 20,
    biddingTimer: 20,
    scoringFormat: 'halfPPR',
    rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 },
    // The fixed league makeup the user drafts against.
    aiTeamStrategies: ['Balanced', 'ValueHunter', 'StarsAndScrubs', 'ZeroRB', 'HeroRB', 'LateRoundQB', 'Taco'],
    ...overrides,
  }
}

describe('runMetaSimulation (user-perspective integration)', () => {
  afterEach(() => { vi.restoreAllMocks(); resetRng() })

  it('rates each candidate strategy for the user with the expected sample count', () => {
    const result = runMetaSimulation(baseConfig(), playersData, {
      strategies: CANDIDATES, draftsPerStrategy: 3, baseSeed: 4000,
    })

    expect(result.totalDrafts).toBe(CANDIDATES.length * 3)
    expect(result.draftsPerStrategy).toBe(3)
    expect(result.summaries.length).toBe(CANDIDATES.length)

    const byName = Object.fromEntries(result.summaries.map(s => [s.strategyName, s]))
    for (const key of CANDIDATES) {
      const label = STRATEGY_DISPLAY[key]
      expect(byName[label], `strategy ${label} should have a summary`).toBeDefined()
      // Each candidate ran exactly draftsPerStrategy drafts for the user's team.
      expect(byName[label].samples).toBe(3)
      expect(byName[label].starterPoints.mean).toBeGreaterThan(0)
      // Finish rank is within the 12-team league (1..12).
      expect(byName[label].finishRank.mean).toBeGreaterThanOrEqual(1)
      expect(byName[label].finishRank.mean).toBeLessThanOrEqual(12)
    }

    // Ranked by the user's avg starter points, descending.
    for (let i = 1; i < result.summaries.length; i++) {
      expect(result.summaries[i - 1].starterPoints.mean).toBeGreaterThanOrEqual(result.summaries[i].starterPoints.mean)
    }
    expect(result.summaries[0].rank).toBe(1)
    expect(result.ranking[0]).toBe(result.summaries[0].strategyName)
  }, 60000)

  it('records no user rows when there is no human seat', () => {
    const result = runMetaSimulation(baseConfig({ humanDraftPosition: 0 }), playersData, {
      strategies: CANDIDATES, draftsPerStrategy: 2, baseSeed: 4100,
    })
    expect(result.summaries.length).toBe(0)
  }, 60000)

  it('is deterministic for a fixed base seed', () => {
    const opts = { strategies: CANDIDATES, draftsPerStrategy: 2, baseSeed: 7000 }
    const a = runMetaSimulation(baseConfig(), playersData, opts)
    const b = runMetaSimulation(baseConfig(), playersData, opts)
    expect(b.summaries).toEqual(a.summaries)
    expect(b.ranking).toEqual(a.ranking)
  }, 60000)

  it('resets the RNG when done (no seeded generator leaks)', () => {
    runMetaSimulation(baseConfig(), playersData, { strategies: ['Balanced'], draftsPerStrategy: 2, baseSeed: 9000 })
    expect(random()).not.toBe(random())
  }, 60000)

  it('async runner matches the sync runner for the same seed', async () => {
    const opts = { strategies: CANDIDATES, draftsPerStrategy: 2, baseSeed: 5000 }
    const sync = runMetaSimulation(baseConfig(), playersData, opts)
    const asyncResult = await runMetaSimulationAsync(baseConfig(), playersData, { ...opts, batchSize: 2 })
    expect(asyncResult.summaries).toEqual(sync.summaries)
    expect(asyncResult.ranking).toEqual(sync.ranking)
  }, 60000)

  it('async runner honors cancellation (stops early)', async () => {
    let calls = 0
    const result = await runMetaSimulationAsync(baseConfig(), playersData, {
      strategies: CANDIDATES,
      draftsPerStrategy: 10,
      baseSeed: 6000,
      batchSize: 1,
      onProgress: () => { calls += 1 },
      shouldCancel: () => calls >= 2, // cancel after 2 drafts complete
    })
    expect(calls).toBeLessThan(CANDIDATES.length * 10)
    expect(result.summaries.length).toBeGreaterThan(0)
  }, 60000)
})
