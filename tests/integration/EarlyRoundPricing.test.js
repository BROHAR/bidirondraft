import { describe, it, expect, afterEach, vi } from 'vitest'
import { produce } from 'immer'
import { DraftEngine } from '../../src/services/draftEngine.js'
import { setSeed, resetRng } from '../../src/utils/rng.js'
import playersData from '../../src/data/players.json'

// Guards the adaptive calibration against early-round price inflation — the
// user-reported problem this encodes: 12+-team and keeper leagues sold their
// first nominations far above the published book (12-team 1.28x, 14-team
// 1.42x, heavy-keeper 2.1x under the old uniform anchor) because the budget
// anchor multiplied the whole board uniformly, concentrating the surplus on
// the stars nominated first. The power-law reshape sends that surplus to the
// mid/late tiers instead; these bands fail if a future calibration change
// re-concentrates it up top. Ratios are measured against the RAW book
// (players.json) — the values users compare against.

vi.mock('../../src/services/audioService.js', () => ({
  audioService: {
    playTimerWarning: vi.fn(),
    playTimerUrgent: vi.fn(),
    playTadaSound: vi.fn(),
    playChaChingSound: vi.fn()
  }
}))

const rawBook = new Map(playersData.players.map(p => [p.id, p.estimatedValue]))
const rawSorted = [...playersData.players].sort((a, b) => b.estimatedValue - a.estimatedValue)

function baseConfig(overrides = {}) {
  return {
    numberOfTeams: 12,
    budgetPerTeam: 200,
    humanTeamName: 'My Team',
    humanDraftPosition: 0,
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

// Average paid/raw-book ratio over the first `picks` sales of real players
// (raw book >= $20 — the names users recognize), pooled across seeds.
function earlySaleRatio(config, seeds = [11, 22, 33], picks = 15) {
  const ratios = []
  for (const seed of seeds) {
    setSeed(seed)
    const store = createStore()
    const engine = new DraftEngine(store)
    engine.initializeDraft(config, playersData, { simulate: true })
    for (const pick of store.getState().draftHistory.slice(0, picks)) {
      const raw = rawBook.get(pick.player.id) ?? 0
      if (raw >= 20) ratios.push(pick.price / raw)
    }
  }
  expect(ratios.length).toBeGreaterThan(10)
  return ratios.reduce((s, x) => s + x, 0) / ratios.length
}

describe('Early-round pricing stays near the published book', () => {
  afterEach(() => { resetRng() })

  it('10-team league (book-calibrated size) sells early picks near book', () => {
    const avg = earlySaleRatio(baseConfig({ numberOfTeams: 10 }))
    expect(avg).toBeGreaterThan(0.9)
    expect(avg).toBeLessThan(1.16)
  }, 60000)

  it('12-team league early premium stays modest', () => {
    const avg = earlySaleRatio(baseConfig())
    expect(avg).toBeLessThan(1.25) // was 1.28 under the uniform anchor
  }, 60000)

  it('14-team league early premium stays modest', () => {
    const avg = earlySaleRatio(baseConfig({ numberOfTeams: 14 }))
    expect(avg).toBeLessThan(1.33) // was 1.42 under the uniform anchor
  }, 60000)

  it('heavy keeper league (24 keepers @60% book) does not explode early prices', () => {
    const keepers = rawSorted.slice(0, 24).map((p, i) => ({
      teamPosition: (i % 12) + 1,
      playerId: p.id,
      name: p.name,
      position: p.position,
      price: Math.max(1, Math.round(p.estimatedValue * 0.6)),
    }))
    const avg = earlySaleRatio(baseConfig({ keepers }))
    // Was 2.11 under the uniform anchor. The bound moved 1.55 -> 1.75 with
    // the calibration's $1-tail-floor fix: the old transform "paid for" a low
    // early premium by parking budget on hundreds of tail players at $4+ each
    // (which then sold at value late — the "never bottoms out to $1" bug).
    // With the tail pinned at $1 that money is genuinely in the room. This
    // league's money/remaining-book ratio is ~1.85, so early sales at ~1.7x
    // raw book are still BELOW the room's average inflation — the reshape
    // keeps routing surplus to the mid tiers, which is the invariant guarded.
    expect(avg).toBeLessThan(1.75)
  }, 60000)
})
