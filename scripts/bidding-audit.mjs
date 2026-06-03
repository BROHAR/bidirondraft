// Bidding-audit harness: runs many headless AI-only drafts and reports the
// price-vs-value distribution so we can see whether AI bidders overspend on
// early/expensive players and dump mid-tier players for $1.
//
// Usage:
//   npm run audit-bidding            # 200 drafts (default)
//   NUM_DRAFTS=50 npm run audit-bidding
//
// Run via Vitest (not plain Node): the draft module graph uses Vite-only
// imports (JSON modules + `?worker`), which only resolve under Vite/Vitest.
// The `.mjs` (non-`*.test.*`) name keeps it out of the default `test:run`
// suite; the npm script includes it explicitly with `--include`.
//
// Reuses the real DraftEngine simulate path — no bespoke draft loop. Mirrors
// tests/integration/DraftCompleteness.test.js (createStore + initializeDraft
// with { simulate: true }).

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { test, vi } from 'vitest'
import { produce } from 'immer'
import { DraftEngine } from '../src/services/draftEngine.js'
import playersData from '../src/data/players.json'

const REPORT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'bidding-audit.out.txt')

// Audio is a no-op side effect under Node; stub it like the integration test.
vi.mock('../src/services/audioService.js', () => ({
  audioService: {
    playTimerWarning: vi.fn(), playTimerUrgent: vi.fn(),
    playTadaSound: vi.fn(), playChaChingSound: vi.fn()
  }
}))

const NUM_DRAFTS = parseInt(process.env.NUM_DRAFTS, 10) || 200
// League shape is env-configurable so we can reproduce any league setup:
//   NUM_TEAMS=10 FLEX=2 npm run audit-bidding
const NUM_TEAMS = parseInt(process.env.NUM_TEAMS, 10) || 12
const FLEX = process.env.FLEX != null ? parseInt(process.env.FLEX, 10) : 1
const BENCH = process.env.BENCH != null ? parseInt(process.env.BENCH, 10) : 6

function baseConfig(overrides = {}) {
  return {
    numberOfTeams: NUM_TEAMS,
    budgetPerTeam: 200,
    humanTeamName: 'My Team',
    humanDraftPosition: 0, // 0 → no human; every team is AI-driven
    minBidIncrement: 1,
    nominationTimer: 20,
    biddingTimer: 20,
    autoPilotEnabled: false,
    scoringFormat: 'halfPPR',
    rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: FLEX, K: 1, DST: 1, BENCH: BENCH },
    ...overrides
  }
}

function createStore() {
  let state = {
    teams: [], availablePlayers: [], config: {}, draftState: 'SETUP',
    currentNominator: null, currentPlayer: null, currentBid: 0,
    currentBidder: null, timeRemaining: 0, draftHistory: []
  }
  return { getState: () => state, setState: (fn) => { state = produce(state, fn) } }
}

function runDraft(config) {
  const store = createStore()
  const engine = new DraftEngine(store)
  engine.initializeDraft(config, playersData, { simulate: true })
  return store.getState()
}

// --- buckets --------------------------------------------------------------

function valueTier(v) {
  if (v >= 50) return 'elite (>=50)'
  if (v >= 30) return 'high (30-49)'
  if (v >= 15) return 'mid (15-29)'
  if (v >= 5) return 'low-mid (5-14)'
  return 'low (<5)'
}
const TIER_ORDER = ['elite (>=50)', 'high (30-49)', 'mid (15-29)', 'low-mid (5-14)', 'low (<5)']

function phaseOf(idx, total) {
  const f = idx / Math.max(1, total)
  if (f < 1 / 3) return 'early'
  if (f < 2 / 3) return 'mid'
  return 'late'
}
const PHASE_ORDER = ['early', 'mid', 'late']

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
function median(a) {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const f2 = (x) => x.toFixed(2)
const pad = (s, n) => String(s).padEnd(n)
const padL = (s, n) => String(s).padStart(n)

// --- run ------------------------------------------------------------------

test('bidding-audit report', () => {
  const lines = []
  const log = (s = '') => lines.push(s)

  log(`Running ${NUM_DRAFTS} simulated 12-team drafts...\n`)

  const ratiosByTier = Object.fromEntries(TIER_ORDER.map(t => [t, []]))
  const ratiosByPhase = Object.fromEntries(PHASE_ORDER.map(p => [p, []]))
  const crossTab = {} // `${phase}|${tier}` -> ratios[]
  let bargains = 0       // value >= 10 won at <= 0.4x value
  let overpays = 0       // price >= 1.3x value
  let qualityPurchases = 0 // value >= 10, denominator for bargain rate
  let midTierCheap = 0   // value 15-29 sold at <= $2 (the user's named complaint)
  let midTierTotal = 0   // value 15-29, denominator
  const steepExamples = [] // {name, value, price, ratio} for value>=15 sold <=0.25x
  let noBidSteep = 0 // of the steep discounts, how many were $1 no-bid wins
  // strategy -> { count, spend, byPos: { POS: spend } }
  const byStrategy = {}

  let bookSum = 0   // sum of estimatedValue across all drafted players
  let spendSum = 0  // sum of prices paid
  let budgetSum = 0 // sum of total auction budgets

  for (let d = 0; d < NUM_DRAFTS; d++) {
    const state = runDraft(baseConfig())
    const history = state.draftHistory
    const total = history.length
    budgetSum += state.teams.length * 200
    for (const e of history) { bookSum += e.player.estimatedValue; spendSum += e.price }

    history.forEach((entry, idx) => {
      const v = entry.player.estimatedValue
      const price = entry.price
      if (!v || v <= 0) return
      const ratio = price / v
      const tier = valueTier(v)
      const phase = phaseOf(idx, total)

      ratiosByTier[tier].push(ratio)
      ratiosByPhase[phase].push(ratio)
      const key = `${phase}|${tier}`
      ;(crossTab[key] ||= []).push(ratio)

      if (v >= 10) {
        qualityPurchases++
        if (ratio <= 0.4) bargains++
      }
      if (v >= 15 && v < 30) {
        midTierTotal++
        if (price <= 2) midTierCheap++
      }
      if (v >= 15 && ratio <= 0.25) {
        steepExamples.push({ name: entry.player.name, value: v, price, ratio })
        // No-bid win: nobody outbid the nominator (won at <=$1 by themselves).
        if (entry.team === entry.nominator && price <= 1) noBidSteep++
      }
      if (ratio >= 1.3) overpays++
    })

    // per-strategy position spend
    for (const team of state.teams) {
      const strat = team.draftStrategy?.constructor?.name || 'Unknown'
      const s = (byStrategy[strat] ||= { count: 0, spend: 0, byPos: {} })
      s.count++
      for (const p of team.roster) {
        const price = p.purchasePrice || 0
        s.spend += price
        s.byPos[p.position] = (s.byPos[p.position] || 0) + price
      }
    }
  }

  // --- report -------------------------------------------------------------

  log('=== Price / Value ratio by VALUE TIER ===')
  log(`${pad('tier', 16)} ${padL('n', 7)} ${padL('mean', 7)} ${padL('median', 7)}`)
  for (const t of TIER_ORDER) {
    const r = ratiosByTier[t]
    log(`${pad(t, 16)} ${padL(r.length, 7)} ${padL(f2(mean(r)), 7)} ${padL(f2(median(r)), 7)}`)
  }

  log('\n=== Price / Value ratio by DRAFT PHASE ===')
  log(`${pad('phase', 16)} ${padL('n', 7)} ${padL('mean', 7)} ${padL('median', 7)}`)
  for (const p of PHASE_ORDER) {
    const r = ratiosByPhase[p]
    log(`${pad(p, 16)} ${padL(r.length, 7)} ${padL(f2(mean(r)), 7)} ${padL(f2(median(r)), 7)}`)
  }

  log('\n=== Mean ratio: PHASE x TIER (n in parens) ===')
  log(`${pad('phase', 10)}${TIER_ORDER.map(t => padL(t.split(' ')[0], 14)).join('')}`)
  for (const p of PHASE_ORDER) {
    let row = pad(p, 10)
    for (const t of TIER_ORDER) {
      const r = crossTab[`${p}|${t}`] || []
      row += padL(r.length ? `${f2(mean(r))}(${r.length})` : '-', 14)
    }
    log(row)
  }

  log('\n=== Budget vs book balance ===')
  log(`Sum of drafted players' estimatedValue: $${(bookSum / NUM_DRAFTS).toFixed(0)}/draft`)
  log(`Total auction budget: $${(budgetSum / NUM_DRAFTS).toFixed(0)}/draft`)
  log(`Book/budget ratio: ${(bookSum / budgetSum).toFixed(3)} (if >1, estimates exceed money → forced average discount)`)
  log(`Actual spend/book ratio: ${(spendSum / bookSum).toFixed(3)}`)

  log('\n=== Headline counts (across all drafts) ===')
  log(`Quality players (value>=10) won at <=0.4x value (bargains): ${bargains} / ${qualityPurchases} (${(100 * bargains / Math.max(1, qualityPurchases)).toFixed(1)}%)`)
  log(`Purchases at >=1.3x value (overpays): ${overpays}`)
  log(`Avg bargains per draft: ${(bargains / NUM_DRAFTS).toFixed(1)}`)
  log(`Mid-tier ($15-29) sold for <=$2: ${midTierCheap} / ${midTierTotal} (${(100 * midTierCheap / Math.max(1, midTierTotal)).toFixed(1)}%), ${(midTierCheap / NUM_DRAFTS).toFixed(1)}/draft`)
  log(`Steep discounts (value>=15 sold at <=0.25x): ${steepExamples.length} total, ${(steepExamples.length / NUM_DRAFTS).toFixed(1)}/draft`)
  log(`  of which $1 no-bid wins (nominator unopposed): ${noBidSteep} (${(100 * noBidSteep / Math.max(1, steepExamples.length)).toFixed(0)}%)`)

  log('\n=== Sample steepest discounts (value>=15, <=0.25x book) ===')
  const worst = [...steepExamples].sort((a, b) => a.ratio - b.ratio).slice(0, 15)
  for (const e of worst) {
    log(`${pad(e.name, 22)} value $${padL(f2(e.value), 6)}  price $${padL(e.price, 3)}  (${(e.ratio * 100).toFixed(0)}%)`)
  }

  log('\n=== Per-strategy avg spend by position (confirms profiles still diverge) ===')
  const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']
  log(`${pad('strategy', 18)}${POS.map(p => padL(p, 7)).join('')}${padL('total', 9)}`)
  for (const [strat, s] of Object.entries(byStrategy).sort()) {
    const row = pad(strat, 18) +
      POS.map(p => padL(f2((s.byPos[p] || 0) / s.count), 7)).join('') +
      padL(f2(s.spend / s.count), 9)
    log(row)
  }

  // Vitest swallows console.log in run mode, so write the report to a file
  // (the npm script cats it afterward).
  const report = lines.join('\n') + '\n'
  writeFileSync(REPORT_PATH, report)
  // eslint-disable-next-line no-console
  console.log('\n' + report)
}, 600000)
