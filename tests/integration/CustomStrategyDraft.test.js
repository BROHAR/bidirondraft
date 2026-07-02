import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { produce } from 'immer'
import { DraftEngine } from '../../src/services/draftEngine.js'
import { setSeed, resetRng } from '../../src/utils/rng.js'
import playersData from '../../src/data/players.json'

// Exercises a user-authored custom strategy through the real draft engine end to
// end: pinned on AI teams via config.customStrategies + aiTeamStrategies, and a
// dangling pin (definition deleted) that must fall back to Balanced rather than
// crash. Real AIManager + strategies; only audio is stubbed.
vi.mock('../../src/services/audioService.js', () => ({
  audioService: {
    playTimerWarning: vi.fn(),
    playTimerUrgent: vi.fn(),
    playTadaSound: vi.fn(),
    playChaChingSound: vi.fn(),
  },
}))

const REQUIRED = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 }

function baseConfig(overrides = {}) {
  return {
    numberOfTeams: 12,
    budgetPerTeam: 200,
    humanTeamName: 'My Team',
    humanDraftPosition: 0, // every team is AI-driven
    minBidIncrement: 1,
    nominationTimer: 20,
    biddingTimer: 20,
    autoPilotEnabled: false,
    scoringFormat: 'halfPPR',
    rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 },
    ...overrides,
  }
}

function createStore() {
  let state = {
    teams: [], availablePlayers: [], config: {}, draftState: 'SETUP',
    currentNominator: null, currentPlayer: null, currentBid: 0,
    currentBidder: null, timeRemaining: 0, draftHistory: [],
  }
  return { getState: () => state, setState: (fn) => { state = produce(state, fn) } }
}

function rosterCounts(team) {
  const c = {}
  for (const p of team.roster) c[p.position] = (c[p.position] || 0) + 1
  return c
}

function expectAllTeamsComplete(teams) {
  for (const team of teams) {
    const counts = rosterCounts(team)
    for (const [pos, need] of Object.entries(REQUIRED)) {
      expect(
        counts[pos] || 0,
        `${team.name} (${team.draftStrategy?.constructor.name}) has ${counts[pos] || 0} ${pos}, needs ${need}`
      ).toBeGreaterThanOrEqual(need)
    }
  }
}

function runSimulatedDraft(config) {
  const store = createStore()
  const engine = new DraftEngine(store)
  engine.initializeDraft(config, playersData, { simulate: true })
  return store.getState().teams
}

describe('Custom strategy — full simulated draft', () => {
  beforeEach(() => { vi.useRealTimers() })
  afterEach(() => { vi.restoreAllMocks(); resetRng() })

  const customDef = {
    id: 'agg-zero',
    name: 'Aggressive Zero RB',
    baseKey: 'ZeroRB',
    positionMultipliers: { QB: 1.0, RB: 0.6, WR: 1.25, TE: 1.15, K: 0.85, DST: 0.85 },
    skipProbability: 0.06,
  }

  it('a pinned custom strategy completes a legal draft and is actually used', () => {
    const aiTeamStrategies = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? 'custom:agg-zero' : 'Mixed'))
    for (let i = 0; i < 4; i++) {
      setSeed(7000 + i)
      const teams = runSimulatedDraft(baseConfig({
        aiTeamStrategies,
        customStrategies: [customDef],
      }))
      expectAllTeamsComplete(teams)
      // The custom strategy was instantiated (clone of ZeroRB, flagged isCustom).
      const customTeams = teams.filter(t => t.draftStrategy?.isCustom)
      expect(customTeams.length).toBeGreaterThan(0)
      expect(customTeams[0].draftStrategy.customId).toBe('agg-zero')
    }
  }, 60000)

  it('a dangling custom pin (deleted definition) falls back to Balanced without crashing', () => {
    const aiTeamStrategies = Array.from({ length: 12 }, () => 'custom:gone')
    setSeed(7100)
    const teams = runSimulatedDraft(baseConfig({
      aiTeamStrategies,
      customStrategies: [], // the referenced definition no longer exists
    }))
    expectAllTeamsComplete(teams)
    expect(teams.every(t => t.draftStrategy && !t.draftStrategy.isCustom)).toBe(true)
  }, 60000)
})
