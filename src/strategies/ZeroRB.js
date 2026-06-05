import { BaseStrategy } from './BaseStrategy.js'

export class ZeroRB extends BaseStrategy {
  constructor() {
    super('Zero RB')
    this.preferences = {
      positionMultipliers: {
        'QB': 1.05,
        'RB': 0.7,  // Less extreme discount - from 0.4 to 0.7
        'WR': 1.15, // Reduced from 1.4 to 1.15
        'TE': 1.12, // Reduced from 1.3 to 1.12
        'K': 0.9,
        'DST': 0.9
      }
    }
  }

  evaluateBid(player, currentBid, adjustedValue, availablePlayers) {
    // Strategy identity: never bid on premium RBs.
    if (player.position === 'RB' && player.estimatedValue > this.sd(20)) {
      return false
    }

    if (player.position === 'WR' && player.estimatedValue >= this.sd(25)) {
      const randomFactor = 0.95 + Math.random() * 0.15
      return currentBid < adjustedValue * randomFactor
    }

    if (player.position === 'TE' && player.estimatedValue >= this.sd(15)) {
      const randomFactor = 0.98 + Math.random() * 0.12
      return currentBid < adjustedValue * randomFactor
    }

    if (player.position === 'RB') {
      // Cheap RBs only when there's an actual need
      const randomFactor = 0.60 + Math.random() * 0.25
      const bidThreshold = adjustedValue * randomFactor
      if (this.team.getPositionNeed('RB') <= 0) return false
      return currentBid < bidThreshold && Math.random() < 0.5
    }

    return super.evaluateBid(player, currentBid, adjustedValue, availablePlayers)
  }

  getBidIncrement(player, currentBid, adjustedValue) {
    // Aggressive increments on premium WR/TE
    if ((player.position === 'WR' || player.position === 'TE') && player.estimatedValue >= this.sd(20)) {
      if (Math.random() < 0.5) return this.si(Math.floor(Math.random() * 4) + 2) // $2-5
      return 1
    }
    
    return super.getBidIncrement(player, currentBid, adjustedValue)
  }

  getSkipProbability() {
    return 0.1 // Very aggressive bidding style
  }

  selectNomination(availablePlayers) {
    availablePlayers = this.filterNominationPool(availablePlayers)
    // 50% chance to nominate expensive RB for price enforcement
    if (Math.random() < 0.5) {
      const expensiveRBs = [...availablePlayers]
        .filter(p => p.position === 'RB' && p.estimatedValue >= this.sd(25))
        .sort((a, b) => b.estimatedValue - a.estimatedValue)
      
      if (expensiveRBs.length > 0) {
        return expensiveRBs[Math.floor(Math.random() * Math.min(3, expensiveRBs.length))]
      }
    }
    
    // 30% chance to nominate premium WR we want
    if (Math.random() < 0.6) {
      const premiumWRs = [...availablePlayers]
        .filter(p => p.position === 'WR' && p.estimatedValue >= this.sd(20))
        .sort((a, b) => b.estimatedValue - a.estimatedValue)
      
      if (premiumWRs.length > 0) {
        return premiumWRs[Math.floor(Math.random() * Math.min(5, premiumWRs.length))]
      }
    }
    
    return super.selectNomination(availablePlayers)
  }
}