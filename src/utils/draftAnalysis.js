import { budgetScaleFor } from './budgetScaling'

// Extracted from AllTeamsSummary.jsx so both components share identical lineup logic
export function getStartingLineup(team, rosterPositions) {
  const rc = rosterPositions || {}
  const byPos = {
    QB:  [...team.roster].filter(p => p.position === 'QB').sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0)),
    RB:  [...team.roster].filter(p => p.position === 'RB').sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0)),
    WR:  [...team.roster].filter(p => p.position === 'WR').sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0)),
    TE:  [...team.roster].filter(p => p.position === 'TE').sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0)),
    K:   [...team.roster].filter(p => p.position === 'K').sort((a, b)  => (b.projectedPoints || 0) - (a.projectedPoints || 0)),
    DST: [...team.roster].filter(p => p.position === 'DST').sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0)),
  }
  const starters = []

  Object.keys(rc).forEach(pos => {
    if (pos === 'FLEX' || pos === 'SUPERFLEX' || pos === 'BENCH') return
    const avail = byPos[pos] || []
    for (let i = 0; i < rc[pos] && i < avail.length; i++) starters.push(avail[i])
  })

  if (rc.FLEX > 0) {
    const flex = [
      ...byPos.RB.slice(rc.RB || 0),
      ...byPos.WR.slice(rc.WR || 0),
      ...byPos.TE.slice(rc.TE || 0),
    ].sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0))
    for (let i = 0; i < rc.FLEX && i < flex.length; i++) starters.push(flex[i])
  }

  if (rc.SUPERFLEX > 0) {
    const sf = [
      ...byPos.QB.slice(rc.QB || 0),
      ...byPos.RB.slice(rc.RB || 0),
      ...byPos.WR.slice(rc.WR || 0),
      ...byPos.TE.slice(rc.TE || 0),
    ].sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0))
    for (let i = 0; i < rc.SUPERFLEX && i < sf.length; i++) starters.push(sf[i])
  }

  return starters
}

export function calculateStarterPoints(team, rosterPositions) {
  return getStartingLineup(team, rosterPositions)
    .reduce((sum, p) => sum + (p.projectedPoints || 0), 0)
}

export function getTotalValueCapture(team) {
  return team.roster.reduce((sum, p) => sum + (p.estimatedValue - (p.purchasePrice || 0)), 0)
}

export function rankTeamsByStarterPoints(teams, rosterPositions) {
  return [...teams].sort(
    (a, b) => calculateStarterPoints(b, rosterPositions) - calculateStarterPoints(a, rosterPositions)
  )
}

export function calculateDraftGrade(humanTeam, allTeams, rosterPositions) {
  const ranked = rankTeamsByStarterPoints(allTeams, rosterPositions)
  const rank = ranked.findIndex(t => t.id === humanTeam.id) + 1
  const n = allTeams.length

  const rankPct  = 1 - (rank - 1) / Math.max(n - 1, 1)
  const valuePct = Math.min(1, Math.max(0, (getTotalValueCapture(humanTeam) + 30) / 80))
  const budgetPct = Math.min(1, (humanTeam.budget - humanTeam.remainingBudget) / humanTeam.budget)

  const score = rankPct * 0.4 + valuePct * 0.4 + budgetPct * 0.2

  if (score >= 0.88) return 'A+'
  if (score >= 0.78) return 'A'
  if (score >= 0.68) return 'A-'
  if (score >= 0.58) return 'B+'
  if (score >= 0.48) return 'B'
  if (score >= 0.38) return 'B-'
  return 'C'
}

export function gradeColor(grade) {
  if (grade.startsWith('A')) return 'var(--accent-positive)'
  if (grade.startsWith('B')) return 'var(--accent-money)'
  return 'var(--accent-negative)'
}

// Percentage-based value classifier shared by the pick card and post-draft badges.
// Tiers: value (≤ -15%), slight-value (-5% to -15%), fair (±5%), slight-overpay (+5% to +15%), overpay (≥ +15%)
export function getValueLabel(estimatedValue, pricePaid) {
  const deltaDollars = pricePaid - estimatedValue
  if (!estimatedValue || estimatedValue <= 0) {
    return { text: 'FAIR', cls: 'fair', pct: 0, deltaDollars }
  }
  const pct = (deltaDollars / estimatedValue) * 100
  const pctRounded = Math.round(pct)
  if (pct <= -15) return { text: `${pctRounded}% VALUE`,   cls: 'value',          pct, deltaDollars }
  if (pct <= -5)  return { text: `${pctRounded}% VALUE`,   cls: 'slight-value',   pct, deltaDollars }
  if (pct < 5)    return { text: 'FAIR',                   cls: 'fair',           pct, deltaDollars }
  if (pct < 15)   return { text: `+${pctRounded}% OVER`,   cls: 'slight-overpay', pct, deltaDollars }
  return            { text: `+${pctRounded}% OVER`,        cls: 'overpay',        pct, deltaDollars }
}

// Returns league-wide average projected points per dollar across all picks where price > 0.
// Used as the benchmark for the points-based value lens.
export function getLeagueAvgPointsPerDollar(draftHistory) {
  let totalPts = 0
  let totalPrice = 0
  draftHistory.forEach(pick => {
    if (pick.price > 0) {
      totalPts   += pick.player.projectedPoints || 0
      totalPrice += pick.price
    }
  })
  return totalPrice > 0 ? totalPts / totalPrice : 0
}

// Points-based value classifier. Sign convention: more projected points than expected → VALUE,
// fewer → OVER. CSS classes mirror getValueLabel so the same .value-badge styles apply.
// Tiers: value (≥ +15%), slight-value (+5% to +15%), fair (±5%), slight-overpay (-5% to -15%), overpay (≤ -15%)
export function getPointsValueLabel(projectedPoints, price, leagueAvgPointsPerDollar) {
  const pts = projectedPoints || 0
  const ptsPerDollar = price > 0 ? pts / price : 0
  if (price <= 0 || !leagueAvgPointsPerDollar || leagueAvgPointsPerDollar <= 0) {
    return { text: 'FAIR', cls: 'fair', pct: 0, surplusPts: 0, ptsPerDollar }
  }
  const expected   = price * leagueAvgPointsPerDollar
  const surplusPts = pts - expected
  if (expected <= 0) {
    return { text: 'FAIR', cls: 'fair', pct: 0, surplusPts, ptsPerDollar }
  }
  const pct        = (surplusPts / expected) * 100
  const pctRounded = Math.round(pct)
  if (pct >= 15) return { text: `+${pctRounded}% VALUE`,         cls: 'value',          pct, surplusPts, ptsPerDollar }
  if (pct >= 5)  return { text: `+${pctRounded}% VALUE`,         cls: 'slight-value',   pct, surplusPts, ptsPerDollar }
  if (pct > -5)  return { text: 'FAIR',                          cls: 'fair',           pct, surplusPts, ptsPerDollar }
  if (pct > -15) return { text: `${pctRounded}% OVER`,           cls: 'slight-overpay', pct, surplusPts, ptsPerDollar }
  return            { text: `${pctRounded}% OVER`,                cls: 'overpay',        pct, surplusPts, ptsPerDollar }
}

// Annotates draftHistory with pickIndex (1-based) plus both value lenses for table rendering and sorting.
export function getPickAnalysis(draftHistory, leagueAvgPointsPerDollar) {
  return draftHistory.map((pick, i) => {
    const dollarLabel = getValueLabel(pick.player.estimatedValue, pick.price)
    const pointsLabel = getPointsValueLabel(pick.player.projectedPoints, pick.price, leagueAvgPointsPerDollar)
    return {
      ...pick,
      pickIndex:    i + 1,
      dollarLabel,
      pointsLabel,
      dollarDelta:  pick.player.estimatedValue - pick.price,
      pointsDelta:  pointsLabel.surplusPts,
    }
  })
}

// Map a signed percentage (-30..+30) to a 5..95 left-offset for the variance bar marker.
// Fair-value zone in the bar is centered at 50% spanning 42–58% (matches mockup geometry).
export function getVariancePosition(pct) {
  const clamped = Math.max(-30, Math.min(30, pct))
  return 50 + (clamped / 30) * 45  // -30% → 5, 0 → 50, +30% → 95
}

// Returns { [position]: { avgPaid, avgEstimated, count, inflation } }
export function getMarketAveragesByPosition(draftHistory) {
  const groups = {}
  draftHistory.forEach(pick => {
    const pos = pick.player.position
    if (!groups[pos]) groups[pos] = { totalPaid: 0, totalEstimated: 0, count: 0 }
    groups[pos].totalPaid     += pick.price
    groups[pos].totalEstimated += pick.player.estimatedValue
    groups[pos].count++
  })
  return Object.fromEntries(
    Object.entries(groups).map(([pos, g]) => [
      pos,
      {
        avgPaid:      g.totalPaid / g.count,
        avgEstimated: g.totalEstimated / g.count,
        count:        g.count,
        inflation:    g.totalEstimated > 0 ? ((g.totalPaid / g.totalEstimated) - 1) * 100 : 0,
      }
    ])
  )
}

export function getBestValues(draftHistory, n = 5) {
  return [...draftHistory]
    .map(p => ({ ...p, valueDiff: p.player.estimatedValue - p.price }))
    .sort((a, b) => b.valueDiff - a.valueDiff)
    .slice(0, n)
}

export function getBiggestOverpays(draftHistory, n = 5) {
  return [...draftHistory]
    .map(p => ({ ...p, valueDiff: p.player.estimatedValue - p.price }))
    .sort((a, b) => a.valueDiff - b.valueDiff)
    .slice(0, n)
}

// Returns { [weekNumber]: Player[] } — only includes weeks with ≥1 starter on bye
export function getByeWeekMap(team, rosterPositions) {
  const starters = getStartingLineup(team, rosterPositions)
  const map = {}
  starters.forEach(p => {
    if (!p.byeWeek) return
    if (!map[p.byeWeek]) map[p.byeWeek] = []
    map[p.byeWeek].push(p)
  })
  return map
}

// Returns { [position]: { players[], spend } }
export function getPositionSpendingByGroup(team) {
  const groups = {}
  team.roster.forEach(p => {
    const pos = p.position
    if (!groups[pos]) groups[pos] = { players: [], spend: 0 }
    groups[pos].players.push(p)
    groups[pos].spend += p.purchasePrice || 0
  })
  return groups
}

// Returns array of { pickIndex, remaining, player?, price? } for human team picks
export function getHumanPicksTimeline(draftHistory, humanTeamName, initialBudget) {
  let remaining = initialBudget
  const points = []
  draftHistory.forEach((pick, i) => {
    if (pick.team === humanTeamName) {
      remaining -= pick.price
      points.push({ pickIndex: i + 1, remaining, player: pick.player, price: pick.price })
    }
  })
  return points
}

export function generateTakeaways(humanTeam, allTeams, draftHistory, rosterPositions) {
  const takeaways = []
  const mkt = getMarketAveragesByPosition(draftHistory)

  const positions = ['QB', 'RB', 'WR', 'TE']
  positions.forEach(pos => {
    const m = mkt[pos]
    if (!m || m.count < 3) return
    if (m.inflation > 12) {
      takeaways.push(`${pos}s averaged ${m.inflation.toFixed(0)}% above projected value — plan to spend more on ${pos}s in your real draft.`)
    } else if (m.inflation < -8) {
      takeaways.push(`${pos} was underpriced: avg paid was $${(m.avgEstimated - m.avgPaid).toFixed(0)} below projection — target this position for value.`)
    }
  })

  // Dollar thresholds below are tuned for a $200 budget; scale them so the
  // takeaways stay meaningful at other league budgets.
  const scale = budgetScaleFor(humanTeam.budget)

  if (humanTeam.remainingBudget > 15 * scale) {
    takeaways.push(`You left $${humanTeam.remainingBudget} unspent. In a real auction, unspent budget is wasted — push harder on late-round targets.`)
  }

  const vc = getTotalValueCapture(humanTeam)
  if (vc >= 25 * scale) {
    takeaways.push(`You captured $${vc.toFixed(0)} in net value — excellent auction discipline.`)
  } else if (vc <= -15 * scale) {
    takeaways.push(`You overpaid by $${Math.abs(vc).toFixed(0)} overall. Practice walking away when prices exceed projected value.`)
  }

  const ranked = rankTeamsByStarterPoints(allTeams, rosterPositions)
  const rank = ranked.findIndex(t => t.id === humanTeam.id) + 1
  const n = allTeams.length
  if (rank <= Math.ceil(n / 3)) {
    takeaways.push(`Your starter lineup ranked #${rank} of ${n} — top-tier roster construction.`)
  } else if (rank > Math.floor((n * 2) / 3)) {
    takeaways.push(`Your lineup ranked #${rank} of ${n}. Study which positions the top teams invested in heavily.`)
  }

  const byeMap = getByeWeekMap(humanTeam, rosterPositions)
  const conflicts = Object.entries(byeMap).filter(([, players]) => players.length >= 2)
  if (conflicts.length > 0) {
    const worst = conflicts.sort((a, b) => b[1].length - a[1].length)[0]
    takeaways.push(`${worst[1].length} starters share a bye in week ${worst[0]} — stagger bye weeks more carefully in the real draft.`)
  }

  return takeaways.slice(0, 5)
}

// Whole-draft, team-neutral synthesis of the Value vs Cost report. Takes the
// annotated picks (from getPickAnalysis), the league pts/$ benchmark, the VORP
// replacement levels, and the per-position market averages, and distills a few
// plain-English lessons. Deliberately avoids "you"/the human team — it reads the
// draft as a whole so the lessons transfer to the next one.
export function generateValueCostTakeaways(annotated, leagueAvg, replacementLevels, marketByPos) {
  const takeaways = []
  if (!annotated || annotated.length === 0) return takeaways

  const isVal  = cls => cls === 'value' || cls === 'slight-value'
  const isOver = cls => cls === 'overpay' || cls === 'slight-overpay'

  // Consensus split — both lenses agree.
  const consensusValue   = annotated.filter(p => isVal(p.dollarLabel.cls)  && isVal(p.pointsLabel.cls)).length
  const consensusOverpay = annotated.filter(p => isOver(p.dollarLabel.cls) && isOver(p.pointsLabel.cls)).length
  if (consensusValue > 0 || consensusOverpay > 0) {
    takeaways.push(
      `${consensusValue} pick${consensusValue === 1 ? ' was a bargain' : 's were bargains'} on both the dollar and points lenses, and ${consensusOverpay} ${consensusOverpay === 1 ? 'was an overpay' : 'were overpays'} on both — when the two lenses agree, that's the cleanest signal in the report.`
    )
  }

  // The "cheap but inefficient" trap — looked like a dollar value, but a points overpay.
  const trapCount = annotated.filter(p => isVal(p.dollarLabel.cls) && isOver(p.pointsLabel.cls)).length
  if (trapCount > 0) {
    takeaways.push(
      `${trapCount} pick${trapCount === 1 ? ' came in' : 's came in'} under estimated price yet returned below-average points per dollar — cheap isn't the same as efficient. Weigh projected points, not just the discount.`
    )
  }

  // Most efficient pick of the draft by $/VORP (lowest non-zero).
  let best = null
  annotated.forEach(p => {
    const vorp = getPlayerVORP(p.player, replacementLevels)
    if (vorp <= 0 || p.price <= 0) return
    const perVorp = p.price / vorp
    if (!best || perVorp < best.perVorp) best = { name: p.player.name, pos: p.player.position, perVorp }
  })
  if (best) {
    takeaways.push(
      `Most efficient pick of the draft: ${best.name} (${best.pos}) at $${best.perVorp.toFixed(2)} per point of VORP — the kind of cost-per-production target to hunt for next time.`
    )
  }

  // Hottest position vs estimated value (where the room paid up).
  if (marketByPos) {
    const ranked = ['QB', 'RB', 'WR', 'TE'].map(pos => ({ pos, ...marketByPos[pos] }))
      .filter(m => m && m.count >= 3)
      .sort((a, b) => b.inflation - a.inflation)
    const hottest = ranked[0]
    const coldest = ranked[ranked.length - 1]
    if (hottest && hottest.inflation > 8) {
      takeaways.push(
        `${hottest.pos}s went ${hottest.inflation.toFixed(0)}% over projected value — the room paid up there, so budget for it or pivot early.`
      )
    }
    if (coldest && coldest !== hottest && coldest.inflation < -8) {
      takeaways.push(
        `${coldest.pos}s slipped ${Math.abs(coldest.inflation).toFixed(0)}% under projected value — a position to wait on and scoop for a discount.`
      )
    }
  }

  // League pace — frame the benchmark every pick was measured against.
  if (leagueAvg > 0) {
    takeaways.push(
      `Every dollar spent in this draft bought about ${leagueAvg.toFixed(2)} projected points on average — the bar each pick's points verdict was measured against.`
    )
  }

  return takeaways.slice(0, 5)
}

// =========================================================
// VORP — Value Over Replacement Player
// =========================================================
// Replacement = the best player at each position who DOESN'T make a typical
// starting lineup across the league. FLEX seats distribute evenly across
// RB/WR/TE; SUPERFLEX distributes across QB/RB/WR/TE. Returns float
// thresholds (rounded when used to index the sorted player list).

export function getReplacementThresholds(rosterPositions, numberOfTeams) {
  const rp = rosterPositions || {}
  const n = numberOfTeams || 0
  const thresholds = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 }
  for (const pos of Object.keys(thresholds)) {
    thresholds[pos] = (rp[pos] || 0) * n
  }
  const flexSeats = (rp.FLEX || 0) * n
  const flexShare = flexSeats / 3
  thresholds.RB += flexShare
  thresholds.WR += flexShare
  thresholds.TE += flexShare
  const sfSeats = (rp.SUPERFLEX || 0) * n
  const sfShare = sfSeats / 4
  thresholds.QB += sfShare
  thresholds.RB += sfShare
  thresholds.WR += sfShare
  thresholds.TE += sfShare
  return thresholds
}

export function getReplacementLevels(allPlayers, rosterPositions, numberOfTeams) {
  const thresholds = getReplacementThresholds(rosterPositions, numberOfTeams)
  const levels = {}
  const players = {}
  for (const pos of Object.keys(thresholds)) {
    const positionPlayers = allPlayers
      .filter(p => p.position === pos)
      .sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0))
    const replacementRank = Math.round(thresholds[pos])
    const replacementPlayer =
      positionPlayers[replacementRank] || positionPlayers[positionPlayers.length - 1]
    levels[pos] = replacementPlayer?.projectedPoints || 0
    players[pos] = replacementPlayer || null
  }
  return { levels, players, thresholds }
}

export function getPlayerVORP(player, replacementLevels) {
  if (!player || !replacementLevels) return 0
  const pos = player.position
  const repl = replacementLevels[pos] ?? 0
  return Math.max(0, (player.projectedPoints || 0) - repl)
}

export function getTeamVORP(team, replacementLevels) {
  if (!team?.roster) return 0
  return team.roster.reduce((sum, p) => sum + getPlayerVORP(p, replacementLevels), 0)
}

// ---- Positional Strengths radar ----------------------------------------

const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DST']
const FLEX_ELIGIBLE = { FLEX: ['RB', 'WR', 'TE'], SUPERFLEX: ['QB', 'RB', 'WR', 'TE'] }

// Assign every rostered player to exactly one starting slot (optimal lineup,
// best-by-projectedPoints) or the bench. Returns slot occupants grouped by
// slot type plus the leftover bench. Single source of truth for the optimal
// lineup; buildRosterSlots (PostDraftAnalysis) renders from this.
export function getLineupSlots(team, rosterPositions) {
  const rc = rosterPositions || {}
  const roster = team?.roster || []
  const sort = (a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0)
  const byPos = {
    QB:  roster.filter(p => p.position === 'QB').sort(sort),
    RB:  roster.filter(p => p.position === 'RB').sort(sort),
    WR:  roster.filter(p => p.position === 'WR').sort(sort),
    TE:  roster.filter(p => p.position === 'TE').sort(sort),
    K:   roster.filter(p => p.position === 'K').sort(sort),
    DST: roster.filter(p => p.position === 'DST').sort(sort),
  }
  const used = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 }
  const slots = { QB: [], RB: [], WR: [], TE: [], FLEX: [], SUPERFLEX: [], K: [], DST: [] }

  for (const slotType of SLOT_ORDER) {
    const count = rc[slotType] || 0
    if (!count) continue
    if (slotType === 'FLEX' || slotType === 'SUPERFLEX') {
      const pool = FLEX_ELIGIBLE[slotType]
        .flatMap(pos => byPos[pos].slice(used[pos]))
        .sort(sort)
      for (let i = 0; i < count && i < pool.length; i++) {
        const p = pool[i]
        slots[slotType].push(p)
        used[p.position] += 1
      }
    } else {
      for (let i = 0; i < count && used[slotType] < byPos[slotType].length; i++) {
        slots[slotType].push(byPos[slotType][used[slotType]])
        used[slotType] += 1
      }
    }
  }

  const starterIds = new Set()
  for (const k of Object.keys(slots)) for (const p of slots[k]) starterIds.add(p.id)
  const bench = roster.filter(p => !starterIds.has(p.id))
  return { slots, bench, starterIds }
}

// Map of playerId -> rank score within its real position across the pool.
// Best player at a position scores `total` (count at that position), worst
// scores 1 — i.e. max(0, total - rank + 1). Higher = stronger, so it sums and
// normalizes like points/VORP.
export function getPositionalRankScores(allPlayers) {
  const byPos = {}
  for (const p of allPlayers || []) {
    if (!p) continue
    ;(byPos[p.position] ||= []).push(p)
  }
  const scores = new Map()
  for (const pos of Object.keys(byPos)) {
    const sorted = byPos[pos].sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0))
    const total = sorted.length
    sorted.forEach((p, idx) => scores.set(p.id, total - idx)) // idx 0 (best) -> total
  }
  return scores
}

// Players feeding one radar axis for one team, per the filter.
function axisPlayers(team, axis, filter, rosterPositions, lineup) {
  const rc = rosterPositions || {}
  if (axis === 'FLEX' || axis === 'SUPERFLEX') {
    // Starters: the optimal slot occupant(s). All/Bench: the best bench
    // flex-eligible player(s) not already starting (count = # of those slots).
    if (filter === 'starters') return lineup.slots[axis] || []
    const eligible = FLEX_ELIGIBLE[axis]
    return (team.roster || [])
      .filter(p => eligible.includes(p.position) && !lineup.starterIds.has(p.id))
      .sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0))
      .slice(0, rc[axis] || 0)
  }
  // Base position: Starters = base-slot occupants (FLEX/SF occupants belong to
  // their own axis). All = every rostered player at the position. Bench =
  // players at the position not in any starting slot.
  if (filter === 'starters') return lineup.slots[axis] || []
  const atPos = (team.roster || []).filter(p => p.position === axis)
  if (filter === 'all') return atPos
  return atPos.filter(p => !lineup.starterIds.has(p.id))
}

function axisMetric(players, stat, replacementLevels, rankScores) {
  if (stat === 'vorp') return players.reduce((s, p) => s + getPlayerVORP(p, replacementLevels), 0)
  if (stat === 'rank') return players.reduce((s, p) => s + (rankScores?.get(p.id) || 0), 0)
  return players.reduce((s, p) => s + (p.projectedPoints || 0), 0) // points
}

// Per-axis radar data for every team: raw values, field-normalized radii
// (0..1 where 1 = league best at that axis), per-axis league rank, and the
// field-average shape. axes follow the configured starting slots.
export function buildPositionalRadar(teams, rosterPositions, options = {}) {
  const { stat = 'points', filter = 'starters', replacementLevels = {}, rankScores = new Map() } = options
  const rc = rosterPositions || {}
  const axes = SLOT_ORDER.filter(a => (rc[a] || 0) > 0)
  const list = teams || []

  const byTeamId = {}
  for (const team of list) {
    const lineup = getLineupSlots(team, rosterPositions)
    const values = {}
    for (const axis of axes) {
      values[axis] = axisMetric(axisPlayers(team, axis, filter, rosterPositions, lineup), stat, replacementLevels, rankScores)
    }
    byTeamId[team.id] = { values, normalized: {}, ranks: {} }
  }

  const fieldMax = {}, fieldAvg = {}, fieldAvgNormalized = {}
  for (const axis of axes) {
    const vals = list.map(t => byTeamId[t.id].values[axis])
    const max = vals.length ? Math.max(0, ...vals) : 0
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
    fieldMax[axis] = max
    fieldAvg[axis] = avg
    fieldAvgNormalized[axis] = max > 0 ? avg / max : 0

    for (const team of list) {
      byTeamId[team.id].normalized[axis] = max > 0 ? byTeamId[team.id].values[axis] / max : 0
    }

    // Rank desc; ties share a rank.
    const sorted = [...list].sort((a, b) => byTeamId[b.id].values[axis] - byTeamId[a.id].values[axis])
    let lastVal = null, lastRank = 0
    sorted.forEach((t, idx) => {
      const v = byTeamId[t.id].values[axis]
      const rank = v === lastVal ? lastRank : idx + 1
      lastVal = v
      lastRank = rank
      byTeamId[t.id].ranks[axis] = { rank, of: list.length }
    })
  }

  return { axes, byTeamId, fieldMax, fieldAvg, fieldAvgNormalized }
}

// Power ranking from a radar result: average each team's per-axis league rank
// (lower = better) and order teams by that average. Ties share a power rank.
// Returns [{ teamId, avgRank, rank }] best-first.
export function getPowerRankings(radar) {
  const { axes = [], byTeamId = {} } = radar || {}
  const rows = Object.keys(byTeamId).map(teamId => {
    const ranks = byTeamId[teamId].ranks || {}
    const vals = axes.map(a => ranks[a]?.rank).filter(r => r != null)
    const avgRank = vals.length ? vals.reduce((s, r) => s + r, 0) / vals.length : 0
    return { teamId, avgRank }
  })
  rows.sort((a, b) => a.avgRank - b.avgRank)
  let lastAvg = null, lastRank = 0
  rows.forEach((row, idx) => {
    row.rank = row.avgRank === lastAvg ? lastRank : idx + 1
    lastAvg = row.avgRank
    lastRank = row.rank
  })
  return rows
}

// ---- Dream Team --------------------------------------------------------

const FLEX_ELIGIBLE_DREAM = { FLEX: ['RB', 'WR', 'TE'], SUPERFLEX: ['QB', 'RB', 'WR', 'TE'] }

// All compositions of `total` into `bins` non-negative integers.
function compositions(total, bins) {
  if (bins <= 1) return [[total]]
  const out = []
  for (let i = 0; i <= total; i++) {
    for (const rest of compositions(total - i, bins - 1)) out.push([i, ...rest])
  }
  return out
}

// Max total points choosing EXACTLY k of these items (each { cost, pts })
// with summed cost <= budget. Bounded 0/1 knapsack with backtrack. Returns
// { pts, cost, chosen: items[] } or null if infeasible.
function bestKWithinBudget(items, k, budget) {
  if (k === 0) return { pts: 0, cost: 0, chosen: [] }
  if (items.length < k) return null
  const NEG = -Infinity
  const dp = Array.from({ length: k + 1 }, () => new Float64Array(budget + 1).fill(NEG))
  const pick = Array.from({ length: k + 1 }, () => new Int32Array(budget + 1).fill(-1))
  for (let c = 0; c <= budget; c++) dp[0][c] = 0
  items.forEach((it, idx) => {
    const w = it.cost
    if (w > budget) return
    for (let j = k; j >= 1; j--) {
      for (let c = budget; c >= w; c--) {
        const cand = dp[j - 1][c - w]
        if (cand !== NEG && cand + it.pts > dp[j][c]) {
          dp[j][c] = cand + it.pts
          pick[j][c] = idx
        }
      }
    }
  })
  let bestC = -1, bestPts = NEG
  for (let c = 0; c <= budget; c++) {
    if (dp[k][c] > bestPts) { bestPts = dp[k][c]; bestC = c }
  }
  if (bestPts === NEG) return null
  // Backtrack: peel off the chosen items by re-deducting their cost.
  const chosen = []
  let j = k, c = bestC
  while (j > 0 && c >= 0) {
    const idx = pick[j][c]
    if (idx < 0) break
    chosen.push(items[idx].ref)
    c -= items[idx].cost
    j--
  }
  return { pts: bestPts, cost: bestC, chosen }
}

// Highest-points legal lineup whose players' summed cost <= budget. Enumerates
// how FLEX/SUPERFLEX slots split across eligible positions, solves each
// position as an exact-k budget knapsack, and convolves the positions over the
// shared budget. Returns the chosen player array, or null if no legal lineup
// fits. Each position's candidate list is pruned to the strongest + cheapest
// players (the only ones an optimum can use), keeping the DP small and exact
// in practice.
function optimizeAffordableLineup(byPosItems, rc, budget) {
  const fEduc = compositions(rc.FLEX || 0, FLEX_ELIGIBLE_DREAM.FLEX.length)
  const sEduc = compositions(rc.SUPERFLEX || 0, FLEX_ELIGIBLE_DREAM.SUPERFLEX.length)
  let best = null

  for (const fd of fEduc) {
    for (const sd of sEduc) {
      const need = {
        QB: (rc.QB || 0) + sd[0],
        RB: (rc.RB || 0) + fd[0] + sd[1],
        WR: (rc.WR || 0) + fd[1] + sd[2],
        TE: (rc.TE || 0) + fd[2] + sd[3],
        K: rc.K || 0,
        DST: rc.DST || 0,
      }
      const positions = Object.keys(need).filter(p => need[p] > 0)
      // Per-position arr[c] = max pts choosing exactly need[p] with cost <= c.
      const arrs = []
      let feasible = true
      for (const pos of positions) {
        const items = byPosItems[pos] || []
        if (items.length < need[pos]) { feasible = false; break }
        const arr = bestKCurve(items, need[pos], budget)
        if (arr[budget] === -Infinity) { feasible = false; break } // can't fit even at full budget
        arrs.push({ pos, need: need[pos], arr })
      }
      if (!feasible || arrs.length === 0) continue

      // Convolve positions over the budget, tracking each position's allotment.
      let comb = arrs[0].arr
      const splits = []
      for (let i = 1; i < arrs.length; i++) {
        const next = arrs[i].arr
        const nc = new Float64Array(budget + 1).fill(-Infinity)
        const argx = new Int32Array(budget + 1).fill(0)
        for (let c = 0; c <= budget; c++) {
          let bp = -Infinity, bx = 0
          for (let x = 0; x <= c; x++) {
            const a = comb[c - x], b = next[x]
            if (a !== -Infinity && b !== -Infinity && a + b > bp) { bp = a + b; bx = x }
          }
          nc[c] = bp
          argx[c] = bx
        }
        comb = nc
        splits.push(argx)
      }

      const totalPts = comb[budget]
      if (totalPts === -Infinity) continue
      if (!best || totalPts > best.pts) {
        // Backtrack per-position budget allotments.
        const alloc = new Array(arrs.length).fill(0)
        let c = budget
        for (let i = arrs.length - 1; i >= 1; i--) {
          const x = splits[i - 1][c]
          alloc[i] = x
          c -= x
        }
        alloc[0] = c
        const chosen = []
        for (let i = 0; i < arrs.length; i++) {
          const r = bestKWithinBudget(byPosItems[arrs[i].pos], arrs[i].need, alloc[i])
          if (r) chosen.push(...r.chosen)
        }
        best = { pts: totalPts, chosen }
      }
    }
  }
  return best ? best.chosen : null
}

// Full dp[k] curve: row[c] = max pts choosing exactly k with cost <= c.
function bestKCurve(items, k, budget) {
  const NEG = -Infinity
  const dp = Array.from({ length: k + 1 }, () => new Float64Array(budget + 1).fill(NEG))
  for (let c = 0; c <= budget; c++) dp[0][c] = 0
  for (const it of items) {
    const w = it.cost
    if (w > budget) continue
    for (let j = k; j >= 1; j--) {
      for (let c = budget; c >= w; c--) {
        const cand = dp[j - 1][c - w]
        if (cand !== NEG && cand + it.pts > dp[j][c]) dp[j][c] = cand + it.pts
      }
    }
  }
  return dp[k]
}

// The best legal starting lineup from the whole pool (every drafted player +
// still-available free agents), chosen by projected points. With a finite
// `budget`, returns the highest-points lineup whose players' summed cost fits
// that budget ("the best starters you could have bought for $budget at cost");
// unbounded otherwise. The budget available for starters is the full budget
// minus a $1 reservation per bench spot — a real roster still has to fill its
// bench at a minimum bid of $1 each, so that money can't go toward starters.
// Returns ordered starter rows ({ slotLabel, player }), a meta map
// (playerId -> { owner, cost, drafted }), lineup totals, the starter budget
// actually applied, and the bench reservation. Cost is the drafted purchase
// price, or estimatedValue for free agents (floored $1).
export function buildDreamTeam(allTeams, availablePlayers, rosterPositions, budget = Infinity) {
  const rc = rosterPositions || {}
  const benchReserve = rc.BENCH || 0
  const starterBudget = Number.isFinite(budget) ? Math.max(0, Math.floor(budget) - benchReserve) : budget
  const meta = new Map()
  const pool = []
  for (const t of allTeams || []) {
    for (const p of t.roster || []) {
      pool.push(p)
      meta.set(p.id, { owner: t.name, cost: p.purchasePrice ?? 0, drafted: true })
    }
  }
  for (const p of availablePlayers || []) {
    if (meta.has(p.id)) continue
    pool.push(p)
    meta.set(p.id, { owner: 'FA', cost: p.estimatedValue ?? 0, drafted: false })
  }

  const costOf = (p) => Math.max(1, Math.round(meta.get(p.id)?.cost || 0))
  const rowsFromPlayers = (players) => {
    const { slots } = getLineupSlots({ roster: players }, rc)
    const rows = []
    for (const slotType of SLOT_ORDER) {
      const count = rc[slotType] || 0
      if (!count) continue
      const label = slotType === 'SUPERFLEX' ? 'SF' : slotType
      const filled = slots[slotType] || []
      for (let i = 0; i < count; i++) rows.push({ slotLabel: label, player: filled[i] || null })
    }
    return rows
  }

  // Unconstrained optimum (best player per slot). If it already fits the
  // budget — or there's no budget — we're done.
  const dreamSlots = getStartingLineup({ roster: pool }, rc)
  const dreamCost = dreamSlots.reduce((s, p) => s + costOf(p), 0)

  let rows
  if (!Number.isFinite(starterBudget) || dreamCost <= starterBudget) {
    rows = rowsFromPlayers(pool)
  } else {
    // Budget-constrained: prune each position to its strongest + cheapest
    // candidates, then solve the knapsack.
    const byPosItems = {}
    for (const pos of ['QB', 'RB', 'WR', 'TE', 'K', 'DST']) {
      const players = pool.filter(p => p.position === pos)
      const byPts = [...players].sort((a, b) => (b.projectedPoints || 0) - (a.projectedPoints || 0)).slice(0, 24)
      const byCost = [...players].sort((a, b) => costOf(a) - costOf(b)).slice(0, 10)
      const seen = new Set()
      const items = []
      for (const p of [...byPts, ...byCost]) {
        if (seen.has(p.id)) continue
        seen.add(p.id)
        items.push({ ref: p, cost: costOf(p), pts: p.projectedPoints || 0 })
      }
      byPosItems[pos] = items
    }
    const chosen = optimizeAffordableLineup(byPosItems, rc, starterBudget)
    rows = chosen ? rowsFromPlayers(chosen) : rowsFromPlayers(pool)
  }

  const totalPoints = rows.reduce((s, r) => s + (r.player?.projectedPoints || 0), 0)
  const totalCost = rows.reduce((s, r) => s + (r.player ? costOf(r.player) : 0), 0)
  return {
    rows,
    meta,
    totalPoints,
    totalCost,
    budget,
    starterBudget,
    benchReserve,
    overBudget: Number.isFinite(starterBudget) && totalCost > starterBudget,
  }
}
