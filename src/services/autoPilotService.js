import { BaseStrategy } from '../strategies/BaseStrategy.js'
import { Balanced } from '../strategies/Balanced.js'
import { ValueHunter } from '../strategies/ValueHunter.js'
import { StarsAndScrubs } from '../strategies/StarsAndScrubs.js'
import { ZeroRB } from '../strategies/ZeroRB.js'
import { HeroRB } from '../strategies/HeroRB.js'
import { LateRoundQB } from '../strategies/LateRoundQB.js'
import { Taco } from '../strategies/TacoStrategy.js'

export class AutoPilotService {
  constructor() {
    this.strategies = {
      'Balanced': Balanced,
      'ValueHunter': ValueHunter,
      'StarsAndScrubs': StarsAndScrubs,
      'ZeroRB': ZeroRB,
      'HeroRB': HeroRB,
      'LateRoundQB': LateRoundQB,
      'Taco': Taco
    }
    this.currentStrategy = null
  }

  initializeStrategy(humanTeam, strategyName) {
    const StrategyClass = this.strategies[strategyName] || Balanced
    this.currentStrategy = new StrategyClass()
    
    // Set the team for the strategy
    this.currentStrategy.setTeam(humanTeam)
    
    // Apply player value adjustments to the strategy's value modifiers
    this.applyPlayerValueAdjustments(humanTeam)
    
    return this.currentStrategy
  }

  applyPlayerValueAdjustments(humanTeam) {
    if (!humanTeam.playerValueAdjustments || !this.currentStrategy) {
      return
    }

    // Apply user's player value adjustments to the strategy's value modifiers
    for (const [playerId, multiplier] of humanTeam.playerValueAdjustments) {
      humanTeam.valueModifiers.set(playerId, multiplier)
    }
  }

  shouldNominate(player, availablePlayers, humanTeam) {
    if (!this.currentStrategy || !humanTeam.isAutoPilot) {
      return false
    }

    return this.currentStrategy.shouldNominate(player, availablePlayers)
  }

  selectNomination(availablePlayers, humanTeam) {
    if (!this.currentStrategy || !humanTeam.isAutoPilot) {
      return null
    }

    // Filter players that the human team can afford
    const affordablePlayers = availablePlayers.filter(player =>
      humanTeam.canAffordPlayer(player.estimatedValue)
    )

    if (affordablePlayers.length === 0) {
      // Nothing in the strategy's preferred range — nominate the cheapest
      // available player. canBid() was true when this callback was scheduled,
      // so the team can always win their own nomination for $1 if no one bids.
      // Falling back here is what keeps the draft from stalling.
      if (availablePlayers.length === 0) return null
      return [...availablePlayers].sort((a, b) => a.estimatedValue - b.estimatedValue)[0]
    }

    // Use the strategy to select a nomination
    return this.currentStrategy.selectNomination(affordablePlayers)
  }

  shouldBid(player, currentBid, availablePlayers, humanTeam, currentBidder = null) {
    if (!this.currentStrategy || !humanTeam.isAutoPilot) {
      return false
    }

    // Don't bid if this team is already the highest bidder
    if (currentBidder && humanTeam.id === currentBidder) {
      return false
    }

    return this.currentStrategy.shouldBid(player, currentBid, availablePlayers)
  }

  calculateBidAmount(player, currentBid, availablePlayers, humanTeam) {
    if (!this.currentStrategy || !humanTeam.isAutoPilot) {
      return 0
    }

    // Get the adjusted player value using team's custom adjustments
    const adjustedValue = this.currentStrategy.getAdjustedPlayerValue(player, availablePlayers)
    
    // Use the strategy to calculate the bid amount
    const bidAmount = this.currentStrategy.calculateBidAmount(player, currentBid, adjustedValue, availablePlayers)
    
    // Ensure the bid doesn't exceed the team's max bid
    return Math.min(bidAmount, humanTeam.maxBid)
  }

  getNextAction(humanTeam, currentPlayer, currentBid, availablePlayers, draftState, currentNominator = null) {
    if (!humanTeam.isAutoPilot || !this.currentStrategy) {
      return { type: 'manual', description: 'Manual control' }
    }

    if (draftState === 'NOMINATING' && humanTeam.id === currentNominator) {
      const nomination = this.selectNomination(availablePlayers, humanTeam)
      return {
        type: 'nominate',
        player: nomination,
        description: nomination ? 
          `Will nominate ${nomination.name} (${nomination.position} - $${nomination.estimatedValue})` :
          'Looking for player to nominate...'
      }
    }

    if (draftState === 'BIDDING' && currentPlayer) {
      const shouldBid = this.shouldBid(currentPlayer, currentBid, availablePlayers, humanTeam)
      if (shouldBid) {
        const bidAmount = this.calculateBidAmount(currentPlayer, currentBid, availablePlayers, humanTeam)
        return {
          type: 'bid',
          amount: bidAmount,
          description: `Will bid $${bidAmount} for ${currentPlayer.name}`
        }
      } else {
        return {
          type: 'pass',
          description: `Passing on ${currentPlayer.name}`
        }
      }
    }

    return { type: 'waiting', description: 'Waiting for turn...' }
  }

  setStrategy(strategyName, humanTeam) {
    if (humanTeam && humanTeam.isAutoPilot) {
      this.initializeStrategy(humanTeam, strategyName)
      humanTeam.autoPilotStrategy = strategyName
    }
  }
}

export const autoPilotService = new AutoPilotService()