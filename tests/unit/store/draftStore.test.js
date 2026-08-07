import { describe, it, expect, beforeEach, vi } from 'vitest'

// The store holds the engine in a module-level variable; mock the engine class
// so these tests exercise the store's undo/cancel logic (state reverts, timer
// coordination calls, nominator rewind) without live timers or AI.
vi.mock('../../../src/services/draftEngine.js', () => {
  class MockDraftEngine {
    constructor() {
      MockDraftEngine.lastInstance = this
      this.currentNominatorIndex = 0
      this.initializeDraft = vi.fn()
      this.dispose = vi.fn()
      this.clearTimers = vi.fn()
      this.startNominationPhase = vi.fn()
    }
  }
  return { DraftEngine: MockDraftEngine }
})

vi.mock('../../../src/services/aiManager.js', () => ({
  AIManager: vi.fn().mockImplementation(function () {}),
}))

import { useDraftStore } from '../../../src/store/draftStore.js'
import { DraftEngine } from '../../../src/services/draftEngine.js'
import { Team } from '../../../src/models/Team.js'
import { Player } from '../../../src/models/Player.js'

const CONFIG = {
  numberOfTeams: 3,
  budgetPerTeam: 200,
  humanTeamName: 'My Team',
  humanDraftPosition: 1,
  minBidIncrement: 1,
  nominationTimer: 20,
  biddingTimer: 20,
  rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 },
}

// Real Player instances, matching the app: immer never drafts (or freezes)
// class instances, so the engine/store mutate them in place across produce
// calls — a plain object here would end up frozen and hide real behavior.
function mkPlayer(id, estimatedValue = 40) {
  return new Player({ id, name: id, position: 'RB', team: 'KC', estimatedValue, byeWeek: 7, projectedPoints: 200 })
}

// Mirror the mutations completeBidding performs for a sale won by `team`.
function applySale(teams, team, player, price) {
  player.purchasePrice = price
  team.roster.push(player)
  team.remainingBudget -= price
  const value = player.estimatedValue - price
  team.recentBidOutcomes.push({ won: true, value, price, player })
  team.momentum = 'winning'
  for (const t of teams) {
    if (t !== team && !t.isHuman) {
      t.recentBidOutcomes.push({ won: false, value, price, player })
    }
  }
  return { player, team: team.name, nominator: team.name, price, timestamp: 1 }
}

// Boot the store with a mocked engine, one completed sale (soldPlayer to
// Team 2 for $25) and one player left in the pool.
function seedDraft(stateOverrides = {}) {
  useDraftStore.getState().initializeDraft(CONFIG, { players: [] })
  const engine = DraftEngine.lastInstance
  engine.currentNominatorIndex = 4

  const teams = [
    new Team('team_1', 'My Team', true, CONFIG),
    new Team('team_2', 'Team 2', false, CONFIG),
    new Team('team_3', 'Team 3', false, CONFIG),
  ]
  const soldPlayer = mkPlayer('sold_rb')
  const poolPlayer = mkPlayer('pool_rb', 30)
  const entry = applySale(teams, teams[1], soldPlayer, 25)

  useDraftStore.setState({
    draftState: 'NOMINATING',
    teams,
    availablePlayers: [poolPlayer],
    draftHistory: [entry],
    currentNominator: null,
    currentPlayer: null,
    currentBid: 0,
    currentBidder: null,
    timeRemaining: 0,
    ...stateOverrides,
  })

  return { engine, teams, soldPlayer, poolPlayer }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('draftStore undoLastSale', () => {
  it('returns the player to the pool, refunds the team, and rewinds the turn', () => {
    const { engine, teams, soldPlayer } = seedDraft()

    useDraftStore.getState().undoLastSale()

    const state = useDraftStore.getState()
    expect(state.draftHistory).toHaveLength(0)
    expect(state.availablePlayers.map(p => p.id)).toContain('sold_rb')
    expect(teams[1].roster).toHaveLength(0)
    expect(teams[1].remainingBudget).toBe(200)
    expect(teams[1].recentBidOutcomes).toHaveLength(0)
    expect(soldPlayer.purchasePrice).toBeNull()
    expect(state.draftState).toBe('NOMINATING')
    // Timers/AI callbacks cancelled, turn rewound, nomination loop re-kicked.
    expect(engine.clearTimers).toHaveBeenCalled()
    expect(engine.currentNominatorIndex).toBe(3)
    expect(engine.startNominationPhase).toHaveBeenCalledTimes(1)
  })

  it('also cancels an auction already in progress (player never duplicated)', () => {
    const { engine, poolPlayer } = seedDraft()
    // The next auction is live: poolPlayer is on the block (it stays in
    // availablePlayers until a sale completes).
    useDraftStore.setState({
      draftState: 'BIDDING',
      currentPlayer: poolPlayer,
      currentBid: 12,
      currentBidder: 'team_3',
      currentNominator: 'team_3',
    })

    useDraftStore.getState().undoLastSale()

    const state = useDraftStore.getState()
    expect(state.currentPlayer).toBeNull()
    expect(state.currentBid).toBe(0)
    expect(state.currentBidder).toBeNull()
    expect(state.draftState).toBe('NOMINATING')
    expect(state.availablePlayers.filter(p => p.id === 'pool_rb')).toHaveLength(1)
    expect(state.availablePlayers.map(p => p.id)).toContain('sold_rb')
    expect(engine.startNominationPhase).toHaveBeenCalledTimes(1)
  })

  it('supports repeated undos, newest pick first', () => {
    const { engine, teams } = seedDraft()
    const second = mkPlayer('second_rb', 20)
    const secondEntry = applySale(teams, teams[2], second, 9)
    useDraftStore.setState({
      draftHistory: [...useDraftStore.getState().draftHistory, secondEntry],
    })

    useDraftStore.getState().undoLastSale()
    expect(useDraftStore.getState().draftHistory.map(e => e.player.id)).toEqual(['sold_rb'])
    expect(teams[2].remainingBudget).toBe(200)

    useDraftStore.getState().undoLastSale()
    expect(useDraftStore.getState().draftHistory).toHaveLength(0)
    expect(teams[1].remainingBudget).toBe(200)
    expect(engine.currentNominatorIndex).toBe(2)
    expect(useDraftStore.getState().availablePlayers.map(p => p.id))
      .toEqual(expect.arrayContaining(['pool_rb', 'second_rb', 'sold_rb']))
  })

  it('stays paused when undoing while PAUSED', () => {
    const { engine } = seedDraft({ draftState: 'PAUSED' })

    useDraftStore.getState().undoLastSale()

    expect(useDraftStore.getState().draftState).toBe('PAUSED')
    expect(useDraftStore.getState().draftHistory).toHaveLength(0)
    // resumeDraft() owns restarting the loop from a pause.
    expect(engine.startNominationPhase).not.toHaveBeenCalled()
  })

  it('is a no-op when there is no pick to undo', () => {
    const { engine } = seedDraft({ draftHistory: [] })

    useDraftStore.getState().undoLastSale()

    expect(engine.clearTimers).not.toHaveBeenCalled()
    expect(engine.startNominationPhase).not.toHaveBeenCalled()
    expect(engine.currentNominatorIndex).toBe(4)
  })

  it('is a no-op once the draft is COMPLETE', () => {
    const { engine, teams } = seedDraft({ draftState: 'COMPLETE' })

    useDraftStore.getState().undoLastSale()

    expect(useDraftStore.getState().draftHistory).toHaveLength(1)
    expect(teams[1].remainingBudget).toBe(175)
    expect(engine.startNominationPhase).not.toHaveBeenCalled()
  })
})

describe('draftStore cancelNomination', () => {
  it('returns the nominated player to the pool without a sale', () => {
    const { engine, poolPlayer } = seedDraft()
    useDraftStore.setState({
      draftState: 'BIDDING',
      currentPlayer: poolPlayer,
      currentBid: 7,
      currentBidder: 'team_2',
      currentNominator: 'team_2',
    })

    useDraftStore.getState().cancelNomination()

    const state = useDraftStore.getState()
    expect(state.currentPlayer).toBeNull()
    expect(state.currentBid).toBe(0)
    expect(state.currentBidder).toBeNull()
    expect(state.draftState).toBe('NOMINATING')
    // No sale: history untouched, player present exactly once in the pool.
    expect(state.draftHistory).toHaveLength(1)
    expect(state.availablePlayers.filter(p => p.id === 'pool_rb')).toHaveLength(1)
    // The same nominator goes again: the turn index never advanced.
    expect(engine.currentNominatorIndex).toBe(4)
    expect(engine.clearTimers).toHaveBeenCalled()
    expect(engine.startNominationPhase).toHaveBeenCalledTimes(1)
  })

  it('stays paused when cancelling a paused mid-auction nomination', () => {
    const { engine, poolPlayer } = seedDraft()
    useDraftStore.setState({
      draftState: 'PAUSED',
      currentPlayer: poolPlayer,
      currentBid: 3,
      currentBidder: 'team_3',
    })

    useDraftStore.getState().cancelNomination()

    expect(useDraftStore.getState().draftState).toBe('PAUSED')
    expect(useDraftStore.getState().currentPlayer).toBeNull()
    expect(engine.startNominationPhase).not.toHaveBeenCalled()
  })

  it('is a no-op when nothing is on the block', () => {
    const { engine } = seedDraft()

    useDraftStore.getState().cancelNomination()

    expect(engine.clearTimers).not.toHaveBeenCalled()
    expect(engine.startNominationPhase).not.toHaveBeenCalled()
    expect(useDraftStore.getState().draftState).toBe('NOMINATING')
  })
})
