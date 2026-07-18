import { describe, it, expect, afterEach, vi } from 'vitest'
import { produce } from 'immer'
import { DraftEngine } from '../../src/services/draftEngine.js'
import { setSeed, resetRng } from '../../src/utils/rng.js'
import playersData from '../../src/data/players.json'

// Budget spend-down invariant: an auction league's money should clear. After a
// full AI-driven draft, the overwhelming majority of teams must have spent
// effectively their whole budget, and nobody may strand a meaningful fraction.
//
// Thresholds (per product decision):
//   - "full spend" = remainingBudget <= 2% of budget (auctions can't land
//     exactly $0 — the winner pays one increment over the runner-up, and the
//     forced K/DST close leaves a dollar or two of crumbs in small leagues)
//   - >= 80% of teams pooled across runs must full-spend
//   - no single team in any run may keep more than 10% of its budget
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

const LEAGUE_SIZES = [8, 10, 12, 14]
const BUDGETS = [200, 100, 1000]
const SEEDS = [1, 2, 3]

const FULL_SPEND_PCT = 0.02 // remaining <= 2% of budget counts as fully spent
const MIN_FULL_SPEND_SHARE = 0.8 // >= 80% of pooled teams must fully spend
const MAX_LEFTOVER_PCT = 0.10 // nobody keeps more than 10%

function makeConfig(numberOfTeams, budgetPerTeam) {
  return {
    numberOfTeams,
    budgetPerTeam,
    humanTeamName: 'My Team',
    humanDraftPosition: 0, // 0 → no human team; every team is AI-driven
    minBidIncrement: 1,
    nominationTimer: 20,
    biddingTimer: 20,
    autoPilotEnabled: false,
    scoringFormat: 'halfPPR',
    rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 }
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

function runSimulatedDraft(config, seed) {
  setSeed(seed)
  const store = createStore()
  const engine = new DraftEngine(store)
  engine.initializeDraft(config, playersData, { simulate: true })
  return store.getState().teams
}

describe('Budget spend-down — teams do not strand budget', () => {
  afterEach(() => { resetRng() })

  for (const budgetPerTeam of BUDGETS) {
    for (const numberOfTeams of LEAGUE_SIZES) {
      it(`$${budgetPerTeam} budget, ${numberOfTeams}-team league`, () => {
        let fullSpend = 0
        let total = 0

        for (const seed of SEEDS) {
          const teams = runSimulatedDraft(makeConfig(numberOfTeams, budgetPerTeam), seed)
          for (const team of teams) {
            total++
            if (team.remainingBudget <= budgetPerTeam * FULL_SPEND_PCT) fullSpend++
            // Hard per-team bound: nobody strands >10% in any run.
            expect(
              team.remainingBudget,
              `${team.name} (${team.draftStrategy?.constructor.name}, seed ${seed}) kept $${team.remainingBudget} of $${budgetPerTeam} (> ${MAX_LEFTOVER_PCT * 100}%)`
            ).toBeLessThanOrEqual(budgetPerTeam * MAX_LEFTOVER_PCT)
          }
        }

        // Pooled across seeds: >= 80% of teams spend out entirely.
        expect(
          fullSpend / total,
          `only ${fullSpend}/${total} teams fully spent (<= $${budgetPerTeam * FULL_SPEND_PCT} left)`
        ).toBeGreaterThanOrEqual(MIN_FULL_SPEND_SHARE)
      }, 30000) // 3 full simulated drafts; large-league/$1000 configs exceed the 5s default
    }
  }

  // An active imported-league profile (hoarding at the clamp ceiling plus
  // value reshaping) must not break the spend invariants — the factors are
  // bounded and pre-anchor precisely so the money still clears.
  it('$200, 12-team league with an active hoarding league profile', () => {
    const leagueProfile = {
      version: 1,
      positionFactors: { QB: 1.16, RB: 1.1, WR: 0.9, TE: 0.97, K: 1.0, DST: 1.0 },
      tierFactors: [
        { min: 35, factor: 1.1 }, { min: 20, factor: 0.95 }, { min: 10, factor: 1.0 },
        { min: 4, factor: 1.02 }, { min: 0, factor: 1.0 },
      ],
      lateInflation: 1.5,
    }
    let fullSpend = 0
    let total = 0
    for (const seed of SEEDS) {
      const teams = runSimulatedDraft({ ...makeConfig(12, 200), leagueProfile }, seed)
      for (const team of teams) {
        total++
        if (team.remainingBudget <= 200 * FULL_SPEND_PCT) fullSpend++
        expect(
          team.remainingBudget,
          `${team.name} (seed ${seed}) kept $${team.remainingBudget} with active profile`
        ).toBeLessThanOrEqual(200 * MAX_LEFTOVER_PCT)
      }
    }
    expect(fullSpend / total).toBeGreaterThanOrEqual(MIN_FULL_SPEND_SHARE)
  }, 30000)
})
