import { random } from '../utils/rng.js'
import { StarsAndScrubs } from '../strategies/StarsAndScrubs.js'
import { Balanced } from '../strategies/Balanced.js'
import { ZeroRB } from '../strategies/ZeroRB.js'
import { HeroRB } from '../strategies/HeroRB.js'
import { ValueHunter } from '../strategies/ValueHunter.js'
import { LateRoundQB } from '../strategies/LateRoundQB.js'
import { Taco } from '../strategies/TacoStrategy.js'
import { budgetScaleFor } from '../utils/budgetScaling.js'

export class AIManager {
  constructor() {
    this.strategies = [
      StarsAndScrubs,
      Balanced,
      ZeroRB,
      HeroRB,
      ValueHunter,
      LateRoundQB,
      Taco
    ]
  }

  assignStrategies(teams, aiTeamStrategies = [], players = [], aiTeamHomeTeams = []) {
    const aiTeams = teams.filter(team => !team.isHuman)
    const strategyByName = new Map(this.strategies.map(S => [S.name, S]))

    // Pass 1: honor pinned slots. team_${i+1} maps to aiTeamStrategies[i].
    const assignments = new Array(aiTeams.length).fill(null)
    aiTeams.forEach((team, index) => {
      const position = parseInt(team.id.replace('team_', ''), 10)
      const pinned = aiTeamStrategies[position - 1]
      if (pinned && pinned !== 'Mixed' && strategyByName.has(pinned)) {
        assignments[index] = strategyByName.get(pinned)
      }
    })

    // Pass 2: fill unpinned slots with the legacy algorithm (≥50% Stars & Scrubs,
    // remainder cycles through the other strategies, then shuffled).
    const unfilledIndices = assignments
      .map((s, i) => (s === null ? i : -1))
      .filter(i => i !== -1)

    if (unfilledIndices.length > 0) {
      const numStarsAndScrubs = Math.ceil(unfilledIndices.length / 2)
      const fillerPool = []
      for (let i = 0; i < numStarsAndScrubs; i++) {
        fillerPool.push(StarsAndScrubs)
      }
      const otherStrategies = this.strategies.filter(s => s !== StarsAndScrubs)
      const shuffledOthers = [...otherStrategies]
      for (let i = shuffledOthers.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[shuffledOthers[i], shuffledOthers[j]] = [shuffledOthers[j], shuffledOthers[i]]
      }
      const remainingSlots = unfilledIndices.length - numStarsAndScrubs
      for (let i = 0; i < remainingSlots; i++) {
        fillerPool.push(shuffledOthers[i % shuffledOthers.length])
      }
      const shuffled = fillerPool.sort(() => random() - 0.5)
      unfilledIndices.forEach((idx, i) => {
        assignments[idx] = shuffled[i]
      })
    }

    aiTeams.forEach((team, index) => {
      const StrategyClass = assignments[index]
      const strategy = new StrategyClass()

      // Honor a user-pinned home team for Taco bidders; otherwise the Taco
      // constructor's random pick stands. No-op for strategies without one.
      const position = parseInt(team.id.replace('team_', ''), 10)
      const homeTeam = aiTeamHomeTeams[position - 1]
      if (homeTeam && strategy.preferences && 'homeTeam' in strategy.preferences) {
        strategy.preferences.homeTeam = homeTeam
      }

      team.setStrategy(strategy)

      // Generate random do-not-draft list (3-6 players)
      this.generateDoNotDraftList(team, players)

      // Generate value modifiers for players
      this.generateValueModifiers(team, players)
    })
  }

  generateDoNotDraftList(team, players = []) {
    if (!players.length) {
      team.doNotDraftList = new Set()
      return
    }
    const sorted = [...players].sort((a, b) => b.estimatedValue - a.estimatedValue)
    const pool = Math.min(100, sorted.length)
    const numPlayers = 1 + Math.floor(random() * 5)
    const list = new Set()
    let attempts = 50
    while (list.size < numPlayers && attempts-- > 0) {
      list.add(sorted[Math.floor(random() * pool)].id)
    }
    team.doNotDraftList = list
  }

  generateValueModifiers(team, players = []) {
    if (!players.length) {
      team.valueModifiers = new Map()
      return
    }
    const sorted = [...players].sort((a, b) => b.estimatedValue - a.estimatedValue)
    const total = sorted.length
    const valueModifiers = new Map()

    const sampleId = (maxRank) => {
      const pool = Math.min(maxRank, total)
      for (let i = 0; i < 20; i++) {
        const id = sorted[Math.floor(random() * pool)].id
        if (!valueModifiers.has(id)) return id
      }
      return null
    }

    // 1-6 modifiers per team, distributed across three named tiers via
    // weighted random per slot. Magnitudes are intentionally mild (±5-25%)
    // so AI variance is felt without producing whiplash bids. The DND list
    // already covers the "won't draft" case, so no zero-value tier here.
    const numModifiers = 1 + Math.floor(random() * 6)
    for (let i = 0; i < numModifiers; i++) {
      const r = random()
      if (r < 0.4) {
        // Favorite (top 50 by value): +5% to +15%
        const id = sampleId(50)
        if (id) valueModifiers.set(id, 1.05 + random() * 0.10)
      } else if (r < 0.7) {
        // High-value dislike (top 75 by value): -5% to -15%
        const id = sampleId(75)
        if (id) valueModifiers.set(id, 0.85 + random() * 0.10)
      } else {
        // Low-value undervalue (full pool): -10% to -25%
        const id = sampleId(total)
        if (id) valueModifiers.set(id, 0.75 + random() * 0.15)
      }
    }

    team.valueModifiers = valueModifiers
  }

  processAIBidding(teams, currentPlayer, currentBid, availablePlayers, timeElapsed = 0, totalBiddingTime = 20000, currentBidder = null, includeAllTeams = false) {
    const aiTeams = teams.filter(team =>
      (includeAllTeams || !team.isHuman) &&
      team.canBid() &&
      team.canAffordPlayer(currentBid + 1) &&
      team.id !== currentBidder // Don't let teams bid against themselves
    )
    
    // Aggressive early opener: pick the team that values this player the most
    // and place a sizeable opening bid. Threshold lowered to $5 so mid-tier
    // players (Swift $9, Egbuka $11, Burrow $15, etc.) all qualify.
    //
    // The previous "value >= 65% of book" filter excluded most teams late-mid
    // draft — once a team has drafted the position once, getPositionNeedMultiplier
    // returns 0.55 and drags adjustedValue ~$7 below book, failing the filter.
    // For a $15 QB nominated at pick 90+, often only 1-2 QB-needing teams pass;
    // if their stochastic rolls also fail, the auction silently times out at $1.
    //
    // The replacement picks the highest-adjustedValue team unconditionally and
    // caps the bid at *that team's* adjustedValue, so we never force a team to
    // overpay relative to their own valuation. If no team values the player
    // above currentBid, the opener doesn't fire and the normal path takes over.
    let aggressiveWindowPercent
    if (totalBiddingTime < 20000) { // Less than 20 seconds
      aggressiveWindowPercent = 0.50 // Use 50% for short timers
    } else if (totalBiddingTime < 30000) { // 20-30 seconds
      aggressiveWindowPercent = 0.35 // Use 35% for medium timers
    } else { // 30+ seconds
      aggressiveWindowPercent = 0.25 // Use 25% for long timers
    }

    const aggressiveWindow = Math.max(5000, totalBiddingTime * aggressiveWindowPercent) // Minimum 5 seconds
    // $5 opener threshold is tuned for a $200 budget; scale it so it stays
    // proportional under different budgets (the player pool is scaled too).
    const openerScale = budgetScaleFor(aiTeams[0]?.budget)
    if (currentPlayer.estimatedValue >= 5 * openerScale && timeElapsed <= aggressiveWindow && currentBid < currentPlayer.estimatedValue * 0.85) {
      let bestTeam = null
      let bestValue = currentBid
      for (const team of aiTeams) {
        if (!team.draftStrategy) continue
        const v = team.draftStrategy.getAdjustedPlayerValue(currentPlayer, availablePlayers)
        if (v > bestValue) {
          bestTeam = team
          bestValue = v
        }
      }

      if (bestTeam) {
        let minBidPercent, maxBidPercent
        if (totalBiddingTime < 20000) { // Short timers: be more aggressive
          minBidPercent = 0.70 // 70-90% of value
          maxBidPercent = 0.90
        } else { // Normal/long timers: standard aggression
          minBidPercent = 0.60 // 60-85% of value
          maxBidPercent = 0.85
        }

        const targetBid = Math.floor(currentPlayer.estimatedValue * (minBidPercent + random() * (maxBidPercent - minBidPercent)))
        // Cap the opener at the picked team's own adjustedValue so we never
        // force them to bid above what their strategy thinks the player's worth.
        let cappedTarget = Math.min(targetBid, Math.floor(bestValue))
        // ...but a flush team in endgame burn must open at its fair-share spend
        // floor, not a fraction of book. targetBid is book * 0.6-0.85, which
        // ignores surplus entirely; without this lift the opener wins the best
        // remaining players for ~2/3 book unopposed, fills its roster, and
        // strands the surplus (the $1000-tier ZeroRB failure). The floor is a
        // sanctioned overpay — getEndgameSpendFloor already clamps to maxBid
        // (reserving $1 per remaining required slot) and caps non-best players
        // at 2x/4x book until the last 2 burn spots, so this drains money into
        // the best players left, not into scrubs early.
        const endgameFloor = bestTeam.draftStrategy.getEndgameSpendFloor
          ? Math.round(bestTeam.draftStrategy.getEndgameSpendFloor(currentPlayer, availablePlayers))
          : 0
        if (endgameFloor > cappedTarget) cappedTarget = endgameFloor
        const amount = Math.min(bestTeam.maxBid, Math.max(cappedTarget, currentBid + 1))

        return {
          team: bestTeam,
          amount,
          isAggressive: true
        }
      }
    }
    
    // Filter teams that want to bid normally
    const interestedTeams = aiTeams.filter(team => {
      if (!team.draftStrategy) return false
      return team.draftStrategy.shouldBid(currentPlayer, currentBid, availablePlayers)
    })

    if (interestedTeams.length === 0) return null

    // Weight bidder selection by pacing surplus: teams sitting on more
    // unspent budget per remaining pick get picked more often, which lets
    // them push prices up and drain their surplus faster.
    const remaining = [...interestedTeams]
    const remainingWeights = remaining.map(t => {
      const ratio = t.draftStrategy?.getPacingRatio?.() || 1.0
      return Math.max(0.4, ratio)
    })

    // Retry-on-fail: if the weighted pick lands on a team whose stochastic
    // calculateBidAmount can't actually beat currentBid (e.g. cap hit, random
    // miscalculation roll), exclude that team and try another. Without this
    // retry the auction loop terminates prematurely whenever a single picked
    // team can't outbid — even though other interested teams (notably the
    // human's hard-pinned ceiling) were still willing to escalate.
    while (remaining.length > 0) {
      const totalWeight = remainingWeights.reduce((s, w) => s + w, 0)
      let r = random() * totalWeight
      let pickedIdx = 0
      for (let i = 0; i < remaining.length; i++) {
        r -= remainingWeights[i]
        if (r <= 0) { pickedIdx = i; break }
      }
      const biddingTeam = remaining[pickedIdx]
      const adjustedValue = biddingTeam.draftStrategy.getAdjustedPlayerValue(currentPlayer, availablePlayers)
      const bidAmount = biddingTeam.draftStrategy.calculateBidAmount(currentPlayer, currentBid, adjustedValue, availablePlayers)
      if (bidAmount > currentBid) {
        return { team: biddingTeam, amount: bidAmount }
      }
      remaining.splice(pickedIdx, 1)
      remainingWeights.splice(pickedIdx, 1)
    }

    return null
  }

  getAINomination(team, availablePlayers) {
    if (!team.draftStrategy) {
      // Fallback: nominate highest value player
      return [...availablePlayers].sort((a, b) => b.estimatedValue - a.estimatedValue)[0]
    }

    // Endgame surplus targeting (takes precedence over every strategy's own
    // nomination script): a team down to its last burnable slots with budget
    // still to spend shouldn't wait passively for someone else to nominate a
    // player worth buying — slot-preservation keeps it out of scrub auctions,
    // so if no target ever comes to market its money strands. Bring the best
    // player it can still roster to market itself; its own fair-share floor
    // (uncapped on near-best nominees) then drains the surplus on quality.
    const strategy = team.draftStrategy
    const burnSpots = strategy.getBurnableSpotsRemaining?.()
    if (burnSpots > 0 && burnSpots <= 2) {
      // Surplus is judged per BURNABLE slot (raw pacing dilutes across K/DST
      // slots whose bids are capped at a few dollars — a Taco that hoarded
      // kickers read as "under-paced" while sitting on real money).
      const rc = team.config?.rosterPositions || {}
      const totalSpots = Object.values(rc).reduce((s, c) => s + c, 0)
      const expected = team.budget / Math.max(1, totalSpots)
      const owedKdst = team.getRosterSpotsRemaining() - burnSpots
      const burnShare = (team.remainingBudget - owedKdst * strategy.sd(2)) / burnSpots
      if (burnShare > expected) {
        let best = null
        for (const p of availablePlayers) {
          if (strategy.shouldApplyPositionLimits?.(p)) continue
          if (!best || p.estimatedValue > best.estimatedValue) best = p
        }
        if (best && best.estimatedValue > strategy.sd(5)) return best
      }
    }

    return strategy.selectNomination(availablePlayers)
  }

  getBiddingDelay(totalBiddingTime = 20000) {
    // Scale delays based on timer duration
    let scalingFactor
    if (totalBiddingTime < 15000) { // Less than 15 seconds
      scalingFactor = 0.4 // Very fast bidding
    } else if (totalBiddingTime < 20000) { // 15-20 seconds
      scalingFactor = 0.6 // Faster bidding
    } else if (totalBiddingTime < 30000) { // 20-30 seconds
      scalingFactor = 0.8 // Slightly faster
    } else { // 30+ seconds
      scalingFactor = 1.0 // Normal delays
    }
    
    // Realistic AI bidding delays (1-8 seconds, weighted toward 2-4), then scaled
    const delays = [1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 6, 7, 8]
    const baseDelay = delays[Math.floor(random() * delays.length)]
    const scaledDelay = Math.max(500, baseDelay * scalingFactor * 1000) // Minimum 0.5 seconds
    
    return scaledDelay
  }

  shouldSnipeBid() {
    // 10% chance for AI to wait until last 5 seconds
    return random() < 0.1
  }
}