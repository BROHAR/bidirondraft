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
})
