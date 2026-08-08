import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadOverrides,
  saveOverrides,
  sanitizeOverrides,
  applyOverrides,
} from '../../../src/utils/playerOverrides.js'

const KEY = 'adraft.playerOverrides.v1'

describe('playerOverrides — load-path sanitization', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('round-trips well-formed overrides', () => {
    const overrides = {
      p1: { estimatedValue: 42 },
      p2: { projectedPoints: { standard: 180, ppr: 220 } },
    }
    saveOverrides(overrides)
    expect(loadOverrides()).toEqual(overrides)
  })

  it('returns {} when nothing is stored or JSON is corrupt', () => {
    expect(loadOverrides()).toEqual({})
    window.localStorage.setItem(KEY, '{not json')
    expect(loadOverrides()).toEqual({})
  })

  it('drops non-object payloads and entries', () => {
    expect(sanitizeOverrides(null)).toEqual({})
    expect(sanitizeOverrides([1, 2])).toEqual({})
    expect(sanitizeOverrides({ p1: 'nope', p2: null, p3: 7 })).toEqual({})
  })

  it('drops non-finite or out-of-range estimatedValue', () => {
    const clean = sanitizeOverrides({
      p1: { estimatedValue: Infinity },
      p2: { estimatedValue: -5 },
      p3: { estimatedValue: 100001 },
      p4: { estimatedValue: '55' },
      p5: { estimatedValue: 55 },
    })
    expect(clean).toEqual({ p5: { estimatedValue: 55 } })
  })

  it('restricts projectedPoints to known scoring formats with finite values', () => {
    const clean = sanitizeOverrides({
      p1: {
        projectedPoints: {
          standard: 150,
          halfPPR: Infinity,       // dropped
          ppr: '200',              // dropped
          superFlexPoints: 300,    // unknown key dropped
        },
      },
      p2: { projectedPoints: { bogus: 1 } },  // nothing valid → entry dropped
    })
    expect(clean).toEqual({ p1: { projectedPoints: { standard: 150 } } })
  })

  it('drops unknown fields on an entry (only sanctioned override keys survive)', () => {
    const clean = sanitizeOverrides({
      p1: { estimatedValue: 10, injectedField: 'evil' },
    })
    expect(clean).toEqual({ p1: { estimatedValue: 10 } })
  })

  it('sanitized output flows through applyOverrides unchanged', () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      p1: { estimatedValue: 30, junk: true },
      p2: { estimatedValue: 'NaN-ish' },
    }))
    const data = { players: [
      { id: 'p1', estimatedValue: 10, projectedPoints: { standard: 100 } },
      { id: 'p2', estimatedValue: 20, projectedPoints: { standard: 110 } },
    ] }
    const applied = applyOverrides(data, loadOverrides())
    expect(applied.players[0].estimatedValue).toBe(30)
    expect(applied.players[1].estimatedValue).toBe(20)   // corrupt override ignored
  })
})
