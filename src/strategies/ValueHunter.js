import { random } from '../utils/rng.js'
import { BaseStrategy } from './BaseStrategy.js'

// Walk-away ceiling relative to book value: the hunter pays book, give or
// take a couple percent, and never chases a bidding war. Its edge comes from
// pouncing on auctions the field lets fall below book, not from outbidding.
const MAX_BOOK_PREMIUM_MIN = 1.02
const MAX_BOOK_PREMIUM_JITTER = 0.06

export class ValueHunter extends BaseStrategy {
  constructor() {
    super('Value Hunter')
    this.preferences = {
      positionMultipliers: {
        // Near-neutral: a value hunter's willingness IS book value. The old
        // 1.08-1.10 blanket markup made it structurally overpay — it bid its
        // own inflated number "up to 1.10x", i.e. up to ~1.2x book. (Raising
        // these to chase aggressive-opener selection was tried and measured
        // WORSE: the inflated value leaks through the flush bypass, which
        // bids straight to adjustedValue.)
        'QB': 1.0,
        'RB': 1.02,
        'WR': 1.02,
        'TE': 1.0,
        'K': 0.9,
        'DST': 0.9
      }
    }
  }

  evaluateBid(player, currentBid, adjustedValue, availablePlayers) {
    const book = player.estimatedValue

    // Slot discipline: roster spots are the hunter's inventory — each one
    // held open is a claim on a future bargain. Filling up on scrubs early
    // burned 8+ slots by pick 40, tripped the engine's flush machinery
    // (budget-heavy per remaining slot), and got the surplus force-dumped at
    // $23-for-$7 overpays. Cheap players wait until the roster is mostly
    // built; the endgame floor and scraps phase fill them at $1-3 anyway.
    const rc = this.team.config?.rosterPositions || {}
    const totalSpots = Object.values(rc).reduce((s, c) => s + c, 0)
    const rosterProgress = this.team.roster.length / Math.max(1, totalSpots)
    if (book < this.sd(8) && rosterProgress < 0.6) return false

    // Walk-away ceilings. Scrubs (book < sd(6)) are only ever bought at
    // scraps prices — the $1-3 endgame closes on $4-8 book players are where
    // the capture actually lives (measured: +$1.5-1.8 per slot for the
    // strategies that harvest them). Real players get book plus a small
    // premium: every attempt at MORE selectivity measured worse, because
    // held-back dollars reach the endgame flush machinery, which dumps them
    // at far bigger overpays than a controlled near-book buy.
    // Studs get a slightly wider premium than mid-tier: winning ~2 anchors
    // early (capture ~-4 each) drains $80-100 of budget that would otherwise
    // survive to the endgame and bleed away as $6-9 floor dumps on $4-book
    // scrubs (~-6 each). The anchor overpay is the cheaper way to be
    // cash-poor when the scraps harvest begins.
    const ceiling = book < this.sd(6)
      ? Math.max(book, this.sd(2))
      : book >= this.sd(30)
        ? book * (1.06 + random() * 0.09)
        : book * (MAX_BOOK_PREMIUM_MIN + random() * MAX_BOOK_PREMIUM_JITTER)
    if (currentBid >= Math.min(ceiling, adjustedValue * 1.10)) return false

    // Discount measured against BOOK, not adjustedValue — measuring against
    // its own marked-up number counted the markup as "discount".
    const discount = (book - currentBid) / Math.max(1, book)
    if (discount >= 0.15) return random() < 0.99  // genuine bargain: pounce
    if (discount >= 0.05) return random() < 0.95
    // Near book on a real player: almost always stay. Deploying budget on
    // mid-tier players early is what arrives at the scraps phase cash-poor
    // and slot-rich — the harvesting position. Held cash becomes floor
    // dumps at $6-9 for $4-book players instead of $1-2 closes.
    return random() < (book >= this.sd(10) ? 0.95 : 0.85)
  }

  getBidIncrement(player, currentBid, adjustedValue) {
    // Always the minimum raise. The winner pays their own final bid, and the
    // field's stay-in decisions key off the current price — so jumping the
    // ladder toward book value never wins anything cheaper, it only donates
    // the gap. The old $8-12 "pounce" jumps were pure capture leakage.
    return 1
  }

  getSkipProbability() {
    return 0.35 // High skip probability - very selective
  }

  shouldNominate(player, availablePlayers = []) {
    // Only nominate players we think are undervalued
    const adjustedValue = this.getAdjustedPlayerValue(player, availablePlayers)
    return adjustedValue >= player.estimatedValue * 1.1 // 10% premium required
  }

  selectNomination(availablePlayers) {
    availablePlayers = this.filterNominationPool(availablePlayers)
    // 60% chance to nominate undervalued player we want
    if (random() < 0.6) {
      const undervaluedPlayers = [...availablePlayers]
        .filter(p => this.shouldNominate(p, availablePlayers))
        .sort((a, b) => {
          const aValue = this.getAdjustedPlayerValue(a, availablePlayers) / a.estimatedValue
          const bValue = this.getAdjustedPlayerValue(b, availablePlayers) / b.estimatedValue
          return bValue - aValue
        })

      if (undervaluedPlayers.length > 0) {
        return undervaluedPlayers[0] // Take most undervalued
      }
    }

    // 30% chance to price enforce someone expensive
    if (random() < 0.75) {
      const expensivePlayers = [...availablePlayers]
        .filter(p => p.estimatedValue >= this.sd(30))
        .sort((a, b) => b.estimatedValue - a.estimatedValue)

      if (expensivePlayers.length > 0) {
        return expensivePlayers[Math.floor(random() * Math.min(2, expensivePlayers.length))]
      }
    }

    return super.selectNomination(availablePlayers)
  }

  getEarlyDraftMultiplier() {
    // Patient early: no opening-wave aggression at all (base is 1.0-1.1).
    // The old 1.0-1.2 here was MORE aggressive than base, the opposite of
    // waiting for value.
    return 1.0
  }
}
