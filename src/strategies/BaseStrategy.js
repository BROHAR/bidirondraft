import { random } from '../utils/rng.js'
import { budgetScaleFor } from '../utils/budgetScaling.js'

// Hard ceiling on what any AI strategy will value a kicker or defense at,
// regardless of (possibly inflated) book value or auction-pressure boosts.
// Expressed at the $200 reference budget; scaled per-team via this.sd().
const KDST_VALUE_CAP = 5

export class BaseStrategy {
  constructor(name) {
    this.name = name
    this.team = null
    this.preferences = {}
  }

  setTeam(team) {
    this.team = team
  }

  // Player values and the dollar thresholds below are tuned for a $200 budget.
  // budgetScale rescales those absolute amounts to the team's actual budget so
  // they stay proportional (at $200 this is exactly 1.0, preserving behavior).
  get budgetScale() {
    return budgetScaleFor(this.team?.budget)
  }

  // Scale a $200-baseline dollar amount to the team's budget. Used for all
  // absolute thresholds/caps; ratios and percentages are left unscaled.
  sd(amount) {
    return amount * this.budgetScale
  }

  // Scale a bid-increment amount to the team's budget, rounded and floored at
  // $1 so increments grow with budget (keeping auctions a sane number of steps)
  // but never drop below the minimum raise.
  si(amount) {
    return Math.max(1, Math.round(amount * this.budgetScale))
  }

  getPositionLimit(position) {
    const rc = this.team.config?.rosterPositions || {}
    if (position === 'QB') {
      // Starting slots: QB + SUPERFLEX (can start a QB), plus 1 backup
      return (rc.QB || 0) + (rc.SUPERFLEX || 0) + 1
    }
    if (position === 'K' || position === 'DST') {
      return 2 // 1 starter + 1 handcuff at most
    }
    if (position === 'TE') {
      return (rc.TE || 0) + 1 // TE starters + 1 backup
    }
    return Infinity
  }

  shouldApplyPositionLimits(player) {
    const position = player.position
    if (!['QB', 'TE', 'K', 'DST'].includes(position)) return false
    const limit = this.getPositionLimit(position)
    const currentCount = this.team.roster.filter(p => p.position === position).length
    return currentCount >= limit
  }

  // User-configured "don't pay more than $X for a <position>" ceiling. Human
  // team only — AI opponents always get Infinity so their behavior (and the
  // seeded-test RNG sequence) is untouched. A player value adjustment trumps
  // the limit: any multiplier != 1.0 means the user priced this player
  // individually, so the positional blanket doesn't apply.
  getPositionalBidCap(player) {
    if (!this.team?.isHuman) return Infinity
    const cap = this.team.config?.positionalSpendLimits?.[player.position]
    if (!Number.isFinite(cap) || cap < 1) return Infinity
    const pin = this.team.playerValueAdjustments?.get(player.id)
    if (pin !== undefined && pin !== 1.0) return Infinity
    return Math.max(1, Math.round(cap))
  }

  shouldBid(player, currentBid, availablePlayers) {
    if (!this.team) return false

    // Basic affordability check
    if (!this.team.canAffordPlayer(currentBid + 1)) return false

    // Check do-not-draft list
    if (this.team.doNotDraftList.has(player.id)) return false

    // Positional spend limit: any further bid would land at currentBid+1 or
    // more, so drop out exactly at the cap. Checked before the endgame-floor
    // early return below — the floor must not keep the team bidding past a
    // user-set ceiling.
    if (currentBid >= this.getPositionalBidCap(player)) return false

    // Apply position limits - AI teams rarely draft more than 1 TE/K/DST unless late
    if (this.shouldApplyPositionLimits(player)) {
      return false
    }

    // Flush slot-preservation: a team holding surplus must not spend roster
    // spots on scrubs while real players remain on the board — every cheap
    // win burns a slot it needs to absorb that surplus later (fast-filling
    // teams used to end the draft roster-full with $250+ stranded). The same
    // protection covers the last 2 burnable slots regardless of pacing: a
    // team at pacing 1.16 dumped $29 on a $1.3 scrub at pick 66 because its
    // final flexible slot wasn't guarded. Skip the auction entirely unless
    // the scrub fills a still-open required starter slot. The
    // nominator-takes-it-for-$1 fallback keeps scrub auctions resolving
    // league-wide.
    if (this.getPacingRatio() > 1.2 || this.getBurnableSpotsRemaining() <= 2) {
      const bestBook = this.bestUsableBook(availablePlayers)
      // Only a DIRECT unfilled starter slot (QB:1, RB:2, …) exempts a scrub —
      // hasOpenStartingSlot counts FLEX, which keeps every RB/WR/TE "open"
      // and let the slot-eating wins through anyway. Genuine positional needs
      // still pass; FLEX/bench filling can wait for the scraps phase.
      const rcPos = this.team.config?.rosterPositions || {}
      const directNeed =
        this.team.roster.filter(p => p.position === player.position).length <
        (rcPos[player.position] || 0)
      if (bestBook > this.sd(5) && player.estimatedValue < bestBook * 0.25 && !directNeed) {
        return false
      }
    }

    // Get adjusted player value based on team preferences
    const adjustedValue = this.getAdjustedPlayerValue(player, availablePlayers)

    // Endgame floor is authoritative: while the bid is below the fair-share
    // spend floor, stay in the auction — strategy-personality dropouts in
    // evaluateBid must not let a flush team exit and strand its budget.
    if (this.getEndgameSpendFloor(player, availablePlayers) > currentBid) return true

    // Flush bypass: when severely over pace late in the draft, bypass strategy
    // dropouts and bid as long as currentBid is below adjustedValue. Position
    // limits and DNDL above still apply, so this respects the team's basic
    // shape — it just forces aggression on auctions they'd otherwise skip.
    const rc = this.team.config?.rosterPositions || {}
    const totalSpots = Object.values(rc).reduce((s, c) => s + c, 0)
    const draftProgress = this.team.roster.length / Math.max(1, totalSpots)
    const pacingRatio = this.getPacingRatio()
    if (pacingRatio > 1.3 && draftProgress > 0.35 && currentBid < adjustedValue) {
      return true
    }

    // Apply bidding logic
    return this.evaluateBid(player, currentBid, adjustedValue, availablePlayers)
  }

  getAdjustedPlayerValue(player, availablePlayers = []) {
    let baseValue = player.estimatedValue

    // Hard pin: user-set player value adjustment > 1.0 is a literal
    // multiplier. The strategy stack and getMaxBidForPlayer cap are
    // bypassed — the user asked for this player, honor that up to budget.
    const userPin = this.team.playerValueAdjustments?.get(player.id)
    if (userPin && userPin > 1.0) {
      const pinned = Math.round(userPin * baseValue)
      return Math.max(1, Math.min(pinned, this.team.maxBid))
    }

    // For very low value players (under $4), apply strict caps and skip most
    // adjustments. The endgame floor still applies: these are exactly the
    // players left on the board late, and without it a flush team could never
    // bid more than ~$3 no matter how much surplus it had to burn.
    if (baseValue < this.sd(4)) {
      // Add small random variance but keep it very low
      const variance = (random() - 0.5) * this.sd(0.5) // +/- $0.25
      const capped = Math.max(1, Math.min(this.sd(3), Math.round(baseValue + variance)))
      return Math.max(capped, Math.round(this.getEndgameSpendFloor(player, availablePlayers)))
    }

    // Only apply value adjustments to players with $4+ value and in top 150
    const shouldApplyAdjustments = baseValue >= this.sd(4) && this.isInTop150Players(player, availablePlayers)

    if (!shouldApplyAdjustments) {
      // For players $4-5, add some variance but keep it reasonable
      const variance = (random() - 0.5) * this.sd(1.0) // +/- $0.50
      const base = Math.max(1, Math.round(baseValue + variance))
      return Math.max(base, Math.round(this.getEndgameSpendFloor(player, availablePlayers)))
    }
    
    // Use additive modifiers instead of pure multiplicative to prevent stacking
    let adjustments = 0
    
    // Apply team-specific value modifiers (convert to additive)
    const modifier = this.team.valueModifiers.get(player.id) || 1.0
    
    // If modifier is 0, this player has zero value to this team
    if (modifier === 0) {
      return 0
    }
    
    adjustments += (modifier - 1.0) * baseValue
    
    // Apply strategy-specific position multipliers (convert to additive)
    const positionMultiplier = this.getPositionMultiplier(player.position)
    adjustments += (positionMultiplier - 1.0) * baseValue

    // Home-team affinity (Taco; no-op for strategies without preferences.homeTeam)
    const homeTeam = this.preferences?.homeTeam
    const homeMult = this.preferences?.homeTeamMultiplier ?? 1.0
    const isHomePlayer = !!(homeTeam && player.team === homeTeam && homeMult > 1.0)
    if (isHomePlayer) {
      adjustments += (homeMult - 1.0) * baseValue
    }

    // Top-tier boost hook (Taco overrides for top QBs; default 1.0)
    const topBoost = this.getTopTierBoost(player, availablePlayers)
    if (topBoost !== 1.0) {
      adjustments += (topBoost - 1.0) * baseValue
    }

    // Signature premium: a strategy's identity boosts (Taco's home-team and
    // top-QB affinity) are allowed to push past the generic per-player max-bid
    // clamp below — otherwise getMaxBidForPlayer's ~1.0-1.05x cap on studs
    // silently erases the boost, and the homer never outbids the field for the
    // very players that define it. Bounded: the absolute baseValue*1.35 ceiling
    // further down is NOT expanded, so this can never run away. 1.0 (no-op) for
    // strategies without these preferences.
    const signatureBoost = Math.max(isHomePlayer ? homeMult : 1.0, topBoost)

    // Apply early draft aggression (smaller boost). Gated behind a coin-flip
    // so the boost doesn't fire for every team at once during the draft
    // opening — when all rosters are <4 and budgets are full — which uniformly
    // bid up the first wave of nominations and drained budgets before the
    // mid-tier came up. ~50% application halves that league-wide inflation
    // while still letting some teams come out swinging on a given auction.
    if (this.team.roster.length < 4 && random() < 0.5) {
      const earlyBoost = this.getEarlyDraftMultiplier() - 1.0
      adjustments += earlyBoost * baseValue
    }
    
    // Apply position need multiplier (convert to additive)
    const needMultiplier = this.getPositionNeedMultiplier(player.position)
    adjustments += (needMultiplier - 1.0) * baseValue
    
    // Add budget awareness - become more conservative as budget decreases
    const budgetFactor = this.getBudgetConservationFactor()
    adjustments *= budgetFactor
    
    let finalValue = baseValue + adjustments

    // Pacing boost: scales adjustedValue (and the cap) so over-pace teams can
    // outbid normal teams and burn down their surplus. Gated behind
    // draft-progress so star-targeting strategies win intended targets early.
    // Full slope on the ratio, capped at 1.50 — flush teams push prices up hard
    // enough that surpluses drain mid-draft instead of stranding (the absolute
    // baseValue*1.35 ceiling below still bounds the realized bid). The original
    // 2.5x cap produced routine $20+ overpays on elite players; the later 1.20
    // half-slope cap left 20-40% of budgets unspent in money-rich leagues.
    const rcAll = this.team.config?.rosterPositions || {}
    const totalSpotsAll = Object.values(rcAll).reduce((s, c) => s + c, 0)
    const draftProgress = this.team.roster.length / Math.max(1, totalSpotsAll)
    const pacingRatio = this.getPacingRatio()
    let pacingBoost = 1.0
    if (draftProgress >= 0.3) {
      if (pacingRatio > 1.0) {
        pacingBoost = Math.min(1.50, pacingRatio)
      } else if (pacingRatio < 0.7) {
        pacingBoost = 0.92
      }
    } else if (pacingRatio < 0.7) {
      pacingBoost = 0.92
    }

    // Starter urgency: teams overpay to fill starter slots, more so when the
    // next best at that position is a big step down. Combined with pacing via
    // Math.max rather than multiplication so the two related auction pressures
    // (flush team / position need) don't double-stack.
    const urgencyBoost = this.getStarterUrgencyBoost(player, availablePlayers)
    const combinedBoost = Math.max(pacingBoost, urgencyBoost)

    finalValue *= combinedBoost

    // Apply bid ceiling, scaled by the same combined boost so a boosted bid
    // can still reach its target rather than being undone by the cap, and by
    // signatureBoost so a strategy's identity premium (Taco home/top-QB) can
    // actually clear the field on studs.
    const maxBid = this.getMaxBidForPlayer(player) * combinedBoost * signatureBoost
    finalValue = Math.min(finalValue, maxBid)

    // Defensive ceiling. Nothing in the AI strategy stack should value a
    // player above 1.35× book — bids inside the normal envelope of tier-cap ×
    // pacing/urgency boosts clamp here, catching hidden escape paths. User
    // hard-pins return earlier and aren't affected. The endgame spend floor
    // below is the one sanctioned exception (bounded by team.maxBid).
    finalValue = Math.min(finalValue, baseValue * 1.35)

    // Position-aware ceiling for K/DST. Kickers and defenses are worth a
    // couple dollars at most; this cap is independent of estimatedValue so an
    // inflated or garbage K/DST book value can't be amplified by the aggressive
    // opener + pacing/urgency/forced-spend stack into a runaway auction (the
    // Mevis-kicker-to-$34 bug). Sub-$4 K/DST already return at the low-value
    // branch above; this only bites when the data is wrong.
    if (player.position === 'K' || player.position === 'DST') {
      finalValue = Math.min(finalValue, Math.max(1, Math.round(baseValue * 1.1)), this.sd(KDST_VALUE_CAP))
    }

    // End-of-draft forced spend, applied AFTER the defensive ceilings — the
    // 1.35× book cap used to erase this floor, which is exactly why flush
    // teams finished drafts with money stranded: late-board players are cheap,
    // so capping at 1.35× a $2 book value made surplus unspendable.
    finalValue = Math.max(finalValue, this.getEndgameSpendFloor(player, availablePlayers))

    return Math.max(1, Math.round(finalValue))
  }

  // Fair-share spend floor for the late draft: with few picks remaining, a
  // team should bid up to its per-pick share of remaining budget on whoever
  // fills a slot rather than leave money on the table — late-board players
  // only fetch $1-3 on book value, so without this floor any budget beyond
  // ~$3/pick is unspendable. Returns 0 when inactive. Never applies to K/DST
  // (their hard value cap wins — burning surplus on a kicker is unrealistic
  // and guarded against elsewhere); instead a couple scaled dollars are
  // reserved for each K/DST slot still owed and the rest spreads across the
  // other remaining picks, so the budget is gone before the K/DST closes.
  // Always bounded by team.maxBid so future $1 slots stay funded.
  getEndgameSpendFloor(player, availablePlayers = []) {
    if (player.position === 'K' || player.position === 'DST') return 0
    const spotsLeft = this.team.getRosterSpotsRemaining()
    if (spotsLeft <= 0 || spotsLeft > 10) return 0
    const rc = this.team.config?.rosterPositions || {}
    const owned = { K: 0, DST: 0 }
    for (const p of this.team.roster) {
      if (p.position === 'K' || p.position === 'DST') owned[p.position]++
    }
    const owedKdst = Math.max(0, (rc.K || 0) - owned.K) + Math.max(0, (rc.DST || 0) - owned.DST)
    const burnSpots = spotsLeft - owedKdst
    if (burnSpots <= 0) return 0
    const fairShare = (this.team.remainingBudget - owedKdst * this.sd(2)) / burnSpots

    // The user's team (auto-pilot drives the human team through this same
    // stack) never burns fair-share on scrubs — paying $11 for a $1 player
    // with the user's money is the sim's choice, not theirs. Instead its
    // surplus chases value: overpay is tied to book — ~2x for $1-2 players,
    // decaying fast as book rises (sd(2)/book premium), so leftover budget
    // flows to the best remaining players rather than the cheapest. Only
    // active while the team actually holds surplus (fairShare above its
    // expected per-pick spend); any money it still strands is the user's.
    if (this.team.isHuman) {
      const totalSpots = Object.values(rc).reduce((s, c) => s + c, 0)
      const expected = this.team.budget / Math.max(1, totalSpots)
      if (fairShare <= expected) return 0
      const base = Math.max(1, player.estimatedValue)
      const premium = Math.min(2.0, 1 + this.sd(2) / base)
      return Math.min(this.team.maxBid, base * premium)
    }

    // Aim the burn at quality, not at whatever happens to be nominated. A
    // team that fills fast hit its "last picks" mid-draft and dumped full
    // fair-share ($27 on a $1 nominee at pick ~60); a pure "wait for scraps"
    // gate stranded money the other way. So the cap tracks how the nominee
    // ranks against the best player THIS team can still roster (position
    // limits respected — a $40 QB it can't use is no reason to wait): true
    // scrubs (<25% of best-usable) stay capped at 2x book, mid players (<60%)
    // at 4x, near-best take the full fair share — paying up for the best
    // player left IS the sensible drain. The 4x tier and below release on the
    // last 2 burnable spots (drain of last resort), safe because scrub
    // auctions are already blocked by slot-preservation in shouldBid by then.
    let bookCap = Infinity
    if (burnSpots > 2) {
      const bestBook = this.bestUsableBook(availablePlayers)
      if (bestBook > this.sd(5)) {
        const ratio = player.estimatedValue / bestBook
        if (ratio < 0.25) {
          bookCap = Math.max(1, player.estimatedValue) * 2
        } else if (ratio < 0.6) {
          bookCap = Math.max(1, player.estimatedValue) * 4
        }
        // ratio >= 0.6: nominee is among the best left — uncapped fair share.
      }
    }

    return Math.max(0, Math.min(this.team.maxBid, fairShare, bookCap))
  }

  // Roster spots remaining that can actually absorb surplus budget — K/DST
  // slots are excluded since their bids are hard-capped at a few dollars.
  getBurnableSpotsRemaining() {
    const rc = this.team.config?.rosterPositions || {}
    const owned = { K: 0, DST: 0 }
    for (const p of this.team.roster) {
      if (p.position === 'K' || p.position === 'DST') owned[p.position]++
    }
    const owedKdst = Math.max(0, (rc.K || 0) - owned.K) + Math.max(0, (rc.DST || 0) - owned.DST)
    return this.team.getRosterSpotsRemaining() - owedKdst
  }

  // Highest book value among available players this team could actually add
  // (position limits respected). The board's absolute best overstates a
  // team's opportunity once it hits positional caps.
  bestUsableBook(availablePlayers) {
    let best = 0
    for (const p of availablePlayers) {
      if (p.estimatedValue > best && !this.shouldApplyPositionLimits(p)) {
        best = p.estimatedValue
      }
    }
    return best
  }

  getTopTierBoost(_player, _availablePlayers) {
    return 1.0
  }

  isInTop150Players(player, availablePlayers) {
    if (!availablePlayers || availablePlayers.length === 0) {
      return true // Default to true if no list provided
    }
    
    // Sort available players by estimated value descending
    const sortedPlayers = [...availablePlayers].sort((a, b) => b.estimatedValue - a.estimatedValue)
    
    // Find the player's rank
    const playerRank = sortedPlayers.findIndex(p => p.id === player.id) + 1
    
    // Return true if player is in top 150 (or if not found, assume they qualify)
    return playerRank <= 150 || playerRank === 0
  }

  getMaxBidForPlayer(player) {
    // Base multipliers with competitive caps for top players. Elite/high tiers
    // are tightened to ~book value: with ~12 bidders the *realized* contested
    // price approaches the max order-statistic of these per-team multipliers
    // (the winner pays just over the runner-up), so the cap effectively IS the
    // sale price for any contested stud. The old 1.12/1.10 caps therefore meant
    // every contested stud sold at ~1.1x book, front-loading budget onto the
    // top tier and starving mid-tier auctions later (the reported "early/
    // expensive overspend, mid-tier sells for $1" pattern). Mid/low tiers keep
    // wide variance — overpay drama on sleepers is intentional.
    let multiplier
    if (player.estimatedValue >= this.sd(50)) {
      // Elite: ~book value (0-5% over).
      multiplier = 1.00 + random() * 0.05
    } else if (player.estimatedValue >= this.sd(30)) {
      // High: ~book value (0-5% over).
      multiplier = 1.00 + random() * 0.05
    } else if (player.estimatedValue >= this.sd(15)) {
      // Mid: increased variance (0-25% over)
      multiplier = 1.00 + random() * 0.25
    } else if (player.estimatedValue >= this.sd(5)) {
      // Low-mid: moderate variance (0-20% over)
      multiplier = 1.00 + random() * 0.20
    } else {
      // Very low value players: still cap at $3 but with some variance
      return Math.min(this.sd(3) + random() * this.budgetScale, player.estimatedValue * (1.15 + random() * 0.25))
    }
    
    return player.estimatedValue * multiplier
  }

  hasOpenStartingSlot(position) {
    if (!this.team) return false
    const rc = this.team.config?.rosterPositions || {}
    const rosterByPos = {}
    for (const p of this.team.roster) {
      rosterByPos[p.position] = (rosterByPos[p.position] || 0) + 1
    }
    // Direct starter slot (e.g. RB:2 needs 2 RBs)
    if ((rosterByPos[position] || 0) < (rc[position] || 0)) return true
    // FLEX slot (RB/WR/TE eligible)
    if (['RB', 'WR', 'TE'].includes(position) && (rc.FLEX || 0) > 0) {
      const flexEligibleSlots = (rc.RB || 0) + (rc.WR || 0) + (rc.TE || 0) + (rc.FLEX || 0)
      const flexEligibleFilled = (rosterByPos.RB || 0) + (rosterByPos.WR || 0) + (rosterByPos.TE || 0)
      if (flexEligibleFilled < flexEligibleSlots) return true
    }
    // SUPERFLEX slot (QB/RB/WR/TE eligible)
    if (['QB', 'RB', 'WR', 'TE'].includes(position) && (rc.SUPERFLEX || 0) > 0) {
      const sfEligibleSlots = (rc.QB || 0) + (rc.RB || 0) + (rc.WR || 0) + (rc.TE || 0) + (rc.FLEX || 0) + (rc.SUPERFLEX || 0)
      const sfEligibleFilled = (rosterByPos.QB || 0) + (rosterByPos.RB || 0) + (rosterByPos.WR || 0) + (rosterByPos.TE || 0)
      if (sfEligibleFilled < sfEligibleSlots) return true
    }
    return false
  }

  getStarterUrgencyBoost(player, availablePlayers) {
    // Teams overpay for starter slots, especially when the next best at the
    // same position is a meaningful step down. Magnitudes are intentionally
    // small — combined with pacingBoost via Math.max in getAdjustedPlayerValue,
    // so this caps the single-source urgency contribution.
    if (!this.hasOpenStartingSlot(player.position)) return 1.0
    if (!availablePlayers || availablePlayers.length === 0) return 1.03
    const samePos = availablePlayers
      .filter(p => p.position === player.position && p.id !== player.id)
      .sort((a, b) => b.estimatedValue - a.estimatedValue)
    const nextBest = samePos[0]
    if (!nextBest || player.estimatedValue <= 0) return 1.03
    const tierDrop = (player.estimatedValue - nextBest.estimatedValue) / player.estimatedValue
    if (tierDrop > 0.30) return 1.12
    if (tierDrop > 0.15) return 1.06
    return 1.03
  }

  getPacingRatio() {
    if (!this.team) return 1.0
    const rc = this.team.config?.rosterPositions || {}
    const totalSpots = Object.values(rc).reduce((sum, c) => sum + c, 0)
    const spotsLeft = this.team.getRosterSpotsRemaining()
    if (totalSpots <= 0 || spotsLeft <= 0) return 1.0
    const expectedPerPick = this.team.budget / totalSpots
    const currentPerPick = this.team.remainingBudget / spotsLeft
    if (expectedPerPick <= 0) return 1.0
    return currentPerPick / expectedPerPick
  }

  getBudgetConservationFactor() {
    if (!this.team) return 1.0
    const ratio = this.getPacingRatio()
    if (ratio > 2.0) return 1.15
    if (ratio > 1.5) return 1.05
    if (ratio > 0.8) return 1.0
    if (ratio > 0.5) return 0.92
    return 0.85
  }

  getPositionMultiplier(position) {
    const base = this.preferences.positionMultipliers?.[position] || 1.0
    // Stretch behavior: in middle rounds, teams occasionally bid outside their
    // strategic profile when a strong target appears. For positions normally
    // devalued (e.g. ZeroRB on RB, LateRoundQB on QB), occasionally treat as
    // neutral. Models the "I'll stretch on this one player" real-world play.
    if (base < 1.0 && this.team) {
      const rc = this.team.config?.rosterPositions || {}
      const totalSpots = Object.values(rc).reduce((s, c) => s + c, 0)
      const draftProgress = this.team.roster.length / Math.max(1, totalSpots)
      if (draftProgress > 0.25 && draftProgress < 0.7 && random() < 0.08) {
        return Math.max(base, 1.0)
      }
    }
    return base
  }

  getEarlyDraftMultiplier() {
    return 1.0 + random() * 0.10 // 1.0x to 1.1x (lowered to curb early-draft inflation)
  }

  getPositionNeedMultiplier(position) {
    const baseNeed = this.team.getPositionNeed(position)
    if (baseNeed >= 2) return 1.2  // multiple base starters still open → premium
    if (baseNeed === 1) return 1.0 // one base starter still open

    // baseNeed === 0: this position's base starter slots are full. Before
    // applying the deep backup discount, check whether the player could still
    // fill an open FLEX (RB/WR/TE) or SUPERFLEX (QB/RB/WR/TE) *starting* slot.
    // getPositionNeed only counts base slots, so without this the entire
    // mid-tier RB/WR market gets discounted to 0.55x the moment base slots
    // fill — even with FLEX/SUPERFLEX wide open — and those players (Etienne,
    // G. Wilson, etc.) draw no real bids and sell for $1. Mirrors
    // hasOpenStartingSlot / getStarterUrgencyBoost, which already treat a FLEX
    // opening as a startable slot.
    const flexEligible = ['RB', 'WR', 'TE'].includes(position) && this.team.getFlexNeed() > 0
    const sfEligible = ['QB', 'RB', 'WR', 'TE'].includes(position) && this.team.getSuperflexNeed() > 0
    if (flexEligible || sfEligible) return 1.0 // still filling a starting slot

    return 0.55 // genuine bench depth — deep discount
  }

  evaluateBid(player, currentBid, adjustedValue, availablePlayers) {
    // Never bid on zero-value players
    if (adjustedValue <= 0) return false
    
    // Psychology factors
    const draftProgress = this.team.roster.length / (Object.values(this.team.config?.rosterPositions || {}).reduce((sum, count) => sum + count, 0) || 15)
    
    // 15% chance team "zones out" and doesn't bid (analysis paralysis/distraction)
    // Increases with draft fatigue
    const zoneOutChance = 0.15 + (draftProgress * 0.10)
    if (random() < zoneOutChance) return false
    
    // Add "bidding emotion" - teams occasionally get caught up regardless of value
    let isEmotionalBidding = random() < 0.08 // 8% base chance
    
    // Momentum affects emotional bidding
    if (this.team.momentum === 'losing' && random() < 0.12) {
      isEmotionalBidding = true // Desperation bidding
    } else if (this.team.momentum === 'winning' && random() < 0.06) {
      isEmotionalBidding = true // Confidence bidding
    }
    
    // Budget panic - teams with lots of money late in draft might overspend
    if (draftProgress > 0.6 && this.team.remainingBudget > this.team.budget * 0.4) {
      isEmotionalBidding = isEmotionalBidding || random() < 0.15
    }
    
    // More competitive bidding on high-value players
    let randomFactor
    if (player.estimatedValue >= this.sd(50)) {
      // Elite players: Competitive range (85% to 115% of adjusted value)
      randomFactor = 0.85 + random() * 0.30
      if (isEmotionalBidding) randomFactor *= 1.20 // More emotional impact on elite players
    } else if (player.estimatedValue >= this.sd(30)) {
      // High-value players: Competitive range (85% to 110% of adjusted value)
      randomFactor = 0.85 + random() * 0.25
      if (isEmotionalBidding) randomFactor *= 1.15 // Increased emotional impact
    } else if (player.estimatedValue >= this.sd(15)) {
      // Mid-value players: More varied range (70% to 110% of adjusted value)
      randomFactor = 0.70 + random() * 0.40
      if (isEmotionalBidding) randomFactor *= 1.10 // Some emotional impact
    } else if (player.estimatedValue >= this.sd(5)) {
      // Low-mid players: Moderate range (75% to 105% of adjusted value)
      randomFactor = 0.75 + random() * 0.30
      if (isEmotionalBidding) randomFactor *= 1.05 // Minimal emotional impact
    } else {
      // Very low value players: Strict range to prevent overbidding (80% to 95% of adjusted value)
      randomFactor = 0.80 + random() * 0.15
      // No emotional bidding multiplier for very low value players
    }
    
    const bidThreshold = adjustedValue * randomFactor
    
    // Additional safety check: never bid high amounts on very low value players
    if (player.estimatedValue < this.sd(4) && currentBid >= this.sd(4)) {
      return false // Don't bid more than $4 on players worth less than $4
    }
    if (player.estimatedValue < this.sd(8) && currentBid >= player.estimatedValue * 2) {
      return false // Don't bid more than 2x value on low-value players
    }
    
    // Don't bid if current bid exceeds our threshold
    if (currentBid >= bidThreshold) return false
    
    // Variable skip probability based on value and team situation
    let skipProb = this.getSkipProbability()
    
    // Reduce "bargain hunting" behavior - be more competitive on expensive players
    // Remove automatic skip on elite players - let them compete
    
    if (player.estimatedValue >= this.sd(60)) {
      skipProb += 0.01 // Only 1% more likely to skip on truly elite players
    } else if (player.estimatedValue >= this.sd(40)) {
      skipProb += 0.015 // 1.5% more likely to skip on very expensive players
    } else if (player.estimatedValue >= this.sd(25)) {
      skipProb += 0.02 // 2% more likely to skip on expensive players
    }
    
    // Apply skip probability
    if (random() < Math.min(0.45, skipProb)) return false
    
    return true
  }

  getSkipProbability() {
    let baseSkip = 0.12
    const rc = this.team?.config?.rosterPositions || {}
    const totalSpots = Object.values(rc).reduce((s, c) => s + c, 0)
    const playersDrafted = this.team?.roster?.length || 0
    const draftProgress = Math.min(playersDrafted / Math.max(1, totalSpots), 1)
    const fatigueBonus = draftProgress * 0.05
    if (this.getPacingRatio() > 1.5) {
      return Math.max(0.04, baseSkip + fatigueBonus - 0.07)
    }
    return Math.min(0.25, baseSkip + fatigueBonus)
  }

  calculateBidAmount(player, currentBid, adjustedValue, availablePlayers = []) {
    // 10% chance of "budget miscalculation" - team thinks they have less money
    let effectiveMaxBid = this.team.maxBid
    if (random() < 0.10) {
      effectiveMaxBid = Math.max(1, Math.floor(this.team.maxBid * 0.8)) // Think they have 20% less
    }
    
    const maxReasonableBid = Math.min(effectiveMaxBid, adjustedValue)
    
    // Determine bid increment based on strategy and situation
    const increment = this.getBidIncrement(player, currentBid, adjustedValue)
    
    let bidAmount = Math.min(maxReasonableBid, currentBid + increment)

    // Endgame surplus burn: jump straight to the fair-share floor instead of
    // creeping by increments. In an English auction the winner only pays the
    // runner-up's ceiling, so a flush team that wins cheap strands its budget;
    // jump-bidding converts its endgame purchases to first-price and actually
    // drains the money. Bounded by maxReasonableBid (maxBid + adjustedValue).
    const endgameFloor = Math.round(this.getEndgameSpendFloor(player, availablePlayers))
    if (endgameFloor > currentBid) {
      bidAmount = Math.min(maxReasonableBid, Math.max(bidAmount, endgameFloor))
    }

    // Final safety check: prevent extreme overbids on low-value players — the
    // sanctioned endgame floor is the one exception, or it could never lift a
    // late-board $1-4 player above $3 and surplus would strand.
    const cheapFloor = player.estimatedValue <= this.sd(4) ? this.sd(3) : 0
    if (cheapFloor) {
      bidAmount = Math.min(bidAmount, Math.max(cheapFloor, endgameFloor))
    }

    // Positional spend limit is a hard ceiling — it clamps even the
    // sanctioned endgame/cheap floors above.
    bidAmount = Math.min(bidAmount, this.getPositionalBidCap(player))

    // Only a genuine over-cap warrants the diagnostic. Bids within a sanctioned
    // floor — the endgame spend floor or the cheap-player $3 floor above (which
    // routinely lifts a sub-$3 K/DST past 1.4× its tiny estimated value) — are
    // intended, not anomalies; excluding them keeps the log signal, not noise.
    const sanctionedFloor = Math.max(endgameFloor, cheapFloor)
    if (bidAmount > player.estimatedValue * 1.4 && bidAmount > sanctionedFloor) {
      // eslint-disable-next-line no-console
      console.warn('[adraft] over-cap bid', {
        team: this.team?.name,
        strategy: this.constructor.name,
        player: player.name,
        playerId: player.id,
        estimatedValue: player.estimatedValue,
        currentBid,
        adjustedValue,
        maxBid: this.team?.maxBid,
        rosterLength: this.team?.roster?.length,
        spotsLeft: this.team?.getRosterSpotsRemaining?.(),
        bidAmount
      })
    }

    return Math.round(bidAmount)
  }

  getBidIncrement(player, currentBid, adjustedValue) {
    // Safety check: prevent massive bid increments on low-value players
    if (player.estimatedValue <= this.sd(4)) {
      // For very low value players, only allow $1 increments
      return 1
    }

    // Check if player is significantly undervalued to speed up auction
    const undervaluedAmount = adjustedValue - currentBid

    // Large jumps for severely undervalued players (speeds up auction)
    if (undervaluedAmount >= this.sd(25)) {
      // Jump $15-20 for severely undervalued players
      return this.si(Math.floor(random() * 6) + 15) // $15-20
    }

    if (undervaluedAmount >= this.sd(15)) {
      // Jump $10-15 for significantly undervalued players
      return this.si(Math.floor(random() * 6) + 10) // $10-15
    }

    if (undervaluedAmount >= this.sd(8)) {
      // Jump $5-10 for moderately undervalued players
      return this.si(Math.floor(random() * 6) + 5) // $5-10
    }

    // Standard bidding for fairly priced players
    if (random() < 0.7) return this.si(1)

    // Occasionally bid $2-5 to show aggression
    if (random() < 0.8) return this.si(Math.floor(random() * 4) + 2)

    // Rarely make larger jumps for high-value players
    if (player.estimatedValue >= this.sd(30) && random() < 0.1) {
      return this.si(Math.floor(random() * 8) + 5)
    }

    return this.si(1)
  }

  isRiskyNomination(player) {
    // "Risky" = if we put this on the block, no other team is likely to
    // bid (cheap + nobody needs them), and we don't want them either —
    // so the no-bid rule would stick us with the player at $1. Players we
    // need or that our strategy multiplies up to >1.0 are *not* risky;
    // we're happy to win them.
    if (!this.team) return false
    const RISK_VALUE_CEILING = this.sd(2)
    if (player.estimatedValue > RISK_VALUE_CEILING) return false
    if (this.team.getPositionNeed(player.position) > 0) return false
    const mult = this.preferences?.positionMultipliers?.[player.position] ?? 1.0
    if (mult > 1.0) return false
    return true
  }

  filterNominationPool(availablePlayers) {
    const safe = availablePlayers.filter(p => !this.isRiskyNomination(p))
    return safe.length > 0 ? safe : availablePlayers
  }

  shouldNominate(player, availablePlayers = []) {
    // Apply position limits to nominations too
    if (this.shouldApplyPositionLimits(player)) {
      return false
    }
    
    // Default nomination strategy - nominate players we want at fair value
    const adjustedValue = this.getAdjustedPlayerValue(player, availablePlayers)
    const ourBidThreshold = adjustedValue * 0.9 // Willing to pay 90% of adjusted value
    
    return ourBidThreshold >= player.estimatedValue * 0.8
  }

  selectNomination(availablePlayers) {
    availablePlayers = this.filterNominationPool(availablePlayers)
    // Sort players by estimated value
    const sortedPlayers = [...availablePlayers].sort((a, b) => b.estimatedValue - a.estimatedValue)

    // Over-pace nomination: when a team is sitting on surplus budget, they
    // nominate top remaining players to draw competitive bidding from other
    // flush teams, draining surplus through real auctions instead of skipping.
    if (this.team) {
      const rc = this.team.config?.rosterPositions || {}
      const totalSpots = Object.values(rc).reduce((s, c) => s + c, 0)
      const draftProgress = this.team.roster.length / Math.max(1, totalSpots)
      const pacingRatio = this.getPacingRatio()

      if (pacingRatio > 1.3 && draftProgress > 0.3 && sortedPlayers.length > 0) {
        // Pick from top-3 remaining players for variety (not always #1)
        const top = sortedPlayers.slice(0, 3)
        return top[Math.floor(random() * top.length)]
      }
    }

    // Get top 150 players or all if less than 150 available
    const top150Players = sortedPlayers.slice(0, 150)
    
    // If we have top 150 players available, use normal nomination logic with them
    if (top150Players.length > 0) {
      // Strategy 1: Nominate player we want from top 150 (40% chance)
      if (random() < 0.4) {
        const wantedPlayers = top150Players.filter(p => this.shouldNominate(p, availablePlayers))
        if (wantedPlayers.length > 0) {
          return wantedPlayers[Math.floor(random() * wantedPlayers.length)]
        }
      }
      
      // Strategy 2: Price enforce high-value player we don't want from top 150 (30% chance)
      if (random() < 0.5) {
        const expensivePlayers = top150Players
          .filter(p => p.estimatedValue >= this.sd(25) && !this.shouldNominate(p, availablePlayers))
        
        if (expensivePlayers.length > 0) {
          return expensivePlayers[Math.floor(random() * Math.min(3, expensivePlayers.length))]
        }
      }
      
      // Strategy 3: Nominate position of need from top 150 at fair value (30% chance)
      const neededPositions = Object.keys(this.team.config?.rosterPositions || {})
        .filter(pos => this.team.getPositionNeed(pos) > 0)
      
      if (neededPositions.length > 0) {
        const randomPosition = neededPositions[Math.floor(random() * neededPositions.length)]
        const positionPlayers = top150Players
          .filter(p => p.position === randomPosition)
        
        if (positionPlayers.length > 0) {
          return positionPlayers[Math.floor(random() * Math.min(5, positionPlayers.length))]
        }
      }
      
      // Fallback: Nominate from top 150
      return top150Players[Math.floor(random() * Math.min(10, top150Players.length))]
    }
    
    // All top 150 are taken, focus on top 25 remaining players
    const top25Remaining = sortedPlayers.slice(0, 25)
    
    if (top25Remaining.length > 0) {
      // Apply simplified logic for remaining players - focus on value and need
      const neededPositions = Object.keys(this.team.config?.rosterPositions || {})
        .filter(pos => this.team.getPositionNeed(pos) > 0)
      
      // 60% chance to nominate a position of need from top 25
      if (neededPositions.length > 0 && random() < 0.6) {
        const randomPosition = neededPositions[Math.floor(random() * neededPositions.length)]
        const positionPlayers = top25Remaining.filter(p => p.position === randomPosition)
        
        if (positionPlayers.length > 0) {
          return positionPlayers[0] // Take the highest value at needed position
        }
      }
      
      // Otherwise nominate highest value from top 25
      return top25Remaining[0]
    }
    
    // Ultimate fallback: highest value available
    return sortedPlayers[0]
  }
}