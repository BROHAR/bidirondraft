import { validateKeepers, DEFAULT_MAX_KEEPERS } from '../utils/keepers.js'

export class DraftConfig {
  constructor(options = {}) {
    this.numberOfTeams = options.numberOfTeams || 12
    // ?? not || — a cleared budget field parses to NaN, and `NaN || 200`
    // would silently launch a $200 draft the user never asked for. NaN must
    // survive to validate(), which rejects it.
    this.budgetPerTeam = options.budgetPerTeam ?? 200
    this.humanTeamName = options.humanTeamName || 'Your Team'
    this.humanDraftPosition = options.humanDraftPosition || 1
    this.nominationTimer = options.nominationTimer || 20
    this.biddingTimer = options.biddingTimer || 20
    this.minBidIncrement = options.minBidIncrement || 1
    this.scoringFormat = options.scoringFormat || 'halfPPR'
    this.aiTeamStrategies = options.aiTeamStrategies || []
    // Custom AI opponent names, seat-indexed (position − 1) like
    // aiTeamStrategies. Blank/missing seats fall back to "Team N".
    this.aiTeamNames = Array.isArray(options.aiTeamNames) ? options.aiTeamNames : []
    // Keeper league support: pre-draft player retentions (see utils/keepers.js
    // for the entry shape). Empty array = standard redraft league.
    this.keepers = Array.isArray(options.keepers) ? options.keepers : []
    this.maxKeepersPerTeam = Number.isInteger(options.maxKeepersPerTeam)
      ? options.maxKeepersPerTeam
      : DEFAULT_MAX_KEEPERS

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
    
    // Negated in-range form so NaN (empty budget field) fails validation —
    // `NaN < 100 || NaN > 2000` is false and would slip through.
    if (!(this.budgetPerTeam >= 100 && this.budgetPerTeam <= 2000)) {
      errors.push('Budget per team must be between $100 and $2000')
    }
    
    if (this.humanDraftPosition < 1 || this.humanDraftPosition > this.numberOfTeams) {
      errors.push('Human draft position must be valid team position')
    }
    
    if (this.totalRosterSize < 10 || this.totalRosterSize > 20) {
      errors.push('Total roster size must be between 10 and 20 players')
    }

    errors.push(...validateKeepers(this))


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