import { describe, it, expect, afterEach, vi } from 'vitest'
import { produce } from 'immer'
import { DraftEngine } from '../../src/services/draftEngine.js'
import { setSeed, resetRng } from '../../src/utils/rng.js'
import playersData from '../../src/data/players.json'

// User report: "Even though I don't have kickers or defense selected as a
// position for my league, they still get nominated in the auction... allowed
// on a team's bench because there isn't necessarily a starting spot for him."
// Positions with zero startable slots must be excluded from the draft
// universe entirely: not in the available pool, never nominated, never on a
// roster. These seeded full drafts guard that end-to-end.

vi.mock('../../src/services/audioService.js', () => ({
  audioService: {
    playTimerWarning: vi.fn(),
    playTimerUrgent: vi.fn(),
    playTadaSound: vi.fn(),
    playChaChingSound: vi.fn()
  }
}))

function baseConfig(overrides = {}) {
  return {
    numberOfTeams: 10,
    budgetPerTeam: 200,
    humanTeamName: 'My Team',
    humanDraftPosition: 0, // all-AI league
    minBidIncrement: 1,
    nominationTimer: 20,
    biddingTimer: 20,
    autoPilotEnabled: false,
    scoringFormat: 'halfPPR',
    // No K, no DST — 3-deep FLEX league (the reporting user's shape).
    rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 3, K: 0, DST: 0, BENCH: 6 },
    ...overrides
  }
}

function createStore() {
  let state = {
    teams: [], availablePlayers: [], config: {}, draftState: 'SETUP',
    currentNominator: null, currentPlayer: null, currentBid: 0,
    currentBidder: null, timeRemaining: 0, draftHistory: []
  }
  return { getState: () => state, setState: (fn) => { state = produce(state, fn) } }
}

function runSimulatedDraft(config) {
  const store = createStore()
  const engine = new DraftEngine(store)
  engine.initializeDraft(config, playersData, { simulate: true })
  return store.getState()
}

const isKdst = p => p.position === 'K' || p.position === 'DST'

describe('Positions without starting slots are excluded from the draft', () => {
  afterEach(() => { resetRng() })

  it('K/DST never enter the pool, a nomination, or a roster (no-K/DST league)', () => {
    for (const seed of [99, 1717]) {
      setSeed(seed)
      const state = runSimulatedDraft(baseConfig())
      expect(state.availablePlayers.filter(isKdst)).toHaveLength(0)
      expect(state.draftHistory.filter(h => isKdst(h.player))).toHaveLength(0)
      for (const team of state.teams) {
        expect(team.roster.filter(isKdst), `${team.name} rostered a K/DST`).toHaveLength(0)
        // The draft still completes: every roster spot filled.
        expect(team.getRosterSpotsRemaining(), `${team.name} unfilled spots`).toBe(0)
      }
    }
  }, 60000)

  it('holds even in an all-Taco league (the K/DST-stacking strategy)', () => {
    setSeed(4242)
    const state = runSimulatedDraft(baseConfig({
      aiTeamStrategies: Array.from({ length: 10 }, () => 'Taco'),
    }))
    expect(state.availablePlayers.filter(isKdst)).toHaveLength(0)
    expect(state.draftHistory.filter(h => isKdst(h.player))).toHaveLength(0)
    for (const team of state.teams) {
      expect(team.roster.filter(isKdst), `${team.name} rostered a K/DST`).toHaveLength(0)
    }
  }, 60000)

  it('a standard league with K/DST slots still drafts them', () => {
    setSeed(31)
    const state = runSimulatedDraft(baseConfig({
      rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 },
    }))
    for (const team of state.teams) {
      expect(team.roster.some(p => p.position === 'K'), `${team.name} has a K`).toBe(true)
      expect(team.roster.some(p => p.position === 'DST'), `${team.name} has a DST`).toBe(true)
    }
  }, 60000)
})
