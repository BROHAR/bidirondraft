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

  if (humanTeam.remainingBudget > 15) {
    takeaways.push(`You left $${humanTeam.remainingBudget} unspent. In a real auction, unspent budget is wasted — push harder on late-round targets.`)
  }

  const vc = getTotalValueCapture(humanTeam)
  if (vc >= 25) {
    takeaways.push(`You captured $${vc.toFixed(0)} in net value — excellent auction discipline.`)
  } else if (vc <= -15) {
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
