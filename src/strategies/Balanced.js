import { BaseStrategy } from './BaseStrategy.js'

export class Balanced extends BaseStrategy {
  constructor() {
    super('Balanced')
    // Slight baseline aggression so Balanced isn't always undercut by
    // strategies with explicit position multipliers (S&S 1.12-1.15, HeroRB 1.4)
    this.preferences = {
      positionMultipliers: {
        'QB': 1.10,
        'RB': 1.12,
        'WR': 1.12,
        'TE': 1.08,
        'K': 0.85,
        'DST': 0.85
      }
    }
  }

  evaluateBid(player, currentBid, adjustedValue, availablePlayers) {
    // Pacing is now baked into adjustedValue by BaseStrategy. Just bid
    // anywhere within a 90-110% randomized threshold of that value.
    const randomFactor = 0.9 + Math.random() * 0.2
    return currentBid < adjustedValue * randomFactor
  }

  getBidIncrement(player, currentBid, adjustedValue) {
    // Consistent $1-2 increments most of the time
    if (Math.random() < 0.8) return 1
    if (Math.random() < 0.9) return this.si(2)

    // Occasionally larger increment for value plays
    return this.si(Math.floor(Math.random() * 3) + 3)
  }

  getSkipProbability() {
    return 0.2 // Moderate skip rate
  }

  selectNomination(availablePlayers) {
    availablePlayers = this.filterNominationPool(availablePlayers)
    // Balanced approach to nominations
    // 35% want, 35% price enforce, 30% position need
    const rand = Math.random()
    
    if (rand < 0.35) {
      // Nominate someone we want
      const wantedPlayers = availablePlayers.filter(p => this.shouldNominate(p))
      if (wantedPlayers.length > 0) {
        return wantedPlayers[Math.floor(Math.random() * wantedPlayers.length)]
      }
    } else if (rand < 0.7) {
      // Price enforce
      const expensivePlayers = [...availablePlayers]
        .filter(p => p.estimatedValue >= this.sd(20) && !this.shouldNominate(p))
        .sort((a, b) => b.estimatedValue - a.estimatedValue)
      
      if (expensivePlayers.length > 0) {
        return expensivePlayers[Math.floor(Math.random() * Math.min(5, expensivePlayers.length))]
      }
    }
    
    // Position need or fallback
    return super.selectNomination(availablePlayers)
  }
}