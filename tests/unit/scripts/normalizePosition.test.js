import { describe, it, expect } from 'vitest'
import { normalizePosition, APP_POSITIONS } from '../../../scripts/refresh-projections/positions.mjs'

describe('normalizePosition', () => {
  it('passes through single app-relevant positions', () => {
    expect(normalizePosition('QB')).toBe('QB')
    expect(normalizePosition('RB')).toBe('RB')
    expect(normalizePosition('WR')).toBe('WR')
    expect(normalizePosition('TE')).toBe('TE')
    expect(normalizePosition('K')).toBe('K')
  })

  it('upper-cases lowercase input', () => {
    expect(normalizePosition('wr')).toBe('WR')
  })

  it('returns the first app-relevant position from a comma-separated string', () => {
    expect(normalizePosition('WR,CB')).toBe('WR') // Travis Hunter
  })

  it('handles slash-separated multi-position strings', () => {
    expect(normalizePosition('WR/CB')).toBe('WR')
  })

  it('handles whitespace-separated multi-position strings', () => {
    expect(normalizePosition('WR CB')).toBe('WR')
  })

  it('picks the app-relevant position even when listed second', () => {
    expect(normalizePosition('CB,WR')).toBe('WR')
  })

  it('returns empty string for positions the app does not use', () => {
    expect(normalizePosition('CB')).toBe('')
    expect(normalizePosition('LB')).toBe('')
    expect(normalizePosition('S')).toBe('')
    expect(normalizePosition('OL')).toBe('')
  })

  it('returns empty string for nullish or blank input', () => {
    expect(normalizePosition('')).toBe('')
    expect(normalizePosition(null)).toBe('')
    expect(normalizePosition(undefined)).toBe('')
    expect(normalizePosition('   ')).toBe('')
  })

  it('normalizes defense variants to DST', () => {
    expect(normalizePosition('D/ST')).toBe('DST')
    expect(normalizePosition('DST')).toBe('DST')
    expect(normalizePosition('DEF')).toBe('DST')
    expect(normalizePosition('D')).toBe('DST')
  })

  it('exports the canonical set of app positions', () => {
    expect(APP_POSITIONS).toBeInstanceOf(Set)
    expect(APP_POSITIONS.has('WR')).toBe(true)
    expect(APP_POSITIONS.has('CB')).toBe(false)
  })
})
