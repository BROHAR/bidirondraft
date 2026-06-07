import { random } from '../utils/rng.js'
import { BaseStrategy } from './BaseStrategy.js'

export class StarsAndScrubs extends BaseStrategy {
  constructor() {
    super('Stars and Scrubs')
    this.preferences = {
      positionMultipliers: {
        'QB': 1.0,
        'RB': 1.15,  // Reduced from 1.3 to 1.15
        'WR': 1.12,  // Reduced from 1.3 to 1.12
        'TE': 1.08,  // Reduced from 1.2 to 1.08
        'K': 0.8,    // Increased from 0.5 to 0.8
        'DST': 0.8   // Increased from 0.5 to 0.8
      }
    }
  }

  evaluateBid(player, currentBid, adjustedValue, availablePlayers) {
    // Mid-tier ($8-15): bid based on adjustedValue but with reduced position
    // multipliers (handled by getPositionMultiplier). Removed the hard "dead
    // zone" since it created structural underspend in those tiers.
    if (player.estimatedValue >= this.sd(8) && player.estimatedValue <= this.sd(15)) {
      const randomFactor = 0.85 + random() * 0.20
      return currentBid < adjustedValue * randomFactor && random() < 0.7
    }

    // Very aggressive on elite players (value >= 30) - willing to pay market value
    if (player.estimatedValue >= this.sd(30)) {
      // 15% chance to completely drop out (reduced from 30% - more competitive)
      if (random() < 0.15) return false
      
      // Otherwise, bid very aggressively (90% to 120% of adjusted value, no hard cap)
      const randomFactor = 0.90 + random() * 0.30
      const bidThreshold = adjustedValue * randomFactor // Removed artificial cap
      
      if (currentBid < bidThreshold) return true
    }
    
    // Moderate on higher mid-tier players (value 16-29) - only above the blind spot
    if (player.estimatedValue > this.sd(15)) {
      // 15% chance to skip these entirely (prefer stars or scrubs)
      if (random() < 0.15) return false
      
      const randomFactor = 0.85 + random() * 0.20 // 85% to 105%
      const bidThreshold = adjustedValue * randomFactor
      
      if (currentBid < bidThreshold) return true
    }
    
    // More aggressive on scrub-tier players (<$8) - need to fill roster cheaply
    if (player.estimatedValue < this.sd(8)) {
      const randomFactor = 0.60 + random() * 0.35 // 60% to 95%
      const bidThreshold = adjustedValue * randomFactor
      
      if (currentBid < bidThreshold && random() < 0.6) return true
    }
    
    return false
  }

  getBidIncrement(player, currentBid, adjustedValue) {
    // More aggressive increments on star players
    if (player.estimatedValue >= this.sd(30)) {
      if (random() < 0.4) return this.si(Math.floor(random() * 5) + 3) // $3-7
      if (random() < 0.7) return this.si(2)
      return 1
    }

    // Conservative increments on scrubs
    if (player.estimatedValue < this.sd(15)) {
      return 1 // Always $1 increments
    }
    
    return super.getBidIncrement(player, currentBid, adjustedValue)
  }

  getSkipProbability() {
    return 0.15 // More likely to bid aggressively
  }

  selectNomination(availablePlayers) {
    availablePlayers = this.filterNominationPool(availablePlayers)
    // 60% chance to nominate elite player for price enforcement
    if (random() < 0.6) {
      const elitePlayers = [...availablePlayers]
        .filter(p => p.estimatedValue >= this.sd(30))
        .sort((a, b) => b.estimatedValue - a.estimatedValue)
      
      if (elitePlayers.length > 0) {
        return elitePlayers[Math.floor(random() * Math.min(3, elitePlayers.length))]
      }
    }
    
    return super.selectNomination(availablePlayers)
  }
}