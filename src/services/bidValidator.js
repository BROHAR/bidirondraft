export class BidValidator {
  static validateBid(team, amount, currentBid, config) {
    const errors = []
    
    // Check minimum bid increment
    if (amount < currentBid + config.minBidIncrement) {
      errors.push(`Minimum bid is $${currentBid + config.minBidIncrement}`)
    }
    
    // Check team budget constraints
    const rosterSpotsNeeded = team.getRosterSpotsRemaining() - 1
    const maxAllowableBid = team.remainingBudget - rosterSpotsNeeded
    
    if (amount > maxAllowableBid) {
      errors.push(`Maximum bid is $${maxAllowableBid} (need $${rosterSpotsNeeded} for remaining spots)`)
    }
    
    // Check if team has roster space
    if (!team.hasRosterSpace()) {
      errors.push('Roster is full')
    }
    
    // Check if amount is reasonable (not negative, not absurdly high)
    if (amount < 1) {
      errors.push('Bid must be at least $1')
    }
    
    if (amount > team.budget) {
      errors.push('Bid cannot exceed team budget')
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      maxAllowableBid
    }
  }
  
  static calculateMaxBid(team) {
    const rosterSpotsNeeded = team.getRosterSpotsRemaining() - 1
    return team.remainingBudget - rosterSpotsNeeded
  }
  
  static validateNomination(team, player, availablePlayers) {
    const errors = []
    
    // Check if player is available
    if (!availablePlayers.find(p => p.id === player.id)) {
      errors.push('Player is not available')
    }
    
    // Check if team can afford minimum bid
    if (team.remainingBudget < 1) {
      errors.push('Insufficient budget for nomination')
    }
    
    return {
      isValid: errors.length === 0,
      errors
    }
  }
}