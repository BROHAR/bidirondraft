import { BaseStrategy } from './BaseStrategy.js'
import playersData from '../data/players.json'

const PLAYER_LIST = Array.isArray(playersData) ? playersData : (playersData.players || [])

// Real NFL team codes present in the player pool, sorted. 'FA' (free agent) is
// filtered out so it's never offered as a home team or picked at random.
// Exported so the setup UI can populate its home-team picker from the same source.
export const NFL_TEAMS = Array.from(new Set(PLAYER_LIST.map(p => p.team).filter(Boolean)))
  .filter(team => team !== 'FA')
  .sort()

function pickRandomNflTeam() {
  return NFL_TEAMS[Math.floor(Math.random() * NFL_TEAMS.length)]
}

export class Taco extends BaseStrategy {
  constructor() {
    super('Taco')
    this.preferences = {
      positionMultipliers: {
        QB: 1.20,
        RB: 0.95,
        WR: 0.95,
        TE: 1.05,
        K: 1.10,
        DST: 1.10
      },
      homeTeam: pickRandomNflTeam(),
      homeTeamMultiplier: 1.20,
      topQBBoost: 1.15,
      topQBCount: 3
    }
  }

  getPositionLimit(position) {
    if (position === 'K' || position === 'DST') return 3
    return super.getPositionLimit(position)
  }

  getPositionNeedMultiplier(position) {
    // Only fires for higher-value TE backups that reach the adjustment branch.
    // K/DST never get here (their estimatedValue is 0-1, short-circuited).
    if (['K', 'DST', 'TE'].includes(position)) {
      if (this.team.getPositionNeed(position) <= 0) {
        const tacoLimit = this.getPositionLimit(position)
        const currentCount = this.team.roster.filter(p => p.position === position).length
        if (currentCount < tacoLimit) {
          return 0.95
        }
      }
    }
    return super.getPositionNeedMultiplier(position)
  }

  getAdjustedPlayerValue(player, availablePlayers) {
    // Bypass the base "$1-3 short-circuit" for backup K/DST/TE inside Taco's
    // enlarged limit. Without this, multipliers are dead code on cheap players
    // (every K and DST in the pool is $0-1, which hits the bypass branch and
    // returns 1-3 regardless of preference). Force a willingness floor of $4
    // so Taco reliably outbids the $1-2 closing price other AIs settle on,
    // but still let the base value win when it's higher (e.g. an expensive TE
    // backup goes through the full multiplier stack).
    if (['K', 'DST', 'TE'].includes(player.position)) {
      if (this.team.getPositionNeed(player.position) <= 0) {
        const tacoLimit = this.getPositionLimit(player.position)
        const currentCount = this.team.roster.filter(p => p.position === player.position).length
        if (currentCount < tacoLimit) {
          const base = super.getAdjustedPlayerValue(player, availablePlayers)
          const floor = 4
          return Math.min(this.team.maxBid, Math.max(base, floor))
        }
      }
    }
    return super.getAdjustedPlayerValue(player, availablePlayers)
  }

  getTopTierBoost(player, availablePlayers = []) {
    if (player.position !== 'QB' || !availablePlayers.length) return 1.0
    const qbs = availablePlayers
      .filter(p => p.position === 'QB')
      .sort((a, b) => b.estimatedValue - a.estimatedValue)
    const rank = qbs.findIndex(p => p.id === player.id)
    if (rank >= 0 && rank < this.preferences.topQBCount) {
      return this.preferences.topQBBoost
    }
    return 1.0
  }

  selectNomination(availablePlayers) {
    availablePlayers = this.filterNominationPool(availablePlayers)
    const homeTeam = this.preferences.homeTeam
    const roll = Math.random()

    if (roll < 0.30 && homeTeam) {
      const homies = availablePlayers
        .filter(p => p.team === homeTeam)
        .sort((a, b) => b.estimatedValue - a.estimatedValue)
      if (homies.length > 0) return homies[0]
    }

    if (roll < 0.55) {
      const topQBs = availablePlayers
        .filter(p => p.position === 'QB')
        .sort((a, b) => b.estimatedValue - a.estimatedValue)
        .slice(0, this.preferences.topQBCount)
      if (topQBs.length > 0) {
        return topQBs[Math.floor(Math.random() * topQBs.length)]
      }
    }

    // Boring-stack branch: occasionally pull a cheap K/DST/TE onto the block
    // when Taco's starter at that position is already filled but his enlarged
    // limit still has room. Drives the visible hoarding behavior.
    if (Math.random() < 0.10) {
      const stackPositions = ['K', 'DST', 'TE'].filter(pos => {
        const count = this.team.roster.filter(p => p.position === pos).length
        return (
          this.team.getPositionNeed(pos) <= 0 &&
          count < this.getPositionLimit(pos)
        )
      })
      if (stackPositions.length > 0) {
        const pos = stackPositions[Math.floor(Math.random() * stackPositions.length)]
        const candidates = availablePlayers
          .filter(p => p.position === pos)
          .sort((a, b) => a.estimatedValue - b.estimatedValue)
          .slice(0, 5)
        if (candidates.length > 0) {
          return candidates[Math.floor(Math.random() * candidates.length)]
        }
      }
    }

    return super.selectNomination(availablePlayers)
  }
}
