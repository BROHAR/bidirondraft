import { describe, it, expect, beforeEach } from 'vitest'
import {
  defaultDraftConfig,
  defaultSetupState,
  loadSetupState,
  saveSetupState,
  clearSetupState,
} from '../../../src/utils/setupConfigStore'

const KEY = 'adraft.setupConfig.v1'

describe('setupConfigStore', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('returns defaults when nothing is stored', () => {
    expect(loadSetupState()).toEqual(defaultSetupState())
  })

  it('round-trips a saved config', () => {
    const state = {
      config: { ...defaultDraftConfig(), numberOfTeams: 10, budgetPerTeam: 300, humanTeamName: 'Champs' },
      aiBidderProfilesEnabled: true,
      metaDraftsPerStrategy: 80,
      launchMode: 'meta',
    }
    saveSetupState(state)
    const loaded = loadSetupState()
    expect(loaded.config.numberOfTeams).toBe(10)
    expect(loaded.config.budgetPerTeam).toBe(300)
    expect(loaded.config.humanTeamName).toBe('Champs')
    expect(loaded.aiBidderProfilesEnabled).toBe(true)
    expect(loaded.metaDraftsPerStrategy).toBe(80)
    expect(loaded.launchMode).toBe('meta')
  })

  it('defaults launchMode to live and rejects invalid values', () => {
    expect(defaultSetupState().launchMode).toBe('live')
    // Unknown / missing launchMode falls back to 'live'.
    window.localStorage.setItem(KEY, JSON.stringify({ launchMode: 'bogus' }))
    expect(loadSetupState().launchMode).toBe('live')
    window.localStorage.setItem(KEY, JSON.stringify({ launchMode: 'sim' }))
    expect(loadSetupState().launchMode).toBe('sim')
  })

  it('falls back to defaults on corrupt JSON', () => {
    window.localStorage.setItem(KEY, '{not valid json')
    expect(loadSetupState()).toEqual(defaultSetupState())
  })

  it('merges a partial saved config over defaults (forward-compatible)', () => {
    // Simulate a config saved before some fields existed.
    window.localStorage.setItem(KEY, JSON.stringify({ config: { numberOfTeams: 8 } }))
    const loaded = loadSetupState()
    expect(loaded.config.numberOfTeams).toBe(8)
    // Missing fields come from defaults.
    expect(loaded.config.scoringFormat).toBe('halfPPR')
    expect(loaded.config.rosterPositions).toEqual(defaultDraftConfig().rosterPositions)
    expect(loaded.aiBidderProfilesEnabled).toBe(false)
    expect(loaded.metaDraftsPerStrategy).toBe(defaultSetupState().metaDraftsPerStrategy)
  })

  it('coerces non-array strategy fields back to arrays', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ config: { aiTeamStrategies: 'oops', aiTeamHomeTeams: null } }))
    const loaded = loadSetupState()
    expect(loaded.config.aiTeamStrategies).toEqual([])
    expect(loaded.config.aiTeamHomeTeams).toEqual([])
  })

  it('sanitizes AI team names: trims, caps length, drops non-strings', () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      config: {
        aiTeamNames: ['  The Ringers  ', 42, null, 'x'.repeat(60)],
      },
    }))
    const loaded = loadSetupState()
    expect(loaded.config.aiTeamNames).toEqual(['The Ringers', '', '', 'x'.repeat(24)])
    // Corrupt/legacy value falls back to empty.
    window.localStorage.setItem(KEY, JSON.stringify({ config: { aiTeamNames: 'oops' } }))
    expect(loadSetupState().config.aiTeamNames).toEqual([])
  })

  it('defaults positionalSpendLimits to an empty object', () => {
    expect(defaultDraftConfig().positionalSpendLimits).toEqual({})
    // Configs saved before the field existed load with the default.
    window.localStorage.setItem(KEY, JSON.stringify({ config: { numberOfTeams: 8 } }))
    expect(loadSetupState().config.positionalSpendLimits).toEqual({})
  })

  it('round-trips positional spend limits and drops invalid entries', () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      config: {
        positionalSpendLimits: {
          RB: 70, K: 1,            // valid
          WR: 0, TE: 5.5, QB: 'x', // out of range / non-integer
          FLEX: 30, BENCH: 10,     // unknown position keys
        }
      }
    }))
    expect(loadSetupState().config.positionalSpendLimits).toEqual({ RB: 70, K: 1 })
  })

  it('coerces a non-object positionalSpendLimits back to empty', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ config: { positionalSpendLimits: 'oops' } }))
    expect(loadSetupState().config.positionalSpendLimits).toEqual({})
  })

  it('does not share the rosterPositions reference between loads (no mutation bleed)', () => {
    const a = loadSetupState()
    a.config.rosterPositions.QB = 99
    const b = loadSetupState()
    expect(b.config.rosterPositions.QB).not.toBe(99)
  })

  it('clearSetupState removes the entry', () => {
    saveSetupState(defaultSetupState())
    expect(window.localStorage.getItem(KEY)).not.toBeNull()
    clearSetupState()
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  // Stored numeric scalars are only trusted within sane ranges — a corrupt or
  // legacy value (huge numberOfTeams, NaN budget) used to pass straight into
  // Array.from({length}) / bid math and wedge the setup screen.
  it('rejects out-of-range or non-integer numeric scalars', () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      config: {
        numberOfTeams: 1e9,
        budgetPerTeam: 'lots',
        humanDraftPosition: -3,
        nominationTimer: 2.5,
        biddingTimer: null,
        minBidIncrement: NaN,
      },
    }))
    const d = defaultDraftConfig()
    const { config } = loadSetupState()
    expect(config.numberOfTeams).toBe(d.numberOfTeams)
    expect(config.budgetPerTeam).toBe(d.budgetPerTeam)
    expect(config.humanDraftPosition).toBe(d.humanDraftPosition)
    expect(config.nominationTimer).toBe(d.nominationTimer)
    expect(config.biddingTimer).toBe(d.biddingTimer)
    expect(config.minBidIncrement).toBe(d.minBidIncrement)
  })

  it('keeps in-range numeric scalars from storage', () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      config: { numberOfTeams: 10, budgetPerTeam: 300, humanDraftPosition: 10, biddingTimer: 15 },
    }))
    const { config } = loadSetupState()
    expect(config.numberOfTeams).toBe(10)
    expect(config.budgetPerTeam).toBe(300)
    expect(config.humanDraftPosition).toBe(10)
    expect(config.biddingTimer).toBe(15)
  })

  it('clamps a draft position that exceeds the stored team count', () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      config: { numberOfTeams: 8, humanDraftPosition: 12 },
    }))
    const { config } = loadSetupState()
    expect(config.humanDraftPosition).toBe(defaultDraftConfig().humanDraftPosition)
  })

  // The loaded config is built from an explicit field allowlist — a stored
  // blob can't smuggle arbitrary extra keys into the config object the whole
  // app (and DraftConfig constructor) trusts.
  it('drops unknown keys from a stored config (allowlist)', () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      config: { numberOfTeams: 10, evilExtra: { nested: true }, onload: 'alert(1)' },
    }))
    const { config } = loadSetupState()
    expect(config.numberOfTeams).toBe(10)
    expect('evilExtra' in config).toBe(false)
    expect('onload' in config).toBe(false)
    expect(Object.keys(config).sort()).toEqual(Object.keys(defaultDraftConfig()).sort())
  })

  it('clamps humanTeamName length and falls back on non-strings', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ config: { humanTeamName: 'x'.repeat(500) } }))
    expect(loadSetupState().config.humanTeamName).toBe('x'.repeat(24))
    window.localStorage.setItem(KEY, JSON.stringify({ config: { humanTeamName: { toString: 'nope' } } }))
    expect(loadSetupState().config.humanTeamName).toBe('Your Team')
  })

  it('validates rosterPositions keys and clamps counts to 0–30', () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      config: {
        rosterPositions: { QB: 1, RB: 500, WR: -2, TE: 1.5, HACKER: 9, BENCH: 6 },
      },
    }))
    const { config } = loadSetupState()
    expect(config.rosterPositions).toEqual({ QB: 1, RB: 30, WR: 0, BENCH: 6 })
    // Nothing valid left → defaults.
    window.localStorage.setItem(KEY, JSON.stringify({ config: { rosterPositions: { HACKER: 9 } } }))
    expect(loadSetupState().config.rosterPositions).toEqual(defaultDraftConfig().rosterPositions)
  })

  it('rejects unknown scoringFormat values', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ config: { scoringFormat: 'superDuperPPR' } }))
    expect(loadSetupState().config.scoringFormat).toBe('halfPPR')
    window.localStorage.setItem(KEY, JSON.stringify({ config: { scoringFormat: 'ppr' } }))
    expect(loadSetupState().config.scoringFormat).toBe('ppr')
  })

  it('maps non-string AI strategy/home-team seats to empty strings (indices preserved)', () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      config: {
        aiTeamStrategies: ['ZeroRB', 42, null, 'Taco'],
        aiTeamHomeTeams: [null, { evil: 1 }, 'KC'],
      },
    }))
    const { config } = loadSetupState()
    expect(config.aiTeamStrategies).toEqual(['ZeroRB', '', '', 'Taco'])
    expect(config.aiTeamHomeTeams).toEqual(['', '', 'KC'])
  })

  it('still loads sanitized positionValueFactors (sparse multipliers preserved)', () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      config: { positionValueFactors: { RB: 1.25, QB: 999, K: 'x' } },
    }))
    const { config } = loadSetupState()
    expect(config.positionValueFactors.RB).toBe(1.25)
    // Out-of-range clamps to the sanitizer's limit; non-numbers drop.
    expect(typeof config.positionValueFactors.QB).toBe('number')
    expect('K' in config.positionValueFactors).toBe(false)
  })
})
