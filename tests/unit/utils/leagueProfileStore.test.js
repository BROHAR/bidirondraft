import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadLeagueProfile,
  saveLeagueProfile,
  clearLeagueProfile,
  sanitizeLeagueProfile,
} from '../../../src/utils/leagueProfileStore'

const KEY = 'adraft.leagueProfile.v1'

const neutralTiers = () => [
  { min: 50, factor: 1.0 }, { min: 35, factor: 1.0 }, { min: 20, factor: 1.0 },
  { min: 10, factor: 1.0 }, { min: 4, factor: 1.0 }, { min: 0, factor: 1.0 },
]

function validProfile(overrides = {}) {
  return {
    version: 2,
    importedAt: '2026-07-18T00:00:00.000Z',
    source: 'csv',
    leagueBudget: 200,
    parsedCount: 170,
    positionFactors: { QB: 1.16, RB: 0.99, WR: 0.97, TE: 0.97, K: 1.0, DST: 1.0 },
    tierFactors: {
      QB: neutralTiers(),
      RB: [
        { min: 50, factor: 0.9 }, { min: 35, factor: 0.93 }, { min: 20, factor: 0.97 },
        { min: 10, factor: 1.0 }, { min: 4, factor: 1.02 }, { min: 0, factor: 1.0 },
      ],
      WR: neutralTiers(), TE: neutralTiers(), K: neutralTiers(), DST: neutralTiers(),
    },
    lateInflation: 1.18,
    teams: [
      { name: 'Alpha', isUser: true, persona: 'StarsAndScrubs', confidence: 'high', spend: 200, picks: 17, homeTeam: null },
      { name: 'Beta', isUser: false, persona: 'Taco', confidence: 'medium', spend: 198, picks: 17, homeTeam: 'KC' },
    ],
    ...overrides,
  }
}

describe('leagueProfileStore', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('returns null when nothing is stored', () => {
    expect(loadLeagueProfile()).toBeNull()
  })

  it('round-trips a valid profile', () => {
    saveLeagueProfile(validProfile())
    expect(loadLeagueProfile()).toEqual(validProfile())
  })

  it('returns null on corrupt JSON', () => {
    window.localStorage.setItem(KEY, '{not json')
    expect(loadLeagueProfile()).toBeNull()
  })

  it('returns null on version mismatch or non-object payloads', () => {
    expect(sanitizeLeagueProfile(null)).toBeNull()
    expect(sanitizeLeagueProfile('str')).toBeNull()
    expect(sanitizeLeagueProfile({ version: 99 })).toBeNull()
  })

  it('re-clamps out-of-range and non-finite factors', () => {
    const p = sanitizeLeagueProfile(validProfile({
      positionFactors: { QB: 9, RB: 0.1, WR: NaN, TE: 'x', K: 1.5, DST: 1.0 },
      lateInflation: 7,
    }))
    expect(p.positionFactors.QB).toBe(1.6)   // clamp hi
    expect(p.positionFactors.RB).toBe(0.6)   // clamp lo
    expect(p.positionFactors.WR).toBe(1.0)   // NaN → neutral
    expect(p.positionFactors.TE).toBe(1.0)   // non-number → neutral
    expect(p.lateInflation).toBe(1.5)
  })

  it('rebuilds tier buckets canonically per position, forcing bottom and K/DST neutral', () => {
    const p = sanitizeLeagueProfile(validProfile({
      tierFactors: {
        RB: [
          { min: 0, factor: 3.0 },              // bottom must stay 1.0
          { min: 35, factor: 2.5 },             // clamps to 1.4
          { min: 999, factor: 1.2 },            // unknown bucket dropped
          // 20/10/4 buckets missing → neutral
        ],
        K: [{ min: 35, factor: 1.3 }],          // K is always forced neutral
        // other positions missing entirely → neutral
      },
    }))
    expect(p.tierFactors.RB).toEqual([
      { min: 50, factor: 1.0 }, { min: 35, factor: 1.4 }, { min: 20, factor: 1.0 },
      { min: 10, factor: 1.0 }, { min: 4, factor: 1.0 }, { min: 0, factor: 1.0 },
    ])
    for (const pos of ['QB', 'WR', 'TE', 'K', 'DST']) {
      for (const t of p.tierFactors[pos]) expect(t.factor).toBe(1.0)
    }
  })

  it('rejects v1 profiles (global tier curve) so users re-import', () => {
    expect(sanitizeLeagueProfile({ ...validProfile(), version: 1 })).toBeNull()
  })

  it('coerces unknown personas and confidences on teams', () => {
    const p = sanitizeLeagueProfile(validProfile({
      teams: [
        { name: 'X', persona: 'NotAStrategy', confidence: 'certain', spend: 'lots', picks: 1.5, homeTeam: '' },
        { name: '', persona: 'Taco' },   // nameless team dropped
      ],
    }))
    expect(p.teams.length).toBe(1)
    expect(p.teams[0]).toEqual({
      name: 'X', isUser: false, persona: 'Balanced', confidence: 'low', spend: 0, picks: 0, homeTeam: null,
    })
  })

  it('clearLeagueProfile removes the entry', () => {
    saveLeagueProfile(validProfile())
    clearLeagueProfile()
    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(loadLeagueProfile()).toBeNull()
  })
})
