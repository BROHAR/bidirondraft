import { produce } from 'immer'
import { DraftEngine } from '../services/draftEngine.js'
import { setSeed, resetRng } from './rng.js'
import {
  calculateStarterPoints,
  getStartingLineup,
  getLineupSlots,
  getTotalValueCapture,
  getReplacementLevels,
  getTeamVORP,
  getPositionSpendingByGroup,
  rankTeamsByStarterPoints,
  buildDreamTeam,
} from './draftAnalysis.js'

// Meta Simulation core. Answers "which bidder strategy is best for MY team
// against this league?" The user's opponents (the configured AI bidder profiles)
// and the user's draft slot are held fixed; the user's seat auto-pilots each
// candidate strategy over many seeded drafts, and ONLY the user's team outcome
// is recorded, grouped by the strategy it drafted with. Pure: no React, no Web
// Worker, no Zustand — the worker and the integration test both call these
// functions directly, guaranteeing identical logic.

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']

// Candidate strategies the user's seat can try, by config key. Display names
// (used for grouping/labels) are resolved explicitly so a silent auto-pilot
// fallback can never mislabel a strategy's results.
export const STRATEGY_DISPLAY = {
  Balanced: 'Balanced',
  ValueHunter: 'Value Hunter',
  StarsAndScrubs: 'Stars and Scrubs',
  ZeroRB: 'Zero RB',
  HeroRB: 'Hero RB',
  LateRoundQB: 'Late Round QB',
  Taco: 'Taco',
}
export const DEFAULT_STRATEGY_KEYS = Object.keys(STRATEGY_DISPLAY)

// Display-name lookup for a meta run, extending the built-in names with the
// user's custom strategies (keyed `custom:<id>`) so custom candidates show their
// chosen name in the results instead of the raw key.
export function buildStrategyDisplay(config = {}) {
  const map = { ...STRATEGY_DISPLAY }
  for (const def of config.customStrategies || []) {
    if (def?.id && def?.name) map[`custom:${def.id}`] = def.name
  }
  return map
}

// Minimal store the DraftEngine drives. Mirrors the fake store the integration
// tests use (immer produce, { getState, setState }) so each draft runs in
// isolation without touching the app's Zustand store.
function createIsolatedStore() {
  let state = {
    teams: [], availablePlayers: [], config: {}, draftState: 'SETUP',
    currentNominator: null, currentPlayer: null, currentBid: 0,
    currentBidder: null, timeRemaining: 0, draftHistory: [],
  }
  return { getState: () => state, setState: (fn) => { state = produce(state, fn) } }
}

// Run one full headless draft at the given seed; return the finished teams and
// any leftover free agents. autoPilotEnabled so the user's seat drafts via
// config.autoPilotStrategy and the league completes.
export function runSingleDraft(config, playersData, seed) {
  setSeed(seed)
  const store = createIsolatedStore()
  const engine = new DraftEngine(store)
  engine.initializeDraft(
    { ...config, autoPilotEnabled: true, autoPilotStrategy: config.autoPilotStrategy || 'Balanced' },
    playersData,
    { simulate: true }
  )
  const s = store.getState()
  return { teams: s.teams, availablePlayers: s.availablePlayers }
}

// Every player in the draft universe (drafted across all teams + leftover free
// agents). Feeds getReplacementLevels so VORP replacement ranks are consistent
// regardless of who drafted whom — matching how PostDraftAnalysis computes them.
function fullPoolFor(teams, availablePlayers) {
  const pool = []
  for (const t of teams) for (const p of t.roster) pool.push(p)
  for (const p of availablePlayers || []) pool.push(p)
  return pool
}

// One row per team for a finished draft: the strategy that drafted it plus the
// metrics we aggregate. finishRank/isWinner are within this single league.
export function extractTeamRows(teams, availablePlayers, rosterPositions, numberOfTeams) {
  const { levels } = getReplacementLevels(fullPoolFor(teams, availablePlayers), rosterPositions, numberOfTeams)
  const ranked = rankTeamsByStarterPoints(teams, rosterPositions)
  const rankById = new Map(ranked.map((t, i) => [t.id, i + 1]))

  return teams.map(team => {
    const groups = getPositionSpendingByGroup(team)
    const positionSpend = {}
    for (const pos of POSITIONS) positionSpend[pos] = groups[pos]?.spend || 0

    // Per-position starter points, attributed to each player's real position
    // (a FLEX/SUPERFLEX starter's points land on RB/WR/TE/QB, not on the slot).
    const starters = getStartingLineup(team, rosterPositions)
    const positionStarterPoints = {}
    for (const pos of POSITIONS) positionStarterPoints[pos] = 0
    for (const p of starters) {
      if (positionStarterPoints[p.position] != null) positionStarterPoints[p.position] += p.projectedPoints || 0
    }

    // Full-roster count by position.
    const positionCounts = {}
    for (const pos of POSITIONS) positionCounts[pos] = 0
    for (const p of team.roster) {
      if (positionCounts[p.position] != null) positionCounts[p.position]++
    }

    const finishRank = rankById.get(team.id)
    return {
      strategyName: team.draftStrategy?.name || (team.isHuman ? 'Human' : 'AI'),
      isHuman: !!team.isHuman,
      teamId: team.id,
      starterPoints: calculateStarterPoints(team, rosterPositions),
      valueCapture: getTotalValueCapture(team),
      teamVorp: getTeamVORP(team, levels),
      finishRank,
      isWinner: finishRank === 1,
      positionSpend,
      positionStarterPoints,
      positionCounts,
    }
  })
}

// The user's (human) team row for one finished draft, tagged with the candidate
// strategy we intended its seat to use. Tagging by intent (not the instance
// name) is robust even if auto-pilot ever falls back. Returns null if there is
// no human seat (an all-AI config can't be rated from the user's perspective).
export function extractUserRow(teams, availablePlayers, rosterPositions, numberOfTeams, strategyKey, displayMap = STRATEGY_DISPLAY) {
  const rows = extractTeamRows(teams, availablePlayers, rosterPositions, numberOfTeams)
  const userRow = rows.find(r => r.isHuman)
  if (!userRow) return null
  userRow.strategyName = displayMap[strategyKey] || strategyKey
  return userRow
}

// ---- Numeric helpers (exported for unit tests) -------------------------

export function mean(xs) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0
}

export function median(xs) {
  if (!xs.length) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Population standard deviation. 0 for empty or single-sample inputs.
export function stdev(xs) {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)))
}

// Group TeamRow[] by strategy name into per-strategy summaries. positionSpendPct
// (a position's mean $ over the strategy's total mean $) is the headline "why"
// signal — it surfaces each strategy's positional tendencies.
export function aggregateRows(rows) {
  const byStrategy = new Map()
  for (const row of rows) {
    if (!byStrategy.has(row.strategyName)) byStrategy.set(row.strategyName, [])
    byStrategy.get(row.strategyName).push(row)
  }

  const summaries = []
  for (const [strategyName, group] of byStrategy) {
    const starterPts = group.map(r => r.starterPoints)
    const positionSpend = {}
    for (const pos of POSITIONS) positionSpend[pos] = mean(group.map(r => r.positionSpend[pos] || 0))
    const totalSpend = POSITIONS.reduce((s, pos) => s + positionSpend[pos], 0)
    const positionSpendPct = {}
    for (const pos of POSITIONS) positionSpendPct[pos] = totalSpend > 0 ? positionSpend[pos] / totalSpend : 0

    summaries.push({
      strategyName,
      samples: group.length,
      starterPoints: { mean: mean(starterPts), median: median(starterPts), stdev: stdev(starterPts) },
      valueCapture: { mean: mean(group.map(r => r.valueCapture)) },
      teamVorp: { mean: mean(group.map(r => r.teamVorp)) },
      finishRank: { mean: mean(group.map(r => r.finishRank)) },
      winRate: mean(group.map(r => (r.isWinner ? 1 : 0))),
      positionSpend,
      positionSpendPct,
    })
  }
  return summaries
}

// Field-wide reference points (simple mean across strategy summaries) used to
// frame each strategy relative to the pack in generateMetaTakeaways.
export function computeFieldAverages(summaries) {
  const positionSpendPct = {}
  for (const pos of POSITIONS) positionSpendPct[pos] = mean(summaries.map(s => s.positionSpendPct[pos] || 0))
  return {
    starterPoints: mean(summaries.map(s => s.starterPoints.mean)),
    valueCapture: mean(summaries.map(s => s.valueCapture.mean)),
    finishRank: mean(summaries.map(s => s.finishRank.mean)),
    positionSpendPct,
  }
}

// Field-wide winning-roster composition. Aggregates every team that finished #1
// across all simulated drafts (winners) into an "average winning roster":
// mean budget allocation and roster counts by position. winRateByStrategy is
// computed over ALL team rows (AI + human seats), so it reflects how often each
// strategy produced the league winner against the configured opponents.
export function aggregateWinningComposition(allTeamRows) {
  const winners = allTeamRows.filter(r => r.isWinner)

  const positionSpend = {}
  for (const pos of POSITIONS) positionSpend[pos] = mean(winners.map(r => r.positionSpend[pos] || 0))
  const totalSpend = POSITIONS.reduce((s, pos) => s + positionSpend[pos], 0)
  const positionSpendPct = {}
  for (const pos of POSITIONS) positionSpendPct[pos] = totalSpend > 0 ? positionSpend[pos] / totalSpend : 0

  const positionCounts = {}
  for (const pos of POSITIONS) positionCounts[pos] = mean(winners.map(r => r.positionCounts[pos] || 0))

  const positionStarterPoints = {}
  for (const pos of POSITIONS) positionStarterPoints[pos] = mean(winners.map(r => r.positionStarterPoints[pos] || 0))

  const byStrategy = new Map()
  for (const r of allTeamRows) {
    if (!byStrategy.has(r.strategyName)) byStrategy.set(r.strategyName, { games: 0, wins: 0 })
    const g = byStrategy.get(r.strategyName)
    g.games++
    if (r.isWinner) g.wins++
  }
  const winRateByStrategy = [...byStrategy.entries()]
    .map(([strategyName, g]) => ({ strategyName, games: g.games, wins: g.wins, winRate: g.games ? g.wins / g.games : 0 }))
    .sort((a, b) => b.winRate - a.winRate)

  return { samples: winners.length, positionSpend, positionSpendPct, positionCounts, positionStarterPoints, winRateByStrategy }
}

// Slot display order for a blueprint's optimal starting lineup.
const BLUEPRINT_SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DST']

// A concrete example roster for the "blueprints" view: the optimal starting
// lineup (by slot) of a team that finished #1, with each starter's price and
// projected points, plus the roster-wide spend and bench depth. Captured only
// for the winner of each draft so we can show real winning builds.
export function buildWinnerBlueprint(team, rosterPositions, strategyName, seed, starterPoints) {
  const { slots, bench } = getLineupSlots(team, rosterPositions)
  const starters = []
  for (const slot of BLUEPRINT_SLOT_ORDER) {
    for (const p of slots[slot] || []) {
      starters.push({
        slot,
        name: p.name,
        position: p.position,
        team: p.team,
        price: p.purchasePrice ?? 0,
        points: p.projectedPoints || 0,
      })
    }
  }
  const totalSpent = (team.roster || []).reduce((s, p) => s + (p.purchasePrice ?? 0), 0)
  return { strategyName, seed, starterPoints, totalSpent, benchCount: bench?.length || 0, starters }
}

// Find the draft winner among already-extracted rows, tag the blueprint with the
// winner's natural strategy name (matching winRateByStrategy), and append it.
// No-op if there's no winner (e.g. an empty draft).
function collectBlueprint(acc, rows, teams, rosterPositions, seed) {
  const winRow = rows.find(r => r.isWinner)
  if (!winRow) return
  const winTeam = teams.find(t => t.id === winRow.teamId)
  if (!winTeam) return
  acc.push(buildWinnerBlueprint(winTeam, rosterPositions, winRow.strategyName, seed, winRow.starterPoints))
}

// Pick the "winning strategy" (the field's most successful, from winRateByStrategy)
// and return its highest-scoring winning builds — up to `limit`, de-duplicated by
// their starter set so the user sees genuinely different combinations, not the
// same roster repeated across seeds. Returns { strategyName, winRate, teams }.
export function selectBlueprints(allBlueprints, winRateByStrategy, limit = 5) {
  if (!winRateByStrategy.length || !allBlueprints.length) {
    return { strategyName: null, winRate: 0, teams: [] }
  }
  const top = winRateByStrategy[0]
  const forStrat = allBlueprints
    .filter(b => b.strategyName === top.strategyName)
    .sort((a, b) => b.starterPoints - a.starterPoints)

  const teams = []
  const seen = new Set()
  for (const b of forStrat) {
    const sig = b.starters.map(s => s.name).sort().join('|')
    if (seen.has(sig)) continue
    seen.add(sig)
    teams.push(b)
    if (teams.length >= limit) break
  }
  return { strategyName: top.strategyName, winRate: top.winRate, teams }
}

// How many of a strategy's most-frequently-rostered players (per position) form
// its "typical acquisitions" pool. Enough to fill every slot and give the budget
// optimizer real choices, while excluding one-off fluke buys that would poison
// the average price. Keyed off roster frequency across the whole simulation.
const DREAM_POOL_PER_POSITION = 15

// Accumulate, per strategy (natural name, matching winRateByStrategy), how often
// it rosters each player and the total price it paid — the raw material for a
// per-strategy dream team. Mutates `pools` in place.
function accumulateStrategyPool(pools, teams) {
  for (const t of teams) {
    const name = t.draftStrategy?.name || (t.isHuman ? 'Human' : 'AI')
    let pool = pools.get(name)
    if (!pool) { pool = new Map(); pools.set(name, pool) }
    for (const p of t.roster || []) {
      let e = pool.get(p.id)
      if (!e) {
        e = { id: p.id, name: p.name, position: p.position, team: p.team, projectedPoints: p.projectedPoints || 0, count: 0, priceSum: 0 }
        pool.set(p.id, e)
      }
      e.count++
      e.priceSum += p.purchasePrice ?? 0
    }
  }
}

// Build a budget-constrained "dream team" for each of the top `limit` strategies
// (ranked by field win rate). Each strategy's team is the best affordable lineup
// drawn from the players it typically rosters, priced at what it typically pays —
// so the philosophy shows through (e.g. a stars-and-scrubs build can't also
// afford elite depth). Reuses the same optimizer as the post-draft Dream Team.
export function buildStrategyDreamTeams(strategyPools, winRateByStrategy, rosterPositions, budgetPerTeam, limit = 5) {
  const out = []
  for (const { strategyName, winRate } of winRateByStrategy.slice(0, limit)) {
    const pool = strategyPools.get(strategyName)
    if (!pool) continue

    // Keep each position's most-frequently-rostered players; price = average paid.
    const byPos = {}
    for (const e of pool.values()) (byPos[e.position] ||= []).push(e)
    const roster = []
    for (const pos of Object.keys(byPos)) {
      byPos[pos].sort((a, b) => (b.count - a.count) || (b.projectedPoints - a.projectedPoints))
      for (const e of byPos[pos].slice(0, DREAM_POOL_PER_POSITION)) {
        roster.push({
          id: e.id, name: e.name, position: e.position, team: e.team,
          projectedPoints: e.projectedPoints,
          purchasePrice: Math.max(1, Math.round(e.priceSum / e.count)),
        })
      }
    }

    const dream = buildDreamTeam([{ name: strategyName, roster }], [], rosterPositions, budgetPerTeam)
    const rows = dream.rows.map(r => ({
      slotLabel: r.slotLabel,
      name: r.player?.name || null,
      position: r.player?.position || null,
      team: r.player?.team || null,
      price: r.player ? Math.max(1, Math.round(r.player.purchasePrice || 0)) : 0,
      points: r.player?.projectedPoints || 0,
    }))
    out.push({ strategyName, winRate, totalPoints: dream.totalPoints, totalCost: dream.totalCost, rows })
  }
  return out
}

const POS_LABEL = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'kicker', DST: 'defense' }

// 2-4 plain-English sentences on how this strategy fared for the user's team and
// why, framed against the user's results with the other strategies. Analogous to
// generateValueCostTakeaways in draftAnalysis.js.
export function generateMetaTakeaways(summary, fieldAverages) {
  const out = []
  const ptsDelta = summary.starterPoints.mean - (fieldAverages?.starterPoints || 0)
  if (summary.rank === 1) {
    out.push(`Your best play: ${summary.starterPoints.mean.toFixed(0)} avg starter pts — ${ptsDelta >= 0 ? '+' : ''}${ptsDelta.toFixed(0)} vs your average across strategies.`)
  } else {
    out.push(`Averaged ${summary.starterPoints.mean.toFixed(0)} starter pts (${ptsDelta >= 0 ? '+' : ''}${ptsDelta.toFixed(0)} vs your strategy average), ranking #${summary.rank} of the strategies tried.`)
  }

  out.push(`You finished #1 in your league ${(summary.winRate * 100).toFixed(0)}% of drafts, with an average finish of ${summary.finishRank.mean.toFixed(1)}.`)

  // Most distinctive positional tendency vs your other strategies.
  if (fieldAverages?.positionSpendPct) {
    let topPos = null, topDelta = 0
    for (const pos of POSITIONS) {
      const d = (summary.positionSpendPct[pos] || 0) - (fieldAverages.positionSpendPct[pos] || 0)
      if (Math.abs(d) > Math.abs(topDelta)) { topDelta = d; topPos = pos }
    }
    if (topPos && Math.abs(topDelta) >= 0.03) {
      const lean = topDelta > 0 ? 'leans into' : 'pulls back from'
      out.push(`Puts ${(summary.positionSpendPct[topPos] * 100).toFixed(0)}% of your budget into ${POS_LABEL[topPos]} — ${lean} the position vs your other strategies (${(fieldAverages.positionSpendPct[topPos] * 100).toFixed(0)}%).`)
    }
  }

  const vc = summary.valueCapture.mean
  if (Math.abs(vc) >= 5) {
    out.push(vc > 0
      ? `Captured $${vc.toFixed(0)} of net value per draft on average — disciplined bidding.`
      : `Overpaid by $${Math.abs(vc).toFixed(0)} per draft on average relative to projected value.`)
  }

  return out.slice(0, 4)
}

// Sort/rank the aggregated user rows into the final result payload. userRows
// (the user's seat, tagged by intended candidate strategy) drive the headline
// scorecard, ranked by average starting-lineup points. allTeamRows (every seat
// across every draft) feed the field-wide winning-composition aggregate, and
// allBlueprints (one full roster per draft winner) feed the example builds for
// the winning strategy; the raw rows/blueprints are consumed here and only the
// aggregates + a handful of selected builds ship.
function finalizeResult(userRows, allTeamRows, allBlueprints, strategyPools, meta) {
  const summaries = aggregateRows(userRows).sort((a, b) => b.starterPoints.mean - a.starterPoints.mean)
  summaries.forEach((s, i) => { s.rank = i + 1 })
  const fieldAverages = computeFieldAverages(summaries)
  const winningComposition = aggregateWinningComposition(allTeamRows)
  return {
    ...meta,
    summaries,
    fieldAverages,
    winningComposition,
    blueprints: selectBlueprints(allBlueprints, winningComposition.winRateByStrategy),
    dreamTeams: buildStrategyDreamTeams(strategyPools, winningComposition.winRateByStrategy, meta.rosterPositions, meta.budgetPerTeam),
    ranking: summaries.map(s => s.strategyName),
    generatedAt: new Date().toISOString(),
  }
}

// The (strategy, seed) plan: each candidate strategy is tried over the same set
// of seeds, so strategies face identically-seeded leagues (paired sampling).
function buildPlan(strategies, draftsPerStrategy, baseSeed) {
  const plan = []
  for (const strat of strategies) {
    for (let i = 0; i < draftsPerStrategy; i++) plan.push({ strat, seed: baseSeed + i })
  }
  return plan
}

// Rate each candidate strategy from the USER's perspective: the user's seat
// (config.humanDraftPosition) auto-pilots `strat` against the fixed configured
// league, and only the user's team result is recorded. onProgress(done, total)
// is the seam the worker uses to post progress. resetRng in finally so a seeded
// generator never leaks into the rest of the app/tests.
export function runMetaSimulation(config, playersData, { strategies = DEFAULT_STRATEGY_KEYS, draftsPerStrategy = 50, baseSeed = 1, onProgress } = {}) {
  const { rosterPositions, numberOfTeams, budgetPerTeam } = config
  const displayMap = buildStrategyDisplay(config)
  const plan = buildPlan(strategies, draftsPerStrategy, baseSeed)
  const userRows = []
  const allTeamRows = []
  const allBlueprints = []
  const strategyPools = new Map()
  try {
    plan.forEach(({ strat, seed }, i) => {
      const { teams, availablePlayers } = runSingleDraft({ ...config, autoPilotStrategy: strat }, playersData, seed)
      const rows = extractTeamRows(teams, availablePlayers, rosterPositions, numberOfTeams)
      for (const r of rows) allTeamRows.push(r)
      // Shallow copy so retagging the user's seat by intended candidate strategy
      // doesn't relabel its entry inside allTeamRows (which the field-wide win
      // rate reads under the seat's natural strategy name).
      const userRow = rows.find(r => r.isHuman)
      if (userRow) userRows.push({ ...userRow, strategyName: displayMap[strat] || strat })
      collectBlueprint(allBlueprints, rows, teams, rosterPositions, seed)
      accumulateStrategyPool(strategyPools, teams)
      onProgress?.(i + 1, plan.length)
    })
  } finally {
    resetRng()
  }
  return finalizeResult(userRows, allTeamRows, allBlueprints, strategyPools, { strategies, draftsPerStrategy, totalDrafts: plan.length, baseSeed, rosterPositions, numberOfTeams, budgetPerTeam })
}

// Async, cooperatively-yielding variant for the main thread: runs drafts in
// small batches and awaits a macrotask between batches so React can paint the
// progress bar and the tab stays responsive. shouldCancel() lets the caller
// stop early. Used as the fallback when a Web Worker is unavailable or errors
// (e.g. the Vite dev server injects its HMR client into module workers, which
// crashes them — production worker chunks are fine).
export async function runMetaSimulationAsync(config, playersData, { strategies = DEFAULT_STRATEGY_KEYS, draftsPerStrategy = 50, baseSeed = 1, onProgress, shouldCancel, batchSize = 4 } = {}) {
  const { rosterPositions, numberOfTeams, budgetPerTeam } = config
  const displayMap = buildStrategyDisplay(config)
  const plan = buildPlan(strategies, draftsPerStrategy, baseSeed)
  const userRows = []
  const allTeamRows = []
  const allBlueprints = []
  const strategyPools = new Map()
  try {
    for (let i = 0; i < plan.length; i++) {
      if (shouldCancel?.()) break
      const { strat, seed } = plan[i]
      const { teams, availablePlayers } = runSingleDraft({ ...config, autoPilotStrategy: strat }, playersData, seed)
      const rows = extractTeamRows(teams, availablePlayers, rosterPositions, numberOfTeams)
      for (const r of rows) allTeamRows.push(r)
      const userRow = rows.find(r => r.isHuman)
      if (userRow) userRows.push({ ...userRow, strategyName: displayMap[strat] || strat })
      collectBlueprint(allBlueprints, rows, teams, rosterPositions, seed)
      accumulateStrategyPool(strategyPools, teams)
      onProgress?.(i + 1, plan.length)
      if ((i + 1) % batchSize === 0) await new Promise(r => setTimeout(r, 0))
    }
  } finally {
    resetRng()
  }
  return finalizeResult(userRows, allTeamRows, allBlueprints, strategyPools, { strategies, draftsPerStrategy, totalDrafts: plan.length, baseSeed, rosterPositions, numberOfTeams, budgetPerTeam })
}
