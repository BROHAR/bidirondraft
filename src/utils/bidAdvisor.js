import { getPlayerVORP } from './draftAnalysis.js'

// =========================================================
// Bid Advisor — deterministic, explainable advice for the human drafter
// =========================================================
// Given the current auction state, returns a recommended max bid plus a
// verdict that classifies the *current* bid (Bargain / Fair / Stretch / Stop
// / Pass) and a sorted list of dollar-weighted reasons. Pure function, no
// randomness — same inputs always produce the same output. Unlike the AI
// strategy stack in BaseStrategy, this does not model emotion, pacing skips,
// or per-strategy preferences; it gives objective per-team value advice.

const POSITION_LIMITS = {
  QB: (rc) => (rc.QB || 0) + (rc.SUPERFLEX || 0) + 1,
  TE: (rc) => (rc.TE || 0) + 1,
  K: () => 2,
  DST: () => 2,
}

function getPositionLimit(position, rosterPositions) {
  const fn = POSITION_LIMITS[position]
  return fn ? fn(rosterPositions) : Infinity
}

function countAtPosition(roster, position) {
  return roster.filter((p) => p.position === position).length
}

function hasOpenStartingSlot(team, position) {
  const rc = team.config?.rosterPositions || {}
  const byPos = {}
  for (const p of team.roster) byPos[p.position] = (byPos[p.position] || 0) + 1

  if ((byPos[position] || 0) < (rc[position] || 0)) return true

  if (['RB', 'WR', 'TE'].includes(position) && (rc.FLEX || 0) > 0) {
    const slots = (rc.RB || 0) + (rc.WR || 0) + (rc.TE || 0) + (rc.FLEX || 0)
    const filled = (byPos.RB || 0) + (byPos.WR || 0) + (byPos.TE || 0)
    if (filled < slots) return true
  }

  if (['QB', 'RB', 'WR', 'TE'].includes(position) && (rc.SUPERFLEX || 0) > 0) {
    const slots =
      (rc.QB || 0) + (rc.RB || 0) + (rc.WR || 0) + (rc.TE || 0) +
      (rc.FLEX || 0) + (rc.SUPERFLEX || 0)
    const filled =
      (byPos.QB || 0) + (byPos.RB || 0) + (byPos.WR || 0) + (byPos.TE || 0)
    if (filled < slots) return true
  }

  return false
}

function getNeedBoost(team, position) {
  const need = team.getPositionNeed ? team.getPositionNeed(position) : 0
  if (need >= 2) return { pct: 0.10, label: `Fills ${position} starter need` }
  if (need === 1) return { pct: 0.06, label: `Fills ${position} starter slot` }
  if (hasOpenStartingSlot(team, position)) {
    return { pct: 0.03, label: `Eligible for open flex/SF slot` }
  }
  return { pct: 0, label: null }
}

function getScarcityBoost(player, availablePlayers) {
  const samePos = availablePlayers
    .filter((p) => p.position === player.position && p.id !== player.id)
    .sort((a, b) => (b.estimatedValue || 0) - (a.estimatedValue || 0))
  const nextBest = samePos[0]
  if (!nextBest || !player.estimatedValue) return { pct: 0, label: null, nextBest: null }
  const drop = (player.estimatedValue - nextBest.estimatedValue) / player.estimatedValue
  if (drop > 0.30) {
    return {
      pct: 0.08,
      label: `Big tier drop — next ${player.position} is $${nextBest.estimatedValue}`,
      nextBest,
    }
  }
  if (drop > 0.15) {
    return {
      pct: 0.04,
      label: `Tier drop — next ${player.position} is $${nextBest.estimatedValue}`,
      nextBest,
    }
  }
  return { pct: 0, label: null, nextBest }
}

function getVonaInfo(player, availablePlayers, replacementLevels) {
  const playerVorp = getPlayerVORP(player, replacementLevels)
  let bestOther = 0
  let hasHigher = false
  let higherName = null
  for (const p of availablePlayers) {
    if (p.id === player.id || p.position !== player.position) continue
    const v = getPlayerVORP(p, replacementLevels)
    if (v > playerVorp) {
      hasHigher = true
      higherName = p.name
      break
    }
    if (v > bestOther) bestOther = v
  }
  return { playerVorp, bestOther, hasHigher, higherName }
}

function getPaceInfo(team) {
  const rc = team.config?.rosterPositions || {}
  const totalSpots = Object.values(rc).reduce((s, c) => s + c, 0)
  const spotsLeft = team.getRosterSpotsRemaining ? team.getRosterSpotsRemaining() : 0
  if (totalSpots <= 0 || spotsLeft <= 0) {
    return { ratio: 1, expectedPerSlot: 0, actualPerSlot: 0 }
  }
  const expectedPerSlot = team.budget / totalSpots
  const actualPerSlot = team.remainingBudget / spotsLeft
  const ratio = expectedPerSlot > 0 ? actualPerSlot / expectedPerSlot : 1
  return { ratio, expectedPerSlot, actualPerSlot, spotsLeft }
}

function getPaceBoost(team) {
  const pace = getPaceInfo(team)
  const surplus = Math.round(pace.actualPerSlot - pace.expectedPerSlot)
  if (pace.ratio >= 1.20) {
    return { pct: 0.10, label: `Over pace by ~$${surplus}/slot — spend it` }
  }
  if (pace.ratio >= 1.05) {
    return { pct: 0.05, label: `Slightly over pace (~$${surplus}/slot)` }
  }
  if (pace.ratio <= 0.80) {
    return { pct: -0.10, label: `Under pace by ~$${-surplus}/slot — conserve` }
  }
  return { pct: 0, label: null }
}

export function getBidAdvice(player, currentBid, humanTeam, availablePlayers, replacementLevels) {
  if (!player || !humanTeam) {
    return { maxBid: 0, verdict: 'PASS', reasons: [], breakdown: {} }
  }

  const rc = humanTeam.config?.rosterPositions || {}
  const base = player.estimatedValue || 0
  const breakdown = { base }

  // Hard PASS gates — no roster spot, or position already over the limit.
  const spotsLeft = humanTeam.getRosterSpotsRemaining
    ? humanTeam.getRosterSpotsRemaining()
    : 0
  if (spotsLeft <= 0) {
    return {
      maxBid: 0,
      verdict: 'PASS',
      reasons: [{ label: 'Roster is full', delta: 0 }],
      breakdown,
    }
  }

  if (['QB', 'TE', 'K', 'DST'].includes(player.position)) {
    const limit = getPositionLimit(player.position, rc)
    const count = countAtPosition(humanTeam.roster, player.position)
    if (count >= limit) {
      return {
        maxBid: 1,
        verdict: 'PASS',
        reasons: [{ label: `Already have ${count} ${player.position}${count > 1 ? 's' : ''}`, delta: 0 }],
        breakdown,
      }
    }
  }

  // Build the additive boost stack.
  const need = getNeedBoost(humanTeam, player.position)
  const scarcity = getScarcityBoost(player, availablePlayers)
  const vona = getVonaInfo(player, availablePlayers, replacementLevels || {})
  const pace = getPaceBoost(humanTeam)

  let vonaBoostPct = 0
  let vonaLabel = null
  let vonaCap = false
  if (vona.hasHigher) {
    vonaCap = true
    vonaLabel = `Better ${player.position} still available: ${vona.higherName}`
  } else {
    const margin = vona.playerVorp - vona.bestOther
    if (margin >= 20) {
      vonaBoostPct = 0.05
      vonaLabel = `+${Math.round(margin)} VORP over next ${player.position}`
    }
  }

  const totalPct = need.pct + scarcity.pct + vonaBoostPct + pace.pct
  let maxBid = Math.round(base * (1 + totalPct))

  // Hard ceiling — never recommend more than 1.35× book.
  maxBid = Math.min(maxBid, Math.round(base * 1.35))

  // If a higher-VORP player at this position is still on the board, never
  // recommend more than book value — opportunity cost is too high.
  if (vonaCap) maxBid = Math.min(maxBid, base)

  // Budget reality — never advise a bid the team literally cannot make.
  const teamMax = typeof humanTeam.maxBid === 'number' ? humanTeam.maxBid : Infinity
  maxBid = Math.max(1, Math.min(maxBid, teamMax))

  // Reasons — sorted by absolute dollar contribution, top 4.
  const reasons = []
  const pushReason = (pct, label) => {
    if (!label || pct === 0) return
    reasons.push({ label, delta: Math.round(base * pct) })
  }
  pushReason(need.pct, need.label)
  pushReason(scarcity.pct, scarcity.label)
  pushReason(vonaBoostPct, vonaLabel && !vonaCap ? vonaLabel : null)
  pushReason(pace.pct, pace.label)
  if (vonaCap && vonaLabel) {
    reasons.push({ label: vonaLabel, delta: 0 })
  }
  if (teamMax < base && teamMax < maxBid + 1) {
    reasons.push({ label: `Budget caps you at $${teamMax}`, delta: 0 })
  }
  reasons.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  // Verdict — compare the next legal bid to the recommended max.
  const nextBid = (currentBid || 0) + 1
  let verdict
  if (nextBid > teamMax) {
    verdict = 'PASS'
  } else if (nextBid <= maxBid * 0.70) {
    verdict = 'BARGAIN'
  } else if (nextBid <= maxBid) {
    verdict = 'FAIR'
  } else if (nextBid <= maxBid * 1.05) {
    verdict = 'STRETCH'
  } else {
    verdict = 'STOP'
  }

  breakdown.needPct = need.pct
  breakdown.scarcityPct = scarcity.pct
  breakdown.vonaPct = vonaBoostPct
  breakdown.pacePct = pace.pct
  breakdown.vonaCap = vonaCap
  breakdown.playerVorp = Math.round(vona.playerVorp)
  breakdown.teamMaxBid = teamMax
  breakdown.paceRatio = Math.round(getPaceInfo(humanTeam).ratio * 100) / 100

  return { maxBid, verdict, reasons: reasons.slice(0, 4), breakdown }
}
