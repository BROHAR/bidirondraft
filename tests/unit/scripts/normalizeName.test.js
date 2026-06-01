import { describe, it, expect } from 'vitest'
import { normalizeName } from '../../../scripts/refresh-projections/process.mjs'

describe('normalizeName', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeName('Ja\'Marr Chase')).toBe('jamarrchase')
  })

  it('strips punctuation: apostrophes, periods, commas', () => {
    expect(normalizeName("Ja'Marr Chase")).toBe('jamarrchase')
    expect(normalizeName('A.J. Brown')).toBe('ajbrown')
  })

  it('strips name suffixes (jr/sr/ii/iii/iv/v)', () => {
    expect(normalizeName("Ja'Marr Chase Jr.")).toBe('jamarrchase')
    expect(normalizeName('Patrick Mahomes II')).toBe('patrickmahomes')
    expect(normalizeName('Marvin Harrison Sr.')).toBe('marvinharrison')
  })

  it('strips " D/ST" suffix so ESPN and Yahoo defense names join', () => {
    expect(normalizeName('Bengals D/ST')).toBe('bengals')
    expect(normalizeName('Bengals DST')).toBe('bengals')
    expect(normalizeName('49ers D/ST')).toBe('49ers')
  })

  it('does not strip "DST" inside a player name', () => {
    // No standalone DST word — should leave alone (no real-world example
    // but guards the regex's word-boundary use).
    expect(normalizeName('Bengaldstown')).toBe('bengaldstown')
  })

  it('returns empty string for nullish or empty input', () => {
    expect(normalizeName('')).toBe('')
    expect(normalizeName(null)).toBe('')
    expect(normalizeName(undefined)).toBe('')
  })
})
