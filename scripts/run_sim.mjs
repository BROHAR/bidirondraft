import { produce, enableMapSet } from 'immer'
import fs from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Stub browser globals so audioService doesn't crash on import
globalThis.window = { AudioContext: null, webkitAudioContext: null }
globalThis.document = { addEventListener: () => {} }

enableMapSet()

const playersData = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/data/players.json'), 'utf-8'))

// Minimal store mock supporting the DraftEngine API
class FakeStore {
  constructor(initialState) {
    this._state = initialState
  }
  getState() { return this._state }
  setState(updater) {
    if (typeof updater === 'function') {
      this._state = produce(this._state, updater)
    } else {
      this._state = { ...this._state, ...updater }
    }
  }
}

async function runSim() {
  const { DraftEngine } = await import(new URL('../src/services/draftEngine.js', import.meta.url))
  const numTeams = parseInt(process.argv[2]) || 12
  const config = {
    numberOfTeams: numTeams,
    budgetPerTeam: 200,
    humanTeamName: 'You',
    humanDraftPosition: 1,
    nominationTimer: 20,
    biddingTimer: 20,
    minBidIncrement: 1,
    scoringFormat: 'halfPPR',
    rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 },
    autoPilotEnabled: true,
    autoPilotStrategy: 'Balanced'
  }

  const store = new FakeStore({
    teams: [],
    availablePlayers: [],
    config: config,
    draftHistory: [],
    currentPlayer: null,
    currentBid: 0,
    currentBidder: null,
    draftState: 'NOMINATING',
    timeRemaining: 0,
    autoPilotEnabled: true,
    autoPilotStrategy: 'Balanced',
  })

  const engine = new DraftEngine(store)
  engine.initializeDraft(config, playersData, { simulate: true })

  const teams = store.getState().teams
  const sortedTeams = [...teams].sort((a, b) => a.remainingBudget - b.remainingBudget)

  console.log('\n--- 12-team simulation results ---')
  console.log('Team'.padEnd(15) + 'Strategy'.padEnd(20) + 'Picks'.padStart(7) + 'Spent'.padStart(8) + 'Left'.padStart(7) + 'Top$'.padStart(8))
  let totalRemaining = 0
  let zeroCount = 0
  let maxRemaining = 0
  for (const t of sortedTeams) {
    const remaining = t.remainingBudget
    const spent = t.budget - remaining
    totalRemaining += remaining
    if (remaining === 0) zeroCount++
    if (remaining > maxRemaining) maxRemaining = remaining
    const strat = t.draftStrategy?.name || (t.isHuman ? 'You' : 'Unknown')
    const topPrice = t.roster.length > 0
      ? Math.max(...t.roster.map(p => p.purchasePrice || 0))
      : 0
    console.log(
      t.name.padEnd(15) + strat.padEnd(20) +
      String(t.roster.length).padStart(7) +
      ('$' + spent).padStart(8) +
      ('$' + remaining).padStart(7) +
      ('$' + topPrice).padStart(8)
    )
  }
  console.log('-'.repeat(70))
  const draftHistory = store.getState().draftHistory
  const totalSold = draftHistory.length
  const totalRevenue = draftHistory.reduce((s, p) => s + (p.price || 0), 0)
  const avgSale = totalSold ? (totalRevenue / totalSold).toFixed(2) : 0
  console.log(`Auctions: ${totalSold} | Avg sale: $${avgSale} | Total revenue: $${totalRevenue}`)
  const topSales = [...draftHistory].sort((a, b) => b.price - a.price).slice(0, 5)
  console.log('Top 5 sales: ' + topSales.map(s => `${s.player.name}=$${s.price}`).join(', '))
  // Price tier breakdown
  const tiers = { '$50+': 0, '$30-49': 0, '$15-29': 0, '$5-14': 0, '$2-4': 0, '$1': 0 }
  const tierRevenue = { '$50+': 0, '$30-49': 0, '$15-29': 0, '$5-14': 0, '$2-4': 0, '$1': 0 }
  for (const h of draftHistory) {
    const p = h.price
    let tier
    if (p >= 50) tier = '$50+'
    else if (p >= 30) tier = '$30-49'
    else if (p >= 15) tier = '$15-29'
    else if (p >= 5) tier = '$5-14'
    else if (p >= 2) tier = '$2-4'
    else tier = '$1'
    tiers[tier]++
    tierRevenue[tier] += p
  }
  console.log('Sale tier distribution:')
  for (const t of Object.keys(tiers)) {
    console.log(`  ${t.padEnd(10)} ${tiers[t]} sales, $${tierRevenue[t]} revenue`)
  }
  console.log(`Total leftover: $${totalRemaining}, Avg: $${(totalRemaining / teams.length).toFixed(2)}, $0 teams: ${zeroCount}/${teams.length}, Max: $${maxRemaining}`)
  console.log(`Goal: 80% at $0 (≥${Math.ceil(0.8 * teams.length)}), max ≤ $21, typical $1-5`)
}

runSim().catch(e => { console.error(e); process.exit(1) })
