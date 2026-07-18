import { describe, it, expect } from 'vitest'
import {
  fitLeagueProfile,
  buildLeagueProfileDeltas,
  applyLeagueProfileAdjustment,
  classifyTeams,
} from '../../../src/utils/leagueProfile.js'

// --- Synthetic pool/record helpers -----------------------------------------

let nextId = 0
function poolPlayer(position, estimatedValue) {
  return { id: `pool_${nextId++}`, position, estimatedValue }
}

function rec(position, price, { pick = null, nflTeam = 'KC', fantasyTeam = 'T1', name } = {}) {
  return { pick, name: name || `${position}${price}`, nflTeam, position, price, fantasyTeam, line: 0 }
}

// A pool + records where prices exactly equal book values at every rank and
// position shares match — every fitted factor must be neutral.
function neutralScenario() {
  const positions = ['QB', 'RB', 'WR', 'TE']
  const values = [40, 30, 20, 10]
  const players = []
  const records = []
  for (const pos of positions) {
    for (const v of values) {
      players.push(poolPlayer(pos, v))
      records.push(rec(pos, v))
    }
  }
  return { players, records }
}

describe('fitLeagueProfile', () => {
  it('fits neutral factors when prices mirror the book', () => {
    const { players, records } = neutralScenario()
    const profile = fitLeagueProfile(records, players, { leagueBudget: 200 })
    expect(profile.positionFactors).toEqual({ QB: 1.0, RB: 1.0, WR: 1.0, TE: 1.0, K: 1.0, DST: 1.0 })
    for (const pos of Object.keys(profile.tierFactors)) {
      for (const t of profile.tierFactors[pos]) expect(t.factor).toBe(1.0)
    }
    expect(profile.lateInflation).toBe(1.0)
    expect(profile.parsedCount).toBe(16)
  })

  it('fits shrunk position factors from spend-share deviation', () => {
    const positions = ['QB', 'RB', 'WR', 'TE']
    const values = [40, 30, 20, 10]
    const players = []
    const records = []
    for (const pos of positions) {
      for (const v of values) {
        players.push(poolPlayer(pos, v))
        // The league pays double for RBs, book price for everyone else.
        records.push(rec(pos, pos === 'RB' ? v * 2 : v))
      }
    }
    const profile = fitLeagueProfile(records, players, { leagueBudget: 200 })
    // RB: observed share 200/500 = 0.4 vs book share 0.25 → f=1.6 → shrunk 1.3.
    expect(profile.positionFactors.RB).toBe(1.3)
    // Others: 100/500 = 0.2 vs 0.25 → f=0.8 → shrunk 0.9.
    expect(profile.positionFactors.QB).toBe(0.9)
    expect(profile.positionFactors.WR).toBe(0.9)
    expect(profile.positionFactors.TE).toBe(0.9)
    expect(profile.positionFactors.K).toBe(1.0)
    expect(profile.positionFactors.DST).toBe(1.0)
  })

  it('normalizes prices by the league budget before fitting', () => {
    const positions = ['QB', 'RB', 'WR', 'TE']
    const values = [40, 30, 20, 10]
    const players = []
    const records = []
    for (const pos of positions) {
      for (const v of values) {
        players.push(poolPlayer(pos, v))
        records.push(rec(pos, v / 2)) // $100-budget league: everything half price
      }
    }
    // Shares are scale-invariant, so a uniform half-price draft at budget 100
    // is exactly neutral once normalized.
    const profile = fitLeagueProfile(records, players, { leagueBudget: 100 })
    expect(profile.positionFactors).toEqual({ QB: 1.0, RB: 1.0, WR: 1.0, TE: 1.0, K: 1.0, DST: 1.0 })
    expect(profile.leagueBudget).toBe(100)
  })

  it('leaves a position neutral below the sample minimum', () => {
    const players = [poolPlayer('QB', 40), poolPlayer('WR', 30), poolPlayer('WR', 20), poolPlayer('WR', 10)]
    const records = [rec('QB', 80), rec('WR', 30), rec('WR', 20), rec('WR', 10)]
    const profile = fitLeagueProfile(records, players, { leagueBudget: 200 })
    expect(profile.positionFactors.QB).toBe(1.0) // 1 QB pick < 3 samples
  })

  it('fits a rank-matched tier factor for an overpaying elite tier', () => {
    // Single position → position factor neutral; isolates the tier math.
    const values = [60, 56, 54, 52, 30, 28, 25, 22]
    const players = values.map(v => poolPlayer('WR', v))
    const records = values.map((v, i) =>
      rec('WR', i < 4 ? Math.round(v * 1.2) : v))
    const profile = fitLeagueProfile(records, players, { leagueBudget: 200 })
    const elite = profile.tierFactors.WR.find(t => t.min === 50)
    const mid = profile.tierFactors.WR.find(t => t.min === 20)
    // Elite bucket: prices [72,67,65,62]=266 vs rank-fair [60,56,54,52]=222 → 1.198 → shrunk 1.1.
    expect(elite.factor).toBe(1.1)
    expect(mid.factor).toBe(1.0)
    expect(profile.tierFactors.WR.find(t => t.min === 0).factor).toBe(1.0)
    // Positions with no picks stay fully neutral.
    for (const t of profile.tierFactors.RB) expect(t.factor).toBe(1.0)
  })

  it('fits distinct tier curves per position (cheap elite RBs, full-price elite WRs)', () => {
    const values = [60, 55, 52, 45, 40, 38]
    const players = [
      ...values.map(v => poolPlayer('RB', v)),
      ...values.map(v => poolPlayer('WR', v)),
    ]
    const records = [
      // League pays 80% for its elite RBs but full price for elite WRs.
      ...values.map(v => rec('RB', Math.round(v * 0.8))),
      ...values.map(v => rec('WR', v)),
    ]
    const profile = fitLeagueProfile(records, players, { leagueBudget: 200 })
    const rbElite = profile.tierFactors.RB.find(t => t.min === 50).factor
    const wrElite = profile.tierFactors.WR.find(t => t.min === 50).factor
    expect(rbElite).toBeLessThan(1.0)
    expect(rbElite).toBeLessThan(wrElite)
    // No QB/TE picks → those curves stay neutral.
    for (const t of profile.tierFactors.QB) expect(t.factor).toBe(1.0)
    for (const t of profile.tierFactors.TE) expect(t.factor).toBe(1.0)
  })

  it('detects late inflation from the spend trajectory', () => {
    const bookValues = [40, 38, 36, 34, 32, 30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6]
    const players = bookValues.map(v => poolPlayer('WR', v))
    // Stars nominated first and sold cheap; endgame prices run over fair.
    const prices = [30, 29, 28, 27, 26, 25, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9]
    const records = prices.map((p, i) => rec('WR', p, { pick: i + 1 }))
    const profile = fitLeagueProfile(records, players, { leagueBudget: 200 })
    expect(profile.lateInflation).toBeGreaterThan(1.0)
    expect(profile.lateInflation).toBeLessThanOrEqual(1.5)
  })

  it('leaves lateInflation neutral without pick order', () => {
    const { players, records } = neutralScenario()
    const noPicks = records.map(r => ({ ...r, pick: null }))
    const profile = fitLeagueProfile(noPicks, players, { leagueBudget: 200 })
    expect(profile.lateInflation).toBe(1.0)
  })

  it('stamps team provenance including the user marker', () => {
    const { players, records } = neutralScenario()
    const teams = [
      { name: 'Alpha', spend: 200, picks: 8, persona: 'ZeroRB', confidence: 'high', homeTeam: null },
      { name: 'Beta', spend: 198, picks: 8, persona: 'Taco', confidence: 'medium', homeTeam: 'KC' },
    ]
    const profile = fitLeagueProfile(records, players, { leagueBudget: 200, teams, userTeamName: 'Beta' })
    expect(profile.teams[0]).toMatchObject({ name: 'Alpha', isUser: false, persona: 'ZeroRB' })
    expect(profile.teams[1]).toMatchObject({ name: 'Beta', isUser: true, homeTeam: 'KC' })
  })
})

describe('buildLeagueProfileDeltas / applyLeagueProfileAdjustment', () => {
  const tiers = topFactor => [
    { min: 50, factor: topFactor }, { min: 35, factor: topFactor }, { min: 20, factor: 1.0 },
    { min: 10, factor: 1.0 }, { min: 4, factor: 1.0 }, { min: 0, factor: 1.0 },
  ]
  const profile = {
    version: 2,
    positionFactors: { QB: 1.0, RB: 1.3, WR: 1.0, TE: 1.0, K: 1.0, DST: 1.0 },
    tierFactors: {
      QB: tiers(1.0), RB: tiers(1.1), WR: tiers(0.9), TE: tiers(1.0), K: tiers(1.0), DST: tiers(1.0),
    },
    lateInflation: 1.0,
  }

  it('composes position and per-position tier factors additively', () => {
    const rb = poolPlayer('RB', 40)  // (0.3 + 0.1) * 40 = 16
    const wr = poolPlayer('WR', 40)  // (0 + -0.1) * 40 = -4 — WR curve differs from RB's
    const cheap = poolPlayer('WR', 10) // neutral bucket, neutral position → no delta
    const deltas = buildLeagueProfileDeltas([rb, wr, cheap], profile)
    expect(deltas.get(rb.id)).toBeCloseTo(16, 5)
    expect(deltas.get(wr.id)).toBeCloseTo(-4, 5)
    expect(deltas.has(cheap.id)).toBe(false)
  })

  it('returns an empty map for null or malformed profiles', () => {
    const players = [poolPlayer('RB', 40)]
    expect(buildLeagueProfileDeltas(players, null).size).toBe(0)
    expect(buildLeagueProfileDeltas(players, {}).size).toBe(0)
  })

  it('applyLeagueProfileAdjustment is a strict no-op without config.leagueProfile', () => {
    const players = [poolPlayer('RB', 40), poolPlayer('WR', 12)]
    const before = players.map(p => p.estimatedValue)
    applyLeagueProfileAdjustment(players, {})
    applyLeagueProfileAdjustment(players, { leagueProfile: null })
    expect(players.map(p => p.estimatedValue)).toEqual(before)
  })

  it('mutates estimatedValue with a $1 floor when a profile is active', () => {
    const rb = poolPlayer('RB', 40)
    applyLeagueProfileAdjustment([rb], { leagueProfile: profile })
    expect(rb.estimatedValue).toBeCloseTo(56, 5)
  })
})

describe('classifyTeams', () => {
  // Build a 15-pick roster for one team; fill to 15 with cheap picks.
  function roster(teamName, picks, { filler = { position: 'WR', price: 1 }, fillerCount } = {}) {
    const out = picks.map(p => rec(p.position, p.price, { nflTeam: p.nflTeam || `X${nextId++}`, fantasyTeam: teamName, name: p.name }))
    const need = fillerCount ?? Math.max(0, 15 - out.length)
    for (let i = 0; i < need; i++) {
      out.push(rec(filler.position, filler.price, { nflTeam: `F${i}`, fantasyTeam: teamName }))
    }
    return out
  }

  it('classifies a Taco team (expensive QB, K/DST hoard, NFL-team cluster) and emits homeTeam', () => {
    const picks = roster('T', [
      { position: 'QB', price: 26, nflTeam: 'KC' },
      { position: 'WR', price: 18, nflTeam: 'KC' },
      { position: 'TE', price: 12, nflTeam: 'KC' },
      { position: 'RB', price: 15, nflTeam: 'KC' },
      { position: 'K', price: 2, nflTeam: 'DAL' },
      { position: 'K', price: 1, nflTeam: 'GB' },
      { position: 'DST', price: 1, nflTeam: 'NYJ' },
    ], { filler: { position: 'WR', price: 5 } })
    const [t] = classifyTeams(picks)
    expect(t.persona).toBe('Taco')
    expect(t.confidence).toBe('high')
    expect(t.homeTeam).toBe('KC')
  })

  it('classifies a ZeroRB team (no RB above $12, WR/TE-heavy spend)', () => {
    const picks = roster('T', [
      { position: 'WR', price: 45 }, { position: 'WR', price: 40 },
      { position: 'WR', price: 35 }, { position: 'TE', price: 25 },
      { position: 'RB', price: 10 }, { position: 'RB', price: 8 }, { position: 'RB', price: 5 },
      { position: 'QB', price: 12 },
    ])
    const [t] = classifyTeams(picks)
    expect(t.persona).toBe('ZeroRB')
    expect(t.homeTeam).toBeNull()
  })

  it('vetoes ZeroRB when the team bought a $20+ RB', () => {
    const picks = roster('T', [
      { position: 'WR', price: 45 }, { position: 'WR', price: 40 },
      { position: 'WR', price: 35 }, { position: 'TE', price: 25 },
      { position: 'RB', price: 22 }, { position: 'RB', price: 8 },
      { position: 'QB', price: 12 },
    ])
    const [t] = classifyTeams(picks)
    expect(t.persona).not.toBe('ZeroRB')
  })

  it('classifies a HeroRB team (one elite RB, other RBs cheap)', () => {
    const picks = roster('T', [
      { position: 'RB', price: 48 },
      { position: 'RB', price: 8 }, { position: 'RB', price: 5 },
      { position: 'WR', price: 22 }, { position: 'WR', price: 20 },
      { position: 'WR', price: 14 }, { position: 'TE', price: 13 },
      { position: 'QB', price: 11 }, { position: 'WR', price: 9 },
    ])
    const [t] = classifyTeams(picks)
    expect(t.persona).toBe('HeroRB')
  })

  it('classifies a LateRoundQB team (all QBs at punt prices)', () => {
    const picks = roster('T', [
      { position: 'QB', price: 3 }, { position: 'QB', price: 1 },
      { position: 'RB', price: 40 }, { position: 'RB', price: 36 },
      { position: 'WR', price: 30 }, { position: 'WR', price: 26 },
      { position: 'TE', price: 14 }, { position: 'WR', price: 12 }, { position: 'RB', price: 9 },
    ])
    const [t] = classifyTeams(picks)
    expect(t.persona).toBe('LateRoundQB')
  })

  it('classifies a StarsAndScrubs team (top-heavy plus $1-3 fills, thin mid-tier)', () => {
    const picks = roster('T', [
      { position: 'WR', price: 60 }, { position: 'WR', price: 55 },
      { position: 'RB', price: 15 },
      { position: 'QB', price: 4 },
    ], { filler: { position: 'RB', price: 2 } })
    const [t] = classifyTeams(picks)
    expect(t.persona).toBe('StarsAndScrubs')
  })

  it('classifies a ValueHunter team (leftover budget, no big-ticket buys)', () => {
    const picks = roster('T', [
      { position: 'RB', price: 30 }, { position: 'RB', price: 12 },
      { position: 'WR', price: 28 }, { position: 'WR', price: 24 },
      { position: 'WR', price: 20 }, { position: 'TE', price: 18 },
      { position: 'QB', price: 13 }, { position: 'WR', price: 11 },
      { position: 'RB', price: 10 }, { position: 'WR', price: 9 },
    ])
    // Total spend 175 + 5 fillers = 180 → $20 leftover.
    const [t] = classifyTeams(picks)
    expect(t.persona).toBe('ValueHunter')
  })

  it('falls back to Balanced with low confidence under 8 picks', () => {
    const picks = roster('T', [{ position: 'QB', price: 30 }], { fillerCount: 3 })
    const [t] = classifyTeams(picks)
    expect(t).toMatchObject({ persona: 'Balanced', confidence: 'low' })
  })

  it('classifies teams independently and preserves first-appearance order', () => {
    const a = roster('Alpha', [{ position: 'QB', price: 26 }, { position: 'K', price: 1 }, { position: 'K', price: 1 }, { position: 'DST', price: 1 }])
    const b = roster('Beta', [{ position: 'WR', price: 45 }, { position: 'WR', price: 40 }, { position: 'WR', price: 35 }, { position: 'TE', price: 25 }, { position: 'RB', price: 10 }])
    const out = classifyTeams([...a, ...b])
    expect(out.map(t => t.name)).toEqual(['Alpha', 'Beta'])
    expect(out[1].persona).toBe('ZeroRB')
  })

  it('normalizes prices by league budget before applying thresholds', () => {
    // $100 budget: a $13 QB is a $26 QB in $200 space → Taco signal fires.
    const picks = roster('T', [
      { position: 'QB', price: 13, nflTeam: 'KC' },
      { position: 'WR', price: 9, nflTeam: 'KC' },
      { position: 'TE', price: 6, nflTeam: 'KC' },
      { position: 'RB', price: 5, nflTeam: 'KC' },
      { position: 'K', price: 1 }, { position: 'K', price: 1 }, { position: 'DST', price: 1 },
    ])
    const [t] = classifyTeams(picks, { leagueBudget: 100 })
    expect(t.persona).toBe('Taco')
  })
})
