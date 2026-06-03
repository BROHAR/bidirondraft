import { Team } from '../models/Team.js'
import { Player } from '../models/Player.js'
import { AIManager } from './aiManager.js'
import { autoPilotService } from './autoPilotService.js'
import { audioService } from './audioService.js'
import { BidValidator } from './bidValidator.js'
import { workerTimers } from './workerTimers.js'

// Roster positions that map directly to a player.position value. FLEX,
// SUPERFLEX, and BENCH are intentionally excluded — they can be filled by
// any position, so they don't constrain late-draft nominations or bidding.
const MANDATORY_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']

// Raw value at/above which a player is assumed to draw a bid from someone even
// with no positional read. Tunable; ~$8 covers the $3–$8 dead-weight gap the
// old $2 risk ceiling missed.
const MARKET_VALUE_FLOOR = 8

// Replacement level. The last "startable" player at a position sits at index
// numTeams × starters when ranked by projectedPoints; anyone projecting below a
// fraction of that player's points is waiver-tier — nobody bids, so nominating
// them just sticks the nominator (e.g. a QB or RB projected for single digits,
// while better names at the same position are still on the board). The fraction
// sits in the steep cliff between fantasy-relevant players and clipboard depth,
// so the exact value is not sensitive. Tunable. The MARKET_VALUE_FLOOR guard
// keeps genuinely valuable players regardless of projection data.
const POSITION_STARTERS = { QB: 1, RB: 3, WR: 3, TE: 1, K: 1, DST: 1 }
const REPLACEMENT_POINTS_FRACTION = 0.25

export class DraftEngine {
  constructor(store) {
    this.store = store
    this.aiManager = new AIManager()
    this.nominationOrder = []
    this.currentNominatorIndex = 0
  }

  initializeDraft(config, playersData, options = {}) {
    const teams = this.createTeams(config)
    const scoringFormat = config.scoringFormat || 'halfPPR'
    const players = playersData.players.map(p => new Player(p, scoringFormat))

    // League-size calibration in two passes:
    //   1. One-sided budget anchor: if the top-(totalSpots) of the pool sums
    //      to LESS than the total auction budget (typical in larger leagues
    //      where the player file's expert-ranked top-N is light), scale every
    //      player up proportionally so teams have value to bid on. Never
    //      deflates — small leagues whose pool already exceeds the budget
    //      keep their book values (Dart $5, Metcalf $3, etc.).
    //   2. Top-60 tilt: smaller leagues further INFLATE the top tier (deep
    //      waiver = cheaper bench → more budget concentrates on stars),
    //      larger leagues DEFLATE it (shallow waiver = costlier bench → less
    //      budget for stars). No redistribution to the rest tier — Stage 1
    //      already established a sane floor for the bench.
    const REFERENCE_TEAMS = 12
    const TOP_TIER_SIZE = 60
    const TILT_PER_TEAM = 0.08    // 8% per team off baseline (~16% from 12→14, matches user's "10-15% shave")

    const totalAuctionBudget = teams.length * config.budgetPerTeam
    const rosterSize = Object.values(config.rosterPositions || {})
      .reduce((s, c) => s + c, 0)
    const totalSpots = teams.length * rosterSize

    if (players.length > 0) {
      const sorted = [...players].sort((a, b) => b.estimatedValue - a.estimatedValue)

      // Stage 2 first (top-60 tilt): top tier inflates in small leagues,
      // deflates in big. Apply before Stage 1 so the budget anchor accounts
      // for the value Stage 2 removed/added; otherwise the post-tilt pool
      // sums below total budget and teams leave money unspent.
      const topTilt = 1.0 + TILT_PER_TEAM * (REFERENCE_TEAMS - teams.length)
      if (Math.abs(topTilt - 1.0) > 1e-9) {
        const top = sorted.slice(0, Math.min(TOP_TIER_SIZE, sorted.length))
        for (const p of top) p.estimatedValue *= topTilt
      }

      // Stage 1 (budget anchor): scale the pool so the top-(totalSpots) — the
      // players that will actually be drafted — sums to the total auction
      // budget. Bidirectional: large leagues that fall short are inflated,
      // small leagues whose post-tilt top-N exceeds the budget are deflated.
      // Anchoring BOTH ways keeps sum(book) ≈ budget so realized auction prices
      // track estimatedValue on average. The previous inflate-only version left
      // small leagues (e.g. 10-team) with total book ~14% above the money in
      // the room, which forces systematic below-estimate sales — studs hold
      // near book and the squeeze dumps onto the mid-tier, which then sells for
      // $1 (the reported "Breece/Davante for $1" problem). The Math.max(1, …)
      // floor below keeps $1 players at $1 after any deflation. The Stage-2
      // tilt still shapes the curve (stars relatively pricier in small leagues);
      // this only normalizes the absolute level to the budget.
      if (totalSpots > 0) {
        const topN = sorted.slice(0, Math.min(totalSpots, sorted.length))
        const currentTopNSum = topN.reduce((s, p) => s + p.estimatedValue, 0)
        if (currentTopNSum > 0) {
          const baseScale = totalAuctionBudget / currentTopNSum
          for (const p of players) p.estimatedValue *= baseScale
        }
      }

      for (const p of players) {
        p.estimatedValue = Math.max(1, Math.round(p.estimatedValue * 10) / 10)
      }

      // Yahoo reports every K and DST at $1 in their salary-cap projections, so
      // the position has no price signal — top kickers go for the same $1 as
      // the worst on the board. projectedPoints does have meaningful spread
      // within position, so we use it to tier the top 3 of each so they land
      // at $2–3 in auction (matching real-draft pricing).
      this.applyKDstTiering(players)

      // User-customized values are authoritative — snap back after calibration
      // so the auction displays exactly what the user typed.
      const overrides = config.playerOverrides
      if (overrides) {
        for (const p of players) {
          const o = overrides[p.id]
          if (o && typeof o.estimatedValue === 'number') {
            p.estimatedValue = o.estimatedValue
          }
        }
      }
    }

    this.nominationOrder = this.generateNominationOrder(teams, config.rosterPositions)
    this.currentNominatorIndex = 0
    
    // Assign AI strategies to teams
    this.aiManager.assignStrategies(teams, config.aiTeamStrategies, players)
    
    // Initialize auto-pilot for human team if enabled
    this.initializeAutoPilot(teams, config)
    
    this.store.setState((draft) => {
      draft.teams = teams
      draft.availablePlayers = players
      draft.config = { ...draft.config, ...config }
    })
    
    if (options.simulate) {
      this.simulateDraft()
    } else {
      this.startNominationPhase()
    }
  }

  // Tier K and DST estimatedValue by projectedPoints. Math.max so a league
  // config that already values them higher is never deflated.
  applyKDstTiering(players) {
    for (const pos of ['K', 'DST']) {
      const positional = players
        .filter(p => p.position === pos)
        .sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0))
      if (positional[0]) positional[0].estimatedValue = Math.max(positional[0].estimatedValue, 3)
      if (positional[1]) positional[1].estimatedValue = Math.max(positional[1].estimatedValue, 2)
      if (positional[2]) positional[2].estimatedValue = Math.max(positional[2].estimatedValue, 2)
    }
  }

  createTeams(config) {
    const teams = []
    
    for (let i = 0; i < config.numberOfTeams; i++) {
      const isHuman = (i + 1) === config.humanDraftPosition
      const teamName = isHuman ? config.humanTeamName : `Team ${i + 1}`
      
      const team = new Team(`team_${i + 1}`, teamName, isHuman, config)
      teams.push(team)
    }
    
    return teams
  }

  generateNominationOrder(teams, rosterPositions) {
    const order = []
    const positions = rosterPositions || this.store.getState().config.rosterPositions
    const rosterSize = Object.values(positions).reduce((total, count) => total + count, 0)
    const totalPicks = teams.length * rosterSize

    // Straight order: 1, 2, 3, ..., N, 1, 2, 3, ..., N, ... (no snake reversal)
    while (order.length < totalPicks) {
      for (let i = 0; i < teams.length; i++) {
        if (order.length < totalPicks) {
          order.push(teams[i].id)
        }
      }
    }

    return order
  }

  initializeAutoPilot(teams, config) {
    const humanTeam = teams.find(t => t.isHuman)
    if (humanTeam && config.autoPilotEnabled) {
      const strategy = autoPilotService.initializeStrategy(humanTeam, config.autoPilotStrategy)
      humanTeam.setStrategy(strategy) // ensures humanTeam.draftStrategy is set for processAIBidding
    }
  }

  // When a team's remaining slots are fewer than the mandatory positions
  // they still need (e.g. 1 slot left, K and DST both unfilled), restrict
  // the pool so they can only nominate from those needs. Otherwise the
  // strategy could nominate a WR, the team would take it for $1, and the
  // K/DST slot would end the draft empty.
  // How many of a team's remaining roster spots are already spoken for by
  // unfilled starting requirements, and which positions can fill them. Covers
  // the mandatory single-position starters (QB/RB/WR/TE/K/DST) AND the FLEX /
  // SUPERFLEX slots — without the flex/superflex part a team can fill its base
  // starters and then spend every remaining slot on backups (e.g. extra QBs),
  // ending the draft with an empty FLEX it never drafted an eligible player for.
  // Reserve by required *slots*, not distinct positions, so RB/WR (2 each) and
  // multiple flex slots aren't undercounted.
  rosterReservation(team) {
    let reserved = 0
    const allowed = new Set()
    for (const pos of MANDATORY_POSITIONS) {
      const need = team.getPositionNeed(pos)
      if (need > 0) {
        reserved += need
        allowed.add(pos)
      }
    }
    const flexNeed = team.getFlexNeed()
    if (flexNeed > 0) {
      reserved += flexNeed
      for (const pos of ['RB', 'WR', 'TE']) allowed.add(pos)
    }
    const superflexNeed = team.getSuperflexNeed()
    if (superflexNeed > 0) {
      reserved += superflexNeed
      for (const pos of ['QB', 'RB', 'WR', 'TE']) allowed.add(pos)
    }
    return { reserved, allowed }
  }

  nominationPoolFor(team, availablePlayers) {
    const { reserved, allowed } = this.rosterReservation(team)
    const spotsLeft = team.getRosterSpotsRemaining()
    if (spotsLeft <= 0 || spotsLeft > reserved) return availablePlayers
    const restricted = availablePlayers.filter(p => allowed.has(p.position))
    return restricted.length > 0 ? restricted : availablePlayers
  }

  // Same idea on the bidding side: exclude any team whose last few slots are all
  // spoken for by unfilled starting requirements and where this player's position
  // can't fill one of them. Stops a team from spending its last slot on the wrong
  // position and leaving a required starter or FLEX unfillable.
  bidEligibleTeams(teams, player) {
    return teams.filter(t => {
      if (!t.hasRosterSpace()) return false
      const { reserved, allowed } = this.rosterReservation(t)
      const spotsLeft = t.getRosterSpotsRemaining()
      if (spotsLeft <= reserved && reserved > 0) {
        return allowed.has(player.position)
      }
      return true
    })
  }

  // Subset of `pool` that is safe to nominate. A player must (1) project at or
  // above its position's replacement level — not a waiver-tier scrub like a
  // single-digit-point QB/RB that nobody bids on — AND (2) be wanted: either the nominator
  // genuinely wants it, or its position is one some OTHER bid-eligible team would
  // plausibly bid a real $2 on. Deterministic (no shouldBid randomness) so it is
  // unit-testable. Falls back to the full pool if everything is dead weight, so
  // the draft never stalls (and forced late-draft fills of a needed position go
  // through via nominationPoolFor + this valve). This is now the authoritative
  // nomination guard; BaseStrategy's isRiskyNomination remains a backstop only.
  //
  // Both gates are precomputed once per nomination rather than rescanned per
  // (mostly $1) player — keeping the synchronous simulateDraft loop cheap.
  // `available` is the full available pool (used for stable positional ranking);
  // `pool` may already be narrowed to mandatory positions by nominationPoolFor.
  marketViableNominations(team, pool, teams, available = pool) {
    const wantedByOthers = this.positionsWantedByOthers(team, teams)
    const marketable = this.marketablePlayerIds(available, teams)
    const viable = pool.filter(player =>
      marketable.has(player.id) &&
      (this.nominatorWants(team, player) || wantedByOthers.has(player.position))
    )
    return viable.length > 0 ? viable : pool
  }

  // Ids of players projecting at or above their position's replacement level.
  // Replacement is derived by projectedPoints across ALL players at the position
  // (available + already rostered) — their union is constant, so the floor is
  // stable through the draft: a scrub is filtered early and late alike, while
  // forced fills still flow through marketViableNominations' safety valve.
  // High-value players (>= MARKET_VALUE_FLOOR) are always kept as a guard against
  // sparse/missing projection data.
  marketablePlayerIds(available, teams) {
    const numTeams = teams.length || 1
    const pointsByPos = new Map() // position -> number[] (projectedPoints)
    const points = p => (typeof p.projectedPoints === 'number' ? p.projectedPoints : 0)
    const add = p => {
      if (!pointsByPos.has(p.position)) pointsByPos.set(p.position, [])
      pointsByPos.get(p.position).push(points(p))
    }
    for (const t of teams) for (const p of t.roster) add(p)
    for (const p of available) add(p)

    const floorByPos = new Map()
    for (const [position, pts] of pointsByPos) {
      pts.sort((a, b) => b - a)
      const replIdx = numTeams * (POSITION_STARTERS[position] ?? 99)
      const replacement = pts[replIdx] ?? 0 // 0 when the pool is shallower than the cutoff
      floorByPos.set(position, replacement * REPLACEMENT_POINTS_FRACTION)
    }

    const ids = new Set()
    for (const p of available) {
      if (points(p) >= (floorByPos.get(p.position) ?? 0) || (p.estimatedValue ?? 0) >= MARKET_VALUE_FLOOR) {
        ids.add(p.id)
      }
    }
    return ids
  }

  nominatorWants(team, player) {
    if (team.getPositionNeed(player.position) > 0) return true
    if (team.getFlexNeed() > 0 && ['RB', 'WR', 'TE'].includes(player.position)) return true
    if (team.getSuperflexNeed() > 0 && ['QB', 'RB', 'WR', 'TE'].includes(player.position)) return true
    if (this.positionMultiplierFor(team, player.position) > 1.0) return true
    if (player.estimatedValue >= MARKET_VALUE_FLOOR) return true
    return false
  }

  // Positions for which at least one OTHER team would plausibly open a $2 bid:
  // it is bid-eligible for that position (roster space + mandatory-slot fit) and
  // either needs it or its strategy favors it. Excludes the nominator itself.
  positionsWantedByOthers(team, teams) {
    const wanted = new Set()
    for (const pos of MANDATORY_POSITIONS) {
      const eligible = this.bidEligibleTeams(teams, { position: pos })
        .filter(t => t.id !== team.id && t.canAffordPlayer(2)) // $2 beats the $1 open
      if (eligible.some(t => t.getPositionNeed(pos) > 0 || this.positionMultiplierFor(t, pos) > 1.0)) {
        wanted.add(pos)
      }
    }
    return wanted
  }

  // Null-safe: AI teams have draftStrategy; auto-pilot humans get one set in
  // startNominationPhase; bare humans read as neutral 1.0.
  positionMultiplierFor(team, position) {
    return team.draftStrategy?.preferences?.positionMultipliers?.[position] ?? 1.0
  }

  startNominationPhase() {
    const state = this.store.getState()

    // Once the seeded nomination order is exhausted, round-robin among any
    // teams that can still bid — otherwise a team that mismanaged budget
    // would silently end the draft short of a full roster. Matches the
    // overflow logic in simulateDraft().
    let nominatorId
    if (this.currentNominatorIndex < this.nominationOrder.length) {
      nominatorId = this.nominationOrder[this.currentNominatorIndex]
    } else {
      const eligibleNominators = state.teams.filter(t => t.canBid())
      if (eligibleNominators.length === 0) {
        this.completeDraft()
        return
      }
      const overflowIndex = this.currentNominatorIndex - this.nominationOrder.length
      nominatorId = eligibleNominators[overflowIndex % eligibleNominators.length].id
    }

    const nominatorTeam = state.teams.find(t => t.id === nominatorId)

    if (nominatorTeam && !nominatorTeam.canBid()) {
      // Team is full or out of funds, skip to next nominator
      this.currentNominatorIndex++
      this.startNominationPhase()
      return
    }
    
    this.store.setState((draft) => {
      draft.currentNominator = nominatorId
      draft.draftState = 'NOMINATING'
    })
    
    // Check if AI needs to nominate
    
    if (nominatorTeam && !nominatorTeam.isHuman) {
      // AI nomination - fixed 2 second delay
      workerTimers.setTimeout(() => {
        const currentState = this.store.getState()
        const currentNominatorTeam = currentState.teams.find(t => t.id === nominatorId)
        if (!currentNominatorTeam || !currentNominatorTeam.hasRosterSpace()) {
          this.currentNominatorIndex++
          this.startNominationPhase()
          return
        }
        const pool = this.nominationPoolFor(currentNominatorTeam, currentState.availablePlayers)
        const viablePool = this.marketViableNominations(currentNominatorTeam, pool, currentState.teams, currentState.availablePlayers)
        const player = this.aiManager.getAINomination(currentNominatorTeam, viablePool)
        if (player) {
          this.nominatePlayer(player, nominatorId)
        } else {
          // No nominatable player (pool exhausted) — advance rather than halt.
          this.currentNominatorIndex++
          this.startNominationPhase()
        }
      }, 2000) // Fixed 2 second delay
    } else if (nominatorTeam && nominatorTeam.isHuman && nominatorTeam.isAutoPilot) {
      // Auto-pilot nomination
      workerTimers.setTimeout(() => {
        const pool = this.nominationPoolFor(nominatorTeam, state.availablePlayers)
        const viablePool = this.marketViableNominations(nominatorTeam, pool, state.teams, state.availablePlayers)
        const player = autoPilotService.selectNomination(viablePool, nominatorTeam)
        if (player) {
          this.nominatePlayer(player, nominatorId)
        } else {
          this.currentNominatorIndex++
          this.startNominationPhase()
        }
      }, 1000 + Math.random() * 2000) // 1-3 second delay for auto-pilot
    } else {
      // Manual human nomination - start timer
      this.startNominationTimer(nominatorId)
    }
  }

  startNominationTimer(nominatorId) {
    const { config } = this.store.getState()
    let timeRemaining = config.nominationTimer

    this.store.setState((draft) => {
      draft.timeRemaining = timeRemaining
    })

    const timer = workerTimers.setInterval(() => {
      timeRemaining--
      this.store.setState((draft) => {
        draft.timeRemaining = timeRemaining
      })

      // Play audio beeps for timer warnings
      if (timeRemaining === 10) {
        audioService.playTimerWarning()
      } else if (timeRemaining <= 5 && timeRemaining >= 1) {
        audioService.playTimerUrgent()
      }

      if (timeRemaining <= 0) {
        workerTimers.clearInterval(timer)
        this.handleNominationTimeout(nominatorId)
      }
    }, 1000)

    this.nominationTimer = timer
  }

  handleNominationTimeout(nominatorId) {
    // Auto-nominate the highest value available player — but honor the same
    // mandatory-position reservation the AI/auto-pilot nominators use. Without
    // this, a passive human whose nominations all time out auto-nominates the
    // priciest player every turn and can fill their last slots with the wrong
    // positions, ending the draft missing a required starter (QB/TE/K/DST).
    const { availablePlayers, teams } = this.store.getState()
    const nominatorTeam = teams.find(t => t.id === nominatorId)
    const pool = nominatorTeam
      ? this.marketViableNominations(
          nominatorTeam,
          this.nominationPoolFor(nominatorTeam, availablePlayers),
          teams,
          availablePlayers
        )
      : availablePlayers
    const playerToNominate = [...pool]
      .sort((a, b) => b.estimatedValue - a.estimatedValue)[0]

    if (playerToNominate) {
      this.nominatePlayer(playerToNominate, nominatorId)
    }
  }

  nominatePlayer(player, nominatorId) {
    if (this.nominationTimer) {
      workerTimers.clearInterval(this.nominationTimer)
    }

    this.store.setState((draft) => {
      draft.currentPlayer = player
      draft.currentBid = 1
      draft.currentBidder = null
      draft.draftState = 'BIDDING'
      draft.timeRemaining = draft.config.biddingTimer
    })

    // Play tada sound for nomination
    audioService.playTadaSound()

    this.startBiddingPhase(player)
  }

  startBiddingPhase(player) {
    const { config } = this.store.getState()
    this.biddingTimeRemaining = config.biddingTimer
    this.biddingStartTime = Date.now() // Track when bidding started
    
    this.startBiddingTimer()

    // Start AI bidding after small delay
    workerTimers.setTimeout(() => {
      this.processAIBids(player)
    }, 1000 + Math.random() * 2000) // 1-3 second delay
  }

  startBiddingTimer() {
    const timer = workerTimers.setInterval(() => {
      this.biddingTimeRemaining--
      this.store.setState((draft) => {
        draft.timeRemaining = this.biddingTimeRemaining
      })

      // Play audio beeps for timer warnings during bidding
      if (this.biddingTimeRemaining === 10) {
        audioService.playTimerWarning()
      } else if (this.biddingTimeRemaining <= 5 && this.biddingTimeRemaining >= 1) {
        audioService.playTimerUrgent()
      }

      if (this.biddingTimeRemaining <= 0) {
        workerTimers.clearInterval(timer)
        this.completeBidding()
      }
    }, 1000)

    this.biddingTimer = timer
  }

  processAIBids(player) {
    const state = this.store.getState()
    // Drop stale callbacks. processAIBids is scheduled via setTimeout and the
    // pending timers are NOT cleared when an auction ends, so a callback from a
    // previous player can fire after the next auction has already opened. If it
    // ran, it would evaluate bid eligibility against the WRONG player — e.g. a
    // team restricted to its remaining mandatory positions (QB/TE) is eligible
    // for a stale QB auction, and its bid would land on the current RB auction,
    // letting it win a position it should be blocked from. Guard on currentPlayer
    // identity, not just draftState (both auctions are in the BIDDING state).
    if (state.draftState !== 'BIDDING' || state.currentPlayer?.id !== player.id) return

    const { teams, currentBid } = state

    // Filter out teams at roster capacity, plus teams whose remaining slots
    // are mandatory-only and don't include this player's position.
    const eligibleTeams = this.bidEligibleTeams(teams, player)
    
    // Calculate time elapsed since bidding started
    const timeElapsed = Date.now() - this.biddingStartTime
    
    // Check for auto-pilot bidding first
    const humanTeam = eligibleTeams.find(t => t.isHuman)
    if (humanTeam && humanTeam.isAutoPilot && humanTeam.canAffordPlayer(currentBid + 1) && humanTeam.id !== state.currentBidder) {
      const shouldBid = autoPilotService.shouldBid(player, currentBid, state.availablePlayers, humanTeam, state.currentBidder)
      if (shouldBid) {
        const bidAmount = autoPilotService.calculateBidAmount(player, currentBid, state.availablePlayers, humanTeam)
        if (bidAmount > currentBid) {
          this.placeBid(humanTeam.id, bidAmount)

          // Schedule next potential bid
          workerTimers.setTimeout(() => {
            this.processAIBids(player)
          }, 1000 + Math.random() * 2000) // 1-3 second delay for auto-pilot
          return
        }
      }
    }

    // Use AI Manager to process bidding - only with eligible teams
    const totalBiddingTime = state.config.biddingTimer * 1000 // Convert to milliseconds
    const aiBid = this.aiManager.processAIBidding(eligibleTeams, player, currentBid, state.availablePlayers, timeElapsed, totalBiddingTime, state.currentBidder)
    
    if (aiBid && aiBid.amount > currentBid) {
      this.placeBid(aiBid.team.id, aiBid.amount)

      // Schedule next potential AI bid
      workerTimers.setTimeout(() => {
        this.processAIBids(player)
      }, this.aiManager.getBiddingDelay(totalBiddingTime))
    } else if (this.biddingTimeRemaining > 3) {
      // Nobody bid this round — could just be unlucky zone-out / skip rolls.
      // Re-attempt with fresh rolls while the bidding window still has room.
      // The time guard bounds retries within the actual auction window so
      // the loop terminates cleanly for players nobody truly wants.
      workerTimers.setTimeout(() => {
        this.processAIBids(player)
      }, this.aiManager.getBiddingDelay(totalBiddingTime))
    }
  }


  placeBid(teamId, amount) {
    // Ensure bid amount is always a whole number
    const roundedAmount = Math.round(amount)
    const state = this.store.getState()
    const { currentBid, config, teams } = state
    const team = teams.find(t => t.id === teamId)
    if (!team) return false

    const result = BidValidator.validateBid(team, roundedAmount, currentBid, config)
    if (!result.isValid) return false

    this.store.setState((draft) => {
      draft.currentBid = roundedAmount
      draft.currentBidder = teamId

      // Reset timer if bid placed with 5 or less seconds remaining
      if (this.biddingTimeRemaining <= 5) {
        this.biddingTimeRemaining = 5
        draft.timeRemaining = 5
      }
    })

    return true
  }

  completeBidding() {
    if (this.biddingTimer) {
      workerTimers.clearInterval(this.biddingTimer)
    }

    // Complete the purchase
    const state = this.store.getState()
    const winningTeam = state.teams.find(t => t.id === state.currentBidder)
    const player = state.currentPlayer
    
    if (player) {
      if (winningTeam) {
        // Player was won by a team
        player.purchasePrice = state.currentBid
        winningTeam.roster.push(player)
        winningTeam.remainingBudget -= state.currentBid
        
        // Update team psychology and momentum
        this.updateTeamPsychology(state.teams, winningTeam, player, state.currentBid)
        
        // Play cha-ching sound for completed purchase
        audioService.playChaChingSound()
        
        const winnerNominatorTeam = state.teams.find(t => t.id === state.currentNominator)
        this.store.setState((draft) => {
          draft.draftHistory.push({
            player: player,
            team: winningTeam.name,
            nominator: winnerNominatorTeam ? winnerNominatorTeam.name : null,
            price: state.currentBid,
            timestamp: Date.now()
          })

          draft.availablePlayers = draft.availablePlayers.filter(p => p.id !== player.id)
          draft.currentPlayer = null
          draft.currentBid = 0
          draft.currentBidder = null
          draft.draftState = 'NOMINATING'
        })
      } else {
        // No one bid on this player - nominator wins for $1 if they can afford it
        const nominatorTeam = state.teams.find(t => t.id === state.currentNominator)
        if (nominatorTeam && nominatorTeam.canBid()) {
          player.purchasePrice = 1
          nominatorTeam.roster.push(player)
          nominatorTeam.remainingBudget -= 1

          // Update team psychology and momentum
          this.updateTeamPsychology(state.teams, nominatorTeam, player, 1)

          // Play cha-ching sound for completed purchase
          audioService.playChaChingSound()

          this.store.setState((draft) => {
            draft.draftHistory.push({
              player: player,
              team: nominatorTeam.name,
              nominator: nominatorTeam.name,
              price: 1,
              timestamp: Date.now()
            })

            draft.availablePlayers = draft.availablePlayers.filter(p => p.id !== player.id)
            draft.currentPlayer = null
            draft.currentBid = 0
            draft.currentBidder = null
            draft.draftState = 'NOMINATING'
          })
        } else {
          // Fallback - shouldn't happen but handle gracefully
          const fallbackNominatorTeam = state.teams.find(t => t.id === state.currentNominator)
          this.store.setState((draft) => {
            draft.draftHistory.push({
              player: player,
              team: 'No Bids',
              nominator: fallbackNominatorTeam ? fallbackNominatorTeam.name : null,
              price: 0,
              timestamp: Date.now()
            })
            
            draft.availablePlayers = draft.availablePlayers.filter(p => p.id !== player.id)
            draft.currentPlayer = null
            draft.currentBid = 0
            draft.currentBidder = null
            draft.draftState = 'NOMINATING'
          })
        }
      }
    }
    
    this.currentNominatorIndex++

    // Move to next nomination
    workerTimers.setTimeout(() => {
      this.startNominationPhase()
    }, 2000) // 2 second delay between picks
  }

  updateTeamPsychology(teams, winningTeam, player, finalPrice) {
    const valueVsPrice = player.estimatedValue - finalPrice
    const outcome = {
      won: true,
      value: valueVsPrice,
      price: finalPrice,
      player: player
    }
    
    // Update winning team
    winningTeam.recentBidOutcomes.push(outcome)
    if (winningTeam.recentBidOutcomes.length > 5) {
      winningTeam.recentBidOutcomes.shift() // Keep only last 5
    }
    
    // Update momentum for winning team
    if (valueVsPrice >= 5) {
      winningTeam.momentum = 'winning' // Great deal
    } else if (valueVsPrice <= -8) {
      winningTeam.momentum = 'losing' // Overpaid significantly
    } else {
      winningTeam.momentum = 'neutral'
    }
    
    // Update losing teams that were bidding
    teams.forEach(team => {
      if (team !== winningTeam && !team.isHuman) {
        const lossOutcome = {
          won: false,
          value: valueVsPrice,
          price: finalPrice,
          player: player
        }
        
        team.recentBidOutcomes.push(lossOutcome)
        if (team.recentBidOutcomes.length > 5) {
          team.recentBidOutcomes.shift()
        }
        
        // Teams that lost recent bids might get more aggressive
        const recentLosses = team.recentBidOutcomes.filter(o => !o.won).length
        if (recentLosses >= 3) {
          team.momentum = 'losing'
        } else if (recentLosses <= 1) {
          team.momentum = 'winning'
        } else {
          team.momentum = 'neutral'
        }
      }
    })
  }

  completeDraft() {
    this.store.setState((draft) => {
      draft.draftState = 'COMPLETE'
    })
  }

  clearTimers() {
    if (this.nominationTimer) {
      workerTimers.clearInterval(this.nominationTimer)
      this.nominationTimer = null
    }
    if (this.biddingTimer) {
      workerTimers.clearInterval(this.biddingTimer)
      this.biddingTimer = null
    }
  }

  pauseDraft() {
    this.clearTimers()
    this.store.setState((draft) => {
      draft.draftState = 'PAUSED'
    })
  }

  resumeDraft() {
    const { currentPlayer, config } = this.store.getState()

    this.store.setState((draft) => {
      if (currentPlayer) {
        draft.draftState = 'BIDDING'
      } else {
        draft.draftState = 'NOMINATING'
      }
    })

    // Start timers after state update
    if (currentPlayer) {
      this.startBiddingTimer()

      // Re-kick the AI bidding loop. The processAIBids setTimeout cascade is
      // not tracked by clearTimers, so it dies during the pause (each pending
      // callback early-returns once draftState flips to PAUSED) and would
      // otherwise never restart — leaving the resumed auction with no AI bids
      // until the next nomination. Realign biddingStartTime so timeElapsed
      // reflects the time already spent on this player (the bidding timer
      // resumes from the preserved biddingTimeRemaining), keeping the AI's
      // early-aggressive window consistent across the pause.
      const totalBiddingTime = (config?.biddingTimer ?? 0) * 1000
      this.biddingStartTime = Date.now() - (totalBiddingTime - this.biddingTimeRemaining * 1000)
      workerTimers.setTimeout(() => {
        this.processAIBids(currentPlayer)
      }, 1000 + Math.random() * 2000) // 1-3 second delay, matching startBiddingPhase
    } else {
      this.startNominationPhase()
    }
  }

  skipPlayer() {
    // User wants to skip this player - let AI teams bid it out superfast
    const { currentPlayer, currentBid } = this.store.getState()
    
    if (!currentPlayer || this.store.getState().draftState !== 'BIDDING') {
      return
    }

    // Clear existing bidding timer
    if (this.biddingTimer) {
      workerTimers.clearInterval(this.biddingTimer)
      this.biddingTimer = null
    }

    // Enable skip mode - AI teams will bid without delays
    this.isSkipMode = true
    
    // Run fast AI bidding until no one wants to bid
    this.runFastAIBidding(currentPlayer, currentBid)
  }

  runFastAIBidding(player, startingBid) {
    let currentBid = startingBid
    let currentBidder = this.store.getState().currentBidder
    let bidCount = 0
    const maxBids = 50 // Safety limit to prevent infinite loops
    
    // Simulate time parameters for aggressive bidding logic
    const totalBiddingTime = this.store.getState().config.biddingTimer * 1000
    const timeElapsed = 0 // Start at beginning to trigger aggressive early bidding
    
    // Keep running AI bids until no one wants to bid or we hit the limit
    while (bidCount < maxBids) {
      const { teams, availablePlayers } = this.store.getState()
      
      // Get AI bid with proper time parameters to enable aggressive bidding
      const aiBid = this.aiManager.processAIBidding(teams, player, currentBid, availablePlayers, timeElapsed, totalBiddingTime, currentBidder)
      
      if (!aiBid || aiBid.amount <= currentBid) {
        // No more bids - complete the auction
        break
      }
      
      // Update the bid immediately
      currentBid = aiBid.amount
      currentBidder = aiBid.team.id
      
      this.store.setState((draft) => {
        draft.currentBid = currentBid
        draft.currentBidder = currentBidder
      })
      
      bidCount++
    }
    
    // Complete the bidding
    this.isSkipMode = false
    this.completeBidding()
  }

  simulateDraft() {
    const totalBiddingTime = this.store.getState().config.biddingTimer * 1000
    let nomIdx = 0

    while (true) {
      const state = this.store.getState()
      if (state.availablePlayers.length === 0) break
      if (!state.teams.some(t => t.canBid())) break

      // Use nomination order while it lasts; overflow round-robins teams that can still bid
      let nominatorId
      if (nomIdx < this.nominationOrder.length) {
        nominatorId = this.nominationOrder[nomIdx++]
      } else {
        const eligibleNominators = state.teams.filter(t => t.canBid())
        if (eligibleNominators.length === 0) break
        nominatorId = eligibleNominators[(nomIdx++) % eligibleNominators.length].id
      }

      const nominatorTeam = state.teams.find(t => t.id === nominatorId)
      if (!nominatorTeam || !nominatorTeam.canBid()) continue

      const player = this.aiManager.getAINomination(
        nominatorTeam,
        this.marketViableNominations(
          nominatorTeam,
          this.nominationPoolFor(nominatorTeam, state.availablePlayers),
          state.teams,
          state.availablePlayers
        )
      )
      if (!player) continue

      // Synchronous bidding — includeAllTeams=true so human team participates
      let currentBid = 1
      let currentBidder = nominatorId
      let bidCount = 0
      while (bidCount < 50) {
        const { teams, availablePlayers } = this.store.getState()
        const eligibleTeams = this.bidEligibleTeams(teams, player)

        const bid = this.aiManager.processAIBidding(
          eligibleTeams, player, currentBid, availablePlayers, 0, totalBiddingTime, currentBidder, true
        )
        if (!bid || bid.amount <= currentBid) break
        currentBid = bid.amount
        currentBidder = bid.team.id
        bidCount++
      }

      // Assign player to winner (same mutation pattern as completeBidding)
      const finalState = this.store.getState()
      const winner = finalState.teams.find(t => t.id === currentBidder)
        ?? finalState.teams.find(t => t.id === nominatorId)
      const finalPrice = (winner && winner.id === currentBidder) ? currentBid : 1

      if (winner) {
        player.purchasePrice = finalPrice
        winner.roster.push(player)
        winner.remainingBudget -= finalPrice
        this.updateTeamPsychology(finalState.teams, winner, player, finalPrice)
      }

      this.store.setState((draft) => {
        draft.draftHistory.push({
          player,
          team: winner?.name ?? nominatorTeam.name,
          nominator: nominatorTeam.name,
          price: finalPrice,
          timestamp: Date.now()
        })
        draft.availablePlayers = draft.availablePlayers.filter(p => p.id !== player.id)
        draft.currentPlayer = null
        draft.currentBid = 0
        draft.currentBidder = null
      })
    }

    this.completeDraft()
  }
}