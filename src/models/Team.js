export class Team {
  constructor(id, name, isHuman = false, config = {}) {
    this.id = id
    this.name = name
    this.isHuman = isHuman
    this.config = config
    this.budget = config.budgetPerTeam || 200
    this.remainingBudget = this.budget
    this.roster = []
    this.draftStrategy = null
    this.doNotDraftList = new Set()
    this.valueModifiers = new Map()
    
    // Auto-pilot configuration for human teams
    this.isAutoPilot = isHuman && config.autoPilotEnabled || false
    this.autoPilotStrategy = config.autoPilotStrategy || 'Balanced'
    // User pin map only attaches to the human team. AI teams get a fresh
    // empty Map per construction — otherwise every team would share the user's
    // pin reference via config and the hard-pin branch in BaseStrategy would
    // fire on AI teams too.
    this.playerValueAdjustments = isHuman
      ? (config.playerValueAdjustments || new Map())
      : new Map()
    
    // Track bidding psychology
    this.recentBidOutcomes = [] // Track last 3-5 bidding results
    this.lastNominatedBy = null // Which team nominated the last player we won/lost
    this.momentum = 'neutral' // 'winning', 'losing', 'neutral'
    this.bidCount = 0 // Total number of bids placed
  }
  
  get maxBid() {
    const rosterSpotsNeeded = this.getRosterSpotsRemaining() - 1
    return this.remainingBudget - rosterSpotsNeeded
  }

  getRosterSpotsRemaining() {
    const totalRosterSpots = Object.values(this.config?.rosterPositions || {}).reduce((sum, count) => sum + count, 0)
    return totalRosterSpots - this.roster.length
  }

  getPositionNeed(position) {
    const config = this.config?.rosterPositions || {}
    const positionCount = this.roster.filter(p => p.position === position).length
    return Math.max(0, (config[position] || 0) - positionCount)
  }

  // Surplus players at a position beyond its starting requirement — these are
  // the ones available to fill FLEX / SUPERFLEX slots.
  positionSurplus(position) {
    const config = this.config?.rosterPositions || {}
    const count = this.roster.filter(p => p.position === position).length
    return Math.max(0, count - (config[position] || 0))
  }

  // How many more FLEX-eligible (RB/WR/TE) players the team must still draft to
  // fill its FLEX slots, after surplus beyond the base RB/WR/TE starters is
  // applied. 0 when there is no FLEX slot or the surplus already covers it.
  getFlexNeed() {
    const flexSlots = this.config?.rosterPositions?.FLEX || 0
    if (flexSlots <= 0) return 0
    const surplus = ['RB', 'WR', 'TE'].reduce((s, pos) => s + this.positionSurplus(pos), 0)
    return Math.max(0, flexSlots - surplus)
  }

  // How many more SUPERFLEX-eligible (QB/RB/WR/TE) players are still needed,
  // after FLEX has first claimed the RB/WR/TE surplus.
  getSuperflexNeed() {
    const sfSlots = this.config?.rosterPositions?.SUPERFLEX || 0
    if (sfSlots <= 0) return 0
    const feSurplus = ['RB', 'WR', 'TE'].reduce((s, pos) => s + this.positionSurplus(pos), 0)
    const flexConsumed = Math.min(this.config?.rosterPositions?.FLEX || 0, feSurplus)
    const available = (feSurplus - flexConsumed) + this.positionSurplus('QB')
    return Math.max(0, sfSlots - available)
  }

  canAffordPlayer(price) {
    return price <= this.maxBid
  }

  hasRosterSpace() {
    return this.getRosterSpotsRemaining() > 0
  }

  canBid() {
    return this.hasRosterSpace() && this.maxBid >= 1
  }
  
  setStrategy(strategy) {
    this.draftStrategy = strategy
    strategy.setTeam(this)
  }
  
  // Auto-pilot control methods
  enableAutoPilot(strategyName = 'Balanced') {
    if (this.isHuman) {
      this.isAutoPilot = true
      this.autoPilotStrategy = strategyName
    }
  }
  
  disableAutoPilot() {
    if (this.isHuman) {
      this.isAutoPilot = false
    }
  }
  
  setPlayerValueAdjustment(playerId, multiplier) {
    if (this.isHuman) {
      if (multiplier === 1.0) {
        this.playerValueAdjustments.delete(playerId)
      } else {
        this.playerValueAdjustments.set(playerId, multiplier)
      }
    }
  }
  
  getAdjustedPlayerValue(player) {
    const baseValue = player.estimatedValue
    const adjustment = this.playerValueAdjustments.get(player.id) || 1.0
    return Math.round(baseValue * adjustment)
  }
}