import { BaseStrategy } from './BaseStrategy.js'

export class LateRoundQB extends BaseStrategy {
  constructor() {
    super('Late Round QB')
    this.preferences = {
      positionMultipliers: {
        'QB': 0.75, // Significantly devalue QBs
        'RB': 1.18, // Same as Stars & Scrubs
        'WR': 1.15, // Slightly higher than Stars & Scrubs
        'TE': 1.12, // Higher than Stars & Scrubs
        'K': 0.8,
        'DST': 0.8
      }
    }
  }

  evaluateBid(player, currentBid, adjustedValue, availablePlayers) {
    // Complete blind spot - won't bid on ANY QB over $10 (lowered from $15)
    if (player.position === 'QB' && player.estimatedValue > 10) {
      return false
    }

    // Very aggressive on elite non-QBs (similar to Stars and Scrubs)
    if (player.position !== 'QB' && player.estimatedValue >= 30) {
      const randomFactor = 0.95 + Math.random() * 0.15 // 95% to 110%
      const bidThreshold = adjustedValue * randomFactor
      if (currentBid < bidThreshold) return true
    }

    // Aggressive on good value non-QBs
    if (player.position !== 'QB' && player.estimatedValue >= 15) {
      const randomFactor = 0.9 + Math.random() * 0.15 // 90% to 105%
      const bidThreshold = adjustedValue * randomFactor
      if (currentBid < bidThreshold) return true
    }

    // Conservative on cheaper players and QBs
    if (player.estimatedValue < 15) {
      const randomFactor = 0.7 + Math.random() * 0.2 // 70% to 90%
      const bidThreshold = adjustedValue * randomFactor
      if (currentBid < bidThreshold && Math.random() < 0.4) return true
    }

    return false
  }

  getBidIncrement(player, currentBid, adjustedValue) {
    // Conservative increments on QBs
    if (player.position === 'QB') {
      return Math.random() < 0.8 ? 1 : 2
    }

    // More aggressive increments on premium non-QBs
    if (player.position !== 'QB' && player.estimatedValue >= 30) {
      if (Math.random() < 0.4) return Math.floor(Math.random() * 5) + 3 // $3-7
      if (Math.random() < 0.7) return 2
      return 1
    }

    // Standard increment for other players
    return super.getBidIncrement(player, currentBid, adjustedValue)
  }

  getSkipProbability() {
    return 0.15 // Aggressive like Stars and Scrubs
  }

  selectNomination(availablePlayers) {
    availablePlayers = this.filterNominationPool(availablePlayers)
    // Strategy priorities:
    // 1. Nominate elite non-QBs we want (50% chance)
    // 2. Price enforce expensive QBs we don't want (20% chance)
    // 3. Nominate good value non-QBs (20% chance)
    // 4. Fallback (10% chance)

    // Strategy 1: Nominate elite non-QB we want
    if (Math.random() < 0.5) {
      const eliteNonQBs = [...availablePlayers]
        .filter(p => p.position !== 'QB' && p.estimatedValue >= 25 && this.shouldNominate(p))
        .sort((a, b) => b.estimatedValue - a.estimatedValue)
      
      if (eliteNonQBs.length > 0) {
        return eliteNonQBs[0]
      }
    }

    // Strategy 2: Price enforce expensive QBs
    if (Math.random() < 0.25) {
      const expensiveQBs = [...availablePlayers]
        .filter(p => p.position === 'QB' && p.estimatedValue >= 20)
        .sort((a, b) => b.estimatedValue - a.estimatedValue)
      
      if (expensiveQBs.length > 0) {
        return expensiveQBs[0]
      }
    }

    // Strategy 3: Nominate good value non-QBs
    if (Math.random() < 0.8) {
      const valueNonQBs = [...availablePlayers]
        .filter(p => p.position !== 'QB' && p.estimatedValue >= 15 && this.shouldNominate(p))
        .sort((a, b) => b.estimatedValue - a.estimatedValue)
      
      if (valueNonQBs.length > 0) {
        return valueNonQBs[Math.floor(Math.random() * Math.min(3, valueNonQBs.length))]
      }
    }

    // Fallback: Use parent strategy
    return super.selectNomination(availablePlayers)
  }

  getPositionNeedMultiplier(position) {
    // Less urgent need for QB position
    if (position === 'QB') {
      const need = this.team.getPositionNeed(position)
      if (need <= 0) return 0.7 // Bigger discount if already filled
      if (need >= 1) return 0.9 // Much smaller premium even if needed
      return 0.8
    }

    // Standard multipliers for other positions
    return super.getPositionNeedMultiplier(position)
  }
}