import { random } from '../utils/rng.js'
import { BaseStrategy } from './BaseStrategy.js'

export class ValueHunter extends BaseStrategy {
  constructor() {
    super('Value Hunter')
    this.preferences = {
      positionMultipliers: {
        'QB': 1.08,
        'RB': 1.10,
        'WR': 1.10,
        'TE': 1.05,
        'K': 0.9,
        'DST': 0.9
      }
    }
  }

  evaluateBid(player, currentBid, adjustedValue, availablePlayers) {
    // Bid up to adjustedValue with high probability across all discount tiers.
    // Value Hunter "selectivity" is now expressed as a thinner top-end cap
    // (no overpaying past 1.10x adjusted) rather than dropouts.
    if (currentBid >= adjustedValue * 1.10) return false

    const valueDiscount = (adjustedValue - currentBid) / adjustedValue
    if (valueDiscount < 0) return random() < 0.70   // overpay slightly
    if (valueDiscount < 0.10) return random() < 0.92
    if (valueDiscount < 0.20) return random() < 0.97
    return random() < 0.99
  }

  getBidIncrement(player, currentBid, adjustedValue) {
    // Even value hunters will jump up when severely undervalued
    const undervaluedAmount = adjustedValue - currentBid
    
    if (undervaluedAmount >= this.sd(20)) {
      // Jump $8-12 for severely undervalued players (more conservative than base)
      return this.si(Math.floor(random() * 5) + 8) // $8-12
    }

    if (undervaluedAmount >= this.sd(10)) {
      // Jump $4-6 for significantly undervalued players
      return this.si(Math.floor(random() * 3) + 4) // $4-6
    }
    
    // Always conservative $1 increments otherwise
    return 1
  }

  getSkipProbability() {
    return 0.35 // High skip probability - very selective
  }

  shouldNominate(player, availablePlayers = []) {
    // Only nominate players we think are undervalued
    const adjustedValue = this.getAdjustedPlayerValue(player, availablePlayers)
    return adjustedValue >= player.estimatedValue * 1.1 // 10% premium required
  }

  selectNomination(availablePlayers) {
    availablePlayers = this.filterNominationPool(availablePlayers)
    // 60% chance to nominate undervalued player we want
    if (random() < 0.6) {
      const undervaluedPlayers = [...availablePlayers]
        .filter(p => this.shouldNominate(p, availablePlayers))
        .sort((a, b) => {
          const aValue = this.getAdjustedPlayerValue(a, availablePlayers) / a.estimatedValue
          const bValue = this.getAdjustedPlayerValue(b, availablePlayers) / b.estimatedValue
          return bValue - aValue
        })
      
      if (undervaluedPlayers.length > 0) {
        return undervaluedPlayers[0] // Take most undervalued
      }
    }
    
    // 30% chance to price enforce someone expensive
    if (random() < 0.75) {
      const expensivePlayers = [...availablePlayers]
        .filter(p => p.estimatedValue >= this.sd(30))
        .sort((a, b) => b.estimatedValue - a.estimatedValue)
      
      if (expensivePlayers.length > 0) {
        return expensivePlayers[Math.floor(random() * Math.min(2, expensivePlayers.length))]
      }
    }
    
    return super.selectNomination(availablePlayers)
  }

  getEarlyDraftMultiplier() {
    // Less aggressive early in draft - wait for value
    return 1.0 + random() * 0.2 // 100% to 120%
  }
}