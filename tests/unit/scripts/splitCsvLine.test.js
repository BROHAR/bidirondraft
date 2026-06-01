import { describe, it, expect } from 'vitest'
import { splitCsvLine } from '../../../scripts/refresh-projections/process.mjs'

describe('splitCsvLine', () => {
  it('splits a plain comma-separated line', () => {
    expect(splitCsvLine('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('preserves commas inside double-quoted fields', () => {
    // Travis Hunter scenario: "WR,CB" must stay as one field, not two.
    expect(splitCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd'])
  })

  it('keeps empty fields between consecutive commas', () => {
    expect(splitCsvLine('a,,b')).toEqual(['a', '', 'b'])
  })

  it('handles escaped double quotes inside a quoted field', () => {
    // RFC 4180 style: an embedded " is encoded as ""
    expect(splitCsvLine('a,"b""c",d')).toEqual(['a', 'b"c', 'd'])
  })

  it('returns a single field when the line has no commas', () => {
    expect(splitCsvLine('hello')).toEqual(['hello'])
  })

  it('handles an empty input', () => {
    expect(splitCsvLine('')).toEqual([''])
  })
})
