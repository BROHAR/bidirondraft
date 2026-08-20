import { describe, it, expect } from 'vitest'
import {
  parsePlayerValuesCsv,
  mergeImportedOverrides,
  EXAMPLE_HEADER,
  MAX_ROWS,
} from '../../../src/utils/playerValuesImport.js'
import { sanitizeOverrides } from '../../../src/utils/playerOverrides.js'

const POOL = [
  { id: 'rb1', name: 'Bijan Robinson', position: 'RB' },
  { id: 'wr1', name: "Ja'Marr Chase", position: 'WR' },
  { id: 'qb1', name: 'Josh Allen', position: 'QB' },
  { id: 'dst1', name: 'Steelers D/ST', position: 'DST' },
  // Same-name pair to exercise ambiguity handling.
  { id: 'wr2', name: 'Marvin Harrison Jr.', position: 'WR' },
  { id: 'te9', name: 'Marvin Harrison', position: 'TE' },
]

describe('parsePlayerValuesCsv', () => {
  it('parses the documented header and matches by name + position', () => {
    const csv = `${EXAMPLE_HEADER}\nBijan Robinson,RB,55,290.5\nJosh Allen,QB,38,`
    const { entries, errors, warnings } = parsePlayerValuesCsv(csv, POOL)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(entries).toEqual([
      { playerId: 'rb1', name: 'Bijan Robinson', position: 'RB', value: 55, points: 290.5 },
      { playerId: 'qb1', name: 'Josh Allen', position: 'QB', value: 38 },
    ])
  })

  it('accepts header synonyms, $ prefixes, commas, and quoted fields', () => {
    const csv = 'Name,Pos,AAV,FPTS\n"Chase, Ja\'Marr...nope","WR",1,1\n"Ja\'Marr Chase",WR,"$1,250",180'
    const { entries, errors } = parsePlayerValuesCsv(csv, POOL)
    expect(errors).toEqual([])
    const chase = entries.find(e => e.playerId === 'wr1')
    expect(chase.value).toBe(1250)
    expect(chase.points).toBe(180)
  })

  it('matches by name alone when no position column is present', () => {
    const csv = 'Player,Value\nBijan Robinson,55'
    const { entries, warnings } = parsePlayerValuesCsv(csv, POOL)
    expect(entries.map(e => e.playerId)).toEqual(['rb1'])
    expect(warnings).toEqual([])
  })

  it('flags names matching multiple pool players when no position given', () => {
    // nameKey strips the Jr suffix, so both Marvin Harrisons collide by name;
    // a position column resolves the same name cleanly.
    const ambiguous = parsePlayerValuesCsv('Player,Value\nMarvin Harrison Jr,20', POOL)
    expect(ambiguous.entries).toEqual([])
    expect(ambiguous.warnings.some(w => w.includes('matches multiple players'))).toBe(true)

    const resolved = parsePlayerValuesCsv('Player,Position,Value\nMarvin Harrison Jr,WR,20', POOL)
    expect(resolved.entries.map(e => e.playerId)).toEqual(['wr2'])
  })

  it('normalizes DEF/D-ST position spellings', () => {
    const csv = 'Player,Position,Value\nSteelers D/ST,DEF,3'
    const { entries } = parsePlayerValuesCsv(csv, POOL)
    expect(entries[0].playerId).toBe('dst1')
  })

  it('errors on a missing player column or missing value+points columns', () => {
    expect(parsePlayerValuesCsv('Foo,Bar\n1,2', POOL).errors[0]).toContain('player-name column')
    expect(parsePlayerValuesCsv('Player,Team\nJosh Allen,BUF', POOL).errors[0]).toContain('value or points column')
    expect(parsePlayerValuesCsv('', POOL).errors[0]).toContain('empty')
  })

  it('skips rows with out-of-bounds or non-numeric values, with warnings', () => {
    const csv = [
      'Player,Position,Value,Points',
      'Bijan Robinson,RB,-5,100',        // negative value
      'Josh Allen,QB,abc,100',           // non-numeric value
      "Ja'Marr Chase,WR,40,99999",       // points over cap
      'Steelers D/ST,DST,1e309,1',       // not a plain numeral (Infinity-ish)
    ].join('\n')
    const { entries, warnings } = parsePlayerValuesCsv(csv, POOL)
    expect(entries).toEqual([])
    expect(warnings).toHaveLength(4)
  })

  it('skips unmatched players and rows with neither value nor points', () => {
    const csv = 'Player,Position,Value,Points\nRetired Guy,RB,10,\nJosh Allen,QB,,'
    const { entries, warnings, errors } = parsePlayerValuesCsv(csv, POOL)
    expect(entries).toEqual([])
    expect(warnings.some(w => w.includes('not found in the player pool'))).toBe(true)
    expect(warnings.some(w => w.includes('no value or points'))).toBe(true)
    expect(errors[0]).toContain('No rows matched')
  })

  it('later duplicate rows win, with a warning', () => {
    const csv = 'Player,Position,Value\nJosh Allen,QB,30\nJosh Allen,QB,45'
    const { entries, warnings } = parsePlayerValuesCsv(csv, POOL)
    expect(entries).toEqual([{ playerId: 'qb1', name: 'Josh Allen', position: 'QB', value: 45 }])
    expect(warnings.some(w => w.includes('duplicate'))).toBe(true)
  })

  it('rejects files over the row cap without parsing them', () => {
    const rows = Array.from({ length: MAX_ROWS + 1 }, () => 'Josh Allen,QB,1')
    const csv = ['Player,Position,Value', ...rows].join('\n')
    const { errors, entries } = parsePlayerValuesCsv(csv, POOL)
    expect(errors[0]).toContain('Too many rows')
    expect(entries).toEqual([])
  })

  it('never throws on garbage input', () => {
    for (const garbage of [null, undefined, '\0\0\0', '"""', 'a'.repeat(100000), ',,,,\n,,,,']) {
      expect(() => parsePlayerValuesCsv(garbage, POOL)).not.toThrow()
    }
  })
})

describe('mergeImportedOverrides', () => {
  it('writes value and points into the playerOverrides shape', () => {
    const merged = mergeImportedOverrides({}, [
      { playerId: 'rb1', value: 55, points: 290.5 },
      { playerId: 'qb1', value: 38 },
    ], 'halfPPR')
    expect(merged).toEqual({
      rb1: { estimatedValue: 55, projectedPoints: { halfPPR: 290.5 } },
      qb1: { estimatedValue: 38 },
    })
  })

  it('preserves existing overrides for untouched players and fields', () => {
    const existing = {
      wr1: { estimatedValue: 60 },
      rb1: { estimatedValue: 10, projectedPoints: { ppr: 200 } },
    }
    const merged = mergeImportedOverrides(existing, [{ playerId: 'rb1', points: 250 }], 'halfPPR')
    expect(merged.wr1).toEqual({ estimatedValue: 60 })
    expect(merged.rb1).toEqual({ estimatedValue: 10, projectedPoints: { ppr: 200, halfPPR: 250 } })
  })

  it('produces overrides that survive the storage sanitizer round-trip', () => {
    const merged = mergeImportedOverrides({}, [
      { playerId: 'rb1', value: 55, points: 290.5 },
    ], 'ppr')
    expect(sanitizeOverrides(merged)).toEqual(merged)
  })
})
