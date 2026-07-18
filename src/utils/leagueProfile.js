// League Profile: fits a league's market personality from an imported real
// auction draft (draftImport.js records) and projects it onto the current
// player book. ALL fitting is book-free at the per-player level — last year's
// prices must never be ratioed against this year's per-player values, because
// projections drift (an injured $55 RB reading as "RB inflation" would be
// noise, not behavior). Only aggregate properties of the current book are
// used (position value shares, the rank-sorted value curve), which are stable
// season to season. Shrinkage (λ=0.5) plus hard clamps keep one draft's worth
// of data from overfitting.
//
// Everything here is pure and deterministic: no rng, no store access. The
// resulting profile is plain JSON so it rides on config through the meta-sim
// worker's JSON round-trip untouched.

import { REFERENCE_BUDGET } from './budgetScaling'

// v2: tierFactors went from one global curve to per-position curves, so a
// "won't pay up for elite RBs" league doesn't get diluted by full-price elite
// WRs sharing the bucket. v1 profiles sanitize to null (re-import).
export const PROFILE_VERSION = 2

// Shrinkage toward neutral and clamps applied at fit time (re-applied by the
// store's sanitizer so hand-edited localStorage can't smuggle wild factors).
const SHRINK = 0.5
export const POSITION_FACTOR_RANGE = [0.6, 1.6]
export const TIER_FACTOR_RANGE = [0.7, 1.4]
export const LATE_INFLATION_RANGE = [0.8, 1.5]

// Tier buckets by rank-fair value (descending). The $50+ elite bucket exists
// so "won't pay up for the BEST players at a position" fits separately from
// the merely-expensive tier below it. The bottom bucket is always neutral:
// sub-$4 prices are $1-3 noise with no fittable signal.
export const TIER_MINS = [50, 35, 20, 10, 4, 0]

export const TIER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST']

const MIN_POSITION_SAMPLES = 3
// Per-position tier cells are small (a draft has ~5 elite RBs), so the
// minimum is lower than the position one; shrinkage still guards overfit.
const MIN_TIER_SAMPLES = 3
const MIN_TRAJECTORY_SAMPLES = 5   // per third, rank-fair ≥ $5
const MIN_PICKS_FOR_CLASSIFY = 8

function neutralTiers() {
  return TIER_MINS.map(min => ({ min, factor: 1.0 }))
}

function shrinkAndClamp(f, [lo, hi]) {
  const shrunk = 1 + SHRINK * (f - 1)
  return Math.min(hi, Math.max(lo, Math.round(shrunk * 100) / 100))
}

// ---------------------------------------------------------------------------
// Fitting
// ---------------------------------------------------------------------------

// records: draftImport.js pick records. players: the raw players.json pool
// (current book — aggregate use only). teams: draftImport team summaries.
export function fitLeagueProfile(records, players, { leagueBudget = REFERENCE_BUDGET, teams = [], userTeamName = null, source = 'csv', importedAt = null } = {}) {
  const budget = leagueBudget > 0 ? leagueBudget : REFERENCE_BUDGET
  const norm = price => price * REFERENCE_BUDGET / budget
  const book = [...players].map(p => p.estimatedValue).sort((a, b) => b - a)

  // Rank-fair value: the i-th most expensive purchase is "worth" the i-th
  // highest current book value. Identity-free — robust to player drift.
  const byPrice = [...records].sort((a, b) => b.price - a.price)
  const rankFair = new Map()
  byPrice.forEach((r, i) => rankFair.set(r, book[Math.min(i, book.length - 1)] ?? 1))

  // --- Position factors: league $ share vs book value share ---------------
  const positionFactors = { QB: 1.0, RB: 1.0, WR: 1.0, TE: 1.0, K: 1.0, DST: 1.0 }
  {
    const spend = {}, count = {}
    let totalSpend = 0
    for (const r of records) {
      spend[r.position] = (spend[r.position] || 0) + norm(r.price)
      count[r.position] = (count[r.position] || 0) + 1
      totalSpend += norm(r.price)
    }
    // Book share over the top-K players — K matching the number of drafted
    // players keeps both shares describing the same market depth.
    const topK = book.slice(0, Math.min(records.length, book.length))
    const bookByPos = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 }
    const sortedPool = [...players].sort((a, b) => b.estimatedValue - a.estimatedValue)
    let bookTotal = 0
    for (let i = 0; i < topK.length; i++) {
      const p = sortedPool[i]
      bookByPos[p.position] = (bookByPos[p.position] || 0) + p.estimatedValue
      bookTotal += p.estimatedValue
    }
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {   // K/DST stay 1.0: book is clamped $1-3, no signal
      if ((count[pos] || 0) < MIN_POSITION_SAMPLES || totalSpend <= 0 || bookTotal <= 0) continue
      const obsShare = (spend[pos] || 0) / totalSpend
      const bookShare = (bookByPos[pos] || 0) / bookTotal
      if (bookShare > 0) positionFactors[pos] = shrinkAndClamp(obsShare / bookShare, POSITION_FACTOR_RANGE)
    }
  }

  // --- Tier factors: per-position rank-matched curve comparison ------------
  // Rank-matching happens WITHIN each position (the i-th priciest RB purchase
  // vs the i-th highest RB book value), so "elite RBs go cheap while elite
  // WRs fetch full price" fits as distinct curves instead of averaging out in
  // a shared bucket. Position-residual prices (normPrice / posFactor) keep
  // the position factor's overall level from double-counting into the curve.
  // K/DST always neutral (book clamped $1-3); sparse cells stay neutral.
  const tierFactors = {}
  for (const pos of TIER_POSITIONS) tierFactors[pos] = neutralTiers()
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    const posRecords = records.filter(r => r.position === pos).sort((a, b) => b.price - a.price)
    if (posRecords.length === 0) continue
    const posBook = players
      .filter(p => p.position === pos)
      .map(p => p.estimatedValue)
      .sort((a, b) => b - a)
    const sums = new Map(TIER_MINS.map(min => [min, { price: 0, fair: 0, n: 0 }]))
    posRecords.forEach((r, i) => {
      const fair = posBook[Math.min(i, posBook.length - 1)] ?? 1
      const bucketMin = TIER_MINS.find(min => fair >= min)
      const b = sums.get(bucketMin)
      b.price += norm(r.price) / (positionFactors[pos] || 1.0)
      b.fair += fair
      b.n++
    })
    for (const t of tierFactors[pos]) {
      if (t.min === 0) continue          // bottom bucket always neutral
      const b = sums.get(t.min)
      if (b.n >= MIN_TIER_SAMPLES && b.fair > 0) {
        t.factor = shrinkAndClamp(b.price / b.fair, TIER_FACTOR_RANGE)
      }
    }
  }

  // --- Late inflation: spend trajectory vs rank-fair expectation -----------
  // Hoarding shows up as early picks going under their market position and
  // late picks over it. Expected timeline = rank-fair values in actual pick
  // order; observed = prices in pick order; compare last third vs first third.
  let lateInflation = 1.0
  {
    const withPicks = records.filter(r => r.pick !== null)
    if (withPicks.length >= records.length * 2 / 3 && withPicks.length > 0) {
      const inOrder = [...withPicks].sort((a, b) => a.pick - b.pick)
      const third = Math.floor(inOrder.length / 3)
      const slice = (arr) => {
        let obs = 0, exp = 0, n = 0
        for (const r of arr) {
          const fair = rankFair.get(r)
          if (fair < 5) continue
          obs += norm(r.price)
          exp += fair
          n++
        }
        return { obs, exp, n }
      }
      const first = slice(inOrder.slice(0, third))
      const last = slice(inOrder.slice(inOrder.length - third))
      if (first.n >= MIN_TRAJECTORY_SAMPLES && last.n >= MIN_TRAJECTORY_SAMPLES && first.obs > 0 && first.exp > 0 && last.exp > 0) {
        const raw = (last.obs / last.exp) / (first.obs / first.exp)
        lateInflation = shrinkAndClamp(raw, LATE_INFLATION_RANGE)
      }
    }
  }

  return {
    version: PROFILE_VERSION,
    importedAt: importedAt || new Date().toISOString(),
    source,
    leagueBudget: budget,
    parsedCount: records.length,
    positionFactors,
    tierFactors,
    lateInflation,
    teams: teams.map(t => ({
      name: t.name,
      isUser: userTeamName != null && t.name === userTeamName,
      persona: t.persona || 'Balanced',
      confidence: t.confidence || 'low',
      spend: t.spend,
      picks: t.picks,
      homeTeam: t.homeTeam || null,
    })),
  }
}

// ---------------------------------------------------------------------------
// Applying the profile to the current book
// ---------------------------------------------------------------------------

function tierFactorFor(tierFactors, bookValue) {
  if (!Array.isArray(tierFactors)) return 1.0
  for (const t of tierFactors) if (bookValue >= t.min) return t.factor
  return 1.0
}

// Additive dollar deltas in $200-reference space, same convention as
// buildFormatValueDeltas — pre-anchor, so the downstream budget anchor
// renormalizes the level and only the fitted shape survives.
export function buildLeagueProfileDeltas(players, profile) {
  const deltas = new Map()
  if (!profile || !profile.positionFactors || !profile.tierFactors || typeof profile.tierFactors !== 'object') {
    return deltas
  }
  for (const p of players) {
    const book = p.estimatedValue
    const posF = profile.positionFactors[p.position] ?? 1.0
    const tierF = tierFactorFor(profile.tierFactors[p.position], book)
    const delta = ((posF - 1) + (tierF - 1)) * book
    if (delta !== 0) deltas.set(p.id, delta)
  }
  return deltas
}

// Strict no-op without config.leagueProfile — the neutral-path guarantee the
// seeded integration tests rely on.
export function applyLeagueProfileAdjustment(players, config) {
  const profile = config?.leagueProfile
  if (!profile) return
  const deltas = buildLeagueProfileDeltas(players, profile)
  if (deltas.size === 0) return
  for (const p of players) {
    const delta = deltas.get(p.id)
    if (delta) p.estimatedValue = Math.max(1, p.estimatedValue + delta)
  }
}

// ---------------------------------------------------------------------------
// Persona classification
// ---------------------------------------------------------------------------

// Classifier thresholds — all in $200-normalized dollars. Price-shape features
// only: personas describe spending behavior, so observed prices (not book
// ratios) are the honest signal, and they need no cross-season reference.
const T = {
  TACO_QB_PRICE: 20,
  TACO_KDST_COUNT: 3,
  TACO_CLUSTER: 4,
  ZERO_RB_MAX: 12,
  ZERO_RB_VETO: 20,
  ZERO_WRTE_SHARE: 0.55,
  HERO_RB_PRICE: 30,
  HERO_OTHER_MAX: 10,
  HERO_VETO_PRICE: 25,
  LRQB_MAX_PRICE: 5,
  LRQB_TOTAL: 8,
  LRQB_TOP2_GATE: 0.5,   // punting QB as a strategy implies spend is SPREAD —
                         // a top-heavy roster with a cheap QB is StarsAndScrubs
  SS_TOP2_SHARE: 0.55,
  SS_CHEAP_COUNT: 6,
  SS_MID_MAX: 2,
  VH_LEFTOVER: 15,
  VH_TOP1_SHARE: 0.20,
  VH_RB_MAX: 35,
  VH_QB_MAX: 15,
  BALANCED_BAR: 0.40,
  HIGH_SCORE: 0.75,
  HIGH_MARGIN: 0.2,
  MEDIUM_SCORE: 0.55,
}

// Ambiguity resolves toward the rarest/strongest signatures first.
const TIE_BREAK_ORDER = ['Taco', 'ZeroRB', 'HeroRB', 'LateRoundQB', 'StarsAndScrubs', 'ValueHunter', 'Balanced']

function teamFeatures(picks, norm) {
  const prices = picks.map(p => norm(p.price)).sort((a, b) => b - a)
  const total = prices.reduce((s, v) => s + v, 0)
  const byPos = pos => picks.filter(p => p.position === pos)
  const rbPrices = byPos('RB').map(p => norm(p.price))
  const qbPrices = byPos('QB').map(p => norm(p.price))
  const clusters = new Map()
  for (const p of picks) {
    if (!p.nflTeam) continue
    clusters.set(p.nflTeam, (clusters.get(p.nflTeam) || 0) + 1)
  }
  let nflCluster = 0, clusterTeam = null
  for (const [team, n] of clusters) {
    if (n > nflCluster) { nflCluster = n; clusterTeam = team }
  }
  const wrTeSpend = [...byPos('WR'), ...byPos('TE')].reduce((s, p) => s + norm(p.price), 0)
  return {
    total,
    top1Share: total > 0 ? prices[0] / total : 0,
    top2Share: total > 0 ? (prices[0] + (prices[1] || 0)) / total : 0,
    cheapCount: prices.filter(v => v <= 3).length,
    midCount: prices.filter(v => v >= 8 && v <= 15).length,
    kdstCount: byPos('K').length + byPos('DST').length,
    nflCluster,
    clusterTeam,
    qbMaxPrice: Math.max(0, ...qbPrices),
    qbTotalSpend: qbPrices.reduce((s, v) => s + v, 0),
    rbMaxPrice: Math.max(0, ...rbPrices),
    rbCountAbove: min => rbPrices.filter(v => v >= min).length,
    wrTeSpendShare: total > 0 ? wrTeSpend / total : 0,
    leftover: Math.max(0, REFERENCE_BUDGET - total),
  }
}

function scorePersonas(f) {
  const scores = {
    Taco:
      0.5 * (f.qbMaxPrice >= T.TACO_QB_PRICE ? 1 : 0) +
      0.3 * (f.kdstCount >= T.TACO_KDST_COUNT ? 1 : 0) +
      0.2 * (f.nflCluster >= T.TACO_CLUSTER ? 1 : 0),
    ZeroRB: f.rbMaxPrice >= T.ZERO_RB_VETO ? 0 :
      0.6 * (f.rbMaxPrice <= T.ZERO_RB_MAX ? 1 : 0) +
      0.4 * Math.min(1, f.wrTeSpendShare / T.ZERO_WRTE_SHARE),
    HeroRB: f.rbCountAbove(T.HERO_VETO_PRICE) >= 2 ? 0 :
      0.7 * (f.rbCountAbove(T.HERO_RB_PRICE) === 1 ? 1 : 0) +
      0.3 * (f.rbCountAbove(T.HERO_OTHER_MAX + 0.01) <= 1 ? 1 : 0),
    LateRoundQB:
      0.7 * (f.qbMaxPrice <= T.LRQB_MAX_PRICE ? 1 : 0) +
      0.3 * (f.qbTotalSpend <= T.LRQB_TOTAL && f.top2Share <= T.LRQB_TOP2_GATE ? 1 : 0),
    StarsAndScrubs:
      0.4 * Math.min(1, f.top2Share / T.SS_TOP2_SHARE) +
      0.3 * (f.cheapCount >= T.SS_CHEAP_COUNT ? 1 : 0) +
      0.3 * (f.midCount <= T.SS_MID_MAX ? 1 : 0),
    ValueHunter:
      0.4 * (f.leftover >= T.VH_LEFTOVER ? 1 : 0) +
      0.3 * (f.top1Share <= T.VH_TOP1_SHARE ? 1 : 0) +
      0.3 * (f.rbMaxPrice <= T.VH_RB_MAX && f.qbMaxPrice <= T.VH_QB_MAX ? 1 : 0),
    Balanced: T.BALANCED_BAR,
  }
  return scores
}

// records grouped per fantasy team → [{ name, persona, confidence, homeTeam }]
// in first-appearance order. Deterministic.
export function classifyTeams(records, { leagueBudget = REFERENCE_BUDGET } = {}) {
  const budget = leagueBudget > 0 ? leagueBudget : REFERENCE_BUDGET
  const norm = price => price * REFERENCE_BUDGET / budget
  const order = []
  const byTeam = new Map()
  for (const r of records) {
    if (!byTeam.has(r.fantasyTeam)) { byTeam.set(r.fantasyTeam, []); order.push(r.fantasyTeam) }
    byTeam.get(r.fantasyTeam).push(r)
  }

  return order.map(name => {
    const picks = byTeam.get(name)
    if (picks.length < MIN_PICKS_FOR_CLASSIFY) {
      return { name, persona: 'Balanced', confidence: 'low', homeTeam: null }
    }
    const f = teamFeatures(picks, norm)
    const scores = scorePersonas(f)
    // Argmax with ties resolved by TIE_BREAK_ORDER (strict > keeps the
    // earliest key at the max, so rarest/strongest signatures win ties).
    let winner = TIE_BREAK_ORDER[0]
    for (const key of TIE_BREAK_ORDER) {
      if (scores[key] > scores[winner]) winner = key
    }
    const runnerUp = Math.max(...TIE_BREAK_ORDER.filter(k => k !== winner).map(k => scores[k]))
    const score = scores[winner]
    let confidence
    if (winner !== 'Balanced' && score >= T.HIGH_SCORE && score - runnerUp >= T.HIGH_MARGIN) confidence = 'high'
    else if (winner !== 'Balanced' && score >= T.MEDIUM_SCORE) confidence = 'medium'
    else { winner = 'Balanced'; confidence = 'low' }
    return {
      name,
      persona: winner,
      confidence,
      homeTeam: winner === 'Taco' ? f.clusterTeam : null,
    }
  })
}
