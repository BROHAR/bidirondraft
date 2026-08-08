import { describe, it, expect } from 'vitest'
import { csvField, decodeCsvField } from '../../../scripts/refresh-projections/csv.mjs'
import { splitCsvLine, splitCsvRecords } from '../../../scripts/refresh-projections/process.mjs'

// Decode exactly the way process.mjs does: records → cells → guard strip.
function parseField(text) {
  const [record] = splitCsvRecords(text)
  return splitCsvLine(record).map(decodeCsvField)
}

describe('csvField encoding', () => {
  it('leaves plain strings and numbers alone', () => {
    expect(csvField('Patrick Mahomes')).toBe('Patrick Mahomes')
    expect(csvField(12.5)).toBe('12.5')
    expect(csvField(-2)).toBe('-2') // negative numbers are not formula-guarded
  })

  it('renders null/undefined as an empty field', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
  })

  it('quotes fields containing commas', () => {
    expect(csvField('WR,CB')).toBe('"WR,CB"')
  })

  it('quotes fields containing double quotes, doubling them', () => {
    expect(csvField('Nick "Brick" Jones')).toBe('"Nick ""Brick"" Jones"')
  })

  it('quotes fields containing newlines', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
  })

  it('prefixes formula-leading strings with an apostrophe', () => {
    expect(csvField('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`)
    expect(csvField('+1234')).toBe("'+1234")
    expect(csvField('-QB')).toBe("'-QB")
    expect(csvField('@import')).toBe("'@import")
    expect(csvField('\tx')).toBe("'\tx")
  })

  it('doubles a legitimate leading apostrophe so decoding is unambiguous', () => {
    expect(csvField("'Aulola Tonga")).toBe("''Aulola Tonga")
  })
})

describe('decodeCsvField', () => {
  it('strips the formula guard', () => {
    expect(decodeCsvField("'=SUM(A1)")).toBe('=SUM(A1)')
    expect(decodeCsvField("''Aulola")).toBe("'Aulola")
  })

  it('leaves unguarded values alone', () => {
    expect(decodeCsvField('Patrick Mahomes')).toBe('Patrick Mahomes')
    expect(decodeCsvField("'Aulola")).toBe("'Aulola") // apostrophe + non-guard char: not ours
    expect(decodeCsvField('')).toBe('')
    expect(decodeCsvField(undefined)).toBe(undefined)
  })
})

describe('round-trip: writer output → process.mjs parser → original values', () => {
  const nasty = [
    'Patrick Mahomes',
    '=HYPERLINK("http://evil.example")',
    '+ADD(1)',
    '-1e9',
    '@SUM(A1:A9)',
    "O'Brien, Jr.",
    'Nick "The Brick" Jones',
    'line one\nline two',
    "'Aulola Tonga",
    'carriage\rreturn',
    'WR,CB',
  ]

  it.each(nasty.map((v) => [v]))('round-trips %j', (value) => {
    const line = [value, 'QB', 'KC'].map(csvField).join(',')
    expect(parseField(line)).toEqual([value, 'QB', 'KC'])
  })

  it('keeps one record per row even with embedded newlines and quotes', () => {
    const rows = nasty.map((v) => [v, 'RB', 'DAL', 42].map(csvField).join(','))
    const text = ['name,position,team,proj_dollars', ...rows].join('\n') + '\n'
    const records = splitCsvRecords(text)
    expect(records).toHaveLength(1 + nasty.length)
    records.slice(1).forEach((record, i) => {
      const cells = splitCsvLine(record).map(decodeCsvField)
      expect(cells).toEqual([nasty[i], 'RB', 'DAL', '42'])
    })
  })

  it('a crafted name cannot inject an extra CSV row', () => {
    const attack = 'Evil\n"=cmd|/c calc",QB,KC,999'
    const line = [attack, 'WR', 'PHI'].map(csvField).join(',')
    const records = splitCsvRecords(`name,position,team\n${line}\n`)
    expect(records).toHaveLength(2) // header + one row — the payload stayed inside its field
    expect(splitCsvLine(records[1]).map(decodeCsvField)[0]).toBe(attack)
  })
})
