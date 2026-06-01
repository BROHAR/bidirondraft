export class Player {
  constructor(data, scoringFormat = 'halfPPR') {
    this.id = data.id
    this.name = data.name
    this.position = data.position
    this.team = data.team
    this.estimatedValue = data.estimatedValue
    this.byeWeek = data.byeWeek
    this.injuryStatus = data.injuryStatus || ''

    // Handle both old and new data formats
    if (typeof data.projectedPoints === 'object') {
      this.projectedPoints = data.projectedPoints[scoringFormat] || data.projectedPoints.halfPPR || 0
      this.allProjections = data.projectedPoints
    } else {
      // Legacy format - assume it's halfPPR
      this.projectedPoints = data.projectedPoints || 0
      this.allProjections = { halfPPR: this.projectedPoints }
    }
  }
  
  isEligibleFor(positionSlot) {
    if (positionSlot === 'FLEX') {
      return ['RB', 'WR', 'TE'].includes(this.position)
    }
    if (positionSlot === 'SUPERFLEX') {
      return ['QB', 'RB', 'WR', 'TE'].includes(this.position)
    }
    return this.position === positionSlot
  }
}