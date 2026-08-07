import { budgetScaleFor } from './budgetScaling.js'

// Inverse operations for a completed auction sale, used by the draft store's
// "Undo Last Pick" action. completeBidding / resolveAuctionSync mutate Team
// and Player instances in place (roster push, budget deduct, psychology
// outcome push, momentum); this module reverts those mutations from a
// draftHistory entry, so undo works from live state without snapshots — which
// also makes it repeatable (multi-level undo, newest pick first).
//
// Known approximation: updateTeamPsychology caps recentBidOutcomes at 5 by
// shifting off the oldest entry, and that dropped entry is unrecoverable. The
// rolling window is soft AI "mood" flavor, so losing its oldest slot across an
// undo has no gameplay-visible effect; roster, budget, and pool state — the
// things that decide the draft — are restored exactly.

// Revert the team-object side of `entry` (a draftHistory item). Returns the
// buying team, or null for "No Bids" fallback entries (which never mutated a
// team in the first place). The caller owns the store-side reverts
// (draftHistory pop, availablePlayers restore).
export function revertSale(teams, entry) {
  const player = entry.player
  const team = teams.find(t => t.name === entry.team) || null
  if (team) {
    team.roster = team.roster.filter(p => p.id !== player.id)
    team.remainingBudget += entry.price
  }
  revertPsychology(teams, team, player)
  player.purchasePrice = null
  return team
}

// Pop the bid outcome this sale pushed onto each team (a won outcome for the
// winner, a lost outcome for every other AI team — mirroring
// updateTeamPsychology), then recompute momentum from what remains. Outcomes
// are only popped when they demonstrably belong to this sale (same player,
// right won/lost flag), so a malformed entry can never eat unrelated history.
export function revertPsychology(teams, winner, player) {
  for (const team of teams) {
    if (team === winner) {
      if (popMatchingOutcome(team, player, true)) recomputeMomentum(team)
    } else if (!team.isHuman) {
      if (popMatchingOutcome(team, player, false)) recomputeMomentum(team)
    }
  }
}

function popMatchingOutcome(team, player, won) {
  const outcomes = team.recentBidOutcomes
  const last = outcomes[outcomes.length - 1]
  if (last && last.player?.id === player.id && !!last.won === won) {
    outcomes.pop()
    return true
  }
  return false
}

// Re-derive momentum from the remaining outcomes using the same rules
// updateTeamPsychology applies: a team whose latest outcome is a win is judged
// by that deal's value-vs-price; otherwise by its recent loss count.
function recomputeMomentum(team) {
  const outcomes = team.recentBidOutcomes
  if (outcomes.length === 0) {
    team.momentum = 'neutral'
    return
  }
  const last = outcomes[outcomes.length - 1]
  const scale = budgetScaleFor(team.budget)
  if (last.won) {
    if (last.value >= 5 * scale) team.momentum = 'winning'
    else if (last.value <= -8 * scale) team.momentum = 'losing'
    else team.momentum = 'neutral'
  } else {
    const recentLosses = outcomes.filter(o => !o.won).length
    if (recentLosses >= 3) team.momentum = 'losing'
    else if (recentLosses <= 1) team.momentum = 'winning'
    else team.momentum = 'neutral'
  }
}
