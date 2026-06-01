import { BaseStrategy } from './BaseStrategy.js'

export class HeroRB extends BaseStrategy {
  constructor() {
    super('Hero RB')
    this.preferences = {
      positionMultipliers: {
        'QB': 1.0,
        'RB': 1.18, // Reduced from 1.5 to 1.18
        'WR': 0.95, // Increased from 0.9 to 0.95
        'TE': 0.95, // Increased from 0.9 to 0.95
        'K': 0.9,
        'DST': 0.9
      }
    }
  }

  evaluateBid(player, currentBid, adjustedValue, availablePlayers) {
    // Moderately aggressive on first elite RB (toned down significantly)
    if (player.position === 'RB' && player.estimatedValue >= 35 && this.team.roster.filter(p => p.position === 'RB').length === 0) {
      const randomFactor = 0.98 + Math.random() * 0.17 // 98% to 115% (much more conservative)
      const bidThreshold = adjustedValue * randomFactor
      return currentBid < bidThreshold
    }
    
    // Conservative on other RBs after getting hero
    if (player.position === 'RB' && this.team.roster.filter(p => p.position === 'RB').length > 0) {
      const randomFactor = 0.85 + Math.random() * 0.15 // 85% to 100%
      const bidThreshold = adjustedValue * randomFactor
      return currentBid < bidThreshold
    }
    
    // Standard evaluation for non-RBs
    return super.evaluateBid(player, currentBid, adjustedValue, availablePlayers)
  }

  getBidIncrement(player, currentBid, adjustedValue) {
    // Aggressive increments on elite RBs when we have none
    if (player.position === 'RB' && player.estimatedValue >= 30 && this.team.roster.filter(p => p.position === 'RB').length === 0) {
      if (Math.random() < 0.6) return Math.floor(Math.random() * 6) + 3 // $3-8
      return 2
    }
    
    return super.getBidIncrement(player, currentBid, adjustedValue)
  }

  getSkipProbability() {
    return 0.1 // Aggressive bidding style
  }

  selectNomination(availablePlayers) {
    availablePlayers = this.filterNominationPool(availablePlayers)
    // 70% chance to nominate elite RB if we don't have one
    const hasRB = this.team.roster.some(p => p.position === 'RB')
    
    if (!hasRB && Math.random() < 0.7) {
      const eliteRBs = [...availablePlayers]
        .filter(p => p.position === 'RB' && p.estimatedValue >= 30)
        .sort((a, b) => b.estimatedValue - a.estimatedValue)
      
      if (eliteRBs.length > 0) {
        return eliteRBs[0] // Nominate the best available RB
      }
    }
    
    return super.selectNomination(availablePlayers)
  }
}