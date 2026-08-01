import { random } from '../utils/rng.js'
import { BaseStrategy } from './BaseStrategy.js'

// The hero cohort: the top HERO_RB_COUNT RBs by book value, snapshotted the
// first time the strategy sees the draft pool. Heroes are identified by rank
// among RBs, not by a dollar threshold, so the cohort tracks whatever the
// current player pool looks like.
const HERO_RB_COUNT = 8
// $200-baseline book value that marks a roster RB as the hero when it never
// appeared in the pool snapshot (keepers are removed from the pool pre-draft).
const HERO_ELITE_BOOK = 35
// Signature premium on cohort RBs while the hero is still unowned. Flows
// through getTopTierBoost into the max-bid clamp (the Taco mechanism), so it
// survives where a plain position multiplier gets clamped away on elite
// players. The global 1.35x cap still bounds it.
const HERO_BOOST = 1.20
// $200-baseline ceiling on what a post-hero team values any further RB at.
// The persona is one stud plus cheap fill-ins (leagueProfile HERO_OTHER_MAX);
// without a hard cap, a second $47-book RB still cleared $35+ bids through the
// discounted value stack — notably via the aggressive opener, which bids
// straight off getAdjustedPlayerValue without consulting evaluateBid. Capping
// the adjusted value itself closes every bidding path at once. The endgame
// spend floor is re-applied on top so forced late spend-down is unaffected.
const POST_HERO_RB_CAP = 12

export class HeroRB extends BaseStrategy {
  constructor() {
    super('Hero RB')
    this._heroIds = null
    this.preferences = {
      positionMultipliers: {
        // RB at par: all RB shaping lives in the hero boost + post-hero
        // discount. A blanket premium survived the loose mid-tier max-bid cap
        // and made the strategy hoard $15-30 RBs instead of landing a stud.
        'QB': 1.0,
        'RB': 1.0,
        'WR': 0.95,
        'TE': 0.95,
        'K': 0.9,
        'DST': 0.9
      }
    }
  }

  // Ranks are frozen at the first sighting of the pool: once the real cohort
  // is drafted, the 9th-best RB does not get promoted to "hero" — the
  // strategy reverts to normal bidding instead.
  heroIds(availablePlayers) {
    if (!this._heroIds && availablePlayers?.length) {
      this._heroIds = new Set(
        availablePlayers
          .filter(p => p.position === 'RB')
          .sort((a, b) => b.estimatedValue - a.estimatedValue)
          .slice(0, HERO_RB_COUNT)
          .map(p => p.id)
      )
    }
    return this._heroIds ?? new Set()
  }

  // The hero counts by identity, not price: a cohort RB won at a bargain is
  // mission accomplished, while a $1 no-bid scrub RB must not flip the
  // strategy into its conservative mode.
  hasAcquiredHero() {
    return this.team.roster.some(p =>
      p.position === 'RB' &&
      (this._heroIds?.has(p.id) || p.estimatedValue >= this.sd(HERO_ELITE_BOOK))
    )
  }

  isHeroTarget(player, availablePlayers) {
    return (
      player.position === 'RB' &&
      !this.hasAcquiredHero() &&
      this.heroIds(availablePlayers).has(player.id)
    )
  }

  getTopTierBoost(player, availablePlayers = []) {
    return this.isHeroTarget(player, availablePlayers) ? HERO_BOOST : 1.0
  }

  getAdjustedPlayerValue(player, availablePlayers = []) {
    const base = super.getAdjustedPlayerValue(player, availablePlayers)
    if (base > 0 && player.position === 'RB' && this.hasAcquiredHero()) {
      const floor = Math.round(this.getEndgameSpendFloor(player, availablePlayers))
      return Math.max(Math.min(base, this.sd(POST_HERO_RB_CAP)), floor, 1)
    }
    return base
  }

  getPositionMultiplier(position) {
    if (this.hasAcquiredHero()) {
      // Post-hero RBs are actively discounted — the target roster shape is
      // one stud plus cheap fill-ins — and never get the base "stretch" roll.
      if (position === 'RB') return 0.85
      // Pivot the freed budget into WRs. Keeping the pre-hero 0.95 discount
      // here made the team hoard until the endgame spend floor shoved the
      // surplus into whatever was nominated — including $20+ RBs.
      if (position === 'WR') return 1.05
    }
    return super.getPositionMultiplier(position)
  }

  evaluateBid(player, currentBid, adjustedValue, availablePlayers) {
    if (this.isHeroTarget(player, availablePlayers)) {
      // adjustedValue already carries the hero boost; stay in nearly to the
      // ceiling. Factors above 1.0 would be dead code — calculateBidAmount
      // clamps bids at adjustedValue.
      //
      // Price discipline: the boost exists to outlast the normal field
      // (~1.05-1.16x book), not to chase a rival hero hunter. Two HeroRB
      // seats in the same league (the Mixed fill pool deals ~2) would
      // otherwise bid each other to the 1.35x clamp on every top RB —
      // observed $85 sales on a $67 book stud. Walk away above a modest
      // premium to book instead.
      const priceCeiling = player.estimatedValue * (1.04 + random() * 0.11)
      return currentBid < Math.min(adjustedValue * (0.95 + random() * 0.05), priceCeiling)
    }
    if (player.position === 'RB' && this.hasAcquiredHero()) {
      // adjustedValue is already capped at POST_HERO_RB_CAP by the override above
      return currentBid < adjustedValue * (0.75 + random() * 0.15)
    }
    return super.evaluateBid(player, currentBid, adjustedValue, availablePlayers)
  }

  getBidIncrement(player, currentBid, adjustedValue) {
    // No pool arg in this hook; the frozen snapshot makes membership checkable.
    if (!this.hasAcquiredHero() && this._heroIds?.has(player.id)) {
      // Big jumps discourage the field early in the auction, but once the
      // price is at/above book they'd overshoot the walk-away ceiling —
      // close with $1-2 raises instead.
      if (currentBid >= player.estimatedValue) return this.si(random() < 0.5 ? 1 : 2)
      if (random() < 0.6) return this.si(Math.floor(random() * 6) + 3) // $3-8
      return this.si(2)
    }
    return super.getBidIncrement(player, currentBid, adjustedValue)
  }

  getSkipProbability() {
    return 0.1 // Aggressive bidding style
  }

  selectNomination(availablePlayers) {
    availablePlayers = this.filterNominationPool(availablePlayers)
    // 70% chance to put a cohort RB on the block until the hero is landed
    if (!this.hasAcquiredHero() && random() < 0.7) {
      const ids = this.heroIds(availablePlayers)
      const heroes = availablePlayers
        .filter(p => ids.has(p.id))
        .sort((a, b) => b.estimatedValue - a.estimatedValue)
      if (heroes.length > 0) return heroes[0]
    }
    return super.selectNomination(availablePlayers)
  }
}
