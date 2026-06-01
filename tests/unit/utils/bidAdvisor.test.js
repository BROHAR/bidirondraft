import { describe, it, expect } from 'vitest'
import { getBidAdvice } from '../../../src/utils/bidAdvisor.js'
import { getReplacementLevels } from '../../../src/utils/draftAnalysis.js'
import { Team } from '../../../src/models/Team.js'
import { Player } from '../../../src/models/Player.js'

const CONFIG = {
  budgetPerTeam: 200,
  numberOfTeams: 12,
  rosterPositions: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 },
}

function makePlayer(overrides = {}) {
  return new Player({
    id: overrides.id || Math.random().toString(36).slice(2),
    name: overrides.name || 'Test Player',
    position: overrides.position || 'RB',
    team: overrides.team || 'KC',
    estimatedValue: overrides.estimatedValue ?? 30,
    projectedPoints: overrides.projectedPoints ?? { halfPPR: 200, standard: 180, ppr: 220 },
    byeWeek: overrides.byeWeek ?? 7,
  })
}

function makeTeam(overrides = {}) {
  const team = new Team('t1', 'Test', true, CONFIG)
  if (overrides.remainingBudget != null) team.remainingBudget = overrides.remainingBudget
  if (overrides.roster) team.roster = overrides.roster
  return team
}

// Build a plausible pool of available players so VORP / scarcity / replacement
// levels are well-defined for tests.
function makePool({ rbValues = [60, 40, 25, 18, 12, 8, 5, 3, 2, 1], wrValues = [55, 38, 24, 17, 11, 7, 4, 2, 1, 1], qbValues = [30, 20, 12, 8, 5, 3, 2, 1], teValues = [20, 12, 7, 4, 2, 1], kValues = [3, 2, 1, 1, 1], dstValues = [3, 2, 1, 1, 1] } = {}) {
  const players = []
  const mk = (pos, value, i) => makePlayer({
    id: `${pos}-${i}`,
    name: `${pos}${i}`,
    position: pos,
    estimatedValue: value,
    projectedPoints: { halfPPR: 250 - i * 12, standard: 230 - i * 12, ppr: 270 - i * 12 },
  })
  rbValues.forEach((v, i) => players.push(mk('RB', v, i)))
  wrValues.forEach((v, i) => players.push(mk('WR', v, i)))
  qbValues.forEach((v, i) => players.push(mk('QB', v, i)))
  teValues.forEach((v, i) => players.push(mk('TE', v, i)))
  kValues.forEach((v, i) => players.push(mk('K', v, i)))
  dstValues.forEach((v, i) => players.push(mk('DST', v, i)))
  return players
}

function levelsFor(pool) {
  return getReplacementLevels(pool, CONFIG.rosterPositions, CONFIG.numberOfTeams).levels
}

describe('getBidAdvice', () => {
  describe('verdict transitions', () => {
    it('walks from BARGAIN → FAIR → STRETCH → STOP as currentBid climbs', () => {
      const pool = makePool()
      const target = pool.find((p) => p.position === 'RB' && p.estimatedValue === 60)
      const team = makeTeam()
      const levels = levelsFor(pool)
      const others = pool.filter((p) => p.id !== target.id)

      const bargain = getBidAdvice(target, 5, team, others, levels)
      expect(bargain.verdict).toBe('BARGAIN')

      const max = bargain.maxBid
      const fair = getBidAdvice(target, max - 2, team, others, levels)
      expect(fair.verdict).toBe('FAIR')

      const stretch = getBidAdvice(target, max + 1, team, others, levels)
      expect(stretch.verdict).toBe('STRETCH')

      const stop = getBidAdvice(target, max + 10, team, others, levels)
      expect(stop.verdict).toBe('STOP')
    })

    it('returns the same recommended max as currentBid changes', () => {
      const pool = makePool()
      const target = pool.find((p) => p.position === 'RB' && p.estimatedValue === 60)
      const team = makeTeam()
      const levels = levelsFor(pool)
      const others = pool.filter((p) => p.id !== target.id)

      const a = getBidAdvice(target, 1, team, others, levels)
      const b = getBidAdvice(target, 30, team, others, levels)
      const c = getBidAdvice(target, 80, team, others, levels)
      expect(a.maxBid).toBe(b.maxBid)
      expect(b.maxBid).toBe(c.maxBid)
    })
  })

  describe('hard PASS gates', () => {
    it('PASSes when the team is at position cap (3rd TE)', () => {
      const pool = makePool()
      const target = pool.find((p) => p.position === 'TE' && p.estimatedValue === 20)
      const team = makeTeam({
        roster: [
          makePlayer({ id: 'te-own-1', position: 'TE', estimatedValue: 12 }),
          makePlayer({ id: 'te-own-2', position: 'TE', estimatedValue: 6 }),
        ],
      })
      const levels = levelsFor(pool)
      const advice = getBidAdvice(target, 1, team, pool.filter((p) => p.id !== target.id), levels)
      expect(advice.verdict).toBe('PASS')
      expect(advice.maxBid).toBeLessThanOrEqual(1)
      expect(advice.reasons[0].label).toMatch(/TE/)
    })

    it('PASSes when roster is full', () => {
      const pool = makePool()
      const target = pool.find((p) => p.position === 'RB' && p.estimatedValue === 60)
      const roster = []
      for (let i = 0; i < 15; i++) roster.push(makePlayer({ id: `own-${i}`, position: 'WR' }))
      const team = makeTeam({ roster })
      const levels = levelsFor(pool)
      const advice = getBidAdvice(target, 1, team, pool, levels)
      expect(advice.verdict).toBe('PASS')
      expect(advice.reasons[0].label).toBe('Roster is full')
    })

    it('PASSes when the next legal bid exceeds team max budget reserve', () => {
      const pool = makePool()
      const target = pool.find((p) => p.position === 'RB' && p.estimatedValue === 60)
      const team = makeTeam({ remainingBudget: 16 }) // 15 spots left, maxBid = 16 - 14 = 2
      const levels = levelsFor(pool)
      const advice = getBidAdvice(target, 5, team, pool.filter((p) => p.id !== target.id), levels)
      expect(advice.verdict).toBe('PASS')
    })
  })

  describe('position-need boost', () => {
    it('boosts max bid when team has 2 open starter slots at the position', () => {
      const pool = makePool()
      const target = pool.find((p) => p.position === 'RB' && p.estimatedValue === 60)
      const others = pool.filter((p) => p.id !== target.id)
      const levels = levelsFor(pool)

      const empty = makeTeam()
      const adviceNeedy = getBidAdvice(target, 1, empty, others, levels)

      const filled = makeTeam({
        roster: [
          makePlayer({ id: 'own-rb-1', position: 'RB', estimatedValue: 40 }),
          makePlayer({ id: 'own-rb-2', position: 'RB', estimatedValue: 25 }),
        ],
      })
      const adviceFilled = getBidAdvice(target, 1, filled, others, levels)

      expect(adviceNeedy.maxBid).toBeGreaterThan(adviceFilled.maxBid)
      expect(adviceNeedy.reasons.some((r) => /RB starter need/.test(r.label))).toBe(true)
    })
  })

  describe('positional scarcity', () => {
    it('adds a tier-drop reason when the next-best at position is much cheaper', () => {
      const target = makePlayer({ id: 'target', position: 'RB', estimatedValue: 60 })
      const others = [
        makePlayer({ id: 'rb-next', position: 'RB', estimatedValue: 30 }), // ~50% drop
        ...makePool().filter((p) => p.position !== 'RB'),
      ]
      const team = makeTeam()
      const levels = getReplacementLevels([target, ...others], CONFIG.rosterPositions, CONFIG.numberOfTeams).levels
      const advice = getBidAdvice(target, 1, team, others, levels)
      expect(advice.reasons.some((r) => /tier drop/i.test(r.label))).toBe(true)
    })

    it('does not add a tier-drop reason when next-best at position is comparable', () => {
      const target = makePlayer({ id: 'target', position: 'RB', estimatedValue: 60 })
      const others = [
        makePlayer({ id: 'rb-next', position: 'RB', estimatedValue: 58 }), // ~3% drop
        ...makePool().filter((p) => p.position !== 'RB'),
      ]
      const team = makeTeam()
      const levels = getReplacementLevels([target, ...others], CONFIG.rosterPositions, CONFIG.numberOfTeams).levels
      const advice = getBidAdvice(target, 1, team, others, levels)
      expect(advice.reasons.some((r) => /tier drop/i.test(r.label))).toBe(false)
    })
  })

  describe('VONA / opportunity cost', () => {
    it('caps maxBid at base value when a higher-VORP player at the same position is still available', () => {
      const better = makePlayer({
        id: 'better',
        position: 'RB',
        estimatedValue: 50,
        projectedPoints: { halfPPR: 280, standard: 260, ppr: 300 },
      })
      const target = makePlayer({
        id: 'target',
        position: 'RB',
        estimatedValue: 55, // priced higher but worse projection
        projectedPoints: { halfPPR: 210, standard: 190, ppr: 230 },
      })
      const filler = makePool().filter((p) => p.position !== 'RB')
      const all = [target, better, ...filler]
      const levels = getReplacementLevels(all, CONFIG.rosterPositions, CONFIG.numberOfTeams).levels
      const team = makeTeam()
      const advice = getBidAdvice(target, 1, team, [better, ...filler], levels)
      expect(advice.maxBid).toBeLessThanOrEqual(target.estimatedValue)
      expect(advice.reasons.some((r) => /Better RB still available/.test(r.label))).toBe(true)
    })
  })

  describe('budget pacing', () => {
    it('boosts maxBid when team is significantly over pace', () => {
      const pool = makePool()
      const target = pool.find((p) => p.position === 'RB' && p.estimatedValue === 60)
      const others = pool.filter((p) => p.id !== target.id)
      const levels = levelsFor(pool)

      const normal = makeTeam() // $200 / 15 spots = $13.3/slot
      const adviceNormal = getBidAdvice(target, 1, normal, others, levels)

      // Pile in 8 cheap picks but only spend $20 total — leaves $180 across 7 spots = $25.7/slot
      const overpaceRoster = []
      for (let i = 0; i < 8; i++) overpaceRoster.push(makePlayer({ id: `cheap-${i}`, position: 'WR' }))
      const overpace = makeTeam({ roster: overpaceRoster, remainingBudget: 180 })
      const adviceOver = getBidAdvice(target, 1, overpace, others, levels)

      expect(adviceOver.breakdown.paceRatio).toBeGreaterThan(1.20)
      expect(adviceOver.reasons.some((r) => /pace/i.test(r.label))).toBe(true)
      expect(adviceOver.maxBid).toBeGreaterThan(adviceNormal.maxBid - adviceNormal.breakdown.base * 0.10 - 1)
    })

    it('reduces maxBid when team is significantly under pace', () => {
      const pool = makePool()
      const target = pool.find((p) => p.position === 'WR' && p.estimatedValue === 24)
      const others = pool.filter((p) => p.id !== target.id)
      const levels = levelsFor(pool)

      // Drafted 3 expensive players, $20 left across 12 spots ≈ $1.7/slot vs $13.3 expected
      const broke = makeTeam({
        roster: [
          makePlayer({ id: 'paid-1', position: 'RB' }),
          makePlayer({ id: 'paid-2', position: 'RB' }),
          makePlayer({ id: 'paid-3', position: 'WR' }),
        ],
        remainingBudget: 20,
      })
      const advice = getBidAdvice(target, 1, broke, others, levels)
      expect(advice.breakdown.paceRatio).toBeLessThan(0.80)
      expect(advice.reasons.some((r) => /Under pace/i.test(r.label))).toBe(true)
    })
  })

  describe('safety caps', () => {
    it('never recommends a maxBid that exceeds humanTeam.maxBid', () => {
      const pool = makePool()
      const target = pool.find((p) => p.position === 'RB' && p.estimatedValue === 60)
      const others = pool.filter((p) => p.id !== target.id)
      const levels = levelsFor(pool)
      const tight = makeTeam({ remainingBudget: 30 }) // maxBid = 30 - 14 = 16
      const advice = getBidAdvice(target, 1, tight, others, levels)
      expect(advice.maxBid).toBeLessThanOrEqual(tight.maxBid)
    })

    it('never exceeds 1.35× base value even when all boosts stack', () => {
      const pool = makePool()
      const target = pool.find((p) => p.position === 'RB' && p.estimatedValue === 60)
      const others = pool.filter((p) => p.id !== target.id)
      const levels = levelsFor(pool)
      const overpaceRoster = []
      for (let i = 0; i < 8; i++) overpaceRoster.push(makePlayer({ id: `c-${i}`, position: 'WR' }))
      const over = makeTeam({ roster: overpaceRoster, remainingBudget: 180 })
      const advice = getBidAdvice(target, 1, over, others, levels)
      expect(advice.maxBid).toBeLessThanOrEqual(Math.round(target.estimatedValue * 1.35))
    })
  })

  describe('determinism', () => {
    it('returns the same result for the same inputs', () => {
      const pool = makePool()
      const target = pool.find((p) => p.position === 'RB' && p.estimatedValue === 60)
      const others = pool.filter((p) => p.id !== target.id)
      const levels = levelsFor(pool)
      const team = makeTeam()

      const a = getBidAdvice(target, 5, team, others, levels)
      const b = getBidAdvice(target, 5, team, others, levels)
      expect(a.maxBid).toBe(b.maxBid)
      expect(a.verdict).toBe(b.verdict)
      expect(a.reasons.map((r) => r.label)).toEqual(b.reasons.map((r) => r.label))
    })
  })
})
