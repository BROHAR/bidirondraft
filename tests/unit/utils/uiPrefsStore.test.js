import { describe, it, expect, beforeEach } from 'vitest'
import { defaultUiPrefs, loadUiPrefs, saveUiPrefs } from '../../../src/utils/uiPrefsStore.js'

const KEY = 'adraft.uiPrefs.v1'

describe('uiPrefsStore', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('defaults showDraftedPlayers to false (historical pool behavior)', () => {
    expect(defaultUiPrefs().showDraftedPlayers).toBe(false)
    expect(loadUiPrefs().showDraftedPlayers).toBe(false)
  })

  it('round-trips a saved preference', () => {
    saveUiPrefs({ showDraftedPlayers: true })
    expect(loadUiPrefs().showDraftedPlayers).toBe(true)
    saveUiPrefs({ showDraftedPlayers: false })
    expect(loadUiPrefs().showDraftedPlayers).toBe(false)
  })

  it('merges partial saves over stored prefs', () => {
    saveUiPrefs({ showDraftedPlayers: true })
    saveUiPrefs({})
    expect(loadUiPrefs().showDraftedPlayers).toBe(true)
  })

  it('falls back to defaults on corrupt or non-object data', () => {
    window.localStorage.setItem(KEY, 'not json{{{')
    expect(loadUiPrefs()).toEqual(defaultUiPrefs())
    window.localStorage.setItem(KEY, JSON.stringify('a string'))
    expect(loadUiPrefs()).toEqual(defaultUiPrefs())
  })

  it('coerces stored values to booleans', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ showDraftedPlayers: 'yes' }))
    expect(loadUiPrefs().showDraftedPlayers).toBe(true)
  })
})
