// Taco-audit harness: runs many headless drafts with a few Taco bidders mixed
// into a normal field and reports two things the Taco profile is meant to do
// but reportedly doesn't:
//   1. Win players from its "home team" (homer behavior).
//   2. Spend its budget (homers shouldn't end flush while the field is broke).
//
// Usage:
//   npm run audit-taco                 # default drafts per league size
//   NUM_DRAFTS=150 npm run audit-taco
//
// Run via Vitest (Vite-only imports in the draft graph). Mirrors
// scripts/bidding-audit.mjs.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { test, vi } from 'vitest'
import { produce } from 'immer'
import { DraftEngine } from '../src/services/draftEngine.js'
import playersData from '../src/data/players.json'

const REPORT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'taco-audit.out.txt')

vi.mock('../src/services/audioService.js', () => ({
  audioService: {
    playTimerWarning: vi.fn(), playTimerUrgent: vi.fn(),
    playTadaSound: vi.fn(), playChaChingSound: vi.fn()
  }
}))

const NUM_DRAFTS = parseInt(process.env.NUM_DRAFTS, 10) || 120
const TEAM_SIZES = [10, 11, 12]
const TACO_SLOTS = 3 // how many of the AI teams to pin to Taco per draft
const BUDGET = 200
const ROSTER = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 }
const ROSTERABLE = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DST'])

const POOL = Array.isArray(playersData) ? playersData : playersData.players
// team code -> count of rosterable players, and count worth >= $5 (raw book).
const homeAvail = new Map()
const homeAvailValuable = new Map()
for (const p of POOL) {
  if (!p.team || p.team === 'FA' || !ROSTERABLE.has(p.position)) continue
  homeAvail.set(p.team, (homeAvail.get(p.team) || 0) + 1)
  if ((p.estimatedValue || 0) >= 5) {
    homeAvailValuable.set(p.team, (homeAvailValuable.get(p.team) || 0) + 1)
  }
}

function baseConfig(numTeams) {
  // Pin the first TACO_SLOTS AI teams to Taco; rest Mixed. humanDraftPosition=0
  // → every team is AI-driven.
  const aiTeamStrategies = new Array(numTeams).fill('Mixed')
  for (let i = 0; i < TACO_SLOTS && i < numTeams; i++) aiTeamStrategies[i] = 'Taco'
  return {
    numberOfTeams: numTeams,
    budgetPerTeam: BUDGET,
    humanTeamName: 'My Team',
    humanDraftPosition: 0,
    minBidIncrement: 1,
    nominationTimer: 20,
    biddingTimer: 20,
    autoPilotEnabled: false,
    scoringFormat: 'halfPPR',
    rosterPositions: ROSTER,
    aiTeamStrategies
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

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
const f1 = (x) => x.toFixed(1)
const f2 = (x) => x.toFixed(2)
const pad = (s, n) => String(s).padEnd(n)
const padL = (s, n) => String(s).padStart(n)

test('taco-audit report', () => {
  const lines = []
  const log = (s = '') => lines.push(s)
  log(`Taco audit — ${NUM_DRAFTS} drafts per league size, ${TACO_SLOTS} Taco bidders/draft\n`)

  for (const numTeams of TEAM_SIZES) {
    const taco = { homeWon: [], homeAvail: [], homeAvailVal: [], leftover: [], spend: [], zeroHome: 0, n: 0 }
    const field = { leftover: [], spend: [], n: 0 } // non-Taco AI teams
    // Where do Taco's home wins land by value tier?
    const homeWonByTier = { 'elite>=50': 0, 'high30-49': 0, 'mid15-29': 0, 'low5-14': 0, '<5': 0 }
    const homeLostByTier = { 'elite>=50': 0, 'high30-49': 0, 'mid15-29': 0, 'low5-14': 0, '<5': 0 }

    for (let d = 0; d < NUM_DRAFTS; d++) {
      const state = runDraft(baseConfig(numTeams))
      // Build a per-draft index of who won each player (by player id).
      const wonByTeamName = new Map() // playerId -> winning team name
      for (const e of state.draftHistory) wonByTeamName.set(e.player.id, e.team)

      for (const team of state.teams) {
        const strat = team.draftStrategy?.constructor?.name
        const spend = team.roster.reduce((s, p) => s + (p.purchasePrice || 0), 0)
        if (strat === 'Taco') {
          const home = team.draftStrategy.preferences.homeTeam
          const homeWon = team.roster.filter(p => p.team === home).length
          taco.homeWon.push(homeWon)
          taco.homeAvail.push(homeAvail.get(home) || 0)
          taco.homeAvailVal.push(homeAvailValuable.get(home) || 0)
          taco.leftover.push(team.remainingBudget)
          taco.spend.push(spend)
          taco.n++
          if (homeWon === 0) taco.zeroHome++
          for (const p of team.roster) {
            if (p.team !== home) continue
            const v = p.estimatedValue
            const tier = v >= 50 ? 'elite>=50' : v >= 30 ? 'high30-49' : v >= 15 ? 'mid15-29' : v >= 5 ? 'low5-14' : '<5'
            homeWonByTier[tier]++
          }
        } else {
          field.leftover.push(team.remainingBudget)
          field.spend.push(spend)
          field.n++
        }
      }
    }

    log(`========== ${numTeams}-TEAM LEAGUE (budget $${BUDGET}, ${Object.values(ROSTER).reduce((s,c)=>s+c,0)} roster spots) ==========`)
    log(`Taco bidders sampled: ${taco.n}, field (non-Taco) teams: ${field.n}`)
    log('')
    log('--- Home-team capture ---')
    log(`  Home players WON / Taco team:        ${f2(mean(taco.homeWon))}`)
    log(`  Home players available (rosterable): ${f2(mean(taco.homeAvail))}  (>=\$5 book: ${f2(mean(taco.homeAvailVal))})`)
    log(`  Drafts where Taco won 0 home players: ${taco.zeroHome}/${taco.n} (${(100*taco.zeroHome/Math.max(1,taco.n)).toFixed(0)}%)`)
    log(`  Home wins by value tier (count):     ${Object.entries(homeWonByTier).map(([k,v])=>`${k}:${v}`).join('  ')}`)
    log('')
    log('--- Budget left on the table ---')
    log(`  Taco  leftover budget: $${f1(mean(taco.leftover))}   (spend $${f1(mean(taco.spend))})`)
    log(`  Field leftover budget: $${f1(mean(field.leftover))}   (spend $${f1(mean(field.spend))})`)
    log(`  Taco overspend vs field: $${f1(mean(taco.spend) - mean(field.spend))}`)
    log('')
  }

  const report = lines.join('\n') + '\n'
  writeFileSync(REPORT_PATH, report)
  // eslint-disable-next-line no-console
  console.log('\n' + report)
}, 600000)
