import { describe, it, expect, afterEach, vi } from 'vitest'
import { produce } from 'immer'
import { DraftEngine } from '../../src/services/draftEngine.js'
import { setSeed, resetRng } from '../../src/utils/rng.js'
import playersData from '../../src/data/players.json'

// User report: "at some point the AI bots seem to bid the value, which also
// doesn't bottom out to $1. Maybe it's because I have deeper lineups (3 flex)
// and 3 keepers." Root cause: the calibration's pure-multiply reshape
// (level × book^gamma) lifted the ENTIRE tail of the board to `level`
// dollars — $4+ in keeper/deep-lineup leagues — so end-of-board players
// displayed $4-7 book values, the AI's sub-$4 scrub pricing never engaged,
// and late sales sat at "value" instead of $1. The affine transform
// (scale × (1 + a·(book^gamma − 1))) pins a $1 book player at $1; these
// seeded runs guard the floor and the resulting late-draft price collapse.

vi.mock('../../src/services/audioService.js', () => ({
  audioService: {
    playTimerWarning: vi.fn(),
    playTimerUrgent: vi.fn(),
    playTadaSound: vi.fn(),
    playChaChingSound: vi.fn()
  }
}))

const rawBook = new Map(playersData.players.map(p => [p.id, p.estimatedValue]))
const byValue = [...playersData.players].sort((a, b) => b.estimatedValue - a.estimatedValue)

// The reporting user's league shape: 12 teams, 3-deep FLEX, 3 keepers per
// team kept at a realistic ~60% of book.
function deepKeeperConfig() {
  const keepers = []
  let idx = 8 // keep ranks 9-44: stars, but leave the very top on the board
  for (let t = 1; t <= 12; t++) {
    for (let k = 0; k < 3; k++) {
      const p = byValue[idx++]
      keepers.push({
        teamPosition: t, playerId: p.id, name: p.name, position: p.position,
        price: Math.max(1, Math.round(p.estimatedValue * 0.6)),
      })
    }
  }
  return {
    numberOfTeams: 12,
    budgetPerTeam: 200,
    humanTeamName: 'My Team',
    humanDraftPosition: 0, // all-AI league
    minBidIncrement: 1,
    nominationTimer: 20,
    biddingTimer: 20,
    autoPilotEnabled: false,
    scoringFormat: 'halfPPR',
    rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 3, K: 1, DST: 1, BENCH: 6 },
    keepers,
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

describe('Late-draft prices bottom out (deep lineups + keepers)', () => {
  afterEach(() => { resetRng() })

  it('calibration keeps raw-$1 players at $1 book instead of lifting the tail', () => {
    setSeed(42)
    const store = createStore()
    const engine = new DraftEngine(store)
    engine.initializeDraft(deepKeeperConfig(), playersData)
    engine.dispose()
    const pool = store.getState().availablePlayers
    // K/DST are excluded: applyKDstTiering deliberately lifts the top few to
    // $2-3 (Yahoo prices every K/DST at $1, so points are the only signal).
    const tail = pool.filter(p =>
      (rawBook.get(p.id) ?? 0) <= 1 && p.position !== 'K' && p.position !== 'DST')
    expect(tail.length).toBeGreaterThan(50) // the deep tail exists
    for (const p of tail) {
      expect(p.estimatedValue, `${p.name} tail value`).toBeLessThanOrEqual(1.05)
    }
  })

  it('end-of-draft sales collapse to $1-2 instead of selling at book', () => {
    for (const seed of [1234, 777]) {
      setSeed(seed)
      const store = createStore()
      const engine = new DraftEngine(store)
      engine.initializeDraft(deepKeeperConfig(), playersData, { simulate: true })
      const state = store.getState()
      const hist = state.draftHistory

      const lastQuarter = hist.slice(Math.floor(hist.length * 0.75))
      expect(lastQuarter.length).toBeGreaterThan(20)
      const cheap = lastQuarter.filter(h => h.price <= 2).length
      expect(cheap / lastQuarter.length,
        `seed ${seed}: share of last-quarter sales at <= $2`
      ).toBeGreaterThanOrEqual(0.6)

      // The very end of the board is $1 territory, not "bid the value".
      const lastTen = hist.slice(-10)
      const dollarSales = lastTen.filter(h => h.price <= 1).length
      expect(dollarSales, `seed ${seed}: $1 sales in the last 10 picks`)
        .toBeGreaterThanOrEqual(7)

      // Bottoming out must not come from stranded money: teams still spend.
      for (const t of state.teams) {
        expect(t.remainingBudget, `seed ${seed}: ${t.name} leftover`)
          .toBeLessThanOrEqual(200 * 0.10)
      }
    }
  }, 60000)
})
