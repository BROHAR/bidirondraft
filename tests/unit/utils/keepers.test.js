import { describe, it, expect } from 'vitest'
import {
  validateKeepers,
  resolveKeepers,
  applyResolvedKeepers,
  sanitizeKeepers,
  matchPicksToPlayers,
  KEEPER_PRICE_RULES,
  DEFAULT_MAX_KEEPERS,
} from '../../../src/utils/keepers.js'
import { DraftConfig } from '../../../src/models/DraftConfig.js'
import { Team } from '../../../src/models/Team.js'

const ROSTER = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 6 } // 15 slots

function config(overrides = {}) {
  return {
    numberOfTeams: 12,
    budgetPerTeam: 200,
    rosterPositions: { ...ROSTER },
    maxKeepersPerTeam: DEFAULT_MAX_KEEPERS,
    keepers: [],
    ...overrides,
  }
}

function keeper(overrides = {}) {
  return {
    teamPosition: 1,
    playerId: 'p1',
    name: 'Player One',
    position: 'RB',
    price: 40,
    ...overrides,
  }
}

describe('validateKeepers', () => {
  it('accepts no keepers (redraft league)', () => {
    expect(validateKeepers(config())).toEqual([])
    expect(validateKeepers(config({ keepers: undefined }))).toEqual([])
  })

  it('accepts a sane keeper set', () => {
    const cfg = config({
      keepers: [
        keeper(),
        keeper({ teamPosition: 2, playerId: 'p2', name: 'Player Two', position: 'WR', price: 25 }),
      ],
    })
    expect(validateKeepers(cfg)).toEqual([])
  })

  it('rejects a non-array keepers value', () => {
    expect(validateKeepers(config({ keepers: 'nope' }))).toContain('Keepers must be a list')
  })

  it('rejects out-of-range team positions', () => {
    const errors = validateKeepers(config({ keepers: [keeper({ teamPosition: 13 })] }))
    expect(errors.join(' ')).toMatch(/team position/)
  })

  it('rejects non-integer and out-of-range prices', () => {
    for (const price of [0, -3, 2.5, 201, '40']) {
      const errors = validateKeepers(config({ keepers: [keeper({ price })] }))
      expect(errors.join(' '), `price=${price}`).toMatch(/price/)
    }
  })

  it('rejects the same player kept twice', () => {
    const errors = validateKeepers(config({
      keepers: [keeper(), keeper({ teamPosition: 2 })],
    }))
    expect(errors.join(' ')).toMatch(/more than one team/)
  })

  it('rejects more keepers than maxKeepersPerTeam on one team', () => {
    const keepers = ['p1', 'p2', 'p3'].map((id, i) =>
      keeper({ playerId: id, name: `P${i}`, price: 10 + i }))
    const errors = validateKeepers(config({ keepers, maxKeepersPerTeam: 2 }))
    expect(errors.join(' ')).toMatch(/at most 2 keepers/)
  })

  it('rejects keeper spend that leaves less than $1 per open slot', () => {
    // 15-slot roster, 2 keepers → 13 open slots; $188 spend leaves only $12.
    const errors = validateKeepers(config({
      keepers: [
        keeper({ price: 100 }),
        keeper({ playerId: 'p2', name: 'Player Two', position: 'WR', price: 88 }),
      ],
    }))
    expect(errors.join(' ')).toMatch(/less than \$1 per open roster slot/)
  })

  it('rejects keepers that make required starters unfillable', () => {
    // 10-slot roster with a single bench spot: keeping 3 QBs fills QB + eats
    // 2 flexless slots, leaving 7 open slots against 8 reserved starters.
    const tight = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BENCH: 1 }
    const keepers = ['p1', 'p2', 'p3'].map((id, i) =>
      keeper({ playerId: id, name: `QB${i}`, position: 'QB', price: 5 }))
    const errors = validateKeepers(config({ rosterPositions: tight, keepers }))
    expect(errors.join(' ')).toMatch(/too few open slots/)
  })

  it('is surfaced through DraftConfig.validate()', () => {
    const dc = new DraftConfig(config({ keepers: [keeper({ price: 0 })] }))
    const result = dc.validate()
    expect(result.isValid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/price/)
  })
})

describe('resolveKeepers / applyResolvedKeepers', () => {
  function makeDraft() {
    const cfg = config()
    const teams = Array.from({ length: 3 }, (_, i) =>
      new Team(`team_${i + 1}`, `Team ${i + 1}`, false, cfg))
    const players = [
      { id: 'p1', name: 'Player One', position: 'RB', estimatedValue: 60 },
      { id: 'p2', name: 'Player Two', position: 'WR', estimatedValue: 45 },
      { id: 'p3', name: 'Player Three', position: 'QB', estimatedValue: 30 },
    ]
    return { cfg, teams, players }
  }

  it('resolves entries to live team/player references and skips stale ids', () => {
    const { cfg, teams, players } = makeDraft()
    cfg.keepers = [
      keeper({ teamPosition: 2 }),
      keeper({ playerId: 'gone', name: 'Retired Guy', teamPosition: 1 }),
    ]
    const resolved = resolveKeepers(cfg, teams, players)
    expect(resolved).toHaveLength(1)
    expect(resolved[0].team).toBe(teams[1])
    expect(resolved[0].player).toBe(players[0])
    expect(resolved[0].price).toBe(40)
  })

  it('keeps only the first entry for a duplicated player', () => {
    const { cfg, teams, players } = makeDraft()
    cfg.keepers = [keeper({ teamPosition: 1, price: 10 }), keeper({ teamPosition: 3, price: 99 })]
    const resolved = resolveKeepers(cfg, teams, players)
    expect(resolved).toHaveLength(1)
    expect(resolved[0].team).toBe(teams[0])
    expect(resolved[0].price).toBe(10)
  })

  it('applies the four purchase mutations and filters the pool', () => {
    const { cfg, teams, players } = makeDraft()
    cfg.keepers = [keeper({ teamPosition: 2, price: 37 })]
    const resolved = resolveKeepers(cfg, teams, players)
    const pool = applyResolvedKeepers(resolved, players)

    const kept = players[0]
    expect(kept.purchasePrice).toBe(37)
    expect(kept.isKeeper).toBe(true)
    expect(teams[1].roster).toContain(kept)
    expect(teams[1].remainingBudget).toBe(200 - 37)
    expect(pool.map(p => p.id)).toEqual(['p2', 'p3'])
    // maxBid math stays consistent: budget minus $1 per still-open slot.
    expect(teams[1].maxBid).toBe(163 - (15 - 1 - 1))
  })

  it('returns the same pool reference when there are no keepers', () => {
    const { players } = makeDraft()
    expect(applyResolvedKeepers([], players)).toBe(players)
  })
})

describe('sanitizeKeepers', () => {
  it('drops malformed entries and strips unknown fields', () => {
    const dirty = [
      keeper(),
      null,
      'x',
      keeper({ playerId: '' }),
      keeper({ playerId: 'p9', position: 'COACH' }),
      keeper({ playerId: 'p10', price: 0 }),
      { ...keeper({ playerId: 'p11' }), extra: 'field' },
    ]
    const clean = sanitizeKeepers(dirty)
    expect(clean).toHaveLength(2)
    expect(clean[0]).toEqual(keeper())
    expect(Object.keys(clean[1]).sort()).toEqual(['name', 'playerId', 'position', 'price', 'teamPosition'])
  })

  it('drops entries beyond maxTeamPosition', () => {
    const clean = sanitizeKeepers([keeper(), keeper({ playerId: 'p2', teamPosition: 9 })], 8)
    expect(clean).toHaveLength(1)
  })

  it('returns [] for non-arrays', () => {
    expect(sanitizeKeepers(undefined)).toEqual([])
    expect(sanitizeKeepers({})).toEqual([])
  })
})

describe('matchPicksToPlayers', () => {
  const players = [
    { id: 'p1', name: 'Marvin Harrison Jr.', position: 'WR' },
    { id: 'p2', name: "De'Von Achane", position: 'RB' },
    { id: 'p3', name: 'Josh Allen', position: 'QB' },
  ]

  it('matches loosely on name (punctuation, suffixes) plus exact position', () => {
    const picks = [
      { name: 'Marvin Harrison', position: 'WR', price: 30, fantasyTeam: 'A' },
      { name: 'DeVon Achane', position: 'RB', price: 25, fantasyTeam: 'A' },
      { name: 'Josh Allen', position: 'WR', price: 5, fantasyTeam: 'B' }, // wrong position
      { name: 'Some Rookie', position: 'RB', price: 3, fantasyTeam: 'B' },
    ]
    const matched = matchPicksToPlayers(picks, players)
    expect(matched[0].player?.id).toBe('p1')
    expect(matched[1].player?.id).toBe('p2')
    expect(matched[2].player).toBeNull()
    expect(matched[3].player).toBeNull()
  })
})

describe('KEEPER_PRICE_RULES', () => {
  it('applies the documented pricing math', () => {
    const byKey = Object.fromEntries(KEEPER_PRICE_RULES.map(r => [r.key, r.apply]))
    expect(byKey.same(17)).toBe(17)
    expect(byKey.plus5(17)).toBe(22)
    expect(byKey.plus10pct(17)).toBe(19) // ceil(18.7)
  })
})
