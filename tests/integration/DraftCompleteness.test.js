import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { produce } from 'immer'
import { DraftEngine } from '../../src/services/draftEngine.js'
import playersData from '../../src/data/players.json'

// timerWorker is unavailable under jsdom, so workerTimers falls back to native
// timers, which vi.useFakeTimers() drives — letting us run the real-time
// (non-sim) draft loop deterministically.

// Real AIManager + real strategies are intentionally NOT mocked here — this
// test exercises the actual nomination/bidding logic end to end. Only the
// audio side effects are stubbed.
vi.mock('../../src/services/audioService.js', () => ({
  audioService: {
    playTimerWarning: vi.fn(),
    playTimerUrgent: vi.fn(),
    playTadaSound: vi.fn(),
    playChaChingSound: vi.fn()
  }
}))

// Required *starting* positions every team must end the draft with. FLEX,
// SUPERFLEX and BENCH are not position-specific, so they're excluded.
const REQUIRED = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 }

function baseConfig(overrides = {}) {
  return {
    numberOfTeams: 12,
    budgetPerTeam: 200,
    humanTeamName: 'My Team',
    humanDraftPosition: 0, // 0 → no human team; every team is AI-driven
    minBidIncrement: 1,
    nominationTimer: 20,
    biddingTimer: 20,
    autoPilotEnabled: false,
    scoringFormat: 'halfPPR',
    rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 },
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

function rosterCounts(team) {
  const c = {}
  for (const p of team.roster) c[p.position] = (c[p.position] || 0) + 1
  return c
}

function runSimulatedDraft(config) {
  const store = createStore()
  const engine = new DraftEngine(store)
  engine.initializeDraft(config, playersData, { simulate: true })
  return store.getState().teams
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

describe('Draft completeness — every team fills required starting positions', () => {
  beforeEach(() => { vi.useRealTimers() })
  afterEach(() => { vi.restoreAllMocks() })

  it('fills all required positions across a mixed-strategy league (multiple runs)', () => {
    for (let i = 0; i < 12; i++) {
      const teams = runSimulatedDraft(baseConfig())
      expectAllTeamsComplete(teams)
    }
  })

  it('fills QB and TE even when every team runs Hero RB (the reported failure)', () => {
    const heroRBForAll = Array.from({ length: 12 }, () => 'HeroRB')
    for (let i = 0; i < 8; i++) {
      const teams = runSimulatedDraft(baseConfig({ aiTeamStrategies: heroRBForAll }))
      expectAllTeamsComplete(teams)
    }
  })
})

describe('Draft completeness — real-time (timer-driven) path', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  // Drives the live nomination/bidding loop to completion. A *passive* human
  // (never clicks → every nomination times out) used to end the draft missing a
  // required starter because handleNominationTimeout ignored the mandatory-need
  // reservation. Every team — human included — must finish with a legal roster.
  async function runLiveDraft(config) {
    const store = createStore()
    const engine = new DraftEngine(store)
    engine.initializeDraft(config, playersData) // no { simulate: true } → real-time path
    let guard = 0
    while (store.getState().draftState !== 'COMPLETE' && guard++ < 200000) {
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(store.getState().draftState).toBe('COMPLETE')
    return store.getState().teams
  }

  it('a passive human in a Hero RB league still fills every required position', async () => {
    const heroRBForAll = Array.from({ length: 12 }, () => 'HeroRB')
    for (let i = 0; i < 3; i++) {
      const teams = await runLiveDraft(baseConfig({
        humanDraftPosition: 1, // a real, passive human whose nominations time out
        biddingTimer: 5,
        aiTeamStrategies: heroRBForAll
      }))
      expectAllTeamsComplete(teams)
    }
  }, 60000)
})
