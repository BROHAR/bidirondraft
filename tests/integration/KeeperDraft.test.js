import { describe, it, expect, afterEach, vi } from 'vitest'
import { produce } from 'immer'
import { DraftEngine } from '../../src/services/draftEngine.js'
import { runSingleDraft } from '../../src/utils/metaSimulation.js'
import { setSeed, resetRng } from '../../src/utils/rng.js'
import playersData from '../../src/data/players.json'

// Keeper-league drafts: keepers are pre-completed purchases applied at init,
// with the value anchor netted to the money and slots actually in the auction.
// These seeded runs assert the two economic invariants the redraft suites
// enforce (roster completeness, budget spend-down) still hold with keepers,
// plus the keeper-specific init semantics.

vi.mock('../../src/services/audioService.js', () => ({
  audioService: {
    playTimerWarning: vi.fn(),
    playTimerUrgent: vi.fn(),
    playTadaSound: vi.fn(),
    playChaChingSound: vi.fn()
  }
}))

const REQUIRED = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, DST: 1 }

function baseConfig(overrides = {}) {
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

function runSimulatedDraft(config) {
  const store = createStore()
  const engine = new DraftEngine(store)
  engine.initializeDraft(config, playersData, { simulate: true })
  return store.getState()
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

// Top players by book value at a position, from the raw data file.
const byValue = [...playersData.players].sort((a, b) => b.estimatedValue - a.estimatedValue)
const topAt = (pos, n) => byValue.filter(p => p.position === pos).slice(0, n)

const asKeeper = (player, teamPosition, price) => ({
  teamPosition,
  playerId: player.id,
  name: player.name,
  position: player.position,
  price,
})

// Realistic keeper spread: four teams keep 1-2 stars at a discount to book.
function standardKeepers() {
  const [rb1, rb2] = topAt('RB', 2)
  const [wr1, wr2] = topAt('WR', 2)
  const [qb1] = topAt('QB', 1)
  const [te1] = topAt('TE', 1)
  return [
    asKeeper(rb1, 1, 35),
    asKeeper(wr1, 1, 30),
    asKeeper(rb2, 2, 28),
    asKeeper(wr2, 3, 22),
    asKeeper(qb1, 4, 15),
    asKeeper(te1, 4, 12),
  ]
}

describe('Keeper draft — init semantics', () => {
  afterEach(() => { vi.useRealTimers(); resetRng() })

  // Initialize the live (non-sim) path but never advance timers: the state
  // right after initializeDraft is the pre-auction keeper state.
  function initOnly(config) {
    vi.useFakeTimers()
    const store = createStore()
    const engine = new DraftEngine(store)
    engine.initializeDraft(config, playersData)
    engine.dispose()
    return store.getState()
  }

  it('moves keepers onto rosters with price, budget, and pool removal', () => {
    setSeed(42)
    const keepers = standardKeepers()
    const state = initOnly(baseConfig({ keepers }))

    for (const k of keepers) {
      const team = state.teams[k.teamPosition - 1]
      const onRoster = team.roster.find(p => p.id === k.playerId)
      expect(onRoster, `${k.name} on team ${k.teamPosition}`).toBeTruthy()
      expect(onRoster.purchasePrice).toBe(k.price)
      expect(onRoster.isKeeper).toBe(true)
      expect(state.availablePlayers.some(p => p.id === k.playerId)).toBe(false)
    }
    const team1 = state.teams[0]
    expect(team1.remainingBudget).toBe(200 - 35 - 30)
    expect(team1.roster).toHaveLength(2)
    // Keepers are not auction results.
    expect(state.draftHistory).toHaveLength(0)
  })

  it('anchor inflation: discounted keepers raise remaining board values', () => {
    setSeed(42)
    const noKeepers = initOnly(baseConfig())
    setSeed(42)
    // Every team keeps one top-12 player at $1 — ~massive discount, so the
    // money left in the room far exceeds the removed book value.
    const cheapKeepers = byValue.slice(0, 12).map((p, i) => asKeeper(p, i + 1, 1))
    const withKeepers = initOnly(baseConfig({ keepers: cheapKeepers }))

    // Compare a mid-tier player present in both pools.
    const probe = noKeepers.availablePlayers
      .filter(p => withKeepers.availablePlayers.some(q => q.id === p.id))
      .sort((a, b) => b.estimatedValue - a.estimatedValue)[30]
    const inflated = withKeepers.availablePlayers.find(p => p.id === probe.id)
    expect(inflated.estimatedValue).toBeGreaterThan(probe.estimatedValue)
  })

  it('no-keeper config leaves init identical to a redraft league', () => {
    setSeed(7)
    const a = initOnly(baseConfig())
    setSeed(7)
    const b = initOnly(baseConfig({ keepers: [] }))
    expect(a.availablePlayers.map(p => [p.id, p.estimatedValue]))
      .toEqual(b.availablePlayers.map(p => [p.id, p.estimatedValue]))
    expect(a.teams.map(t => t.remainingBudget)).toEqual(b.teams.map(t => t.remainingBudget))
  })
})

describe('Keeper draft — completeness and spend-down invariants', () => {
  afterEach(() => { resetRng() })

  it('every team fills required starters with a realistic keeper spread', () => {
    for (let i = 0; i < 3; i++) {
      setSeed(5000 + i)
      const state = runSimulatedDraft(baseConfig({ keepers: standardKeepers() }))
      expectAllTeamsComplete(state.teams)
      // Keepers stayed put through the draft.
      expect(state.teams[0].roster.filter(p => p.isKeeper)).toHaveLength(2)
      expect(state.draftHistory.some(pick => pick.player.isKeeper)).toBe(false)
    }
  }, 60000)

  it('keeper teams still spend down their remaining budget', () => {
    for (let i = 0; i < 2; i++) {
      setSeed(6000 + i)
      const state = runSimulatedDraft(baseConfig({ keepers: standardKeepers() }))
      const budget = 200
      const leftovers = state.teams.map(t => t.remainingBudget)
      const fullSpend = leftovers.filter(v => v <= budget * 0.02).length
      expect(fullSpend / state.teams.length,
        `full-spenders with keepers (leftovers: ${leftovers.join(',')})`
      ).toBeGreaterThanOrEqual(0.8)
      for (const t of state.teams) {
        expect(t.remainingBudget, `${t.name} leftover`).toBeLessThanOrEqual(budget * 0.10)
      }
    }
  }, 60000)

  it('survives heavy keeper inflation (12 stars kept at $1)', () => {
    setSeed(7000)
    const cheapKeepers = byValue.slice(0, 12).map((p, i) => asKeeper(p, i + 1, 1))
    const state = runSimulatedDraft(baseConfig({ keepers: cheapKeepers }))
    expectAllTeamsComplete(state.teams)
    for (const t of state.teams) {
      expect(t.remainingBudget, `${t.name} leftover`).toBeLessThanOrEqual(20)
    }
  }, 60000)

  it('handles kept K/DST without breaking endgame reservation math', () => {
    setSeed(8000)
    const [dst] = topAt('DST', 1)
    const [k] = topAt('K', 1)
    const keepers = [asKeeper(dst, 1, 2), asKeeper(k, 1, 1), ...standardKeepers().slice(2)]
    const state = runSimulatedDraft(baseConfig({ keepers }))
    expectAllTeamsComplete(state.teams)
  }, 60000)
})

// User report: "Is there a way to make the draft sim include keepers? It
// doesn't seem to be." The simulated-draft paths all funnel through
// DraftEngine.initializeDraft (covered above); this block proves the same
// end-to-end keeper semantics through the META-SIM entry point
// (runSingleDraft — the per-draft core used by both the worker and the
// main-thread fallback), including a human seat with keepers.
describe('Keeper draft — keepers flow through the meta-sim path', () => {
  afterEach(() => { resetRng() })

  it('runSingleDraft applies keepers to rosters, budgets, and the pool', () => {
    const keepers = standardKeepers()
    const config = baseConfig({ keepers, humanDraftPosition: 1, humanTeamName: 'Me' })
    const { teams, availablePlayers } = runSingleDraft(config, playersData, 12345)

    for (const k of keepers) {
      const team = teams[k.teamPosition - 1]
      const onRoster = team.roster.find(p => p.id === k.playerId)
      expect(onRoster, `${k.name} kept by ${team.name}`).toBeTruthy()
      expect(onRoster.purchasePrice).toBe(k.price)
      expect(onRoster.isKeeper).toBe(true)
      expect(availablePlayers.some(p => p.id === k.playerId)).toBe(false)
    }
    // The human seat (team 1) kept two players and its auction spend came out
    // of the keeper-reduced budget.
    const me = teams[0]
    expect(me.isHuman).toBe(true)
    expect(me.roster.filter(p => p.isKeeper)).toHaveLength(2)
    const auctionSpend = me.roster
      .filter(p => !p.isKeeper)
      .reduce((s, p) => s + (p.purchasePrice || 0), 0)
    expect(auctionSpend + 35 + 30 + me.remainingBudget).toBe(200)
    // Draft completed for every team.
    for (const t of teams) {
      expect(t.getRosterSpotsRemaining(), `${t.name} unfilled spots`).toBe(0)
    }
  }, 60000)
})

// Strategy audit: no built-in personality may degenerate when its roster
// starts pre-filled by keepers (e.g. HeroRB already holding an elite RB, or
// ZeroRB handed one). One seeded all-<strategy> league each, with the
// standard keeper spread.
describe('Keeper draft — every built-in strategy stays draftable', () => {
  afterEach(() => { resetRng() })

  const STRATEGY_KEYS = ['StarsAndScrubs', 'Balanced', 'ZeroRB', 'HeroRB', 'ValueHunter', 'LateRoundQB', 'Taco']

  it.each(STRATEGY_KEYS)('%s league completes with keepers', (key) => {
    setSeed(9000 + STRATEGY_KEYS.indexOf(key))
    const state = runSimulatedDraft(baseConfig({
      keepers: standardKeepers(),
      aiTeamStrategies: Array.from({ length: 12 }, () => key),
    }))
    expectAllTeamsComplete(state.teams)
    for (const t of state.teams) {
      expect(t.remainingBudget, `${t.name} leftover`).toBeLessThanOrEqual(200 * 0.10)
    }
  }, 60000)
})
