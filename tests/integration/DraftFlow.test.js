import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { produce } from 'immer'
import { DraftEngine } from '../../src/services/draftEngine.js'
import { Player } from '../../src/models/Player.js'

vi.mock('../../src/services/audioService.js', () => ({
  audioService: {
    playTimerWarning: vi.fn(),
    playTimerUrgent: vi.fn(),
    playTadaSound: vi.fn(),
    playChaChingSound: vi.fn()
  }
}))

vi.mock('../../src/services/aiManager.js', () => ({
  AIManager: vi.fn().mockImplementation(function () {
    this.assignStrategies = vi.fn()
    this.getAINomination = vi.fn()
    this.processAIBidding = vi.fn().mockReturnValue(null)
    this.getBiddingDelay = vi.fn().mockReturnValue(1000)
  })
}))

vi.mock('../../src/services/autoPilotService.js', () => ({
  autoPilotService: {
    initializeStrategy: vi.fn(),
    selectNomination: vi.fn(),
    shouldBid: vi.fn().mockReturnValue(false),
    calculateBidAmount: vi.fn()
  }
}))

const smallConfig = {
  numberOfTeams: 2,
  budgetPerTeam: 200,
  humanTeamName: 'My Team',
  humanDraftPosition: 1,
  minBidIncrement: 1,
  nominationTimer: 20,
  biddingTimer: 20,
  autoPilotEnabled: false,
  rosterPositions: { QB: 1, RB: 1 } // 2 spots → 4 total picks
}

const playersData = {
  players: [
    { id: 'p1', name: 'QB Star', position: 'QB', team: 'KC', estimatedValue: 45, byeWeek: 10, projectedPoints: 380 },
    { id: 'p2', name: 'RB Star', position: 'RB', team: 'SF', estimatedValue: 40, byeWeek: 9, projectedPoints: 320 },
    { id: 'p3', name: 'QB Backup', position: 'QB', team: 'DAL', estimatedValue: 20, byeWeek: 7, projectedPoints: 280 },
    { id: 'p4', name: 'RB Backup', position: 'RB', team: 'PHI', estimatedValue: 15, byeWeek: 6, projectedPoints: 220 }
  ]
}

function createMockStore(initial = {}) {
  let state = {
    teams: [],
    availablePlayers: [],
    config: smallConfig,
    draftState: 'SETUP',
    currentNominator: null,
    currentPlayer: null,
    currentBid: 0,
    currentBidder: null,
    timeRemaining: 0,
    draftHistory: [],
    ...initial
  }
  return {
    getState: () => state,
    setState: (fn) => { state = produce(state, fn) }
  }
}

describe('Draft Flow Integration', () => {
  let store
  let engine

  beforeEach(() => {
    vi.useFakeTimers()
    store = createMockStore()
    engine = new DraftEngine(store)
  })

  afterEach(() => {
    engine.clearTimers()
    vi.useRealTimers()
  })

  describe('initializeDraft', () => {
    it('creates teams and populates available players', () => {
      engine.initializeDraft(smallConfig, playersData)
      const state = store.getState()
      expect(state.teams).toHaveLength(2)
      expect(state.availablePlayers).toHaveLength(4)
    })

    it('converts raw player data to Player instances', () => {
      engine.initializeDraft(smallConfig, playersData)
      const players = store.getState().availablePlayers
      expect(players[0]).toBeInstanceOf(Player)
    })

    it('sets draft to NOMINATING state', () => {
      engine.initializeDraft(smallConfig, playersData)
      expect(store.getState().draftState).toBe('NOMINATING')
    })

    it('assigns the human team correctly', () => {
      engine.initializeDraft(smallConfig, playersData)
      const humanTeam = store.getState().teams.find(t => t.isHuman)
      expect(humanTeam).toBeDefined()
      expect(humanTeam.name).toBe('My Team')
    })

    it('generates a nomination order covering all picks', () => {
      engine.initializeDraft(smallConfig, playersData)
      // 2 teams × 2 spots = 4 picks
      expect(engine.nominationOrder).toHaveLength(4)
    })
  })

  describe('bid → complete bidding flow', () => {
    beforeEach(() => {
      engine.initializeDraft(smallConfig, playersData)
      // Manually start an auction on the first player
      const player = store.getState().availablePlayers[0]
      store.setState(draft => {
        draft.currentPlayer = player
        draft.currentBid = 1
        draft.currentBidder = null
        draft.draftState = 'BIDDING'
      })
      engine.biddingTimeRemaining = 20
    })

    it('records a winning bid in state', () => {
      engine.placeBid('team_1', 15)
      expect(store.getState().currentBid).toBe(15)
      expect(store.getState().currentBidder).toBe('team_1')
    })

    it('rejects a bid that does not meet the increment', () => {
      engine.placeBid('team_1', 15)
      const result = engine.placeBid('team_2', 15) // same amount — invalid
      expect(result).toBe(false)
      expect(store.getState().currentBidder).toBe('team_1') // unchanged
    })

    it('completeBidding assigns player to winning team', () => {
      engine.placeBid('team_1', 25)
      engine.completeBidding()

      const state = store.getState()
      const winner = state.teams.find(t => t.id === 'team_1')
      expect(winner.roster).toHaveLength(1)
      expect(winner.roster[0].id).toBe('p1')
      expect(winner.remainingBudget).toBe(175) // 200 - 25
    })

    it('completeBidding removes the player from availablePlayers', () => {
      engine.placeBid('team_1', 25)
      engine.completeBidding()
      const ids = store.getState().availablePlayers.map(p => p.id)
      expect(ids).not.toContain('p1')
    })

    it('completeBidding adds a history entry', () => {
      engine.placeBid('team_1', 25)
      engine.completeBidding()
      const history = store.getState().draftHistory
      expect(history).toHaveLength(1)
      expect(history[0].price).toBe(25)
    })

    it('nominator wins for $1 when no bids are placed', () => {
      store.setState(draft => {
        draft.currentNominator = 'team_2'
      })
      engine.completeBidding()

      const state = store.getState()
      const nominator = state.teams.find(t => t.id === 'team_2')
      expect(nominator.roster).toHaveLength(1)
      expect(nominator.remainingBudget).toBe(199) // 200 - 1
      expect(state.draftHistory[0].price).toBe(1)
    })
  })

  describe('nomination timeout', () => {
    it('auto-nominates the highest value available player', () => {
      engine.initializeDraft(smallConfig, playersData)
      engine.handleNominationTimeout('team_1')
      // p1 has the highest estimatedValue (45)
      expect(store.getState().currentPlayer?.id).toBe('p1')
      expect(store.getState().draftState).toBe('BIDDING')
    })
  })
})
