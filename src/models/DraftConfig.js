export class DraftConfig {
  constructor(options = {}) {
    this.numberOfTeams = options.numberOfTeams || 12
    this.budgetPerTeam = options.budgetPerTeam || 200
    this.humanTeamName = options.humanTeamName || 'Your Team'
    this.humanDraftPosition = options.humanDraftPosition || 1
    this.nominationTimer = options.nominationTimer || 20
    this.biddingTimer = options.biddingTimer || 20
    this.minBidIncrement = options.minBidIncrement || 1
    this.scoringFormat = options.scoringFormat || 'halfPPR'
    this.aiTeamStrategies = options.aiTeamStrategies || []

    this.rosterPositions = {
      QB: 1,
      RB: 2,
      WR: 2,
      TE: 1,
      FLEX: 1,
      K: 1,
      DST: 1,
      BENCH: 6,
      ...options.rosterPositions
    }
  }
  
  get totalRosterSize() {
    return Object.values(this.rosterPositions).reduce((sum, count) => sum + count, 0)
  }
  
  validate() {
    const errors = []
    
    if (this.numberOfTeams < 8 || this.numberOfTeams > 14) {
      errors.push('Number of teams must be between 8 and 14')
    }
    
    if (this.budgetPerTeam < 100 || this.budgetPerTeam > 2000) {
      errors.push('Budget per team must be between $100 and $2000')
    }
    
    if (this.humanDraftPosition < 1 || this.humanDraftPosition > this.numberOfTeams) {
      errors.push('Human draft position must be valid team position')
    }
    
    if (this.totalRosterSize < 10 || this.totalRosterSize > 20) {
      errors.push('Total roster size must be between 10 and 20 players')
    }
    
    return {
      isValid: errors.length === 0,
      errors
    }
  }
}

export const DEFAULT_CONFIGS = {
  standard: {
    numberOfTeams: 12,
    budgetPerTeam: 200,
    scoringFormat: 'standard',
    rosterPositions: {
      QB: 1,
      RB: 2,
      WR: 2,
      TE: 1,
      FLEX: 1,
      K: 1,
      DST: 1,
      BENCH: 6
    }
  },
  superflex: {
    numberOfTeams: 12,
    budgetPerTeam: 200,
    scoringFormat: 'halfPPR',
    rosterPositions: {
      QB: 1,
      RB: 2,
      WR: 2,
      TE: 1,
      FLEX: 1,
      SUPERFLEX: 1,
      K: 1,
      DST: 1,
      BENCH: 5
    }
  }
}