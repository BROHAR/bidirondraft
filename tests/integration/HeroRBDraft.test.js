import { describe, it, expect, afterEach, vi } from 'vitest'
import { produce } from 'immer'
import { DraftEngine } from '../../src/services/draftEngine.js'
import { setSeed, resetRng } from '../../src/utils/rng.js'
import playersData from '../../src/data/players.json'

// Hero RB roster-shape invariant: a HeroRB team must actually land its hero —
// one of the top-8 RBs by book value — in the large majority of drafts, and
// must NOT accumulate multiple mid-priced ($15-30) RBs around it. Mirrors the
// persona definition in src/utils/leagueProfile.js (HERO_RB_PRICE /
// HERO_VETO_PRICE): one expensive RB, other RBs cheap.
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

const PLAYER_LIST = Array.isArray(playersData) ? playersData : (playersData.players || [])

const HERO_COHORT_SIZE = 8
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]
const MIN_HERO_RUNS = 6 // hero landed in at least 6 of 8 seeded drafts

function topRBIds() {
  return new Set(
    PLAYER_LIST
      .filter(p => p.position === 'RB')
      .sort((a, b) => b.estimatedValue - a.estimatedValue)
      .slice(0, HERO_COHORT_SIZE)
      .map(p => p.id)
  )
}

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
    // One HeroRB seat against a Balanced field so the assertion isolates the
    // strategy under test.
    aiTeamStrategies: ['HeroRB', ...Array.from({ length: 11 }, () => 'Balanced')]
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

function runSimulatedDraft(seed) {
  setSeed(seed)
  const store = createStore()
  const engine = new DraftEngine(store)
  engine.initializeDraft(makeConfig(), playersData, { simulate: true })
  const { teams, draftHistory } = store.getState()
  return { teams, draftHistory }
}

describe('HeroRB roster shape — lands the hero, skips the mid-RB pile', () => {
  afterEach(() => { resetRng() })

  it('acquires a top-8 RB in most drafts and never stacks expensive RBs', () => {
    const cohort = topRBIds()
    let heroRuns = 0

    for (const seed of SEEDS) {
      const { teams, draftHistory } = runSimulatedDraft(seed)
      const heroTeam = teams.find(t => t.draftStrategy?.constructor?.name === 'HeroRB')
      expect(heroTeam, `seed ${seed}: no HeroRB team found`).toBeTruthy()

      const rbs = heroTeam.roster.filter(p => p.position === 'RB')
      if (rbs.some(p => cohort.has(p.id))) heroRuns++

      // Never two RBs at hero-adjacent prices (leagueProfile HERO_VETO_PRICE):
      // one stud, everything else cheap.
      const expensive = rbs.filter(p => p.purchasePrice >= 25)
      expect(
        expensive.length,
        `seed ${seed}: ${expensive.length} RBs >= $25 (${expensive.map(p => `${p.name} $${p.purchasePrice}`).join(', ')})`
      ).toBeLessThanOrEqual(1)

      // At most one non-cohort RB in the round 2-3 price band while real
      // alternatives still existed — the reported failure mode was several of
      // these instead of a stud. Confined to the first 55% of the draft:
      // later purchases are the sanctioned endgame spend floor draining
      // surplus into whatever gets nominated, not strategy shape.
      const mainPhaseEnd = Math.floor(draftHistory.length * 0.55)
      const midBandPicks = draftHistory.filter((h, i) =>
        i < mainPhaseEnd &&
        h.team === heroTeam.name &&
        h.player.position === 'RB' &&
        !cohort.has(h.player.id) &&
        h.price >= 15 && h.price <= 30
      )
      expect(
        midBandPicks.length,
        `seed ${seed}: ${midBandPicks.length} main-phase mid-band RBs (${midBandPicks.map(h => `${h.player.name} $${h.price}`).join(', ')})`
      ).toBeLessThanOrEqual(1)
    }

    expect(
      heroRuns,
      `hero landed in only ${heroRuns}/${SEEDS.length} drafts`
    ).toBeGreaterThanOrEqual(MIN_HERO_RUNS)
  }, 60000)
})
