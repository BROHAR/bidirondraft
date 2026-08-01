import { describe, it, expect, afterEach, vi } from 'vitest'
import { produce } from 'immer'
import { DraftEngine } from '../../src/services/draftEngine.js'
import { setSeed, resetRng } from '../../src/utils/rng.js'
import { getTotalValueCapture } from '../../src/utils/draftAnalysis.js'
import playersData from '../../src/data/players.json'

// Value Hunter identity invariant: across seeded drafts it must actually
// capture value — roster book value at or above what it paid — and clearly
// beat a Balanced field at that metric. Guards the walk-away ceilings, slot
// discipline, and scraps-harvest design (see ValueHunter.js comments);
// regressions here historically came from markup-based valuations or from
// hoarding cash into the endgame flush machinery.
//
// Runs are seeded via the shared sim RNG, so results are deterministic.

vi.mock('../../src/services/audioService.js', () => ({
  audioService: {
    playTimerWarning: vi.fn(),
    playTimerUrgent: vi.fn(),
    playTadaSound: vi.fn(),
    playChaChingSound: vi.fn()
  }
}))

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

function makeConfig() {
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
    aiTeamStrategies: ['ValueHunter', ...Array.from({ length: 11 }, () => 'Balanced')]
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

describe('ValueHunter — ends drafts with value captured', () => {
  afterEach(() => { resetRng() })

  it('captures value overall and beats the Balanced field average', () => {
    const vhCaptures = []
    const fieldAverages = []

    for (const seed of SEEDS) {
      setSeed(seed)
      const store = createStore()
      const engine = new DraftEngine(store)
      engine.initializeDraft(makeConfig(), playersData, { simulate: true })
      const teams = store.getState().teams

      const vh = teams.find(t => t.draftStrategy?.constructor?.name === 'ValueHunter')
      expect(vh, `seed ${seed}: no ValueHunter team found`).toBeTruthy()
      vhCaptures.push(getTotalValueCapture(vh))

      const field = teams.filter(t => t !== vh)
      fieldAverages.push(field.reduce((s, t) => s + getTotalValueCapture(t), 0) / field.length)
    }

    const vhAvg = vhCaptures.reduce((s, v) => s + v, 0) / vhCaptures.length
    const fieldAvg = fieldAverages.reduce((s, v) => s + v, 0) / fieldAverages.length
    const positives = vhCaptures.filter(v => v > 0).length

    // Bands calibrated against measured values (avg +13.4, field -8.9,
    // positive 10/12) with headroom for RNG-stream shifts from unrelated
    // changes. A real regression (markup valuations, cash hoarding) sends
    // the average to -10..-20 and positives to 1-3, far outside these.
    const detail = `avg $${vhAvg.toFixed(1)}, field $${fieldAvg.toFixed(1)}, positive ${positives}/${SEEDS.length}, per-seed [${vhCaptures.map(v => Math.round(v)).join(', ')}]`
    expect(vhAvg, detail).toBeGreaterThanOrEqual(0)
    expect(vhAvg - fieldAvg, detail).toBeGreaterThanOrEqual(10)
    expect(positives, detail).toBeGreaterThanOrEqual(7)
  }, 120000)
})
