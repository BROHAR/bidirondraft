import { describe, it, expect, beforeEach, vi } from 'vitest'
import { produce } from 'immer'
import { DraftEngine } from '../../../src/services/draftEngine.js'
import { Player } from '../../../src/models/Player.js'
import { autoPilotService } from '../../../src/services/autoPilotService.js'

vi.mock('../../../src/services/audioService.js', () => ({
  audioService: {
    playTimerWarning: vi.fn(),
    playTimerUrgent: vi.fn(),
    playTadaSound: vi.fn(),
    playChaChingSound: vi.fn()
  }
}))

vi.mock('../../../src/services/aiManager.js', () => ({
  AIManager: vi.fn().mockImplementation(function () {
    this.assignStrategies = vi.fn()
    this.getAINomination = vi.fn()
    this.processAIBidding = vi.fn().mockReturnValue(null)
    this.getBiddingDelay = vi.fn().mockReturnValue(1000)
  })
}))

vi.mock('../../../src/services/autoPilotService.js', () => ({
  autoPilotService: {
    initializeStrategy: vi.fn(),
    selectNomination: vi.fn(),
    shouldBid: vi.fn().mockReturnValue(false),
    calculateBidAmount: vi.fn()
  }
}))

const defaultConfig = {
  numberOfTeams: 4,
  budgetPerTeam: 200,
  humanTeamName: 'My Team',
  humanDraftPosition: 1,
  minBidIncrement: 1,
  nominationTimer: 20,
  biddingTimer: 20,
  autoPilotEnabled: false,
  rosterPositions: { QB: 1, RB: 1, WR: 1 } // 3 spots → 12 total picks for 4 teams
}

function createMockStore(initial = {}) {
  let state = {
    teams: [],
    availablePlayers: [],
    config: defaultConfig,
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

function makePlayers(n = 12) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${i}`,
    position: ['QB', 'RB', 'WR'][i % 3],
    team: 'KC',
    estimatedValue: 30 - i,
    byeWeek: 7,
    projectedPoints: 200 - i * 5
  }))
}

describe('DraftEngine', () => {
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

  describe('applyKDstTiering', () => {
    // Yahoo's salary-cap projections report every K and DST at $1, so without
    // a tiering pass the top kicker goes for the same $1 as the worst on the
    // board. The tiering uses projectedPoints (real spread within position) to
    // bump the top 3 of each so they actually go for $2–3 in auction.

    function mkPlayer(id, position, projectedPoints, estimatedValue = 1) {
      return { id, name: id, position, projectedPoints, estimatedValue }
    }

    it('bumps the top 3 K by projectedPoints to $3/$2/$2 and leaves the rest at $1', () => {
      const players = [
        mkPlayer('k1', 'K', 170),
        mkPlayer('k2', 'K', 160),
        mkPlayer('k3', 'K', 150),
        mkPlayer('k4', 'K', 140),
        mkPlayer('k5', 'K', 130)
      ]
      engine.applyKDstTiering(players)
      expect(players.find(p => p.id === 'k1').estimatedValue).toBe(3)
      expect(players.find(p => p.id === 'k2').estimatedValue).toBe(2)
      expect(players.find(p => p.id === 'k3').estimatedValue).toBe(2)
      expect(players.find(p => p.id === 'k4').estimatedValue).toBe(1)
      expect(players.find(p => p.id === 'k5').estimatedValue).toBe(1)
    })

    it('tiers DST the same way, independently of K', () => {
      const players = [
        mkPlayer('d1', 'DST', 180),
        mkPlayer('d2', 'DST', 170),
        mkPlayer('d3', 'DST', 160),
        mkPlayer('d4', 'DST', 150),
        mkPlayer('k1', 'K', 170)
      ]
      engine.applyKDstTiering(players)
      expect(players.find(p => p.id === 'd1').estimatedValue).toBe(3)
      expect(players.find(p => p.id === 'd2').estimatedValue).toBe(2)
      expect(players.find(p => p.id === 'd3').estimatedValue).toBe(2)
      expect(players.find(p => p.id === 'd4').estimatedValue).toBe(1)
      // K is tiered too but DST tiering didn't interfere.
      expect(players.find(p => p.id === 'k1').estimatedValue).toBe(3)
    })

    it('never deflates a K whose pre-tier estimatedValue is already above the tier', () => {
      const players = [
        mkPlayer('k1', 'K', 170, 4), // already $4, tier would set $3
        mkPlayer('k2', 'K', 160, 1)
      ]
      engine.applyKDstTiering(players)
      expect(players.find(p => p.id === 'k1').estimatedValue).toBe(4) // Math.max preserved
      expect(players.find(p => p.id === 'k2').estimatedValue).toBe(2)
    })

    it('does not touch non-K/DST positions', () => {
      const players = [
        mkPlayer('qb1', 'QB', 200, 1),
        mkPlayer('wr1', 'WR', 180, 1)
      ]
      engine.applyKDstTiering(players)
      expect(players.find(p => p.id === 'qb1').estimatedValue).toBe(1)
      expect(players.find(p => p.id === 'wr1').estimatedValue).toBe(1)
    })
  })

  describe('league-size value calibration (budget anchor)', () => {
    // The top-(totalSpots) players are the ones that actually get drafted, so
    // their estimatedValue should sum to ≈ the total auction budget — otherwise
    // realized prices can't track estimatedValue on average. Regression guard
    // for the inflate-only bug: in small leagues raw book exceeded the budget,
    // the anchor refused to scale down, and the surplus book forced systematic
    // below-estimate sales (mid-tier players selling for $1).
    const sumTopN = (players, n) =>
      [...players].sort((a, b) => b.estimatedValue - a.estimatedValue)
        .slice(0, n).reduce((s, p) => s + p.estimatedValue, 0)

    const poolOf = (count, valueAt) =>
      Array.from({ length: count }, (_, i) => ({
        id: `p${i}`, name: `P${i}`, position: ['QB', 'RB', 'WR'][i % 3],
        team: 'KC', estimatedValue: valueAt(i), byeWeek: 7, projectedPoints: 300 - i
      }))

    it('deflates an over-budget pool so top-(totalSpots) book ≈ total budget', () => {
      // 12 teams (top-60 tilt is neutral here) × $100 = $1200, 3 spots each → 36
      // drafted. A pool worth ~$58 each sums far above the budget; the old
      // inflate-only anchor left it at ~1.7× budget.
      const config = { ...defaultConfig, numberOfTeams: 12, budgetPerTeam: 100, rosterPositions: { QB: 1, RB: 1, WR: 1 } }
      engine.initializeDraft(config, { players: poolOf(40, i => 60 - (i % 5)) })
      const sum = sumTopN(store.getState().availablePlayers, 36)
      expect(sum).toBeGreaterThan(1200 * 0.92)
      expect(sum).toBeLessThan(1200 * 1.08)
    })

    it('still inflates an under-budget pool up to the total budget', () => {
      const config = { ...defaultConfig, numberOfTeams: 12, budgetPerTeam: 200, rosterPositions: { QB: 1, RB: 1, WR: 1 } }
      engine.initializeDraft(config, { players: poolOf(40, i => 10 - (i % 3)) })
      const sum = sumTopN(store.getState().availablePlayers, 36)
      expect(sum).toBeGreaterThan(2400 * 0.92)
      expect(sum).toBeLessThan(2400 * 1.08)
    })
  })

  describe('createTeams', () => {
    it('creates the correct number of teams', () => {
      const teams = engine.createTeams(defaultConfig)
      expect(teams).toHaveLength(4)
    })

    it('assigns the human team at the correct position', () => {
      const teams = engine.createTeams(defaultConfig)
      expect(teams[0].isHuman).toBe(true)
      expect(teams[0].name).toBe('My Team')
    })

    it('marks all other teams as AI', () => {
      const teams = engine.createTeams(defaultConfig)
      const aiTeams = teams.filter(t => !t.isHuman)
      expect(aiTeams).toHaveLength(3)
    })

    it('names AI teams sequentially', () => {
      const teams = engine.createTeams(defaultConfig)
      expect(teams[1].name).toBe('Team 2')
      expect(teams[3].name).toBe('Team 4')
    })

    it('respects humanDraftPosition other than 1', () => {
      const teams = engine.createTeams({ ...defaultConfig, humanDraftPosition: 3 })
      expect(teams[2].isHuman).toBe(true)
      expect(teams[0].isHuman).toBe(false)
    })
  })

  describe('generateNominationOrder', () => {
    it('produces the correct total number of picks', () => {
      const teams = engine.createTeams(defaultConfig)
      const order = engine.generateNominationOrder(teams, defaultConfig.rosterPositions)
      // 4 teams × 3 roster spots = 12 picks
      expect(order).toHaveLength(12)
    })

    it('starts with forward order in round 0', () => {
      const teams = engine.createTeams(defaultConfig)
      const order = engine.generateNominationOrder(teams, defaultConfig.rosterPositions)
      // First 4 picks: team_1, team_2, team_3, team_4
      expect(order.slice(0, 4)).toEqual(['team_1', 'team_2', 'team_3', 'team_4'])
    })

    it('repeats forward order in subsequent rounds (no snake reversal)', () => {
      const teams = engine.createTeams(defaultConfig)
      const order = engine.generateNominationOrder(teams, defaultConfig.rosterPositions)
      // Round 1 (picks 5-8): team_1, team_2, team_3, team_4 (same as round 0)
      expect(order.slice(4, 8)).toEqual(['team_1', 'team_2', 'team_3', 'team_4'])
    })

    it('every team appears the same number of times', () => {
      const teams = engine.createTeams(defaultConfig)
      const order = engine.generateNominationOrder(teams, defaultConfig.rosterPositions)
      teams.forEach(t => {
        const count = order.filter(id => id === t.id).length
        expect(count).toBe(3) // 3 roster spots per team
      })
    })
  })

  describe('placeBid', () => {
    beforeEach(() => {
      const teams = engine.createTeams(defaultConfig)
      // placeBid only accepts bids during a live auction, so the fixture
      // needs a player on the block.
      const onBlock = new Player(makePlayers(1)[0])
      store.setState(draft => {
        draft.teams = teams
        draft.currentBid = 5
        draft.currentPlayer = onBlock
        draft.config = defaultConfig
        draft.draftState = 'BIDDING'
      })
      engine.biddingTimeRemaining = 20
    })

    it('accepts a valid bid and updates state', () => {
      const result = engine.placeBid('team_1', 6)
      expect(result).toBe(true)
      expect(store.getState().currentBid).toBe(6)
      expect(store.getState().currentBidder).toBe('team_1')
    })

    it('rejects a bid below the minimum increment', () => {
      const result = engine.placeBid('team_1', 5) // same as current, needs +1
      expect(result).toBe(false)
      expect(store.getState().currentBid).toBe(5)
    })

    it('rounds bid amounts to whole numbers', () => {
      engine.placeBid('team_1', 6.7)
      expect(store.getState().currentBid).toBe(7)
    })

    it('resets timer to 5 when placed with 3 seconds remaining', () => {
      engine.biddingTimeRemaining = 3
      engine.placeBid('team_1', 6)
      expect(engine.biddingTimeRemaining).toBe(5)
      expect(store.getState().timeRemaining).toBe(5)
    })

    it('does not reset timer when more than 5 seconds remain', () => {
      engine.biddingTimeRemaining = 15
      engine.placeBid('team_1', 6)
      expect(engine.biddingTimeRemaining).toBe(15)
    })

    it('rejects a bid that exceeds the team maxBid', () => {
      const team = store.getState().teams.find(t => t.id === 'team_1')
      team.remainingBudget = 10 // 3 spots → reserve 2 → maxBid = 8
      const result = engine.placeBid('team_1', 50)
      expect(result).toBe(false)
      expect(store.getState().currentBid).toBe(5)
      expect(store.getState().currentBidder).toBeNull()
    })

    it('rejects any bid from a team with $0 remaining budget', () => {
      const team = store.getState().teams.find(t => t.id === 'team_1')
      team.remainingBudget = 0
      const result = engine.placeBid('team_1', 6)
      expect(result).toBe(false)
      expect(store.getState().currentBid).toBe(5)
    })

    it('rejects a bid from an unknown team id', () => {
      const result = engine.placeBid('team_does_not_exist', 6)
      expect(result).toBe(false)
    })
  })

  describe('startNominationPhase nomination skipping', () => {
    it('skips a nominator that is out of funds and advances to the next team', () => {
      const teams = engine.createTeams(defaultConfig)
      teams[0].remainingBudget = 0 // team_1 out of funds
      store.setState(draft => {
        draft.teams = teams
        draft.config = defaultConfig
      })
      engine.nominationOrder = ['team_1', 'team_2', 'team_3', 'team_4']
      engine.currentNominatorIndex = 0

      engine.startNominationPhase()

      expect(engine.currentNominatorIndex).toBe(1)
      expect(store.getState().currentNominator).toBe('team_2')
    })

    it('skips multiple consecutive out-of-funds nominators', () => {
      const teams = engine.createTeams(defaultConfig)
      teams[0].remainingBudget = 0
      teams[1].remainingBudget = 0
      store.setState(draft => {
        draft.teams = teams
        draft.config = defaultConfig
      })
      engine.nominationOrder = ['team_1', 'team_2', 'team_3', 'team_4']
      engine.currentNominatorIndex = 0

      engine.startNominationPhase()

      expect(engine.currentNominatorIndex).toBe(2)
      expect(store.getState().currentNominator).toBe('team_3')
    })
  })

  describe('startNominationPhase overflow', () => {
    // Once the seeded nominationOrder is exhausted, the live path used to call
    // completeDraft() unconditionally — leaving teams with unfilled rosters if
    // any of their earlier turns got skipped. Now it round-robins among teams
    // that can still bid, matching simulateDraft().

    it('round-robins through remaining-bid-capable teams after the seeded order ends', () => {
      const teams = engine.createTeams(defaultConfig)
      // team_1 and team_3 are full; team_2 and team_4 still need players
      teams[0].roster = [{}, {}, {}]
      teams[2].roster = [{}, {}, {}]
      store.setState(draft => {
        draft.teams = teams
        draft.config = defaultConfig
      })
      engine.nominationOrder = ['team_1', 'team_2', 'team_3', 'team_4']
      engine.currentNominatorIndex = 4 // exhausted

      engine.startNominationPhase()
      expect(store.getState().currentNominator).toBe('team_2')
      expect(store.getState().draftState).toBe('NOMINATING')

      engine.currentNominatorIndex++ // simulate completeBidding's advance
      engine.startNominationPhase()
      expect(store.getState().currentNominator).toBe('team_4')

      engine.currentNominatorIndex++
      engine.startNominationPhase()
      expect(store.getState().currentNominator).toBe('team_2') // wraps
    })

    it('completes the draft only when no team can still bid', () => {
      const teams = engine.createTeams(defaultConfig)
      // Every team is full
      teams.forEach(t => { t.roster = [{}, {}, {}] })
      store.setState(draft => {
        draft.teams = teams
        draft.config = defaultConfig
      })
      engine.nominationOrder = ['team_1', 'team_2', 'team_3', 'team_4']
      engine.currentNominatorIndex = 4

      engine.startNominationPhase()
      expect(store.getState().draftState).toBe('COMPLETE')
    })
  })

  describe('position-fit guards', () => {
    // Without these guards, live drafts can end with all roster slots filled by
    // count but a K/DST/etc. slot showing empty because the only player in that
    // slot is of a different position. simulateDraft already enforces these.

    // QB/RB/K are mandatory; BENCH slots provide slack so an empty team is NOT
    // automatically restricted. This isolates the "team's last slots are
    // mandatory-only" condition we want to test.
    const slackConfig = {
      ...defaultConfig,
      rosterPositions: { QB: 1, RB: 1, K: 1, BENCH: 2 } // 5 total, 3 mandatory
    }
    const mkPlayer = (id, position, estimatedValue = 30) =>
      new Player({ id, name: id, position, team: 'KC', estimatedValue, byeWeek: 5 })

    describe('nominationPoolFor', () => {
      it('restricts the pool when remaining slots equal remaining mandatory needs', () => {
        const teams = engine.createTeams(slackConfig)
        const team = teams[0]
        // 4 of 5 slots filled, K still needed, 1 spot left
        team.roster = [mkPlayer('q', 'QB'), mkPlayer('r', 'RB'), mkPlayer('w', 'WR'), mkPlayer('t', 'TE')]
        const pool = [mkPlayer('k1', 'K'), mkPlayer('te1', 'TE'), mkPlayer('k2', 'K', 20)]
        const restricted = engine.nominationPoolFor(team, pool)
        expect(restricted.map(p => p.position)).toEqual(['K', 'K'])
      })

      it('returns the full pool when remaining slots exceed mandatory needs', () => {
        const teams = engine.createTeams(slackConfig) // empty team, 5 spots, 3 mandatory needs
        const team = teams[0]
        const pool = [mkPlayer('a', 'WR'), mkPlayer('b', 'TE')]
        expect(engine.nominationPoolFor(team, pool)).toBe(pool)
      })

      it('falls back to the full pool when the restricted pool is empty', () => {
        const teams = engine.createTeams(slackConfig)
        const team = teams[0]
        // 1 spot left, K still needed, but no K available
        team.roster = [mkPlayer('q', 'QB'), mkPlayer('r', 'RB'), mkPlayer('w', 'WR'), mkPlayer('t', 'TE')]
        const pool = [mkPlayer('a', 'TE')]
        expect(engine.nominationPoolFor(team, pool)).toBe(pool)
      })

      it('restricts by required SLOTS, not distinct positions, when a position needs 2 starters', () => {
        // RB needs 2. With 2 spots left and both still owed to RB, the team must
        // not be allowed to nominate a non-RB — otherwise it ends a starter short.
        // The old distinct-position count (1) wrongly left the pool unrestricted.
        const twoRbConfig = { ...defaultConfig, rosterPositions: { QB: 1, RB: 2, K: 1, BENCH: 1 } } // 5 total
        const teams = engine.createTeams(twoRbConfig)
        const team = teams[0]
        // 3 of 5 filled (QB, K, a bench WR); 2 spots left, both owed to RB
        team.roster = [mkPlayer('q', 'QB'), mkPlayer('k', 'K'), mkPlayer('b', 'WR')]
        const pool = [mkPlayer('rb1', 'RB'), mkPlayer('wr1', 'WR'), mkPlayer('rb2', 'RB', 20)]
        const restricted = engine.nominationPoolFor(team, pool)
        expect(restricted.map(p => p.position)).toEqual(['RB', 'RB'])
      })

      it('reserves the last slot for a FLEX-eligible player once base starters are filled', () => {
        const flexConfig = { ...defaultConfig, rosterPositions: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1, BENCH: 0 } } // 5 spots
        const teams = engine.createTeams(flexConfig)
        const team = teams[0]
        // 4 of 5 filled (QB/RB/WR/TE), only the FLEX slot is open
        team.roster = [mkPlayer('q', 'QB'), mkPlayer('r', 'RB'), mkPlayer('w', 'WR'), mkPlayer('t', 'TE')]
        const pool = [mkPlayer('qb2', 'QB', 30), mkPlayer('rb2', 'RB', 5), mkPlayer('k1', 'K', 1)]
        const restricted = engine.nominationPoolFor(team, pool)
        expect(restricted.map(p => p.position)).toEqual(['RB']) // QB/K excluded; only flex-eligible left
      })

      it('does not restrict once a surplus already covers the FLEX slot', () => {
        const flexConfig = { ...defaultConfig, rosterPositions: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1, BENCH: 1 } } // 6 spots
        const teams = engine.createTeams(flexConfig)
        const team = teams[0]
        // QB/WR/TE + RB2 (surplus RB fills FLEX). 1 bench spot left, no needs remain.
        team.roster = [mkPlayer('q', 'QB'), mkPlayer('r1', 'RB'), mkPlayer('r2', 'RB'), mkPlayer('w', 'WR'), mkPlayer('t', 'TE')]
        const pool = [mkPlayer('qb2', 'QB', 30)]
        expect(engine.nominationPoolFor(team, pool)).toBe(pool) // free to draft a backup QB
      })
    })

    describe('bidEligibleTeams', () => {
      it('excludes a team whose last slot is mandatory-only and the player is the wrong position', () => {
        const teams = engine.createTeams(slackConfig)
        const restricted = teams[0]
        // 4 of 5 slots filled, K still needed, 1 spot left
        restricted.roster = [mkPlayer('q', 'QB'), mkPlayer('r', 'RB'), mkPlayer('w', 'WR'), mkPlayer('t', 'TE')]
        const tePlayer = mkPlayer('te-bid', 'TE')
        const eligible = engine.bidEligibleTeams(teams, tePlayer)
        expect(eligible.map(t => t.id)).not.toContain(restricted.id)
        expect(eligible.length).toBe(teams.length - 1) // other 3 teams have slack and stay eligible
      })

      it('includes a restricted team when the player matches one of their mandatory needs', () => {
        const teams = engine.createTeams(slackConfig)
        const restricted = teams[0]
        restricted.roster = [mkPlayer('q', 'QB'), mkPlayer('r', 'RB'), mkPlayer('w', 'WR'), mkPlayer('t', 'TE')]
        const kPlayer = mkPlayer('k-bid', 'K')
        const eligible = engine.bidEligibleTeams(teams, kPlayer)
        expect(eligible.map(t => t.id)).toContain(restricted.id)
      })

      it('excludes a restricted team by required SLOTS when a position needs 2 starters', () => {
        // RB needs 2 with exactly 2 spots left → both slots are owed to RB, so the
        // team must not be allowed to bid on a WR. Old distinct count (1 < 2 spots)
        // wrongly kept it eligible.
        const twoRbConfig = { ...defaultConfig, rosterPositions: { QB: 1, RB: 2, K: 1, BENCH: 1 } }
        const teams = engine.createTeams(twoRbConfig)
        const restricted = teams[0]
        restricted.roster = [mkPlayer('q', 'QB'), mkPlayer('k', 'K'), mkPlayer('b', 'WR')]
        const wrPlayer = mkPlayer('wr-bid', 'WR')
        const eligible = engine.bidEligibleTeams(teams, wrPlayer)
        expect(eligible.map(t => t.id)).not.toContain(restricted.id)
        // ...but it is still eligible to bid on an RB (one of its owed slots)
        const rbPlayer = mkPlayer('rb-bid', 'RB')
        expect(engine.bidEligibleTeams(teams, rbPlayer).map(t => t.id)).toContain(restricted.id)
      })

      it('excludes teams at full roster capacity regardless of player position', () => {
        const teams = engine.createTeams(slackConfig)
        teams[0].roster = [mkPlayer('q', 'QB'), mkPlayer('r', 'RB'), mkPlayer('k', 'K'), mkPlayer('b1', 'WR'), mkPlayer('b2', 'WR')]
        const wrPlayer = mkPlayer('wr-bid', 'WR')
        const eligible = engine.bidEligibleTeams(teams, wrPlayer)
        expect(eligible.map(t => t.id)).not.toContain(teams[0].id)
      })
    })

    describe('handleNominationTimeout', () => {
      // A passive human whose nomination times out used to auto-nominate the
      // single highest-value player regardless of their own roster shape. In the
      // restricted endgame that let them fill their last slot with the wrong
      // position and end the draft a required starter short — the same class of
      // failure the AI nominators already guard against via nominationPoolFor.
      it('auto-nominates a mandatory-need player, not the priciest, when restricted', () => {
        const teams = engine.createTeams(slackConfig)
        const team = teams[0]
        // 4 of 5 slots filled, only K still needed, 1 spot left → restricted to K
        team.roster = [mkPlayer('q', 'QB'), mkPlayer('r', 'RB'), mkPlayer('w', 'WR'), mkPlayer('t', 'TE')]
        store.setState(draft => {
          draft.teams = teams
          draft.config = slackConfig
          // A pricey WR would win a naive "highest estimatedValue" pick.
          draft.availablePlayers = [mkPlayer('wr-rich', 'WR', 99), mkPlayer('k-need', 'K', 1)]
          // nominatePlayer only accepts the on-the-clock nominator
          draft.draftState = 'NOMINATING'
          draft.currentNominator = team.id
        })

        engine.handleNominationTimeout(team.id)

        expect(store.getState().currentPlayer?.id).toBe('k-need')
      })

      it('still picks the highest-value player when the team has slack', () => {
        const teams = engine.createTeams(slackConfig) // empty roster, 5 spots, plenty of slack
        store.setState(draft => {
          draft.teams = teams
          draft.config = slackConfig
          draft.availablePlayers = [mkPlayer('wr-rich', 'WR', 99), mkPlayer('k-cheap', 'K', 1)]
          // nominatePlayer only accepts the on-the-clock nominator
          draft.draftState = 'NOMINATING'
          draft.currentNominator = teams[0].id
        })

        engine.handleNominationTimeout(teams[0].id)

        expect(store.getState().currentPlayer?.id).toBe('wr-rich')
      })
    })

    describe('marketViableNominations', () => {
      // WR/TE/DST are absent from slackConfig's rosterPositions, so every team's
      // getPositionNeed for them is 0 — reliable "dead weight" no team wants.

      it('excludes a cheap player no team needs and whose value is below the floor', () => {
        const teams = engine.createTeams(slackConfig)
        const team = teams[0]
        const pool = [mkPlayer('wr-junk', 'WR', 1), mkPlayer('k-good', 'K', 1)]
        const viable = engine.marketViableNominations(team, pool, teams)
        expect(viable.map(p => p.id)).not.toContain('wr-junk')
      })

      it('keeps a cheap player the nominator needs', () => {
        const teams = engine.createTeams(slackConfig)
        const team = teams[0] // empty roster → needs K
        const pool = [mkPlayer('k-good', 'K', 1), mkPlayer('wr-junk', 'WR', 1)]
        const viable = engine.marketViableNominations(team, pool, teams)
        expect(viable.map(p => p.id)).toContain('k-good')
        expect(viable.map(p => p.id)).not.toContain('wr-junk') // companion confirms no safety-valve mask
      })

      it("keeps a cheap player the nominator's strategy multiplier favors", () => {
        const teams = engine.createTeams(slackConfig)
        const team = teams[0]
        team.draftStrategy = { preferences: { positionMultipliers: { WR: 1.5 } } }
        const pool = [mkPlayer('wr-cheap', 'WR', 1), mkPlayer('te-junk', 'TE', 1)]
        const viable = engine.marketViableNominations(team, pool, teams)
        expect(viable.map(p => p.id)).toContain('wr-cheap')
        expect(viable.map(p => p.id)).not.toContain('te-junk')
      })

      it('keeps a player at or above the value floor even when nobody needs the position', () => {
        const teams = engine.createTeams(slackConfig)
        const team = teams[0]
        const pool = [mkPlayer('wr-rich', 'WR', 8), mkPlayer('te-junk', 'TE', 1)]
        const viable = engine.marketViableNominations(team, pool, teams)
        expect(viable.map(p => p.id)).toContain('wr-rich')
        expect(viable.map(p => p.id)).not.toContain('te-junk')
      })

      it('keeps a cheap player when ANOTHER eligible team needs the position', () => {
        const teams = engine.createTeams(slackConfig)
        const nominator = teams[0]
        nominator.roster = [mkPlayer('myk', 'K', 1)] // nominator no longer needs K; others (empty) still do
        const pool = [mkPlayer('k-cheap', 'K', 1), mkPlayer('te-junk', 'TE', 1)]
        const viable = engine.marketViableNominations(nominator, pool, teams)
        expect(viable.map(p => p.id)).toContain('k-cheap')
        expect(viable.map(p => p.id)).not.toContain('te-junk')
      })

      it('excludes a player when the only interested other team cannot afford $2', () => {
        const teams = engine.createTeams(slackConfig)
        const nominator = teams[0]
        const other = teams[1]
        other.draftStrategy = { preferences: { positionMultipliers: { WR: 1.5 } } }
        other.remainingBudget = 5 // maxBid = 5 - (5 slots - 1) = 1 → canAffordPlayer(2) is false
        const pool = [mkPlayer('wr-cheap', 'WR', 1), mkPlayer('k-good', 'K', 1)]
        const viable = engine.marketViableNominations(nominator, pool, teams)
        expect(viable.map(p => p.id)).not.toContain('wr-cheap')
      })

      it('does not count the nominator itself as a wanting team', () => {
        const teams = engine.createTeams(slackConfig)
        const nominator = teams[0] // empty → needs QB/RB/K, but it is the nominator
        // Fill every OTHER team so none have roster space (excluded by bidEligibleTeams)
        teams.slice(1).forEach(t => {
          t.roster = [mkPlayer('q', 'QB'), mkPlayer('r', 'RB'), mkPlayer('k', 'K'), mkPlayer('b1', 'WR'), mkPlayer('b2', 'WR')]
        })
        // The nominator's own needs must not register as "wanted by others".
        expect(engine.positionsWantedByOthers(nominator, teams).size).toBe(0)
      })

      it('falls back to the full pool when every player is dead weight', () => {
        const teams = engine.createTeams(slackConfig)
        const nominator = teams[0]
        const pool = [mkPlayer('wr1', 'WR', 1), mkPlayer('te1', 'TE', 1)]
        const viable = engine.marketViableNominations(nominator, pool, teams)
        expect(viable).toBe(pool) // safety valve returns the same reference
      })

      it('treats a null-strategy nominator as a neutral 1.0 multiplier without throwing', () => {
        const teams = engine.createTeams(slackConfig)
        const human = teams[0]
        human.draftStrategy = null
        expect(engine.positionMultiplierFor(human, 'WR')).toBe(1.0)
        const pool = [mkPlayer('wr-rich', 'WR', 20)]
        expect(() => engine.marketViableNominations(human, pool, teams)).not.toThrow()
        const viable = engine.marketViableNominations(human, pool, teams)
        expect(viable.map(p => p.id)).toContain('wr-rich') // kept via value floor, not multiplier
      })

      it('returns a non-empty pool after nominationPoolFor restricts to a mandatory position', () => {
        const teams = engine.createTeams(slackConfig)
        const team = teams[0]
        // 4 of 5 filled, only K needed, 1 spot → nominationPoolFor restricts to K
        team.roster = [mkPlayer('q', 'QB'), mkPlayer('r', 'RB'), mkPlayer('w', 'WR'), mkPlayer('t', 'TE')]
        const available = [mkPlayer('k-need', 'K', 1), mkPlayer('wr-rich', 'WR', 99)]
        const restricted = engine.nominationPoolFor(team, available)
        const viable = engine.marketViableNominations(team, restricted, teams)
        expect(viable.map(p => p.id)).toEqual(['k-need'])
      })
    })

    describe('marketablePlayerIds (positional replacement level)', () => {
      // 4 teams (slackConfig), QB starters = 1 → replacement is the QB at index
      // numTeams×1 = 4 (the 5th-best). Floor = its points × 0.25.
      const qb = (id, points, estimatedValue = 1) =>
        new Player({ id, name: id, position: 'QB', team: 'KC', estimatedValue, byeWeek: 5, projectedPoints: points })

      it('keeps players above the replacement floor and drops those below', () => {
        const teams = engine.createTeams(slackConfig)
        // index:        0    1    2    3    4(=repl) 5    6    7
        const pts = [300, 280, 260, 240, 220, 200, 180, 10]
        const available = pts.map(p => qb(`qb_${p}`, p)) // replacement 220 → floor 55
        const ids = engine.marketablePlayerIds(available, teams)
        expect(ids.has('qb_180')).toBe(true)  // 180 >= 55
        expect(ids.has('qb_10')).toBe(false)  // 10 < 55 → waiver-tier
      })

      it('always keeps a high-value player regardless of projection', () => {
        const teams = engine.createTeams(slackConfig)
        const available = [300, 280, 260, 240, 220, 200].map(p => qb(`qb_${p}`, p))
        available.push(qb('qb-stud', 1, 40)) // single-digit points but $40 value
        const ids = engine.marketablePlayerIds(available, teams)
        expect(ids.has('qb-stud')).toBe(true) // value floor guard
      })

      it('includes already-rostered players when computing the replacement level', () => {
        const teams = engine.createTeams(slackConfig)
        // 5 elite QBs already drafted raise the replacement floor above qb-avail
        teams[1].roster = [500, 480, 460, 440, 420].map(p => qb(`drafted_${p}`, p))
        const available = [qb('qb-avail', 100), qb('qb-lo', 8)]
        // union index 4 = 420 → floor 105; qb-avail(100) now below replacement
        expect(engine.marketablePlayerIds(available, teams).has('qb-avail')).toBe(false)
      })

      it('filters a replacement-level player out of marketViableNominations even at a needed position', () => {
        const teams = engine.createTeams(slackConfig)
        const team = teams[0] // empty → needs QB
        const startable = [300, 280, 260, 240, 220, 200].map(p => qb(`qb_${p}`, p))
        const scrub = qb('qb-scrub', 5) // below the 55 floor
        const available = [...startable, scrub]
        const viable = engine.marketViableNominations(team, available, teams, available)
        expect(viable.map(p => p.id)).not.toContain('qb-scrub')
        expect(viable.map(p => p.id)).toContain('qb_300')
      })
    })
  })

  describe('completeBidding no-bid nominator guard', () => {
    it('does not assign a player to a $0 nominator when no one bid', () => {
      const teams = engine.createTeams(defaultConfig)
      const nominator = teams[0]
      nominator.remainingBudget = 0
      const player = new Player({ id: 'p1', name: 'Test', position: 'QB', team: 'KC', estimatedValue: 30, byeWeek: 5 })
      store.setState(draft => {
        draft.teams = teams
        draft.config = defaultConfig
        draft.currentPlayer = player
        draft.currentBidder = null
        draft.currentNominator = 'team_1'
        draft.availablePlayers = [player]
      })

      engine.completeBidding()

      const final = store.getState().teams.find(t => t.id === 'team_1')
      expect(final.roster).toHaveLength(0)
      expect(final.remainingBudget).toBe(0)
      expect(store.getState().availablePlayers).toHaveLength(0)
      const historyEntry = store.getState().draftHistory.at(-1)
      expect(historyEntry.team).toBe('No Bids')
    })
  })

  describe('completeDraft', () => {
    it('sets draftState to COMPLETE', () => {
      engine.completeDraft()
      expect(store.getState().draftState).toBe('COMPLETE')
    })
  })

  describe('processAIBids retry-on-null', () => {
    // Without the retry, a single round of unlucky stochastic shouldBid rolls
    // killed the whole auction — nominator won mid-tier players for $1. The
    // retry gives fresh rolls another chance until the bidding window runs out.

    function setupBidding({ timeRemaining }) {
      const teams = engine.createTeams(defaultConfig)
      const player = new Player({ id: 'p1', name: 'X', position: 'QB', team: 'KC', estimatedValue: 30, byeWeek: 5 })
      store.setState(draft => {
        draft.teams = teams
        draft.config = defaultConfig
        draft.draftState = 'BIDDING'
        draft.currentPlayer = player
        draft.currentBid = 1
      })
      engine.biddingTimeRemaining = timeRemaining
      engine.biddingStartTime = Date.now()
      return player
    }

    it('reschedules another processAIBids call when no bid is placed and time remains', () => {
      const player = setupBidding({ timeRemaining: 15 })
      // aiManager.processAIBidding is mocked to return null by default.

      engine.processAIBids(player)
      expect(engine.aiManager.processAIBidding).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(10000)
      expect(engine.aiManager.processAIBidding.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('does not reschedule when biddingTimeRemaining is too low', () => {
      const player = setupBidding({ timeRemaining: 2 })

      engine.processAIBids(player)
      expect(engine.aiManager.processAIBidding).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(10000)
      expect(engine.aiManager.processAIBidding).toHaveBeenCalledTimes(1)
    })

    it('still reschedules on the success path (regression check)', () => {
      const player = setupBidding({ timeRemaining: 15 })
      const teams = store.getState().teams
      engine.aiManager.processAIBidding.mockReturnValueOnce({
        team: teams[1], // an AI team, not human (team_1 is human in defaultConfig)
        amount: 5
      })

      engine.processAIBids(player)
      expect(engine.aiManager.processAIBidding).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(10000)
      expect(engine.aiManager.processAIBidding.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    // A processAIBids callback scheduled for one auction can fire after the next
    // auction has opened (pending setTimeouts aren't cleared on auction end).
    // Both auctions are in BIDDING, so a draftState-only guard would let the
    // stale callback evaluate eligibility against the wrong player and place a
    // bid on the current one — the live-draft bug where a team restricted to
    // QB/TE won an RB it had been nominated against.
    it('ignores a stale callback whose player is no longer the current player', () => {
      const current = setupBidding({ timeRemaining: 15 })
      const stale = new Player({ id: 'p-stale', name: 'Stale', position: 'RB', team: 'KC', estimatedValue: 25, byeWeek: 5 })

      engine.processAIBids(stale) // currentPlayer is `current`, not `stale`

      expect(engine.aiManager.processAIBidding).not.toHaveBeenCalled()
      expect(store.getState().currentBidder).toBeNull()

      // The matching player still proceeds normally.
      engine.processAIBids(current)
      expect(engine.aiManager.processAIBidding).toHaveBeenCalledTimes(1)
    })
  })

  describe('pauseDraft / resumeDraft', () => {
    it('sets draftState to PAUSED on pause', () => {
      engine.pauseDraft()
      expect(store.getState().draftState).toBe('PAUSED')
    })

    it('resumes to NOMINATING when no current player', () => {
      // Need teams in state so nomination order is non-empty
      const teams = engine.createTeams(defaultConfig)
      store.setState(draft => {
        draft.teams = teams
        draft.config = defaultConfig
        draft.currentPlayer = null
      })
      engine.nominationOrder = teams.map(t => t.id)
      engine.currentNominatorIndex = 0
      store.setState(draft => { draft.draftState = 'NOMINATING' })
      engine.pauseDraft()
      engine.resumeDraft()
      expect(store.getState().draftState).toBe('NOMINATING')
    })

    it('resumes to BIDDING when a player is up for auction', () => {
      const player = new Player({ id: 'p1', name: 'Test', position: 'QB', team: 'KC', estimatedValue: 30, byeWeek: 5 })
      store.setState(draft => {
        draft.currentPlayer = player
        draft.config = defaultConfig
      })
      engine.pauseDraft()
      engine.resumeDraft()
      expect(store.getState().draftState).toBe('BIDDING')
    })

    // Regression: pausing clears the bidding timer but NOT the processAIBids
    // setTimeout cascade — those callbacks die on their own once draftState is
    // PAUSED. resumeDraft must re-kick the loop, or the resumed auction gets
    // zero AI bids and the nominator steals the player for $1 / their standing
    // bid, with AI only "resuming" on the next nomination (the reported bug).
    it('re-kicks the AI bidding loop when resuming a live auction', () => {
      const teams = engine.createTeams(defaultConfig)
      const player = new Player({ id: 'p1', name: 'Test', position: 'QB', team: 'KC', estimatedValue: 30, byeWeek: 5 })
      store.setState(draft => {
        draft.teams = teams
        draft.config = defaultConfig
        draft.draftState = 'BIDDING'
        draft.currentPlayer = player
        draft.currentBid = 1
      })
      engine.biddingTimeRemaining = 15

      engine.pauseDraft()
      expect(engine.aiManager.processAIBidding).not.toHaveBeenCalled()

      engine.resumeDraft()
      // The re-kick is scheduled 1-3s out; advance past the window.
      vi.advanceTimersByTime(3000)
      expect(engine.aiManager.processAIBidding).toHaveBeenCalled()
    })
  })

  describe('simulateToEnd', () => {
    // The auto-pilot "Simulate to End" control: from a live, in-progress draft,
    // resolve any in-flight auction then synchronously run the rest to COMPLETE,
    // preserving every pick already made.

    beforeEach(() => {
      // initializeStrategy is consulted to backfill the human team's strategy
      // (mid-draft autopilot only sets isAutoPilot). Return a usable stub so
      // setStrategy() — which calls strategy.setTeam(team) — doesn't throw.
      autoPilotService.initializeStrategy.mockReturnValue({ setTeam: vi.fn() })
      // Naive nominator: take the top of whatever viable pool it's handed. The
      // real AI quality isn't under test here — the plumbing is.
      engine.aiManager.getAINomination = vi.fn((team, pool) => pool[0])
    })

    // Real Player instances, not plain objects: immer deep-freezes plain
    // objects in produced state, which would block the player.purchasePrice
    // assignment — class instances are left untouched, matching the live store.
    const mkPlayers = (n = 12) => makePlayers(n).map(p => new Player(p))

    function liveDraft(overrides = {}) {
      const teams = engine.createTeams(defaultConfig)
      engine.nominationOrder = engine.generateNominationOrder(teams, defaultConfig.rosterPositions)
      engine.currentNominatorIndex = 0
      store.setState(draft => {
        draft.teams = teams
        draft.config = defaultConfig
        draft.availablePlayers = mkPlayers(12)
        draft.draftState = 'NOMINATING'
        draft.autoPilotEnabled = true
        Object.assign(draft, overrides)
      })
      return teams
    }

    it('drives a NOMINATING draft to COMPLETE and fills every roster', () => {
      liveDraft()
      // processAIBidding is mocked to null → each nominee goes to the nominator for $1.
      engine.simulateToEnd()

      const state = store.getState()
      expect(state.draftState).toBe('COMPLETE')
      expect(state.availablePlayers).toHaveLength(0)
      // 4 teams × 3 spots = 12 picks all made.
      expect(state.draftHistory).toHaveLength(12)
      state.teams.forEach(t => expect(t.roster).toHaveLength(3))
    })

    it('preserves picks already made before the jump', () => {
      const teams = liveDraft()
      // Simulate two completed picks: team_1 owns p0, team_2 owns p1.
      teams[0].roster = [mkPlayers(1)[0]]
      const p1 = new Player({ id: 'p1', name: 'Player 1', position: 'RB', team: 'KC', estimatedValue: 29, byeWeek: 7, projectedPoints: 195 })
      teams[1].roster = [p1]
      store.setState(draft => {
        draft.teams = teams
        draft.availablePlayers = mkPlayers(12).filter(p => p.id !== 'p0' && p.id !== 'p1')
        draft.draftHistory = [
          { player: { id: 'p0' }, team: 'My Team', nominator: 'My Team', price: 3, timestamp: 1 },
          { player: p1, team: 'Team 2', nominator: 'Team 2', price: 2, timestamp: 2 }
        ]
      })
      engine.currentNominatorIndex = 2

      engine.simulateToEnd()

      const state = store.getState()
      expect(state.draftState).toBe('COMPLETE')
      // The two seeded history entries survive and sit at the front.
      expect(state.draftHistory[0].player.id).toBe('p0')
      expect(state.draftHistory[1].player.id).toBe('p1')
      expect(state.draftHistory.length).toBeGreaterThan(2)
    })

    it('resolves an in-flight auction to the standing bidder before finishing', () => {
      liveDraft()
      const onBlock = mkPlayers(1)[0] // p0
      // Only p0 is left, and team_2 holds a $5 standing bid mid-auction.
      store.setState(draft => {
        draft.availablePlayers = [onBlock]
        draft.draftState = 'BIDDING'
        draft.currentPlayer = onBlock
        draft.currentBid = 5
        draft.currentBidder = 'team_2'
        draft.currentNominator = 'team_2'
      })
      engine.currentNominatorIndex = engine.nominationOrder.length // overflow → no fresh nominations

      engine.simulateToEnd()

      const state = store.getState()
      const team2 = state.teams.find(t => t.id === 'team_2')
      expect(state.draftState).toBe('COMPLETE')
      expect(team2.roster.map(p => p.id)).toContain('p0')
      expect(team2.remainingBudget).toBe(defaultConfig.budgetPerTeam - 5)
      expect(state.draftHistory.at(-1).player.id).toBe('p0')
      expect(state.draftHistory.at(-1).price).toBe(5)
    })

    it('is a no-op when the draft is already COMPLETE', () => {
      liveDraft({ draftState: 'COMPLETE' })
      const before = store.getState().draftHistory.length
      engine.simulateToEnd()
      expect(store.getState().draftHistory.length).toBe(before)
    })
  })

  describe('COMPLETE-state guards', () => {
    // A stray AI-nomination / post-pick setTimeout (untracked by clearTimers)
    // can fire after simulateToEnd reaches COMPLETE. startNominationPhase and
    // nominatePlayer must ignore it rather than reopen a finished draft.
    it('startNominationPhase is a no-op once the draft is COMPLETE', () => {
      const teams = engine.createTeams(defaultConfig)
      engine.nominationOrder = teams.map(t => t.id)
      engine.currentNominatorIndex = 0
      store.setState(draft => {
        draft.teams = teams
        draft.config = defaultConfig
        draft.draftState = 'COMPLETE'
        draft.currentNominator = 'team_3'
      })

      engine.startNominationPhase()

      expect(store.getState().draftState).toBe('COMPLETE')
      expect(store.getState().currentNominator).toBe('team_3') // unchanged
    })

    it('nominatePlayer is a no-op once the draft is COMPLETE', () => {
      store.setState(draft => { draft.draftState = 'COMPLETE' })
      const player = new Player({ id: 'p1', name: 'Test', position: 'QB', team: 'KC', estimatedValue: 30, byeWeek: 5 })

      engine.nominatePlayer(player, 'team_1')

      expect(store.getState().draftState).toBe('COMPLETE')
      expect(store.getState().currentPlayer).toBeNull()
    })
  })

  describe('updateTeamPsychology', () => {
    it('sets winning momentum when team gets a great deal (value >> price)', () => {
      const teams = engine.createTeams(defaultConfig)
      const winner = teams[0]
      const player = new Player({ id: 'p1', name: 'Test', position: 'QB', team: 'KC', estimatedValue: 50, byeWeek: 5 })
      engine.updateTeamPsychology(teams, winner, player, 40) // $10 under value
      expect(winner.momentum).toBe('winning')
    })

    it('sets losing momentum when team overpays significantly', () => {
      const teams = engine.createTeams(defaultConfig)
      const winner = teams[0]
      const player = new Player({ id: 'p1', name: 'Test', position: 'QB', team: 'KC', estimatedValue: 30, byeWeek: 5 })
      engine.updateTeamPsychology(teams, winner, player, 40) // $10 overpay
      expect(winner.momentum).toBe('losing')
    })

    it('caps recentBidOutcomes at 5 entries', () => {
      const teams = engine.createTeams(defaultConfig)
      const winner = teams[0]
      const player = new Player({ id: 'p1', name: 'Test', position: 'QB', team: 'KC', estimatedValue: 30, byeWeek: 5 })
      for (let i = 0; i < 7; i++) {
        engine.updateTeamPsychology(teams, winner, player, 25)
      }
      expect(winner.recentBidOutcomes).toHaveLength(5)
    })
  })

  describe('timer-cascade and live-auction guards', () => {
    function activeDraft(overrides = {}) {
      const teams = engine.createTeams(defaultConfig)
      engine.nominationOrder = teams.map(t => t.id)
      engine.currentNominatorIndex = 0
      store.setState(draft => {
        draft.teams = teams
        draft.config = defaultConfig
        draft.availablePlayers = makePlayers(12).map(p => new Player(p))
        draft.draftState = 'NOMINATING'
        Object.assign(draft, overrides)
      })
      return teams
    }

    // The post-pick advance is a 2s setTimeout. Restarting inside that window
    // used to let the stale callback flip the freshly reset SETUP state back
    // into a teamless NOMINATING auction.
    it('dispose() cancels the pending post-pick advance (restart mid-gap)', () => {
      activeDraft()
      engine.schedule(() => engine.startNominationPhase(), 2000)

      engine.dispose()
      store.setState(draft => {
        draft.draftState = 'SETUP'
        draft.teams = []
        draft.currentNominator = null
      })

      vi.advanceTimersByTime(10000)
      expect(store.getState().draftState).toBe('SETUP')
      expect(store.getState().currentNominator).toBeNull()
    })

    // Pausing during the inter-pick gap used to silently un-pause 2s later:
    // pauseDraft didn't cancel the advance and startNominationPhase had no
    // PAUSED guard.
    it('pause during the inter-pick gap sticks', () => {
      activeDraft()
      engine.schedule(() => engine.startNominationPhase(), 2000)

      engine.pauseDraft()

      vi.advanceTimersByTime(10000)
      expect(store.getState().draftState).toBe('PAUSED')
    })

    it('startNominationPhase is a no-op while PAUSED even if called directly', () => {
      activeDraft({ draftState: 'PAUSED', currentNominator: 'team_2' })
      engine.startNominationPhase()
      expect(store.getState().draftState).toBe('PAUSED')
      expect(store.getState().currentNominator).toBe('team_2')
    })

    // A click dispatched in the same tick as the sale used to validate against
    // the reset currentBid=0 and write a phantom bid into post-sale state.
    it('placeBid is rejected outside a live auction', () => {
      const teams = activeDraft({ currentPlayer: null, currentBid: 0, currentBidder: null })

      const ok = engine.placeBid(teams[0].id, 5)

      expect(ok).toBe(false)
      expect(store.getState().currentBid).toBe(0)
      expect(store.getState().currentBidder).toBeNull()
    })

    // Sync no-bid fallback must respect the same canBid() guard as the live
    // path instead of driving the nominator's budget negative.
    it('resolveAuctionSync records No Bids when the nominator cannot afford $1', () => {
      const teams = activeDraft()
      const nominator = teams[1]
      nominator.remainingBudget = 0

      const player = store.getState().availablePlayers[0]
      engine.resolveAuctionSync(player, 1, null, nominator)

      const pick = store.getState().draftHistory.at(-1)
      expect(pick.team).toBe('No Bids')
      expect(pick.price).toBe(0)
      expect(nominator.remainingBudget).toBe(0)
      expect(nominator.roster).toHaveLength(0)
    })
  })
})
